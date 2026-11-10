// Apple acceptance and FLOOR compilation are separate gates, never GPU equivalence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { integerVectorCases } from './integer-vector.mjs';
import { derivativeVectorCases } from './derivative-vector.mjs';
import { commonFunctionCases } from './common-functions.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function positiveCases(cases) {
  const unique = new Map();
  for (const c of cases.filter(c => c.status === 0)) {
    assert([18,26].includes(c.ios) && [0,1].includes(c.math));
    const key = `${hash(c.source)}-${c.ios}-${c.math}`;
    if (!unique.has(key)) unique.set(key, {...c, kind:0, name:`case-${unique.size}`, sourceSha256:hash(c.source), aliases:[]});
    unique.get(key).aliases.push(c.name);
  }
  return [...unique.values()];
}
export const referenceCases=()=>positiveCases([...integerVectorCases,...derivativeVectorCases,...commonFunctionCases]);
export function validateGPUReport(raw, exitStatus, expectedHashes) {
  assert([0,77].includes(exitStatus),'GPU probe did not complete successfully or report unavailable');
  const report=JSON.parse(raw);
  assert.deepEqual(report.artifacts?.map(a=>a.sha256),expectedHashes,'GPU probe used different libraries');
  assert.equal(report.status,exitStatus===0?'passed':'unavailable','GPU report/exit disagreement');
  if(exitStatus===0) {
    assert.equal(report.libraryLoading?.apple?.status,'loaded','Apple library was not loaded');
    assert.equal(report.libraryLoading?.floor?.status,'loaded','FLOOR library was not loaded');
    assert.equal(report.pipelineCreation,'passed','Pipeline creation did not pass');
    assert.equal(report.execution,'completed','GPU execution did not complete');
    assert.equal(report.numericalComparison,'passed','Numerical comparison did not pass');
    assert(Number.isSafeInteger(report.checkedValues)&&report.checkedValues>0,'No numerical values checked');
  } else {
    assert(!(report.libraryLoading?.apple?.status==='loaded' && report.libraryLoading?.floor?.status==='rejected'),
      'FLOOR load failure after Apple load success is a failure, not unavailable');
  }
  return report;
}
export function gpuResultsVerified(cases) {
  const gpu=cases.filter(c=>c.gpu);
  return gpu.length>0 && gpu.every(c=>{
    if(c.gpu.status!=='passed')return false;
    validateGPUReport(JSON.stringify(c.gpu.details),0,[c.appleMetallibSha256,c.floorMetallibSha256]);
    return true;
  });
}
export function appleFlags(c) {
  return ['-sdk','iphoneos','metal','-target',`air64-apple-ios${c.ios}.0`,`-std=metal${c.ios===18?'3.2':'4.0'}`,c.math ? '-ffast-math' : '-fno-fast-math'];
}
async function worker(runtime, input, output) {
  const pin=JSON.parse(await readFile(join(runtime,'verified-runtime.json')));
  for (const name of ['air_wasm.mjs','air_wasm.wasm']) {
    const bytes=await readFile(join(runtime,name));
    assert.equal(bytes.length,pin.files[name].bytes); assert.equal(hash(bytes),pin.files[name].sha256);
  }
  const test=JSON.parse(await readFile(input)); assert.equal(hash(test.source),test.sourceSha256);
  globalThis.self=globalThis; globalThis.location={href:'https://invalid.test/worker.mjs'};
  const denied=()=>{throw Error('Network disabled in compiler worker');};
  globalThis.fetch=globalThis.importScripts=globalThis.XMLHttpRequest=globalThis.WebSocket=denied;
  const wasm=await WebAssembly.compile(await readFile(join(runtime,'air_wasm.wasm')));
  const factory=(await import(pathToFileURL(join(runtime,'air_wasm.mjs')).href)).default;
  const m=await factory({print(){},printErr(){},locateFile:denied,instantiateWasm(imports,receive){const i=new WebAssembly.Instance(wasm,imports);receive(i,wasm);return i.exports;}});
  const slice=(p,n,limit)=>{assert(Number.isInteger(p)&&p>0&&Number.isInteger(n)&&n>=0&&n<=limit&&p+n<=m.HEAPU8.length);return m.HEAPU8.subarray(p,p+n);};
  const h=slice(m._air_compiler_header_sha256(),65,65); assert.equal(h[64],0); assert.equal(Buffer.from(h.subarray(0,64)).toString(),pin.headerSha256);
  assert.equal(m._air_compiler_header_bundle_version(),2);
  const source=Buffer.from(test.source); assert(source.length<=64*1024);
  const p=m._malloc(source.length); let r=0;
  try {
    slice(p,source.length,64*1024).set(source); r=m._air_compile_v2(p,source.length,test.ios,0,test.math); assert(r);
    const status=m._air_result_status(r); const n=m._air_result_diagnostics_size(r);
    const diagnostics=n ? Buffer.from(slice(m._air_result_diagnostics(r),n,64*1024)).toString() : '';
    assert.equal(status,0,diagnostics);
    const bytes=Buffer.from(slice(m._air_result_data(r),m._air_result_size(r),8*1024**2)); assert.equal(bytes.subarray(0,4).toString(),'MTLB');
    await writeFile(output,bytes);
  } finally {if(r)m._air_result_free(r); m._free(p);}
}
async function main(runtime, output, gpuProbe) {
  runtime=resolve(runtime); output=resolve(output); if(gpuProbe)gpuProbe=resolve(gpuProbe); await mkdir(output,{recursive:true});
  const report={schemaVersion:1,mode:'apple-reference-compile-link',runtime:JSON.parse(await readFile(join(runtime,'verified-runtime.json'))),appleCompilationVerified:false,floorCompilationVerified:false,runtimeLibraryLoadVerified:false,gpuExecutionVerified:false,numericalResultsVerified:false,gpuStatus:'not-run: iOS libraries require a compatible execution host; compile/link is not numerical proof',commands:[],cases:[]};
  let activeStage;
  const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  function run(command,args) {
    const r=spawnSync(command,args,{cwd:output,encoding:'utf8',timeout:120000,maxBuffer:2*1024**2});
    report.commands.push({command:[command,...args],status:r.status,signal:r.signal,stdout:r.stdout??'',stderr:r.stderr??'',error:r.error?.message});
    assert(!r.error&&r.status===0,`${command} failed: ${r.error?.message??r.stderr}`);
  }
  try {
    assert.equal(process.platform,'darwin','Apple reference gate requires macOS and Xcode');
    run('xcodebuild',['-version']); run('xcrun',['-sdk','iphoneos','--show-sdk-version']); run('xcrun',['-sdk','iphoneos','metal','--version']);
    for(const c of referenceCases()) {
      const item={name:c.name,aliases:c.aliases,ios:c.ios,math:c.math,sourceSha256:c.sourceSha256,appleCompile:'pending',appleLink:'pending',floorCompile:'pending'}; report.cases.push(item);
      const source=join(output,c.name+'.metal'), air=join(output,c.name+'.air'), apple=join(output,c.name+'.apple.metallib'), floor=join(output,c.name+'.floor.metallib'), input=join(output,c.name+'.json');
      await writeFile(source,c.source); await writeFile(input,JSON.stringify(c)); await save();
      activeStage=[item,'appleCompile']; run('xcrun',[...appleFlags(c),'-c',source,'-o',air]); item.appleCompile='passed'; item.airSha256=hash(await readFile(air)); await save();
      activeStage=[item,'appleLink']; run('xcrun',['-sdk','iphoneos','metallib',air,'-o',apple]); const bytes=await readFile(apple); assert.equal(bytes.subarray(0,4).toString(),'MTLB'); item.appleLink='passed'; item.appleMetallibSha256=hash(bytes); await save();
      activeStage=[item,'floorCompile']; run(process.execPath,[fileURLToPath(import.meta.url),'--worker',runtime,input,floor]); item.floorCompile='passed'; item.floorMetallibSha256=hash(await readFile(floor)); activeStage=null; await save();
      if(gpuProbe && (c.integerVector || c.derivativeVector)) {
        const dir=join(output,c.name+'-gpu');
        const args=['--apple',apple,'--floor',floor,'--kind',c.integerVector?'integer':'derivative','--output',dir];
        if(c.integerVector)args.push('--mode',c.integerMode);
        const r=spawnSync(gpuProbe,args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024**2});
        report.commands.push({command:[gpuProbe,...args],status:r.status,signal:r.signal,stdout:r.stdout??'',stderr:r.stderr??'',error:r.error?.message});
        item.gpu={status:r.status===0?'passed':r.status===77?'unavailable':'failed',report: c.name+'-gpu/report.json'};
        if(!r.error && (r.status===0||r.status===77)) {
          const details=await readFile(join(dir,'report.json')); item.gpu.reportSha256=hash(details); item.gpu.details=validateGPUReport(details.toString(),r.status,[item.appleMetallibSha256,item.floorMetallibSha256]);
        }
        await save();
        assert(!r.error&&(r.status===0||r.status===77),`GPU probe failed for ${c.name}: ${r.error?.message??r.stderr}`);
      }
    }
    assert(report.cases.length>=12); report.appleCompilationVerified=true; report.floorCompilationVerified=true;
    const gpu=report.cases.filter(c=>c.gpu);
    report.gpuScope='integer vector compute and position-based derivative render cases only; common functions and affine derivative fixture excluded';
    if(gpu.length) {
      const passed=gpuResultsVerified(report.cases);
      report.runtimeLibraryLoadVerified=passed; report.gpuExecutionVerified=passed; report.numericalResultsVerified=passed;
      report.gpuStatus=passed?'passed for documented bounded scope':'unavailable for one or more original iOS library pairs; see individual probe diagnostics';
    }
  } catch(e) {if(activeStage)activeStage[0][activeStage[1]]='failed'; report.error=e.message; throw e;} finally {await save();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args[0]==='--worker') {assert.equal(args.length,4); await worker(...args.slice(1));}
  else {assert(args.length===2||(args.length===4&&args[2]==='--gpu-probe'),'Usage: node apple-reference.mjs VERIFIED_RUNTIME OUTPUT [--gpu-probe EXECUTABLE]'); await main(args[0],args[1],args[3]);}
}
