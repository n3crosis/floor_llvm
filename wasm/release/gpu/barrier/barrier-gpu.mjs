// Standalone GPU postprocessing contract. No compilation, execution or generic
// GPU schema changes occur in this module. Inputs are authored, not app shaders.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openSync,readSync,closeSync,fstatSync,constants,readFileSync} from 'node:fs';
import {msl41BarrierCases} from '../../msl41-barriers.mjs';
export const suite='floor-metal41-barrier-gpu-v1';
export const expectedNames=Object.freeze(['threadgroup','simdgroup'].flatMap(k=>['acq_rel','seq_cst'].flatMap(o=>['default','explicit'].map(s=>`barrier-exchange-${k}-${o}-${s}`))));
export const frozenSwiftSha256='a9200ae311d4ce1ae40c0832f199bea605ccc4cf959b6b5f59505779678e2e61';
export const sha256=b=>createHash('sha256').update(b).digest('hex');
export const copy=x=>JSON.parse(JSON.stringify(x));
export function boundedRead(path,max) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=fstatSync(fd);assert(st.isFile()&&st.size>0&&st.size<=max,'Expected bounded ordinary file: '+path);
    const bytes=Buffer.alloc(st.size+1);let size=0;
    while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
    assert.equal(size,st.size,'File changed size during read: '+path);return bytes.subarray(0,size);
  } finally {closeSync(fd);}
}
export const jsonFile=(path,max)=>JSON.parse(boundedRead(path,max));
export const identity=b=>({sha256:sha256(b),bytes:b.length});
export function barrierGPUCases() {
  const pins=JSON.parse(boundedRead(new URL('./source-pins.json',import.meta.url),16384));
  assert.equal(pins.schema,1);assert.equal(pins.swiftSha256,frozenSwiftSha256);
  const cases=msl41BarrierCases.filter(c=>c.barrierExchange&&c.status===0&&c.math===0&&c.kind===0);
  assert.equal(cases.length,8);assert.equal(new Set(cases.map(c=>c.name)).size,8);
  const slots=new Set();
  const result=cases.map(c=>{
    assert.equal(c.api,3);assert.equal(c.ios,27);assert.equal(c.metalVersion,410);assert.equal(c.entry,'barrier_exchange');
    assert(['threadgroup','simdgroup'].includes(c.barrierKind));assert(['acq_rel','seq_cst'].includes(c.barrierOrder));
    assert(c.barrierScope===null||c.barrierScope===c.barrierKind);
    const variant=c.barrierScope===null?'default':'explicit',name=`barrier-exchange-${c.barrierKind}-${c.barrierOrder}-${variant}`;
    assert.equal(c.name,'msl41-'+name+'-kind0');assert(!slots.has(name));slots.add(name);
    const sourceSha256=sha256(c.source);assert.equal(sourceSha256,pins.cases[name],'Barrier source differs from native preflight pin');
    return {name,alias:c.name,source:c.source,sourceSha256,sourceBytes:Buffer.byteLength(c.source),entry:c.entry,
      api:3,ios:27,metalVersion:410,math:0,kind:0,barrierKind:c.barrierKind,barrierOrder:c.barrierOrder,barrierScope:c.barrierScope};
  });
  assert.deepEqual([...slots].sort(),Object.keys(pins.cases).sort());return result;
}
export function inputs(width,iteration) {
  assert(Number.isSafeInteger(width)&&width>=1&&width<=1024);
  assert(Number.isSafeInteger(iteration)&&iteration>=0&&iteration<16);
  const special=[0,0xffffffff,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,1,0x01020304];
  let seed=(0xb4a41e25+iteration)>>>0;
  return Array.from({length:width},(_,i)=>{
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return iteration===0&&i<special.length?special[i]:seed;
  });
}
export function expected(input) {
  assert(Array.isArray(input)&&input.length>=1&&input.length<=1024);
  assert(input.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff));
  // Two opposite cyclic shifts cancel. This is not a simulated GPU scheduler.
  return input.map(x=>(x^0x9e3779b9)>>>0);
}
export function aggregate(rows) {
  const counts=Object.fromEntries(['passed','failed','timeout','missing','blocked','unavailable','pending'].map(s=>[s,rows.filter(r=>r.status===s).length]));
  if(counts.failed||counts.timeout)return {status:'failed',exitCode:1,counts};
  if(rows.length!==8||counts.missing||counts.blocked||counts.pending)return {status:'incomplete',exitCode:2,counts};
  if(counts.unavailable)return {status:'unavailable',exitCode:77,counts};
  if(counts.passed===8)return {status:'passed',exitCode:0,counts};
  return {status:'failed',exitCode:1,counts};
}
export function verifyReceipt(receipt,c,readLibrary) {
  assert.equal(receipt.schema,1);assert.equal(receipt.suite,suite);assert.equal(receipt.case,c.name);
  assert.equal(receipt.sourceSha256,c.sourceSha256);
  assert.deepEqual(receipt.target,{api:3,ios:27,metalVersion:410,math:0,kind:0});
  for(const label of ['apple','floor']) {
    const file=receipt.artifacts?.[label];assert(file&&/^[0-9a-f]{64}$/.test(file.sha256));
    assert(Number.isSafeInteger(file.bytes)&&file.bytes>=4&&file.bytes<=32*1024*1024);
    if(readLibrary) {const b=readLibrary(label);assert.equal(b.subarray(0,4).toString(),'MTLB');assert.deepEqual(identity(b),{sha256:file.sha256,bytes:file.bytes});}
  }
  assert.notEqual(receipt.artifacts.apple.sha256,receipt.artifacts.floor.sha256,'Identical bytes do not establish independent original libraries');
}
export function observedBackendStages(report) {
  const failure=(label,...names)=>{
    for(const name of names) {
      const status=report?.backends?.[label]?.[name]?.status;
      if(['failed','timed_out','incomplete','in_progress'].includes(status))return status;
    }
    return null;
  };
  return Object.fromEntries(['apple','floor'].map(label=>[label,{
    libraryLoading:{status:report?.libraryLoading?.[label]?.status==='loaded'?'passed':report?.libraryLoading?.[label]?.status==='rejected'?'failed':'not_reported'},
    // Frozen Swift reports pipeline/execution globally. Never invent which
    // backend reached a stage after an asymmetric failure. Preserve any
    // explicit failed/incomplete attempted backend stage in retained reports.
    pipelineCreation:{status:failure(label,'pipelineCreation','pipeline')??(report?.pipelineCreation==='passed'?'passed':'not_reported')},
    execution:{status:failure(label,'execution')??'not_verified'},
    numericalComparison:{status:failure(label,'numericalComparison','numerical')??'not_verified'}
  }]));
}
export function validateRunReport(report,exitStatus,c,receipt) {
  assert([0,1,77].includes(exitStatus),'Unexpected harness exit status');
  assert.equal(report.schema,1);assert.equal(report.kind,c.barrierKind,'Wrong barrier dispatch kind');
  assert.equal(report.scope,'Bounded same-source producer/consumer and scratch-reuse test, not proof of the complete Metal memory model.');
  assert.equal(report.targetPolicy,'Original libraries unchanged; no retargeting or metadata rewriting.');
  assert.equal(report.status,{0:'passed',1:'failed',77:'unavailable'}[exitStatus],'Report/exit disagreement');
  assert.equal(report.artifacts?.length,2);
  for(const [i,label] of ['apple','floor'].entries())assert.deepEqual(report.artifacts[i],{compiler:label,sha256:receipt.artifacts[label].sha256,bytes:receipt.artifacts[label].bytes},'Wrong original library identity');
  if(exitStatus===77) {
    assert(report.libraryLoading?.apple?.status!=='loaded','Loaded Apple reference cannot be unavailable');
    assert(!['pipelineCreation','execution','numericalComparison'].some(k=>['failed','passed','completed','timed_out','incomplete','in_progress'].includes(report[k])),'Observed work cannot be classified unavailable');
    for(const label of ['apple','floor'])for(const stage of ['pipeline','execution','numerical','pipelineCreation','numericalComparison'])assert(!['failed','timed_out','incomplete','in_progress','passed','completed'].includes(report.backends?.[label]?.[stage]?.status),'Attempted backend work cannot be classified unavailable');
    assert(report.checkedValues===undefined||report.checkedValues===0,'Unavailable report claims checked GPU words');
    assert(report.geometry===undefined,'Unavailable report claims dispatched geometry');
    assert(['device','libraryLoading'].includes(report.error?.stage),'Unexpected unavailable stage');
    assert(typeof report.error?.message==='string'&&report.error.message.length>0,'Missing unavailable reason');
  }
  if(exitStatus===0){
    assert(!report.error,'Successful report has an error');
    for(const label of ['apple','floor'])assert.equal(report.libraryLoading?.[label]?.status,'loaded','Successful report lacks completed library loading');
    assert.equal(report.pipelineCreation,'passed','Successful report lacks completed pipeline creation');
    assert.equal(report.execution,'completed','Successful report lacks terminal execution');
    assert.equal(report.numericalComparison,'passed','Successful report lacks completed numerical comparison');
    for(const backend of Object.values(observedBackendStages(report)))for(const stage of Object.values(backend))assert(!['failed','timed_out','incomplete','in_progress'].includes(stage.status),'Successful report contains an attempted backend failure');
  }
  if(exitStatus===1){
    const stage=report.error?.stage;
    assert(['device','libraryLoading','pipelineCreation','execution','numericalComparison'].includes(stage),'Failed report lacks a known terminal stage');
    assert(typeof report.error.message==='string'&&report.error.message.length>0,'Failed report lacks reason');
    if(['device','libraryLoading','pipelineCreation'].includes(stage))assert.equal(report.execution,'not_run','Pre-dispatch failure reports inconsistent execution');
    if(stage==='execution'){assert.equal(report.execution,'failed');assert(report.error.message.startsWith('GPU command failed:'),'Execution completion cannot be established');}
    if(stage==='numericalComparison')assert.equal(report.execution,'completed','Numerical failure lacks completed execution');
  }
}
export function verifyPassedReport(report,values,c,receipt) {
  verifyReceipt(receipt,c);validateRunReport(report,0,c,receipt);
  assert(typeof report.os==='string'&&report.os.trim().length>0,'Missing OS observation');
  assert(typeof report.device?.name==='string'&&report.device.name.trim().length>0,'Missing GPU device');
  assert(typeof report.device?.registryID==='string'&&/^\d{1,20}$/.test(report.device.registryID),'Missing device registry ID');
  for(const label of ['apple','floor'])assert.equal(report.libraryLoading?.[label]?.status,'loaded');
  assert.equal(report.pipelineCreation,'passed');assert.equal(report.execution,'completed');assert.equal(report.numericalComparison,'passed');
  const geometry=report.geometry,w=geometry?.threadsPerThreadgroup;
  assert(Number.isSafeInteger(w)&&w>=1&&w<=1024,'Invalid group width');
  assert.equal(geometry.threadgroups,1);assert.equal(geometry.threadgroupMemoryBytes,w*4);
  assert(Array.isArray(geometry.pipelineSIMDWidths)&&geometry.pipelineSIMDWidths.length===2);
  assert(geometry.pipelineSIMDWidths.every(x=>Number.isSafeInteger(x)&&x>=1&&x<=1024));
  if(c.barrierKind==='simdgroup')assert(w<=Math.min(...geometry.pipelineSIMDWidths),'Dispatch spans more than one SIMD-group');
  else assert(w<=128,'Unexpected threadgroup dispatch width');
  assert.equal(report.checkedValues,16*w*2,'Wrong checked word count');
  assert(Array.isArray(values)&&values.length===16,'All sixteen raw trial records are required');
  for(const [i,row] of values.entries()) {
    assert.equal(row.iteration,i,'Missing, duplicate or reordered trial');
    const input=inputs(w,i),want=expected(input);
    assert.deepEqual(row.input,input,'Input words differ from independent deterministic generator');
    assert.deepEqual(row.expected,want,'Stored CPU expectation differs from independent oracle');
    for(const label of ['apple','floor']) {
      assert(Array.isArray(row[label])&&row[label].length===w,'Missing raw '+label+' words');
      assert(row[label].every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffffff),'Invalid raw uint32 words');
      assert.deepEqual(row[label],want,label+' output differs from independent CPU oracle');
    }
  }
  const backends=observedBackendStages(report);
  for(const label of ['apple','floor']) {
    backends[label].execution={status:'passed',trialsCompleted:16};
    backends[label].numericalComparison={status:'passed',trialsCompared:16,checkedWords:w*16};
  }
  return {schema:1,suite,status:'verified_numerical_pass',exitCode:0,case:c.name,qualification:'bounded_barrier_exchange_only',trialsPerBackend:16,checkedWords:w*32,backends};
}
