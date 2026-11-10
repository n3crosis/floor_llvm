// Authored MSL 4.1 section 6.4, Table 6.2, pp. 202-203 probes.
// https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf
// All reference results use a bit-list oracle, not the header's mask algorithm.
import assert from 'node:assert/strict';
import {evaluateBitInterleaveKernel,integerBytes} from './msl41-bit-interleave-ir.mjs';
import {assertBitInterleaveABI,assertBitInterleaveMode} from './msl41-bit-interleave-abi.mjs';
const header='#include <metal_stdlib>\nusing namespace metal;\n';
export const bitInterleaveTypes=[{bits:8,narrow:'uchar',wide:'ushort'},{bits:16,narrow:'ushort',wide:'uint'},{bits:32,narrow:'uint',wide:'ulong'}];
const bitList=(value,bits)=>{
  assert(typeof value==='bigint'&&value>=0n&&value<(1n<<BigInt(bits)),'Oracle operand out of range');
  return value.toString(2).padStart(bits,'0').split('').reverse();
};
const fromBitList=bits=>BigInt('0b'+[...bits].reverse().join(''));
export function bitListInterleave(even,odd,bits) {
  const a=bitList(even,bits),b=bitList(odd,bits);
  return fromBitList(a.flatMap((x,i)=>[x,b[i]]));
}
export function bitListDeinterleave(value,bits) {
  const all=bitList(value,2*bits);
  return [0,1].map(parity=>fromBitList(all.filter((_,i)=>i%2===parity)));
}
const pseudoRandom=seed=>()=>{seed=BigInt.asUintN(64,seed*6364136223846793005n+1442695040888963407n);return seed;};
export function bitInterleaveInputs(bits,randomCount=32) {
  const max=(1n<<BigInt(bits))-1n,top=1n<<BigInt(bits-1),even=fromBitList(Array.from({length:bits},(_,i)=>i%2?'0':'1'));
  const pairs=[[0n,0n],[max,0n],[0n,max],[max,max],[1n,0n],[0n,1n],[top,0n],[0n,top],[even,max^even],[max^even,even],[top,1n],[1n,top]];
  // Every source bit is isolated in both operand/lane positions.
  for(let i=0;i<bits;i++) {const bit=1n<<BigInt(i);pairs.push([bit,0n],[0n,bit]);}
  const next=pseudoRandom(0x4d534c3431n+BigInt(bits));
  for(let i=0;i<randomCount;i++)pairs.push([next()&max,next()&max]);
  const wideMax=(1n<<BigInt(2*bits))-1n;
  const words=[0n,wideMax,wideMax/3n,2n*(wideMax/3n),1n,1n<<BigInt(2*bits-1)];
  for(let i=0;i<2*bits;i++)words.push(1n<<BigInt(i));
  for(let i=0;i<randomCount;i++)words.push(next()&wideMax);
  return {pairs,words};
}
const constantInputs=bits=>{
  const all=bitInterleaveInputs(bits);
  return {pairs:[...all.pairs.slice(0,12),...all.pairs.slice(-4)],words:[...all.words.slice(0,6),...all.words.slice(-4)]};
};
const literal=(value,type)=>`${type}(0x${value.toString(16)}ul)`;
const expression=(form,narrow,values)=>form==='scalar'?`interleave(${values.map(v=>literal(v,narrow)).join(',')})`:
  form==='vector'?`interleave(${narrow}2(${values.map(v=>literal(v,narrow)).join(',')}))`:null;
export function makeBitInterleaveSource({bits,narrow,wide},form,mode) {
  const output=form==='deinterleave'?`${narrow}2`:wide,input=form==='vector'?`${narrow}2`:form==='scalar'?narrow:wide;
  const dynamic=form==='scalar'?'interleave(a[0],a[1])':`${form==='vector'?'interleave':'deinterleave'}(a[0])`;
  const samples=constantInputs(bits);
  const calls=mode==='dynamic'?[dynamic]:form==='deinterleave'?samples.words.map(v=>`deinterleave(${literal(v,wide)})`):samples.pairs.map(v=>expression(form,narrow,v));
  const name=`msl41_${form}_${mode}_${bits}`;
  return header+`kernel void ${name}(${mode==='dynamic'?`device const volatile ${input}* a [[buffer(0)]],`:''}device volatile ${output}* b [[buffer(1)]]){\n`+
    `static_assert(__is_same(decltype(${calls[0]}),${output}),"exact Table 6.2 result");\n`+
    calls.map((call,i)=>`b[${i}]=${call};`).join('\n')+'\n}\n';
}
export const msl41BitInterleaveCases=[];
for(const types of bitInterleaveTypes)for(const form of ['scalar','vector','deinterleave'])for(const mode of ['dynamic','constants'])for(const math of [0,1])for(const kind of [0,1]){
  msl41BitInterleaveCases.push({name:`msl41-bit-${form}-${mode}-${types.bits}-math${math}-kind${kind}`,source:makeBitInterleaveSource(types,form,mode),api:3,metalVersion:410,ios:27,math,kind,status:0,msl41BitInterleave:true,bitInterleaveBits:types.bits,bitInterleaveForm:form,bitInterleaveMode:mode});
}
const reject=(name,call,extra={})=>msl41BitInterleaveCases.push({name:`reject-msl41-bit-${name}`,source:header+`kernel void bad(device uint* b [[buffer(0)]]){(void)${call};b[0]=0u;}\n`,api:3,metalVersion:410,ios:27,math:0,kind:1,status:3,msl41BitInterleave:true,...extra});
for(const type of ['char','short','int','long','ulong','half','float','bool']) reject(`pair-${type}`,`interleave(${type}(1),${type}(2))`);
for(const type of ['char2','short2','int2','long2','ulong2','half2','float2','uchar3','uchar4','ushort3','ushort4','uint3','uint4']) reject(`vector-${type}`,`interleave(${type}(1))`);
for(const type of ['uchar','char','short','int','long','half','float','bool','ushort2','uint2','ulong2','ushort3','uint3','ulong4']) reject(`deinterleave-${type}`,`deinterleave(${type}(1))`);
for(const [a,b] of [['uchar','ushort'],['ushort','uchar'],['ushort','uint'],['uint','ushort'],['uchar','char'],['uint','int'],['uchar2','uchar2'],['ushort2','ushort2'],['uint2','uint2']])reject(`mixed-${a}-${b}`,`interleave(${a}(1),${b}(2))`);
for(const type of ['uchar','ushort','uint'])reject(`single-${type}`,`interleave(${type}(1))`);
reject('three-arguments','interleave(uchar(1),uchar(2),uchar(3))');
reject('deinterleave-two-arguments','deinterleave(ushort(1),ushort(2))');
// Each exact signature must be unavailable under 3.2 and 4.0, including
// legacy API entrypoints whose language mode is preserved at 3.2.
for(const options of [{api:3,ios:18,metalVersion:320},{api:3,ios:26,metalVersion:400},{api:1,ios:18},{api:2,ios:26}])
  for(const types of bitInterleaveTypes)for(const form of ['scalar','vector','deinterleave']) {
    const call=form==='deinterleave'?`deinterleave(${types.wide}(1))`:expression(form,types.narrow,[1n,2n]);
    reject(`gate-api${options.api}-metal${options.metalVersion??320}-${form}-${types.bits}`,call,{...options,metalVersion:options.metalVersion,bitInterleaveGate:true});
  }

// Release qualification requires the real selected language/target and ABI.
export function assertMSL41BitInterleaveIR(ir,test) {
  assertBitInterleaveMode(ir,test);
  assertMSL41BitInterleaveArithmeticIR(ir,test);
}
// Explicitly separate old-runtime, appended-definition preflight. This checks
// actual ABI and arithmetic but does not claim 4.1 mode or target support.
export function assertMSL41BitInterleaveArithmeticIR(ir,test) {
  assert.equal(test.msl41BitInterleave,true);assert.equal(test.status,0);assert.equal(test.kind,1);
  assert.equal(test.api,3);assert.equal(test.metalVersion,410);assert.equal(test.ios,27);
  assert(typeof ir==='string'&&ir.length>0&&ir.length<2*1024*1024,'Invalid bit interleave IR size');
  assertBitInterleaveABI(ir,test);
  assert(!/\b(?:call|invoke|callbr)\b/.test(ir),'Unresolved helper, intrinsic, or invented AIR call');
  assert(!/\b(?:float|double|half|fptrunc|fpext|fptoui|fptosi|uitofp|sitofp)\b/.test(ir),'Integer helper converted through float');
  const {bitInterleaveBits:bits,bitInterleaveForm:form,bitInterleaveMode:mode}=test;
  assert([8,16,32].includes(bits)&&['scalar','vector','deinterleave'].includes(form)&&['dynamic','constants'].includes(mode));
  const bodies=[...ir.matchAll(/define void @([\w.]+)\([^]*?\n}/g)];
  assert.equal(bodies.length,1,'Unexpected/missing integer kernel');
  const [body,name]=bodies[0];assert.equal(name,`msl41_${form}_${mode}_${bits}`,'Wrong bit interleave kernel');
  const inputs=mode==='dynamic'?bitInterleaveInputs(bits):constantInputs(bits);
  const values=form==='deinterleave'?inputs.words:inputs.pairs;
  const expected=value=>form==='deinterleave'?integerBytes(bitListDeinterleave(value,bits),bits):integerBytes([bitListInterleave(...value,bits)],2*bits);
  if(mode==='constants') {
    const bytes=values.flatMap(expected);
    assert.deepEqual(evaluateBitInterleaveKernel(body,[],bytes.length),bytes,'Wrong folded bit/lane order');
  } else for(const value of values) {
    const bytes=expected(value),input=integerBytes(form==='deinterleave'?[value]:value,form==='deinterleave'?2*bits:bits);
    assert.deepEqual(evaluateBitInterleaveKernel(body,input,bytes.length),bytes,`Wrong dynamic ${form} ${bits}-bit value ${value}`);
  }
}
