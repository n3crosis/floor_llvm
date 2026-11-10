import test from 'node:test';
import assert from 'node:assert/strict';
import {integerVectorCases,assertIntegerVectorIR} from './integer-vector.mjs';
const positive=mode=>integerVectorCases.find(t=>t.kind===1&&t.integerMode===mode);
function fixture(mode){
  let ir='!air.kernel = !{}\n';
  for(const type of ['int','uint'])for(const width of [2,3,4]){
    ir+=`define void @integer_${mode}_${type}${width}() {\n`;
    if(mode==='constants')ir+=['clz','popcount','reverse_bits'].map(s=>`%x = call i32 @air.${s}.i32(i32 0)`).join('\n')+'\n';
    if(mode==='dynamic'){
      const symbols=['clz','ctz','popcount','reverse_bits','extract','insert'];
      for(let lane=0;lane<width;lane++){
        ir+=`%lane${lane} = extractelement <${width} x i32> %input, i32 ${lane}\n%value${lane} = extractelement <${width} x i32> %second, i32 ${lane}\n`;
        for(const symbol of ['clz','popcount','reverse_bits'])ir+=`%${symbol}${lane} = call i32 @air.${symbol}.i32(i32 %lane${lane})\n`;
        ir+=`%negative${lane} = sub i32 0, %lane${lane}\n%masked${lane} = and i32 %lane${lane}, %negative${lane}\n%decrement${lane} = add i32 %masked${lane}, -1\n%ctz${lane} = call i32 @air.popcount.i32(i32 %decrement${lane})\n`;
        ir+=`%logical${lane} = lshr i32 %lane${lane}, 4\n%shift${lane} = shl i32 %logical${lane}, 28\n%sign${lane} = ashr i32 %shift${lane}, 28\n%extract${lane} = phi i32 [ %lane${lane}, %full ], [ %sign${lane}, %part ], [ 0, %zero ]\n`;
        ir+=`%insertshift${lane} = shl i32 %value${lane}, 4\n%insertmask${lane} = and i32 %insertshift${lane}, %lane${lane}\n%insertor${lane} = or i32 %insertmask${lane}, %lane${lane}\n%insert${lane} = phi i32 [ %value${lane}, %full ], [ %insertor${lane}, %part ], [ %lane${lane}, %zero ]\n`;
        for(const symbol of symbols)ir+=`%v${symbol}${lane} = insertelement <${width} x i32> ${lane?`%v${symbol}${lane-1}`:'undef'}, i32 %${symbol}${lane}, i32 ${lane}\n`;
      }
      for(const [index,symbol] of symbols.entries()){
        if(index)ir+=`%dest${index} = getelementptr inbounds <${width} x i32>, <${width} x i32> addrspace(1)* %b, i32 ${index}\n`;
        ir+=`store <${width} x i32> %v${symbol}${width-1}, <${width} x i32> addrspace(1)* ${index?`%dest${index}`:'%b'}, align 8\n`;
      }
    }else {
      const x=[0,-2147483648,-1,-8].slice(0,width),e=(type==='int'?[0,-8,-1,-1]:[0,8,15,15]).slice(0,width);
      const rows=[x,x,x,x,Array(width).fill(0),x,e,x,x,[0,0,240,128].slice(0,width)];
      ir+=rows.map(r=>`store volatile <${width} x i32> ${r.every(n=>n===0)?'zeroinitializer':`<${r.map(n=>`i32 ${n}`).join(', ')}>`}, <${width} x i32> addrspace(1)* %p`).join('\n')+'\n';
    }
    ir+='}\n';
  }return ir;
}
test('bounded unique matrix and individual rejection cases',()=>{
  assert.equal(integerVectorCases.length,53);
  assert.equal(new Set(integerVectorCases.map(t=>t.name)).size,53);
  for(const t of integerVectorCases)assert(Buffer.byteLength(t.source)<=4096);
  for(const ios of [18,26])for(const math of [0,1])for(const kind of [0,1])for(const mode of ['dynamic','constants'])
    assert.equal(integerVectorCases.filter(t=>t.ios===ios&&t.math===math&&t.kind===kind&&t.integerMode===mode).length,1);
  assert.equal(integerVectorCases.filter(t=>t.status===3).length,37);
});
test('dynamic validator rejects missing kernels and wrong lowering',()=>{
  const t=positive('dynamic'),ir=fixture('dynamic');assertIntegerVectorIR(ir,t);
  for(const bad of [ir.replace('!air.kernel','!other'),ir.replace('@integer_dynamic_int3','@missing'),ir.replace('@air.clz.i32','@air.wrong.i32'),ir.replaceAll('ashr','lshr'),ir.replace('i32 %lane1)', 'i32 %lane0)'),ir.replace('i32 %clz1, i32 1','i32 %clz1, i32 0'),ir+'\nstore i32 undef, i32* %p',ir+'\n%x = sitofp i32 1 to float',ir+'\n%x = call i32 @llvm.ctpop.i32(i32 1)'])
    assert.throws(()=>assertIntegerVectorIR(bad,t));
  assert.throws(()=>assertIntegerVectorIR('x'.repeat(2*1024*1024),t));
});
test('constant validator checks endpoint and sign extension values',()=>{
  const t=positive('constants'),ir=fixture('constants');assertIntegerVectorIR(ir,t);
  assert.throws(()=>assertIntegerVectorIR(ir.replace('<i32 0, i32 -8>','<i32 0, i32 8>'),t));
  assert.throws(()=>assertIntegerVectorIR(ir.replace('zeroinitializer','<i32 1, i32 1>'),t));
  assert.throws(()=>assertIntegerVectorIR(ir.replace('store volatile','store'),t));
});

test('dynamic validator binds stored results and ctz formulas',()=>{
  const t=positive('dynamic'),ir=fixture('dynamic');
  for(const bad of [
    ir.replace(/^store .*\n/gm,''),
    ir.replace('store <2 x i32> %vclz1','store <2 x i32> %vpopcount1'),
    ir.replace('store <2 x i32> %vctz1','store <2 x i32> %vclz1'),
    ir.replace('i32 %decrement0)','i32 %lane0)'),
    ir.replace('sub i32 0, %lane1','sub i32 0, %lane0'),
    ir.replace('i32 %ctz1, i32 1','i32 %ctz0, i32 1'),
    ir.replace('store <2 x i32> %vextract1','store <2 x i32> %vinsert1'),
    ir.replace('store <2 x i32> %vinsert1','store <2 x i32> %vextract1'),
    ir.replace('[ %sign0, %part ]','[ %unrelated, %part ]'),
    ir.replace('[ %insertor0, %part ]','[ %unrelated, %part ]'),
    ir.replace('%dest1, align','%b, align'),
  ])assert.throws(()=>assertIntegerVectorIR(bad,t));
});
