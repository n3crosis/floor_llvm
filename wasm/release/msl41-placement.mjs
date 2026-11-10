// Authored MSL 4.1 placement construction coverage (spec 1.5.4 and 6.2).
// Exact compile/IR checks; these are not Apple GPU execution claims.
import assert from 'node:assert/strict';
import {assertMetalLanguageMetadataIR} from './metal-language.mjs';
import {assertMetallibMetadata} from './metallib-metadata.mjs';
import {checkPlacementDataflow} from './msl41-placement-ir.mjs';
const head='#include <metal_common>\nusing namespace metal;\n';
export const placementSpaces=['thread','threadgroup','device'];
export function placementSource(space,form) {
  assert(placementSpaces.includes(space)&&['scalar','array','aligned'].includes(form));
  const aligned=form==='aligned', array=form==='array';
  const record=`struct ${aligned?'alignas(32) ':''}Item { volatile uint value; Item(${array?'':'uint v'}) ${space} : value(${array?'7u':'v'}) {} ~Item() ${space} { value=19u; } };\n`;
  const params=space==='thread'?'device volatile uint* out [[buffer(0)]]':`${space} Item* storage [[${space==='device'?'buffer':'threadgroup'}(0)]], device volatile uint* out [[buffer(1)]]`;
  const local=space==='thread'?`alignas(Item) thread uchar bytes[sizeof(Item)${array?'*2':''}]; thread Item* volatile slot=(thread Item*)bytes; thread Item* storage=slot; `:'';
  const entry=`placement_${space}_${form}`;
  let body;
  if(array)body=`${space} Item* p=new(storage) ${space} Item[2]; out[0]=p==storage; out[1]=p[0].value; out[2]=p[1].value; p[0].~Item(); p[1].~Item();`;
  else if(aligned)body=`static_assert(alignof(Item)==32,"alignment"); ${space} Item* p=new(storage) ${space} Item(17u); out[0]=p->value; out[1]=p==storage; p->~Item();`;
  else body=`${space} Item* p=new(storage) ${space} Item(7u); out[0]=p->value; p->~Item(); p=new(storage) ${space} Item(11u); out[1]=p->value; p->~Item();`;
  return head+record+`kernel void ${entry}(${params}) { ${local}${body} }\n`;
}
export const msl41PlacementCases=[];
for(const space of placementSpaces)for(const form of ['scalar','array','aligned'])for(const math of [0,1])for(const kind of [0,1])
  msl41PlacementCases.push({name:`msl41-placement-${space}-${form}-math${math}-kind${kind}`,source:placementSource(space,form),api:3,ios:27,metalVersion:410,math,kind,status:0,msl41Placement:true,placementSpace:space,placementForm:form,entry:`placement_${space}_${form}`,air:[2,9,0],language:[4,1,0]});
const badHead='kernel void bad(device uint* storage [[buffer(0)]], device uint* out [[buffer(1)]])';
const bad=(name,code,pattern,prefix='')=>msl41PlacementCases.push({name:'msl41-placement-reject-'+name,source:head+prefix+'\n'+badHead+'{'+code+'}',api:3,ios:27,metalVersion:410,math:0,kind:1,status:3,diagnosticPattern:pattern,msl41Placement:true});
bad('heap','auto p=new uint(1); out[0]=*p;','dynamic allocation is not permitted');
bad('heap-array','auto p=new uint[2]; out[0]=p[0];','dynamic allocation is not permitted');
bad('delete','delete storage;','delete is not permitted');
bad('delete-array','delete[] storage;','delete is not permitted');
bad('missing-space','auto p=new(storage) uint(7); out[0]=*p;','explicitly thread, threadgroup, or device');
bad('constant-type','auto p=new(storage) constant uint(7);','explicitly thread, threadgroup, or device');
bad('generic-type','auto p=new(storage) __attribute__((generic_as)) uint(7);','explicitly thread, threadgroup, or device');
bad('wrong-space','auto p=new(storage) threadgroup uint(7);','standard storage-pointer overload.*allocated address space');
bad('no-storage','auto p=new() device uint(7);','expected|dynamic allocation');
bad('extra-argument','auto p=new(storage,1) device uint(7);','exactly one storage pointer');
bad('runtime-bound-array','auto p=new(storage) device uint[out[0]];','runtime-bound placement arrays');
bad('negative-array','auto p=new(storage) device uint[-1];','negative|too large');
bad('void-type','auto p=new(storage) device void;','incomplete|void');
bad('reference-type','auto p=new(storage) device Ref;','reference|address space','using Ref=uint&;');
bad('incomplete-type','auto p=new(storage) device Incomplete;','incomplete','struct Incomplete;');
bad('const-without-init','auto p=new(storage) const device uint;','const.*initial|initial.*const');
bad('deleted-constructor','auto p=new(storage) device Item(7);','deleted constructor|deleted function','struct Item { uint v; Item(uint) device = delete; };');
bad('constructor-arguments','auto p=new(storage) device Item(7);','no matching constructor','struct Item { uint v; Item() device : v(7) {} };');
bad('custom-placement','out[0]=0;','custom allocation operators','device void* operator new(size_t,device uint* p){return p;}');
bad('class-placement','auto p=new(storage) device Item;','custom allocation operators|standard storage-pointer overload','struct Item { static device void* operator new(size_t,device void* p){return p;} uint x; };');
bad('custom-delete','out[0]=0;','delete is not permitted','void operator delete(thread void*) {}');
bad('direct-heap-call','auto p=::operator new(sizeof(uint)); out[0]=0;','dynamic allocation.*not permitted');
bad('indirect-heap-call','auto allocate=static_cast<void*(*)(size_t)>(&::operator new); auto p=allocate(sizeof(uint)); out[0]=0;','dynamic allocation.*not permitted');
bad('indirect-delete-call','auto release=static_cast<void(*)(void*)>(&::operator delete); uint x=0; release(&x);','delete is not permitted');
bad('direct-delete-call','uint value=0; ::operator delete(&value);','delete is not permitted');
bad('user-redeclaration','out[0]=0;','custom allocation operators','device void* operator new(size_t,device void*);');
bad('template-custom','out[0]=0;','custom allocation operators','template<class T> device void* operator new(size_t,device T* p){return p;}');
bad('template-wrong-space','auto p=construct<uint>(storage);','standard storage-pointer overload.*allocated address space','template<class T> threadgroup T* construct(device T* p){return new(p) threadgroup T(7);}');
for(const [name,marker] of [['line-spoof','#line 1 "/include/metal_common"'],['system-marker-spoof','# 1 "/include/metal_common" 3']]) {
  // Suppress only the bundled common header, then forge the exact reserved
  // signature and presumed path. The API must check the physical source file.
  msl41PlacementCases.push({name:'msl41-placement-reject-'+name,
    source:'#define FLOOR_AIR_METAL_COMMON\n#include <metal_stdlib>\nusing namespace metal;\n'+marker+'\ndevice void* operator new(size_t,device void* p){return p;}\n'+badHead+'{auto p=new(storage) device uint(7);out[0]=*p;}',
    api:3,ios:27,metalVersion:410,kind:1,math:0,status:3,msl41Placement:true,diagnosticPattern:'custom allocation operators'});
}
for(const [api,ios,metalVersion] of [[1,18,320],[2,26,320],[3,18,320],[3,26,400]])for(const array of [false,true])
  msl41PlacementCases.push({name:`msl41-placement-gate-v${api}-ios${ios}-${array?'array':'scalar'}`,source:head+badHead+`{auto p=new(storage) device uint${array?'[2]':'(7)'};}`,api,ios,metalVersion,kind:1,math:0,status:3,diagnosticPattern:'placement new requires Metal 4[.]1',msl41Placement:true,placementGate:true});
export function assertMSL41PlacementIR(ir,test) {
  assert(test.msl41Placement&&test.status===0&&test.kind===1);
  assertMetalLanguageMetadataIR(ir,test);
  assert.match(ir,/!air\.kernel = !\{/,'Missing kernel metadata');
  checkPlacementDataflow(ir,test);
}
export function assertMSL41PlacementMetallib(bytes,test) {
  const result=assertMetallibMetadata(bytes);
  assert.equal(Buffer.from(bytes).readUInt16LE(12),27,'Wrong placement deployment target');
  assert.deepEqual(result.functions.map(f=>f.name),[test.entry]);
  for(const fn of result.functions)assert.deepEqual(fn.versions,[[2,9,0],[4,1,0]]);
  return result;
}
export function assertMSL41PlacementDiagnostic(diagnostics,test) {
  assert(test.diagnosticPattern,'Missing placement rejection pattern');
  assert.match(diagnostics,new RegExp(test.diagnosticPattern,'i'),'Wrong placement rejection reason');
}
