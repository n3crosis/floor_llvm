// Authored compiler regressions only. This module validates bytes; it never repairs them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { conditionalColorEntries } from './conditional-color.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function string(bytes) {
  assert(bytes.length > 1 && bytes.at(-1) === 0 && !bytes.subarray(0, -1).includes(0), 'Invalid metadata string');
  return text(bytes.subarray(0, -1));
}
function tags(bytes, start, end) {
  assert(start >= 0 && end <= bytes.length && start < end, 'Invalid tag bounds');
  const result = new Map(); let p = start;
  while (p < end) {
    assert(p + 4 <= end, 'Truncated tag');
    const name = bytes.toString('latin1', p, p + 4); p += 4;
    if (name === 'ENDT') { assert.equal(p, end, 'ENDT must coincide with record end'); return result; }
    assert(/^[A-Z0-9]{4}$/.test(name) && !result.has(name), 'Invalid or duplicate tag');
    assert(p + 2 <= end, 'Truncated tag length');
    const size = bytes.readUInt16LE(p); p += 2;
    assert(p + size <= end, 'Tag payload exceeds record');
    result.set(name, bytes.subarray(p, p + size)); p += size;
  }
  assert.fail('Missing record ENDT');
}
function required(list, name, length) {
  const value = list.get(name);
  assert(value && (length === undefined || value.length === length), 'Missing or malformed '+name);
  return value;
}
function u64(bytes, at = 0) {
  assert(at >= 0 && at + 8 <= bytes.length, 'Truncated uint64');
  const value = bytes.readBigUInt64LE(at);
  assert(value <= BigInt(Number.MAX_SAFE_INTEGER), 'Unsafe uint64');
  return Number(value);
}
function constants(payload) {
  if (!payload) return [];
  assert(payload.length >= 2, 'Truncated CNST count');
  const count = payload.readUInt16LE(0), result = []; let p = 2;
  for (let i = 0; i < count; i++) {
    const end = payload.indexOf(0, p);
    assert(end > p && end + 5 <= payload.length, 'Truncated CNST entry');
    const name = string(payload.subarray(p, end + 1)); p = end + 1;
    const type = payload[p++], index = payload.readUInt16LE(p); p += 2;
    const active = payload[p++]; assert(active === 0 || active === 1, 'Invalid CNST active flag');
    assert(!result.some(r => r.name === name || r.index === index), 'Duplicate CNST name or index');
    result.push({ name, type, index, active });
  }
  assert.equal(p, payload.length, 'CNST count/payload mismatch');
  return result;
}
// Expectations come from the same parameter specifications used to check IR.
// Each set is checked within its named function's actual OFFT public record.
export function metadataExpectations(test) {
  if (test.shader === 'conditional-color') return conditionalColorEntries;
  if (/^uint-color-ios/.test(test.name)) return [{ entry: 'uint_side', parameters: [{ constant: 'enabled', constantIndex: 203 }] }];
  if (/^color-side-ios/.test(test.name)) return [{ entry: 'color_side', parameters: [{ constant: 'enabled', constantIndex: 200 }] }];
  if (test.shader === 'authored-render') return ['authored_vertex', 'authored_float', 'authored_sint', 'authored_uint'].map(entry => ({ entry, parameters: [] }));
  return null;
}
export function assertMetallibMetadata(input, expected = null) {
  assert(input instanceof Uint8Array && input.length >= 88 && input.length <= 64 * 1024 * 1024, 'Invalid metallib size');
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  assert.equal(bytes.toString('latin1', 0, 4), 'MTLB', 'Missing MTLB magic');
  assert.equal(u64(bytes, 16), bytes.length, 'Wrong metallib length');
  const [fo, fs, po, ps, qo, qs, bo, bs] = Array.from({ length: 8 }, (_, i) => u64(bytes, 24 + 8 * i));
  assert.equal(fo, 88, 'Unexpected function section offset');
  assert(fs >= 8 && fo + 4 + fs < po && po + ps === qo && qo + qs === bo && bo + bs <= bytes.length, 'Invalid section bounds');
  const count = bytes.readUInt32LE(fo); assert(count > 0 && count <= 4096, 'Invalid function count');
  const functions = []; let p = fo + 4;
  for (let i = 0; i < count; i++) {
    assert(p + 8 <= fo + 4 + fs, 'Truncated function record');
    const size = bytes.readUInt32LE(p), end = p + size;
    assert(size >= 8 && end <= fo + 4 + fs, 'Function record exceeds section');
    const list = tags(bytes, p + 4, end), name = string(required(list, 'NAME'));
    assert(!functions.some(fn => fn.name === name), 'Duplicate function name');
    const type = required(list, 'TYPE', 1)[0]; assert(type <= 6, 'Invalid function type');
    const vers = required(list, 'VERS', 8);
    const versions = [0, 4].map(at => [vers.readUInt16LE(at), vers[at + 2], vers[at + 3]]);
    const offsets = required(list, 'OFFT', 24), offset = [0, 8, 16].map(at => u64(offsets, at));
    const sizeBC = u64(required(list, 'MDSZ', 8));
    assert(sizeBC >= 4 && offset[2] + sizeBC <= bs, 'AIR OFFT/MDSZ exceeds section');
    const code = bytes.subarray(bo + offset[2], bo + offset[2] + sizeBC);
    assert.equal(required(list, 'HASH', 32).toString('hex'), sha(code), 'AIR HASH mismatch');
    functions.push({ name, type, offset, sizeBC, versions, metadata: [] }); p = end;
  }
  assert.equal(p, fo + 4 + fs, 'Function count/section mismatch');
  tags(bytes, p, po); // Extension tags are bounded, never scanned as metadata.
  for (const [i, fn] of functions.entries()) {
    assert.equal(fn.offset[2], i ? functions[i - 1].offset[2] + functions[i - 1].sizeBC : 0, 'Noncontiguous AIR records');
    for (const [j, kind, start, length] of [[0, 'public', po, ps], [1, 'private', qo, qs]]) {
      const relative = fn.offset[j], next = functions[i + 1]?.offset[j] ?? length;
      if (i === 0) assert.equal(relative, 0, 'Metadata starts after section boundary');
      assert(relative >= 0 && next <= length && next - relative >= 8, 'Metadata OFFT outside section');
      const at = start + relative, end = start + next, size = bytes.readUInt32LE(at);
      assert.equal(size, end - at, `${fn.name} ${kind}: metadata size must include its four-byte prefix`);
      const list = tags(bytes, at + 4, end);
      const cnst = constants(list.get('CNST'));
      if (kind === 'private') assert(!list.has('CNST'), 'Function constants appeared in private metadata');
      fn.metadata.push({ kind, offset: at, relativeOffset: relative, bytes: size, tags: [...list.keys()], constants: cnst, payloadSha256: sha(bytes.subarray(at + 4, end)) });
    }
  }
  assert.equal(functions.at(-1).offset[2] + functions.at(-1).sizeBC, bs, 'Unclaimed AIR bytes');
  if (expected) {
    assert.deepEqual(functions.map(fn => fn.name).sort(), expected.map(spec => spec.entry).sort(), 'Wrong metallib entry set');
    for (const spec of expected) {
      const fn = functions.find(fn => fn.name === spec.entry);
      const wanted = spec.parameters.map(param => ({ name: param.constant, type: 53, index: param.constantIndex, active: 1 })).sort((a, b) => a.index - b.index);
      assert.deepEqual([...fn.metadata[0].constants].sort((a, b) => a.index - b.index), wanted, 'Wrong per-entry parameter function constants: '+spec.entry);
    }
  }
  return { encoding: 'prefix-inclusive', functions, parameterBound: expected !== null };
}
