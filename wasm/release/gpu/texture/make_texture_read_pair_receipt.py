#!/usr/bin/env python3
"""Bind an actual apple-reference.mjs compile/link record to original libraries.
Does not compile, rewrite, retarget, or run any artifact. It rejects missing
compile/link evidence, mismatched source/profile, and changed original bytes.
"""
import argparse,json,re
from pathlib import Path
from verify_texture_read_report import ROOT,digest,read,require

def make_receipt(report_path,case_name,apple,floor,source_path,descriptors=None):
    descriptors=descriptors or ROOT/'metal-texture-read-gpu-cases.json'
    chosen=[c for c in json.loads(read(descriptors)) if c['name']==case_name]
    require(len(chosen)==1,'Descriptor missing or duplicated');d=chosen[0]
    require(d['kind']==1 and d['api']==3 and d['ios']==27 and d['metalVersion']==410 and d['math'] in [0,1],'Wrong descriptor profile')
    sha=digest(d['source'].encode());pins=json.loads(read(ROOT/'source-pins.json'))
    require(d['sourceSha256']==sha==pins[d['textureGeometry']+'/'+d['textureReadMode']],'Source not pinned')
    require(read(source_path)==d['source'].encode(),'Actual compiler source differs from descriptor')
    report_bytes=read(report_path,32*1024*1024);report=json.loads(report_bytes)
    require(report.get('schemaVersion')==2 and report.get('mode')=='apple-reference-compile-link','Wrong compiler report schema')
    matches=[c for c in report['cases'] if case_name in c.get('aliases',[]) and c.get('sourceSha256')==sha and c.get('math')==d['math']]
    require(len(matches)==1,'Paired compiler record missing or ambiguous');c=matches[0]
    require(re.fullmatch(r'case-\d+',c['name']) is not None,'Unexpected compiler case identity')
    for k,v in dict(api=3,ios=27,appleMetalVersion=410,floorMetalVersion=410).items():require(c.get(k)==v,f'Wrong recorded target: {k}')
    for stage in ['appleCompile','appleLink','floorCompile']:require(c.get(stage)=='passed',f'Incomplete compiler stage: {stage}')
    receipt=dict(schemaVersion=1,api=3,ios=27,metalVersion=410,math=d['math'],sourceSha256=sha,
                 compilerEvidence=dict(reportSha256=digest(report_bytes),case=c['name'],caseAlias=case_name))
    for name,path in [('apple',apple),('floor',floor)]:
        binary=read(path,32*1024*1024);h=digest(binary)
        require(binary.startswith(b'MTLB') and c.get(name+'MetallibSha256')==h,'Original library differs from compile record')
        receipt[name+'MetallibSha256']=h
    return receipt

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['compile-report','case','apple','floor','source','output']:p.add_argument('--'+key,required=True)
    p.add_argument('--descriptors');a=p.parse_args()
    try:
        receipt=make_receipt(a.compile_report,a.case,a.apple,a.floor,a.source,a.descriptors)
        with open(a.output,'x') as f:json.dump(receipt,f,indent=2,sort_keys=True);f.write('\n')
        print('Wrote verified original-library receipt:',a.output)
    except (ValueError,KeyError,TypeError,OSError) as e:p.exit(1,f'Receipt rejected: {e}\n')
if __name__=='__main__':main()
