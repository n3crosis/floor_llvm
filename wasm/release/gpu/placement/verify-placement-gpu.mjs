// Validate recorded GPU evidence against fresh CPU expectations and the exact
// original input files. This is an offline verifier, not a GPU execution tool.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,openSync,readSync,closeSync,constants} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {suite,cases,descriptor,inputs,expected,initialOutput,wordsToBytes,sha256} from './placement-gpu.mjs';

export function verifyPassedReport(report, wanted, readEvidence) {
  assert.equal(report.schema,1); assert.equal(report.suite,suite);
  assert.equal(report.feature,'msl41-placement-gpu'); assert.equal(report.scope,'gpu_pair');
  assert.equal(report.qualification,'numerical_only'); assert.equal(report.compilerProvenance,'requires_external_compile_record_review');
  assert.equal(report.status,'passed','Only a completed paired GPU numerical pass can qualify'); assert.equal(report.exitCode,0);
  assert.equal(report.descriptorValidation,'passed'); assert.deepEqual(report.descriptor,wanted);
  const c=cases.find(x=>x.name===wanted.case.name); assert(c); assert.deepEqual(report.case,c);
  assert(typeof report.device==='string'&&report.device.length>0,'Missing actual GPU device');
  assert(typeof report.registryID==='string'&&/^\d+$/.test(report.registryID),'Missing GPU registry ID');
  assert.deepEqual(report.inputVectors,inputs());
  const filenames=new Set();
  const raw=(e,want,label)=>{
    assert(e&&typeof e.file==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(e.file)&&basename(e.file)===e.file,'Unsafe raw evidence name');
    assert(!filenames.has(e.file),'Evidence filenames must be unique'); filenames.add(e.file);
    assert.equal(e.bytes,want.length,label+' length'); assert.match(e.sha256,/^[0-9a-f]{64}$/);
    const actual=readEvidence(e.file,want.length);
    assert(Buffer.isBuffer(actual)); assert.equal(actual.length,want.length,label+' actual length');
    assert.equal(sha256(actual),e.sha256,label+' hash');
    assert.deepEqual(actual,want,label+' differs from independent CPU expectation');
    return actual;
  };
  raw(report.initialOutput,initialOutput(),'Initial output guards');
  assert.equal(report.fixtures?.length,12);
  const all=inputs().map((input,index)=>{
    const e=expected(c,input), f=report.fixtures[index];
    assert.equal(f.trial,index); assert.deepEqual(f.input,input); assert.deepEqual(f.trace,e.trace);
    raw(f.inputRaw,wordsToBytes(input),'Input '+index);
    raw(f.expectedOutput,e.output,'CPU output fixture '+index);
    raw(f.expectedArena,e.arena,'CPU arena fixture '+index);
    return e;
  });
  const observations={};
  for(const label of ['apple','floor']) {
    const b=report.backends?.[label]; assert(b,label+' missing');
    for(const stage of ['load','pipeline','execution','numerical']) assert.equal(b[stage]?.status,'passed',label+' '+stage);
    assert.equal(b.load.sha256,wanted[label].sha256); assert.equal(b.load.bytes,wanted[label].bytes);
    assert.equal(b.pipeline.entry,c.name); assert.equal(b.execution.trialsCompleted,12); assert.equal(b.numerical.trialsCompared,12);
    assert.equal(b.trials?.length,12); observations[label]=[];
    for(let i=0;i<12;i++) {
      const t=b.trials[i], e=all[i]; assert.equal(t.trial,i,'Missing, duplicated or reordered trial');
      assert.equal(t.execution,'passed'); assert.equal(t.numerical,'passed');
      assert.deepEqual(t.outputMismatch,{count:0,first:[],actualBytes:160,expectedBytes:160});
      const output=raw(t.output,e.output,label+' trial '+i+' output');
      const snapshot=raw(t.arenaSnapshot,e.arena,label+' trial '+i+' arena snapshot');
      assert.deepEqual(output.subarray(80,144),snapshot,'Snapshot not extracted from actual output');
      if(c.space==='device') {
        raw(t.deviceArena,e.arena,label+' trial '+i+' direct device arena');
        assert.deepEqual(t.arenaMismatch,{count:0,first:[],actualBytes:64,expectedBytes:64});
      } else assert(!('deviceArena' in t),'Unexpected device arena in local/shared case');
      observations[label].push(output);
    }
  }
  assert.deepEqual(observations.apple,observations.floor);
  assert.deepEqual(report.pairComparison,{status:'passed',trialsCompared:12});
  return {schema:1,suite,feature:'msl41-placement-gpu',scope:'recorded_gpu_evidence',status:'verified_numerical_pass',compilerProvenance:'requires_external_compile_record_review',case:c.name,trialsPerBackend:12,rawFilesVerified:filenames.size,exitCode:0};
}
function boundedRead(path,maximum) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=lstatSync(path); assert(info.isFile()&&!info.isSymbolicLink()&&info.size>0&&info.size<=maximum,'Expected bounded regular evidence file');
    const buffer=Buffer.alloc(maximum+1); let count=0;
    while(count<buffer.length) {const got=readSync(fd,buffer,count,buffer.length-count,null);if(!got)break;count+=got;}
    assert.equal(count,info.size,'Evidence file changed size'); return buffer.subarray(0,count);
  } finally {closeSync(fd);}
}
export function verifyDirectory({directory,descriptorPath,sourcePath,applePath,floorPath}) {
  const directoryInfo=lstatSync(directory);assert(directoryInfo.isDirectory()&&!directoryInfo.isSymbolicLink(),'Expected ordinary evidence directory');
  const wanted=JSON.parse(boundedRead(descriptorPath,65536));
  const fresh=descriptor(wanted.case.name,applePath,floorPath); assert.deepEqual(wanted,fresh,'Original file identities differ from descriptor');
  const source=boundedRead(sourcePath,4096);assert.equal(source.length,wanted.source.bytes);assert.equal(sha256(source),wanted.source.sha256);
  const report=JSON.parse(boundedRead(join(directory,'report.json'),512*1024));
  assert.equal(report.descriptorSha256,sha256(boundedRead(descriptorPath,65536)),'Descriptor file identity differs from run');
  if(report.status==='unavailable') {assert.equal(report.exitCode,77);return {status:'unavailable',scope:'recorded_gpu_evidence',exitCode:77,reason:report.reason??'GPU evidence unavailable; not a pass'};}
  return verifyPassedReport(report,wanted,(name,max)=>boundedRead(join(directory,name),max));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const a=process.argv.slice(2), keys=['--directory','--descriptor','--source','--apple','--floor'];
    assert.equal(a.length,10,'Expected exactly five option/value pairs');const options={};
    for(let i=0;i<a.length;i+=2){assert(keys.includes(a[i])&&!Object.hasOwn(options,a[i])&&a[i+1]&&!a[i+1].startsWith('--'));options[a[i]]=resolve(a[i+1]);}
    assert.equal(Object.keys(options).length,5);
    const result=verifyDirectory({directory:options['--directory'],descriptorPath:options['--descriptor'],sourcePath:options['--source'],applePath:options['--apple'],floorPath:options['--floor']});
    console.log(JSON.stringify(result,null,2)); process.exitCode=result.exitCode;
  } catch(error) {console.error(JSON.stringify({scope:'recorded_gpu_evidence',status:'verification_failed',error:String(error),exitCode:1}));process.exitCode=1;}
}
