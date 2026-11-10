import test from 'node:test';
import assert from 'node:assert/strict';
import { positiveCases, appleFlags } from './apple-reference.mjs';
import { integerVectorCases } from './integer-vector.mjs';
import { derivativeVectorCases } from './derivative-vector.mjs';
test('positive corpus deduplicates output kinds but preserves profiles and targets',()=>{
 const cases=positiveCases([...integerVectorCases,...derivativeVectorCases]);
 assert.equal(cases.length,12); assert(cases.every(c=>c.aliases.length===2&&c.status===0&&c.kind===0));
 assert.equal(new Set(cases.map(c=>c.sourceSha256)).size,3);
});
test('reference never changes iOS target and selects explicit math flags',()=>{
 assert.deepEqual(appleFlags({ios:18,math:0}),['-sdk','iphoneos','metal','-target','air64-apple-ios18.0','-std=metal3.2','-fno-fast-math']);
 assert.deepEqual(appleFlags({ios:26,math:1}),['-sdk','iphoneos','metal','-target','air64-apple-ios26.0','-std=metal4.0','-ffast-math']);
});
test('FLOOR-only negative cases impose no Apple rejection expectation',()=>assert.equal(positiveCases([{status:3,source:'bad'}]).length,0));

import { referenceCases, validateGPUReport, gpuResultsVerified } from './apple-reference.mjs';
import { commonFunctionCases } from './common-functions.mjs';
test('reference corpus includes every common positive without output-kind duplication',()=>{
 const cases=referenceCases(), common=positiveCases(commonFunctionCases);
 assert(common.length>0);
 for(const c of common)assert(cases.some(x=>x.sourceSha256===c.sourceSha256&&x.ios===c.ios&&x.math===c.math));
 assert.equal(cases.length,12+common.length);
});
const passed=()=>({status:'passed',artifacts:[{sha256:'apple'},{sha256:'floor'}],libraryLoading:{apple:{status:'loaded'},floor:{status:'loaded'}},pipelineCreation:'passed',execution:'completed',numericalComparison:'passed',checkedValues:10});
const checked=r=>validateGPUReport(JSON.stringify(r),0,['apple','floor']);
const item=r=>({appleMetallibSha256:'apple',floorMetallibSha256:'floor',gpu:{status:r.status,details:r}});
test('GPU pass requires each independently evidenced layer and nonzero comparisons',()=>{
 assert.equal(checked(passed()).status,'passed');
 for(const key of ['artifacts','libraryLoading','pipelineCreation','execution','numericalComparison','checkedValues']) {
   const r=passed(); delete r[key]; assert.throws(()=>checked(r),key);
 }
 for(const [key,value] of [['pipelineCreation','pending'],['execution','pending'],['numericalComparison','pending'],['checkedValues',0],['checkedValues',1.5]]) {
   const r=passed(); r[key]=value; assert.throws(()=>checked(r),key);
 }
 for(const backend of ['apple','floor']) {const r=passed(); r.libraryLoading[backend].status='rejected';assert.throws(()=>checked(r));}
 const r=passed();r.artifacts[1].sha256='wrong';assert.throws(()=>checked(r));
 for(const raw of [undefined,'','{','null','{}']) assert.throws(()=>validateGPUReport(raw,0,['apple','floor']));
 assert.throws(()=>validateGPUReport(JSON.stringify(passed()),77,['apple','floor']));
});
test('aggregate GPU proof cannot pass missing, unavailable, malformed or asymmetric load evidence',()=>{
 assert.equal(gpuResultsVerified([]),false);
 assert.equal(gpuResultsVerified([item(passed())]),true);
 const unavailable={status:'unavailable',artifacts:[{sha256:'apple'},{sha256:'floor'}]};
 assert.equal(validateGPUReport(JSON.stringify(unavailable),77,['apple','floor']).status,'unavailable');
 assert.equal(gpuResultsVerified([item(passed()),item(unavailable)]),false);
 const incomplete=passed();delete incomplete.execution;assert.throws(()=>gpuResultsVerified([item(incomplete)]));
 unavailable.libraryLoading={apple:{status:'loaded'},floor:{status:'rejected'}};
 assert.throws(()=>validateGPUReport(JSON.stringify(unavailable),77,['apple','floor']));
});
