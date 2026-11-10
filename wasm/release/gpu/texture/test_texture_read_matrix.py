#!/usr/bin/env python3
"""Synthetic matrix orchestration tests. No real GPU evidence is generated."""
import copy,json,os,shutil,struct,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import run_texture_read_gpu_matrix as matrix
import verify_texture_read_report as gate
from make_texture_read_fixtures import texture_pixels
DESCRIPTORS=matrix.descriptors()
FIXTURES=json.loads((matrix.ROOT/'texture-read-oracle-fixtures.json').read_text())

def save(path,data):path.write_text(json.dumps(data))
def synthetic_process(command,directory,timeout,kind='passed'):
    """Test fixture only: emulate the runner's artifact contract, not GPU work."""
    args=dict(zip(command[1::2],command[2::2]));out=Path(args['--output']);out.mkdir()
    d=next(c for c in DESCRIPTORS if c['name']==args['--case']);g=d['textureGeometry'];m=d['textureReadMode']
    q=next(c['queries'] for c in FIXTURES['cases'] if c['geometry']==g and c['mode']==m);active=8 if m=='mixed' else 4;count=len(q)*active
    receipt=Path(args['--pair-receipt']).read_bytes();(out/'pair-receipt.json').write_bytes(receipt);(out/'source.metal').write_text(d['source'])
    r=dict(schemaVersion=1,kind='msl41-texture-read',status=kind,pipelineCreation='passed',execution='completed',numericalComparison='passed',pairedComparison='passed',checkedValues=count*2,
        descriptor=dict(name=d['name'],entry=d['entry'],sourceSha256=d['sourceSha256'],api=3,ios=27,metalVersion=410,math=d['math'],geometry=g,mode=m),
        oracle=dict(fixtureSha256=gate.FIXTURE_SHA,fixtureCrossCheck='passed',queries=len(q),independentPythonEnumeration=True),pairReceiptHashMatched=True,pairReceiptSha256=gate.digest(receipt),artifacts=[],backends={})
    payload=b''.join(struct.pack('<4I',*v) for v in texture_pixels(g).values())
    for name in ['apple','floor']:
        binary=Path(args['--'+name]).read_bytes();r['artifacts'].append(dict(backend=name,sha256=gate.digest(binary),bytes=len(binary),loadedUnchanged=True))
        raw=b'';records=[]
        for i,query in enumerate(q):
            row=copy.deepcopy(query);row.update(index=i,actualBits=query['expectedBits'],guardBits=[gate.GUARD]*4,guardIntact=True,rawByteOffset=len(raw));row['pass']=True;records.append(row)
            raw+=struct.pack('<'+'I'*(active+4),*(query['expectedBits']+[gate.GUARD]*4))
        (out/(name+'-output.bin')).write_bytes(raw);save(out/(name+'-queries.json'),records)
        r['backends'][name]=dict(libraryLoading=dict(status='loaded'),pipelineCreation=dict(status='passed',entry=d['entry']),resourceSetup=dict(status='passed'),execution=dict(status='completed',dispatches=len(q)),numericalComparison=dict(status='passed',checkedValues=count),checkedValues=count,
            argumentBuffer=dict(textureID=1,samplerID=2,independentlyEncoded=True,encodedLength=16 if name=='apple' else 24,alignment=8),
            texturePayload=dict(sha256=gate.digest(payload),bytes=len(payload),pixelFormat='rgba32Float',mipLevels=3,baseDimensions=[8,4,4 if g=='texture3d' else 1],arrayLayers=3 if g=='texture2d_array' else 1),
            rawOutput=dict(file=name+'-output.bin',wordEndian='little',guardWordsPerQuery=4,sha256=gate.digest(raw),bytes=len(raw)))
    if kind=='unavailable':r['backends']['apple']['libraryLoading']['status']='rejected'
    save(out/'report.json',r)
    return dict(command=command,exitStatus={'passed':0,'failed':1,'unavailable':77}[kind],timedOut=False)

class MatrixTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.compile=self.root/'compile';self.compile.mkdir();self.out=self.root/'output';self.harness=self.root/'harness';self.harness.write_text('synthetic executable placeholder');self.harness.chmod(0o700)
        self.compiler=dict(schemaVersion=2,mode='apple-reference-compile-link',status='failed',cases=[])
        for i,d in enumerate(DESCRIPTORS):
            name=f'case-{100+i}';(self.compile/(name+'.metal')).write_text(d['source'])
            hashes={}
            for backend in ['apple','floor']:
                p=self.compile/(name+'.'+backend+'.metallib');p.write_bytes(b'MTLB synthetic-only '+str(i).encode()+backend.encode());hashes[backend+'MetallibSha256']=gate.digest(p.read_bytes())
            self.compiler['cases'].append(dict(name=name,aliases=[d['name']],sourceSha256=d['sourceSha256'],math=d['math'],api=3,ios=27,appleMetalVersion=410,floorMetalVersion=410,appleCompile='passed',appleLink='passed',floorCompile='passed',**hashes))
        self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):save(self.compile/'report.json',self.compiler)
    def run_synthetic(self,action=synthetic_process,**kwargs):
        with patch.object(matrix,'execute',side_effect=action) as process:
            report=matrix.run_matrix(self.compile,self.harness,self.out,**kwargs)
            return report,process.call_count
    def test_all24_strictly_verified_despite_unrelated_upstream_failure(self):
        r,n=self.run_synthetic();self.assertEqual(n,24);self.assertTrue(r['all24Verified']);self.assertEqual(r['exitCode'],0);self.assertEqual(r['upstreamStatus'],'failed')
        self.assertTrue(all(c['reportVerified'] for c in r['cases']));self.assertEqual(len(r['cases']),24)
    def test_missing_alias_kept_and_other_cases_run(self):
        self.compiler['cases'].pop(0);self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['missing'],r['exitCode']),(23,1,2))
    def test_compile_blocked_kept(self):
        self.compiler['cases'][0]['floorCompile']='failed';self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['blocked'],r['exitCode']),(23,1,2))
        self.assertEqual(r['cases'][0]['compileStages']['floorCompile'],'failed')
    def test_missing_library_kept(self):
        (self.compile/'case-100.floor.metallib').unlink();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['missing']),(23,1))
    def test_bad_source_hash_rejected(self):
        self.compiler['cases'][0]['sourceSha256']='0'*64;self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['failed'],r['exitCode']),(23,1,1))
    def test_bad_math_rejected(self):
        self.compiler['cases'][0]['math']=1-self.compiler['cases'][0]['math'];self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['failed']),(23,1))
    def test_duplicate_records_rejected(self):
        self.compiler['cases'].append(copy.deepcopy(self.compiler['cases'][0]));self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['failed']),(23,1))
    def test_path_traversal_basename_rejected(self):
        self.compiler['cases'][0]['name']='../../bad';self.save();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['failed']),(23,1))
    def test_bad_original_hash_rejected(self):
        (self.compile/'case-100.apple.metallib').write_bytes(b'MTLB modified');r,n=self.run_synthetic();self.assertEqual((n,r['counts']['failed']),(23,1))
    def test_all_unavailable_never_pass(self):
        r,n=self.run_synthetic(lambda *args:synthetic_process(*args,kind='unavailable'));self.assertEqual((n,r['counts']['unavailable'],r['exitCode']),(24,24,77));self.assertFalse(r['all24Verified'])
    def unavailable_with_stage(self,stage,status,error=None):
        def run(command,*args):
            result=synthetic_process(command,*args,kind='unavailable')
            options=dict(zip(command[1::2],command[2::2]));path=Path(options['--output'])/'report.json'
            report=json.loads(path.read_text());report['backends']['floor'][stage]={'status':status}
            if error:report['backends']['floor'][stage]['error']=error
            save(path,report);return result
        return self.run_synthetic(run)
    def test_unavailable_cannot_mask_floor_numerical_failure(self):
        r,n=self.unavailable_with_stage('numericalComparison','failed')
        self.assertEqual((n,r['counts']['failed'],r['exitCode']),(24,24,1))
    def test_unavailable_cannot_mask_floor_execution_failure(self):
        r,n=self.unavailable_with_stage('execution','failed')
        self.assertEqual((n,r['counts']['failed'],r['exitCode']),(24,24,1))
    def test_reported_timeout_fences_further_dispatches(self):
        r,n=self.unavailable_with_stage('execution','timed_out')
        self.assertEqual((n,r['counts']['failed'],r['counts']['blocked'],r['exitCode']),(1,1,23,1))
    def test_frozen_swift_timeout_fences_further_dispatches(self):
        r,n=self.unavailable_with_stage('execution','failed','GPU command completion exceeded 20 seconds')
        self.assertEqual((n,r['counts']['failed'],r['counts']['blocked'],r['exitCode']),(1,1,23,1))
    def test_incomplete_execution_fences_further_dispatches(self):
        r,n=self.unavailable_with_stage('execution','incomplete')
        self.assertEqual((n,r['counts']['failed'],r['counts']['blocked'],r['exitCode']),(1,1,23,1))
    def test_unavailable_without_floor_execution_remains_unavailable(self):
        r,n=self.unavailable_with_stage('execution','not_run')
        self.assertEqual((n,r['counts']['unavailable'],r['exitCode']),(24,24,77))
    def test_one_failure_does_not_stop_matrix(self):
        def run(command,*args):return synthetic_process(command,*args,kind='failed' if DESCRIPTORS[0]['name'] in command else 'passed')
        r,n=self.run_synthetic(run);self.assertEqual((n,r['counts']['failed'],r['exitCode']),(24,1,1))
    def test_timeout_keeps_partial_report_and_fences_dispatches(self):
        def run(command,*args):
            result=synthetic_process(command,*args)
            if DESCRIPTORS[0]['name'] in command:result.update(timedOut=True,exitStatus=-9)
            return result
        r,n=self.run_synthetic(run);self.assertEqual((n,r['counts']['timeout'],r['exitCode']),(1,1,1));self.assertEqual(r['counts']['blocked'],23);self.assertIn('details',r['cases'][0])
    def test_missing_gpu_report_not_pass(self):
        r,n=self.run_synthetic(lambda *args:dict(exitStatus=0,timedOut=False));self.assertEqual((n,r['counts']['missing'],r['exitCode']),(24,24,2))
    def test_exit_report_disagreement_rejected(self):
        def run(*args):result=synthetic_process(*args);result['exitStatus']=77;return result
        r,n=self.run_synthetic(run);self.assertEqual((n,r['counts']['failed'],r['exitCode']),(24,24,1))
    def test_raw_corruption_rejected_by_real_verifier(self):
        def run(command,*args):
            result=synthetic_process(command,*args);options=dict(zip(command[1::2],command[2::2]));path=Path(options['--output'])/'floor-output.bin';data=bytearray(path.read_bytes());data[0]^=1;path.write_bytes(data);return result
        r,n=self.run_synthetic(run);self.assertEqual((n,r['counts']['failed']),(24,24))
    def test_missing_harness_blocks_without_subprocess(self):
        self.harness.unlink();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['blocked'],r['exitCode']),(0,24,2))
    def test_bad_report_keeps24_cases(self):
        (self.compile/'report.json').write_text('{bad');r,n=self.run_synthetic();self.assertEqual((n,len(r['cases']),r['counts']['blocked'],r['exitCode']),(0,24,24,1))
    def test_matrix_budget_preserves_unstarted_cases(self):
        clock=[0.0]
        def run(*args):
            result=synthetic_process(*args);clock[0]=2.0;return result
        with patch.object(matrix.time,'monotonic',side_effect=lambda:clock[0]):
            r,n=self.run_synthetic(run,matrix_timeout=1)
        self.assertEqual((n,r['counts']['passed'],r['counts']['blocked'],r['exitCode']),(1,1,23,2))
    def test_crash_without_report_is_failure(self):
        r,n=self.run_synthetic(lambda *args:dict(exitStatus=-11,timedOut=False));self.assertEqual((n,r['counts']['failed'],r['exitCode']),(24,24,1))
    def test_missing_compile_report_preserves_all24(self):
        (self.compile/'report.json').unlink();r,n=self.run_synthetic();self.assertEqual((n,r['counts']['missing'],len(r['cases'])),(0,24,24));self.assertEqual(r['exitCode'],2)
    def test_output_directory_must_be_fresh(self):
        self.out.mkdir();(self.out/'sentinel').write_text('preserve')
        with self.assertRaises(FileExistsError):self.run_synthetic()
        self.assertEqual((self.out/'sentinel').read_text(),'preserve')
    def test_module_relative_paths_from_other_cwd(self):
        previous=Path.cwd();os.chdir(self.root)
        try:r,n=self.run_synthetic();self.assertEqual((n,r['exitCode']),(24,0))
        finally:os.chdir(previous)

class ProcessTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_stream_logs_bounded_and_truncation_recorded(self):
        command=[sys.executable,'-c','import sys;sys.stdout.write("a"*400000);sys.stderr.write("b"*400000)']
        r=matrix.execute(command,self.path,5);self.assertEqual(r['exitStatus'],0)
        for stream in ['stdout','stderr']:
            self.assertTrue(r[stream]['truncated']);self.assertEqual(r[stream]['capturedBytes'],matrix.LOG_LIMIT);self.assertEqual(r[stream]['totalBytes'],400000);self.assertEqual((self.path/(stream+'.log')).stat().st_size,matrix.LOG_LIMIT)
    def test_timeout_kills_child(self):
        r=matrix.execute([sys.executable,'-c','import time;print("started",flush=True);time.sleep(10)'],self.path,0.15)
        self.assertTrue(r['timedOut']);self.assertEqual(r['exitStatus'],-9);self.assertIn(b'started',(self.path/'stdout.log').read_bytes())
    def test_post_spawn_selector_failure_kills_and_reaps(self):
        import selectors
        selector=selectors.DefaultSelector()
        with patch.object(matrix.selectors,'DefaultSelector',return_value=selector),patch.object(selector,'register',side_effect=OSError('injected selector failure')):
            r=matrix.execute([sys.executable,'-c','import time;time.sleep(10)'],self.path,5)
        self.assertIn('injected selector failure',r['error']);self.assertEqual(r['exitStatus'],-9);self.assertFalse(r.get('terminationUncertain',False))
    def test_spawn_failure_preserved(self):
        r=matrix.execute(['/nonexistent/texture-harness'],self.path,1);self.assertIn('error',r);self.assertIsNone(r['exitStatus']);self.assertFalse(r['timedOut'])

if __name__=='__main__':unittest.main()
