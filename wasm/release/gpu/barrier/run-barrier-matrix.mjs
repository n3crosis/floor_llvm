// Standalone, always-after-primary postprocessor. Does not compile, retarget,
// rewrite libraries, start CI, or alter the generic GPU report schema.
import assert from 'node:assert/strict';
import {lstatSync,mkdirSync,writeFileSync,renameSync,realpathSync,accessSync,constants} from 'node:fs';
import {resolve,join,basename,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {suite,expectedNames,frozenSwiftSha256,barrierGPUCases,boundedRead,jsonFile,identity,sha256,copy,aggregate,validateRunReport,observedBackendStages} from './barrier-gpu.mjs';
import {verifyDirectory} from './verify-barrier-gpu.mjs';
const LOG_LIMIT=256*1024;
export function resolveReferenceCase(report,c) {
  const found=report.cases.filter(r=>r?.name===c.alias||(Array.isArray(r?.aliases)&&r.aliases.includes(c.alias)));
  if(found.length===0)return {status:'missing',reason:'Expected barrier alias is absent from completed reference report'};
  assert.equal(found.length,1,'Ambiguous duplicate barrier alias');const r=found[0];
  assert(typeof r.name==='string'&&/^case-\d{1,8}$/.test(r.name),'Unsafe reference case basename');
  for(const [key,value] of Object.entries({api:3,ios:27,math:0,appleMetalVersion:410,floorMetalVersion:410,languageMatched:true,sourceSha256:c.sourceSha256}))assert.equal(r[key],value,'Wrong barrier reference '+key);
  return {status:'resolved',reference:r};
}
export function prerequisiteOutcome(r) {
  const stages=['appleCompile','appleLink','floorCompile'];
  for(const s of stages)assert(['passed','failed','unavailable','blocked','pending','not_run'].includes(r[s]),'Unknown original compiler stage outcome');
  if(stages.some(s=>r[s]==='failed'))return {status:'failed',reason:'Required original compiler/link stage failed'};
  if(stages.some(s=>r[s]==='unavailable'))return {status:'unavailable',reason:'Required original compiler/link stage unavailable'};
  if(stages.some(s=>r[s]!=='passed'))return {status:'blocked',reason:'Original library preparation is incomplete'};
  return {status:'ready'};
}
export function validateCompileRecords(report,r) {
  assert.equal(report.runtime?.apiVersion,3,'Original runtime does not advertise API3');
  assert(Array.isArray(report.commands)&&report.commands.length<=100000,'Missing or oversized producing command records');
  const success=report.commands.filter(c=>c.status===0&&!c.signal&&!c.error&&Array.isArray(c.command));
  const named=(p,n)=>typeof p==='string'&&basename(p)===n;
  const flags=['-sdk','iphoneos','metal','-target','air64-apple-ios27.0','-std=metal4.1','-fno-fast-math','-c'];
  const apple=success.filter(c=>c.command.length===12&&c.command[0]==='xcrun'&&flags.every((x,i)=>c.command[i+1]===x)&&named(c.command[9],r.name+'.metal')&&c.command[10]==='-o'&&named(c.command[11],r.name+'.air'));
  const link=success.filter(c=>c.command.length===7&&c.command[0]==='xcrun'&&c.command[1]==='-sdk'&&c.command[2]==='iphoneos'&&c.command[3]==='metallib'&&named(c.command[4],r.name+'.air')&&c.command[5]==='-o'&&named(c.command[6],r.name+'.apple.metallib'));
  const floor=success.filter(c=>c.command.length===6&&typeof c.command[0]==='string'&&isAbsolute(c.command[0])&&['node','nodejs'].includes(basename(c.command[0]))&&typeof c.command[1]==='string'&&isAbsolute(c.command[1])&&basename(c.command[1])==='apple-reference.mjs'&&c.command[2]==='--worker'&&typeof c.command[3]==='string'&&isAbsolute(c.command[3])&&named(c.command[4],r.name+'.json')&&named(c.command[5],r.name+'.floor.metallib'));
  assert.equal(apple.length,1,'Missing or ambiguous exact Apple compile command');assert.equal(link.length,1,'Missing or ambiguous original link command');assert.equal(floor.length,1,'Missing or ambiguous original FLOOR worker command');
  const a=apple[0].command,l=link[0].command,f=floor[0].command;
  assert(isAbsolute(a[9])&&resolve(a[9])===a[9],'Original source path must be absolute and normalized');
  const recordedDirectory=dirname(a[9]);
  for(const [actual,suffix] of [[a[9],'.metal'],[a[11],'.air'],[l[4],'.air'],[l[6],'.apple.metallib'],[f[4],'.json'],[f[5],'.floor.metallib']])
    assert.equal(actual,join(recordedDirectory,r.name+suffix),'Producing paths do not form an original artifact chain');
  return {recordedDirectory,appleCompile:copy(a),appleLink:copy(l),floorCompile:copy(f),runtime:copy(report.runtime)};
}
export function makeReceipt(root,report,reportIdentity,r,c) {
  const provenance=validateCompileRecords(report,r),files={source:join(root,r.name+'.metal'),air:join(root,r.name+'.air'),apple:join(root,r.name+'.apple.metallib'),floor:join(root,r.name+'.floor.metallib'),input:join(root,r.name+'.json')};
  const source=boundedRead(files.source,4096),input=jsonFile(files.input,65536),air=boundedRead(files.air,32*1024*1024);
  assert.equal(source.toString('utf8'),c.source,'Original source bytes differ');assert.equal(source.length,c.sourceBytes);
  for(const [key,value] of Object.entries({name:r.name,source:c.source,sourceSha256:c.sourceSha256,api:3,ios:27,metalVersion:410,math:0,kind:0}))assert.deepEqual(input[key],value,'Original FLOOR input '+key+' differs');
  assert(Array.isArray(input.aliases)&&input.aliases.includes(c.alias),'Original worker input lacks exact barrier alias');
  assert.equal(sha256(air),r.airSha256,'Original Apple AIR hash mismatch');
  const apple=boundedRead(files.apple,32*1024*1024),floor=boundedRead(files.floor,32*1024*1024);
  for(const b of [apple,floor])assert.equal(b.subarray(0,4).toString(),'MTLB','Original file is not a metallib');
  assert.equal(sha256(apple),r.appleMetallibSha256,'Original Apple metallib hash mismatch');
  assert.equal(sha256(floor),r.floorMetallibSha256,'Original FLOOR metallib hash mismatch');
  assert.notEqual(r.appleMetallibSha256,r.floorMetallibSha256,'Identical libraries do not establish an independent original pair');
  return {schema:1,suite,case:c.name,entry:c.entry,alias:c.alias,referenceCase:r.name,sourceSha256:c.sourceSha256,
    target:{api:3,ios:27,metalVersion:410,math:0,kind:0},compileReport:reportIdentity,compileProvenance:provenance,
    artifacts:Object.fromEntries(Object.entries({source,air,apple,floor}).map(([label,b])=>[label,{...identity(b),file:files[label]}])),files};
}
function gpuTimeout(report) {return report?.error?.stage==='execution'&&/timed?\s*out|timeout|budget exceeded/i.test(report.error.message??'');}
function gpuPending(report) {return gpuTimeout(report)||['in_progress','incomplete','timed_out'].includes(report?.execution)||['apple','floor'].some(label=>['in_progress','incomplete','timed_out'].includes(report?.backends?.[label]?.execution?.status));}
export function runMatrix({referenceDirectory,outputDirectory,harness,timeoutMs=150000,matrixTimeoutMs=1200000},deps={}) {
  const spawn=deps.spawn??spawnSync,now=deps.now??(()=>performance.now());
  assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'Case timeout must be1000..300000ms');
  assert(Number.isSafeInteger(matrixTimeoutMs)&&matrixTimeoutMs>=1000&&matrixTimeoutMs<=2400000,'Matrix timeout must be1000..2400000ms');
  const root=resolve(referenceDirectory),out=resolve(outputDirectory),exe=resolve(harness),start=now();
  // Refuse reuse before writing anything. Exactly eight rows exist before any
  // descriptor, report, executable or original library is inspected.
  mkdirSync(out,{recursive:false});
  const matrix={schema:1,suite,scope:'standalone_gpu_matrix',qualification:'bounded_barrier_exchange_only',primaryGateIndependent:true,
    status:'in_progress',caseTimeoutMs:timeoutMs,matrixTimeoutMs,cases:expectedNames.map(name=>({name,status:'pending',artifactValidation:'not_run',gpu:{status:'not_run'},backends:observedBackendStages(null),errors:[]}))};
  const save=()=>{matrix.elapsedMs=Math.max(0,Math.round(now()-start));writeFileSync(join(out,'matrix-report.json.tmp'),JSON.stringify(matrix,null,2)+'\n');renameSync(join(out,'matrix-report.json.tmp'),join(out,'matrix-report.json'));};
  save();
  try {
    const cases=barrierGPUCases();for(const [i,c] of cases.entries()){assert.equal(matrix.cases[i].name,c.name);Object.assign(matrix.cases[i],{alias:c.alias,sourceSha256:c.sourceSha256,entry:c.entry,barrierKind:c.barrierKind,barrierOrder:c.barrierOrder,barrierScope:c.barrierScope});}
    const sourceBytes=boundedRead(new URL('../../metal-barrier-gpu.swift',import.meta.url),128*1024);assert.equal(sha256(sourceBytes),frozenSwiftSha256,'Native-compiled Swift source changed');
    matrix.frozenSwift={sha256:frozenSwiftSha256,bytes:sourceBytes.length};
    assert(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'Reference root must be an ordinary directory');assert.notEqual(realpathSync(root),realpathSync(out));
    const raw=boundedRead(join(root,'report.json'),32*1024*1024),reference=JSON.parse(raw);
    assert.equal(reference.schemaVersion,2);assert.equal(reference.mode,'apple-reference-compile-link');assert(Array.isArray(reference.cases)&&reference.cases.length<=10000);
    assert(['passed','failed','unavailable'].includes(reference.status),'Primary reference report is unfinished');assert.equal(reference.exitCode,{passed:0,failed:1,unavailable:77}[reference.status]);
    matrix.reference={...identity(raw),file:join(root,'report.json'),status:reference.status,exitCode:reference.exitCode};
    writeFileSync(join(out,'compile-report-input.json'),raw,{flag:'wx'});
    let harnessError=null;
    try {const bytes=boundedRead(exe,128*1024*1024);accessSync(exe,constants.X_OK);matrix.harness={...identity(bytes),file:exe};}
    catch(error){harnessError=String(error);matrix.harness={file:exe,error:harnessError};}
    let dispatchFence=false;
    for(const [i,c] of cases.entries()) {
      const row=matrix.cases[i];let stage='referenceResolution';
      try {
        const resolved=resolveReferenceCase(reference,c);row.resolution=resolved.status;
        if(resolved.status==='missing'){row.status='missing';row.reason=resolved.reason;save();continue;}
        const r=resolved.reference;row.referenceCase=r.name;row.referenceStages=Object.fromEntries(['appleCompile','appleLink','floorCompile'].map(k=>[k,r[k]]));
        const ready=prerequisiteOutcome(r);
        if(ready.status!=='ready'){row.status=ready.status;row.reason=ready.reason;row.gpu.status='blocked';save();continue;}
        stage='artifactValidation';const receipt=makeReceipt(root,reference,identity(raw),r,c);row.artifactValidation='passed';
        const dir=join(out,c.name);mkdirSync(dir);const receiptPath=join(dir,'pair-receipt.json'),receiptBytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');writeFileSync(receiptPath,receiptBytes,{flag:'wx'});
        row.receipt={...identity(receiptBytes),file:c.name+'/pair-receipt.json'};row.artifacts=receipt.artifacts;
        if(dispatchFence){row.status='blocked';row.gpu.status='blocked';row.reason='An earlier GPU timeout/termination may leave work pending; no later dispatch attempted';save();continue;}
        if(harnessError){row.status='blocked';row.gpu.status='blocked';row.reason=harnessError;save();continue;}
        const remaining=Math.floor(matrixTimeoutMs-(now()-start));
        if(remaining<1000){row.status='blocked';row.gpu.status='blocked';row.reason='Matrix time budget exhausted';save();continue;}
        // Recheck executable identity immediately before each invocation.
        assert.deepEqual(identity(boundedRead(exe,128*1024*1024)),{sha256:matrix.harness.sha256,bytes:matrix.harness.bytes},'Harness changed between cases');
        const gpuDir=join(dir,'gpu'),args=['--apple',receipt.files.apple,'--floor',receipt.files.floor,'--kind',c.barrierKind,'--output',gpuDir];
        row.gpu.status='in_progress';save();stage='gpuProcess';
        const run=spawn(exe,args,{encoding:'utf8',timeout:Math.min(timeoutMs,remaining),maxBuffer:1024*1024,killSignal:'SIGKILL',shell:false});
        const processTimeout=run.error?.code==='ETIMEDOUT';
        // Fence before report/log writes: even failed evidence persistence must
        // not allow another dispatch after a timeout or signal termination.
        if(processTimeout||run.signal)dispatchFence=true;
        if(processTimeout)row.timeoutObserved=true;
        row.process={command:[exe,...args],timeoutMs:Math.min(timeoutMs,remaining),status:run.status??null,signal:run.signal??null,error:run.error?.message??null};
        let gpuReport,reportBytes;
        try {reportBytes=boundedRead(join(gpuDir,'report.json'),256*1024);gpuReport=JSON.parse(reportBytes);row.gpu.report={...identity(reportBytes),file:c.name+'/gpu/report.json'};row.gpu.details=gpuReport;row.backends=observedBackendStages(gpuReport);if(gpuPending(gpuReport)){dispatchFence=true;row.pendingExecutionObserved=true;}if(gpuTimeout(gpuReport))row.timeoutObserved=true;}
        catch(error){row.gpu.reportError=String(error);row.gpu.reportMissing=error?.code==='ENOENT';row.executionCompletionUnknown=true;dispatchFence=true;}
        for(const label of ['stdout','stderr']) {
          const bytes=Buffer.from(run[label]??''),captured=bytes.subarray(0,LOG_LIMIT);writeFileSync(join(dir,label+'.log'),captured);
          row.process[label]={...identity(captured),file:c.name+'/'+label+'.log',observedBytes:bytes.length,truncated:bytes.length>captured.length};
        }
        if(processTimeout||gpuTimeout(gpuReport)){row.status='timeout';row.gpu.status='failed';row.reason='GPU timeout; later dispatches fenced';save();continue;}
        if(row.pendingExecutionObserved){row.status='failed';row.gpu.status='failed';row.reason='GPU report indicates incomplete or pending execution; later dispatches fenced';save();continue;}
        assert(!run.error&&!run.signal,'GPU subprocess failed: '+(run.error?.message??run.signal));
        if(!gpuReport){row.status=run.status===0&&row.gpu.reportMissing?'missing':'failed';row.gpu.status=row.status;row.reason='Harness produced no readable completion report; later dispatches fenced';save();continue;}
        stage='gpuReportValidation';validateRunReport(gpuReport,run.status,c,receipt);row.gpu.reportValidated=true;row.gpu.status=gpuReport.status;
        if(run.status!==0){
          const floorRejected=row.backends.floor.libraryLoading.status==='failed';
          row.status=run.status===77&&!floorRejected?'unavailable':'failed';
          row.reason=run.status===77&&floorRejected?'FLOOR library rejection was attempted even though the Apple reference is unavailable':gpuReport.error?.message??'Harness reported '+gpuReport.status;
          save();continue;
        }
        stage='rawEvidenceVerification';
        const verified=verifyDirectory({directory:gpuDir,receiptPath,sourcePath:receipt.files.source,applePath:receipt.files.apple,floorPath:receipt.files.floor});
        assert.equal(verified.status,'verified_numerical_pass');assert.equal(verified.case,c.name);assert.equal(verified.trialsPerBackend,16);
        row.gpu.verification=verified;row.gpu.rawEvidenceVerified=true;row.backends=verified.backends;row.status='passed';
      } catch(error) {
        if(stage==='gpuReportValidation'){dispatchFence=true;row.executionCompletionUnknown=true;}
        row.status=row.timeoutObserved?'timeout':error?.code==='ENOENT'?'missing':'failed';row.errors.push({stage,error:String(error)});
        if(stage==='artifactValidation')row.artifactValidation=row.status;
        if(stage.startsWith('gpu')||stage==='rawEvidenceVerification')row.gpu.status=row.status;
      }
      save();
    }
    Object.assign(matrix,aggregate(matrix.cases));
  } catch(error) {
    matrix.error=String(error);for(const row of matrix.cases)if(row.status==='pending'){row.status=error?.code==='ENOENT'?'missing':'blocked';row.reason='Matrix preparation failed';}
    Object.assign(matrix,aggregate(matrix.cases));if(error?.code!=='ENOENT'){matrix.status='failed';matrix.exitCode=1;}
  }
  save();return matrix;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),keys=['--reference-directory','--output','--harness','--timeout-ms','--matrix-timeout-ms'],o={};
    assert([6,8,10].includes(args.length),'Usage: node run-barrier-matrix.mjs --reference-directory COMPLETED_OUTPUT --harness FROZEN_SWIFT_EXECUTABLE --output NEW_DIRECTORY [--timeout-ms 150000] [--matrix-timeout-ms 1200000]');
    for(let i=0;i<args.length;i+=2){assert(keys.includes(args[i])&&!Object.hasOwn(o,args[i])&&args[i+1]&&!args[i+1].startsWith('--'));o[args[i]]=args[i+1];}
    for(const k of keys.slice(0,3))assert(o[k],'Missing '+k);
    const r=runMatrix({referenceDirectory:o['--reference-directory'],outputDirectory:o['--output'],harness:o['--harness'],timeoutMs:o['--timeout-ms']===undefined?150000:Number(o['--timeout-ms']),matrixTimeoutMs:o['--matrix-timeout-ms']===undefined?1200000:Number(o['--matrix-timeout-ms'])});
    console.log(JSON.stringify({status:r.status,exitCode:r.exitCode,counts:r.counts}));process.exitCode=r.exitCode;
  } catch(error){console.error(String(error));process.exitCode=1;}
}
