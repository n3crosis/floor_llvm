// Standalone authored Metal4.1 placement GPU contract. No compiler or GPU is
// invoked by this module; original Apple/FLOOR binaries are supplied separately.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export const suite='floor-metal41-placement-gpu-v1';
export const layout=Object.freeze({itemBytes:8,itemAlignment:4,arenaBytes:64,placementByteOffset:16,traceWords:16,snapshotWords:16,outputWords:40,outputBindingByteOffset:16,inputWords:6,threadgroupBytes:64});
export const cases=Object.freeze(['thread','threadgroup','device'].flatMap(space=>['scalar','array'].map(form=>({name:`placement_gpu_${space}_${form}`,space,form,count:form==='array'?2:1}))));
const type=space=>`Item_${space}`;
const sourceFor=c=>{
  const T=type(c.space), A=c.space, array=c.count===2;
  const storage=A==='thread'?'alignas(4) thread uchar arena[64];':A==='threadgroup'?'':'', parameter=A==='thread'?'':`, ${A} uchar* arena [[${A==='threadgroup'?'threadgroup(0)':'buffer(2)'}]]`;
  return `kernel void ${c.name}(device const uint* input [[buffer(0)]], device uint* out [[buffer(1)]]${parameter}) {
  ${storage}
  // Exactly one thread is dispatched. Shared storage never has concurrent users.
  for(uint i=0;i<64;++i) arena[i]=uchar((i*37u)^input[0]^(input[5]>>8)^0x5au);
  ${A} uchar* base=arena+16;
  ${A} ${T}* p=new(base) ${A} ${T}${array?'[2]':'(input[0],input[1])'};
  out[0]=0x504c4143u; out[1]=${c.count}u; out[2]=p==(${A} ${T}*)base;
  out[3]=sizeof(${T}); out[4]=alignof(${T});
  out[5]=p[0].value; out[6]=p[0].stamp;
  out[7]=${array?'p[1].value':'0u'}; out[8]=${array?'p[1].stamp':'0u'};
  p[0].~${T}(); ${array?`p[1].~${T}();`:''}
  // Inspect only unsigned-char storage representation after lifetime ends.
  // Never access a dead Item's fields or call its members.
  out[9]=placement_word(base,0); out[10]=placement_word(base,4);
  out[11]=${array?'placement_word(base,8)':'0u'}; out[12]=${array?'placement_word(base,12)':'0u'};
  ${A} ${T}* a=new(base) ${A} ${T}(input[2],input[3]);
  ${array?`${A} ${T}* b=new(base+8) ${A} ${T}(input[4],input[5]);`:''}
  out[13]=a==(${A} ${T}*)base;
  out[14]=${array?`b==(${A} ${T}*)(base+8)`:'0u'};
  out[15]=a->value${array?' ^ b->value':''};
  a->~${T}(); ${array?`b->~${T}();`:''}
  for(uint i=0;i<16;++i) out[16+i]=placement_word(arena,i*4);
}
`;
};
const preamble=`// Original authored placement GPU probe. MSL4.1 / iOS27, conservative math.
// Input: six uint words. Output: 32 uint words; host guards precede/follow it.
// Arena: 64 bytes, placement starts at byte16. Payload is8 or16 bytes; all
// surrounding bytes are canaries. Extra suffix capacity safely catches old
// eight-byte cookie/pointer-adjustment regressions rather than overrunning storage.
#include <metal_stdlib>
using namespace metal;
`;
const recordFor=A=>`struct ${type(A)} {
  volatile uint value; volatile uint stamp;
  ${type(A)}() ${A} : value(0x13579bdfu), stamp(0x2468ace0u) {}
  ${type(A)}(uint v,uint s) ${A} : value(v), stamp(s) {}
  ~${type(A)}() ${A} { value=value^0xa5a5a5a5u; stamp=stamp+0x10203040u; }
};
static_assert(sizeof(${type(A)})==8 && alignof(${type(A)})==4,"placement record layout");
uint placement_word(const ${A} uchar* p,uint o) {
  return uint(p[o]) | (uint(p[o+1])<<8) | (uint(p[o+2])<<16) | (uint(p[o+3])<<24);
}
`;
export function sourceForCase(c) { assert(cases.some(x=>x.name===c.name)); return preamble+recordFor(c.space)+sourceFor(c); }
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const sourceIdentities=Object.fromEntries(cases.map(c=>[c.name,{sha256:sha256(sourceForCase(c)),bytes:Buffer.byteLength(sourceForCase(c))}]));
export function bindings(c) { return {inputBuffer:0,inputBytes:24,outputBuffer:1,outputBindingByteOffset:16,outputActiveBytes:128,outputAllocationBytes:160,arenaBuffer:c.space==='device'?2:null,arenaBytes:64,threadgroupIndex:c.space==='threadgroup'?0:null,threadgroupBytes:c.space==='threadgroup'?64:0,threadgroups:[1,1,1],threadsPerThreadgroup:[1,1,1]}; }
// Adapter contract for the existing compilation/entry metadata conventions.
// Use a separate GPU gate; never feed this into the integer/interleave harness.
export function placementGPUCases() { return cases.map(c=>({
  name:c.name,entry:c.name,source:sourceForCase(c),sourceSha256:sourceIdentities[c.name].sha256,
  status:0,kind:0,api:3,ios:27,metalVersion:410,math:0,
  feature:'msl41-placement-gpu',msl41PlacementGPU:true,
  placementSpace:c.space,placementForm:c.form,placementCount:c.count,bindings:bindings(c)
})); }
export function gpuArguments(c,{descriptor,source,apple,floor,output}) {
  const known=placementGPUCases().find(x=>x.name===c.name);assert(known,'Unknown placement GPU case');
  assert.deepEqual(c,known,'Placement GPU compile contract was changed');
  const args=['--descriptor',descriptor,'--source',source,'--apple',apple,'--floor',floor,'--output',output];
  args.forEach(x=>assert(typeof x==='string'&&x.length>0));return args;
}
export function inputs() {
  const all=[[0,0,0,0,0,0],[0xffffffff,0xffffffff,0xffffffff,0xffffffff,0xffffffff,0xffffffff],
    [0x80000000,0x7fffffff,1,0xffffffff,0xaaaaaaaa,0x55555555],[0x13579bdf,0x2468ace0,0xdeadbeef,0x10203040,0x01020304,0xfedcba98]];
  let state=0x41c0ffee;
  for(let i=0;i<8;i++) {const v=[];for(let j=0;j<6;j++){state=(Math.imul(state,1664525)+1013904223)>>>0;v.push(state);}all.push(v);}
  return all;
}
export function wordsToBytes(words) {const b=Buffer.alloc(words.length*4);words.forEach((v,i)=>b.writeUInt32LE(v>>>0,i*4));return b;}
export function initialOutput() {return wordsToBytes(Array.from({length:40},(_,i)=>(0x6a09e667^Math.imul(i+1,0x01020305))>>>0));}
export function expected(c,v) {
  assert(cases.some(x=>x.name===c.name&&x.count===c.count));assert.equal(v.length,6);v.forEach(x=>assert(Number.isInteger(x)&&x>=0&&x<=0xffffffff));
  const arena=Buffer.from(Array.from({length:64},(_,i)=>((i*37)^v[0]^(v[5]>>>8)^0x5a)&255));
  // CPU object-state model, independent of raw-pointer placement. Transitions
  // are record construction -> destruction -> replacement -> destruction.
  const first=Array.from({length:c.count},()=>c.count===2?{value:0x13579bdf,stamp:0x2468ace0}:{value:v[0],stamp:v[1]});
  const destroy=o=>({value:(o.value^0xa5a5a5a5)>>>0,stamp:(o.stamp+0x10203040)>>>0});
  const dead=first.map(destroy);
  const replacements=Array.from({length:c.count},(_,i)=>({value:v[2+2*i],stamp:v[3+2*i]}));
  replacements.map(destroy).forEach((o,i)=>{arena.writeUInt32LE(o.value,16+i*8);arena.writeUInt32LE(o.stamp,20+i*8);});
  const trace=[0x504c4143,c.count,1,8,4,first[0].value,first[0].stamp,first[1]?.value??0,first[1]?.stamp??0,dead[0].value,dead[0].stamp,dead[1]?.value??0,dead[1]?.stamp??0,1,c.count===2?1:0,(v[2]^(c.count===2?v[4]:0))>>>0];
  const output=initialOutput();wordsToBytes(trace).copy(output,16);arena.copy(output,80);
  return {trace,arena,output};
}
export function classify(apple,floor) {
  const observedFailure=[apple,floor].some(b=>['pipeline','execution','numerical'].some(stage=>['failed','timed_out','incomplete'].includes(b[stage])));
  if(observedFailure)return {status:'failed',exitCode:1};
  if(apple.load!=='passed')return {status:'unavailable',exitCode:77};
  if(floor.load!=='passed')return {status:'failed',exitCode:1};
  return [apple,floor].every(b=>b.pipeline==='passed'&&b.execution==='passed'&&b.numerical==='passed')?{status:'passed',exitCode:0}:{status:'failed',exitCode:1};
}
function boundedFile(path,max) {const info=lstatSync(path);assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=max,'Expected bounded regular file');const b=readFileSync(path);assert.equal(b.length,info.size);return b;}
export function descriptor(caseName,applePath,floorPath) {
  const c=cases.find(x=>x.name===caseName);assert(c,'Unknown placement case');
  const entry=p=>{const b=boundedFile(p,32*1024*1024);assert.equal(b.subarray(0,4).toString(),'MTLB','Not a metallib');return {sha256:sha256(b),bytes:b.length};};
  return {schema:1,suite,feature:"msl41-placement-gpu",case:c,source:sourceIdentities[c.name],bindings:bindings(c),target:{metalVersion:410,ios:27,mathProfile:0},apple:entry(applePath),floor:entry(floorPath)};
}
export function oracleFixture(){return {schema:1,suite,sourceIdentities,cases:cases.flatMap(c=>inputs().map((v,i)=>{const e=expected(c,v);return {name:c.name,trial:i,input:v,trace:e.trace,arenaHex:e.arena.toString('hex'),outputHex:e.output.toString('hex'),sha256:sha256(e.output)};}))};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [command,...args]=process.argv.slice(2);
  if(command==='source'&&args.length===2){const c=cases.find(x=>x.name===args[0]);assert(c,'Unknown case');writeFileSync(args[1],sourceForCase(c),{flag:'wx'});}
  else if(command==='oracle'&&args.length===1)writeFileSync(args[0],JSON.stringify(oracleFixture(),null,2)+'\n',{flag:'wx'});
  else if(command==='descriptor'&&args.length===4)writeFileSync(args[3],JSON.stringify(descriptor(args[0],args[1],args[2]),null,2)+'\n',{flag:'wx'});
  else throw Error('Usage: node placement-gpu.mjs source CASE OUT.metal | oracle OUT.json | descriptor CASE APPLE.metallib FLOOR.metallib OUT.json');
}
