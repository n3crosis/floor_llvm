#!/usr/bin/env python3
"""Strict evidence gate for a trusted standalone GPU harness invocation.

This validates recorded stages, both original artifact hashes, every expected
value, raw output bytes, guard words, and exact source/profile identity. A report
alone cannot authenticate which compiler produced an artifact; retain the paired
compile/link logs and original outputs with this evidence.
"""
import argparse, hashlib, json, struct
from pathlib import Path
from make_texture_read_fixtures import texture_pixels
ROOT=Path(__file__).resolve().parent
FIXTURE_SHA='ada170386aff9f8e4ff30840333ab74b647f4e80fc510ff3599ebe3a94bb9f62'
GUARD=0x7fc12345

def digest(data):return hashlib.sha256(data).hexdigest()
def require(ok,message):
    if not ok:raise ValueError(message)
def read(path,limit=1024*1024):
    path=Path(path);require(path.is_file() and 0<path.stat().st_size<=limit,f'Invalid bounded file: {path.name}')
    data=path.read_bytes();require(len(data)<=limit,f'File exceeded bound: {path.name}');return data

def validate_report(directory,apple,floor,descriptors=None,fixtures=None):
    directory=Path(directory)
    descriptors=Path(descriptors or ROOT/'metal-texture-read-gpu-cases.json')
    fixtures=Path(fixtures or ROOT/'texture-read-oracle-fixtures.json')
    r=json.loads(read(directory/'report.json'))
    require(r.get('schemaVersion')==1 and r.get('kind')=='msl41-texture-read','Wrong report schema/kind')
    for key,value in [('status','passed'),('pipelineCreation','passed'),('execution','completed'),('numericalComparison','passed'),('pairedComparison','passed')]:
        require(r.get(key)==value,f'Incomplete root stage: {key}')
    d=r['descriptor'];selected=[x for x in json.loads(read(descriptors)) if x['name']==d['name']]
    require(len(selected)==1,'Missing or ambiguous descriptor');source=selected[0]
    pins=json.loads(read(ROOT/'source-pins.json'))
    source_hash=digest(source['source'].encode());geometry=source['textureGeometry'];mode=source['textureReadMode']
    require(pins[geometry+'/'+mode]==source_hash==source['sourceSha256']==d['sourceSha256'],'Unpinned source')
    require(read(directory/'source.metal')==source['source'].encode(),'Source evidence differs')
    expected_descriptor=dict(name=source['name'],entry=source['entry'],sourceSha256=source_hash,ios=27,metalVersion=410,api=3,math=source['math'],geometry=geometry,mode=mode)
    require(d==expected_descriptor,'Descriptor identity differs')
    require(source['api']==3 and source['ios']==27 and source['metalVersion']==410 and source['kind']==1 and source['math'] in [0,1] and source['status']==0 and source['msl41TextureRead'] is True,'Wrong compile profile')
    fixture_bytes=read(fixtures);require(digest(fixture_bytes)==FIXTURE_SHA,'Unpinned fixtures')
    selected=[x for x in json.loads(fixture_bytes)['cases'] if x['geometry']==geometry and x['mode']==mode]
    require(len(selected)==1,'Missing fixture');queries=selected[0]['queries'];count=len(queries)
    require(r['oracle']==dict(fixtureSha256=FIXTURE_SHA,fixtureCrossCheck='passed',queries=count,independentPythonEnumeration=True),'Oracle evidence mismatch')
    receipt_bytes=read(directory/'pair-receipt.json',16384);receipt=json.loads(receipt_bytes)
    require(r['pairReceiptHashMatched'] is True and r['pairReceiptSha256']==digest(receipt_bytes),'Receipt hash mismatch')
    for key,value in dict(schemaVersion=1,api=3,ios=27,metalVersion=410,math=source['math'],sourceSha256=source_hash).items():require(receipt.get(key)==value,f'Receipt {key} mismatch')
    artifacts=r['artifacts'];require(len(artifacts)==2 and {a['backend'] for a in artifacts}=={'apple','floor'},'Artifact pair missing/duplicated')
    active=8 if mode=='mixed' else 4;expected_count=count*active
    require(r['checkedValues']==expected_count*2,'Wrong total checked values')
    require(set(r['backends'])=={'apple','floor'},'Backend pair missing')
    pixels=texture_pixels(geometry);payload=b''.join(struct.pack('<4I',*value) for value in pixels.values())
    paired=[]
    for name,path in [('apple',apple),('floor',floor)]:
        artifact=next(a for a in artifacts if a['backend']==name);binary=read(path,32*1024*1024)
        require(binary.startswith(b'MTLB') and digest(binary)==artifact['sha256']==receipt[name+'MetallibSha256'],'Original library hash mismatch')
        require(artifact['bytes']==len(binary) and artifact['loadedUnchanged'] is True,'Artifact size/original-byte evidence mismatch')
        b=r['backends'][name]
        for stage,status in [('libraryLoading','loaded'),('pipelineCreation','passed'),('resourceSetup','passed'),('execution','completed'),('numericalComparison','passed')]:
            require(b.get(stage,{}).get('status')==status,f'{name} incomplete {stage}')
        require(not b.get('partialEvidence') and not b.get('error') and not b.get('evidenceWriteError'),f'{name} partial/failed evidence')
        require(b['pipelineCreation']['entry']==source['entry'],'Wrong pipeline entry')
        require(b['execution']['dispatches']==count,'Incomplete dispatches')
        require(b['checkedValues']==expected_count==b['numericalComparison']['checkedValues'],'Wrong backend count')
        ab=b['argumentBuffer'];require(ab['textureID']==1 and ab['samplerID']==2 and ab['independentlyEncoded'] is True and 16<=ab['encodedLength']<=4096 and ab['alignment']>0,'Argument-buffer contract mismatch')
        expected_texture=dict(sha256=digest(payload),bytes=len(payload),pixelFormat='rgba32Float',mipLevels=3,baseDimensions=[8,4,4 if geometry=='texture3d' else 1],arrayLayers=3 if geometry=='texture2d_array' else 1)
        require(b['texturePayload']==expected_texture,'Wrong deterministic texture payload')
        raw_info=b['rawOutput'];require(raw_info['file']==name+'-output.bin' and raw_info['wordEndian']=='little' and raw_info['guardWordsPerQuery']==4,'Raw output identity mismatch')
        raw=read(directory/(name+'-output.bin'));require(len(raw)==count*(active+4)*4==raw_info['bytes'] and digest(raw)==raw_info['sha256'],'Raw output size/hash mismatch')
        records=json.loads(read(directory/(name+'-queries.json')));require(len(records)==count,'Incomplete query records')
        outputs=[]
        for i,(q,record) in enumerate(zip(queries,records)):
            offset=i*(active+4)*4;words=list(struct.unpack_from('<'+'I'*(active+4),raw,offset));actual=words[:active];guards=words[active:]
            for key in ['label','coordinate','offset','lod','layer','expectedBits']:require(record[key]==q[key],f'Query {i} changed {key}')
            require(record['index']==i and record['rawByteOffset']==offset,'Raw query range mismatch')
            require(record['actualBits']==actual==q['expectedBits'],'Numerical output mismatch')
            require(record['guardBits']==guards==[GUARD]*4 and record['guardIntact'] is True and record['pass'] is True,'Guard corruption or failed query')
            outputs.append(actual)
        paired.append(outputs)
    require(paired[0]==paired[1],'Paired outputs differ')
    return dict(status='passed',case=source['name'],checkedValues=expected_count*2,queriesPerBackend=count)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('directory');p.add_argument('--apple',required=True);p.add_argument('--floor',required=True);p.add_argument('--descriptors');p.add_argument('--fixtures');a=p.parse_args()
    try:print(json.dumps(validate_report(a.directory,a.apple,a.floor,a.descriptors,a.fixtures),sort_keys=True))
    except (ValueError,KeyError,TypeError,OSError,StopIteration) as error:p.exit(1,f'GPU evidence rejected: {error}\n')
if __name__=='__main__':main()
