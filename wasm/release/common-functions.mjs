// Authored float common-function coverage, MSL 4.1 section 6.3, Table 6.1.
// Compile/IR checks do not establish numerical acceptance on an Apple GPU.
import assert from 'node:assert/strict';
import {checkCommonDataflow} from './common-functions-ir.mjs';
const header='#include <metal_stdlib>\nusing namespace metal;\n';
const ops=['mix','step','smoothstep','sign'];
const widths=[1,2,3,4];
const type=n=>n===1?'float':`float${n}`;
const utype=n=>n===1?'uint':`uint${n}`;
const argumentsFor=op=>op==='sign'?'a[0]':op==='step'?'a[0],a[1]':'a[0],a[1],a[2]';
const literal=(n,values)=>n===1?values[0]:`${type(n)}(${values.slice(0,n).join(',')})`;
const bits=(n,values)=>`as_type<${type(n)}>(${n===1?values[0]:`${utype(n)}(${values.slice(0,n).join(',')})`})`;
export const commonDynamicSource=header+ops.flatMap(op=>widths.map(n=>
  `kernel void common_${op}_${n}(device const ${type(n)}* a [[buffer(0)]],device ${type(n)}* b [[buffer(1)]]){static_assert(__is_same(decltype(${op}(${argumentsFor(op)})),${type(n)}),"type");b[0]=${op}(${argumentsFor(op)});}`
)).join('\n');

export const commonConstantSources={};
for(const n of widths) {
  const x=literal(n,['-2.0f','4.0f','8.0f','-8.0f']);
  const y=literal(n,['6.0f','-4.0f','-8.0f','8.0f']);
  const a=literal(n,['0.0f','1.0f','0.25f','0.75f']);
  const edge=literal(n,['0.0f','1.0f','-2.0f','4.0f']);
  const point=literal(n,['-1.0f','1.0f','2.0f','3.0f']);
  const smooth=literal(n,['-1.0f','0.25f','0.75f','2.0f']);
  const calls=[`mix(${x},${y},${a})`,`step(${edge},${point})`,`smoothstep(${type(n)}(0.0f),${type(n)}(1.0f),${smooth})`,
    ...[['0x00000000u','0x80000000u','0x00000001u','0x80000001u'],
        ['0x7f800000u','0xff800000u','0x7fc00001u','0xffc00001u'],
        ['0x7f800001u','0xff800001u','0x3f800000u','0xbf800000u']].map(v=>`sign(${bits(n,v)})`)];
  commonConstantSources[`constants${n}`]=header+`kernel void common_constants_${n}(device volatile ${utype(n)}* b [[buffer(0)]]){${calls.map((call,i)=>`b[${i}]=as_type<${utype(n)}>(${call});`).join('')}}`;
}
// The ordered comparison in step returns 1 for unordered inputs when fast
// math is disabled. NaN inputs are not promised under the relaxed profile.
export const commonStepSpecialSource=header+`kernel void common_step_special(device volatile uint4* b [[buffer(0)]]){float4 x=as_type<float4>(uint4(0x7fc00001u,0xffc00001u,0x80000000u,0u));b[0]=as_type<uint4>(step(float4(0.0f),x));b[1]=as_type<uint4>(step(x,float4(0.0f)));}`;
export const commonFunctionCases=[];
for(const ios of [18,26]) for(const math of [0,1]) for(const kind of [0,1]) {
  for(const [mode,source] of Object.entries({dynamic:commonDynamicSource,...commonConstantSources}))
    commonFunctionCases.push({name:`common-${mode}-ios${ios}-math${math}-kind${kind}`,source,ios,math,kind,status:0,commonFunctions:true,commonMode:mode});
  if(math===0) commonFunctionCases.push({name:`common-step-special-ios${ios}-kind${kind}`,source:commonStepSpecialSource,ios,math,kind,status:0,commonFunctions:true,commonMode:'step-special'});
}
for(const op of ops) for(const [i,t] of ['int','uint','half','half2','int3'].entries()) {
  const args=Array(op==='sign'?1:op==='step'?2:3).fill(`${t}(1)`).join(',');
  commonFunctionCases.push({name:`reject-common-${op}-${t}`,source:header+`kernel void bad(device float* b [[buffer(0)]]){auto r=${op}(${args});b[0]=0.0f;}`,ios:i%2?26:18,math:i%2,kind:1,status:3,commonFunctions:true});
}
for(const [op,args] of [['mix','float2(0),float2(1),half2(0)'],['step','float2(0),int2(1)'],['smoothstep','float2(0),float2(1),half2(0)']])
  commonFunctionCases.push({name:`reject-common-${op}-mixed`,source:header+`kernel void bad(device float2* b [[buffer(0)]]){b[0]=${op}(${args});}`,ios:26,math:0,kind:1,status:3,commonFunctions:true});
for(const [op,argumentsByMode] of [
  ['mix',['float2(0),float2(1),float(0)','float2(0),float3(1),float2(0)','float(0),float(1),half(0)']],
  ['step',['float2(0),float(1)','float2(0),float3(1)','float(0),half(1)']],
  ['smoothstep',['float2(0),float2(1),float(0)','float2(0),float3(1),float2(0)','float(0),float(1),half(0)']],
])for(const [i,args] of argumentsByMode.entries())
  commonFunctionCases.push({name:`reject-common-${op}-${['scalar-vector','vector-width','scalar-half'][i]}`,source:header+`kernel void bad(device float* b [[buffer(0)]]){auto r=${op}(${args});b[0]=0.0f;}`,ios:18,math:0,kind:1,status:3,commonFunctions:true});

const f32bits=x=>{const a=new Float32Array([x]);return new Uint32Array(a.buffer)[0]|0;};
const expectedConstants=[[-2,-4,4,4].map(f32bits),[0,1,1,0].map(f32bits),[0,0.15625,0.84375,1].map(f32bits),
  [0,-2147483648,1065353216,-1082130432],[1065353216,-1082130432,0,0],[0,0,1065353216,-1082130432]];
export function assertCommonFunctionIR(ir,test) {
  assert(test.commonFunctions&&test.status===0&&test.kind===1,'Not a successful common-function IR case');
  assert(typeof ir==='string'&&ir.length>0&&ir.length<2*1024*1024,'Invalid common IR size');
  assert.match(ir,/!air\.kernel = !\{/,'Missing kernel metadata');
  assert(!/call[^\n]*@(?:_Z|llvm\.)/.test(ir),'Unresolved helper or LLVM intrinsic');
  assert(!/\b(?:sito|uito)fp\b|\bfpto(?:si|ui)\b/.test(ir),'Unexpected numeric integer/float conversion');
  if(test.commonMode==='dynamic') assertDynamicIR(ir,test);
  else {
    const n=test.commonMode==='step-special'?4:Number(test.commonMode.replace('constants',''));
    assert(widths.includes(n),'Unknown common constant mode');
    const entry=test.commonMode==='step-special'?'common_step_special':`common_constants_${n}`;
    const body=bodyFor(ir,entry);
    const ty=n===1?'i32':`<${n} x i32>`;
    let returned=false,sawLabel=false,sawInstruction=false;
    for(const line of body.split('\n')) {
      const text=line.trim();
      if(!text||text.startsWith(';')||text==='}'||text.startsWith('define void @'))continue;
      assert(!returned,'Constant instruction after return');
      if(text==='entry:'){assert(!sawLabel&&!sawInstruction,'Unexpected constant block');sawLabel=true;continue;}
      if(text==='ret void'){returned=true;continue;}
      sawInstruction=true;
      assert(new RegExp(`^(?:store volatile ${ty} .*?, ${ty} addrspace\\(1\\)\\* %[\\w.]+, align \\d+(?:, ![\\w.]+ !\\d+)*|%[\\w.]+ = getelementptr inbounds ${ty}, ${ty} addrspace\\(1\\)\\* %b, i32 \\d+)$`).test(text),'Unexpected constant instruction/control flow');
    }
    assert(returned,'Missing constant kernel return');
    const stores=[...body.matchAll(new RegExp(`store volatile ${ty} (.*?), ${ty} addrspace\\(1\\)\\* (%[\\w.]+)`, 'g'))];
    const destinations=new Map([['%b',0],...[...body.matchAll(new RegExp(`(%[\\w.]+) = getelementptr inbounds ${ty}, ${ty} addrspace\\(1\\)\\* %b, i32 (\\d+)`, 'g'))].map(m=>[m[1],Number(m[2])])]);
    const expected=test.commonMode==='step-special'?Array(2).fill(Array(4).fill(1065353216)):expectedConstants.map(v=>v.slice(0,n));
    assert.equal(stores.length,expected.length,`${entry}: missing output store`);
    for(const [i,values] of expected.entries()) {
      const constant=n===1?String(values[0]):values.every(v=>v===0)?'zeroinitializer':`<${values.map(v=>`i32 ${v}`).join(', ')}>`;
      assert.equal(stores[i][1],constant,`${entry}: wrong constant output ${i}`);
      assert.equal(destinations.get(stores[i][2]),i,`${entry}: wrong constant destination ${i}`);
    }
  }
}
function bodyFor(ir,name) {
  const matches=[...ir.matchAll(new RegExp(`^define void @${name}\\([^]*?\\n}`,'gm'))];
  assert.equal(matches.length,1,`Missing or duplicate ${name}`);return matches[0][0];
}
function assertDynamicIR(ir,test) {
  for(const op of ops) for(const n of widths) {
    const entry=`common_${op}_${n}`,body=bodyFor(ir,entry);
    checkCommonDataflow(body,op,n,test.math);
    assert.match(body,/\bstore\b/,`${entry}: missing output`);
    if(test.math===0) assert(!/\b(?:fadd|fsub|fmul|fdiv|fneg|fcmp|select|call) (?:contract )*(?:fast|reassoc|nnan|ninf|nsz|arcp|afn)\b/.test(body),`${entry}: unsolicited fast math`);
    if(op==='sign') {
      assert(!/\bfcmp\b/.test(body),`${entry}: sign must not depend on NaN float comparisons`);
      for(const value of ['2147483647','2139095040','-2147483648','1065353216']) assert(body.includes(value),`${entry}: missing binary32 mask ${value}`);
    } else if(op==='step') assert.match(body,/\bfcmp (?:[a-z]+ )*(?:olt|uge)\b/,`${entry}: wrong ordered threshold`);
    else {
      for(const instruction of ['fsub',...(op==='mix'?[]:['fmul','fdiv'])]) assert(new RegExp(`\\b${instruction}\\b`).test(body),`${entry}: missing ${instruction}`);
    }
  }
}
