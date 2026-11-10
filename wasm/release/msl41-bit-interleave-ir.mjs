// Authored, deliberately bounded evaluator of straight-line integer AIR.
// This validates emitted dataflow, not execution by Apple's loader or a GPU.
import assert from 'node:assert/strict';
const integer = '(?:i(?:1|8|16|32|64)|<[234] x i(?:1|8|16|32|64)>)';
const shape = type => {
  const m = type.match(/^(?:<([234]) x )?i(1|8|16|32|64)>?$/);
  assert(m, `Unsupported integer type ${type}`);
  return {lanes:Number(m[1] ?? 1), bits:Number(m[2])};
};
const split = text => {
  let depth=0, start=0; const parts=[];
  for(let i=0;i<text.length;i++) {
    if(text[i]==='<') depth++;
    if(text[i]==='>') depth--;
    if(text[i]===',' && depth===0) { parts.push(text.slice(start,i).trim()); start=i+1; }
  }
  parts.push(text.slice(start).trim()); return parts;
};
const typed = text => {
  const m=text.match(new RegExp(`^(${integer}) (.+)$`));
  assert(m, `Unsupported typed integer ${text}`); return {type:m[1], value:m[2]};
};
export function integerBytes(values,bits) {
  assert(bits%8===0); return values.flatMap(value => {
    assert(value!==undefined,'Undefined output bits');
    const x=BigInt.asUintN(bits,BigInt(value));
    return Array.from({length:bits/8},(_,i)=>Number((x>>BigInt(i*8))&255n));
  });
}
const fromBytes = (bytes,bits) => {
  assert(bits%8===0 && bytes.length%(bits/8)===0,'Invalid byte shape');
  const values=[];
  for(let i=0;i<bytes.length;i+=bits/8) {
    let value=0n;
    for(let j=0;j<bits/8;j++) { assert(bytes[i+j]!==undefined,'Uninitialized input'); value|=BigInt(bytes[i+j])<<BigInt(8*j); }
    values.push(value);
  }
  return values;
};

export function evaluateBitInterleaveKernel(body,inputBytes,outputSize) {
  assert(body.length<256*1024,'Oversized integer kernel');
  const values=new Map(), pointers=new Map([['%a',{buffer:'input',offset:0}],['%b',{buffer:'output',offset:0}]]);
  const output=Array(outputSize), written=new Set();
  const get=(value,type)=>{
    const {lanes,bits}=shape(type); let result;
    if(value.startsWith('%')) { result=values.get(value); assert(result,`Unknown SSA value ${value}`); }
    else if(value==='undef'||value==='poison') result=Array(lanes).fill(undefined);
    else if(value==='zeroinitializer') result=Array(lanes).fill(0n);
    else if(value.startsWith('<')) result=split(value.slice(1,-1)).flatMap(read);
    else { assert(/^-?\d+$|^(?:true|false)$/.test(value),`Unsupported integer constant ${value}`); result=[value==='true'?1n:value==='false'?0n:BigInt(value)]; }
    assert.equal(result.length,lanes,'Integer lane mismatch');
    return result.map(x=>x===undefined?undefined:BigInt.asUintN(bits,x));
  };
  const read=text=>{const t=typed(text);return get(t.value,t.type);};
  const map=(a,b,fn)=>{assert.equal(a.length,b.length);return a.map((x,i)=>{return x===undefined||b[i]===undefined?undefined:fn(x,b[i]);});};
  let returned=false, label=false, instruction=false;
  for(const rawLine of body.split('\n')) {
    const line=rawLine.trim();
    if(!line||line==='}'||line.startsWith(';')||line.startsWith('define void @'))continue;
    assert(!returned,'Instruction after return');
    if(line==='entry:') { assert(!label&&!instruction,'Unexpected basic block'); label=true; continue; }
    if(line==='ret void') { returned=true; continue; }
    instruction=true;
    let m;
    if((m=line.match(new RegExp(`^store volatile (${integer} .+?), ${integer} addrspace\\(1\\)\\* (%[\\w.]+), align \\d+(?:, ![\\w.]+ !\\d+)*$`)))) {
      const t=typed(m[1]),p=pointers.get(m[2]); assert(p&&p.buffer==='output','Wrong output pointer');
      const bytes=integerBytes(get(t.value,t.type),shape(t.type).bits);
      for(let i=0;i<bytes.length;i++) { const index=p.offset+i;assert(index>=0&&index<outputSize&&!written.has(index),'Wrong or duplicate output address');written.add(index);output[index]=bytes[i]; }
      continue;
    }
    const assignment=line.match(/^(%[\w.]+) = (.+)$/); assert(assignment,`Unsupported control flow/side effect: ${line}`);
    const [,id,rhs]=assignment; assert(!values.has(id)&&!pointers.has(id),'Duplicate SSA definition');
    let result,type;
    if((m=rhs.match(/^bitcast .*addrspace\(1\)\* (%[\w.]+) to .*addrspace\(1\)\*$/))) {
      assert(pointers.has(m[1]),'Unknown bitcast pointer');pointers.set(id,pointers.get(m[1]));continue;
    }
    if((m=rhs.match(new RegExp(`^getelementptr inbounds (${integer}), .*addrspace\\(1\\)\\* (%[\\w.]+), i(?:32|64) (\\d+)$`)))) {
      const p=pointers.get(m[2]),s=shape(m[1]);assert(p,'Unknown GEP pointer');
      assert(s.bits%8===0);pointers.set(id,{buffer:p.buffer,offset:p.offset+Number(m[3])*(s.lanes===3?4:s.lanes)*s.bits/8});continue;
    }
    if((m=rhs.match(new RegExp(`^load volatile (${integer}), .*addrspace\\(1\\)\\* (%[\\w.]+), align \\d+(?:, ![\\w.]+ !\\d+)*$`)))) {
      type=m[1];const s=shape(type),p=pointers.get(m[2]);assert(p&&p.buffer==='input','Wrong input pointer');
      assert(p.offset+s.lanes*s.bits/8<=inputBytes.length,'Read outside input');result=fromBytes(inputBytes.slice(p.offset,p.offset+s.lanes*s.bits/8),s.bits);
    } else if((m=rhs.match(/^(and|or|xor|shl|lshr|ashr|add|sub|mul) ((?:(?:nuw|nsw|exact) )*)(.+)$/))) {
      const args=split(m[3]),a=typed(args[0]);type=a.type;const bits=shape(type).bits;
      result=map(get(a.value,type),get(args[1],type),(x,y)=>{
        if(['shl','lshr','ashr'].includes(m[1])&&y>=BigInt(bits))return undefined;
        if(m[2].includes('exact')&&(x&((1n<<y)-1n))!==0n)return undefined;
        const result={and:()=>x&y,or:()=>x|y,xor:()=>x^y,shl:()=>x<<y,lshr:()=>x>>y,ashr:()=>BigInt.asIntN(bits,x)>>y,add:()=>x+y,sub:()=>x-y,mul:()=>x*y}[m[1]]();
        if(m[2].includes('nuw')&&(result<0n||result>=(1n<<BigInt(bits))))return undefined;
        if(m[2].includes('nsw')) {
          const a=BigInt.asIntN(bits,x),b=BigInt.asIntN(bits,y);
          const signed={add:()=>a+b,sub:()=>a-b,mul:()=>a*b,shl:()=>a<<y}[m[1]];
          assert(signed,'Unsupported nsw operation');
          if(signed()!==BigInt.asIntN(bits,signed()))return undefined;
        }
        return result;
      });
    } else if((m=rhs.match(new RegExp(`^(zext|sext|trunc) (.+) to (${integer})$`)))) {
      const a=typed(m[2]);type=m[3];assert.equal(shape(a.type).lanes,shape(type).lanes);
      assert((m[1]==='trunc')===(shape(a.type).bits>shape(type).bits),'Invalid integer cast');
      result=get(a.value,a.type).map(x=>{return x===undefined?undefined:m[1]==='sext'?BigInt.asIntN(shape(a.type).bits,x):x;});
    } else if((m=rhs.match(new RegExp(`^bitcast (.+) to (${integer})$`)))) {
      const a=typed(m[1]);type=m[2];const bytes=integerBytes(get(a.value,a.type),shape(a.type).bits);
      assert.equal(bytes.length,shape(type).lanes*shape(type).bits/8);result=fromBytes(bytes,shape(type).bits);
    } else if((m=rhs.match(/^extractelement (.+)$/))) {
      const args=split(m[1]),a=typed(args[0]),lane=Number(read(args[1])[0]);type=`i${shape(a.type).bits}`;
      assert(lane>=0&&lane<shape(a.type).lanes,'Invalid extraction lane');result=[get(a.value,a.type)[lane]];
    } else if((m=rhs.match(/^insertelement (.+)$/))) {
      const args=split(m[1]),a=typed(args[0]),lane=Number(read(args[2])[0]);type=a.type;
      result=[...get(a.value,type)];assert(lane>=0&&lane<result.length,'Invalid insertion lane');result[lane]=read(args[1])[0];
    } else if((m=rhs.match(/^shufflevector (.+)$/))) {
      const args=split(m[1]),a=typed(args[0]),lanes=[...read(args[0]),...read(args[1])],mask=read(args[2]);type=`<${mask.length} x i${shape(a.type).bits}>`;
      result=mask.map(x=>{if(x===undefined)return undefined;assert(x<BigInt(lanes.length),'Invalid shuffle lane');return lanes[Number(x)];});
    } else assert.fail(`Unsupported integer instruction: ${rhs}`);
    const s=shape(type);assert.equal(result.length,s.lanes);
    values.set(id,result.map(x=>x===undefined?undefined:BigInt.asUintN(s.bits,x)));
  }
  assert(returned,'Missing integer kernel return');
  assert.equal(written.size,outputSize,'Missing output bytes');return output;
}
