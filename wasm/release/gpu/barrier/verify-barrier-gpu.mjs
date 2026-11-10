// Offline verification only. A synthetic fixture is never GPU execution proof.
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {barrierGPUCases,boundedRead,jsonFile,identity,sha256,verifyReceipt,verifyPassedReport} from './barrier-gpu.mjs';
export function verifyDirectory({directory,receiptPath,sourcePath,applePath,floorPath}) {
  const st=lstatSync(directory);assert(st.isDirectory()&&!st.isSymbolicLink(),'Expected ordinary GPU output directory');
  const receiptBytes=boundedRead(receiptPath,128*1024),receipt=JSON.parse(receiptBytes);
  const c=barrierGPUCases().find(c=>c.name===receipt.case);assert(c,'Unknown barrier case');
  const original={source:boundedRead(sourcePath,4096),apple:boundedRead(applePath,32*1024*1024),floor:boundedRead(floorPath,32*1024*1024)};
  assert.equal(sha256(original.source),c.sourceSha256);assert.equal(original.source.length,c.sourceBytes);
  verifyReceipt(receipt,c,label=>original[label]);
  const reportBytes=boundedRead(join(directory,'report.json'),256*1024),valuesBytes=boundedRead(join(directory,'values.json'),4*1024*1024);
  const result=verifyPassedReport(JSON.parse(reportBytes),JSON.parse(valuesBytes),c,receipt);
  for(const [key,path] of Object.entries({source:sourcePath,apple:applePath,floor:floorPath}))
    assert.equal(sha256(boundedRead(path,key==='source'?4096:32*1024*1024)),sha256(original[key]),'Original '+key+' changed during verification');
  return {...result,receipt:identity(receiptBytes),report:identity(reportBytes),rawValues:identity(valuesBytes)};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2),keys=['--directory','--receipt','--source','--apple','--floor'],o={};
    assert.equal(args.length,10,'Usage: node verify-barrier-gpu.mjs --directory GPU_OUTPUT --receipt PAIR_RECEIPT --source SOURCE --apple APPLE_LIBRARY --floor FLOOR_LIBRARY');
    for(let i=0;i<args.length;i+=2){assert(keys.includes(args[i])&&!Object.hasOwn(o,args[i])&&args[i+1]&&!args[i+1].startsWith('--'));o[args[i]]=resolve(args[i+1]);}
    assert.equal(Object.keys(o).length,5);
    console.log(JSON.stringify(verifyDirectory({directory:o['--directory'],receiptPath:o['--receipt'],sourcePath:o['--source'],applePath:o['--apple'],floorPath:o['--floor']}),null,2));
  } catch(error){console.error(JSON.stringify({status:'verification_failed',error:String(error),exitCode:1}));process.exitCode=1;}
}
