// Authored, bounded uint atomic RMW contracts (MSL 4.1 sections 6.16.1/6.16.4.5).
// Expected cases and synthetic validators are not compiler or GPU execution evidence.
import assert from 'node:assert/strict';
import { assertMetalLanguageMetadataIR } from './metal-language.mjs';
import { assertMetallibMetadata } from './metallib-metadata.mjs';
export const atomicShapes = Object.freeze([
  { space: 'device', op: 'add' }, { space: 'device', op: 'min' },
  { space: 'threadgroup', op: 'add' }, { space: 'threadgroup', op: 'min' },
  { space: 'threadgroup', op: 'max' },
]);
export const atomicOrders = Object.freeze(['relaxed', 'acquire', 'release', 'acq_rel', 'seq_cst']);
export const atomicOrderValues = Object.freeze({ relaxed: 0, acquire: 2, release: 3, acq_rel: 4, seq_cst: 5 });
const header = '#include <metal_stdlib>\nusing namespace metal;\n';
export function atomicSource({space, op, order = 'relaxed', flags = null, volatile = false}) {
  assert(atomicShapes.some(s => s.space === space && s.op === op), 'Unsupported atomic operation/address space');
  assert(atomicOrders.includes(order), 'Unsupported atomic order');
  assert(flags === null || (Number.isInteger(flags) && flags >= 0 && flags <= 31), 'Invalid memory flags');
  assert.equal(typeof volatile, 'boolean');
  return header + `kernel void atomic_probe(${space} ${volatile ? 'volatile ' : ''}atomic_uint* object [[${space === 'device' ? 'buffer' : 'threadgroup'}(0)]], device uint* output [[buffer(1)]], constant uint* input [[buffer(2)]]) {\n` +
    `  output[0] = atomic_fetch_${op}_explicit(object, input[0], memory_order_${order}${flags === null ? '' : ', mem_flags(' + flags + ')'});\n}\n`;
}
export const msl41AtomicCases = [];
function positive(c) {
  const metalVersion = c.metalVersion ?? 410;
  msl41AtomicCases.push({api: 3, ios: 27, metalVersion: 410, math: 0, kind: 1,
    air: [2, metalVersion === 320 ? 7 : metalVersion === 400 ? 8 : 9, 0],
    language: metalVersion === 320 ? [3, 2, 0] : metalVersion === 400 ? [4, 0, 0] : [4, 1, 0],
    entry: 'atomic_probe', stage: 'kernel', volatile: false, ...c,
    source: c.source ?? atomicSource(c), status: 0, msl41Atomic: true});
}
for (const shape of atomicShapes) for (const order of atomicOrders) for (const explicit of [false, true]) for (const kind of [0, 1]) {
  // Apple's 4.1 three-argument overload remains relaxed-only.
  if (!explicit && order !== 'relaxed') continue;
  const flags = explicit ? (shape.space === 'device' ? 1 : 2) : null;
  positive({name: `msl41-atomic-${shape.space}-${shape.op}-${order}-${explicit ? 'flags' : 'default'}-kind${kind}`,
    ...shape, order, flags, kind});
}
// Cover fast math independently without duplicating every integer-only operation.
for (const order of atomicOrders) for (const kind of [0, 1])
  positive({name: `msl41-atomic-fast-add-${order}-kind${kind}`, space: 'device', op: 'add', order, flags: 1, math: 1, kind});
for (const shape of atomicShapes) for (const kind of [0, 1])
  positive({name: `msl41-atomic-volatile-${shape.space}-${shape.op}-kind${kind}`,
    ...shape, order: 'acq_rel', flags: shape.space === 'device' ? 1 : 2, volatile: true, kind});
for (const space of ['device', 'threadgroup']) for (const flags of [0, 1, 2, 3, 4, 8, 16, 31])
  positive({name: `msl41-atomic-flags-${space}-${flags}`, space, op: 'add', order: 'acq_rel', flags});
for (const [ios, metalVersion] of [[18, 320], [26, 400]]) for (const shape of atomicShapes) for (const kind of [0, 1])
  positive({name: `msl41-atomic-legacy-${metalVersion}-${shape.space}-${shape.op}-kind${kind}`,
    ios, metalVersion, ...shape, order: 'relaxed', flags: null, kind});
function negative(name, body, diagnosticPattern, options = {}) {
  msl41AtomicCases.push({name: 'msl41-atomic-reject-' + name, api: 3, ios: 27, metalVersion: 410, math: 0, kind: 1,
    source: header + 'kernel void bad(device atomic_uint* object [[buffer(0)]], constant uint* input [[buffer(1)]]) { ' + body + ' }\n',
    diagnosticPattern, status: 3, msl41Atomic: true, ...options});
}
for (const [name, args, pattern] of [
  ['order-one', 'memory_order(1), mem_flags::mem_device', 'constant valid atomic memory order'],
  ['order-unknown', 'memory_order(17), mem_flags::mem_device', 'constant valid atomic memory order'],
  ['order-dynamic', 'memory_order(input[0]), mem_flags::mem_device', 'constant valid atomic memory order'],
  ['flags-unknown', 'memory_order_acq_rel, mem_flags(32)', 'constant valid atomic memory flags'],
  ['flags-negative', 'memory_order_acq_rel, mem_flags(-1)', 'constant valid atomic memory flags'],
  ['flags-dynamic', 'memory_order_acq_rel, mem_flags(input[0])', 'constant valid atomic memory flags'],
  ['order-type', '2u, mem_flags::mem_device', 'no matching function|cannot initialize'],
  ['flags-type', 'memory_order_acq_rel, 1u', 'no matching function|cannot initialize'],
]) negative(name, 'atomic_fetch_add_explicit(object, 1u, ' + args + ');', pattern);
for (const [api, ios, metalVersion] of [[1, 18, 320], [2, 26, 320], [3, 18, 320], [3, 26, 400]]) {
  negative(`legacy-order-${api}-${metalVersion}`, 'atomic_fetch_add_explicit(object, 1u, memory_order(2));', 'only constant relaxed atomic order', {api, ios, metalVersion});
  negative(`legacy-flags-${api}-${metalVersion}`, 'atomic_fetch_add_explicit(object, 1u, memory_order_relaxed, mem_flags::mem_threadgroup);', 'no matching function', {api, ios, metalVersion});
  negative(`macro-spoof-${api}-${metalVersion}`, '', 'assembly|asm', {api, ios, metalVersion,
    source: '#undef __METAL_VERSION__\n#define __METAL_VERSION__ 410\n' + atomicSource({space: 'device', op: 'add', order: 'acquire', flags: 1})});
}
for (const shape of atomicShapes) for (const order of atomicOrders.filter(o => o !== 'relaxed'))
  negative(`three-argument-${shape.space}-${shape.op}-${order}`, '', 'only constant relaxed atomic order', {source: atomicSource({...shape, order, flags: null})});
// The API's post-optimization control gate also covers direct helper calls.
for (const [name, controls] of [
  ['order-one', '1u,2u,1u,false'], ['order-dynamic', 'input[0],2u,1u,false'],
  ['scope', '4u,1u,1u,false'], ['flags-unknown', '4u,2u,32u,false'],
  ['flags-dynamic', '4u,2u,input[0],false'], ['volatile-dynamic', '4u,2u,1u,bool(input[0])'],
]) negative('internal-' + name, `__atomic_detail::global_add(reinterpret_cast<device uint*>(object), input[0], ${controls});`, 'Unsupported shader stage', {status: 4});
for (const spoof of [false, true]) negative('forged-asm-' + spoof, '', 'assembly|asm', {
  source: header + (spoof ? '#line 1 "/include/metal_atomic"\n' : '') +
    'uint fake(device uint*,uint,uint,uint,uint,bool) __asm__("air.atomic.global.add.u.i32");\n' +
    'kernel void bad(device uint* object [[buffer(0)]]) { fake(object,1u,4u,2u,1u,false); }\n'});
negative('unsupported-device-max', 'atomic_fetch_max_explicit(object,1u,memory_order_acq_rel,mem_flags::mem_device);', 'no matching function');
negative('const-object', 'atomic_fetch_add_explicit((device const atomic_uint*)object,1u,memory_order_acq_rel,mem_flags::mem_device);', 'no matching function');
export function assertMSL41AtomicDiagnostic(diagnostics, test) {
  assert.equal(typeof test.diagnosticPattern, 'string');
  assert.match(diagnostics, new RegExp(test.diagnosticPattern, 'i'), 'Wrong atomic rejection reason');
}
export function assertMSL41AtomicMetallib(bytes, test) {
  const info = assertMetallibMetadata(bytes);
  assert.equal(Buffer.from(bytes).readUInt16LE(12), test.ios, 'Wrong atomic deployment target');
  assert.deepEqual(info.functions.map(fn => fn.name), [test.entry], 'Wrong atomic entry');
  for (const fn of info.functions) assert.deepEqual(fn.versions, [test.air, test.language], 'Wrong atomic AIR/MSL versions');
  return info;
}

// This parser deliberately accepts only the straight-line, typed-pointer probe
// shape. It validates data flow and metadata, not arbitrary user LLVM programs.
const variable = '%[-a-zA-Z$._0-9]+';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function withoutComments(ir) {
  return ir.split('\n').map(line => line.replace(/"(?:\\.|[^"\\])*"|;.*$/g, token => token.startsWith(';') ? '' : token)).join('\n');
}
function only(matches, label) {
  assert.equal(matches.length, 1, 'Missing or duplicate ' + label);
  return matches[0];
}
function node(ir, id) {
  return only([...ir.matchAll(new RegExp('^!' + id + ' = !\\{([^\\n]*)\\}$', 'gm'))], 'metadata node ' + id)[1];
}
function attributes(ir, text) {
  const groups = [...text.matchAll(/#(\d+)\b/g)].map(m => only([...ir.matchAll(new RegExp('^attributes #' + m[1] + ' = \\{([^\\n]*)\\}$', 'gm'))], 'attribute group')[1]);
  const all = text + ' ' + groups.join(' ');
  assert(!/\b(?:readnone|readonly|nosync|speculatable)\b|\bmemory\s*\(/.test(all), 'Atomic memory effects weakened or unsupported');
  return all;
}
function stripArgumentAttrs(arg) {
  return arg.replace(/\b(?:noundef|nocapture|nonnull|zeroext|signext|readonly|writeonly)\b/g, '').replace(/\balign \d+\b/g, '').replace(/\s+/g, ' ').trim();
}
function parameter(arg, space) {
  assert(new RegExp('addrspace\\(' + space + '\\)\\*').test(arg), 'Wrong atomic parameter address space');
  return only([...arg.matchAll(new RegExp('(' + variable + ')$', 'g'))], 'parameter name')[1];
}
function requireMetadataField(text, key, values) {
  // Split only at commas outside LLVM metadata strings. Match complete typed
  // operands, not numeric prefixes, and reject duplicate/conflicting keys.
  const fields = [];
  let begin = 0, quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (quoted && text[i] === '\\') { i++; continue; }
    if (text[i] === '"') quoted = !quoted;
    if (!quoted && text[i] === ',') { fields.push(text.slice(begin, i).trim()); begin = i + 1; }
  }
  assert(!quoted, 'Unterminated atomic metadata string');
  fields.push(text.slice(begin).trim());
  const token = '!"' + key + '"';
  const indexes = fields.flatMap((x, i) => x === token ? [i] : []);
  assert.equal(indexes.length, 1, 'Missing or duplicate atomic metadata field ' + key);
  assert.deepEqual(fields.slice(indexes[0] + 1, indexes[0] + 1 + values.length), values,
    'Wrong atomic metadata field ' + key);
}
function requireReadWritePointer(text) {
  assert(!/\b(?:readonly|writeonly|readnone)\b/.test(text), 'Atomic pointer memory effects weakened');
}
function checkBindings(ir, test, signature) {
  let found = 0;
  for (const stage of ['kernel', 'fragment', 'vertex']) {
    const roots = [...ir.matchAll(new RegExp('^!air[.]' + stage + ' = !\\{([^\\n]*)\\}$', 'gm'))];
    assert(roots.length <= 1, 'Duplicate stage metadata');
    for (const root of roots) {
      assert(/^!\d+(?:, !\d+)*$|^$/.test(root[1]), 'Malformed stage root');
      for (const id of root[1].match(/\d+/g) ?? []) {
        const entry = node(ir, id);
        if (!entry.includes('@' + test.entry + ',')) continue;
        found++;
        assert.equal(stage, test.stage, 'Wrong atomic entry stage');
        const argsNode = entry.match(/, !\d+, !(\d+)$/);
        assert(argsNode, 'Malformed atomic entry');
        const ids = node(ir, argsNode[1]);
        assert(/^!\d+, !\d+, !\d+$/.test(ids), 'Wrong atomic binding count');
        for (const [i, argID] of (ids.match(/\d+/g) ?? []).entries()) {
          const arg = node(ir, argID);
          assert(arg.startsWith('i32 ' + i + ', '), 'Wrong atomic argument index');
          requireMetadataField(arg, 'air.buffer', []);
          requireMetadataField(arg, i === 2 ? 'air.read' : 'air.read_write', []);
          const access = arg.match(/!"air\.(?:read|write|read_write)"/g) ?? [];
          assert.equal(access.length, 1, 'Conflicting atomic resource access');
          assert(!/!"air\.(?:texture|sampler|threadgroup)"/.test(arg), 'Conflicting atomic resource kind');
          requireMetadataField(arg, 'air.location_index', ['i32 ' + i, 'i32 1']);
          requireMetadataField(arg, 'air.address_space', ['i32 ' + (i === 0 ? test.space === 'device' ? 1 : 3 : i === 1 ? 1 : 2)]);
          requireMetadataField(arg, 'air.arg_type_size', ['i32 4']);
          requireMetadataField(arg, 'air.arg_type_align_size', ['i32 4']);
          requireMetadataField(arg, 'air.arg_name', ['!"' + ['object', 'output', 'input'][i] + '"']);
        }
      }
    }
  }
  assert.equal(found, 1, 'Atomic entry must have exactly one stage registration');
  const params = signature.split(',').map(x => x.trim());
  assert.equal(params.length, 3, 'Wrong atomic entry signature');
  requireReadWritePointer(params[0]);
  return [parameter(params[0], test.space === 'device' ? 1 : 3), parameter(params[1], 1), parameter(params[2], 2)];
}
export function atomicControlArguments(test) {
  if (test.metalVersion < 410) return ['i32 0', 'i32 ' + (test.space === 'device' ? 2 : 1), 'i1 true'];
  return ['i32 ' + atomicOrderValues[test.order], 'i32 ' + (test.space === 'device' ? 2 : 1),
    'i32 ' + (test.flags ?? 0), 'i1 ' + (test.volatile ? 'true' : 'false')];
}
export function assertMSL41AtomicIR(raw, test) {
  const ir = withoutComments(raw);
  assertMetalLanguageMetadataIR(ir, test);
  const entry = escape(test.entry);
  const definition = only([...ir.matchAll(new RegExp('^define [^\\n]*?void @' + entry + '\\(([^\\n]*)\\)([^\\n]*) \\{\\n([\\s\\S]*?)^\\}', 'gm'))], 'atomic entry definition');
  const [object, output, input] = checkBindings(ir, test, definition[1]);
  attributes(ir, definition[2]);
  const body = definition[3];
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
  // An optional first block label is harmless; additional blocks can hide
  // otherwise correctly-shaped atomics behind an early return.
  if (/^[-a-zA-Z$._0-9]+:$/.test(lines[0])) lines.shift();
  assert(!lines.some(line => /:$/.test(line)), 'Unexpected atomic probe basic block');
  assert.equal(lines.at(-1), 'ret void', 'Atomic probe must end with its return');
  assert(!/\b(?:br|switch|invoke|callbr|indirectbr|unreachable|resume|catchswitch|catchret|cleanupret|phi|atomicrmw|cmpxchg|fence)\b/.test(body), 'Unexpected atomic probe control flow or instructions');
  const as = test.space === 'device' ? 1 : 3;
  const symbol = 'air.atomic.' + (test.space === 'device' ? 'global' : 'local') + '.' + test.op + '.u.i32';
  const calls = [...body.matchAll(new RegExp('^\\s*(' + variable + ') = (?:tail )?call (?:noundef )?i32 @([^ (]+)\\(([^\\n]*)\\)([^\\n]*)$', 'gm'))];
  const call = only(calls, 'atomic call');
  assert.equal(call[2], symbol, 'Wrong atomic operation');
  assert.equal((body.match(/\bcall\s/g) ?? []).length, 1, 'Unexpected helper call');
  requireReadWritePointer(call[3].split(',')[0]);
  const args = call[3].split(',').map(stripArgumentAttrs);
  const expected = atomicControlArguments(test);
  assert.equal(args.length, 2 + expected.length, 'Wrong atomic ABI arity');
  assert.deepEqual(args.slice(2), expected, 'Wrong atomic order, scope, flags or volatility');
  const ptr = args[0].match(new RegExp('^i32 addrspace\\(' + as + '\\)\\* (' + variable + ')$'));
  const operand = args[1].match(new RegExp('^i32 (' + variable + ')$'));
  assert(ptr && operand, 'Wrong atomic argument types or non-dynamic operand');
  const definitions = new Map();
  for (const m of body.matchAll(new RegExp('^\\s*(' + variable + ') = ([^\\n]+)$', 'gm'))) {
    assert(![object, output, input].includes(m[1]) && !definitions.has(m[1]), 'Duplicate SSA definition'); definitions.set(m[1], m[2]);
  }
  function root(v, seen = new Set()) {
    assert(!seen.has(v), 'Cyclic atomic pointer provenance'); seen.add(v);
    if ([object, output, input].includes(v)) return v;
    const def = definitions.get(v); assert(def, 'Unknown atomic pointer provenance');
    const cast = def.match(new RegExp('^bitcast [^\\n]*addrspace\\((\\d+)\\)\\* (' + variable + ') to i32 addrspace\\((\\d+)\\)\\*$'));
    if (cast) {assert.equal(cast[1], cast[3], 'Changed atomic pointer address space'); return root(cast[2], seen);}
    const gep = def.match(new RegExp('^getelementptr(?: inbounds)? [^\\n]*?, [^\\n]*? (' + variable + ')((?:, i(?:32|64) 0){1,2})$'));
    assert(gep, 'Atomic pointer is not an identity cast or zero-index field');
    return root(gep[1], seen);
  }
  assert.equal(root(ptr[1]), object, 'Atomic operates on the wrong resource');
  const load = definitions.get(operand[1])?.match(new RegExp('^load i32, i32 addrspace\\(2\\)\\* (' + variable + '), align 4(?:,.*)?$'));
  assert(load, 'Atomic operand is not a dynamic input load');
  assert.equal(root(load[1]), input, 'Atomic operand comes from the wrong resource');
  const stores = [...body.matchAll(new RegExp('^\\s*store i32 (' + variable + '), i32 addrspace\\(1\\)\\* (' + variable + '), align 4(?:,.*)?$', 'gm'))];
  const store = only(stores, 'atomic result store');
  assert.equal(store[1], call[1], 'Atomic result was replaced');
  assert.equal(root(store[2]), output, 'Atomic result stored to wrong resource');
  assert.equal((body.match(/\bstore\b/g) ?? []).length, 1, 'Unexpected store');
  assert(body.indexOf(operand[1] + ' = ') < body.indexOf(call[1] + ' = ') && body.indexOf(call[1] + ' = ') < body.indexOf(store[0]), 'Atomic input/output sequence changed');
  assert.equal((body.match(/\bret void\b/g) ?? []).length, 1, 'Missing atomic return');
  const decl = only([...ir.matchAll(new RegExp('^declare (?:noundef )?i32 @' + escape(symbol) + '\\(([^\\n]*)\\)([^\\n]*)$', 'gm'))], 'atomic declaration');
  requireReadWritePointer(decl[1].split(',')[0]);
  assert.deepEqual(decl[1].split(',').map(stripArgumentAttrs), ['i32 addrspace(' + as + ')*', 'i32', ...expected.map(a => a.split(' ')[0])], 'Wrong atomic declaration signature');
  attributes(ir, decl[2]); attributes(ir, call[4]);
}
