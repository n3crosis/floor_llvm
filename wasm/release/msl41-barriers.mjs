// Authored Metal 4.1 barrier sources (MSL specification 6.10 and 6.16).
// Sources/oracles are not compiler, AIR ABI, or GPU conformance evidence.
import assert from 'node:assert/strict';
import {assertMetalLanguageMetadataIR} from './metal-language.mjs';
import {assertMetallibMetadata} from './metallib-metadata.mjs';
export const barrierKinds=Object.freeze(['threadgroup','simdgroup']);
export const barrierOrders=Object.freeze(['relaxed','acquire','release','acq_rel','seq_cst']);
export const barrierScopes=Object.freeze(['thread','simdgroup','threadgroup','device']);
const header='#include <metal_stdlib>\nusing namespace metal;\n';
export function barrierSource(kind,order,scope=null) {
  assert(barrierKinds.includes(kind));assert(barrierOrders.includes(order));
  assert(scope===null||barrierScopes.includes(scope));
  return header+`kernel void barrier_${kind}_${order}_${scope??'default'}() { ${kind}_barrier(mem_flags::mem_threadgroup, memory_order_${order}${scope?', thread_scope_'+scope:''}); }\n`;
}
export function barrierSourceCases() {
  const cases=[];
  for(const kind of barrierKinds)for(const order of barrierOrders)for(const math of [0,1])for(const outputKind of [0,1]) {
    cases.push({name:`msl41-barrier-${kind}-${order}-default-math${math}-kind${outputKind}`,
      source:barrierSource(kind,order),api:3,ios:27,metalVersion:410,math,kind:outputKind,
      barrierKind:kind,barrierOrder:order,barrierScope:null,expectedApple:'accepted',
      evidenceStatus:'not_run'});
  }
  for(const kind of barrierKinds)for(const scope of barrierScopes)cases.push({
    name:`msl41-barrier-${kind}-acq_rel-${scope}`,source:barrierSource(kind,'acq_rel',scope),
    api:3,ios:27,metalVersion:410,math:0,kind:1,barrierKind:kind,barrierOrder:'acq_rel',barrierScope:scope,
    // Probe all scopes rather than inventing compiler-specific restrictions.
    expectedApple:'observe',evidenceStatus:'not_run'});
  for(const kind of barrierKinds)for(const [ios,metalVersion] of [[18,320],[26,400]])cases.push({
    name:`msl41-barrier-gate-${kind}-metal${metalVersion}`,source:barrierSource(kind,'acquire'),
    api:3,ios,metalVersion,math:0,kind:1,barrierKind:kind,barrierOrder:'acquire',barrierScope:null,
    expectedApple:'rejected',evidenceStatus:'not_run'});
  return cases;
}
// Each invocation uses exactly one group. For a simdgroup barrier the host must
// dispatch at most one hardware SIMD-group, not assume that its width is 32.
export function barrierExchangeSource(kind,order='acq_rel',explicitScope=false) {
  assert(barrierKinds.includes(kind));assert(['acq_rel','seq_cst'].includes(order));
  const args=`mem_flags::mem_threadgroup, memory_order_${order}${explicitScope?', thread_scope_'+kind:''}`;
  return header+`kernel void barrier_exchange(threadgroup uint* scratch [[threadgroup(0)]], device const uint* input [[buffer(0)]], device uint* output [[buffer(1)]], constant uint* count [[buffer(2)]], uint lane [[thread_index_in_threadgroup]]) {
  scratch[lane]=input[lane];
  ${kind}_barrier(${args});
  uint neighbor=scratch[(lane+1u)%count[0]];
  // All reads finish before any lane overwrites the same scratch allocation.
  ${kind}_barrier(${args});
  scratch[lane]=neighbor^0x9e3779b9u;
  ${kind}_barrier(${args});
  output[lane]=scratch[(lane+count[0]-1u)%count[0]];
}\n`;
}
// Independent integer oracle: the two opposite cyclic shifts cancel. No GPU
// ordering is simulated, so passing this oracle alone proves no synchronization.
export function barrierExchangeExpected(input) {
  assert(Array.isArray(input)&&input.length>0&&input.length<=1024);
  assert(input.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff));
  return input.map(x=>(x^0x9e3779b9)>>>0);
}
export function barrierExchangeInputs(width) {
  assert(Number.isInteger(width)&&width>0&&width<=1024);
  const special=[0,0xffffffff,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,1,0x01020304];
  let seed=0xb4a41e25;
  return Array.from({length:width},(_,i)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return i<special.length?special[i]:seed;
  });
}

// Native Apple 32023.922 reference archive SHA256:
// f3dd915912d925ff852d42fb0bb15b72bdb37da319346c16a475b2baaae6cc36.
export const barrierOrderValues=Object.freeze({relaxed:0,acquire:2,release:3,acq_rel:4,seq_cst:5});
export const barrierScopeValues=Object.freeze({thread:0,threadgroup:1,device:2,simdgroup:4});
export const msl41BarrierCases=[];
function positive(c) {
  const metalVersion=c.metalVersion??410,legacy=metalVersion<410;
  msl41BarrierCases.push({api:3,ios:27,metalVersion:410,math:0,kind:1,flags:2,
    air:legacy?(metalVersion===320?[2,7,0]:[2,8,0]):[2,9,0],
    language:legacy?(metalVersion===320?[3,2,0]:[4,0,0]):[4,1,0],
    stage:'kernel',callCount:1,...c,status:0,msl41Barrier:true});
}
for(const c of barrierSourceCases().filter(c=>c.metalVersion===410)) {
  const {expectedApple,evidenceStatus,...options}=c;
  positive({...options,entry:`barrier_${c.barrierKind}_${c.barrierOrder}_${c.barrierScope??'default'}`});
}
for(const barrierKind of barrierKinds)for(const math of [0,1])for(const kind of [0,1])
  positive({name:`msl41-barrier-${barrierKind}-one-argument-math${math}-kind${kind}`,math,kind,
    barrierKind,barrierOrder:'seq_cst',barrierScope:null,entry:'barrier_default',
    source:header+`kernel void barrier_default(){${barrierKind}_barrier(mem_flags::mem_threadgroup);}`});
for(const [ios,metalVersion] of [[18,320],[26,400]])for(const math of [0,1])for(const kind of [0,1])
  positive({name:`msl41-barrier-legacy-control-${metalVersion}-math${math}-kind${kind}`,ios,metalVersion,math,kind,
    barrierKind:'threadgroup',barrierOrder:null,barrierScope:'threadgroup',entry:'barrier_default',
    source:header+'kernel void barrier_default(){threadgroup_barrier(mem_flags::mem_threadgroup);}'});
for(const barrierKind of barrierKinds)for(const [flags,expression] of [[0,'mem_flags::mem_none'],[1,'mem_flags::mem_device'],[4,'mem_flags::mem_texture'],[8,'mem_flags::mem_threadgroup_imageblock'],[16,'mem_flags::mem_object_data'],[3,'mem_flags::mem_device|mem_flags::mem_threadgroup'],[31,'mem_flags(31)']])
  positive({name:`msl41-barrier-flags-${barrierKind}-${flags}`,flags,barrierKind,barrierOrder:'acq_rel',barrierScope:null,entry:'barrier_flags',
    source:header+`kernel void barrier_flags(){${barrierKind}_barrier(${expression},memory_order_acq_rel);}`});
for(const barrierKind of barrierKinds)
  positive({name:`msl41-barrier-fragment-${barrierKind}`,stage:'fragment',barrierKind,barrierOrder:'acquire',barrierScope:null,entry:'barrier_fragment',
    source:header+`fragment float4 barrier_fragment(){${barrierKind}_barrier(mem_flags::mem_threadgroup,memory_order_acquire);return float4(0);}`});
for(const barrierKind of barrierKinds)for(const barrierOrder of ['acq_rel','seq_cst'])for(const explicit of [false,true])for(const kind of [0,1])
  positive({name:`msl41-barrier-exchange-${barrierKind}-${barrierOrder}-${explicit?'explicit':'default'}-kind${kind}`,kind,
    barrierKind,barrierOrder,barrierScope:explicit?barrierKind:null,entry:'barrier_exchange',callCount:3,barrierExchange:true,
    source:barrierExchangeSource(barrierKind,barrierOrder,explicit)});
function negative(name,body,diagnosticPattern,status=3,options={}) {
  msl41BarrierCases.push({name:'msl41-barrier-reject-'+name,api:3,ios:27,metalVersion:410,math:0,kind:1,
    source:header+'kernel void bad(device uint* in [[buffer(0)]]){'+body+'}',
    status,diagnosticPattern,msl41Barrier:true,...options});
}
for(const [name,arg,pattern] of [
  ['order-one','mem_flags::mem_threadgroup,memory_order(1)','constant valid memory order'],
  ['order-unknown','mem_flags::mem_threadgroup,memory_order(17)','constant valid memory order'],
  ['order-dynamic','mem_flags::mem_threadgroup,memory_order(in[0])','constant valid memory order'],
  ['scope-unknown','mem_flags::mem_threadgroup,memory_order_acquire,thread_scope(3)','constant valid thread scope'],
  ['scope-dynamic','mem_flags::mem_threadgroup,memory_order_acquire,thread_scope(in[0])','constant valid thread scope'],
  ['flags-unknown','mem_flags(32),memory_order_acquire','constant valid memory flags'],
  ['flags-dynamic','mem_flags(in[0]),memory_order_acquire','constant valid memory flags'],
  ['order-wrong-type','mem_flags::mem_threadgroup,2u','no matching function|cannot initialize'],
])for(const kind of barrierKinds)negative(name+'-'+kind,`${kind}_barrier(${arg});`,pattern);
for(const kind of barrierKinds) {
  negative('vertex-'+kind,'','Unsupported shader stage',4,{source:header+`vertex float4 bad(){${kind}_barrier(mem_flags::mem_threadgroup,memory_order_acquire);return float4(0);}`});
  for(const [name,args] of [['flags','32u,2u,1u'],['order','2u,1u,1u'],['scope','2u,2u,3u'],['dynamic','2u,in[0],1u']])
    negative('internal-'+kind+'-'+name,`__atomic_detail::${kind==='threadgroup'?'barrier':'simd_barrier'}(${args});`,'Unsupported shader stage',4);
}
negative('atomic-acquire','atomic_fetch_add_explicit((device atomic_uint*)in,1u,memory_order_acquire);','only constant relaxed atomic order');
for(const kind of barrierKinds)for(const [api,ios,metalVersion] of [[1,18,320],[2,26,320],[3,18,320],[3,26,400]]) {
  negative(`gate-${kind}-api${api}-${metalVersion}`,`${kind}_barrier(mem_flags::mem_threadgroup,memory_order_acquire);`,'undeclared identifier|no matching function',3,{api,ios,metalVersion});
  negative(`macro-spoof-${kind}-api${api}-${metalVersion}`,'','assembly|asm',3,{api,ios,metalVersion,
    source:'#undef __METAL_VERSION__\n#define __METAL_VERSION__ 410\n'+barrierSource(kind,'acquire')});
}
for(const spoof of [false,true])negative('forged-asm-'+spoof,'','assembly|asm',3,{
  source:header+(spoof?'#line 1 "/include/metal_atomic"\n':'')+'void fake(uint,uint,uint) __asm__("air.wg.barrier") __attribute__((convergent));\nkernel void bad(){fake(2u,2u,1u);}'});
function barrierArguments(test) {
  const scope=barrierScopeValues[test.barrierScope??test.barrierKind];
  return test.metalVersion===410?[test.flags,barrierOrderValues[test.barrierOrder],scope]:[test.flags,scope];
}
// These checks intentionally recognize the straight-line typed-pointer probe IR,
// not arbitrary LLVM programs. Quoted strings may contain semicolons.
function withoutIRComments(ir) {
  return ir.split('\n').map(line=>line.replace(/"(?:\\.|[^"\\])*"|;.*$/g,x=>x.startsWith(';')?'':x)).join('\n');
}
const escapedIRName=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function attributeGroup(ir,id) {
  const groups=[...ir.matchAll(new RegExp('^attributes #'+id+' = \\{([^\\n]*)\\}$','gm'))];
  assert.equal(groups.length,1,'Missing or duplicate attribute group');return groups[0][1];
}
function safeBarrierEffects(attributes) {
  assert(!/\b(?:readnone|readonly|nosync|speculatable)\b|\bmemory\s*\(/.test(attributes),'Barrier memory effects were weakened or unsupported');
}
function assertBarrierEntryStage(ir,test) {
  let matches=0;
  for(const stage of ['kernel','fragment','vertex']) {
    const roots=[...ir.matchAll(new RegExp('^!air[.]'+stage+' = !\\{([^\\n]*)\\}$','gm'))];
    assert(roots.length<=1,'Duplicate stage metadata');
    for(const root of roots) {
      assert(/^!\d+(?:, !\d+)*$|^$/.test(root[1]),'Malformed stage metadata');
      for(const id of root[1].match(/\d+/g)??[]) {
        const nodes=[...ir.matchAll(new RegExp('^!'+id+' = !\\{([^\\n]*)\\}$','gm'))];
        assert.equal(nodes.length,1,'Missing or duplicate stage entry node');
        const entry=nodes[0][1].match(/^[^@]*@([^ ,]+),/);
        assert(entry,'Malformed stage entry');
        if(entry[1]===test.entry) {assert.equal(stage,test.stage,'Wrong entry stage');matches++;}
      }
    }
  }
  assert.equal(matches,1,'Entry must have exactly one stage registration');
}
function assertExchangeFlow(body,signature) {
  const variable='%[-a-zA-Z$._0-9]+';
  const parameters=signature.split(',').map(x=>x.trim());
  const params=parameters.map(x=>x.match(new RegExp('('+variable+')$'))?.[1]);
  assert.equal(params.length,5,'Wrong exchange parameter count');assert(params.every(Boolean),'Missing exchange parameters');
  const types=['i32 addrspace(3)*','i32 addrspace(1)*','i32 addrspace(1)*','i32 addrspace(2)*','i32'];
  for(let i=0;i<types.length;i++)assert.equal(parameters[i].match(/^i32(?: addrspace\(\d+\))?\*?(?= )/)?.[0],types[i],'Wrong exchange parameter type or address space');
  const [scratch,input,output,count,lane]=params;
  const defs=new Map(params.map(x=>[x,x]));
  const get=x=>{ x=x.trim(); if(/^-?\d+$/.test(x))return String(Number(x)>>>0);assert(defs.has(x),'Unknown exchange SSA value');return defs.get(x); };
  const ptr=(base,index)=>`ptr(${base},${index})`,load=p=>`load(${p})`;
  // Flatten unsigned addition so lane+count-1 and (lane-1)+count agree.
  const add=(a,b)=>{
    const terms=[a,b].flatMap(x=>x.startsWith('add[')?JSON.parse(x.slice(3)): [x]);
    let n=0;const rest=[];for(const x of terms)if(/^\d+$/.test(x))n=(n+Number(x))>>>0;else rest.push(x);
    if(n)rest.push(String(n));rest.sort();return rest.length===1?rest[0]:'add'+JSON.stringify(rest);
  };
  const rem=(a,b)=>`urem(${a},${b})`,xor=(a,b)=>`xor(${[a,b].sort().join(',')})`;
  const countValue=load(count),first=ptr(scratch,lane);
  const neighbor=load(ptr(scratch,rem(add(lane,'1'),countValue)));
  const last=load(ptr(scratch,rem(add(add(lane,countValue),'4294967295'),countValue)));
  const expectedStores=[[0,first,load(ptr(input,lane))],[2,first,xor(neighbor,'2654435769')],[3,ptr(output,lane),last]];
  const stores=[],reads=[];let phase=0,firstLine=true;
  for(const raw of body.trim().split('\n')) {
    const line=raw.trim();if(!line)continue;
    const initial=firstLine;firstLine=false;
    if(initial && /^[-a-zA-Z$._0-9]+:$/.test(line))continue;
    if(/^(?:tail )?call void @air[.](?:wg|simdgroup)[.]barrier\(/.test(line)){phase++;continue;}
    if(line==='ret void')continue;
    let m=line.match(new RegExp('^store i32 ('+variable+'|-?\\d+), i32 addrspace\\([123]\\)\\* ('+variable+')(?:,|$)'));
    if(m){stores.push([phase,get(m[2]),get(m[1])]);continue;}
    m=line.match(new RegExp('^('+variable+') = (.+)$'));assert(m,'Unsupported exchange instruction/control flow');
    const [,id,rhs]=m;assert(!defs.has(id),'Duplicate SSA definition');let value;
    let op=rhs.match(new RegExp('^(?:zext i32|sext i32) ('+variable+') to i64$'));
    if(op){assert(rhs.startsWith('zext'),'Signed exchange index');value=get(op[1]);}
    else if((op=rhs.match(new RegExp('^getelementptr(?: inbounds)? i32, i32 addrspace\\([123]\\)\\* ('+variable+'), i(?:32|64) ('+variable+'|-?\\d+)$'))))value=ptr(get(op[1]),get(op[2]));
    else if((op=rhs.match(new RegExp('^load i32, i32 addrspace\\([123]\\)\\* ('+variable+')(?:,|$)')))){value=load(get(op[1]));reads.push([phase,value]);}
    else if((op=rhs.match(new RegExp('^(add|xor|urem)(?: nuw| nsw)* i32 ('+variable+'|-?\\d+), ('+variable+'|-?\\d+)(?:,|$)'))))value=({add,xor,urem:rem})[op[1]](get(op[2]),get(op[3]));
    else assert.fail('Unsupported exchange SSA instruction');
    defs.set(id,value);
  }
  assert.equal(phase,3,'Wrong exchange phases');assert.deepEqual(stores,expectedStores,'Wrong exchange store order, address or SSA value');
  assert.deepEqual(reads.filter(x=>x[1]!==countValue),[[0,load(ptr(input,lane))],[1,neighbor],[3,last]],'Wrong exchange load order, address or SSA value');
}
export function assertMSL41BarrierIR(ir,test) {
  assert(test.msl41Barrier&&test.status===0&&test.kind===1);
  assert(typeof ir==='string'&&ir.length<1024*1024);
  ir=withoutIRComments(ir);
  assertMetalLanguageMetadataIR(ir,test);
  assertBarrierEntryStage(ir,test);
  const functions=[...ir.matchAll(new RegExp('^define [^\\n]*@'+test.entry+'\\([^\\n]*\\{([^]*?)^}', 'gm'))];
  assert.equal(functions.length,1,'Missing or duplicate barrier entry');
  const body=functions[0][1],symbol=test.barrierKind==='threadgroup'?'air.wg.barrier':'air.simdgroup.barrier';
  const calls=[...body.matchAll(/^\s*(?:tail )?call void @(air[.](?:wg|simdgroup)[.]barrier)\(([^\n]*?)\)([^\n]*)$/gm)];
  assert.equal(calls.length,test.callCount,'Wrong barrier call count');
  for(const call of calls) {
    assert.equal(call[1],symbol,'Wrong barrier kind');
    safeBarrierEffects(call[3]);
    for(const id of call[3].matchAll(/#(\d+)/g))safeBarrierEffects(attributeGroup(ir,id[1]));
    const args=call[2].split(',').map(x=>{
      const m=x.trim().match(/^i32 (?:noundef )?(\d+)$/);assert(m,'Nonconstant or wrongly typed barrier operand');return Number(m[1]);
    });
    assert.deepEqual(args,barrierArguments(test),'Wrong versioned barrier operand order or values');
  }
  const declarations=[...ir.matchAll(new RegExp('^declare void @'+symbol.replaceAll('.','\\.')+'\\(([^\\n]*)\\)[^\\n]*#(\\d+)', 'gm'))];
  assert.equal(declarations.length,1,'Missing or duplicate barrier declaration');
  assert.deepEqual(declarations[0][1].split(',').map(x=>x.trim().replace(/^i32 noundef$/,'i32')),barrierArguments(test).map(()=>'i32'),'Wrong barrier declaration arity');
  const attr=[...ir.matchAll(new RegExp('^attributes #'+declarations[0][2]+' = \\{([^]*?)\\}', 'gm'))];
  assert.equal(attr.length,1,'Missing barrier attributes');
  assert.match(attr[0][1],/\bconvergent\b/,'Barrier must be convergent');
  safeBarrierEffects(attr[0][1]);
  assert(!/@_Z|floor[.]opaque[.]/.test(ir),'Unlowered helper survived');
  if(test.barrierExchange) {
    const signature=functions[0][0].slice(0,functions[0][0].indexOf('\n')).match(/@barrier_exchange\((.*)\)[^{]*\{/);
    assert(signature,'Missing exchange signature');assertExchangeFlow(body,signature[1]);
  }
}
export function assertMSL41BarrierMetallib(bytes,test) {
  const result=assertMetallibMetadata(bytes);
  assert.equal(Buffer.from(bytes).readUInt16LE(12),test.ios,'Wrong barrier deployment target');
  assert.deepEqual(result.functions.map(f=>f.name),[test.entry]);
  for(const fn of result.functions)assert.deepEqual(fn.versions,[test.air,test.language]);
  return result;
}
export function assertMSL41BarrierDiagnostic(diagnostics,test) {
  assert(test.diagnosticPattern,'Missing barrier diagnostic expectation');
  assert.match(diagnostics,new RegExp(test.diagnosticPattern,'i'),'Wrong barrier rejection reason');
}
