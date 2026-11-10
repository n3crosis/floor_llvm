import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { metalLanguageCases, metalLanguageTuples, assertMetalLanguageMetadataIR, assertMetalLanguageIR, assertMetalLanguageMetallib, assertMetalLanguageDiagnostic } from './metal-language.mjs';
const cases = metalLanguageCases();
function ir(t) { return `target triple = "air64-apple-ios${t.ios}.0.0"\ndefine void @mode_probe() { ret void }\n!air.version = !{!7}\n!air.language_version = !{!19}\n!7 = !{${t.air.map(x=>'i32 '+x).join(', ')}}\n!19 = !{!"Metal", ${t.language.map(x=>'i32 '+x).join(', ')}}\n`; }
const u16 = n => {const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const u32 = n => {const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64 = n => {const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const tag = (n,p) => Buffer.concat([Buffer.from(n),u16(p.length),p]);
const end=Buffer.from('ENDT');
function metallib(t) {
  const code=Buffer.from('AIR0');
  const ver=v=>Buffer.concat([u16(v[0]),Buffer.from(v.slice(1))]);
  const payload=Buffer.concat([tag('NAME',Buffer.from('mode_probe\0')),tag('TYPE',Buffer.from([2])),tag('HASH',createHash('sha256').update(code).digest()),tag('VERS',Buffer.concat([ver(t.air),ver(t.language)])),tag('OFFT',Buffer.alloc(24)),tag('MDSZ',u64(4)),end]);
  const row=Buffer.concat([u32(payload.length+4),payload]),po=92+row.length+4,qo=po+8,bo=qo+8;
  const header=Buffer.concat([Buffer.from('MTLB'),Buffer.alloc(8),u16(t.ios),Buffer.alloc(2),u64(bo+4),...[88,row.length,po,8,qo,8,bo,4].map(u64)]);
  return Buffer.concat([header,u32(1),row,end,u32(8),end,u32(8),end,code]);
}
test('case inventory is unique and covers exact tuples and legacy ABI',()=>{
  assert.equal(new Set(cases.map(c=>c.name)).size,cases.length);
  assert.equal(cases.filter(c=>c.api===3&&c.status===0&&c.kind===0).length,6);
  assert.equal(cases.filter(c=>c.api<3&&c.status===0).length,4);
  assert(cases.some(c=>c.name==='metal41-reject-cxx20-warning-bypass'));
});
for(const tuple of metalLanguageTuples) test('IR and VERS use actual version'+tuple.metalVersion,()=>{
  const t={api:3,...tuple};assertMetalLanguageIR(ir(t),t);assertMetalLanguageMetallib(metallib(t),t);
});
test('IR parser rejects wrong version, target, malformed node and duplicates',()=>{
  const t={api:3,...metalLanguageTuples[2]},text=ir(t);
  for(const wrong of [text.replace('ios27','ios26'),text.replace('i32 9','i32 7'),text.replace('i32 4, i32 1','i32 3, i32 2'),text.replace('!19 =','!20 ='),text+'!air.version = !{!7}\n'])
    assert.throws(()=>assertMetalLanguageIR(wrong,t));
});
test('VERS parser rejects relabeling and target mismatches',()=>{
  const t={api:3,...metalLanguageTuples[2]};
  let b=metallib(t);b[b.indexOf('VERS')+6+6]=0;assert.throws(()=>assertMetalLanguageMetallib(b,t),/VERS/);
  b=metallib(t);b.writeUInt16LE(26,12);assert.throws(()=>assertMetalLanguageMetallib(b,t),/deployment/);
  assert.throws(()=>assertMetalLanguageMetallib(metallib(t),{...t,api:2}),/Legacy/);
});

test('metadata helper is reusable without weakening entry-specific checks',()=>{
  const t={api:3,...metalLanguageTuples[2]}, text=ir(t).replace('mode_probe','bit_interleave_probe');
  assertMetalLanguageMetadataIR(text,t);
  assert.throws(()=>assertMetalLanguageIR(text,t),/language probe entry/);
  assert.throws(()=>assertMetalLanguageMetadataIR(text.replace('i32 9','i32 7'),t),/AIR version/);
});

test('rejections require matching diagnostics rather than arbitrary frontend failure',()=>{
  const rejected=cases.filter(c=>c.status===3);
  assert.equal(rejected.length,22);
  for(const c of rejected) {
    assert(c.diagnosticPattern);
    assert.throws(()=>assertMetalLanguageDiagnostic('unrelated frontend failure',c),/Wrong language rejection reason/);
  }
  assert(cases.some(c=>c.name==='metal41-cxx17-nested-namespace'&&c.status===0));
});

test('__extension__ bypass variants require hard-error diagnostics',()=>{
  for(const suffix of ['extension-bypass','extension-macro-bypass','extension-expression-bypass']) {
    const c=cases.find(c=>c.name==='metal41-reject-cxx20-'+suffix);
    assert(c&&c.status===3);
    assertMetalLanguageDiagnostic('__extension__ is not supported in the Metal 4.1 API',c);
    assert.throws(()=>assertMetalLanguageDiagnostic('other extension warning',c));
  }
  assert(cases.some(c=>c.name==='metal41-reject-cxx20-system-marker-bypass'));
});

test('Apple-rejected noexcept is negative in every explicit syntactic form',()=>{
  const rejected=cases.filter(c=>c.name.includes('noexcept'));
  assert.equal(rejected.length,6);
  for(const c of rejected) {
    assert.equal(c.status,3);
    assertMetalLanguageDiagnostic('noexcept is not supported in the Metal 4.1 API',c);
    assert.throws(()=>assertMetalLanguageDiagnostic('unrelated frontend failure',c));
  }
  const positive=cases.find(c=>c.name==='metal41-cxx17-nested-namespace');
  assert.equal(positive.status,0);
  assert(positive.source.includes('namespace cxx17::nested'));
  assert(!positive.source.includes('noexcept'));
});

test('nested namespace positive matches the native Apple-accepted constant control',()=>{
  const positive=cases.find(c=>c.name==='metal41-cxx17-nested-namespace');
  assert(positive.source.includes('constant constexpr uint value = 17u;'));
  assert.equal(createHash('sha256').update(positive.source).digest('hex'),
    '333cfac87a9fb6931ea4edbc9627dd1d1bbdbe04e0374cd0fc9e451eed03dde1');
});
