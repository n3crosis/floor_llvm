import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertMetallibMetadata, metadataExpectations } from './metallib-metadata.mjs';
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const tag = (name, payload) => Buffer.concat([Buffer.from(name), u16(payload.length), payload]);
const end = Buffer.from('ENDT');
const record = payload => Buffer.concat([u32(payload.length + 4), payload]);
const cnst = (name, index) => tag('CNST', Buffer.concat([u16(1), Buffer.from(name+'\0'), Buffer.from([53]), u16(index), Buffer.from([1])]));
function fixture() {
  const pub = [record(end), record(Buffer.concat([cnst('enabled', 203), end]))];
  const priv = [record(end), record(end)], codes = [Buffer.from('AIR0'), Buffer.from('AIR1')];
  const names = ['vertex', 'fragment'];
  const rows = names.map((name, i) => record(Buffer.concat([
    tag('NAME', Buffer.from(name+'\0')), tag('TYPE', Buffer.from([i])),
    tag('HASH', createHash('sha256').update(codes[i]).digest()),
    tag('OFFT', Buffer.concat([u64(i ? pub[0].length : 0), u64(i ? priv[0].length : 0), u64(i * 4)])),
    tag('MDSZ', u64(4)), tag('VERS', Buffer.alloc(8)), end,
  ])));
  const fs = rows.reduce((n, b) => n + b.length, 0), po = 92 + fs + 4, ps = pub[0].length + pub[1].length;
  const qo = po + ps, qs = 16, bo = qo + qs;
  const header = Buffer.concat([Buffer.from('MTLB'), Buffer.alloc(12), u64(bo + 8), ...[88, fs, po, ps, qo, qs, bo, 8].map(u64)]);
  return Buffer.concat([header, u32(2), ...rows, end, ...pub, ...priv, ...codes]);
}
const expected = [{ entry: 'vertex', parameters: [] }, { entry: 'fragment', parameters: [{ constant: 'enabled', constantIndex: 203 }] }];
function locations(bytes) {
  const info = assertMetallibMetadata(bytes, expected);
  return { info, pub: info.functions.map(f => f.metadata[0].offset), priv: info.functions.map(f => f.metadata[1].offset), cnst: info.functions[1].metadata[0].offset + 4 };
}
test('valid inclusive empty/nonempty records and exact per-entry constants', () => {
  const info = assertMetallibMetadata(fixture(), expected);
  assert.equal(info.functions[0].metadata[0].bytes, 8);
  assert.equal(info.functions[1].metadata[0].constants[0].index, 203);
  assert.equal(info.parameterBound, true);
});
for (const kind of ['pub', 'priv']) for (const index of [0, 1]) test(`reject exclusive prefix in ${kind} entry ${index}`, () => {
  const b = fixture(), at = locations(b)[kind][index]; b.writeUInt32LE(b.readUInt32LE(at) - 4, at);
  assert.throws(() => assertMetallibMetadata(b, expected), /include its four-byte prefix/);
});
const mutations = {
  'length overrun': b => b.writeUInt32LE(0xffffffff, locations(b).pub[1]),
  'missing end marker': b => b.write('NOPE', locations(b).priv[1] + 4),
  'tag length crosses record': b => b.writeUInt16LE(0xffff, locations(b).cnst + 4),
  'wrong CNST count': b => b.writeUInt16LE(2, locations(b).cnst + 6),
  'wrong constant index': b => b.writeUInt16LE(200, locations(b).cnst + 17),
  'wrong constant type': b => { b[locations(b).cnst + 16] = 29; },
  'wrong constant active': b => { b[locations(b).cnst + 19] = 0; },
  'AIR hash mismatch': b => { b[b.length - 1] ^= 1; },
  'wrong function count': b => b.writeUInt32LE(1, 88),
  'section overrun': b => b.writeBigUInt64LE(BigInt(b.length), 48),
  'unsafe offset': b => b.writeBigUInt64LE(2n ** 63n, 40),
  'OFFT points into record': b => { const at = b.indexOf('OFFT'); b.writeBigUInt64LE(1n, at + 6); },
  'AIR overlaps': b => { const at = b.indexOf('OFFT', b.indexOf('OFFT') + 4); b.writeBigUInt64LE(0n, at + 22); },
  'duplicate name tag': b => { const at = b.indexOf('VERS'); b.write('NAME', at); },
};
for (const [name, mutate] of Object.entries(mutations)) test('reject '+name, () => {
  const b = fixture(); mutate(b); assert.throws(() => assertMetallibMetadata(b, expected));
});
test('correct global constants do not excuse wrong per-entry binding', () => {
  const wrong = [{ ...expected[0], parameters: expected[1].parameters }, { ...expected[1], parameters: [] }];
  assert.throws(() => assertMetallibMetadata(fixture(), wrong), /per-entry parameter/);
});
test('missing or duplicated expected entries rejected', () => {
  for (const e of [expected.slice(1), [expected[0], expected[0]]]) assert.throws(() => assertMetallibMetadata(fixture(), e), /entry set/);
});
test('conditional expectations retain sparse parameter pairing', () => {
  const e = metadataExpectations({ shader: 'conditional-color' }).find(s => s.entry === 'conditional_sparse');
  assert.deepEqual(e.parameters.map(p => [p.index, p.slot, p.constantIndex]), [[1, 7, 207], [2, 2, 202]]);
});
