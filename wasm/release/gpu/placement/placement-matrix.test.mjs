// All compiler/GPU records in these tests are synthetic unit fixtures, never
// native validation evidence. Production CLI has no dependency-injection flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,chmodSync} from 'node:fs';
import {join,basename,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {suite,placementGPUCases,cases,expected,initialOutput,inputs,wordsToBytes,sha256} from './placement-gpu.mjs';
import {runMatrix,resolveReferenceCase,prerequisiteOutcome,aggregate,validateCompileRecords} from './run-placement-matrix.mjs';
const contract=placementGPUCases();
function environment(fn) {
  const dir=mkdtempSync(join(tmpdir(),'placement-matrix-synthetic-unit-')),reference=join(dir,'reference'),output=join(dir,'matrix'),harness=join(dir,'synthetic-not-executable');mkdirSync(reference);writeFileSync(harness,'SYNTHETIC UNIT STUB; never invoked');
  const report={schemaVersion:2,mode:'apple-reference-compile-link',runtime:{apiVersion:3},status:'failed',exitCode:1,hasFailures:true,cases:[],commands:[]};
  for(const [i,c] of contract.entries()) {
    const name='case-'+i,source=join(reference,name+'.metal'),air=join(reference,name+'.air'),apple=join(reference,name+'.apple.metallib'),floor=join(reference,name+'.floor.metallib'),input=join(reference,name+'.json');
    writeFileSync(source,c.source);writeFileSync(air,'SYNTHETIC AIR '+i);writeFileSync(apple,'MTLB SYNTHETIC APPLE '+i);writeFileSync(floor,'MTLB SYNTHETIC FLOOR '+i);
    writeFileSync(input,JSON.stringify({...c,name,aliases:[c.name]}));
    report.cases.push({name,aliases:[c.name],api:3,ios:27,math:0,appleMetalVersion:410,floorMetalVersion:410,languageMatched:true,sourceSha256:c.sourceSha256,appleCompile:'passed',appleLink:'passed',floorCompile:'passed',airSha256:sha256(readFileSync(air)),appleMetallibSha256:sha256(readFileSync(apple)),floorMetallibSha256:sha256(readFileSync(floor))});
    for(const command of [['xcrun','-sdk','iphoneos','metal','-target','air64-apple-ios27.0','-std=metal4.1','-fno-fast-math','-c',source,'-o',air],['xcrun','-sdk','iphoneos','metallib',air,'-o',apple],['/fixture/bin/node','/fixture/apple-reference.mjs','--worker','/fixture/runtime',input,floor]])report.commands.push({command,status:0,stdout:'',stderr:''});
  }
  const flush=()=>writeFileSync(join(reference,'report.json'),JSON.stringify(report));flush();const calls=[];
  const spawn=(exe,args,options)=>{calls.push({exe,args,options});const opt=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[2*i],args[2*i+1]]));syntheticGPU(opt);return {status:0,signal:null,stdout:'synthetic stdout',stderr:''};};
  try {return fn({dir,reference,output,harness,report,flush,calls,spawn,run(deps={}){flush();return runMatrix({referenceDirectory:reference,outputDirectory:output,harness}, {spawn,...deps});}});}finally{rmSync(dir,{recursive:true,force:true});}
}
function syntheticGPU(options,{exit=0,mutate}={}) {
  const dir=options['--output'];mkdirSync(dir);const descriptorBytes=readFileSync(options['--descriptor']),d=JSON.parse(descriptorBytes),c=cases.find(c=>c.name===d.case.name);
  const raw=(b,file)=>{writeFileSync(join(dir,file),b);return {file,bytes:b.length,sha256:sha256(b)};};
  const r={schema:1,suite,feature:'msl41-placement-gpu',scope:'gpu_pair',qualification:'numerical_only',compilerProvenance:'requires_external_compile_record_review',status:exit===0?'passed':exit===77?'unavailable':'failed',exitCode:exit,descriptorValidation:'passed',descriptor:d,descriptorSha256:sha256(descriptorBytes),case:c,device:'SYNTHETIC UNIT TEST ONLY',registryID:'0',inputVectors:inputs(),initialOutput:raw(initialOutput(),'initial.u8le'),pairComparison:{status:'passed',trialsCompared:12}};
  r.fixtures=inputs().map((input,i)=>{const e=expected(c,input);return {trial:i,input,trace:e.trace,inputRaw:raw(wordsToBytes(input),`i-${i}`),expectedOutput:raw(e.output,`o-${i}`),expectedArena:raw(e.arena,`a-${i}`)};});
  r.backends=Object.fromEntries(['apple','floor'].map(label=>[label,{load:{status:'passed',...d[label]},pipeline:{status:'passed',entry:c.name},execution:{status:'passed',trialsCompleted:12},numerical:{status:'passed',trialsCompared:12},trials:inputs().map((input,i)=>{const e=expected(c,input);return {trial:i,execution:'passed',numerical:'passed',output:raw(e.output,`${label}-${i}-o`),arenaSnapshot:raw(e.arena,`${label}-${i}-s`),outputMismatch:{count:0,first:[],actualBytes:160,expectedBytes:160},...(c.space==='device'?{deviceArena:raw(e.arena,`${label}-${i}-d`),arenaMismatch:{count:0,first:[],actualBytes:64,expectedBytes:64}}:{})};})}]));
  if(exit===77){r.reason='Synthetic unavailable';for(const label of ['apple','floor'])for(const stage of ['load','pipeline','execution','numerical'])r.backends[label][stage].status=stage==='load'?'failed':'not_run';}
  if(mutate)mutate(r,dir);writeFileSync(join(dir,'report.json'),JSON.stringify(r));return r;
}
const opts=args=>Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[2*i],args[2*i+1]]));
test('all six prelisted and verified independently despite failed unrelated primary gate',()=>environment(e=>{
  const r=e.run();assert.equal(r.status,'passed');assert.equal(r.exitCode,0);assert.equal(r.reference.status,'failed');assert.equal(r.summary.passed,6);assert.equal(e.calls.length,6);assert(r.cases.every(c=>c.gpu.rawEvidenceVerified));
  for(const call of e.calls){assert.equal(call.options.timeout,180000);assert.equal(call.options.killSignal,'SIGKILL');assert.equal(call.options.shell,false);assert.equal(call.options.maxBuffer,2097152);}
  assert.equal(JSON.parse(readFileSync(join(e.output,'matrix-report.json'))).cases.length,6);
}));
test('missing aliases remain six explicit missing cases, not vacuous success',()=>environment(e=>{e.report.cases=[];const r=e.run();assert.equal(r.status,'unavailable');assert.equal(r.exitCode,77);assert.equal(r.summary.missing,6);assert.equal(e.calls.length,0);}));
test('each missing alias does not prevent the other five executions',()=>environment(e=>{e.report.cases[0].aliases=['unrelated'];const r=e.run();assert.equal(r.cases[0].status,'missing');assert.equal(r.summary.passed,5);assert.equal(e.calls.length,5);}));
for(const [key,value] of Object.entries({api:2,ios:26,math:1,appleMetalVersion:400,floorMetalVersion:320,languageMatched:false,sourceSha256:'0'.repeat(64)}))test('wrong reference '+key+' fails only the matching case',()=>environment(e=>{e.report.cases[0][key]=value;const r=e.run();assert.equal(r.cases[0].status,'failed');assert.equal(r.summary.passed,5);}));
test('duplicate placement alias is rejected rather than picking a successful one',()=>environment(e=>{e.report.cases.push({...e.report.cases[0],name:'duplicate'});assert.equal(e.run().cases[0].status,'failed');}));
for(const stage of ['appleCompile','appleLink','floorCompile'])for(const state of ['failed','unavailable','pending','blocked','not_run'])test(stage+' '+state+' preserved without invoking that GPU case',()=>environment(e=>{e.report.cases[0][stage]=state;const r=e.run();assert.equal(r.cases[0].status,state==='failed'?'failed':state==='unavailable'?'unavailable':'blocked');assert.equal(r.summary.passed,5);assert.equal(e.calls.length,5);}));
for(const field of ['airSha256','appleMetallibSha256','floorMetallibSha256'])test('artifact '+field+' mismatch fails closed',()=>environment(e=>{e.report.cases[0][field]='0'.repeat(64);const r=e.run();assert.equal(r.cases[0].artifactValidation,'failed');assert.equal(r.summary.passed,5);}));
test('original source changes cannot reuse recorded hashes',()=>environment(e=>{writeFileSync(join(e.reference,'case-0.metal'),contract[0].source+'\n');assert.equal(e.run().cases[0].status,'failed');}));
test('compiler JSON source cannot differ from actual source',()=>environment(e=>{const p=join(e.reference,'case-0.json'),x=JSON.parse(readFileSync(p));x.source+='\n';writeFileSync(p,JSON.stringify(x));assert.equal(e.run().cases[0].status,'failed');}));
test('symlink library is not an original ordinary file',()=>environment(e=>{const p=join(e.reference,'case-0.floor.metallib');rmSync(p);symlinkSync(join(e.reference,'case-1.floor.metallib'),p);assert.equal(e.run().cases[0].status,'failed');}));
test('identical duplicate Apple/FLOOR bytes cannot establish independent pair',()=>environment(e=>{const a=readFileSync(join(e.reference,'case-0.apple.metallib'));writeFileSync(join(e.reference,'case-0.floor.metallib'),a);e.report.cases[0].floorMetallibSha256=sha256(a);assert.equal(e.run().cases[0].status,'failed');}));
for(const delta of [r=>r.commands.shift(),r=>{r.commands[0].status=1;},r=>{r.commands[0].command[7]='-ffast-math';},r=>{r.commands[0].command.push('unexpected');},r=>{r.commands[1].command[2]='macosx';},r=>{r.commands[2].command[2]='other';},r=>{r.runtime.apiVersion=2;}])test('missing/changed producing commands or runtime fail closed '+delta.toString(),()=>environment(e=>{delta(e.report);assert.equal(e.run().cases[0].status,'failed');}));
test('unavailable is preserved and never passes',()=>environment(e=>{const r=e.run({spawn(exe,args){syntheticGPU(opts(args),{exit:77});return {status:77};}});assert.equal(r.status,'unavailable');assert.equal(r.summary.unavailable,6);assert.equal(r.exitCode,77);}));
test('observed numerical failure reported as unavailable is rejected',()=>environment(e=>{const r=e.run({spawn(exe,args){syntheticGPU(opts(args),{exit:77,mutate(r){r.backends.floor.numerical.status='failed';}});return {status:77};}});assert.equal(r.summary.failed,6);}));
test('successful exit with false report/raw evidence fails strict verifier',()=>environment(e=>{let n=0;const r=e.run({spawn(exe,args,config){if(n++!==0)return e.spawn(exe,args,config);syntheticGPU(opts(args),{mutate(r,dir){const raw=r.backends.floor.trials[0].output,b=readFileSync(join(dir,raw.file));b[0]^=1;writeFileSync(join(dir,raw.file),b);raw.sha256=sha256(b);}});return {status:0};}});assert.equal(r.cases[0].status,'failed');assert.equal(r.cases[0].errors[0].stage,'rawEvidenceVerification');assert.equal(r.summary.passed,5);}));
test('CPU-only or unrelated harness report cannot qualify',()=>environment(e=>{const r=e.run({spawn(exe,args){syntheticGPU(opts(args),{mutate(r){r.scope='cpu_oracle_only';}});return {status:0};}});assert.equal(r.summary.failed,6);}));
test('missing report after successful exit is failed and later cases still run',()=>environment(e=>{let n=0;const r=e.run({spawn(exe,args,options){if(n++===0)return {status:0};return e.spawn(exe,args,options);}});assert.equal(r.summary.failed,1);assert.equal(r.summary.passed,5);}));
test('timeout logs process failure and blocks remaining dispatches with all six rows retained',()=>environment(e=>{let calls=0;const r=e.run({spawn(){calls++;return {status:null,signal:'SIGKILL',error:Object.assign(new Error('synthetic timeout'),{code:'ETIMEDOUT'}),stdout:'before timeout',stderr:'timeout'};}});assert.equal(calls,1);assert.equal(r.cases.length,6);assert.equal(r.summary.failed,1);assert.equal(r.summary.blocked,5);assert.equal(r.cases[0].process.signal,'SIGKILL');assert.equal(r.exitCode,1);}));
test('ordinary process failure continues unrelated later cases',()=>environment(e=>{let n=0;const r=e.run({spawn(exe,args,options){if(n++===0)return {status:1,stderr:'synthetic failure'};return e.spawn(exe,args,options);}});assert.equal(r.summary.failed,1);assert.equal(r.summary.passed,5);}));
test('malformed primary report still produces all six blocked rows',()=>environment(e=>{e.report.schemaVersion=999;const r=e.run();assert.equal(r.exitCode,1);assert.equal(r.cases.length,6);assert(r.cases.every(x=>x.status==='blocked'));assert.equal(e.calls.length,0);}));
test('existing output directory is refused',()=>environment(e=>{mkdirSync(e.output);assert.throws(()=>e.run(),/EEXIST/);}));
test('matrix aggregate cannot call a partial or empty set passed',()=>{assert.equal(aggregate([]).exitCode,77);assert.equal(aggregate(Array(5).fill({status:'passed'})).exitCode,77);assert.equal(aggregate(Array(6).fill({status:'passed'})).exitCode,0);});
for(const index of [1,2])test('trailing producing-command argument rejected at command '+index,()=>environment(e=>{e.report.commands[index].command.push('unchecked-trailing-argument');const r=e.run();assert.equal(r.cases[0].status,'failed');assert.equal(r.summary.passed,5);}));
test('missing expected original library is a failure, not silent omission',()=>environment(e=>{rmSync(join(e.reference,'case-0.floor.metallib'));const r=e.run();assert.equal(r.cases[0].status,'failed');assert.equal(r.summary.passed,5);}));

for(const mutation of [r=>{delete r.status;delete r.exitCode;},r=>{r.status='in_progress';},r=>{r.status='failed';r.exitCode=0;}])test('unfinished/inconsistent primary report rejected '+mutation.toString(),()=>environment(e=>{mutation(e.report);const r=e.run();assert.equal(r.exitCode,1);assert(r.cases.every(x=>x.status==='blocked'));assert.equal(e.calls.length,0);}));
for(const [index,arg] of [[0,11],[1,4],[1,6],[2,4],[2,5]])test('disconnected producing path rejected '+index+':'+arg,()=>environment(e=>{e.report.commands[index].command[arg]='/different-original-directory/'+basename(e.report.commands[index].command[arg]);const r=e.run();assert.equal(r.cases[0].status,'failed');assert.equal(r.summary.passed,5);}));
for(const [arg,value] of [[0,'/some/path/not-node'],[1,'relative/apple-reference.mjs'],[3,'relative-runtime']])test('worker command argument shape checked '+arg,()=>environment(e=>{e.report.commands[2].command[arg]=value;assert.equal(e.run().cases[0].status,'failed');}));
test('timeout fence survives a subsequent stdout log-write failure',()=>environment(e=>{let calls=0;const r=e.run({spawn(exe,args){calls++;mkdirSync(join(dirname(opts(args)['--output']),'stdout.log'));return {status:null,signal:'SIGKILL',error:Object.assign(new Error('synthetic timeout'),{code:'ETIMEDOUT'})};}});assert.equal(calls,1);assert.equal(r.summary.failed,1);assert.equal(r.summary.blocked,5);assert.equal(r.cases[0].process.signal,'SIGKILL');}));
test('reported GPU timeout fence survives a subsequent log-write failure',()=>environment(e=>{let calls=0;const r=e.run({spawn(exe,args){calls++;const o=opts(args);syntheticGPU(o,{exit:1,mutate(r){r.backends.apple.execution.status='timed_out';}});mkdirSync(join(dirname(o['--output']),'stdout.log'));return {status:1};}});assert.equal(calls,1);assert.equal(r.summary.failed,1);assert.equal(r.summary.blocked,5);}));

test('actual CLI subprocess records six ordinary failures and logs without a GPU',()=>environment(e=>{
  writeFileSync(e.harness,'#!/usr/bin/env node\nprocess.stdout.write("synthetic stdout\\n");process.stderr.write("synthetic stderr\\n");process.exit(1);\n');chmodSync(e.harness,0o755);e.flush();
  const run=spawnSync(process.execPath,[fileURLToPath(new URL('./run-placement-matrix.mjs',import.meta.url)),'--reference-directory',e.reference,'--harness',e.harness,'--output',e.output],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,1,run.stderr);const r=JSON.parse(readFileSync(join(e.output,'matrix-report.json')));assert.equal(r.summary.failed,6);assert(r.cases.every(x=>x.process.status===1&&x.process.stderr.bytes>0));
  assert.equal(readFileSync(join(e.output,r.cases[0].process.stdout.file),'utf8'),'synthetic stdout\n');
}));
test('actual subprocess timeout is bounded and does not dispatch later cases',()=>environment(e=>{
  writeFileSync(e.harness,'#!/usr/bin/env node\nsetInterval(()=>{},1000);\n');chmodSync(e.harness,0o755);e.flush();
  const r=runMatrix({referenceDirectory:e.reference,outputDirectory:e.output,harness:e.harness,timeoutMs:1000});
  assert.equal(r.exitCode,1);assert.equal(r.summary.failed,1);assert.equal(r.summary.blocked,5);assert.equal(r.cases[0].process.signal,'SIGKILL');assert(r.cases[0].process.error.includes('ETIMEDOUT'));
}));
