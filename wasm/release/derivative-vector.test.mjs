import assert from 'node:assert/strict';
import test from 'node:test';
import {derivativeVectorCases,assertDerivativeVectorIR} from './derivative-vector.mjs';

// Authored synthetic LLVM fixtures, independent of the runtime/preflight output.
function fixture() {
  const functions=[];
  for(const op of ['dfdx','dfdy','fwidth']) for(const n of [1,2,3,4]) {
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
      if(n>1) { lines.push(`  %v${i} = insertelement <${n} x float> ${i?'%v'+(i-1):'undef'}, float ${result}, i32 ${i}`);result=`%v${i}`; }
    }
    lines.push(`  ret ${n===1?'float':`<${n} x float>`} ${result}`);
    functions.push(`define ${n===1?'float':`<${n} x float>`} @dv_${op}_${n}(<4 x float> noundef %p) #0 {\n${lines.join('\n')}\n}`);
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
