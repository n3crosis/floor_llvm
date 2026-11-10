// Authored language-mode contract. This does not certify complete MSL support.
import assert from 'node:assert/strict';
import { assertMetallibMetadata } from './metallib-metadata.mjs';
export const metalLanguageTuples = Object.freeze([
  { ios: 18, metalVersion: 320, air: [2, 7, 0], language: [3, 2, 0] },
  { ios: 26, metalVersion: 400, air: [2, 8, 0], language: [4, 0, 0] },
  { ios: 27, metalVersion: 410, air: [2, 9, 0], language: [4, 1, 0] },
]);
const head = '#include <metal_stdlib>\nusing namespace metal;\n';
function source(version) {
  return head + `#if !defined(__METAL__) || __METAL__ != 1\n#error unified Metal macro absent\n#endif\nstatic_assert(__METAL_VERSION__ == ${version}, "wrong selected language");\n` +
    (version === 410 ? 'static_assert(__cplusplus == 201703L, "Metal 4.1 must use C++17");\n' : '') +
    'kernel void mode_probe(device uint* out [[buffer(0)]]) { out[0] = __METAL_VERSION__; }\n';
}
export function metalLanguageCases() {
  const cases = [];
  for (const tuple of metalLanguageTuples) for (const math of [0, 1]) for (const kind of [0, 1]) {
    cases.push({ name: `metal-mode-${tuple.metalVersion}-ios${tuple.ios}-math${math}-kind${kind}`,
      api: 3, ...tuple, math, kind, source: source(tuple.metalVersion), status: 0, metalLanguage: true });
  }
  // v1/v2 retain their language3.2 behavior even on their newer legacy target.
  for (const api of [1, 2]) for (const ios of [18, 26])
    cases.push({ name: `legacy-v${api}-ios${ios}-language320`, api, ios, kind: 1, math: 0,
      metalVersion: 320, air: [2, 7, 0], language: [3, 2, 0], source: source(320),
      status: 0, metalLanguage: true });
  for (const [ios, metalVersion] of [[18, 400], [18, 410], [26, 320], [26, 410], [27, 320], [27, 400], [27, 0], [27, 411], [28, 410], [0, 410]])
    cases.push({ name: `bad-metal-tuple-${ios}-${metalVersion}`, api: 3, ios, metalVersion,
      source: source(410), status: 2, metalLanguage: true });
  for (const api of [1, 2]) cases.push({ name: `legacy-v${api}-reject-ios27`, api, ios: 27,
    source: source(320), status: 2, metalLanguage: true });
  for (const [key, value] of [['kind', 2], ['math', 2]]) cases.push({ name: `metal41-bad-${key}`,
    api: 3, ios: 27, metalVersion: 410, source: source(410), status: 2, metalLanguage: true, [key]: value });
  const body = 'kernel void mode_probe(device uint* out [[buffer(0)]])';
  const rejected = {
    'cxx20-concept': 'template<class T> concept Integral = true;\n' + body + '{ out[0]=0; }',
    'cxx20-designator': 'struct S { uint x; };\n' + body + '{ S s{.x=1}; out[0]=s.x; }',
    'cxx20-warning-bypass': '#pragma clang diagnostic ignored "-Weverything"\nstruct S { uint x; };\n' + body + '{ S s{.x=1}; out[0]=s.x; }',
    'cxx20-extension-bypass': 'struct S { uint x; };\n' + body + '{ __extension__ S s{.x=1}; out[0]=s.x; }',
    'cxx20-extension-macro-bypass': '#define EXT __extension__\nstruct S { uint x; };\n' + body + '{ EXT S s{.x=1}; out[0]=s.x; }',
    'cxx20-extension-expression-bypass': body + '{ out[0]=__extension__ ([]<class T>(T x){return x;})(1u); }',
    'cxx20-system-marker-bypass': '# 1 "fake-system.h" 3\nstruct S { uint x; };\n' + body + '{ S s{.x=1}; out[0]=s.x; }',
    'cxx20-template-lambda': body + '{ auto f=[]<class T>(T x){return x;}; out[0]=f(1u); }',
    'goto': body + '{ goto label; label: out[0]=0; }',
    'noexcept-operator': body + '{ out[0]=noexcept(1+1); }',
    'noexcept-specifier': 'uint no_throw(uint value) noexcept { return value; }\n' + body + '{ out[0]=no_throw(1u); }',
    'noexcept-conditional-specifier': 'uint no_throw(uint value) noexcept(false) { return value; }\n' + body + '{ out[0]=no_throw(1u); }',
    'noexcept-macro-specifier': '#define NT noexcept\nuint no_throw(uint value) NT { return value; }\n' + body + '{ out[0]=no_throw(1u); }',
    'noexcept-function-type': 'using no_throw = uint(uint) noexcept;\n' + body + '{ out[0]=1u; }',
    'noexcept-lambda-specifier': body + '{ auto f=[](uint value) noexcept { return value; }; out[0]=f(1u); }',
    'dynamic-new': body + '{ thread int* p=new int; out[0]=*p; }',
    'delete': body + '{ thread int value=1; delete &value; out[0]=0; }',
    'derived-class': 'struct A { uint x; }; struct B : A {};\n' + body + '{ out[0]=0; }',
    'virtual-function': 'struct A { virtual uint f(){return 1;} };\n' + body + '{ out[0]=0; }',
    'thread-local': body + '{ thread_local uint x=1; out[0]=x; }',
    'register': body + '{ register uint x=1; out[0]=x; }',
    'exception': body + '{ try { out[0]=1; } catch (...) { out[0]=0; } }',
  };
  const diagnosticPatterns = {
    'cxx20-concept': 'concept|C\\+\\+20',
    'cxx20-designator': 'designated initializers.*C\\+\\+20',
    'cxx20-warning-bypass': 'designated initializers.*C\\+\\+20',
    'cxx20-template-lambda': 'template parameter list.*lambda.*C\\+\\+20',
    'cxx20-extension-bypass': '__extension__ is not supported in the Metal 4[.]1 API',
    'cxx20-extension-macro-bypass': '__extension__ is not supported in the Metal 4[.]1 API',
    'cxx20-extension-expression-bypass': '__extension__ is not supported in the Metal 4[.]1 API',
    'cxx20-system-marker-bypass': 'designated initializers.*C\\+\\+20',
    'goto': 'goto is not permitted in Metal 4[.]1',
    'noexcept-operator': 'noexcept is not supported in the Metal 4[.]1 API',
    'noexcept-specifier': 'noexcept is not supported in the Metal 4[.]1 API',
    'noexcept-conditional-specifier': 'noexcept is not supported in the Metal 4[.]1 API',
    'noexcept-macro-specifier': 'noexcept is not supported in the Metal 4[.]1 API',
    'noexcept-function-type': 'noexcept is not supported in the Metal 4[.]1 API',
    'noexcept-lambda-specifier': 'noexcept is not supported in the Metal 4[.]1 API',
    'dynamic-new': 'dynamic allocation is not permitted in Metal 4[.]1',
    'delete': 'delete is not permitted in Metal 4[.]1',
    'derived-class': 'derived classes are not permitted in Metal 4[.]1',
    'virtual-function': 'virtual functions are not permitted in Metal 4[.]1',
    'thread-local': 'thread_local|thread-local',
    'register': 'register',
    'exception': 'exception|try',
  };
  for (const [name, text] of Object.entries(rejected)) cases.push({ name: `metal41-reject-${name}`,
    api: 3, ios: 27, metalVersion: 410, kind: 1, source: head + text, status: 3,
    diagnosticPattern: diagnosticPatterns[name], metalLanguage: true });
  cases.push({ name: 'metal41-cxx17-if-constexpr', api: 3, ios: 27, metalVersion: 410,
    air: [2, 9, 0], language: [4, 1, 0], kind: 1, math: 0, status: 0, metalLanguage: true,
    source: head + 'template<class T> constexpr uint f(T x) { if constexpr(sizeof(T)==4) return uint(x); else return 0; }\n' + body + '{ out[0]=f(1u); }' });
  cases.push({ name: 'metal41-cxx17-nested-namespace', api: 3, ios: 27, metalVersion: 410,
    air: [2, 9, 0], language: [4, 1, 0], kind: 1, math: 0, status: 0, metalLanguage: true,
    source: "#include <metal_stdlib>\nusing namespace metal;\nnamespace cxx17::nested { constant constexpr uint value = 17u; }\nkernel void mode_probe(device uint* out [[buffer(0)]]) { out[0] = cxx17::nested::value; }\n" });
  return cases;
}
function namedVersion(ir, name, language) {
  const escaped = name.replaceAll('.', '\\.');
  const roots = [...ir.matchAll(new RegExp(`^!${escaped} = !\\{!(\\d+)\\}$`, 'gm'))];
  assert.equal(roots.length, 1, 'Missing or duplicate '+name);
  const prefix = language ? '!"Metal", ' : '';
  const nodes = [...ir.matchAll(new RegExp(`^!${roots[0][1]} = !\\{${prefix}i32 (\\d+), i32 (\\d+), i32 (\\d+)\\}$`, 'gm'))];
  assert.equal(nodes.length, 1, 'Malformed '+name);
  return nodes[0].slice(1).map(Number);
}
export function assertMetalLanguageMetadataIR(ir, test) {
  assert.equal([...ir.matchAll(/^target triple = /gm)].length, 1, 'Missing or duplicate target triple');
  assert(ir.includes(`target triple = "air64-apple-ios${test.ios}.0.0"`), 'Wrong deployment target');
  assert.deepEqual(namedVersion(ir, 'air.version', false), test.air, 'Wrong AIR version');
  assert.deepEqual(namedVersion(ir, 'air.language_version', true), test.language, 'Wrong Metal language version');
}
export function assertMetalLanguageIR(ir, test) {
  assertMetalLanguageMetadataIR(ir, test);
  assert.match(ir, /^define .*@mode_probe\(/m, 'Missing language probe entry');
}
export function assertMetalLanguageMetallib(bytes, test) {
  assert.equal(test.api, 3, 'Legacy tuple consistency is not claimed');
  const info = assertMetallibMetadata(bytes);
  assert.equal(Buffer.from(bytes).readUInt16LE(12), test.ios, 'Wrong metallib deployment target');
  assert.deepEqual(info.functions.map(fn => fn.name), ['mode_probe'], 'Wrong language probe entry');
  for (const fn of info.functions)
    assert.deepEqual(fn.versions, [test.air, test.language], 'VERS disagrees with selected language/AIR');
  return info;
}

export function assertMetalLanguageDiagnostic(diagnostics, test) {
  assert.equal(typeof test.diagnosticPattern, 'string', 'Missing expected language diagnostic');
  assert.match(diagnostics, new RegExp(test.diagnosticPattern, 'i'), 'Wrong language rejection reason');
}
