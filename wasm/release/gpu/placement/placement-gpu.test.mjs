// Offline unit tests only. Synthetic reports below are never GPU evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {suite,cases,layout,sourceForCase,sourceIdentities,bindings,inputs,expected,initialOutput,wordsToBytes,sha256,descriptor,oracleFixture,classify,placementGPUCases,gpuArguments} from './placement-gpu.mjs';
import {verifyPassedReport,verifyDirectory} from './verify-placement-gpu.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const swift=readFileSync(join(root,'metal-placement-numerical.swift'),'utf8');

// Separate BigInt byte-level oracle. Does not use expected(), its object model,
// wordsToBytes(), initialOutput(), or any GPU output as the expected result.
function alternate(c,input) {
  const mask=0xffffffffn, v=input.map(BigInt), xor=0xa5a5a5a5n, add=0x10203040n;
  const word=(bytes,offset,x)=>{for(let n=0;n<4;n++)bytes[offset+n]=Number((x>>BigInt(8*n))&255n);};
  const output=Buffer.alloc(160),arena=Buffer.alloc(64),trace=[];
  for(let i=0;i<40;i++)word(output,i*4,0x6a09e667n^((BigInt(i+1)*0x01020305n)&mask));
  for(let i=0;i<64;i++)arena[i]=Number((BigInt(i*37)^v[0]^(v[5]>>8n)^0x5an)&255n);
  const fv=c.count===1?v[0]:0x13579bdfn, fs=c.count===1?v[1]:0x2468ace0n;
  trace.push(0x504c4143n,BigInt(c.count),1n,8n,4n,fv,fs,c.count===2?fv:0n,c.count===2?fs:0n,fv^xor,(fs+add)&mask,c.count===2?fv^xor:0n,c.count===2?(fs+add)&mask:0n,1n,BigInt(c.count-1),v[2]^(c.count===2?v[4]:0n));
  for(let i=0;i<c.count;i++){word(arena,16+8*i,v[2+2*i]^xor);word(arena,20+8*i,(v[3+2*i]+add)&mask);}
  trace.forEach((x,i)=>word(output,16+i*4,x));arena.copy(output,80);
  return {trace:trace.map(Number),output,arena};
}
function synthetic(c) {
  // Placeholder identities are confined to this unit-test fixture. They are
  // never written as a production descriptor or represented as loaded libraries.
  const wanted={schema:1,suite,feature:'msl41-placement-gpu',case:c,source:sourceIdentities[c.name],bindings:bindings(c),target:{metalVersion:410,ios:27,mathProfile:0},apple:{sha256:'a'.repeat(64),bytes:42},floor:{sha256:'b'.repeat(64),bytes:43}};
  const files=new Map();
  const raw=(b,file)=>{files.set(file,Buffer.from(b));return {file,bytes:b.length,sha256:sha256(b)};};
  const report={schema:1,suite,feature:'msl41-placement-gpu',scope:'gpu_pair',qualification:'numerical_only',compilerProvenance:'requires_external_compile_record_review',status:'passed',exitCode:0,case:c,device:'SYNTHETIC UNIT TEST ONLY',registryID:'0',descriptor:wanted,descriptorValidation:'passed',inputVectors:inputs(),pairComparison:{status:'passed',trialsCompared:12},initialOutput:raw(initialOutput(),'initial-output.u8le')};
  report.fixtures=inputs().map((input,i)=>{const e=alternate(c,input);return {trial:i,input,trace:e.trace,inputRaw:raw(wordsToBytes(input),`trial-${i}-input.u32le`),expectedOutput:raw(e.output,`trial-${i}-expected-output.u8le`),expectedArena:raw(e.arena,`trial-${i}-expected-arena.u8le`)};});
  report.backends=Object.fromEntries(['apple','floor'].map(label=>[label,{load:{status:'passed',...wanted[label]},pipeline:{status:'passed',entry:c.name},execution:{status:'passed',trialsCompleted:12},numerical:{status:'passed',trialsCompared:12},trials:inputs().map((input,i)=>{const e=alternate(c,input);return {trial:i,execution:'passed',numerical:'passed',output:raw(e.output,`${label}-${i}-output.u8le`),arenaSnapshot:raw(e.arena,`${label}-${i}-snapshot.u8le`),outputMismatch:{count:0,first:[],actualBytes:160,expectedBytes:160},...(c.space==='device'?{deviceArena:raw(e.arena,`${label}-${i}-device.u8le`),arenaMismatch:{count:0,first:[],actualBytes:64,expectedBytes:64}}:{})};})}]));
  return {report,wanted,files,verify(){return verifyPassedReport(report,wanted,(name)=>files.get(name));}};
}
for(const c of cases) {
  test(c.name+' source, hash, byte budget and exact bindings',()=>{
    const bytes=readFileSync(join(root,'sources',c.name+'.metal'));assert.equal(bytes.toString(),sourceForCase(c));
    assert(bytes.length<=4096);assert.equal(bytes.length,sourceIdentities[c.name].bytes);assert.equal(sha256(bytes),sourceIdentities[c.name].sha256);
    assert(swift.includes(`"${c.name}": ["sha256": "${sha256(bytes)}", "bytes": ${bytes.length}]`));
    const s=bytes.toString();assert(s.includes(`new(base) ${c.space} Item_${c.space}${c.count===2?'[2]':'(input[0],input[1])'}`));
    assert(s.includes(`~Item_${c.space}() ${c.space}`));assert(s.includes('volatile uint value; volatile uint stamp;'));
    assert(s.includes('sizeof(Item_'+c.space+')==8 && alignof(Item_'+c.space+')==4'));assert(!s.includes('alignas(32)'));
    assert(!/delete\b|operator new|noexcept/.test(s));
    assert(s.includes('out[2]=p=='));assert(s.includes('for(uint i=0;i<16;++i) out[16+i]=placement_word(arena,i*4)'));
    if(c.space==='thread')assert(s.includes('alignas(4) thread uchar arena[64]'));
    if(c.space==='threadgroup')assert(s.includes('threadgroup uchar* arena [[threadgroup(0)]]'));
    if(c.space==='device')assert(s.includes('device uchar* arena [[buffer(2)]]'));
    assert.deepEqual(bindings(c).threadgroups,[1,1,1]);assert.deepEqual(bindings(c).threadsPerThreadgroup,[1,1,1]);
    assert.equal(bindings(c).inputBuffer,0);assert.equal(bindings(c).outputBuffer,1);assert.equal(bindings(c).outputBindingByteOffset,16);
  });
  for(const [i,v] of inputs().entries())test(c.name+' independent unsigned CPU oracle '+i,()=>{
    const e=expected(c,v);assert.deepEqual(e,alternate(c,v));
    assert.equal(e.output.length,160);assert.equal(e.arena.length,64);assert.equal(e.trace.length,16);
    const canary=j=>((j*37)^v[0]^(v[5]>>>8)^0x5a)&255;
    for(let j=0;j<64;j++)if(j<16||j>=16+c.count*8)assert.equal(e.arena[j],canary(j));
    assert.deepEqual(e.output.subarray(0,16),initialOutput().subarray(0,16));
    assert.deepEqual(e.output.subarray(144),initialOutput().subarray(144));
    assert.deepEqual(e.output.subarray(80,144),e.arena);
  });
  test(c.name+' verifier accepts complete synthetic evidence only as a unit test',()=>{
    const f=synthetic(c);const r=f.verify();assert.equal(r.status,'verified_numerical_pass');assert.equal(r.trialsPerBackend,12);
    assert.equal(r.rawFilesVerified,c.space==='device'?109:85);
  });
  for(const [label,offset] of [['prefix',0],['pointer identity',24],['constructor',36],['destructor',52],['replacement',76],['arena prefix',80],['payload',96],['arena suffix',120],['output suffix',159]])
    test(c.name+' rejects '+label+' corruption even with updated hash and matching GPU pair',()=>{
      const f=synthetic(c);
      for(const backend of ['apple','floor']) {const raw=f.report.backends[backend].trials[0].output;const b=f.files.get(raw.file);b[offset]^=1;raw.sha256=sha256(b);}
      assert.throws(()=>f.verify(),/independent CPU expectation/);
    });
  test(c.name+' rejects a fabricated expected fixture',()=>{
    const f=synthetic(c);const raw=f.report.fixtures[0].expectedOutput;f.files.get(raw.file)[0]^=1;raw.sha256=sha256(f.files.get(raw.file));assert.throws(()=>f.verify());
  });
}
test('committed oracle fixture is reproducible',()=>assert.deepEqual(JSON.parse(readFileSync(join(root,'placement-gpu-oracle.json'))),oracleFixture()));
test('source manifest records exact contract',()=>{
  const contract=JSON.parse(readFileSync(join(root,'source-contract.json')));assert.equal(contract.feature,'msl41-placement-gpu');
  for(const c of cases){const r=contract.cases.find(x=>x.name===c.name);assert(r);assert.equal(r.sha256,sourceIdentities[c.name].sha256);assert.equal(r.bytes,sourceIdentities[c.name].bytes);assert.deepEqual(r.bindings,bindings(c));}
});
test('CPU edge cases are genuine wraparound rather than signed arithmetic',()=>{
  const e=expected(cases[0],inputs()[1]);assert.equal(e.trace[9],0x5a5a5a5a);assert.equal(e.trace[10],0x1020303f);assert.equal(e.arena.readUInt32LE(20),0x1020303f);
  assert.equal(new Set(inputs().flat()).size>40,true);assert.equal(inputs().length,12);
});
test('nontrivial array oracle has two default constructors and distinct replacements',()=>{
  const e=expected(cases[1],inputs()[3]);assert.deepEqual(e.trace.slice(5,9),[0x13579bdf,0x2468ace0,0x13579bdf,0x2468ace0]);
  assert.notEqual(e.arena.readUInt32LE(16),e.arena.readUInt32LE(24));assert.equal(e.trace[2],1);assert.equal(e.trace[13],1);assert.equal(e.trace[14],1);
});
const good={load:'passed',pipeline:'passed',execution:'passed',numerical:'passed'};
for(const backend of ['apple','floor'])for(const stage of Object.keys(good))for(const status of ['failed','not_run','in_progress','timed_out','incomplete','unavailable'])
  test(`${backend} ${stage} ${status} is never a GPU pass`,()=>{const a={...good},f={...good};(backend==='apple'?a:f)[stage]=status;assert.notEqual(classify(a,f).exitCode,0);});
test('both complete backend stages are required',()=>assert.deepEqual(classify(good,good),{status:'passed',exitCode:0}));
for(const mutation of [
  r=>{r.scope='cpu_oracle_only';},r=>{r.status='unavailable';r.exitCode=77;},r=>{r.backends.floor.load.status='failed';},
  r=>{r.backends.apple.pipeline.status='not_run';},r=>{r.backends.floor.execution.trialsCompleted=11;},r=>{r.backends.apple.numerical.trialsCompared=0;},
  r=>{r.backends.floor.trials.pop();},r=>{r.backends.apple.trials[1].trial=0;},r=>{r.backends.floor.trials[0].deviceArena=undefined;},
  r=>{r.backends.apple.trials[0].output.file='../escape';},r=>{r.backends.apple.trials[0].output.sha256='0'.repeat(64);},r=>{r.pairComparison.status='failed';},
  r=>{delete r.device;},r=>{r.backends.floor.load.sha256='0'.repeat(64);},r=>{r.backends.floor.pipeline.entry='other';},
])test('strict report verifier rejects mutation '+mutation.toString(),()=>{const f=synthetic(cases[4]);mutation(f.report);assert.throws(()=>f.verify());});
test('device arena is independently checked, not only its shader snapshot',()=>{const f=synthetic(cases[4]);const raw=f.report.backends.floor.trials[0].deviceArena;const b=f.files.get(raw.file);b[50]^=2;raw.sha256=sha256(b);assert.throws(()=>f.verify());});
test('descriptor builder binds original files and rejects bad inputs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'placement-descriptor-unit-'));
  try{const a=join(dir,'apple'),f=join(dir,'floor');writeFileSync(a,'MTLB synthetic Apple unit fixture');writeFileSync(f,'MTLB synthetic FLOOR unit fixture');
    const d=descriptor(cases[0].name,a,f);assert.equal(d.apple.sha256,sha256(readFileSync(a)));assert.equal(d.floor.sha256,sha256(readFileSync(f)));assert.deepEqual(d.bindings,bindings(cases[0]));
    assert.throws(()=>descriptor('unknown',a,f));writeFileSync(f,'not metallib');assert.throws(()=>descriptor(cases[0].name,a,f));
    symlinkSync(a,join(dir,'link'));assert.throws(()=>descriptor(cases[0].name,join(dir,'link'),a));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('directory verification uses original files and refuses symlink raw evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'placement-evidence-unit-'));
  try{const a=join(dir,'apple'),f=join(dir,'floor'),s=join(dir,'source'),d=join(dir,'descriptor.json'),e=join(dir,'evidence');mkdirSync(e);
    writeFileSync(a,'MTLB synthetic Apple unit fixture');writeFileSync(f,'MTLB synthetic FLOOR unit fixture');writeFileSync(s,sourceForCase(cases[0]));
    const fixture=synthetic(cases[0]), wanted=descriptor(cases[0].name,a,f);fixture.report.descriptor=wanted;
    for(const label of ['apple','floor'])Object.assign(fixture.report.backends[label].load,wanted[label]);
    writeFileSync(d,JSON.stringify(wanted));fixture.report.descriptorSha256=sha256(readFileSync(d));
    for(const [name,bytes] of fixture.files)writeFileSync(join(e,name),bytes);writeFileSync(join(e,'report.json'),JSON.stringify(fixture.report));
    const options={directory:e,descriptorPath:d,sourcePath:s,applePath:a,floorPath:f};assert.equal(verifyDirectory(options).status,'verified_numerical_pass');
    const name=fixture.report.initialOutput.file;rmSync(join(e,name));symlinkSync(join(e,fixture.report.fixtures[0].expectedOutput.file),join(e,name));assert.throws(()=>verifyDirectory(options));
    fixture.report.status='unavailable';fixture.report.exitCode=77;fixture.report.reason='Synthetic unit unavailable';writeFileSync(join(e,'report.json'),JSON.stringify(fixture.report));assert.equal(verifyDirectory(options).exitCode,77);
    writeFileSync(f,'MTLB changed synthetic unit fixture');assert.throws(()=>verifyDirectory(options));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Swift preserves stage distinction and fail-closed host contracts',()=>{
  assert(swift.includes('device.makeLibrary(data: dispatch)'));assert(!/makeLibrary\(source:|makeLibrary\(URL:|replace.*metallib|Process\(/.test(swift));
  assert(swift.includes('scope"] = "cpu_oracle_only"'));assert(swift.includes('gpuValidation"] = "not_run"'));
  assert(swift.includes('GPU and CPU-only modes cannot be mixed'));assert(swift.includes('refusing to overwrite evidence'));
  assert(swift.includes('signal.wait(timeout:.now()+20)'));assert(swift.includes('guard command.status == .completed'));
  assert(swift.indexOf('guard command.status == .completed')<swift.indexOf('Data(bytes:destination.contents()'));
  assert(swift.includes('if gpuCommandPending'));assert(swift.includes('exitCode = 77'));assert(swift.includes('bytes: $0'));
  assert(swift.includes('setBuffer(destination,offset:16,index:1)'));assert(swift.includes('setThreadgroupMemoryLength(64,index:0)'));
  assert(swift.includes('actual == e.output && (actualArena == nil || actualArena == e.arena)'));
  assert(swift.includes('Persist outside the API catch'));assert(swift.includes('CPU-only'));assert(swift.includes('Synchronous Metal load/pipeline API calls cannot'));
});

for(const stage of ['pipeline','execution','numerical'])for(const status of ['failed','timed_out','incomplete'])test('Observed FLOOR '+stage+' '+status+' dominates unavailable reference',()=>{const floor={...good,[stage]:status};assert.deepEqual(classify({load:'failed',pipeline:'not_run',execution:'not_run',numerical:'not_run'},floor),{status:'failed',exitCode:1});});
test('both load failures remain unavailable, never passed',()=>assert.deepEqual(classify({load:'failed'},{load:'failed'}),{status:'unavailable',exitCode:77}));

test('compile and standalone GPU CLI adapters use explicit API3 entry contracts',()=>{
  const paths={descriptor:'case.json',source:'case.metal',apple:'apple.metallib',floor:'floor.metallib',output:'new-output'};
  for(const c of placementGPUCases()) {
    assert.equal(c.status,0);assert.equal(c.kind,0);assert.equal(c.api,3);assert.equal(c.ios,27);assert.equal(c.metalVersion,410);assert.equal(c.math,0);
    assert.equal(c.feature,'msl41-placement-gpu');assert.equal(c.msl41PlacementGPU,true);assert.equal(c.entry,c.name);assert(Buffer.byteLength(c.source)<=4096);assert.equal(c.sourceSha256,sha256(c.source));
    assert.deepEqual(gpuArguments(c,paths),['--descriptor','case.json','--source','case.metal','--apple','apple.metallib','--floor','floor.metallib','--output','new-output']);
    for(const change of [{api:2},{ios:26},{metalVersion:400},{math:1},{entry:'other'},{source:c.source+'\n'},{feature:'other'}])assert.throws(()=>gpuArguments({...c,...change},paths));
  }
});
test('published descriptor schema fixes every case binding/source/entry and rejects extra keys',()=>{
  const schema=JSON.parse(readFileSync(join(root,'placement-gpu-descriptor.schema.json')));assert.equal(schema.oneOf.length,6);
  for(const [i,c] of cases.entries()){const s=schema.oneOf[i];assert.equal(s.additionalProperties,false);assert.deepEqual(s.properties.case.const,c);assert.deepEqual(s.properties.source.const,sourceIdentities[c.name]);assert.deepEqual(s.properties.bindings.const,bindings(c));assert.deepEqual(s.properties.target.const,{metalVersion:410,ios:27,mathProfile:0});}
  assert.equal(schema.$defs.library.additionalProperties,false);assert.equal(schema.$defs.library.properties.bytes.maximum,33554432);
});
