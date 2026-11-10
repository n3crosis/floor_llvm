#!/usr/bin/env python3
"""Generate independent CPU input/oracle fixtures; does not run Swift or GPU code."""
from pathlib import Path
import argparse,hashlib,itertools,json,struct
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/'metal-texture-read-gpu-cases.json'

def bits(x):return struct.unpack('<I',struct.pack('<f',x))[0]
def extent(geometry,lod):
    return [max(1,8>>lod),max(1,4>>lod)]+([max(1,4>>lod)] if geometry=='texture3d' else [])
def texture_pixels(geometry):
    pixels={}
    for lod in range(3):
        dims=extent(geometry,lod);depth=dims[2] if len(dims)==3 else 1
        for layer in range(3 if geometry=='texture2d_array' else 1):
            for z,y,x in itertools.product(range(depth),range(dims[1]),range(dims[0])):
                pixels[lod,layer,z,y,x]=[bits(1+10000*lod+1000*layer+100*z+10*y+x+c/4) for c in range(4)]
    return pixels

def queries(geometry):
    n=3 if geometry=='texture3d' else 2
    def v(x,y,z):return [x,y,z][:n]
    base=[('inside',v(2,1,1),v(0,0,0),0),('low',v(-1,-1,-1),v(0,0,0),0),
          ('high',v(8,4,4),v(0,0,0),0),('cross-before-clamp',v(-2,2,-1),v(7,-8,7),0),
          ('reverse-before-clamp',v(7,3,3),v(-8,7,-8),0),('offset-minus8',v(0,0,0),v(-8,-8,-8),0),
          ('offset-plus7',v(0,0,0),v(7,7,7),0),('cancel-negative',v(-7,-7,-7),v(7,7,7),0),
          ('cancel-upper',v(8,4,4),v(-8,-8,-8),0),('distinct-axis-offsets',v(2,1,1),v(1,-1,1),0)]
    for lod in range(3):
        dims=extent(geometry,lod)
        base += [(f'mip{lod}-last',[d-1 for d in dims],[0]*n,lod),
                 (f'mip{lod}-outside',dims,[0]*n,lod),
                 (f'mip{lod}-offset',[0]*n,v(7,-8,1),lod)]
    base.append(('invalid-lod',v(-1,1,1),v(7,0,0),3))
    out=[]
    for layer in range(4 if geometry=='texture2d_array' else 1):
        for label,q,o,lod in base:out.append(dict(label=label+f'-layer{layer}',coordinate=q,offset=o,lod=lod,layer=layer))
    return out

def oracle(geometry,mode,query,pixels=None):
    pixels=pixels or texture_pixels(geometry);n=3 if geometry=='texture3d' else 2
    lod=0 if mode=='defaults' else query['lod'];layer=query['layer'] if geometry=='texture2d_array' else 0
    coordinate=([-2,4,-1][:n] if mode=='boundaries' else query['coordinate'])
    offset=([0]*n if mode=='defaults' else [-8,7,1][:n] if mode=='boundaries' else query['offset'])
    def sample(q,clamp):
        # Select from an enumerated texel map rather than infer a linear offset.
        if lod not in range(3) or layer not in range(3 if geometry=='texture2d_array' else 1):return [0]*4
        dims=extent(geometry,lod);effective=[]
        for value,limit in zip(q,dims):
            if clamp:
                selected=next((x for x in range(limit) if x>=value),limit-1)
            else:
                if value not in range(limit):return [0]*4
                selected=value
            effective.append(selected)
        x,y=effective[:2];z=effective[2] if n==3 else 0
        return list(pixels[lod,layer,z,y,x])
    result=sample([a+b for a,b in zip(coordinate,offset)],True)
    if mode=='mixed':result+=sample(query['coordinate'],False)
    return result

def build(source=None):
    descriptors=json.loads(Path(source or SOURCE).read_text());assert len(descriptors)==24
    frozen_pins=json.loads((ROOT/'source-pins.json').read_text())
    expected={(g,m,math) for g in ['texture2d','texture2d_array','texture3d'] for m in ['dynamic','defaults','boundaries','mixed'] for math in [0,1]}
    assert {(d['textureGeometry'],d['textureReadMode'],d['math']) for d in descriptors}==expected
    assert len({d['name'] for d in descriptors})==24
    for d in descriptors:
        assert d['api']==3 and d['ios']==27 and d['metalVersion']==410 and d['status']==0
        assert '[[id(1)]]' in d['source'] and '[[id(2)]]' in d['source'] and '[[texture(' not in d['source']
        sha=hashlib.sha256(d['source'].encode()).hexdigest()
        if sha!=frozen_pins[d['textureGeometry']+'/'+d['textureReadMode']]:raise ValueError('Source does not match frozen pin')
        if d.get('sourceSha256',sha)!=sha:raise ValueError('Descriptor source hash mismatch')
        d['sourceSha256']=sha
        d['entry']=f"msl41_read_{d['textureGeometry']}_{d['textureReadMode']}"
    payload={'schemaVersion':1,'pixelFormat':'rgba32Float','mipLevels':3,'arrayLayers':3,
             'baseDimensions':[8,4,4],'payload':'1 + 10000*lod + 1000*layer + 100*z + 10*y + x + channel/4',
             'cases':[]}
    for geometry in ['texture2d','texture2d_array','texture3d']:
        pixels=texture_pixels(geometry)
        for mode in ['dynamic','defaults','boundaries','mixed']:
            rows=queries(geometry)
            for q in rows:q['expectedBits']=oracle(geometry,mode,q,pixels)
            payload['cases'].append(dict(geometry=geometry,mode=mode,queries=rows))
    (ROOT/'metal-texture-read-gpu-cases.json').write_text(json.dumps(descriptors,indent=2)+'\n')
    (ROOT/'texture-read-oracle-fixtures.json').write_text(json.dumps(payload,indent=2)+'\n')
    pins={}
    for d in descriptors:pins[d['textureGeometry']+'/'+d['textureReadMode']]=d['sourceSha256']
    (ROOT/'source-pins.json').write_text(json.dumps(pins,indent=2,sort_keys=True)+'\n')
    print('Descriptors24; oracle cases12; queries',sum(len(c['queries']) for c in payload['cases']))
    print('Oracle SHA256',hashlib.sha256((ROOT/'texture-read-oracle-fixtures.json').read_bytes()).hexdigest())
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=SOURCE,help='Exact descriptor matrix; defaults to the bundled module-relative matrix')
    build(parser.parse_args().source)
