"""Synthetic integrity tests only: these fixtures are not real compiler evidence."""
import hashlib, importlib.util, io, json, pathlib, subprocess, tarfile, tempfile, unittest
spec=importlib.util.spec_from_file_location('apple_runtime', pathlib.Path(__file__).with_name('verify-apple-runtime.py'))
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
def pin(data): return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
class RuntimeTests(unittest.TestCase):
    def fixture(self, root):
        artifact=root/'artifact'; artifact.mkdir(); checkout=root/'checkout'
        inc=checkout/'wasm/api/include'; inc.mkdir(parents=True)
        (inc/'metal_stdlib').write_bytes(b'header'); (checkout/'wasm/api/air_compiler.h').write_bytes(b'api')
        (checkout/'wasm/source-lock.json').write_bytes(b'{}')
        def git(*args): return subprocess.check_output(['git','-C',str(checkout),*args],text=True,stderr=subprocess.DEVNULL).strip()
        git('init'); git('add','.'); git('-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Synthetic fixture')
        commit=git('rev-parse','HEAD'); tree=git('rev-parse','HEAD^{tree}')
        identity=module.sha(('floor-air-header-bundle-v2\nmetal_stdlib:'+module.sha(b'header')+'\n').encode())
        files={n:pin(b'fake') for n in ('air_wasm.mjs','air_wasm.wasm')}
        m={'schemaVersion':1,'status':'final','kind':'fork-built-compiler','commit':commit,'tree':tree,'repository':'n3crosis/floor_llvm','binaryBuiltFromNewFork':True,'apiVersion':2,'headerBundleVersion':2,'sourceLockSha256':module.sha(b'{}'),'sourceFingerprintSha256':'c'*64,'headerSha256':identity,'files':files}
        members={'air_wasm.mjs':b'fake','air_wasm.wasm':b'fake','build-report.json':json.dumps(m).encode(),'include/metal_stdlib':b'header','air_compiler.h':b'api','source-lock.json':b'{}'}
        m['buildReceiptSha256']=module.sha(members['build-report.json']); m['runtimeFiles']={n:pin(v) for n,v in members.items()}
        with tarfile.open(artifact/'runtime.tar.gz','w:gz') as t:
            for n,v in members.items():
                info=tarfile.TarInfo(n); info.size=len(v); t.addfile(info,io.BytesIO(v))
        m['assets']={'runtime':{'name':'runtime.tar.gz',**pin((artifact/'runtime.tar.gz').read_bytes())}}
        (artifact/'test-manifest.json').write_text(json.dumps(m))
        return artifact,checkout,m
    def test_valid_synthetic_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d); a,c,m=self.fixture(root); module.verify(a,c,root/'out',m['commit'])
            self.assertEqual(json.loads((root/'out/verified-runtime.json').read_text())['headerSha256'],m['headerSha256'])
    def test_rejects_wrong_commit_tampered_runtime_and_header(self):
        for mode in ('commit','tree','runtime','header'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as d:
                root=pathlib.Path(d); a,c,m=self.fixture(root)
                if mode=='tree':
                    m['tree']='f'*40; (a/'test-manifest.json').write_text(json.dumps(m))
                if mode=='runtime': (a/'runtime.tar.gz').write_bytes(b'tampered')
                if mode=='header': (c/'wasm/api/include/metal_stdlib').write_bytes(b'tampered')
                with self.assertRaises(AssertionError): module.verify(a,c,root/'out',('d'*40 if mode=='commit' else m['commit']))
                self.assertFalse((root/'out').exists())
if __name__=='__main__': unittest.main()
