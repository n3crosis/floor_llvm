import test from 'node:test';
import assert from 'node:assert/strict';
import { atomicShapes, atomicOrders, atomicSource, atomicControlArguments, msl41AtomicCases,
  assertMSL41AtomicIR, assertMSL41AtomicDiagnostic } from './msl41-atomics.mjs';
// Synthetic fixtures exercise validators only. They are never compiler evidence.
function fixture(c) {
  const as = c.space === 'device' ? 1 : 3;
  const symbol = 'air.atomic.' + (c.space === 'device' ? 'global' : 'local') + '.' + c.op + '.u.i32';
  const controls = atomicControlArguments(c);
  return `target triple = "air64-apple-ios${c.ios}.0.0"
!air.version = !{!1}
!1 = !{${c.air.map(x => 'i32 ' + x).join(', ')}}
!air.language_version = !{!2}
!2 = !{!"Metal", ${c.language.map(x => 'i32 ' + x).join(', ')}}
!air.kernel = !{!3}
!3 = !{void (i32 addrspace(${as})*, i32 addrspace(1)*, i32 addrspace(2)*)* @atomic_probe, !4, !5}
!4 = !{}
!5 = !{!6, !7, !8}
!6 = !{i32 0, !"air.buffer", !"air.location_index", i32 0, i32 1, !"air.read_write", !"air.address_space", i32 ${as}, !"air.arg_type_size", i32 4, !"air.arg_type_align_size", i32 4, !"air.arg_type_name", !"metal::atomic_uint", !"air.arg_name", !"object"}
!7 = !{i32 1, !"air.buffer", !"air.location_index", i32 1, i32 1, !"air.read_write", !"air.address_space", i32 1, !"air.arg_type_size", i32 4, !"air.arg_type_align_size", i32 4, !"air.arg_type_name", !"uint", !"air.arg_name", !"output"}
!8 = !{i32 2, !"air.buffer", !"air.location_index", i32 2, i32 1, !"air.read", !"air.address_space", i32 2, !"air.arg_type_size", i32 4, !"air.arg_type_align_size", i32 4, !"air.arg_type_name", !"uint", !"air.arg_name", !"input"}
define void @atomic_probe(i32 addrspace(${as})* %object, i32 addrspace(1)* %output, i32 addrspace(2)* %input) #0 {
entry:
  %v = load i32, i32 addrspace(2)* %input, align 4
  %p = getelementptr i32, i32 addrspace(${as})* %object, i32 0
  %old = tail call i32 @${symbol}(i32 addrspace(${as})* %p, i32 %v, ${controls.join(', ')}) #1
  store i32 %old, i32 addrspace(1)* %output, align 4
  ret void
}
declare i32 @${symbol}(i32 addrspace(${as})*, i32, ${controls.map(c => c.split(' ')[0]).join(', ')}) #1
attributes #0 = { convergent nounwind }
attributes #1 = { convergent nounwind }
`;
}
test('atomic sources are bounded and reject unsupported input interpolation', () => {
  for (const shape of atomicShapes) for (const order of atomicOrders) for (const flags of [null, 0, 1, 2, 31]) {
    const s = atomicSource({...shape, order, flags});
    assert(s.length < 1024);
    assert(s.includes('atomic_fetch_' + shape.op + '_explicit'));
    assert(s.includes('memory_order_' + order));
  }
  for (const bad of [{space:'constant',op:'add'}, {space:'device',op:'max'}, {space:'device',op:'add',order:'consume'},
    {space:'device',op:'add',flags:32}, {space:'device',op:'add',flags:-1}, {space:'device',op:'add',volatile:'true'}])
    assert.throws(() => atomicSource(bad));
});
test('release contracts cover existing shapes, all memory orders, forms and outputs', () => {
  assert.equal(new Set(msl41AtomicCases.map(c => c.name)).size, msl41AtomicCases.length);
  for (const shape of atomicShapes) for (const order of atomicOrders) for (const explicit of [false, true]) for (const kind of [0, 1])
    if (explicit || order === 'relaxed') assert(msl41AtomicCases.some(c => c.status === 0 && c.metalVersion === 410 && c.space === shape.space && c.op === shape.op && c.order === order && (c.flags !== null) === explicit && c.kind === kind && !c.volatile));
  assert.equal(msl41AtomicCases.filter(c => c.status === 0 && c.metalVersion < 410).length, 20);
  assert.equal(msl41AtomicCases.filter(c => c.status === 0 && c.volatile).length, 10);
  assert(msl41AtomicCases.every(c => c.source.length < 4096 && !Object.hasOwn(c, 'passed')));
});
test('synthetic legacy contracts preserve the unchanged five-argument ABI', () => {
  for (const c of msl41AtomicCases.filter(c => c.status === 0 && c.metalVersion < 410 && c.kind === 1))
    assertMSL41AtomicIR(fixture(c), c);
});
test('atomic validator rejects changed controls, provenance, result flow and effects', () => {
  const c = msl41AtomicCases.find(c => c.status === 0 && c.metalVersion === 320 && c.space === 'device' && c.op === 'add' && c.kind === 1);
  const good = fixture(c);
  const mutations = [
    good.replace('i32 0, i32 2, i1 true', 'i32 2, i32 2, i1 true'),
    good.replace('i32 0, i32 2, i1 true', 'i32 0, i32 1, i1 true'),
    good.replace('i32 0, i32 2, i1 true', 'i32 0, i32 2, i1 false'),
    good.replace('i32 %v, i32 0', 'i32 1, i32 0'),
    good.replace('i32 addrspace(1)* %object, i32 0', 'i32 addrspace(1)* %object, i32 1'),
    good.replace('i32 addrspace(1)* %object, i32 0', 'i32 addrspace(1)* %output, i32 0'),
    good.replace('store i32 %old', 'store i32 %v'),
    good.replace('store i32 %old, i32 addrspace(1)* %output', 'store i32 %old, i32 addrspace(1)* %object'),
    good.replace('!"air.location_index", i32 1, i32 1', '!"air.location_index", i32 2, i32 1'),
    good.replace('!air.kernel =', '!air.vertex ='),
    good.replaceAll('air.atomic.global.add.u.i32', 'air.atomic.global.min.u.i32'),
    good.replace('attributes #1 = { convergent nounwind }', 'attributes #1 = { convergent nounwind readnone }'),
    good.replace(') #1\n  store', ') readonly\n  store'),
    good.replace('ret void', 'br label %other\nother:\n  ret void'),
    good.replace('i32 %v, i32 0, i32 2, i1 true', 'i32 %v, i32 0, i32 2, i1 true, i32 0'),
  ];
  for (const mutated of mutations) assert.throws(() => assertMSL41AtomicIR(mutated, c));
  assertMSL41AtomicIR(good + '\n; call i32 @fake()\n', c);
});
test('atomic diagnostics require the intended failure reason', () => {
  const c = msl41AtomicCases.find(c => c.name.endsWith('flags-dynamic'));
  assertMSL41AtomicDiagnostic('error: atomics require constant valid atomic memory flags', c);
  assert.throws(() => assertMSL41AtomicDiagnostic('error: unexpected token', c));
});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
test('all positive 4.1 IR contracts preserve the six-argument reference ABI', () => {
  for (const c of msl41AtomicCases.filter(c => c.status === 0 && c.metalVersion === 410 && c.kind === 1))
    assertMSL41AtomicIR(fixture(c), c);
});
test('4.1 ABI mutations cannot silently revert controls or change volatility', () => {
  const c = msl41AtomicCases.find(c => c.status === 0 && c.space === 'device' && c.op === 'add' && c.order === 'acq_rel' && c.flags === 1 && c.kind === 1 && !c.volatile);
  const good = fixture(c);
  const controls = 'i32 4, i32 2, i32 1, i1 false';
  for (const bad of ['i32 0, i32 2, i32 1, i1 false', 'i32 4, i32 1, i32 1, i1 false',
    'i32 4, i32 2, i32 0, i1 false', 'i32 4, i32 2, i32 1, i1 true',
    'i32 4, i32 2, i1 true', 'i32 4, i32 2, i1 false, i32 1', 'i32 %v, i32 2, i32 1, i1 false'])
    assert.throws(() => assertMSL41AtomicIR(good.replace(controls, bad), c));
  const vol = {...c, volatile: true};
  assertMSL41AtomicIR(fixture(vol), vol);
  assert.throws(() => assertMSL41AtomicIR(good, vol));
  const relaxed = {...c, order: 'relaxed', flags: null};
  assert.deepEqual(atomicControlArguments(relaxed), ['i32 0', 'i32 2', 'i32 0', 'i1 false']);
});
test('native observations establish ABI, controls, volatile distinction and overload restriction', () => {
  const ref = JSON.parse(readFileSync(new URL('./fixtures/msl41-atomic-reference.json', import.meta.url)));
  const source = readFileSync(new URL('./msl41-atomic-reference.metal', import.meta.url));
  assert.equal(createHash('sha256').update(source).digest('hex'), ref.sourceSha256);
  assert.equal(ref.referenceArchiveSha256, '616dbdc1edae54b9f0a7fda90b9c51b6e8ee2105b745897942931a2a61413c56');
  assert.equal(ref.cases.length, 86); assert.equal(ref.accepted, 58); assert.equal(ref.rejected, 28);
  const observed = name => { const c = ref.cases.find(c => c.name === name); assert(c); return c; };
  const controls = c => c.calls[0].match(/@air[.]atomic[^ (]+\((.*)\)/)[1].split(',').slice(2).map(x => x.trim());
  for (const shape of atomicShapes) for (const order of atomicOrders) for (const explicit of [false, true]) {
    const c = observed(`${shape.space}-${shape.op}-${order}-${Number(explicit)}`);
    if (!explicit && order !== 'relaxed') { assert.notEqual(c.returncode, 0); continue; }
    assert.equal(c.returncode, 0);
    assert.deepEqual(controls(c), atomicControlArguments({metalVersion:410, ...shape, order, flags:explicit ? shape.space === 'device' ? 1 : 2 : null, volatile:false}));
  }
  for (const space of ['device', 'threadgroup']) {
    assert.deepEqual(controls(observed(space + '-volatile')), atomicControlArguments({metalVersion:410,space,order:'acq_rel',flags:space==='device'?1:2,volatile:true}));
    for (const [name, flags] of Object.entries({mem_none:0,mem_device:1,mem_threadgroup:2,mem_texture:4,mem_threadgroup_imageblock:8,mem_object_data:16}))
      assert.deepEqual(controls(observed(`${space}-flags-${name}`)), atomicControlArguments({metalVersion:410,space,order:'acq_rel',flags,volatile:false}));
    assert.equal(observed(space + '-dynamic-order').returncode, 0);
    assert.equal(observed(space + '-dynamic-flags').returncode, 0);
  }
  for (const metal of ['3.2','4.0']) for (const space of ['device','threadgroup'])
    assert.deepEqual(controls(observed(`metal${metal}-${space}-legacy-relaxed`)), ['i32 0','i32 '+(space==='device'?2:1),'i1 true']);
});
test('implementation retains legacy declarations and barriers while versioning only atomic calls', () => {
  const h = readFileSync(new URL('../api/include/metal_atomic',import.meta.url),'utf8');
  assert.match(h,/uint global_add\(device uint\*,uint,uint,uint,uint,bool\)/);
  assert.match(h,/uint global_add\(device uint\*,uint,uint,uint,bool\)/);
  assert.match(h,/SCOPE, 0u, false/); assert.match(h,/SCOPE, true/);
  assert.match(h,/mem_flags flags\)/); assert(!h.includes('mem_flags flags ='));
  assert.match(h,/only constant relaxed atomic order is supported/);
  assert.match(h,/CV atomic_uint/); assert.match(h,/INTRINSIC, volatile, true/);
  const trust=readFileSync(new URL('../api/atomic_trust.inc',import.meta.url),'utf8');
  assert.match(trust,/getLangOpts\(\)[.]MetalVersion==410/);
  assert.match(trust,/count=metal41 \? 6u : 5u/);
  assert.match(trust,/ConstAttr/); assert.match(trust,/PureAttr/);
  const api=readFileSync(new URL('../api/air_compiler.cpp',import.meta.url),'utf8');
  assert.match(api,/call->arg_size\(\)!=6/); assert.match(api,/call->arg_size\(\)!=5/);
  assert.match(api,/constant\(5,0\) \|\| constant\(5,1\)/);
  assert.match(api,/flags->getZExtValue\(\)>31/);
});
test('atomic matrix counts and embedded-header identity are pinned consistently', () => {
  assert.equal(msl41AtomicCases.length,166);
  assert.equal(msl41AtomicCases.filter(c=>c.status===0&&c.kind===1).length,66);
  assert.equal(msl41AtomicCases.filter(c=>c.status===0&&c.kind===0).length,50);
  assert.equal(msl41AtomicCases.filter(c=>c.status===3).length,44);
  assert.equal(msl41AtomicCases.filter(c=>c.status===4).length,6);
  const cmake=readFileSync(new URL('../api/CMakeLists.txt',import.meta.url),'utf8');
  const paths=cmake.match(/set\(AIR_HEADER_PATHS ([^)]*)\)/)[1].split(/\s+/).sort();
  const digest=b=>createHash('sha256').update(b).digest('hex');
  const fingerprint='floor-air-header-bundle-v2\n'+paths.map(path=>path+':'+digest(readFileSync(new URL('../api/include/'+path,import.meta.url)))+'\n').join('');
  const hash=digest(fingerprint);
  const config=JSON.parse(readFileSync(new URL('./release-config.json',import.meta.url)));
  assert.equal(config.headerSha256,hash);
  assert(readFileSync(new URL('./probe.mjs',import.meta.url),'utf8').includes('const expectedHeader = "'+hash+'";'));
});

test('atomic bindings require exact typed metadata and resource access', () => {
  const c = msl41AtomicCases.find(c => c.status === 0 && c.metalVersion === 410 && c.kind === 1);
  const good = fixture(c);
  for (const [before, after] of [
    ['"air.arg_type_size", i32 4', '"air.arg_type_size", i32 40'],
    ['"air.arg_type_align_size", i32 4', '"air.arg_type_align_size", i32 40'],
    ['"air.address_space", i32 1', '"air.address_space", i32 10'],
    ['"air.buffer"', '"air.texture"'],
    ['"air.read_write"', '"air.read"'],
    ['!"air.address_space", i32 1', '!"air.address_space", i32 1, !"air.address_space", i32 2'],
    ['!"air.read_write"', '!"air.read_write", !"air.read"'],
  ]) assert.throws(() => assertMSL41AtomicIR(good.replace(before, after), c));
  assertMSL41AtomicIR(good, c);
});
test('atomic object pointers cannot promise absent reads or writes', () => {
  const c = msl41AtomicCases.find(c => c.status === 0 && c.metalVersion === 410 && c.kind === 1);
  const good = fixture(c);
  for (const attr of ['readonly', 'writeonly', 'readnone']) for (const [before, after] of [
    ['i32 addrspace(1)* %object,', `i32 addrspace(1)* ${attr} %object,`],
    ['i32 addrspace(1)* %p, i32 %v', `i32 addrspace(1)* ${attr} %p, i32 %v`],
    ['declare i32 @air.atomic.global.add.u.i32(i32 addrspace(1)*,', `declare i32 @air.atomic.global.add.u.i32(i32 addrspace(1)* ${attr},`],
  ]) assert.throws(() => assertMSL41AtomicIR(good.replace(before, after), c));
});

test('atomic work must execute in the single entry block before return', () => {
  const c = msl41AtomicCases.find(c => c.status === 0 && c.metalVersion === 410 && c.kind === 1);
  const good = fixture(c);
  const dead = good.replace('entry:\n', 'entry:\n  ret void\ndead:\n')
    .replace('  ret void\n}', '  unreachable\n}');
  assert.throws(() => assertMSL41AtomicIR(dead, c));
  assertMSL41AtomicIR(good, c);
});
