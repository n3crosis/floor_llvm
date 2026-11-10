#!/usr/bin/env python3
"""Authored Apple acceptance/ABI reference; not FLOOR or GPU evidence."""
import hashlib,json,pathlib,subprocess,sys
root=pathlib.Path(__file__).resolve().parent
source=root/'msl41-atomic-reference.metal'
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else root/'apple-results');out.mkdir(parents=True,exist_ok=True)
result={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scope':'Apple source acceptance and AIR only; no FLOOR or GPU claims','cases':[]}
shapes=[('device','add'),('device','min'),('threadgroup','add'),('threadgroup','min'),('threadgroup','max')]
cases=[]
for space,op in shapes:
  for order in ['relaxed','acquire','release','acq_rel','seq_cst']:
    for explicit in [False,True]:
      cases.append((f'{space}-{op}-{order}-{int(explicit)}', '4.1',27,space,op,f'memory_order_{order}',f'mem_flags::mem_{space}',explicit,False))
for space in ['device','threadgroup']:
  for flag in ['mem_none','mem_device','mem_threadgroup','mem_texture','mem_threadgroup_imageblock','mem_object_data']:
    cases.append((f'{space}-flags-{flag}','4.1',27,space,'add','memory_order_acq_rel',f'mem_flags::{flag}',True,False))
  for name,order,flags in [('combined','memory_order_acq_rel','mem_flags(31)'),('bad-order','memory_order(1)','mem_flags::mem_device'),('bad-flags','memory_order_acq_rel','mem_flags(32)'),('dynamic-order','memory_order(input[0])','mem_flags::mem_device'),('dynamic-flags','memory_order_acq_rel','mem_flags(input[0])')]:
    cases.append((f'{space}-{name}','4.1',27,space,'add',order,flags,True,False))
  cases.append((f'{space}-volatile','4.1',27,space,'add','memory_order_acq_rel',f'mem_flags::mem_{space}',True,True))
for version,ios in [('3.2',18),('4.0',26)]:
  for space in ['device','threadgroup']:
    for label,order,explicit in [('legacy-relaxed','memory_order_relaxed',False),('ordered','memory_order_acquire',False),('new-overload','memory_order_relaxed',True)]:
      cases.append((f'metal{version}-{space}-{label}',version,ios,space,'add',order,f'mem_flags::mem_{space}',explicit,False))
for name,version,ios,space,op,order,flags,explicit,vol in cases:
  defines={'OP':op,'SPACE':space,'ORDER':order,'FLAGS':flags,'EXPLICIT_FLAGS':int(explicit),'VOLATILE':'volatile' if vol else '', 'OBJECT_BINDING':'buffer(0)' if space=='device' else 'threadgroup(0)'}
  command=['xcrun','-sdk','iphoneos','metal','-target',f'air64-apple-ios{ios}.0',f'-std=metal{version}','-fno-fast-math','-S','-emit-llvm',*[f'-D{k}={v}' for k,v in defines.items()],str(source),'-o',str(out/(name+'.ll'))]
  try: p=subprocess.run(command,capture_output=True,text=True)
  except FileNotFoundError as e: result['unavailable']=str(e);break
  (out/(name+'.diagnostics.txt')).write_text(p.stdout+p.stderr)
  result['cases'].append({'name':name,'metalVersion':version,'ios':ios,'space':space,'op':op,'order':order,'flags':flags,'explicitFlags':explicit,'volatile':vol,'returncode':p.returncode,'command':command})
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n')
