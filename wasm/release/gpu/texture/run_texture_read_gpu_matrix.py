#!/usr/bin/env python3
"""Post-process original paired compiler outputs; never compile or retarget.
Exit 0: all 24 verified; 1: failure/timeout; 2: missing/blocked evidence;
77: only passed/unavailable cases, with at least one unavailable case.
"""
import argparse,hashlib,json,os,re,selectors,signal,subprocess,time
from pathlib import Path
from make_texture_read_pair_receipt import make_receipt
from verify_texture_read_report import ROOT,FIXTURE_SHA,digest,read,require,validate_report
SWIFT_SHA='eafb0ed0cc917d3f5c35da981108325d7d6b8e85961791a68a8c3f1e7c2fa668'
LOG_LIMIT=256*1024

def save(path,value):
    data=(json.dumps(value,indent=2,sort_keys=True)+'\n').encode();temporary=path.with_suffix(path.suffix+'.tmp');temporary.write_bytes(data);temporary.replace(path)

def execute(command,directory,timeout):
    """Drain both streams without unbounded buffers; kill the process group on timeout."""
    started=time.monotonic();captured={'stdout':bytearray(),'stderr':bytearray()};totals=dict(stdout=0,stderr=0)
    result=dict(command=command,timeoutSeconds=timeout,timedOut=False,exitStatus=None)
    process=None;selector=selectors.DefaultSelector()
    try:
        process=subprocess.Popen(command,cwd=directory,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        for name,stream in [('stdout',process.stdout),('stderr',process.stderr)]:
            os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,name)
        deadline=started+timeout;kill_deadline=None
        while selector.get_map() or process.poll() is None:
            now=time.monotonic()
            if now>=deadline and not result['timedOut']:
                result['timedOut']=True;kill_deadline=now+2
                try:os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError:pass
            if kill_deadline is not None and now>=kill_deadline:break
            for key,_ in selector.select(0.05):
                try:chunk=os.read(key.fileobj.fileno(),65536)
                except BlockingIOError:continue
                if not chunk:selector.unregister(key.fileobj);key.fileobj.close();continue
                name=key.data;totals[name]+=len(chunk);captured[name].extend(chunk[:max(0,LOG_LIMIT-len(captured[name]))])
        try:result['exitStatus']=process.wait(timeout=2)
        except subprocess.TimeoutExpired:result['terminationUncertain']=True
    except (OSError,ValueError) as error:result['error']=str(error)
    finally:
        # Setup/read/selector errors must not orphan a live harness outside its budget.
        if process is not None and (process.poll() is None or result.get('error')):
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            except OSError as error:result['cleanupError']=str(error)
            try:result['exitStatus']=process.wait(timeout=2)
            except subprocess.TimeoutExpired:result['terminationUncertain']=True
        for key in list(selector.get_map().values()):key.fileobj.close()
        selector.close()
        if process is not None:
            for stream in [process.stdout,process.stderr]:
                if stream and not stream.closed:stream.close()
        result['elapsedSeconds']=round(time.monotonic()-started,4)
        for name,data in captured.items():
            filename=name+'.log';(directory/filename).write_bytes(data)
            result[name]=dict(file=filename,sha256=digest(data),capturedBytes=len(data),totalBytes=totals[name],truncated=totals[name]>len(data))
    return result

def descriptors():
    path=ROOT/'metal-texture-read-gpu-cases.json';cases=json.loads(read(path));pins=json.loads(read(ROOT/'source-pins.json'))
    expected={(g,m,math) for g in ['texture2d','texture2d_array','texture3d'] for m in ['dynamic','defaults','boundaries','mixed'] for math in [0,1]}
    require(len(cases)==24 and {(c['textureGeometry'],c['textureReadMode'],c['math']) for c in cases}==expected,'Exact 24-case descriptor matrix missing')
    require(len({c['name'] for c in cases})==24,'Duplicate descriptor names')
    for c in cases:
        g,m=c['textureGeometry'],c['textureReadMode'];sha=digest(c['source'].encode())
        require(sha==c['sourceSha256']==pins[g+'/'+m],'Unpinned descriptor source')
        require(c['name']==f"msl41-sampler-read-{g}-{m}-math{c['math']}-kind1" and c['entry']==f'msl41_read_{g}_{m}','Wrong descriptor identity')
        require((c['api'],c['ios'],c['metalVersion'],c['kind'],c['status'])==(3,27,410,1,0) and c['msl41TextureRead'] is True,'Wrong descriptor profile')
    return cases

def summarize(report):
    counts={key:sum(c['status']==key for c in report['cases']) for key in ['passed','failed','timeout','unavailable','blocked','missing','pending']}
    report['counts']=counts;report['all24Verified']=len(report['cases'])==24 and counts['passed']==24
    if report.get('fatalError') or counts['failed'] or counts['timeout']:status,code='failed',1
    elif counts['blocked'] or counts['missing'] or counts['pending']:status,code='incomplete',2
    elif counts['unavailable']:status,code='unavailable',77
    elif report['all24Verified']:status,code='passed',0
    else:status,code='failed',1
    report['status']=status;report['exitCode']=code;return code

def pending_gpu(report):
    if not isinstance(report,dict):return False
    for backend in (report.get('backends') or {}).values():
        if not isinstance(backend,dict):continue
        execution=backend.get('execution') or {}
        if not isinstance(execution,dict):continue
        if execution.get('status') in ['timed_out','timeout','incomplete']:return True
        # The frozen Swift harness records its semaphore timeout as failed.
        if 'GPU command completion exceeded' in str(execution.get('error','')):return True
    return False

def inspect_result(item,evidence,process,descriptor,apple,floor,receipt):
    """Preserve all parseable reports, but only strict successful evidence can pass."""
    raw_report=None
    try:
        data=read(evidence/'report.json');item['reportSha256']=digest(data);raw_report=json.loads(data);item['details']=raw_report
    except (ValueError,OSError) as error:item['reportError']=str(error)
    if pending_gpu(raw_report):item['gpuTerminationUncertain']=True
    if process['timedOut']:item.update(status='timeout',reason='GPU subprocess exceeded its time budget');return
    if process.get('error') or process.get('terminationUncertain'):item.update(status='failed',reason=process.get('error','Process termination uncertain'));return
    code=process['exitStatus']
    if code not in [0,1,77]:item.update(status='failed',reason=f'Harness terminated with unexpected exit status {code}');return
    if raw_report is None:item.update(status='missing' if code==0 else 'failed',reason=f'Harness exited {code} without a readable report');return
    try:
        require(isinstance(raw_report,dict),'Report is not an object')
        require(raw_report.get('schemaVersion')==1 and raw_report.get('kind')=='msl41-texture-read','Wrong GPU report schema')
        require(code in [0,1,77],'Unexpected process exit status')
        require(raw_report.get('status')=={0:'passed',1:'failed',77:'unavailable'}[code],'Process exit/report status disagreement')
        if code==0:
            checked=validate_report(evidence,apple,floor)
            require(checked['case']==descriptor['name'],'Verifier selected a different case')
            require(read(evidence/'pair-receipt.json',16384)==read(receipt,16384),'Harness receipt differs from orchestration receipt')
            item.update(status='passed',reportVerified=True,verification=checked)
        elif code==77:
            for backend in (raw_report.get('backends') or {}).values():
                require(isinstance(backend,dict),'Malformed unavailable backend')
                for stage in ['pipelineCreation','resourceSetup','execution','numericalComparison']:
                    outcome=backend.get(stage) or {}
                    require(isinstance(outcome,dict),'Malformed unavailable stage')
                    require(outcome.get('status') not in ['failed','timed_out','timeout','incomplete'],'Observed backend failure mislabeled unavailable')
            require((raw_report.get('backends',{}).get('apple',{}).get('libraryLoading',{}).get('status'))!='loaded','Loaded Apple reference cannot be unavailable')
            identity=raw_report.get('descriptor',{})
            require(identity.get('name')==descriptor['name'] and identity.get('sourceSha256')==descriptor['sourceSha256'] and identity.get('math')==descriptor['math'],'Unavailable report identity differs')
            artifacts=raw_report.get('artifacts',[]);pair=json.loads(read(receipt,16384))
            require(len(artifacts)==2 and [a.get('backend') for a in artifacts]==['apple','floor'],'Unavailable report pair differs')
            require([a.get('sha256') for a in artifacts]==[pair['appleMetallibSha256'],pair['floorMetallibSha256']],'Unavailable artifact hashes differ')
            item.update(status='unavailable',reason=raw_report.get('reason','Original target unavailable'),reportVerified=False)
        else:item.update(status='failed',reason=raw_report.get('error',raw_report.get('reason','Harness reported failure')))
    except (ValueError,KeyError,TypeError,OSError,StopIteration) as error:item.update(status='failed',reason='Evidence rejected: '+str(error),reportVerified=False)

def run_matrix(compile_dir,harness,output,case_timeout=240,matrix_timeout=1800):
    compile_dir=Path(compile_dir).resolve();harness=Path(harness).resolve();output=Path(output).resolve()
    require(1<=case_timeout<=300 and 1<=matrix_timeout<=7200,'Timeout outside supported bounds')
    output.mkdir(parents=True,exist_ok=False) # Never overwrite or reuse prior evidence.
    cases=descriptors();started=time.monotonic()
    report=dict(schemaVersion=1,kind='msl41-texture-read-gpu-matrix',expectedCases=24,compileDirectory=str(compile_dir),harness=str(harness),frozenSwiftSha256=SWIFT_SHA,caseTimeoutSeconds=case_timeout,matrixTimeoutSeconds=matrix_timeout,cases=[dict(name=c['name'],sourceSha256=c['sourceSha256'],math=c['math'],status='pending',reportVerified=False) for c in cases])
    def checkpoint():summarize(report);report['elapsedSeconds']=round(time.monotonic()-started,4);save(output/'matrix-report.json',report)
    checkpoint()
    try:
        require(digest(read(ROOT/'metal-texture-read-numerical.swift'))==SWIFT_SHA,'Frozen Swift source changed')
        require(digest(read(ROOT/'texture-read-oracle-fixtures.json'))==FIXTURE_SHA,'Frozen oracle fixture changed')
        report['descriptorSha256']=digest(read(ROOT/'metal-texture-read-gpu-cases.json'));report['fixtureSha256']=FIXTURE_SHA
        source_report=compile_dir/'report.json'
        if not source_report.is_file():raise FileNotFoundError('Compiler report.json is missing')
        source_bytes=read(source_report,32*1024*1024);compiler=json.loads(source_bytes)
        require(compiler.get('schemaVersion')==2 and compiler.get('mode')=='apple-reference-compile-link' and isinstance(compiler.get('cases'),list),'Invalid compiler report schema')
        snapshot=output/'compile-report-input.json';snapshot.write_bytes(source_bytes);report['compileReportSha256']=digest(source_bytes);report['upstreamStatus']=compiler.get('status','unspecified')
    except (ValueError,TypeError,AttributeError,OSError) as error:
        state='missing' if isinstance(error,FileNotFoundError) else 'blocked'
        report['setupError' if state=='missing' else 'fatalError']=str(error)
        for item in report['cases']:item.update(status=state,reason=str(error))
        checkpoint();return report
    harness_error=None
    try:
        report['harnessSha256']=digest(read(harness,128*1024*1024));require(os.access(harness,os.X_OK),'Harness is not executable')
    except (ValueError,OSError) as error:harness_error=str(error)
    pending_work=False
    for index,(descriptor,item) in enumerate(zip(cases,report['cases'])):
        directory=output/f'case-{index:02d}';directory.mkdir();item['evidenceDirectory']=directory.name
        try:
            rows=[r for r in compiler['cases'] if isinstance(r,dict) and isinstance(r.get('aliases'),list) and descriptor['name'] in r['aliases']]
            if not rows:item.update(status='missing',reason='Exact descriptor alias absent from compiler report');continue
            require(len(rows)==1,'Duplicate compiler records for descriptor alias');row=rows[0]
            require(row.get('sourceSha256')==descriptor['sourceSha256'] and row.get('math')==descriptor['math'],'Alias has different source hash or math profile')
            require(isinstance(row.get('name'),str) and re.fullmatch(r'case-\d+',row['name']) is not None,'Invalid compiler case basename')
            item['compileCase']=row['name'];item['compileStages']={s:row.get(s,'missing') for s in ['appleCompile','appleLink','floorCompile']}
            if any(s!='passed' for s in item['compileStages'].values()):item.update(status='blocked',reason='Successful original paired compiler stages required');continue
            apple=compile_dir/(row['name']+'.apple.metallib');floor=compile_dir/(row['name']+'.floor.metallib');source=compile_dir/(row['name']+'.metal')
            if any(not p.is_file() for p in [apple,floor,source]):item.update(status='missing',reason='Original source or paired library file absent');continue
            pair=make_receipt(snapshot,descriptor['name'],apple,floor,source);receipt=directory/'pair.json';save(receipt,pair);item['receiptSha256']=digest(read(receipt,16384))
            if pending_work:item.update(status='blocked',reason='Earlier GPU timeout or uncertain termination may leave work pending');continue
            if harness_error:item.update(status='blocked',reason=harness_error);continue
            remaining=matrix_timeout-(time.monotonic()-started)
            if remaining<=0:item.update(status='blocked',reason='Matrix time budget exhausted before this case');continue
            evidence=directory/'gpu'
            command=[str(harness),'--apple',str(apple),'--floor',str(floor),'--descriptors',str(ROOT/'metal-texture-read-gpu-cases.json'),'--case',descriptor['name'],'--pair-receipt',str(receipt),'--oracle-fixtures',str(ROOT/'texture-read-oracle-fixtures.json'),'--output',str(evidence)]
            process=execute(command,directory,min(case_timeout,remaining));item['process']=process
            if process.get('timedOut') or process.get('terminationUncertain'):pending_work=True
            inspect_result(item,evidence,process,descriptor,apple,floor,receipt)
        except (ValueError,KeyError,TypeError,AttributeError,OSError) as error:item.update(status='failed',reason=str(error))
        finally:
            if item.get('gpuTerminationUncertain'):pending_work=True
            checkpoint()
    checkpoint();return report

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--compile-dir',required=True);p.add_argument('--harness',required=True);p.add_argument('--output',required=True);p.add_argument('--case-timeout',type=float,default=240);p.add_argument('--matrix-timeout',type=float,default=1800);a=p.parse_args()
    try:r=run_matrix(a.compile_dir,a.harness,a.output,a.case_timeout,a.matrix_timeout)
    except (ValueError,KeyError,TypeError,OSError) as error:p.exit(1,f'Matrix setup failed: {error}\n')
    print(json.dumps({k:r[k] for k in ['status','exitCode','counts','all24Verified']},sort_keys=True));p.exit(r['exitCode'])
if __name__=='__main__':main()
