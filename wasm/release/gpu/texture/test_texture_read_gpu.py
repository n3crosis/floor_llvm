#!/usr/bin/env python3
"""CPU/source/evidence tests only; these tests do not execute Swift or a GPU."""
import contextlib,copy,hashlib,io,json,struct,tempfile,unittest
from unittest.mock import patch
from pathlib import Path
import make_texture_read_fixtures as gen
import verify_texture_read_report as gate
import make_texture_read_pair_receipt as receipt_maker
ROOT=Path(__file__).resolve().parent
DESCRIPTORS=json.loads((ROOT/'metal-texture-read-gpu-cases.json').read_text())
FIXTURES=json.loads((ROOT/'texture-read-oracle-fixtures.json').read_text())
SWIFT=(ROOT/'metal-texture-read-numerical.swift').read_text()

def independent_oracle(g,m,q):
    n=3 if g=='texture3d' else 2;lod=0 if m=='defaults' else q['lod'];layer=q['layer'] if g=='texture2d_array' else 0
    coords=[-2,4,-1][:n] if m=='boundaries' else q['coordinate'];offset=[0]*n if m=='defaults' else [-8,7,1][:n] if m=='boundaries' else q['offset']
    def lookup(p,clamp):
        if lod>=3 or layer >= (3 if g=='texture2d_array' else 1):return [0]*4
        extent=[max(1,d//(2**lod)) for d in [8,4,4][:n]]
        if not clamp and any(not 0<=x<end for x,end in zip(p,extent)):return [0]*4
        p=[max(0,min(end-1,x)) for x,end in zip(p,extent)]+[0]*(3-n)
        return [struct.unpack('<I',struct.pack('<f',1+10000*lod+1000*layer+100*p[2]+10*p[1]+p[0]+c*0.25))[0] for c in range(4)]
    out=lookup([a+b for a,b in zip(coords,offset)],True)
    return out+lookup(q['coordinate'],False) if m=='mixed' else out

class OracleTests(unittest.TestCase):
    def test_all_480_queries_independently(self):
        self.assertEqual(sum(len(c['queries']) for c in FIXTURES['cases']),480)
        for c in FIXTURES['cases']:
            for q in c['queries']:
                with self.subTest(geometry=c['geometry'],mode=c['mode'],label=q['label']):
                    self.assertEqual(q['expectedBits'],independent_oracle(c['geometry'],c['mode'],q))
    def test_vector_lengths(self):
        for c in FIXTURES['cases']:
            for q in c['queries']:self.assertEqual(len(q['expectedBits']),8 if c['mode']=='mixed' else 4)
    def test_mixed_does_not_mutate_texels(self):
        for g in ['texture2d','texture2d_array','texture3d']:
            pixels=gen.texture_pixels(g);before=copy.deepcopy(pixels)
            for q in gen.queries(g):
                first=gen.oracle(g,'mixed',q,pixels);self.assertEqual(first,gen.oracle(g,'mixed',q,pixels))
            self.assertEqual(pixels,before)
    def test_expected_results_not_aliased(self):
        p=gen.texture_pixels('texture2d');q=gen.queries('texture2d')[0];a=gen.oracle('texture2d','dynamic',q,p);a[0]=123
        self.assertNotEqual(a,gen.oracle('texture2d','dynamic',q,p))
    def test_offsets_before_clamp(self):
        q=dict(coordinate=[-2,2],offset=[7,-8],lod=0,layer=0)
        expected=[gen.bits(6+c/4) for c in range(4)]
        self.assertEqual(gen.oracle('texture2d','dynamic',q),expected)
        self.assertNotEqual(expected,[gen.bits(8+c/4) for c in range(4)])
    def test_layer_separate_from_offset(self):
        q=dict(coordinate=[2,1],offset=[1,-1],lod=1,layer=2)
        self.assertEqual(gen.oracle('texture2d_array','dynamic',q),[gen.bits(12004+c/4) for c in range(4)])
    def test_invalid_lod_and_layer_zero(self):
        for g in ['texture2d','texture2d_array','texture3d']:
            n=3 if g=='texture3d' else 2
            q=dict(coordinate=[0]*n,offset=[0]*n,lod=3,layer=0)
            self.assertEqual(gen.oracle(g,'dynamic',q),[0]*4)
        q=dict(coordinate=[0,0],offset=[0,0],lod=0,layer=3)
        self.assertEqual(gen.oracle('texture2d_array','dynamic',q),[0]*4)
    def test_default_lod_offset_ignored(self):
        q=dict(coordinate=[0,0],offset=[7,7],lod=3,layer=0)
        self.assertEqual(gen.oracle('texture2d','defaults',q),[gen.bits(1+c/4) for c in range(4)])
    def test_mixed_legacy_is_not_clamped(self):
        q=dict(coordinate=[-1,1],offset=[7,0],lod=0,layer=0)
        self.assertEqual(gen.oracle('texture2d','mixed',q),[gen.bits(17+c/4) for c in range(4)]+[0]*4)
    def test_payload_unique_and_exact(self):
        for g in ['texture2d','texture2d_array','texture3d']:
            values=[v for rgba in gen.texture_pixels(g).values() for v in rgba];self.assertEqual(len(values),len(set(values)))
    def test_query_bounds_and_coverage(self):
        for c in FIXTURES['cases']:
            self.assertLessEqual(len(c['queries']),128)
            self.assertEqual({q['lod'] for q in c['queries']},{0,1,2,3})
            self.assertEqual({q['layer'] for q in c['queries']},set(range(4)) if c['geometry']=='texture2d_array' else {0})
            self.assertTrue(all(-8<=x<=7 for q in c['queries'] for x in q['offset']))

class SourceContractTests(unittest.TestCase):
    def test_pinned_sources_and_profiles(self):
        pins=json.loads((ROOT/'source-pins.json').read_text());self.assertEqual(len(DESCRIPTORS),24)
        for d in DESCRIPTORS:
            sha=gate.digest(d['source'].encode());self.assertEqual(sha,pins[d['textureGeometry']+'/'+d['textureReadMode']]);self.assertEqual(sha,d['sourceSha256']);self.assertIn(sha,SWIFT)
            self.assertEqual((d['api'],d['ios'],d['metalVersion'],d['kind']),(3,27,410,1));self.assertIn(d['math'],[0,1])
            self.assertIn('[[id(1)]]',d['source']);self.assertIn('[[id(2)]]',d['source']);self.assertNotIn('[[texture(',d['source'])
    def test_portable_regeneration_is_byte_identical(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'source-pins.json').write_bytes((ROOT/'source-pins.json').read_bytes())
            with patch.object(gen,'ROOT',root),contextlib.redirect_stdout(io.StringIO()):gen.build(ROOT/'metal-texture-read-gpu-cases.json')
            for filename in ['metal-texture-read-gpu-cases.json','texture-read-oracle-fixtures.json','source-pins.json']:
                self.assertEqual((root/filename).read_bytes(),(ROOT/filename).read_bytes())
    def test_generator_rejects_changed_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'source-pins.json').write_bytes((ROOT/'source-pins.json').read_bytes());data=copy.deepcopy(DESCRIPTORS);data[0]['source']+='// changed'
            source=root/'input.json';source.write_text(json.dumps(data))
            with patch.object(gen,'ROOT',root),self.assertRaisesRegex(ValueError,'frozen pin'):gen.build(source)
    def test_no_machine_specific_source_path(self):
        self.assertEqual(gen.SOURCE,ROOT/'metal-texture-read-gpu-cases.json')
        self.assertNotIn('/workspace/',(ROOT/'make_texture_read_fixtures.py').read_text())
    def test_hash_pinned_oracle(self):
        sha=gate.digest((ROOT/'texture-read-oracle-fixtures.json').read_bytes());self.assertEqual(sha,gate.FIXTURE_SHA);self.assertIn(sha,SWIFT)
    def test_independent_encoders_and_residency(self):
        body=SWIFT.split('func runBackend(')[1].split('func main()')[0]
        for expected in ['function.makeArgumentEncoder(bufferIndex:0)','length:argumentEncoder.encodedLength','setTexture(image,index:1)','setSamplerState(sampler,index:2)','encoder.useResource(image,usage:.read)']:self.assertIn(expected,body)
    def test_int3_padding_and_all_bindings(self):
        self.assertIn('stride=width==3 ? 4 : width',SWIFT)
        for name,index in [('resources',0),('c',1),('o',2),('lod',3),('destination',4),('layer',5)]:self.assertIn(f'setBuffer({name},offset:0,index:{index})',SWIFT)
    def test_sampler_and_no_retarget(self):
        for axis in ['s','t','r']:self.assertIn(f'samplerDescriptor.{axis}AddressMode = .clampToEdge',SWIFT)
        self.assertIn('samplerDescriptor.supportArgumentBuffers=true',SWIFT);self.assertIn('samplerDescriptor.normalizedCoordinates=true',SWIFT)
        for forbidden in ['Process()', 'xcrun metal ', 'target air64-apple-macos', '.replaceSubrange(']:self.assertNotIn(forbidden,SWIFT)
        self.assertIn('device.makeLibrary(data:dispatchData)',SWIFT)
    def test_independent_outcomes_and_bounds(self):
        self.assertIn('for name in names { if let library=loaded[name]',SWIFT)
        for stage in ['libraryLoading','pipelineCreation','resourceSetup','execution','numericalComparison']:self.assertIn('"'+stage+'"',SWIFT)
        self.assertIn('return 77',SWIFT);self.assertIn('180 second total probe budget',SWIFT);self.assertIn('20 seconds',SWIFT)
    def test_raw_outputs_and_guards(self):
        for text in ['raw.append(wordsData(words))','guardIntact=guards.allSatisfy','"rawByteOffset":byteOffset','"sha256":hash(raw)','"pair-receipt.json"','"partialEvidence",true']:self.assertIn(text,SWIFT)
        self.assertIn('let passed=paired && results["apple"]?.pass==true && results["floor"]?.pass==true',SWIFT)

def synthetic_evidence(directory):
    """Clearly synthetic fixture for testing the checker; not runtime evidence."""
    d=next(x for x in DESCRIPTORS if x['textureGeometry']=='texture2d' and x['textureReadMode']=='mixed' and x['math']==0)
    fixture=next(x for x in FIXTURES['cases'] if x['geometry']=='texture2d' and x['mode']=='mixed');queries=fixture['queries'];n=len(queries)*8
    def save(name,obj): (directory/name).write_text(json.dumps(obj))
    binaries={name:directory/(name+'.metallib') for name in ['apple','floor']}
    for name,p in binaries.items():p.write_bytes(b'MTLB synthetic checker test only '+name.encode())
    receipt=dict(schemaVersion=1,api=3,ios=27,metalVersion=410,math=0,sourceSha256=d['sourceSha256'],**{name+'MetallibSha256':gate.digest(p.read_bytes()) for name,p in binaries.items()});save('pair-receipt.json',receipt)
    r=dict(schemaVersion=1,kind='msl41-texture-read',status='passed',pipelineCreation='passed',execution='completed',numericalComparison='passed',pairedComparison='passed',checkedValues=n*2,
        descriptor=dict(name=d['name'],entry=d['entry'],sourceSha256=d['sourceSha256'],ios=27,metalVersion=410,api=3,math=0,geometry='texture2d',mode='mixed'),
        oracle=dict(fixtureSha256=gate.FIXTURE_SHA,fixtureCrossCheck='passed',queries=len(queries),independentPythonEnumeration=True),pairReceiptHashMatched=True,pairReceiptSha256=gate.digest((directory/'pair-receipt.json').read_bytes()),artifacts=[],backends={})
    (directory/'source.metal').write_text(d['source'])
    payload=b''.join(struct.pack('<4I',*v) for v in gen.texture_pixels('texture2d').values())
    for name,p in binaries.items():
        r['artifacts'].append(dict(backend=name,sha256=gate.digest(p.read_bytes()),bytes=p.stat().st_size,loadedUnchanged=True))
        raw=b'';records=[]
        for i,q in enumerate(queries):
            records.append(dict(q,index=i,actualBits=q['expectedBits'],guardBits=[gate.GUARD]*4,guardIntact=True,pass_=True,rawByteOffset=len(raw)));records[-1]['pass']=records[-1].pop('pass_');raw+=struct.pack('<12I',*(q['expectedBits']+[gate.GUARD]*4))
        (directory/(name+'-output.bin')).write_bytes(raw);save(name+'-queries.json',records)
        r['backends'][name]=dict(libraryLoading=dict(status='loaded'),pipelineCreation=dict(status='passed',entry=d['entry']),resourceSetup=dict(status='passed'),execution=dict(status='completed',dispatches=len(queries)),numericalComparison=dict(status='passed',checkedValues=n),checkedValues=n,
            argumentBuffer=dict(textureID=1,samplerID=2,independentlyEncoded=True,encodedLength=16 if name=='apple' else 24,alignment=8),texturePayload=dict(sha256=gate.digest(payload),bytes=len(payload),pixelFormat='rgba32Float',mipLevels=3,baseDimensions=[8,4,1],arrayLayers=1),
            rawOutput=dict(file=name+'-output.bin',wordEndian='little',guardWordsPerQuery=4,sha256=gate.digest(raw),bytes=len(raw)))
    save('report.json',r);return r,binaries

class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name);self.report,self.binaries=synthetic_evidence(self.path)
    def tearDown(self):self.tmp.cleanup()
    def validate(self):return gate.validate_report(self.path,self.binaries['apple'],self.binaries['floor'])
    def write(self,r): (self.path/'report.json').write_text(json.dumps(r))
    def test_synthetic_valid_checker_fixture(self):self.assertEqual(self.validate()['checkedValues'],320)
    def test_stage_and_identity_mutations_rejected(self):
        mutations=[(['status'],'unavailable'),(['pairedComparison'],'not_run'),(['checkedValues'],0),(['pairReceiptHashMatched'],False),(['descriptor','math'],1),(['descriptor','sourceSha256'],'0'*64),(['oracle','queries'],1)]
        for name in ['apple','floor']:
            mutations += [(['backends',name,stage,'status'],'not_run') for stage in ['libraryLoading','pipelineCreation','resourceSetup','execution','numericalComparison']]
            mutations += [(['backends',name,'execution','dispatches'],1),(['backends',name,'argumentBuffer','textureID'],0),(['backends',name,'argumentBuffer','independentlyEncoded'],False),(['backends',name,'partialEvidence'],True),(['backends',name,'checkedValues'],0),(['backends',name,'texturePayload','sha256'],'0'*64)]
        for path,value in mutations:
            with self.subTest(path=path):
                r=copy.deepcopy(self.report);target=r
                for key in path[:-1]:target=target[key]
                target[path[-1]]=value;self.write(r)
                with self.assertRaises((ValueError,KeyError)):self.validate()
        self.write(self.report)
    def test_raw_hash_corruption_rejected(self):
        p=self.path/'floor-output.bin';data=bytearray(p.read_bytes());data[0]^=1;p.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'hash'):self.validate()
    def test_rehashed_wrong_values_rejected(self):
        p=self.path/'floor-output.bin';data=bytearray(p.read_bytes());data[0]^=1;p.write_bytes(data)
        self.report['backends']['floor']['rawOutput']['sha256']=gate.digest(data);self.write(self.report)
        with self.assertRaisesRegex(ValueError,'Numerical'):self.validate()
    def test_rehashed_guard_corruption_rejected(self):
        p=self.path/'floor-output.bin';data=bytearray(p.read_bytes());data[32]^=1;p.write_bytes(data)
        self.report['backends']['floor']['rawOutput']['sha256']=gate.digest(data);self.write(self.report)
        with self.assertRaisesRegex(ValueError,'Guard'):self.validate()
    def test_truncated_records_rejected(self):
        p=self.path/'apple-queries.json';rows=json.loads(p.read_text());p.write_text(json.dumps(rows[:-1]))
        with self.assertRaisesRegex(ValueError,'Incomplete query'):self.validate()
    def test_changed_original_library_rejected(self):
        self.binaries['apple'].write_bytes(b'MTLB changed')
        with self.assertRaisesRegex(ValueError,'library hash'):self.validate()
    def test_changed_source_evidence_rejected(self):
        (self.path/'source.metal').write_text('kernel void altered() {}')
        with self.assertRaisesRegex(ValueError,'Source evidence'):self.validate()
    def test_changed_query_coordinate_rejected(self):
        p=self.path/'floor-queries.json';rows=json.loads(p.read_text());rows[0]['coordinate']=[0,0];p.write_text(json.dumps(rows))
        with self.assertRaisesRegex(ValueError,'changed coordinate'):self.validate()

class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name);r,self.binaries=synthetic_evidence(self.path);self.case=r['descriptor']['name']
        self.item=dict(name='case-123',aliases=[self.case],sourceSha256=r['descriptor']['sourceSha256'],math=0,api=3,ios=27,appleMetalVersion=410,floorMetalVersion=410,appleCompile='passed',appleLink='passed',floorCompile='passed',**{n+'MetallibSha256':gate.digest(p.read_bytes()) for n,p in self.binaries.items()})
        self.report=dict(schemaVersion=2,mode='apple-reference-compile-link',cases=[self.item]);self.save()
    def tearDown(self):self.tmp.cleanup()
    def save(self):(self.path/'compile-report.json').write_text(json.dumps(self.report))
    def make(self):return receipt_maker.make_receipt(self.path/'compile-report.json',self.case,self.binaries['apple'],self.binaries['floor'],self.path/'source.metal')
    def test_verified_record(self):self.assertEqual(self.make()['compilerEvidence']['case'],'case-123')
    def test_incomplete_stages_rejected(self):
        for stage in ['appleCompile','appleLink','floorCompile']:
            self.item[stage]='unavailable';self.save()
            with self.assertRaisesRegex(ValueError,'Incomplete'):self.make()
            self.item[stage]='passed'
    def test_wrong_target_rejected(self):
        self.item['appleMetalVersion']=400;self.save()
        with self.assertRaisesRegex(ValueError,'target'):self.make()
    def test_changed_source_rejected(self):
        (self.path/'source.metal').write_text('altered')
        with self.assertRaisesRegex(ValueError,'source differs'):self.make()
    def test_changed_original_rejected(self):
        self.binaries['floor'].write_bytes(b'MTLB altered')
        with self.assertRaisesRegex(ValueError,'library differs'):self.make()
    def test_duplicate_record_rejected(self):
        self.report['cases'].append(copy.deepcopy(self.item));self.save()
        with self.assertRaisesRegex(ValueError,'ambiguous'):self.make()

if __name__=='__main__':unittest.main()
