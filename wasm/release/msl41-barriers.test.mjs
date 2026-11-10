import test from 'node:test';
import assert from 'node:assert/strict';
import {barrierKinds,barrierOrders,barrierScopes,barrierSource,barrierSourceCases,barrierExchangeSource,barrierExchangeExpected,barrierExchangeInputs} from './msl41-barriers.mjs';
test('bounded unique matrix preserves target, language and evidence boundaries',()=>{
  const cases=barrierSourceCases();assert.equal(cases.length,52);
  assert.equal(new Set(cases.map(c=>c.name)).size,cases.length);
  assert(cases.every(c=>c.evidenceStatus==='not_run'));
  assert(cases.every(c=>c.status===undefined),'Unrun discovery cases must not look like successful release cases');
  assert.equal(cases.filter(c=>c.expectedApple==='accepted').length,40);
  assert.equal(cases.filter(c=>c.expectedApple==='observe').length,8);
  assert.equal(cases.filter(c=>c.expectedApple==='rejected').length,4);
  for(const c of cases) {
    assert.equal(c.api,3);assert(c.source.length<1024);
    assert([[18,320],[26,400],[27,410]].some(([i,v])=>i===c.ios&&v===c.metalVersion));
    if(c.expectedApple==='rejected')assert(c.metalVersion<410);else assert.equal(c.metalVersion,410);
  }
});
test('each barrier and memory order has both math/output paths',()=>{
  const cases=barrierSourceCases();
  for(const kind of barrierKinds)for(const order of barrierOrders)for(const math of [0,1])for(const output of [0,1])
    assert.equal(cases.filter(c=>c.metalVersion===410&&c.barrierKind===kind&&c.barrierOrder===order&&c.barrierScope===null&&c.math===math&&c.kind===output).length,1);
});
test('explicit scope discovery is separate from assumed acceptance',()=>{
  const cases=barrierSourceCases();
  for(const kind of barrierKinds)for(const scope of barrierScopes) {
    const c=cases.find(c=>c.barrierKind===kind&&c.barrierScope===scope);assert(c);
    assert.equal(c.expectedApple,'observe');assert(c.source.includes('thread_scope_'+scope));
  }
});
test('sources reject invalid identifiers rather than interpolate arbitrary input',()=>{
  assert.throws(()=>barrierSource('vertex','acquire'));
  assert.throws(()=>barrierSource('threadgroup','consume'));
  assert.throws(()=>barrierSource('threadgroup','acquire','system'));
  assert.throws(()=>barrierExchangeSource('simdgroup','release'));
});
test('exchange kernels use three uniform barriers and matching default/explicit scope',()=>{
  for(const kind of barrierKinds)for(const order of ['acq_rel','seq_cst'])for(const explicit of [false,true]) {
    const source=barrierExchangeSource(kind,order,explicit);
    assert.equal(source.split(kind+'_barrier(').length-1,3);
    assert.equal(source.split('memory_order_'+order).length-1,3);
    assert.equal(source.split('thread_scope_'+kind).length-1,explicit?3:0);
    assert(source.indexOf('uint neighbor=')<source.indexOf('scratch[lane]=neighbor'));
    assert(!source.includes('if (')&&!source.includes('if('));
    assert.match(source,/thread_index_in_threadgroup/);
  }
});
test('oracle covers signs, boundaries, lane permutations and deterministic random data',()=>{
  assert.deepEqual(barrierExchangeExpected([0,0xffffffff]),[0x9e3779b9,0x61c88646]);
  for(const width of [1,2,4,8,16,32,64,128,1024]) {
    const input=barrierExchangeInputs(width);assert.deepEqual(input,barrierExchangeInputs(width));
    const intermediate=input.map((_,i)=>(input[(i+1)%width]^0x9e3779b9)>>>0);
    const actual=intermediate.map((_,i)=>intermediate[(i+width-1)%width]);
    assert.deepEqual(actual,barrierExchangeExpected(input));
    assert.deepEqual(barrierExchangeExpected(barrierExchangeExpected(input)),input);
  }
  assert.throws(()=>barrierExchangeInputs(0));assert.throws(()=>barrierExchangeInputs(1025));
  assert.throws(()=>barrierExchangeExpected([]));assert.throws(()=>barrierExchangeExpected([-1]));
  assert.throws(()=>barrierExchangeExpected([2**32]));
});

import {readFileSync} from 'node:fs';
import {msl41BarrierCases,barrierOrderValues,barrierScopeValues,assertMSL41BarrierIR,assertMSL41BarrierDiagnostic} from './msl41-barriers.mjs';
// Synthetic validator fixtures, not compiled IR or executable evidence.
function fixture(c) {
  if(c.barrierExchange) {
    const simple=fixture({...c,barrierExchange:false});
    const call=simple.match(/^  tail call[^\n]+/m)[0];
    return simple.replace('define void @barrier_exchange()', 'define void @barrier_exchange(i32 addrspace(3)* %scratch, i32 addrspace(1)* %input, i32 addrspace(1)* %output, i32 addrspace(2)* %count, i32 %lane)')
      .replace(/(?:  tail call[^\n]+\n){3}/,`  %i = zext i32 %lane to i64
  %ip = getelementptr inbounds i32, i32 addrspace(1)* %input, i64 %i
  %v = load i32, i32 addrspace(1)* %ip, align 4
  %sp = getelementptr inbounds i32, i32 addrspace(3)* %scratch, i64 %i
  store i32 %v, i32 addrspace(3)* %sp, align 4
${call}
  %n = load i32, i32 addrspace(2)* %count, align 4
  %next = add i32 %lane, 1
  %ni = urem i32 %next, %n
  %np = getelementptr inbounds i32, i32 addrspace(3)* %scratch, i32 %ni
  %neighbor = load i32, i32 addrspace(3)* %np, align 4
${call}
  %mixed = xor i32 %neighbor, -1640531527
  store i32 %mixed, i32 addrspace(3)* %sp, align 4
${call}
  %prev = add i32 %lane, -1
  %wrap = add i32 %prev, %n
  %pi = urem i32 %wrap, %n
  %pp = getelementptr inbounds i32, i32 addrspace(3)* %scratch, i32 %pi
  %result = load i32, i32 addrspace(3)* %pp, align 4
  %op = getelementptr inbounds i32, i32 addrspace(1)* %output, i64 %i
  store i32 %result, i32 addrspace(1)* %op, align 4
`);
  }
  const modern=c.metalVersion===410;
  const symbol=c.barrierKind==='threadgroup'?'air.wg.barrier':'air.simdgroup.barrier';
  const scope=barrierScopeValues[c.barrierScope??c.barrierKind];
  const args=modern?[c.flags,barrierOrderValues[c.barrierOrder],scope]:[c.flags,scope];
  return `target triple = "air64-apple-ios${c.ios}.0.0"\n!air.version = !{!1}\n!1 = !{${c.air.map(x=>'i32 '+x).join(', ')}}\n!air.language_version = !{!2}\n!2 = !{!"Metal", ${c.language.map(x=>'i32 '+x).join(', ')}}\n!air.${c.stage} = !{!3}\n!3 = !{void ()* @${c.entry}, !4, !4}\n!4 = !{}\ndefine void @${c.entry}() {\n`+
    (c.barrierExchange?'  %x = load i32, i32 addrspace(3)* %scratch, align 4\n  store i32 %x, i32 addrspace(3)* %scratch, align 4\n':'')+
    Array(c.callCount).fill(`  tail call void @${symbol}(${args.map(x=>'i32 '+x).join(', ')}) #1\n`).join('')+
    `  ret void\n}\ndeclare void @${symbol}(${args.map(()=>'i32').join(', ')}) #1\nattributes #1 = { convergent nounwind }\n`;
}
test('release matrix covers96 success contracts and45 rejection contracts without claiming execution',()=>{
  assert.equal(msl41BarrierCases.length,141);
  assert.equal(new Set(msl41BarrierCases.map(c=>c.name)).size,141);
  assert.equal(msl41BarrierCases.filter(c=>c.status===0).length,96);
  assert.equal(msl41BarrierCases.filter(c=>c.status===3).length,35);
  assert.equal(msl41BarrierCases.filter(c=>c.status===4).length,10);
  for(const c of msl41BarrierCases)assert(Buffer.byteLength(c.source)<4096);
  assert.equal(msl41BarrierCases.filter(c=>c.status===0&&c.metalVersion<410).length,8);
  assert.equal(msl41BarrierCases.filter(c=>c.barrierExchange).length,16);
});
test('all positive IR contracts accept synthetic correct versioned ABI',()=>{
  for(const c of msl41BarrierCases.filter(c=>c.status===0&&c.kind===1))assertMSL41BarrierIR(fixture(c),c);
});
test('IR contract rejects legacy ABI, altered enum values and weakened effects',()=>{
  const c=msl41BarrierCases.find(c=>c.status===0&&c.kind===1&&c.barrierKind==='threadgroup'&&c.barrierOrder==='acquire');
  const good=fixture(c);assertMSL41BarrierIR(good,c);
  const mutations=[
    good.replace('(i32 2, i32 2, i32 1)','(i32 2, i32 1)'),
    good.replace('(i32 2, i32 2, i32 1)','(i32 2, i32 5, i32 1)'),
    good.replace('(i32 2, i32 2, i32 1)','(i32 2, i32 2, i32 4)'),
    good.replace('(i32 2, i32 2, i32 1)','(i32 2, i32 %order, i32 1)'),
    good.replaceAll('air.wg.barrier','air.simdgroup.barrier'),
    good.replace('convergent nounwind','nounwind'),
    good.replace('convergent nounwind','convergent readonly nounwind'),
    good.replace('convergent nounwind','convergent nosync nounwind'),
    good.replace('!"Metal", i32 4, i32 1, i32 0','!"Metal", i32 4, i32 0, i32 0'),
    good.replace('ios27.0.0','ios26.0.0'),
    good.replace('declare void @air.wg.barrier(i32, i32, i32)','declare void @air.wg.barrier(i32, i32)'),
    good.replace('  ret void','  tail call void @air.wg.barrier(i32 2, i32 2, i32 1) #1\n  ret void'),
  ];
  for(const mutated of mutations)assert.throws(()=>assertMSL41BarrierIR(mutated,c));
});
test('native reference ledger pins exactly observed ABI and does not claim GPU coverage',()=>{
  const reference=JSON.parse(readFileSync(new URL('./fixtures/msl41-barrier-reference.json',import.meta.url)));
  assert.equal(reference.archiveSha256,'f3dd915912d925ff852d42fb0bb15b72bdb37da319346c16a475b2baaae6cc36');
  assert.equal(reference.cases.length,36);
  assert.equal(reference.cases.filter(c=>c.metalVersion==='4.1'&&c.returncode===0).length,23);
  const lookup=(version,probe)=>reference.cases.find(c=>c.metalVersion===version&&c.probe===probe);
  assert.deepEqual(lookup('4.1',0).argumentValues,[[2,5,1]]);
  assert.deepEqual(lookup('4.1',23).argumentValues,[[2,5,4]]);
  assert.deepEqual(lookup('3.2',0).argumentValues,[[2,1]]);
  assert.deepEqual(lookup('4.0',23).argumentValues,[[2,4]]);
  assert.equal(lookup('4.1',18).returncode,1);
  // Native accepts these unknown casts in textual AIR; the bounded FLOOR API
  // deliberately rejects them before claiming valid executable semantics.
  for(const probe of [17,21,22])assert.equal(lookup('4.1',probe).returncode,0);
  for(const [name,value] of Object.entries(barrierOrderValues))assert.equal(reference.enums['memory_order_'+name],value);
  for(const [name,value] of Object.entries(barrierScopeValues))assert.equal(reference.enums['thread_scope_'+name],value);
});
test('public enum values and immutable-header ABI gates match native reference',()=>{
  const header=readFileSync(new URL('../api/include/metal_atomic',import.meta.url),'utf8');
  const reference=JSON.parse(readFileSync(new URL('./fixtures/msl41-barrier-reference.json',import.meta.url)));
  for(const [name,value] of Object.entries(reference.enums))assert.match(header,new RegExp('\\b'+name+'\\s*=\\s*'+value+'\\b'));
  assert.match(header,/#if defined\(__METAL_VERSION__\) && __METAL_VERSION__ >= 410/);
  assert.match(header,/void barrier\(uint,uint,uint\)/);assert.match(header,/void barrier\(uint,uint\)/);
  assert.match(header,/only constant relaxed atomic order is supported/);
  const trust=readFileSync(new URL('../api/atomic_trust.inc',import.meta.url),'utf8');
  assert.match(trust,/getLangOpts\(\)[.]MetalVersion==410/);
  assert.match(trust,/function->getNumParams\(\)!=\(metal41 \? 3u : 2u\)/);
});
test('barrier diagnostics fail closed on wrong failure causes',()=>{
  const c=msl41BarrierCases.find(c=>c.name.includes('order-dynamic-threadgroup'));
  assertMSL41BarrierDiagnostic('error: barriers require constant valid memory order',c);
  assert.throws(()=>assertMSL41BarrierDiagnostic('unknown type name uint',c));
});

test('ordinary FLOOR noundef operands and declarations retain the exact ABI',()=>{
  const c=msl41BarrierCases.find(c=>c.status===0&&c.kind===1&&c.barrierKind==='threadgroup'&&c.barrierOrder==='acquire');
  const ir=fixture(c).replace('(i32 2, i32 2, i32 1)','(i32 noundef 2, i32 noundef 2, i32 noundef 1)').replace('declare void @air.wg.barrier(i32, i32, i32)','declare void @air.wg.barrier(i32 noundef, i32 noundef, i32 noundef)');
  assertMSL41BarrierIR(ir,c);
});

test('barrier validation binds stages, ignores comments and checks call-site effects',()=>{
  const c=msl41BarrierCases.find(c=>c.status===0&&c.kind===1&&c.barrierOrder==='acquire');
  const good=fixture(c);
  const mutations=[
    good.replace('!air.kernel = !{!3}','!air.kernel = !{}'),
    good.replace('!air.kernel = !{!3}','!air.kernel = !{}\n!air.vertex = !{!3}'),
    good.replace('!air.kernel = !{!3}','!air.kernel = !{!3}\n!air.fragment = !{!3}'),
    good.replace('!air.kernel = !{!3}','!air.kernel = !{!3, !3}'),
    good.replace('  tail call','  ; tail call'),
    good.replace(/(tail call[^\n]+) #1/,'$1 #2')+'attributes #2 = { readnone }\n',
    good.replace(/(tail call[^\n]+) #1/,'$1 readonly'),
  ];
  for(const ir of mutations)assert.throws(()=>assertMSL41BarrierIR(ir,c));
  assertMSL41BarrierIR(good.replace('convergent nounwind','convergent nounwind "note"="a;b"'),c);
});
test('exchange validation checks phases, addresses and SSA through output',()=>{
  const c=msl41BarrierCases.find(c=>c.barrierExchange&&c.kind===1),good=fixture(c);
  assertMSL41BarrierIR(good,c);
  const mutations=[
    good.replace('store i32 %v,','store i32 0,'),
    good.replace('store i32 %mixed,','store i32 %neighbor,'),
    good.replace('store i32 %result,','store i32 0,'),
    good.replace('  store i32 %result, i32 addrspace(1)* %op, align 4\n',''),
    good.replace('%next = add i32 %lane, 1','%next = add i32 %lane, 2'),
    good.replace('%prev = add i32 %lane, -1','%prev = add i32 %lane, 1'),
    good.replace('xor i32 %neighbor, -1640531527','xor i32 %neighbor, 1'),
    good.replace('i32 addrspace(1)* %output, i64 %i','i32 addrspace(1)* %input, i64 %i'),
    good.replace('  %neighbor = load i32, i32 addrspace(3)* %np, align 4\n','').replace('  %mixed =','  %neighbor = load i32, i32 addrspace(3)* %np, align 4\n  %mixed ='),
    good.replace('  ret void','  br label %exit\nexit:\n  ret void'),
  ];
  for(const ir of mutations)assert.throws(()=>assertMSL41BarrierIR(ir,c));
  // Equivalent unsigned addition reassociation and SSA renaming remain valid.
  assertMSL41BarrierIR(good.replace('%prev = add i32 %lane, -1','%prev = add i32 %lane, %n').replace('%wrap = add i32 %prev, %n','%wrap = add i32 %prev, -1').replaceAll('%neighbor','%renamed'),c);
});

test('exchange accepts one initial FLOOR block label and preserves parameter address spaces',()=>{
  const c=msl41BarrierCases.find(c=>c.barrierExchange&&c.kind===1),good=fixture(c);
  const labeled=good.replace('  %i =','entry:\n  %i =');
  assertMSL41BarrierIR(labeled,c);
  assertMSL41BarrierIR(labeled.replace('i32 addrspace(3)* %scratch','i32 addrspace(3)* nocapture noundef %scratch').replace('i32 %lane) {','i32 noundef %lane) {'),c);
  const mutations=[
    labeled.replace('entry:\n','entry:\nsecond:\n'),
    good.replace('  %mixed =','second:\n  %mixed ='),
    good.replaceAll('addrspace(3)','addrspace(1)'),
    good.replace('i32 addrspace(1)* %input','i32 addrspace(3)* %input'),
    good.replace('i32 addrspace(1)* %output','i32 addrspace(2)* %output'),
    good.replace('i32 addrspace(2)* %count','i32 addrspace(1)* %count'),
    good.replace('i32 %lane) {','i64 %lane) {'),
    good.replace('i32 %lane) {','i32 addrspace(1)* %lane) {'),
  ];
  for(const ir of mutations)assert.throws(()=>assertMSL41BarrierIR(ir,c));
});
