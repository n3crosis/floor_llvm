import assert from 'node:assert/strict';
import test from 'node:test';
import {commonFunctionCases,assertCommonFunctionIR} from './common-functions.mjs';
import {evaluateCommonKernel} from './common-functions-ir.mjs';

// Synthetic LLVM fixtures, authored independently of compiler output.
function fixture() {
  const functions=[];
  for(const op of ['mix','step','smoothstep','sign']) for(const n of [1,2,3,4]) {
    const ty=n===1?'float':`<${n} x float>`,lines=[];
    for(let j=0;j<(op==='sign'?1:op==='step'?2:3);j++) {
      const p=j?`%a${j}`:'%a';
      if(j)lines.push(`  ${p} = getelementptr inbounds ${ty}, ${ty} addrspace(1)* %a, i32 ${j}`);
      lines.push(`  %input${j} = load ${ty}, ${ty} addrspace(1)* ${p}, align 4`);
    }
    for(let i=0;i<n;i++) {
      const refs=[];
      for(let j=0;j<(op==='sign'?1:op==='step'?2:3);j++) {
        if(n>1)lines.push(`  %v${j}_${i} = extractelement ${ty} %input${j}, i32 ${i}`);
        refs.push(n===1?`%input${j}`:`%v${j}_${i}`);
      }
      const [x,y,a]=refs;
      if(op==='mix') lines.push(`  %d${i} = fsub float ${y}, ${x}`,`  %p${i} = fmul float %d${i}, ${a}`,`  %result${i} = fadd float ${x}, %p${i}`);
      if(op==='step') lines.push(`  %c${i} = fcmp olt float ${y}, ${x}`,`  %result${i} = select i1 %c${i}, float 0.000000e+00, float 1.000000e+00`);
      if(op==='smoothstep') lines.push(`  %num${i} = fsub float ${a}, ${x}`,`  %den${i} = fsub float ${y}, ${x}`,`  %q${i} = fdiv float %num${i}, %den${i}`,
        `  %positive${i} = fcmp ogt float %q${i}, 0.000000e+00`,`  %upper${i} = fcmp oge float %q${i}, 1.000000e+00`,
        `  %high${i} = select i1 %upper${i}, float 1.000000e+00, float %q${i}`,`  %clamp${i} = select i1 %positive${i}, float %high${i}, float 0.000000e+00`,
        `  %square${i} = fmul float %clamp${i}, %clamp${i}`,`  %twice${i} = fmul float %clamp${i}, 2.000000e+00`,
        `  %poly${i} = fsub float 3.000000e+00, %twice${i}`,`  %result${i} = fmul float %square${i}, %poly${i}`);
      if(op==='sign') lines.push(`  %bits${i} = bitcast float ${x} to i32`,`  %mag${i} = and i32 %bits${i}, 2147483647`,`  %zero${i} = icmp eq i32 %mag${i}, 0`,
        `  %nan${i} = icmp ugt i32 %mag${i}, 2139095040`,`  %sign${i} = and i32 %bits${i}, -2147483648`,`  %one${i} = or i32 %sign${i}, 1065353216`,
        `  %value${i} = bitcast i32 %one${i} to float`,`  %finite${i} = select i1 %nan${i}, float 0.000000e+00, float %value${i}`,
        `  %result${i} = select i1 %zero${i}, float ${x}, float %finite${i}`);
      if(n>1)lines.push(`  %out${i} = insertelement ${ty} ${i?`%out${i-1}`:'undef'}, float %result${i}, i32 ${i}`);
    }
    lines.push(`  store ${ty} ${n===1?'%result0':`%out${n-1}`}, ${ty} addrspace(1)* %b, align 4`,'  ret void');
    functions.push(`define void @common_${op}_${n}(${ty} addrspace(1)* %a, ${ty} addrspace(1)* %b) {\n${lines.join('\n')}\n}`);
  }
  return functions.join('\n')+'\n!air.kernel = !{!0}\n';
}
const ir=fixture(),context={commonFunctions:true,status:0,kind:1,math:0,commonMode:'dynamic'};
const check=source=>assertCommonFunctionIR(source,context);
test('accept independent common-function dataflow fixtures',()=>check(ir));
for(const [name,from,to] of [
  ['missing metadata','!air.kernel = !{!0}','!air.fragment = !{!0}'],
  ['reversed mix difference','%d0 = fsub float %input1, %input0','%d0 = fsub float %input0, %input1'],
  ['wrong interpolation coefficient','%p0 = fmul float %d0, %input2','%p0 = fmul float %d0, %input0'],
  ['dead valid formula','store float %result0, float addrspace(1)* %b','store float %input0, float addrspace(1)* %b'],
  ['duplicate input lane','%v0_1 = extractelement <2 x float> %input0, i32 1','%v0_1 = extractelement <2 x float> %input0, i32 0'],
  ['duplicate output lane','float %result1, i32 1','float %result0, i32 1'],
  ['wrong output buffer','store float %result0, float addrspace(1)* %b','store float %result0, float addrspace(1)* %a'],
  ['wrong threshold order','%c0 = fcmp olt float %input1, %input0','%c0 = fcmp olt float %input0, %input1'],
  ['wrong threshold equality','%c0 = fcmp olt float %input1, %input0','%c0 = fcmp oge float %input1, %input0'],
  ['wrong smoothstep denominator','%den0 = fsub float %input1, %input0','%den0 = fsub float %input0, %input1'],
  ['lost lower clamp','%clamp0 = select i1 %positive0, float %high0, float 0.000000e+00','%clamp0 = select i1 %positive0, float %high0, float %q0'],
  ['lost upper clamp','%high0 = select i1 %upper0, float 1.000000e+00, float %q0','%high0 = select i1 %upper0, float %q0, float %q0'],
  ['wrong Hermite constant','%poly0 = fsub float 3.000000e+00, %twice0','%poly0 = fsub float 2.000000e+00, %twice0'],
  ['lost negative zero','%result0 = select i1 %zero0, float %input0, float %finite0','%result0 = select i1 %zero0, float 0.000000e+00, float %finite0'],
  ['wrong sign magnitude mask','%mag0 = and i32 %bits0, 2147483647','%mag0 = and i32 %bits0, 2147483646'],
  ['wrong NaN handling','%finite0 = select i1 %nan0, float 0.000000e+00, float %value0','%finite0 = select i1 %nan0, float %input0, float %value0'],
  ['unsolicited fast arithmetic','%d0 = fsub float','%d0 = fsub fast float'],
  ['fast arithmetic hidden after contract','%d0 = fsub float','%d0 = fsub contract nnan float'],
  ['fast select hidden after contract','%result0 = select i1 %c0','%result0 = select contract nsz i1 %c0'],
  ['branch bypassing output','  store float %result0, float addrspace(1)* %b','  br label %exit\n  store float %result0, float addrspace(1)* %b'],
  ['store after return','  store float %result0, float addrspace(1)* %b','  ret void\n  store float %result0, float addrspace(1)* %b'],
  ['unsupported float comparison','%nan0 = icmp ugt i32 %mag0','%nan0 = fcmp ugt i32 %mag0'],
  ['unsupported integer comparison','%nan0 = icmp ugt i32 %mag0','%nan0 = icmp uge i32 %mag0'],
]) test('reject '+name,()=>{assert(ir.includes(from));assert.throws(()=>check(ir.replace(from,to)));});

test('evaluator rejects uninitialized output lanes',()=>assert.throws(()=>evaluateCommonKernel('store <2 x float> undef, <2 x float> addrspace(1)* %b, align 4',2,[[1,2]])));
test('evaluator rejects unsupported instructions',()=>assert.throws(()=>evaluateCommonKernel('%x = imaginary float %a\nstore float %x, float addrspace(1)* %b, align 4',1,[[1]])));
const constantRows=[[-1073741824,-1065353216,1082130432,1082130432],[0,1065353216,1065353216,0],
  [0,1042284544,1062731776,1065353216],[0,-2147483648,1065353216,-1082130432],
  [1065353216,-1082130432,0,0],[0,0,1065353216,-1082130432]];
function constantFixture(n) {
  const ty=n===1?'i32':`<${n} x i32>`;
  return `define void @common_constants_${n}(${ty} addrspace(1)* %b) {\n`+constantRows.map((row,i)=>{
    const values=row.slice(0,n),constant=n===1?String(values[0]):values.every(x=>x===0)?'zeroinitializer':`<${values.map(x=>`i32 ${x}`).join(', ')}>`;
    return (i?`  %p${i} = getelementptr inbounds ${ty}, ${ty} addrspace(1)* %b, i32 ${i}\n`:'')+`  store volatile ${ty} ${constant}, ${ty} addrspace(1)* ${i?`%p${i}`:'%b'}, align 4`;
  }).join('\n')+'\n  ret void\n}\n!air.kernel = !{!0}\n';
}
for(const n of [1,2,3,4])test(`accept independent constant ${n}-lane fixture`,()=>assertCommonFunctionIR(constantFixture(n),{...context,commonMode:`constants${n}`}));
for(const [name,from,to] of [
  ['lost sign bit','i32 -2147483648','i32 0'],
  ['wrong Hermite value','i32 1042284544','i32 1042284543'],
  ['wrong output index','%b, i32 2','%b, i32 1'],
  ['wrong output pointer','addrspace(1)* %p3, align','addrspace(1)* %p4, align'],
  ['bypassed constant store','  store volatile','  br label %exit\n  store volatile'],
  ['unexpected constant side effect','  ret void','  call void @side_effect()\n  ret void'],
  ['constant store after return','  store volatile','  ret void\n  store volatile'],
])test('constant checker rejects '+name,()=>{const fixture=constantFixture(4);assert(fixture.includes(from));assert.throws(()=>assertCommonFunctionIR(fixture.replace(from,to),{...context,commonMode:'constants4'}));});
const stepSpecial='define void @common_step_special(<4 x i32> addrspace(1)* %b) {\n  store volatile <4 x i32> <i32 1065353216, i32 1065353216, i32 1065353216, i32 1065353216>, <4 x i32> addrspace(1)* %b, align 16\n  %p1 = getelementptr inbounds <4 x i32>, <4 x i32> addrspace(1)* %b, i32 1\n  store volatile <4 x i32> <i32 1065353216, i32 1065353216, i32 1065353216, i32 1065353216>, <4 x i32> addrspace(1)* %p1, align 16\n  ret void\n}\n!air.kernel = !{!0}\n';
test('accept independent step-special fixture',()=>assertCommonFunctionIR(stepSpecial,{...context,commonMode:'step-special'}));
test('reject wrong NaN threshold result',()=>assert.throws(()=>assertCommonFunctionIR(stepSpecial.replace('i32 1065353216','i32 0'),{...context,commonMode:'step-special'})));
test('matrix, type rejection and source limits',()=>{
  assert.equal(commonFunctionCases.length,76);
  assert.equal(new Set(commonFunctionCases.map(c=>c.name)).size,commonFunctionCases.length);
  assert(commonFunctionCases.every(c=>Buffer.byteLength(c.source)<=4096));
  for(const ios of [18,26])for(const math of [0,1])for(const kind of [0,1])for(const mode of ['dynamic','constants1','constants2','constants3','constants4'])
    assert(commonFunctionCases.some(c=>c.status===0&&c.ios===ios&&c.math===math&&c.kind===kind&&c.commonMode===mode));
  for(const op of ['mix','step','smoothstep','sign'])for(const t of ['int','uint','half','half2','int3'])assert(commonFunctionCases.some(c=>c.name===`reject-common-${op}-${t}`&&c.status===3));
  for(const op of ['mix','step','smoothstep'])for(const t of ['scalar-vector','vector-width','scalar-half'])assert(commonFunctionCases.some(c=>c.name===`reject-common-${op}-${t}`&&c.status===3));
  assert(commonFunctionCases.filter(c=>c.commonMode==='step-special').every(c=>c.math===0));
});
