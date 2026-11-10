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
 assert(cases.length>12+common.length);
});
const passed=()=>({status:'passed',artifacts:[{sha256:'apple'},{sha256:'floor'}],libraryLoading:{apple:{status:'loaded'},floor:{status:'loaded'}},pipelineCreation:'passed',execution:'completed',numericalComparison:'passed',checkedValues:10});
const checked=r=>validateGPUReport(JSON.stringify(r),0,['apple','floor']);
const item=r=>({appleMetallibSha256:'apple',floorMetallibSha256:'floor',gpu:{status:r.status,details:r,reportVerified:true}});
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

import { languageSelection, compileWithAPI, collectCaseEvidence, summarizeCases } from './apple-reference.mjs';
import { metalLanguageCases } from './metal-language.mjs';
import { msl41BitInterleaveCases } from './msl41-bit-interleave.mjs';
test('explicit 4.1 selection uses iOS27 and never falls back to 4.0',()=>{
 const c={api:3,ios:27,metalVersion:410,math:0};
 assert.deepEqual(languageSelection(c),{api:3,appleMetalVersion:410,floorMetalVersion:410,languageMatched:true});
 assert(appleFlags(c).includes('-std=metal4.1'));assert(appleFlags(c).includes('air64-apple-ios27.0'));
 for(const bad of [{...c,metalVersion:400},{...c,ios:26},{...c,metalVersion:undefined},{api:2,ios:27},{api:1,ios:18,math:1}])assert.throws(()=>languageSelection(bad));
 assert.deepEqual(languageSelection({ios:26,math:0}),{api:2,appleMetalVersion:400,floorMetalVersion:320,languageMatched:false});
 assert.equal(languageSelection({api:2,ios:26,metalVersion:320}).appleMetalVersion,320);
});
test('dedup retains different ABI/language selections and mandatory new corpus',()=>{
 const same={source:'kernel void x(){}',status:0,ios:26,math:0};
 assert.equal(positiveCases([{...same,api:1},{...same,api:2},{...same,api:3,metalVersion:400}]).length,3);
 for(const c of positiveCases([...metalLanguageCases(),...msl41BitInterleaveCases]))assert(referenceCases().some(x=>x.sourceSha256===c.sourceSha256&&x.ios===c.ios&&x.math===c.math&&x.api===c.api&&x.appleMetalVersion===c.appleMetalVersion));
});
test('compiler dispatch calls exact public ABI and checks capability',()=>{
 const calls=[],m=Object.fromEntries([1,2,3].map(api=>['_air_compile_v'+api,(...args)=>{calls.push({api,args});return api;}]));
 assert.equal(compileWithAPI(m,{api:1,ios:18},12,34),1);
 assert.equal(compileWithAPI(m,{api:2,ios:26,math:1},12,34),2);
 assert.equal(compileWithAPI(m,{api:3,ios:27,metalVersion:410,math:1},12,34),3);
 assert.deepEqual(calls,[{api:1,args:[12,34,18,0]},{api:2,args:[12,34,26,0,1]},{api:3,args:[12,34,27,0,1,410]}]);
 assert.throws(()=>compileWithAPI({}, {api:3,ios:27,metalVersion:410},12,34));
});
test('all independent layers and later cases continue after compile or GPU failures',async()=>{
 const visited=[],cases=[];
 for(const n of [0,1,2]) {
   const item={appleCompile:'pending'};cases.push(item);
   await collectCaseEvidence(item,{
     appleCompile:async()=>{visited.push(n+'a');if(n===0)throw Error('Apple rejection');},
     appleLink:async()=>{visited.push(n+'l');},
     floorCompile:async()=>{visited.push(n+'f');},
     gpu:async()=>{visited.push(n+'g');item.gpu={status:'failed',details:{status:'failed'}};if(n===1)throw Error('numerical mismatch');item.gpu={status:'unavailable'};},
   });
 }
 assert.deepEqual(visited,['0a','0f','1a','1l','1f','1g','2a','2l','2f','2g']);
 assert.equal(cases[0].appleLink,'blocked');assert.equal(cases[1].gpu.details.status,'failed');
 const summary=summarizeCases(cases);assert.equal(summary.hasFailures,true);assert.equal(summary.floorCompilationVerified,true);assert.equal(summary.numericalResultsVerified,false);
});
test('unavailable Apple4.1 does not prevent FLOOR4.1 compilation or falsely pass',async()=>{
 let compiled=false;const item={appleCompile:'unavailable'};
 await collectCaseEvidence(item,{appleCompile:()=>assert.fail('must not fallback'),appleLink:()=>assert.fail('no Apple output'),floorCompile:async()=>{compiled=true;},gpu:()=>assert.fail('both libraries required')});
 assert(compiled);assert.equal(item.appleLink,'unavailable');assert.equal(item.gpu.status,'blocked');
 assert.deepEqual(summarizeCases([item]),{appleCompilationVerified:false,floorCompilationVerified:true,runtimeLibraryLoadVerified:false,pipelineCreationVerified:false,gpuExecutionVerified:false,numericalResultsVerified:false,hasFailures:false,hasUnavailable:true});
});
test('failed numerical reports remain inspectable but must match original inputs',()=>{
 const r={status:'failed',artifacts:[{sha256:'apple'},{sha256:'floor'}],error:'mismatch'};
 assert.equal(validateGPUReport(JSON.stringify(r),1,['apple','floor']).error,'mismatch');
 assert.throws(()=>validateGPUReport(JSON.stringify(r),1,['apple','wrong']));
 assert.throws(()=>validateGPUReport('{}',1,['apple','floor']));
 assert.throws(()=>validateGPUReport(JSON.stringify(r),null,['apple','floor']));
});

test('loaded and executed remain distinct from numerical mismatch',()=>{
 const r=passed();r.status='failed';r.numericalComparison='failed';
 const c=item(r);c.appleCompile=c.appleLink=c.floorCompile='passed';
 const summary=summarizeCases([c]);
 assert.equal(summary.runtimeLibraryLoadVerified,true);assert.equal(summary.pipelineCreationVerified,true);assert.equal(summary.gpuExecutionVerified,true);assert.equal(summary.numericalResultsVerified,false);assert.equal(summary.hasFailures,true);
});

import {gpuArguments,gpuScope,reportOutcome} from './apple-reference.mjs';
test('all 36 interleave pairs dispatch exact typed GPU contract, preserving original libraries',()=>{
 const corpus=referenceCases(), interleave=corpus.filter(c=>c.msl41BitInterleave);
 assert.equal(interleave.length,36);
 assert.equal(corpus.filter(c=>gpuArguments(c,'original.apple.metallib','original.floor.metallib','evidence')).length,48);
 for(const c of interleave) {
   assert.deepEqual(gpuArguments(c,'A','F','O'),['--apple','A','--floor','F','--output','O','--kind','interleave','--bits',String(c.bitInterleaveBits),'--form',c.bitInterleaveForm,'--mode',c.bitInterleaveMode]);
 }
 for(const bits of [8,16,32])for(const form of ['scalar','vector','deinterleave'])for(const mode of ['dynamic','constants'])assert.equal(interleave.filter(c=>c.bitInterleaveBits===bits&&c.bitInterleaveForm===form&&c.bitInterleaveMode===mode).length,2);
 assert.equal(gpuArguments({commonFunctions:true},'A','F','O'),null);
 assert.equal(gpuArguments({metalLanguage:true},'A','F','O'),null);
 for(const bad of [{bitInterleaveBits:64},{bitInterleaveForm:'other'},{bitInterleaveMode:'other'},{ios:26},{metalVersion:400}])assert.throws(()=>gpuArguments({...interleave[0],...bad},'A','F','O'));
 assert.match(gpuScope,/MSL4.1 bit interleave\/deinterleave/);assert.match(gpuScope,/common functions, language-only probes and affine derivatives excluded/);
});
test('overall outcome uses exit77 for unavailable GPU and tools, never exit0',()=>{
 assert.deepEqual(reportOutcome({hasFailures:false,hasUnavailable:false,appleCompilationVerified:true}),{status:'passed',exitCode:0});
 assert.deepEqual(reportOutcome({hasFailures:false,hasUnavailable:true,appleCompilationVerified:true}),{status:'unavailable',exitCode:77});
 assert.deepEqual(reportOutcome({hasFailures:false,hasUnavailable:false,appleCompilationVerified:false}),{status:'unavailable',exitCode:77});
 assert.deepEqual(reportOutcome({hasFailures:true,hasUnavailable:true,appleCompilationVerified:false}),{status:'failed',exitCode:1});
});
