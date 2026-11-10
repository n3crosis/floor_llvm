// Postprocess an existing complete apple-reference output. Never compiles,
// retargets, modifies source libraries, or depends on the primary gate's exit.
import assert from 'node:assert/strict';
import {openSync,readSync,closeSync,fstatSync,lstatSync,writeFileSync,renameSync,mkdirSync,constants,realpathSync} from 'node:fs';
import {resolve,join,basename,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {suite,cases,placementGPUCases,sourceIdentities,sha256,descriptor,gpuArguments} from './placement-gpu.mjs';
import {verifyDirectory} from './verify-placement-gpu.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const copy=x=>JSON.parse(JSON.stringify(x));
export function boundedRead(path,max) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const st=fstatSync(fd);assert(st.isFile()&&st.size>0&&st.size<=max,'Expected bounded ordinary file: '+path);
    const data=Buffer.alloc(Math.min(max+1,st.size+1));let n=0;
    while(n<data.length){const got=readSync(fd,data,n,data.length-n,null);if(!got)break;n+=got;}
    assert.equal(n,st.size,'File size changed: '+path);return data.subarray(0,n);
  } finally {closeSync(fd);}
}
const jsonFile=(path,max)=>JSON.parse(boundedRead(path,max));
const fileIdentity=b=>({bytes:b.length,sha256:sha256(b)});
export function resolveReferenceCase(report,c) {
  const aliases=report.cases.filter(r=>r?.name===c.name||(Array.isArray(r?.aliases)&&r.aliases.includes(c.name)));
  if(aliases.length===0)return {status:'missing',reason:'Expected placement alias is absent from the reference report'};
  assert.equal(aliases.length,1,'Ambiguous duplicate placement alias: '+c.name);
  const r=aliases[0];assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(r.name),'Unsafe reference case name');
  assert.equal(r.sourceSha256,c.sourceSha256,'Placement source hash mismatch');
  for(const [key,want] of Object.entries({api:3,ios:27,math:0,appleMetalVersion:410,floorMetalVersion:410,languageMatched:true}))assert.equal(r[key],want,'Wrong placement '+key);
  return {status:'resolved',reference:r};
}
export function prerequisiteOutcome(r) {
  const stages=['appleCompile','appleLink','floorCompile'];
  for(const stage of stages)assert(['passed','failed','unavailable','blocked','pending','not_run'].includes(r[stage]),'Unknown '+stage+' outcome');
  if(stages.some(s=>r[s]==='failed'))return {status:'failed',gpu:'blocked',reason:'A required original-library compilation/link stage failed'};
  if(stages.some(s=>r[s]==='unavailable'))return {status:'unavailable',gpu:'blocked',reason:'An original-library compiler/link stage was unavailable'};
  if(stages.some(s=>r[s]!=='passed'))return {status:'blocked',gpu:'blocked',reason:'Original-library preparation is incomplete'};
  return {status:'ready'};
}
export function validateCompileRecords(report,r) {
  assert.equal(report.runtime?.apiVersion,3,'Original reference runtime must advertise API3');
  assert(Array.isArray(report.commands),'Missing producing command records');
  const successful=report.commands.filter(c=>c.status===0&&!c.signal&&!c.error&&Array.isArray(c.command));
  const isName=(path,name)=>typeof path==='string'&&basename(path)===name;
  const flags=['-sdk','iphoneos','metal','-target','air64-apple-ios27.0','-std=metal4.1','-fno-fast-math','-c'];
  const apple=successful.filter(c=>c.command.length===12&&c.command[0]==='xcrun'&&flags.every((v,i)=>c.command[i+1]===v)&&isName(c.command[9],r.name+'.metal')&&c.command[10]==='-o'&&isName(c.command[11],r.name+'.air'));
  assert.equal(apple.length,1,'Missing/ambiguous exact Apple Metal4.1 compile command');
  const links=successful.filter(c=>c.command.length===7&&c.command[0]==='xcrun'&&c.command[1]==='-sdk'&&c.command[2]==='iphoneos'&&c.command[3]==='metallib'&&isName(c.command[4],r.name+'.air')&&c.command[5]==='-o'&&isName(c.command[6],r.name+'.apple.metallib'));
  assert.equal(links.length,1,'Missing/ambiguous original Apple link command');
  const floor=successful.filter(c=>c.command.length===6&&typeof c.command[0]==='string'&&isAbsolute(c.command[0])&&['node','nodejs'].includes(basename(c.command[0]))&&typeof c.command[1]==='string'&&isAbsolute(c.command[1])&&basename(c.command[1])==='apple-reference.mjs'&&typeof c.command[3]==='string'&&isAbsolute(c.command[3])&&c.command[2]==='--worker'&&isName(c.command[4],r.name+'.json')&&isName(c.command[5],r.name+'.floor.metallib'));
  assert.equal(floor.length,1,'Missing/ambiguous original FLOOR compile worker command');
  const a=apple[0].command,l=links[0].command,f=floor[0].command;
  assert(isAbsolute(a[9])&&resolve(a[9])===a[9],'Recorded Apple source path must be normalized and absolute');
  const recordedDirectory=dirname(a[9]);
  for(const [actual,suffix] of [[a[9],'.metal'],[a[11],'.air'],[l[4],'.air'],[l[6],'.apple.metallib'],[f[4],'.json'],[f[5],'.floor.metallib']])
    assert.equal(actual,join(recordedDirectory,r.name+suffix),'Producing command paths do not form one original artifact chain');
  return {recordedDirectory,appleCompile:copy(apple[0].command),appleLink:copy(links[0].command),floorCompile:copy(floor[0].command),runtime:copy(report.runtime)};
}
export function aggregate(rows) {
  if(rows.some(c=>c.status==='failed'))return {status:'failed',exitCode:1};
  if(rows.length!==6||rows.some(c=>c.status!=='passed'))return {status:'unavailable',exitCode:77};
  return {status:'passed',exitCode:0};
}
function pendingGPU(report) {return ['apple','floor'].some(label=>report?.backends?.[label]?.execution?.status==='timed_out');}
function validateRunReport(r,status,wanted,descriptorBytes) {
  assert([0,1,77].includes(status),'Unexpected harness exit status');
  assert.equal(r.schema,1);assert.equal(r.suite,suite);assert.equal(r.feature,'msl41-placement-gpu');assert.equal(r.scope,'gpu_pair');
  assert.equal(r.qualification,'numerical_only');assert.equal(r.compilerProvenance,'requires_external_compile_record_review');
  assert.equal(r.status,status===0?'passed':status===77?'unavailable':'failed');assert.equal(r.exitCode,status);
  assert.equal(r.descriptorValidation,'passed');assert.deepEqual(r.descriptor,wanted);assert.deepEqual(r.case,wanted.case);assert.equal(r.descriptorSha256,sha256(descriptorBytes));
  if(status===77) {
    for(const label of ['apple','floor'])for(const stage of ['pipeline','execution','numerical'])assert(!['failed','timed_out','incomplete'].includes(r.backends?.[label]?.[stage]?.status),'Observed failure mislabeled unavailable');
    assert(r.backends?.apple?.load?.status!=='passed','Loaded reference cannot be marked unavailable');
  }
}
export function runMatrix({referenceDirectory,outputDirectory,harness,timeoutMs=180000},deps={}) {
  const spawn=deps.spawn??spawnSync, verify=deps.verify??verifyDirectory;
  assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=300000,'Timeout must be 1000..300000 ms');
  const root=resolve(referenceDirectory),out=resolve(outputDirectory),exe=resolve(harness);
  const matrix={schema:1,suite,feature:'msl41-placement-gpu',scope:'standalone_gpu_matrix',qualification:'numerical_only',status:'in_progress',primaryGateIndependent:true,
    cases:placementGPUCases().map(c=>({name:c.name,entry:c.entry,sourceSha256:c.sourceSha256,status:'pending',resolution:'not_run',artifactValidation:'not_run',gpu:{status:'not_run'},errors:[]}))};
  mkdirSync(out,{recursive:false});
  const save=()=>{writeFileSync(join(out,'matrix-report.json.tmp'),JSON.stringify(matrix,null,2)+'\n');renameSync(join(out,'matrix-report.json.tmp'),join(out,'matrix-report.json'));};
  save();
  try {
    assert(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'Reference output must be an ordinary directory');
    assert(realpathSync(root)!==realpathSync(out),'Reference and output directories must differ');
    const exeBytes=boundedRead(exe,64*1024*1024);matrix.harness={...fileIdentity(exeBytes),file:exe};
    const raw=boundedRead(join(root,'report.json'),32*1024*1024),reference=JSON.parse(raw);
    assert.equal(reference.schemaVersion,2);assert.equal(reference.mode,'apple-reference-compile-link');assert(Array.isArray(reference.cases));assert(reference.cases.length<=10000);
    assert(['passed','failed','unavailable'].includes(reference.status),'Primary reference report is unfinished');
    assert.equal(reference.exitCode,{passed:0,failed:1,unavailable:77}[reference.status],'Primary report status/exit disagreement');
    matrix.reference={...fileIdentity(raw),file:join(root,'report.json'),status:reference.status??'unfinished',exitCode:reference.exitCode??null,hasFailures:reference.hasFailures??null};
    let blockedByPendingGPU=false;
    for(const [i,c] of placementGPUCases().entries()) {
      const row=matrix.cases[i];let stage='referenceResolution';
      try {
        const resolved=resolveReferenceCase(reference,c);row.resolution=resolved.status;
        if(resolved.status==='missing'){row.status='missing';row.reason=resolved.reason;save();continue;}
        const r=resolved.reference;row.referenceCase=r.name;row.referenceStages=Object.fromEntries(['appleCompile','appleLink','floorCompile'].map(k=>[k,r[k]]));
        const ready=prerequisiteOutcome(r);if(ready.status!=='ready'){Object.assign(row,{status:ready.status,reason:ready.reason,gpu:{status:'blocked'}});save();continue;}
        stage='artifactValidation';
        row.compileProvenance=validateCompileRecords(reference,r);
        const source=join(root,r.name+'.metal'),apple=join(root,r.name+'.apple.metallib'),floor=join(root,r.name+'.floor.metallib');
        const sourceBytes=boundedRead(source,4096);assert.equal(sha256(sourceBytes),c.sourceSha256);assert.equal(sourceBytes.length,sourceIdentities[c.name].bytes);
        const input=jsonFile(join(root,r.name+'.json'),64*1024);
        for(const [key,value] of Object.entries({name:r.name,api:3,ios:27,metalVersion:410,math:0,kind:0,sourceSha256:c.sourceSha256,source:c.source}))assert.deepEqual(input[key],value,'Compiler input '+key+' mismatch');
        assert(Array.isArray(input.aliases)&&input.aliases.includes(c.name),'Compiler input lacks expected placement alias');
        const air=boundedRead(join(root,r.name+'.air'),32*1024*1024);assert.equal(sha256(air),r.airSha256,'Apple AIR identity mismatch');
        const wanted=descriptor(c.name,apple,floor);
        assert.equal(wanted.apple.sha256,r.appleMetallibSha256,'Apple library identity mismatch');assert.equal(wanted.floor.sha256,r.floorMetallibSha256,'FLOOR library identity mismatch');
        assert.notEqual(wanted.apple.sha256,wanted.floor.sha256,'Independent original libraries cannot be established from identical bytes');
        row.artifactValidation='passed';row.artifacts={source:{...fileIdentity(sourceBytes),file:source},air:{...fileIdentity(air),file:join(root,r.name+'.air')},apple:{...wanted.apple,file:apple},floor:{...wanted.floor,file:floor}};
        if(blockedByPendingGPU){row.status='blocked';row.reason='An earlier GPU timeout may leave work pending; no further dispatches attempted';save();continue;}
        const caseDir=join(out,c.name);mkdirSync(caseDir);const descriptorPath=join(caseDir,'descriptor.json'),gpuDir=join(caseDir,'gpu');
        const descriptorBytes=Buffer.from(JSON.stringify(wanted,null,2)+'\n');writeFileSync(descriptorPath,descriptorBytes,{flag:'wx'});
        const args=gpuArguments(c,{descriptor:descriptorPath,source,apple,floor,output:gpuDir});row.gpu={status:'in_progress',descriptor:{...fileIdentity(descriptorBytes),file:c.name+'/descriptor.json'}};save();
        stage='gpuProcess';
        const run=spawn(exe,args,{encoding:'utf8',timeout:timeoutMs,maxBuffer:2*1024*1024,killSignal:'SIGKILL',shell:false});
        // Fence pending work before any fallible evidence writes. Even a log
        // write failure must not permit later dispatches after a timeout.
        if(run.error?.code==='ETIMEDOUT'||run.signal==='SIGKILL')blockedByPendingGPU=true;
        row.process={command:[exe,...args],timeoutMs,status:run.status??null,signal:run.signal??null,error:run.error?.message??null};
        let gpuReport,gpuReportBytes;
        try {gpuReportBytes=boundedRead(join(gpuDir,'report.json'),512*1024);gpuReport=JSON.parse(gpuReportBytes);row.gpu.report={...fileIdentity(gpuReportBytes),file:c.name+'/gpu/report.json'};row.gpu.details=gpuReport;if(pendingGPU(gpuReport))blockedByPendingGPU=true;}
        catch(error){row.gpu.reportReadError=String(error);}
        const stdout=Buffer.from(run.stdout??''),stderr=Buffer.from(run.stderr??'');
        writeFileSync(join(caseDir,'stdout.log'),stdout);row.process.stdout={...fileIdentity(stdout),file:c.name+'/stdout.log'};
        writeFileSync(join(caseDir,'stderr.log'),stderr);row.process.stderr={...fileIdentity(stderr),file:c.name+'/stderr.log'};
        assert(!run.error&&!run.signal,'Harness process failed/timed out: '+(run.error?.message??run.signal));
        assert(gpuReport,'Harness did not produce a readable report');stage='gpuReportValidation';validateRunReport(gpuReport,run.status,wanted,descriptorBytes);
        row.gpu.status=gpuReport.status;row.gpu.reportValidated=true;
        if(run.status!==0){row.status=run.status===77?'unavailable':'failed';row.reason='Harness reported '+gpuReport.status;save();continue;}
        stage='rawEvidenceVerification';
        const verified=verify({directory:gpuDir,descriptorPath,sourcePath:source,applePath:apple,floorPath:floor});
        assert.equal(verified.status,'verified_numerical_pass');assert.equal(verified.exitCode,0);assert.equal(verified.case,c.name);assert.equal(verified.trialsPerBackend,12);
        row.gpu.verification=verified;row.gpu.rawEvidenceVerified=true;row.status='passed';
      } catch(error) {row.status='failed';row.errors.push({stage,error:String(error)});if(stage==='artifactValidation')row.artifactValidation='failed';if(stage.startsWith('gpu')||stage==='rawEvidenceVerification')row.gpu.status='failed';}
      save();
    }
    matrix.summary={cases:6,passed:matrix.cases.filter(x=>x.status==='passed').length,failed:matrix.cases.filter(x=>x.status==='failed').length,missing:matrix.cases.filter(x=>x.status==='missing').length,blocked:matrix.cases.filter(x=>x.status==='blocked').length,unavailable:matrix.cases.filter(x=>x.status==='unavailable').length};
    Object.assign(matrix,aggregate(matrix.cases));
  } catch(error) {matrix.status='failed';matrix.exitCode=1;matrix.error=String(error);for(const row of matrix.cases)if(row.status==='pending'){row.status='blocked';row.reason='Matrix input/preparation failed';}}
  save();return matrix;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),allowed=['--reference-directory','--output','--harness','--timeout-ms'],options={};
    assert(args.length===6||args.length===8,'Usage: node run-placement-matrix.mjs --reference-directory EXISTING_FULL_REFERENCE_OUTPUT --harness SWIFT_EXECUTABLE --output NEW_MATRIX_DIRECTORY [--timeout-ms 180000]');
    for(let i=0;i<args.length;i+=2){assert(allowed.includes(args[i])&&!Object.hasOwn(options,args[i])&&args[i+1]&&!args[i+1].startsWith('--'));options[args[i]]=args[i+1];}
    for(const key of allowed.slice(0,3))assert(options[key],'Missing '+key);
    const r=runMatrix({referenceDirectory:options['--reference-directory'],outputDirectory:options['--output'],harness:options['--harness'],timeoutMs:options['--timeout-ms']===undefined?180000:Number(options['--timeout-ms'])});
    console.log(JSON.stringify({status:r.status,exitCode:r.exitCode,summary:r.summary??null}));process.exitCode=r.exitCode;
  } catch(error) {console.error(String(error));process.exitCode=1;}
}
