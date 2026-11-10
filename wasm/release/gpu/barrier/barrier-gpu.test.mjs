import test from 'node:test';
import assert from 'node:assert/strict';
import {barrierGPUCases,expectedNames,inputs,expected,copy,suite,verifyPassedReport,validateRunReport,aggregate,observedBackendStages} from './barrier-gpu.mjs';
import {syntheticRaw} from './barrier-test-fixtures.mjs';
const cases=barrierGPUCases();
function fixture(c=cases[0]) {
  const receipt={schema:1,suite,case:c.name,sourceSha256:c.sourceSha256,target:{api:3,ios:27,metalVersion:410,math:0,kind:0},artifacts:{apple:{sha256:'a'.repeat(64),bytes:12},floor:{sha256:'b'.repeat(64),bytes:13}}};
  return {c,receipt,...syntheticRaw(c,receipt.artifacts)};
}
test('exact eight-case matrix retains native source pins and intended API/target/math',()=>{
  assert.deepEqual(cases.map(c=>c.name),expectedNames);assert.equal(new Set(cases.map(c=>c.sourceSha256)).size,8);
  for(const c of cases){assert.equal(c.api,3);assert.equal(c.metalVersion,410);assert.equal(c.ios,27);assert.equal(c.math,0);assert.equal(c.kind,0);}
});
test('CPU oracle includes signed-looking words, wrapping arithmetic and per-trial seeds',()=>{
  assert.deepEqual(inputs(8,0),[0,0xffffffff,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,1,0x01020304]);
  assert.deepEqual(expected([0,0xffffffff]),[0x9e3779b9,0x61c88646]);
  assert.notDeepEqual(inputs(32,1),inputs(32,2));assert.deepEqual(inputs(32,15),inputs(32,15));
  assert.throws(()=>inputs(0,0));assert.throws(()=>inputs(32,16));assert.throws(()=>expected([-1]));
});
test('all eight synthetic raw reports verify independently, not just via pass flag',()=>{
  for(const c of cases){const f=fixture(c),r=verifyPassedReport(f.report,f.values,c,f.receipt);assert.equal(r.trialsPerBackend,16);assert.equal(r.checkedWords,1024);assert.equal(r.backends.floor.numericalComparison.checkedWords,512);}
});
for(const [name,mutate] of Object.entries({
  status:f=>{f.report.status='unavailable';},artifact:f=>{f.report.artifacts[1].sha256='0'.repeat(64);},artifactOrder:f=>{f.report.artifacts.reverse();},kind:f=>{f.report.kind='simdgroup';},
  cpuOnly:f=>{f.report.scope='cpu_oracle_only';},retargeted:f=>{f.report.targetPolicy='retargeted';},device:f=>{delete f.report.device;},load:f=>{f.report.libraryLoading.floor.status='rejected';},
  pipeline:f=>{f.report.pipelineCreation='not_run';},execution:f=>{f.report.execution='in_progress';},numerical:f=>{f.report.numericalComparison='failed';},error:f=>{f.report.error={stage:'execution',message:'failed'};},
  zeroWidth:f=>{f.report.geometry.threadsPerThreadgroup=0;},extraGroups:f=>{f.report.geometry.threadgroups=2;},scratchBytes:f=>{f.report.geometry.threadgroupMemoryBytes=1;},count:f=>{f.report.checkedValues--;},
  missingTrial:f=>{f.values.pop();},duplicateTrial:f=>{f.values[1]=f.values[0];},reordered:f=>{f.values.reverse();},input:f=>{f.values[2].input[0]^=1;},
  expected:f=>{f.values[2].expected[0]^=1;},floor:f=>{f.values[2].floor[0]^=1;},apple:f=>{f.values[2].apple[0]^=1;},negative:f=>{f.values[0].floor[0]=-1;},
  stringWord:f=>{f.values[0].floor[0]=String(f.values[0].floor[0]);},extraWord:f=>{f.values[0].floor.push(0);},
  forgedAll:f=>{f.values[5].input[0]=0;f.values[5].expected[0]=0x9e3779b9;f.values[5].apple[0]=0x9e3779b9;f.values[5].floor[0]=0x9e3779b9;},
  receiptTarget:f=>{f.receipt.target.metalVersion=400;},receiptCase:f=>{f.receipt.case=cases[1].name;},receiptSource:f=>{f.receipt.sourceSha256='0'.repeat(64);},
}))test('raw successful evidence rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyPassedReport(f.report,f.values,f.c,f.receipt));});
test('simd dispatch cannot span multiple SIMD groups',()=>{const f=fixture(cases[4]);f.report.geometry.pipelineSIMDWidths=[16,32];assert.throws(()=>verifyPassedReport(f.report,f.values,f.c,f.receipt));});
test('unavailable never hides a loaded Apple library or observed failed GPU stage',()=>{
  const f=fixture();Object.assign(f.report,{status:'unavailable',libraryLoading:{apple:{status:'rejected'},floor:{status:'rejected'}},pipelineCreation:'not_run',execution:'not_run',numericalComparison:'not_run',error:{stage:'libraryLoading',message:'Synthetic unsupported target'}});
  delete f.report.geometry;delete f.report.checkedValues;validateRunReport(f.report,77,f.c,f.receipt);f.report.libraryLoading.apple.status='loaded';assert.throws(()=>validateRunReport(f.report,77,f.c,f.receipt));
  f.report.libraryLoading.apple.status='rejected';f.report.execution='failed';assert.throws(()=>validateRunReport(f.report,77,f.c,f.receipt));
});
test('separate backend failure stages retain unknowns from frozen global report',()=>{
  const r=observedBackendStages({libraryLoading:{apple:{status:'loaded'},floor:{status:'rejected'}},pipelineCreation:'failed',execution:'failed'});
  assert.equal(r.apple.libraryLoading.status,'passed');assert.equal(r.floor.libraryLoading.status,'failed');
  assert.equal(r.apple.pipelineCreation.status,'not_reported');assert.equal(r.floor.execution.status,'not_verified');
});
test('aggregate cannot pass omitted, empty, unknown or incomplete cases',()=>{
  for(const rows of [[],Array(7).fill({status:'passed'}),[{status:'unknown'}]])assert.notEqual(aggregate(rows).exitCode,0);
  assert.equal(aggregate(Array(8).fill({status:'passed'})).exitCode,0);
  assert.equal(aggregate([{status:'timeout'},...Array(7).fill({status:'blocked'})]).exitCode,1);
  assert.equal(aggregate([{status:'missing'},...Array(7).fill({status:'passed'})]).exitCode,2);
  assert.equal(aggregate([{status:'unavailable'},...Array(7).fill({status:'passed'})]).exitCode,77);
});
