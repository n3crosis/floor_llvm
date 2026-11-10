// Bounded evaluator for straight-line optimized common-function test kernels.
// This checks emitted AIR dataflow, not execution on Metal or an IEEE FMA oracle.
import assert from 'node:assert/strict';
const shape=t=>({width:Number(t.match(/^<(\d+)/)?.[1]??1),element:t.match(/float|i32|i1/)[0]});
const split=s=>{let depth=0,start=0,out=[];for(let i=0;i<s.length;i++){if(s[i]==='<')depth++;if(s[i]==='>')depth--;if(s[i]===','&&depth===0){out.push(s.slice(start,i).trim());start=i+1;}}out.push(s.slice(start).trim());return out;};
const typed=s=>{const m=s.match(/^(float|i32|i1|<\d+ x (?:float|i32|i1)>) (.+)$/);assert(m,`Unsupported typed value: ${s}`);return {type:m[1],value:m[2],...shape(m[1])};};
const buffer=new ArrayBuffer(4),f32=new Float32Array(buffer),i32=new Int32Array(buffer);
export const floatBits=x=>{f32[0]=x;return i32[0];};
export const bitsFloat=x=>{i32[0]=x;return f32[0];};

export function evaluateCommonKernel(body,width,inputs) {
  const stride=width===3?4:width;
  const memory=inputs.flatMap(v=>[...v,...Array(stride-v.length).fill(undefined)]);
  const values=new Map(),pointers=new Map([['%a',0]]),outputs=[];
  const get=(value,type)=>{
    const {width:n}=shape(type);
    if(value.startsWith('%')) {const r=values.get(value);assert(r,`Undefined SSA value ${value}`);assert.equal(r.length,n,'SSA width mismatch');return r;}
    if(value==='undef'||value==='poison')return Array(n).fill(undefined);
    if(value==='zeroinitializer')return Array(n).fill(0);
    if(value.startsWith('<')) {const r=split(value.slice(1,-1)).map(v=>{const t=typed(v);return get(t.value,t.type)[0];});assert.equal(r.length,n,'Constant width mismatch');return r;}
    if(value==='true'||value==='false')return [Number(value==='true')];
    assert(n===1&&Number.isFinite(Number(value)),`Unsupported constant ${value}`);return [Number(value)];
  };
  const read=s=>{const t=typed(s);return get(t.value,t.type);};
  const map=(a,b,fn)=>{assert.equal(a.length,b.length,'Operand width mismatch');return a.map((x,i)=>x===undefined||b[i]===undefined?undefined:fn(x,b[i]));};
  let returned=false,sawInstruction=false,sawLabel=false;
  for(const line of body.split('\n')) {
    const trimmed=line.trim();
    if(!trimmed||trimmed.startsWith(';')||trimmed==='}'||trimmed.startsWith('define void @'))continue;
    assert(!returned,'Instruction after common-kernel return');
    if(trimmed==='entry:'){assert(!sawLabel&&!sawInstruction,'Unexpected common-kernel block');sawLabel=true;continue;}
    if(trimmed==='ret void'){returned=true;continue;}
    sawInstruction=true;
    const store=trimmed.match(/^store (.*?), (?:float|<\d+ x float>) addrspace\(1\)\* (%[\w.]+),/);
    if(store){assert.equal(store[2],'%b','Wrong common output destination');outputs.push(read(store[1]));continue;}
    const assignment=line.match(/^\s*(%[\w.]+) = (.*)$/);assert(assignment,`Unsupported common-kernel control flow or side effect: ${trimmed}`);
    const [,id,raw]=assignment;
    const rhs=raw.replace(/\b(?:fast|reassoc|nnan|ninf|nsz|arcp|contract|afn) /g,'');
    let m,result;
    if((m=rhs.match(/^bitcast .*addrspace\(1\)\* (%[\w.]+) to .*addrspace\(1\)\*$/))) {
      assert(pointers.has(m[1]),'Unknown input pointer');pointers.set(id,pointers.get(m[1]));continue;
    }
    if((m=rhs.match(/^getelementptr inbounds (float|<\d+ x float>), .*addrspace\(1\)\* (%[\w.]+), i32 (\d+)$/))) {
      assert(pointers.has(m[2]),'Unknown input pointer');const n=shape(m[1]).width;pointers.set(id,pointers.get(m[2])+Number(m[3])*(n===3?4:n));continue;
    }
    if((m=rhs.match(/^load (float|<\d+ x float>), .*addrspace\(1\)\* (%[\w.]+),/))) {
      assert(pointers.has(m[2]),'Unknown load pointer');result=Array.from({length:shape(m[1]).width},(_,i)=>memory[pointers.get(m[2])+i]);
    } else if((m=rhs.match(/^extractelement (.*)$/))) {
      const fields=split(m[1]);result=[read(fields[0])[read(fields[1])[0]]];
    } else if((m=rhs.match(/^insertelement (.*)$/))) {
      const fields=split(m[1]);result=[...read(fields[0])];const lane=read(fields[2])[0];assert(lane<result.length,'Bad insertion lane');result[lane]=read(fields[1])[0];
    } else if((m=rhs.match(/^shufflevector (.*)$/))) {
      const fields=split(m[1]),lanes=[...read(fields[0]),...read(fields[1])];result=read(fields[2]).map(i=>i===undefined?undefined:lanes[i]);
    } else if((m=rhs.match(/^bitcast (.*) to (float|i32|<\d+ x (?:float|i32)>)$/))) {
      const from=typed(m[1]),to=shape(m[2]);assert.equal(from.width,to.width,'Unsupported bitcast width');result=get(from.value,from.type).map(x=>x===undefined?undefined:from.element===to.element?x:from.element==='float'?floatBits(x):bitsFloat(x));
    } else if((m=rhs.match(/^(fsub|fadd|fmul|fdiv|and|or) (.*)$/))) {
      const fields=split(m[2]),a=typed(fields[0]),b=get(fields[1],a.type);
      const fn={fsub:(x,y)=>Math.fround(x-y),fadd:(x,y)=>Math.fround(x+y),fmul:(x,y)=>Math.fround(x*y),fdiv:(x,y)=>Math.fround(x/y),and:(x,y)=>x&y,or:(x,y)=>x|y}[m[1]];
      result=map(get(a.value,a.type),b,fn);
    } else if((m=rhs.match(/^fneg (.*)$/))) result=read(m[1]).map(x=>x===undefined?undefined:-x);
    else if((m=rhs.match(/^(fcmp|icmp) (olt|oge|ogt|uge|eq|ugt) (.*)$/))) {
      const fields=split(m[3]),a=typed(fields[0]);
      const comparisons=m[1]==='fcmp'?{olt:(x,y)=>x<y,oge:(x,y)=>x>=y,ogt:(x,y)=>x>y,uge:(x,y)=>!(x<y)}:{eq:(x,y)=>x===y,ugt:(x,y)=>(x>>>0)>(y>>>0)};
      const compare=comparisons[m[2]];assert(compare,`Unsupported ${m[1]} predicate ${m[2]}`);
      assert.equal(a.element,m[1]==='fcmp'?'float':'i32','Wrong comparison operand type');
      result=map(get(a.value,a.type),get(fields[1],a.type),(x,y)=>Number(compare(x,y)));
    } else if((m=rhs.match(/^select (.*)$/))) {
      const fields=split(m[1]),condition=read(fields[0]),yes=read(fields[1]),no=read(fields[2]);
      assert.equal(condition.length,yes.length,'Select width mismatch');assert.equal(yes.length,no.length,'Select width mismatch');result=condition.map((x,i)=>x===undefined?undefined:x?yes[i]:no[i]);
    } else if((m=rhs.match(/^(?:tail )?call .*@air\.(fma|fast_fmax)\.(?:f32|v[234]f32)\((.*)\)(?: #\d+)?$/))) {
      const args=split(m[2]).map(read);
      if(m[1]==='fma'){assert.equal(args.length,3);result=map(args[0],args[1],(x,y)=>x*y);result=map(result,args[2],(x,y)=>Math.fround(x+y));}
      else {assert.equal(args.length,2);result=map(args[0],args[1],Math.max);}
    } else assert.fail(`Unsupported common-kernel instruction: ${rhs}`);
    values.set(id,result);
  }
  assert(returned,'Missing common-kernel return');
  assert.equal(outputs.length,1,'Missing or duplicate common output store');
  assert.equal(outputs[0].length,width,'Wrong output width');
  assert(outputs[0].every(x=>x!==undefined),'Undefined stored lane');return outputs[0];
}

export function checkCommonDataflow(body,op,n,math) {
  const slice=values=>values.slice(0,n);
  const triples=[
    [[-2,4,8,-8],[6,-4,-8,8],[0,1,0.25,0.75]],
    [[-4,-3,2,5],[4,5,6,9],[-8,0,4,10]],
    [[-4,-3,2,5],[4,5,6,9],[-4,-1,5,9]],
    [[0,1,-2,4],[-1,1,2,3],[0.5,0.25,0.75,1]],
    [[-3.25,0.5,-0.7,0.125],[4.75,3.5,6.3,5.125],[0.1,0.2,0.3,0.7]],
    [[-3,0,-1,0.25],[4,3,6,5.25],[-0.5,0.7,3.4,4.5]],
  ];
  if(op==='sign') {
    for(const bits of [[0,-2147483648,1,-2147483647],[2139095040,-8388608,2143289345,-4194303],[2139095041,-8388607,1065353216,-1082130432]]) {
      for(let rotation=0;rotation<4;rotation++){const rotated=[...bits.slice(rotation),...bits.slice(0,rotation)];
      const input=slice(rotated.map(bitsFloat)),actual=evaluateCommonKernel(body,n,[input]);
      const expected=slice(rotated).map(b=>(b&0x7fffffff)===0?b:(b&0x7fffffff)>0x7f800000?0:(b&0x80000000)|0x3f800000);
      assert.deepEqual(actual.map(floatBits),expected,'Wrong sign lane/signed zero/NaN dataflow');}
    }return;
  }
  if(op==='step'&&math===0) triples.push([[0,0,-0,0],[NaN,-NaN,0,-0],[0,0,0,0]],[[NaN,-NaN,0,-0],[0,0,-0,0],[0,0,0,0]]);
  for(const values of triples) for(let rotation=0;rotation<4;rotation++){
    const triple=values.map(v=>[...v.slice(rotation),...v.slice(0,rotation)]);
    if(op==='mix'&&triple[2].some(v=>v<0||v>1))continue;
    if(op==='smoothstep'&&triple[0].some((v,i)=>v>=triple[1][i]))continue;
    const input=triple.map(v=>slice(v).map(Math.fround)),actual=evaluateCommonKernel(body,n,input);
    const expected=input[0].map((x,i)=>{const y=input[1][i],a=input[2][i];if(op==='mix')return x+(y-x)*a;if(op==='step')return y<x?0:1;const t=Math.max(0,Math.min(1,(a-x)/(y-x)));return t*t*(3-2*t);});
    for(let i=0;i<n;i++)assert(Number.isFinite(actual[i])&&Math.abs(actual[i]-expected[i])<=1e-6*Math.max(1,Math.abs(expected[i])),`${op}: wrong result at lane ${i}`);
  }
}
