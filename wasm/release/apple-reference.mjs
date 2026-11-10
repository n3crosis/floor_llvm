// Apple acceptance and FLOOR compilation are separate gates, never GPU equivalence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { integerVectorCases } from './integer-vector.mjs';
import { derivativeVectorCases } from './derivative-vector.mjs';
import { metalLanguageCases } from './metal-language.mjs';
import { msl41BitInterleaveCases } from './msl41-bit-interleave.mjs';
import { msl41TextureReadCases } from './msl41-texture-read.mjs';
import { msl41AtomicCases } from './msl41-atomics.mjs';
import { msl41BarrierCases } from './msl41-barriers.mjs';
import { placementGPUCases } from './gpu/placement/placement-gpu.mjs';
import { commonFunctionCases } from './common-functions.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function positiveCases(cases) {
  const unique = new Map();
  for (const c of cases.filter(c => c.status === 0)) {
    const selection=languageSelection(c);
    const key = `${hash(c.source)}-${c.ios}-${c.math??0}-${selection.api}-${selection.appleMetalVersion}-${selection.floorMetalVersion}`;
    if (!unique.has(key)) unique.set(key, {...c, ...selection, math:c.math??0, kind:0, name:`case-${unique.size}`, sourceSha256:hash(c.source), aliases:[]});
    unique.get(key).aliases.push(c.name);
  }
  return [...unique.values()];
}
export const referenceCases=()=>positiveCases([...integerVectorCases,...derivativeVectorCases,...commonFunctionCases,...metalLanguageCases(),...msl41BitInterleaveCases,...msl41TextureReadCases,...msl41BarrierCases,...msl41AtomicCases,...placementGPUCases()]);
export function validateGPUReport(raw, exitStatus, expectedHashes) {
  assert([0,1,77].includes(exitStatus),'GPU probe did not complete successfully or report unavailable');
  const report=JSON.parse(raw);
  assert.deepEqual(report.artifacts?.map(a=>a.sha256),expectedHashes,'GPU probe used different libraries');
  assert.equal(report.status,exitStatus===0?'passed':exitStatus===1?'failed':'unavailable','GPU report/exit disagreement');
  if(exitStatus===0) {
    assert.equal(report.libraryLoading?.apple?.status,'loaded','Apple library was not loaded');
    assert.equal(report.libraryLoading?.floor?.status,'loaded','FLOOR library was not loaded');
    assert.equal(report.pipelineCreation,'passed','Pipeline creation did not pass');
    assert.equal(report.execution,'completed','GPU execution did not complete');
    assert.equal(report.numericalComparison,'passed','Numerical comparison did not pass');
    assert(Number.isSafeInteger(report.checkedValues)&&report.checkedValues>0,'No numerical values checked');
  } else if(exitStatus===77) {
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
export function languageSelection(c) {
  const api=c.api??2, math=c.math??0;
  assert([1,2,3].includes(api)&&[0,1].includes(math));
  assert(api!==1||math===0,'API1 cannot select fast math');
  const floorMetalVersion=api===3?c.metalVersion:320;
  if(api===3)assert([[18,320],[26,400],[27,410]].some(([i,v])=>i===c.ios&&v===c.metalVersion),'Unsupported API3 target/language tuple');
  else {assert([18,26].includes(c.ios)); assert(c.metalVersion===undefined||c.metalVersion===320,'Legacy API cannot select a new language');}
  // Preserve historical reference flags for old unlabeled API2 cases. They
  // compared Apple4.0 to FLOOR3.2 on iOS26; report this distinction explicitly.
  const appleMetalVersion=c.metalVersion??(c.ios===18?320:400);
  return {api,appleMetalVersion,floorMetalVersion,languageMatched:appleMetalVersion===floorMetalVersion};
}
export function appleFlags(c) {
  const {appleMetalVersion}=languageSelection(c);
  const standard={320:'3.2',400:'4.0',410:'4.1'}[appleMetalVersion];
  return ['-sdk','iphoneos','metal','-target',`air64-apple-ios${c.ios}.0`,`-std=metal${standard}`,c.math ? '-ffast-math' : '-fno-fast-math'];
}
export function compileWithAPI(m,test,p,size) {
  const {api}=languageSelection(test);
  assert.equal(typeof m['_air_compile_v'+api],'function','Missing requested compiler ABI');
  if(api===1)return m._air_compile_v1(p,size,test.ios,0);
  if(api===2)return m._air_compile_v2(p,size,test.ios,0,test.math??0);
  return m._air_compile_v3(p,size,test.ios,0,test.math??0,test.metalVersion);
}
export const gpuScope='Integer vector compute, position-based derivative renders, and MSL4.1 bit interleave/deinterleave compute; common functions, language-only probes and affine derivatives excluded';
export function gpuArguments(c, apple, floor, output) {
  const base=['--apple',apple,'--floor',floor,'--output',output];
  if(c.msl41BitInterleave) {
    assert([8,16,32].includes(c.bitInterleaveBits));
    assert(['scalar','vector','deinterleave'].includes(c.bitInterleaveForm));
    assert(['dynamic','constants'].includes(c.bitInterleaveMode));
    assert(c.api===3&&c.ios===27&&c.metalVersion===410,'Interleave GPU case must preserve iOS27/MSL4.1');
    return [...base,'--kind','interleave','--bits',String(c.bitInterleaveBits),'--form',c.bitInterleaveForm,'--mode',c.bitInterleaveMode];
  }
  if(c.integerVector) {
    assert(['dynamic','constants'].includes(c.integerMode));
    return [...base,'--kind','integer','--mode',c.integerMode];
  }
  if(c.derivativeVector)return [...base,'--kind','derivative'];
  return null;
}
export function reportOutcome(summary) {
  if(summary.hasFailures)return {status:'failed',exitCode:1};
  if(summary.hasUnavailable||!summary.appleCompilationVerified)return {status:'unavailable',exitCode:77};
  return {status:'passed',exitCode:0};
}
// Each case and each independent compiler must be attempted even after failures.
export async function collectCaseEvidence(item, actions) {
  item.errors??=[];
  const attempt=async(stage)=>{
    try {await (stage==='gpuProbe'?actions.gpu:actions[stage])();item[stage]='passed';}
    catch(e){item[stage]='failed';if(stage==='gpuProbe') {item.gpu??={};item.gpu.status='failed';}item.errors.push({stage,message:e.message});}
  };
  if(item.appleCompile!=='unavailable')await attempt('appleCompile');
  if(item.appleCompile==='passed')await attempt('appleLink');
  else item.appleLink=item.appleCompile==='unavailable'?'unavailable':'blocked';
  await attempt('floorCompile');
  if(actions.gpu && item.appleLink==='passed'&&item.floorCompile==='passed')await attempt('gpuProbe');
  else if(actions.gpu)item.gpu={status:'blocked',reason:'Both original libraries required'};
  return item;
}
export function summarizeCases(cases) {
  const all=stage=>cases.length>0&&cases.every(c=>c[stage]==='passed');
  const gpu=cases.filter(c=>c.gpu), allGPU=predicate=>gpu.length>0&&gpu.every(c=>c.gpu.reportVerified===true&&predicate(c.gpu.details));
  const failed=cases.some(c=>c.errors?.length||c.gpu?.status==='failed');
  return {appleCompilationVerified:all('appleCompile')&&all('appleLink'),floorCompilationVerified:all('floorCompile'),
    runtimeLibraryLoadVerified:allGPU(r=>r?.libraryLoading?.apple?.status==='loaded'&&r?.libraryLoading?.floor?.status==='loaded'),
    pipelineCreationVerified:allGPU(r=>r?.pipelineCreation==='passed'),gpuExecutionVerified:allGPU(r=>r?.execution==='completed'),
    numericalResultsVerified:gpuResultsVerified(cases),hasFailures:failed,
    hasUnavailable:cases.some(c=>c.appleCompile==='unavailable'||c.gpu?.status==='unavailable')};
}
async function worker(runtime, input, output) {
  const pin=JSON.parse(await readFile(join(runtime,'verified-runtime.json')));
  for (const name of ['air_wasm.mjs','air_wasm.wasm']) {
    const bytes=await readFile(join(runtime,name));
    assert.equal(bytes.length,pin.files[name].bytes); assert.equal(hash(bytes),pin.files[name].sha256);
  }
  assert.equal(pin.apiVersion,3,'Verified runtime must advertise API3 capability');
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
  for(const api of [1,2,3])assert.equal(typeof m['_air_compile_v'+api],'function','Runtime missing ABI'+api);
  const source=Buffer.from(test.source); assert(source.length<=64*1024);
  const p=m._malloc(source.length); let r=0;
  try {
    slice(p,source.length,64*1024).set(source); r=compileWithAPI(m,test,p,source.length); assert(r);
    const status=m._air_result_status(r); const n=m._air_result_diagnostics_size(r);
    const diagnostics=n ? Buffer.from(slice(m._air_result_diagnostics(r),n,64*1024)).toString() : '';
    assert.equal(status,0,diagnostics);
    const bytes=Buffer.from(slice(m._air_result_data(r),m._air_result_size(r),8*1024**2)); assert.equal(bytes.subarray(0,4).toString(),'MTLB');
    await writeFile(output,bytes);
  } finally {if(r)m._air_result_free(r); m._free(p);}
}
async function main(runtime, output, gpuProbe) {
  runtime=resolve(runtime); output=resolve(output); if(gpuProbe)gpuProbe=resolve(gpuProbe); await mkdir(output,{recursive:true});
  const report={schemaVersion:2,mode:'apple-reference-compile-link',runtime:JSON.parse(await readFile(join(runtime,'verified-runtime.json'))),appleCompilationVerified:false,floorCompilationVerified:false,runtimeLibraryLoadVerified:false,gpuExecutionVerified:false,numericalResultsVerified:false,commands:[],cases:[]};
  const save=()=>writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  function run(command,args,required=true) {
    const r=spawnSync(command,args,{cwd:output,encoding:'utf8',timeout:120000,maxBuffer:2*1024**2});
    report.commands.push({command:[command,...args],status:r.status,signal:r.signal,stdout:r.stdout??'',stderr:r.stderr??'',error:r.error?.message});
    if(required)assert(!r.error&&r.status===0,`${command} failed: ${r.error?.message??r.stderr}`);
    return r;
  }
  try {
    const versions=[run('xcodebuild',['-version'],false),run('xcrun',['-sdk','iphoneos','--show-sdk-version'],false),run('xcrun',['-sdk','iphoneos','metal','--version'],false)];
    const appleAvailable=process.platform==='darwin'&&versions.every(r=>!r.error&&r.status===0);
    report.appleTools={status:appleAvailable?'available':'unavailable'};
    report.apple41={status:'unavailable',reason:'Apple tools unavailable'};
    if(appleAvailable) {
      const source=join(output,'availability-metal41.metal'), air=join(output,'availability-metal41.air');
      const text='#include <metal_stdlib>\nusing namespace metal;\nstatic_assert(__METAL_VERSION__ == 410,"4.1 required");\nkernel void available41(device uint* out [[buffer(0)]]) {out[0]=41u;}\n';
      await writeFile(source,text);
      const r=run('xcrun',[...appleFlags({api:3,ios:27,metalVersion:410,math:0}),'-c',source,'-o',air],false);
      report.apple41={status:!r.error&&r.status===0?'available':'unavailable',sourceSha256:hash(text),reason:!r.error&&r.status===0?undefined:'Actual iOS27/metal4.1 compiler probe rejected; see command diagnostics'};
      if(report.apple41.status==='available')report.apple41.airSha256=hash(await readFile(air));
    }
    await save();
    for(const c of referenceCases()) {
      const item={name:c.name,aliases:c.aliases,ios:c.ios,math:c.math,...languageSelection(c),sourceSha256:c.sourceSha256,appleCompile:!appleAvailable||(c.appleMetalVersion===410&&report.apple41.status!=='available')?'unavailable':'pending',appleLink:'pending',floorCompile:'pending'};
      report.cases.push(item);
      try {
        const source=join(output,c.name+'.metal'), air=join(output,c.name+'.air'), apple=join(output,c.name+'.apple.metallib'), floor=join(output,c.name+'.floor.metallib'), input=join(output,c.name+'.json');
        await writeFile(source,c.source); await writeFile(input,JSON.stringify(c));
        await collectCaseEvidence(item,{
          appleCompile:async()=>{run('xcrun',[...appleFlags(c),'-c',source,'-o',air]);item.airSha256=hash(await readFile(air));},
          appleLink:async()=>{run('xcrun',['-sdk','iphoneos','metallib',air,'-o',apple]);const bytes=await readFile(apple);assert.equal(bytes.subarray(0,4).toString(),'MTLB');item.appleMetallibSha256=hash(bytes);},
          floorCompile:async()=>{run(process.execPath,[fileURLToPath(import.meta.url),'--worker',runtime,input,floor]);item.floorMetallibSha256=hash(await readFile(floor));},
          ...(gpuProbe&&gpuArguments(c,apple,floor,join(output,c.name+'-gpu'))?{gpu:async()=>{
            const dir=join(output,c.name+'-gpu'),args=gpuArguments(c,apple,floor,dir);
            const r=run(gpuProbe,args,false);
            item.gpu={reportVerified:false,status:r.status===0?'passed':r.status===77?'unavailable':'failed',report:c.name+'-gpu/report.json'};
            // Preserve failure reports too, before validating them. Missing or
            // malformed reports become explicit failures rather than disappearing.
            const details=await readFile(join(dir,'report.json'));item.gpu.reportSha256=hash(details);
            item.gpu.details=JSON.parse(details);
            validateGPUReport(details.toString(),r.status,[item.appleMetallibSha256,item.floorMetallibSha256]);item.gpu.reportVerified=true;
            assert(!r.error&&(r.status===0||r.status===77),`GPU probe failed for ${c.name}: ${r.error?.message??r.stderr}`);
          }}:{}),
        });
      } catch(e) {item.errors??=[];item.errors.push({stage:'casePreparation',message:e.message});}
      await save();
    }
    Object.assign(report,summarizeCases(report.cases));
    report.gpuScope=gpuScope;
    const outcome=reportOutcome(report);report.status=outcome.status;report.exitCode=outcome.exitCode;
    await save();
    if(report.hasFailures)throw Error('One or more validation layers failed; all cases were attempted.');
    // An unavailable Apple4.1 toolchain is never a passing 4.1 gate.
    process.exitCode=outcome.exitCode;
  } catch(e) {report.error=e.message;throw e;} finally {await save();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args[0]==='--worker') {assert.equal(args.length,4); await worker(...args.slice(1));}
  else {assert(args.length===2||(args.length===4&&args[2]==='--gpu-probe'),'Usage: node apple-reference.mjs VERIFIED_RUNTIME OUTPUT [--gpu-probe EXECUTABLE]'); await main(args[0],args[1],args[3]);}
}
