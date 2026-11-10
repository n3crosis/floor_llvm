#!/usr/bin/env python3
"""Authored Apple reference discovery only; does not establish FLOOR support."""
import hashlib, json, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent
source=root/'msl41-barrier-reference.metal'
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else root/'apple-results');out.mkdir(exist_ok=True,parents=True)
results={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scope':'Apple compiler acceptance and IR only; no FLOOR or GPU claims','status':'observing','cases':[]}
selections=[('4.1',27,p) for p in range(24)]+[(version,ios,p) for version,ios in [('3.2',18),('4.0',26)] for p in [0,1,4,8,11,23]]
for version,ios,probe in selections:
    name=f'metal{version}-probe-{probe:02}'
    command=['xcrun','-sdk','iphoneos','metal','-target',f'air64-apple-ios{ios}.0',f'-std=metal{version}','-fno-fast-math','-S','-emit-llvm',f'-DPROBE={probe}',str(source),'-o',str(out/(name+'.ll'))]
    try: p=subprocess.run(command,capture_output=True,text=True,timeout=30)
    except (FileNotFoundError,subprocess.TimeoutExpired) as e:
        results['status']='unavailable' if isinstance(e,FileNotFoundError) else 'failed'
        results['error']=str(e);break
    (out/(name+'.diagnostics.txt')).write_text(p.stdout+p.stderr)
    results['cases'].append({'metalVersion':version,'ios':ios,'probe':probe,'returncode':p.returncode,'command':command})
if results['status']=='observing': results['status']='observed'
(out/'results.json').write_text(json.dumps(results,indent=2)+'\n')
sys.exit(77 if results['status']=='unavailable' else 1 if results['status']=='failed' else 0)
