"""Verify the same-run release artifact before executing any compiler code."""
import hashlib, json, pathlib, re, subprocess, sys, tarfile

def sha(data): return hashlib.sha256(data).hexdigest()
def verify(artifact, checkout, destination, commit):
    artifact, checkout, destination = map(pathlib.Path, (artifact, checkout, destination))
    assert re.fullmatch('[0-9a-f]{40}', commit)
    manifests = list(artifact.glob('*-manifest.json'))
    assert len(manifests) == 1, 'Expected exactly one manifest'
    raw = manifests[0].read_bytes(); assert len(raw) <= 1024**2
    m = json.loads(raw)
    assert m['schemaVersion'] == 1 and m['status'] == 'final' and m['kind'] == 'fork-built-compiler'
    head = subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD'], text=True).strip()
    tree = subprocess.check_output(['git','-C',str(checkout),'rev-parse','HEAD^{tree}'], text=True).strip()
    assert head == commit and m['tree'] == tree, 'Checkout identity differs from artifact'
    assert m['commit'] == commit and m['binaryBuiltFromNewFork'] is True
    assert m['repository'] == 'n3crosis/floor_llvm'
    assert m['apiVersion'] == 3 and m['headerBundleVersion'] == 2
    assert m['supportedApiVersions'] == [1,2,3]
    assert m['sourceLanguage'] == 'floor-metal-4.1-subset' and m['legacyLanguageVersion'] == 320
    assert m['explicitLanguageTargets'] == [{'ios':18,'metalVersion':320},{'ios':26,'metalVersion':400},{'ios':27,'metalVersion':410}]
    assert m['sourceLockSha256'] == sha((checkout/'wasm/source-lock.json').read_bytes())
    headers = sorted((checkout/'wasm/api/include').rglob('*'))
    identity = sha(('floor-air-header-bundle-v2\n'+''.join(p.relative_to(checkout/'wasm/api/include').as_posix()+':'+sha(p.read_bytes())+'\n' for p in headers if p.is_file())).encode())
    assert identity == m['headerSha256']
    pin = m['assets']['runtime']; assert pathlib.PurePosixPath(pin['name']).name == pin['name']
    runtime = artifact/pin['name']; assert 0 < runtime.stat().st_size <= 128*1024**2
    data = runtime.read_bytes(); assert len(data) == pin['bytes'] and sha(data) == pin['sha256']
    members = {}
    with tarfile.open(runtime, 'r:gz') as archive:
        for item in archive:
            assert item.isfile() and item.name not in members
            assert item.name in m['runtimeFiles'] and 0 < item.size <= (128*1024**2 if item.name == 'air_wasm.wasm' else 1024**2)
            assert not item.name.startswith('/') and '..' not in pathlib.PurePosixPath(item.name).parts
            assert len(members) < 64
            content = archive.extractfile(item).read(item.size+1)
            p = m['runtimeFiles'][item.name]; assert len(content) == p['bytes'] and sha(content) == p['sha256']
            members[item.name] = content
    assert set(members) == set(m['runtimeFiles'])
    receipt = json.loads(members['build-report.json'])
    assert sha(members['build-report.json']) == m['buildReceiptSha256']
    for key in ('repository','commit','tree','sourceFingerprintSha256','sourceLockSha256','headerSha256','apiVersion','headerBundleVersion','supportedApiVersions','sourceLanguage','legacyLanguageVersion','explicitLanguageTargets'):
        assert receipt[key] == m[key], key
    for name in ('air_wasm.mjs','air_wasm.wasm'):
        assert m['files'][name] == receipt['files'][name] == m['runtimeFiles'][name]
    for name, content in members.items():
        if name.startswith('include/'):
            assert content == (checkout/'wasm/api'/name).read_bytes()
    assert members['air_compiler.h'] == (checkout/'wasm/api/air_compiler.h').read_bytes()
    assert members['source-lock.json'] == (checkout/'wasm/source-lock.json').read_bytes()
    destination.mkdir(parents=True, exist_ok=False)
    for name, content in members.items():
        path = destination/name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(content)
    (destination/'verified-runtime.json').write_text(json.dumps({'commit':commit,'apiVersion':m['apiVersion'],'manifestSha256':sha(raw),'runtimeArchiveSha256':sha(data),'headerSha256':identity,'files':m['files']}, indent=2)+'\n')

if __name__ == '__main__':
    assert len(sys.argv) == 5, 'Usage: verify-apple-runtime.py ARTIFACT CHECKOUT NEW_RUNTIME_DIR EXPECTED_COMMIT'
    verify(*sys.argv[1:])
