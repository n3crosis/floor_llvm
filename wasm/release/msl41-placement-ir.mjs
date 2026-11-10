// Bounded interpreter for authored volatile placement kernels. Reject unknown
// instructions instead of accepting a store-count or symbol-name coincidence.
import assert from 'node:assert/strict';
const pointer='(?:%[\\w.]+|i(?:8|32|64)|\\[\\d+ x i8\\])(?: addrspace\\((\\d+)\\))?\\*';
export function checkPlacementDataflow(ir,test) {
  const functions=[...ir.matchAll(new RegExp(`^define void @${test.entry}\\(([^]*?)\\n}`,'gm'))];
  assert.equal(functions.length,1,'Missing or duplicate placement entry');
  const body=functions[0][0], space={thread:0,threadgroup:3,device:1}[test.placementSpace];
  assert(space!==undefined,'Unknown placement address space');
  const itemSize=test.placementForm==='aligned'?32:4;
  const size=test.placementForm==='array'?8:itemSize;
  const pointerMemory=new Map();
  const pointers=new Map([['%out',{base:'out',offset:0,space:1}],['%storage',{base:'storage',offset:0,space}]]), values=new Map(), memory=new Map(), events=[];
  const getPointer=(id,as)=>{const p=pointers.get(id);assert(p,'Unknown pointer '+id);assert.equal(p.space,as,'Pointer address space mismatch');return p;};
  const getValue=v=>{if(/^-?\d+$/.test(v))return Number(v)>>>0;assert(values.has(v),'Unknown value '+v);return values.get(v);};
  let returned=false,label=false;
  for(const raw of body.split('\n').slice(1)) {
    const line=raw.trim(); if(!line||line==='}'||line.startsWith(';'))continue;
    assert(!returned,'Instruction after return');
    if(line==='entry:'){assert(!label,'Unexpected block');label=true;continue;}
    if(line==='ret void'){returned=true;continue;}
    if(/^tail call void @llvm\.assume\(i1 %[\w.]+\)/.test(line)||/^call void @llvm\.assume\(i1 %[\w.]+\)/.test(line))continue;
    if(/^(?:tail )?call void @llvm\.lifetime\.(?:start|end)\.p0i8\(i64 (?:4|8|32), i8\* (?:nonnull )?%[\w.]+\)/.test(line))continue;
    let m;
    if((m=line.match(/^store volatile %struct\.Item\* (%[\w.]+), %struct\.Item\*\* (%[\w.]+), align 8(?:, ![\w.]+ !\d+)*$/))) {
      const p=getPointer(m[1],0),slot=getPointer(m[2],0);assert.equal(slot.base,'slot');pointerMemory.set(m[2],p);continue;
    }
    if((m=line.match(new RegExp(`^store volatile i32 ([^,]+), i32(?: addrspace\\((\\d+)\\))?\\* (%[\\w.]+), align (\\d+)(?:, ![\\w.]+ !\\d+)*$`)))) {
      const p=getPointer(m[3],Number(m[2]??0)), value=getValue(m[1]);
      assert(p.offset>=0&&p.offset%4===0&&p.offset+4<=(p.base==='out'?12:size),'Store outside placement storage');
      if(p.base==='storage'&&test.placementForm==='aligned')assert.equal(Number(m[4]),32,'Lost over-alignment');
      memory.set(`${p.base}:${p.offset}`,value);events.push([p.base,p.offset,value]);continue;
    }
    const assignment=line.match(/^(%[\w.]+) = (.+)$/);assert(assignment,'Unsupported placement instruction '+line);
    const [,id,rhs]=assignment;assert(!pointers.has(id)&&!values.has(id),'Duplicate SSA value');
    if((m=rhs.match(/^alloca %struct\.Item\*, align 8$/))) {assert.equal(space,0);pointers.set(id,{base:'slot',offset:0,space:0});continue;}
    if((m=rhs.match(/^bitcast %struct\.Item\*\* (%[\w.]+) to i8\*$/))) {const p=getPointer(m[1],0);assert.equal(p.base,'slot');pointers.set(id,p);continue;}
    if((m=rhs.match(/^load volatile %struct\.Item\*, %struct\.Item\*\* (%[\w.]+), align 8(?:, ![\w.]+ !\d+)*$/))) {assert(pointerMemory.has(m[1]),'Unknown pointer slot');pointers.set(id,pointerMemory.get(m[1]));continue;}
    if((m=rhs.match(/^alloca (?:i32|\[(\d+) x i8\]|%struct\.Item), align (\d+)/))) {
      assert.equal(space,0,'Unexpected private allocation');assert(Number(m[2])>= (test.placementForm==='aligned'?32:4),'Under-aligned local storage');
      pointers.set(id,{base:'storage',offset:0,space:0});continue;
    }
    if((m=rhs.match(new RegExp(`^bitcast ${pointer} (%[\\w.]+) to ${pointer}$`)))) {
      const p=getPointer(m[2],Number(m[1]??0));assert.equal(Number(m[3]??0),p.space,'Address space cast in placement');pointers.set(id,p);continue;
    }
    if((m=rhs.match(/^getelementptr inbounds (i(?:8|32|64)|%struct\.Item|\[(\d+) x i8\]), (?:%[\w.]+|i(?:8|32|64)|\[\d+ x i8\])(?: addrspace\((\d+)\))?\* (%[\w.]+), i(?:32|64) (-?\d+)(?:, i(?:32|64) (-?\d+))?$/))) {
      const p=getPointer(m[4],Number(m[3]??0));const stride=m[1]==='%struct.Item'?itemSize:m[2]?Number(m[2]):Number(m[1].slice(1))/8;
      assert(m[6]===undefined||m[2]||Number(m[6])===0,'Unexpected structure field');
      pointers.set(id,{...p,offset:p.offset+stride*Number(m[5])+(m[2]?Number(m[6]??0):0)});continue;
    }
    if((m=rhs.match(/^load volatile i32, i32(?: addrspace\((\d+)\))?\* (%[\w.]+), align \d+(?:, ![\w.]+ !\d+)*$/))) {
      const p=getPointer(m[2],Number(m[1]??0)),key=`${p.base}:${p.offset}`;assert(memory.has(key),'Read unconstructed storage');values.set(id,memory.get(key));events.push(['read',p.offset,memory.get(key)]);assert.equal(p.base,'storage','Unexpected output read');continue;
    }
    if((m=rhs.match(new RegExp(`^icmp (eq|ne) ${pointer} (%[\\w.]+), (null|%[\\w.]+)$`)))) {
      const p=getPointer(m[3],Number(m[2]??0));const q=m[4]==='null'?null:pointers.get(m[4]);assert(q||m[4]==='null','Unknown compare pointer');
      const equal=q&&p.base===q.base&&p.offset===q.offset&&p.space===q.space;values.set(id,Number(m[1]==='eq'?!!equal:!equal));continue;
    }
    if((m=rhs.match(/^zext i1 (%[\w.]+) to i32$/))){values.set(id,getValue(m[1]));continue;}
    assert.fail('Unsupported placement dataflow '+line);
  }
  assert(returned,'Missing return');
  const expected=test.placementForm==='array'?[['storage',0,7],['storage',4,7],['out',0,1],['read',0,7],['out',4,7],['read',4,7],['out',8,7],['storage',0,19],['storage',4,19]]:
    test.placementForm==='aligned'?[['storage',0,17],['read',0,17],['out',0,17],['out',4,1],['storage',0,19]]:
    [['storage',0,7],['read',0,7],['out',0,7],['storage',0,19],['storage',0,11],['read',0,11],['out',4,11],['storage',0,19]];
  assert.deepEqual(events,expected,'Incorrect constructor, lifetime, pointer identity, or output order');
  return events;
}
