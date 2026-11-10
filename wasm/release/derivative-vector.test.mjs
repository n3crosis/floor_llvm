import assert from 'node:assert/strict';
import test from 'node:test';
import {derivativeVectorCases,derivativeVectorSource,assertDerivativeVectorIR} from './derivative-vector.mjs';

// Authored synthetic LLVM fixtures, independent of the runtime/preflight output.
function fixture() {
  const functions=[];
  for(const op of ['dfdx','dfdy','fwidth']) for(const n of [1,2,3,4]) for(const probe of n===3?[false,true]:[false]) {
    const outN=probe?4:n;
    const lines=[]; let result;
    for(let i=0;i<n;i++) {
      lines.push(`  %p${i} = extractelement <4 x float> %p, i32 ${i}`);
      const axes=op==='fwidth'?['dfdx','dfdy']:[op];
      for(const axis of axes) {
        lines.push(`  %${axis}${i} = tail call noundef float @air.${axis}.f32(float noundef %p${i}) #2`);
        if(op==='fwidth') lines.push(`  %bits_${axis}${i} = bitcast float %${axis}${i} to i32`,
          `  %mask_${axis}${i} = and i32 %bits_${axis}${i}, 2147483647`,
          `  %abs_${axis}${i} = bitcast i32 %mask_${axis}${i} to float`);
      }
      result=`%${op}${i}`;
      if(op==='fwidth') lines.push(`  ${result} = fadd float %abs_dfdx${i}, %abs_dfdy${i}`);
      if(n>1) { lines.push(`  %v${i} = insertelement <${outN} x float> ${i?'%v'+(i-1):'undef'}, float ${result}, i32 ${i}`);result=`%v${i}`; }
    }
    if(probe) { lines.push(`  %padded = insertelement <4 x float> ${result}, float 0.000000e+00, i32 3`);result='%padded'; }
    lines.push(`  ret ${outN===1?'float':`<${outN} x float>`} ${result}`);
    functions.push(`define ${outN===1?'float':`<${outN} x float>`} @${probe?`dv_probe_${op}_3`:`dv_${op}_${n}`}(<4 x float> noundef %p) #0 {\n${lines.join('\n')}\n}`);
  }
  return functions.join('\n')+`\ndeclare noundef float @air.dfdx.f32(float noundef) #1
 declare noundef float @air.dfdy.f32(float noundef) #1
attributes #0 = { convergent nounwind }
attributes #1 = { convergent }
attributes #2 = { convergent nounwind }
!air.fragment = !{!0}
`.replace('\n declare','\ndeclare');
}
const ir=fixture(),successful={derivativeVector:true,status:0,math:0};
const check=value=>assertDerivativeVectorIR(value,successful);
test('accept lane-bound scalar and vector derivatives and exact fwidth',()=>check(ir));
for(const [name,from,to] of [
  ['missing derivative','@air.dfdx.f32(float noundef %p0)','@missing(float noundef %p0)'],
  ['wrong derivative axis','@air.dfdx.f32(float noundef %p0)','@air.dfdy.f32(float noundef %p0)'],
  ['invented vector ABI','@air.dfdx.f32(float noundef %p0)','@air.dfdx.v2f32(float noundef %p0)'],
  ['duplicate input lane','%p1 = extractelement <4 x float> %p, i32 1','%p1 = extractelement <4 x float> %p, i32 0'],
  ['wrong output lane','float %dfdx1, i32 1','float %dfdx0, i32 1'],
  ['declaration convergence','attributes #1 = { convergent }','attributes #1 = { nounwind }'],
  ['call convergence','attributes #2 = { convergent nounwind }','attributes #2 = { nounwind }'],
  ['wrong magnitude mask','2147483647','2147483646'],
  ['raw derivative instead of magnitude','fadd float %abs_dfdx0, %abs_dfdy0','fadd float %dfdx0, %abs_dfdy0'],
  ['sum same axis twice','fadd float %abs_dfdx0, %abs_dfdy0','fadd float %abs_dfdx0, %abs_dfdx0'],
  ['subtract magnitudes','fadd float %abs_dfdx0, %abs_dfdy0','fsub float %abs_dfdx0, %abs_dfdy0'],
  ['forced fast math','fadd float %abs_dfdx0','fadd fast float %abs_dfdx0'],
  ['lost fragment metadata','!air.fragment = !{!0}','!air.vertex = !{!0}'],
  ['wrong return value','ret float %fwidth0','ret float %dfdx0'],
]) test('reject '+name,()=>{assert(ir.includes(from));assert.throws(()=>check(ir.replace(from,to)));});

test('case coverage and size budget',()=>{
  assert.equal(new Set(derivativeVectorCases.map(t=>t.name)).size,derivativeVectorCases.length);
  for(const t of derivativeVectorCases) assert(Buffer.byteLength(t.source)<=4096);
  for(const ios of [18,26]) for(const math of [0,1]) {
    for(const kind of [0,1]) assert(derivativeVectorCases.some(t=>t.status===0&&t.ios===ios&&t.math===math&&t.kind===kind));
    for(const op of ['dfdx','dfdy','fwidth']) for(const stage of ['vertex','kernel'])
      assert(derivativeVectorCases.some(t=>t.name===`reject-${stage}-${op}-ios${ios}-math${math}`&&t.status===4));
  }
  for(const op of ['dfdx','dfdy','fwidth']) for(const t of ['half2','int3'])
    assert(derivativeVectorCases.some(c=>c.name===`reject-${op}-${t}`&&c.status===3));
});

test('padded numerical fixtures preserve originals and require defined alpha',()=>{
  assert.equal((derivativeVectorSource.match(/fragment /g)||[]).length,15);
  for(const op of ['dfdx','dfdy','fwidth']) {
    assert(derivativeVectorSource.includes(`fragment float3 dv_${op}_3(float4 p [[position]]) { return ${op}(p.xyz); }`));
    assert(derivativeVectorSource.includes(`fragment float4 dv_probe_${op}_3(float4 p [[position]]) { float3 v=${op}(p.xyz); return float4(v,0.0f); }`));
  }
  assert.throws(()=>check(ir.replace('float 0.000000e+00, i32 3','float 1.000000e+00, i32 3')));
  assert.throws(()=>check(ir.replace('@dv_probe_dfdx_3','@missing_probe')));
});

test('accept optimized padded vector constants but reject wrong alpha',()=>{
  const optimized=ir.replace(/define <4 x float> @dv_probe_[\s\S]*?^}/gm,body=>body
    .replace('insertelement <4 x float> undef,','insertelement <4 x float> <float poison, float poison, float poison, float 0.000000e+00>,')
    .replace('  %padded = insertelement <4 x float> %v2, float 0.000000e+00, i32 3\n','')
    .replace('ret <4 x float> %padded','ret <4 x float> %v2'));
  check(optimized);
  assert.throws(()=>check(optimized.replace('float poison, float 0.000000e+00>','float poison, float 1.000000e+00>')));
});
