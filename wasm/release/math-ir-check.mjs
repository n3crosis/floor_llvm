import assert from 'node:assert/strict';
// Assertion helper only: acceptance requires real compiler output in probe.mjs.
export function checkMathIR(ir, profile, ios, { arithmetic = true, explicitFma = false } = {}) {
  assert.equal(typeof ir, 'string'); assert([0, 1].includes(profile));
  assert([18, 26].includes(ios));
  assert(ir.length > 0 && ir.length <= 16 * 1024 * 1024);
  assert(ir.includes(`target triple = "air64-apple-ios${ios}.0.0"`), 'AIR target changed');
  assert.match(ir, /!\{!"Metal", i32 3, i32 2, i32 0\}/, 'language mode changed');
  assert(!ir.includes('air.compile.denorms_disable'), 'IEEE profile advertised denormal flushing');
  for (const match of ir.matchAll(/"denormal-fp-math(?:-f32)?"="([^"]+)"/g))
    assert(['ieee', 'ieee,ieee'].includes(match[1]), 'non-IEEE function mode');
  const fast = ir.includes('air.compile.fast_math_enable');
  assert.equal(fast, profile === 1, 'fast metadata does not match explicit profile');
  if (profile === 0) {
    assert(!/\bllvm\.fmuladd(?:\.|\b)/.test(ir), 'implicit contraction');
    if (explicitFma) assert(ir.includes('air.fma.f32'), 'explicit accurate FMA was lost');
    else assert(!/\b(?:llvm\.fma|air\.fma)(?:\.|\b)/.test(ir), 'implicit contraction');
    assert(!/\b(?:fadd|fsub|fmul|fdiv)\s+(?:fast|reassoc|nnan|ninf|nsz|arcp|contract|afn)\b/.test(ir), 'unsafe FP flags');
    assert(!/"(?:unsafe-fp-math|approx-func-fp-math|no-nans-fp-math|no-infs-fp-math|no-signed-zeros-fp-math)"="true"/.test(ir), 'unsafe function attributes');
    if (arithmetic) for (const op of ['fmul', 'fadd', 'fsub', 'fdiv']) assert(new RegExp(`\\b${op}\\b`).test(ir), `missing conservative ${op}`);
  } else {
    assert(/\b(?:fdiv fast|air\.fma\.f32)\b/.test(ir), 'explicit fast profile not exercised');
  }
}
