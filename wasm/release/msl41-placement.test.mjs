import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {msl41PlacementCases,placementSpaces,assertMSL41PlacementIR,assertMSL41PlacementDiagnostic} from './msl41-placement.mjs';
import {checkPlacementDataflow} from './msl41-placement-ir.mjs';
const positive=(space,form)=>msl41PlacementCases.find(t=>t.placementSpace===space&&t.placementForm===form&&t.kind===1&&t.math===0);
// Explicit synthetic fixtures test the oracle, not a substitute for compilation.
function fixture(t) {
  const space={thread:0,threadgroup:3,device:1}[t.placementSpace],as=space?` addrspace(${space})`:'';
  const type=`i32${as}*`,param=t.placementSpace==='thread'?'':`${type} %storage, `;
  let body=`target triple = "air64-apple-ios27.0.0"\n!air.version = !{!1}\n!1 = !{i32 2, i32 9, i32 0}\n!air.language_version = !{!2}\n!2 = !{!"Metal", i32 4, i32 1, i32 0}\n!air.kernel = !{!3}\ndefine void @${t.entry}(${param}i32 addrspace(1)* %out) {\nentry:\n`;
  if(t.placementSpace==='thread')body+='  %local = alloca [32 x i8], align 32\n  %ptr = bitcast [32 x i8]* %local to i32*\n';
  const ptr=t.placementSpace==='thread'?'%ptr':'%storage',alignment=t.placementForm==='aligned'?32:4;
  const store=(v,p=ptr)=>{body+=`  store volatile i32 ${v}, ${type} ${p}, align ${alignment}\n`;};
  let readID=0;
  const load=(p=ptr)=>{const id='%v'+readID++;body+=`  ${id} = load volatile i32, ${type} ${p}, align ${alignment}\n`;return id;};
  const output=(i,v)=>{if(i)body+=`  %out${i} = getelementptr inbounds i32, i32 addrspace(1)* %out, i32 ${i}\n`;body+=`  store volatile i32 ${v}, i32 addrspace(1)* ${i?'%out'+i:'%out'}, align 4\n`;};
  if(t.placementForm==='array') {body+=`  %second = getelementptr inbounds i32, ${type} ${ptr}, i32 1\n`;store(7);store(7,'%second');output(0,1);output(1,load());output(2,load('%second'));store(19);store(19,'%second');}
  else if(t.placementForm==='aligned'){store(17);output(0,load());output(1,1);store(19);}
  else {store(7);output(0,load());store(19);store(11);output(1,load());store(19);}
  return body+'  ret void\n}\n';
}
test('matrix covers all six storage operators, lifetime and alignment, both output/math profiles',()=>{
  assert.equal(new Set(msl41PlacementCases.map(t=>t.name)).size,msl41PlacementCases.length);
  assert.equal(msl41PlacementCases.filter(t=>t.status===0).length,36);
  assert.equal(msl41PlacementCases.filter(t=>t.placementGate).length,8);
  for(const t of msl41PlacementCases){assert(Buffer.byteLength(t.source)<4096);if(t.status===3)assert(t.diagnosticPattern);}
  for(const space of placementSpaces)for(const form of ['scalar','array','aligned'])for(const math of [0,1])for(const kind of [0,1])
    assert.equal(msl41PlacementCases.filter(t=>t.placementSpace===space&&t.placementForm===form&&t.math===math&&t.kind===kind).length,1);
});
test('header exposes exactly the six spec signatures only in 4.1',()=>{
  const h=readFileSync(new URL('../api/include/metal_common',import.meta.url),'utf8');
  assert.match(h,/#if defined\(__METAL_VERSION__\) && __METAL_VERSION__ >= 410/);
  assert.deepEqual([...h.matchAll(/(thread|threadgroup|device) void \*operator new(\[\])?\(metal::size_t, (thread|threadgroup|device) void \*ptr\)/g)].map(m=>[m[1],m[2]??'',m[3]]),placementSpaces.flatMap(s=>[[s,'',s],[s,'[]',s]]));
  assert(!/\b__asm__\b|\bdelete\s*\(|\bmalloc\b|\bair\./.test(h));
});
for(const space of placementSpaces)for(const form of ['scalar','array','aligned'])test(`oracle checks ${space} ${form}`,()=>{
  const t=positive(space,form),ir=fixture(t);assertMSL41PlacementIR(ir,t);
  assert.throws(()=>assertMSL41PlacementIR(ir.replace('i32 2, i32 9, i32 0','i32 2, i32 7, i32 0'),t));
  assert.throws(()=>assertMSL41PlacementIR(ir.replace('Metal", i32 4, i32 1','Metal", i32 3, i32 2'),t));
  assert.throws(()=>assertMSL41PlacementIR(ir.replace('ios27','ios26'),t));
  assert.throws(()=>checkPlacementDataflow(ir.replace('store volatile i32 19','store volatile i32 20'),t));
  assert.throws(()=>checkPlacementDataflow(ir.replace('  ret void','  call void @fake_allocator()\n  ret void'),t));
  assert.throws(()=>checkPlacementDataflow(ir.replace(/store volatile i32 [^\n]+\n/,''),t));
  if(form==='array'){
    assert.throws(()=>checkPlacementDataflow(ir.replace('store volatile i32 1,','store volatile i32 0,'),t));
    assert.throws(()=>checkPlacementDataflow(ir.replace('i32 1\n','i32 2\n'),t));
    assert.throws(()=>checkPlacementDataflow(ir.replace('  ret void','  store i64 2, i64* %cookie, align 8\n  ret void'),t));
  }
  if(form==='aligned')assert.throws(()=>checkPlacementDataflow(ir.replaceAll('align 32','align 4'),t));
});
test('negative tests require their intended diagnostics',()=>{
  for(const t of msl41PlacementCases.filter(t=>t.status===3))assert.throws(()=>assertMSL41PlacementDiagnostic('unrelated syntax error',t));
  assertMSL41PlacementDiagnostic('placement new requires Metal 4.1',msl41PlacementCases.find(t=>t.placementGate));
});
test('core recognizes reserved signatures before array cookie/null-check lowering',()=>{
  const decl=readFileSync(new URL('../../clang/lib/AST/Decl.cpp',import.meta.url),'utf8');
  assert.match(decl,/MetalVersion >= 410/);assert.match(decl,/Context\.hasSameType\(proto->getReturnType\(\), Pointer\)/);
  const sema=readFileSync(new URL('../../clang/lib/Sema/SemaExprCXX.cpp',import.meta.url),'utf8');
  assert(sema.includes('runtime-bound placement arrays are not supported'));
  assert(sema.includes('Metal placement new requires the standard storage-pointer overload'));
});
