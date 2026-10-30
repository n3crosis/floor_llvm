// CI supervisor for the real Emscripten modularized test executable.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
export const EXPECTED_CASES=Object.freeze(['no-arguments','patch-truncated-1','patch-truncated-2','patch-truncated-3','patch-primitive-wrong-type','patch-count-wrong-metadata','patch-count-wrong-constant','patch-primitive-unknown','patch-count-i128-high-bit','patch-count-zero','patch-count-64']);
export function checkReport(text){
 assert.equal(typeof text,'string');assert(text.length>0&&Buffer.byteLength(text)<=65536,'missing or oversized metadata report');
 const r=JSON.parse(text);assert.equal(text.trim(),JSON.stringify(r),'noncanonical or duplicate report output');assert.deepEqual(Object.keys(r).sort(),['cases','deviceQualified','failures','realWriterCasesPassed','schemaVersion']);
 assert.equal(r.schemaVersion,1);assert.equal(r.realWriterCasesPassed,11);assert.equal(r.failures,0);assert.equal(r.deviceQualified,false);
 assert(Array.isArray(r.cases));assert.equal(r.cases.length,EXPECTED_CASES.length);
 for(let i=0;i<EXPECTED_CASES.length;i++)assert.deepEqual(r.cases[i],{name:EXPECTED_CASES[i],passed:true});
 return r;
}
async function boundedFile(path,max){const st=await lstat(path);assert(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<=max,'invalid test module');const b=await readFile(path);assert.equal(b.length,st.size);return b;}
export async function runSuite(modulePath,outputPath,timeoutMs=120000){
 assert(Number.isInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000);
 const module=resolve(modulePath),output=resolve(outputPath);assert(module.endsWith('.mjs'));await boundedFile(module,1048576);await boundedFile(module.slice(0,-4)+'.wasm',134217728);
 const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_PATH;
 const child=spawnSync(process.execPath,['--max-old-space-size=192',fileURLToPath(import.meta.url),'--child',module],{env,encoding:'utf8',timeout:timeoutMs,killSignal:'SIGKILL',maxBuffer:1048576});
 assert(!child.error&&child.status===0,`metadata child failed: ${child.error?.message||child.stderr||child.signal}`);
 const report=checkReport(child.stdout); // exit0 alone must never establish execution.
 await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});return report;
}
async function main(args){
 if(args.length===2&&args[0]==='--child'){
  const module=resolve(args[1]),wasmBinary=await boundedFile(module.slice(0,-4)+'.wasm',134217728);
  await boundedFile(module,1048576);const factory=(await import(pathToFileURL(module).href)).default;
  assert.equal(typeof factory,'function','missing Emscripten module factory');
  // EXPORT_ES6 creates a factory: executing the .mjs file alone does not run main.
  // Invoking the factory initializes WASM and runs its ordinary main by default.
  await factory({wasmBinary,noInitialRun:false});return;
 }
 assert(args.length===4&&args[0]==='--module'&&args[2]==='--output','usage: --module FILE.mjs --output REPORT.json');
 await runSuite(args[1],args[3]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{process.stderr.write('Metadata test runner: '+String(e?.message||e).slice(0,4096)+'\n');process.exitCode=1;});
