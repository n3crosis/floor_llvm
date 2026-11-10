// Synthetic test fixtures only. No compiler output or GPU execution evidence.
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {barrierGPUCases,sha256,inputs,expected} from './barrier-gpu.mjs';
import {runMatrix} from './run-barrier-matrix.mjs';
export const options=args=>Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]));
export function syntheticRaw(c,artifacts,{width=32}={}) {
  const report={schema:1,status:'passed',kind:c.barrierKind,os:'SYNTHETIC TEST, NOT A GPU RUN',device:{name:'SYNTHETIC TEST DEVICE',registryID:'0'},
    scope:'Bounded same-source producer/consumer and scratch-reuse test, not proof of the complete Metal memory model.',targetPolicy:'Original libraries unchanged; no retargeting or metadata rewriting.',
    artifacts:['apple','floor'].map(label=>({compiler:label,sha256:artifacts[label].sha256,bytes:artifacts[label].bytes})),
    libraryLoading:{apple:{status:'loaded'},floor:{status:'loaded'}},pipelineCreation:'passed',execution:'completed',numericalComparison:'passed',
    geometry:{threadgroups:1,threadsPerThreadgroup:width,pipelineSIMDWidths:[32,64],threadgroupMemoryBytes:width*4},checkedValues:width*32};
  const values=Array.from({length:16},(_,i)=>{const input=inputs(width,i),want=expected(input);return {iteration:i,input,expected:want,apple:[...want],floor:[...want]};});
  return {report,values};
}
export function syntheticGPU(opts,{exit=0,mutate,width=32}={}) {
  const dir=opts['--output'];mkdirSync(dir);
  const c=barrierGPUCases().find(c=>opts['--kind']===c.barrierKind); // source variants have the same CPU oracle.
  const artifacts=Object.fromEntries(['apple','floor'].map(label=>{const b=readFileSync(opts['--'+label]);return [label,{sha256:sha256(b),bytes:b.length}];}));
  const {report,values}=syntheticRaw(c,artifacts,{width});
  if(exit===77)Object.assign(report,{status:'unavailable',device:null,libraryLoading:{},pipelineCreation:'not_run',execution:'not_run',numericalComparison:'not_run',error:{stage:'device',message:'No Metal device on this synthetic fixture'}});
  if(exit===77){delete report.geometry;delete report.checkedValues;}
  if(exit===1)Object.assign(report,{status:'failed',numericalComparison:'failed',error:{stage:'numericalComparison',message:'SYNTHETIC FAILURE'}});
  if(mutate)mutate(report,values,dir);
  writeFileSync(join(dir,'values.json'),JSON.stringify(values));writeFileSync(join(dir,'report.json'),JSON.stringify(report));
}
export function environment(fn) {
  const dir=mkdtempSync(join(tmpdir(),'barrier-matrix-synthetic-')),reference=join(dir,'reference'),output=join(dir,'matrix'),harness=join(dir,'synthetic-harness');
  mkdirSync(reference);writeFileSync(harness,'SYNTHETIC TEST STUB; never invoked');chmodSync(harness,0o755);
  const cases=barrierGPUCases(),report={schemaVersion:2,mode:'apple-reference-compile-link',runtime:{apiVersion:3},status:'failed',exitCode:1,hasFailures:true,cases:[],commands:[]};
  for(const [i,c] of cases.entries()) {
    const name='case-'+i,source=join(reference,name+'.metal'),air=join(reference,name+'.air'),apple=join(reference,name+'.apple.metallib'),floor=join(reference,name+'.floor.metallib'),input=join(reference,name+'.json');
    writeFileSync(source,c.source);writeFileSync(air,'SYNTHETIC AIR '+i);writeFileSync(apple,'MTLB SYNTHETIC APPLE '+i);writeFileSync(floor,'MTLB SYNTHETIC FLOOR '+i);
    writeFileSync(input,JSON.stringify({...c,name,aliases:[c.alias]}));
    report.cases.push({name,aliases:[c.alias],api:3,ios:27,math:0,appleMetalVersion:410,floorMetalVersion:410,languageMatched:true,sourceSha256:c.sourceSha256,
      appleCompile:'passed',appleLink:'passed',floorCompile:'passed',airSha256:sha256(readFileSync(air)),appleMetallibSha256:sha256(readFileSync(apple)),floorMetallibSha256:sha256(readFileSync(floor))});
    for(const command of [['xcrun','-sdk','iphoneos','metal','-target','air64-apple-ios27.0','-std=metal4.1','-fno-fast-math','-c',source,'-o',air],['xcrun','-sdk','iphoneos','metallib',air,'-o',apple],['/fixture/bin/node','/fixture/apple-reference.mjs','--worker','/fixture/runtime',input,floor]])report.commands.push({command,status:0});
  }
  const flush=()=>writeFileSync(join(reference,'report.json'),JSON.stringify(report));flush();const calls=[];
  const spawn=(exe,args,config)=>{calls.push({exe,args,config});syntheticGPU(options(args));return {status:0,stdout:'synthetic output',stderr:''};};
  try{return fn({dir,reference,output,harness,cases,report,flush,calls,spawn,run(deps={},settings={}){flush();return runMatrix({referenceDirectory:reference,outputDirectory:output,harness,...settings},{spawn,...deps});}});}
  finally{rmSync(dir,{recursive:true,force:true});}
}
