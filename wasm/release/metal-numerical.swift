// Optional GPU evidence only. Never retargets or rewrites either input metallib.
// Build: xcrun swiftc metal-numerical.swift -framework Metal -o metal-numerical
// Run: metal-numerical --apple A.metallib --floor F.metallib
//      --kind integer|derivative [--mode dynamic|constants] --output DIRECTORY
// Exit 0 = numerical pass, 1 = failure, 77 = unavailable (never a pass).
import Foundation
import Metal
import CryptoKit

struct ProbeError: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}
let args = CommandLine.arguments
func option(_ key: String) throws -> String {
    guard let i = args.firstIndex(of: key), i + 1 < args.count else { throw ProbeError("Missing \(key)") }
    return args[i + 1]
}
// Apple success establishes compatibility of this same-source, same-target pair.
func libraryLoadExitCode(appleLoaded: Bool, floorLoaded: Bool) -> Int32 {
    if !appleLoaded { return 77 }
    return floorLoaded ? 0 : 1
}
func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func save(_ object: Any, _ url: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
}
var report: [String: Any] = ["schema": 1, "status": "not_run", "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "device": NSNull(), "libraryLoading": [:], "pipelineCreation": "not_run", "execution": "not_run", "numericalComparison": "not_run",
    "targetPolicy": "Load original libraries unchanged; no macOS retargeting. A loader rejection may be platform incompatibility, not a numerical failure."]
var output: URL?
var stage = "arguments"
let start = Date()
func deadline() throws { if Date().timeIntervalSince(start) > 120 { throw ProbeError("120 second probe budget exceeded") } }
func complete(_ command: MTLCommandBuffer) throws {
    stage = "execution"; report["execution"] = "in_progress"
    try deadline()
    let signal = DispatchSemaphore(value: 0)
    command.addCompletedHandler { _ in signal.signal() }
    command.commit()
    guard signal.wait(timeout: .now() + 20) == .success else { throw ProbeError("GPU command completion timed out after 20 seconds") }
    guard command.status == .completed else { throw ProbeError("GPU command failed: \(String(describing: command.error))") }
    report["execution"] = "completed"
}
func reversed(_ v: UInt32) -> UInt32 {
    var r: UInt32 = 0
    for b in 0..<32 { r |= ((v >> b) & 1) << (31-b) }
    return r
}
func extract(_ x: UInt32, _ offset: Int, _ count: Int, _ signed: Bool) -> UInt32 {
    if count == 0 { return 0 }
    if count == 32 { return x }
    let mask = (UInt32(1) << count) - 1
    let v = (x >> offset) & mask
    return signed && (v & (UInt32(1) << (count-1))) != 0 ? v | ~mask : v
}
func insert(_ x: UInt32, _ y: UInt32, _ offset: Int, _ count: Int) -> UInt32 {
    if count == 0 { return x }
    if count == 32 { return y }
    let mask = ((UInt32(1) << count) - 1) << offset
    return (x & ~mask) | ((y << offset) & mask)
}
func unary(_ x: UInt32) -> [UInt32] {
    [UInt32(x.leadingZeroBitCount), UInt32(x.trailingZeroBitCount), UInt32(x.nonzeroBitCount), reversed(x)]
}
func buffer(_ values: [UInt32], _ device: MTLDevice) throws -> MTLBuffer {
    guard let b = values.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }) else { throw ProbeError("Buffer allocation failed") }
    return b
}
func integers(_ device: MTLDevice, _ queue: MTLCommandQueue, _ libs: [MTLLibrary], _ constants: Bool, _ out: URL) throws -> Int {
    var values: [UInt32] = [0, 0x80000000, 0xffffffff, 0xfffffff8, 0xaaaaaaaa, 0x55555555]
    values += (0..<32).map { UInt32(1) << $0 }
    var seed: UInt32 = 0x59a6c37d
    for _ in 0..<16 { seed = seed &* 1664525 &+ 1013904223; values.append(seed) }
    let ranges = [(0,0),(32,0),(0,32),(0,1),(31,1),(4,4),(7,13),(28,4)]
    report["integerLayout"] = "32-bit bit patterns; int3/uint3 stride 16 bytes, other widths tightly packed. Padding words are saved but excluded from comparison."
    report["integerSeed"] = "0x59a6c37d (LCG 1664525*x + 1013904223 modulo 2^32)"
    var checks = 0
    for signed in [false,true] { for width in 2...4 {
        try deadline()
        let name = "integer_\(constants ? "constants" : "dynamic")_\(signed ? "int" : "uint")\(width)"
        let stride = width == 3 ? 4 : width // MSL three-lane vectors occupy 16 bytes.
        let count = constants ? 10 : 6
        var pipelines: [MTLComputePipelineState] = []
        for lib in libs {
            stage = "pipelineCreation"; report["pipelineCreation"] = "in_progress"
            guard let fn = lib.makeFunction(name: name) else { throw ProbeError("Missing function \(name)") }
            pipelines.append(try device.makeComputePipelineState(function: fn))
        }
        report["pipelineCreation"] = "passed"
        var records: [[String: Any]] = []
        let iterations = constants ? 1 : values.count * ranges.count
        for index in 0..<iterations {
            stage = "computeSetup"
            let offset = constants ? 0 : ranges[index % ranges.count].0
            let bits = constants ? 0 : ranges[index % ranges.count].1
            let base = constants ? 0 : index / ranges.count
            let x = constants ? Array([UInt32(0),0x80000000,0xffffffff,0xfffffff8].prefix(width)) : (0..<width).map { values[(base + $0) % values.count] }
            let y = (0..<width).map { values[(base * 7 + $0 + 5) % values.count] }
            var expected = Array(repeating: UInt32(0), count: count * stride)
            for lane in 0..<width {
                var ops = unary(x[lane])
                if constants {
                    ops += [extract(x[lane],32,0,signed),extract(x[lane],0,32,signed),extract(x[lane],28,4,signed),insert(x[lane],7,32,0),insert(7,x[lane],0,32),insert(0,x[lane],4,4)]
                } else { ops += [extract(x[lane],offset,bits,signed),insert(x[lane],y[lane],offset,bits)] }
                for op in 0..<count { expected[op * stride + lane] = ops[op] }
            }
            var packed = Array(repeating: UInt32(0), count: stride * 2)
            for lane in 0..<width { packed[lane] = x[lane]; packed[stride+lane] = y[lane] }
            let input = try buffer(packed,device), params = try buffer([UInt32(offset),UInt32(bits)],device)
            var actual: [[UInt32]] = []
            for pipeline in pipelines {
                let destination = try buffer(Array(repeating: 0xdeadbeef, count: count * stride),device)
                guard let command = queue.makeCommandBuffer(), let encoder = command.makeComputeCommandEncoder() else { throw ProbeError("Cannot create compute encoder") }
                encoder.setComputePipelineState(pipeline)
                if constants { encoder.setBuffer(destination,offset:0,index:0) }
                else { encoder.setBuffer(input,offset:0,index:0); encoder.setBuffer(destination,offset:0,index:1); encoder.setBuffer(params,offset:0,index:2) }
                encoder.dispatchThreadgroups(MTLSize(width:1,height:1,depth:1),threadsPerThreadgroup:MTLSize(width:1,height:1,depth:1))
                encoder.endEncoding()
                try complete(command)
                actual.append(Array(UnsafeBufferPointer(start:destination.contents().assumingMemoryBound(to:UInt32.self),count:count*stride)))
            }
            let active = (0..<count).flatMap { op in (0..<width).map { op*stride+$0 } }
            stage = "numericalComparison"; report["numericalComparison"] = "in_progress"
            let passed = active.allSatisfy { actual[0][$0] == expected[$0] && actual[1][$0] == expected[$0] && actual[0][$0] == actual[1][$0] }
            records.append(["index":index,"x":x,"y":y,"offset":offset,"count":bits,"expected":expected,"apple":actual[0],"floor":actual[1],"pass":passed])
            checks += active.count
            if !passed { try save(records,out.appendingPathComponent(name+".json")); throw ProbeError("Integer numerical mismatch: \(name), case \(index)") }
        }
        try save(records,out.appendingPathComponent(name+".json"))
    } }
    return checks
}

func derivatives(_ device: MTLDevice, _ queue: MTLCommandQueue, _ libs: [MTLLibrary], _ out: URL) throws -> Int {
    // Ancillary rasterization only; neither test fragment library is compiled or retargeted here.
    let helper = """
    #include <metal_stdlib>
    using namespace metal;
    vertex float4 probe_triangle(uint i [[vertex_id]]) {
        float2 p[3] = {float2(-1,-1), float2(3,-1), float2(-1,3)};
        return float4(p[i],0.5,1.0);
    }
    """
    try helper.write(to:out.appendingPathComponent("raster-helper.metal"),atomically:true,encoding:.utf8)
    stage = "rasterHelperCompilation"
    let helperLib = try device.makeLibrary(source:helper,options:nil)
    guard let vertex = helperLib.makeFunction(name:"probe_triangle") else { throw ProbeError("Missing rasterization helper") }
    let size = 16, rowBytes = 256
    let desc = MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.rgba32Float,width:size,height:size,mipmapped:false)
    desc.usage = [.renderTarget]; desc.storageMode = .private
    var checks = 0
    for op in ["dfdx","dfdy","fwidth"] { for width in 1...4 {
        let name = "dv_\(op)_\(width)"
        var actual: [[Float]] = []
        for lib in libs {
            stage = "pipelineCreation"; report["pipelineCreation"] = "in_progress"
            guard let fn = lib.makeFunction(name:name) else { throw ProbeError("Missing fragment \(name)") }
            let pipelineDesc = MTLRenderPipelineDescriptor()
            pipelineDesc.vertexFunction = vertex; pipelineDesc.fragmentFunction = fn
            pipelineDesc.colorAttachments[0].pixelFormat = .rgba32Float
            let pipeline = try device.makeRenderPipelineState(descriptor:pipelineDesc)
            report["pipelineCreation"] = "passed"
            stage = "renderSetup"
            guard let target = device.makeTexture(descriptor:desc), let readback = device.makeBuffer(length:rowBytes*size,options:.storageModeShared), let command = queue.makeCommandBuffer() else { throw ProbeError("Render resource allocation failed") }
            let pass = MTLRenderPassDescriptor()
            pass.colorAttachments[0].texture = target; pass.colorAttachments[0].loadAction = .clear; pass.colorAttachments[0].storeAction = .store
            guard let encoder = command.makeRenderCommandEncoder(descriptor:pass) else { throw ProbeError("Render encoder allocation failed") }
            encoder.setRenderPipelineState(pipeline)
            encoder.setViewport(MTLViewport(originX:0,originY:0,width:Double(size),height:Double(size),znear:0,zfar:1))
            encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3); encoder.endEncoding()
            guard let blit = command.makeBlitCommandEncoder() else { throw ProbeError("Blit encoder allocation failed") }
            blit.copy(from:target,sourceSlice:0,sourceLevel:0,sourceOrigin:MTLOrigin(x:0,y:0,z:0),sourceSize:MTLSize(width:size,height:size,depth:1),to:readback,destinationOffset:0,destinationBytesPerRow:rowBytes,destinationBytesPerImage:rowBytes*size)
            blit.endEncoding(); try complete(command)
            actual.append(Array(UnsafeBufferPointer(start:readback.contents().assumingMemoryBound(to:Float.self),count:size*size*4)))
        }
        // Constant clip z and w; position x/y increase one unit per pixel.
        let expected: [Float] = op == "dfdx" ? [1,0,0,0] : op == "dfdy" ? [0,1,0,0] : [1,1,0,0]
        stage = "numericalComparison"; report["numericalComparison"] = "in_progress"
        var failures: [[String:Any]] = []
        for y in 2..<(size-2) { for x in 2..<(size-2) { for lane in 0..<width {
            let i = (y*size+x)*4+lane, a = actual[0][i], f = actual[1][i]
            // Exactly representable affine positions; 1e-5 permits small implementation rounding, not sign/lane errors.
            let ok = a.isFinite && f.isFinite && abs(a-expected[lane]) <= 1e-5 && abs(f-expected[lane]) <= 1e-5 && abs(a-f) <= 1e-5
            if !ok { failures.append(["x":x,"y":y,"lane":lane]) }; checks += 1
        } } }
        // Binary output preserves NaNs and all untouched channels without JSON's finite-number restriction.
        for (i,label) in ["apple","floor"].enumerated() {
            let data = actual[i].withUnsafeBytes { Data($0) }
            try data.write(to:out.appendingPathComponent(name+"-"+label+".f32le"))
        }
        try save(["expectedPerPixel":Array(expected.prefix(width)),"width":size,"height":size,"channels":4,"testedLanes":width,"interior":"x,y=2...13","absoluteTolerance":1e-5,"failures":failures],out.appendingPathComponent(name+".json"))
        if !failures.isEmpty { throw ProbeError("Derivative numerical mismatch: \(name)") }
    } }
    report["derivativeCoverage"] = "Position derivatives only; independent negative/mixed-slope affine fixture not implemented. These numerical tests do not establish fwidth absolute-value behavior for negative slopes. No edges or divergent control flow tested."
    return checks
}

var code: Int32 = 1
do {
    let apple = try option("--apple"), floor = try option("--floor"), kind = try option("--kind")
    guard ["integer","derivative"].contains(kind) else { throw ProbeError("Unknown --kind") }
    let mode = try (kind == "integer" ? option("--mode") : "")
    guard kind != "integer" || ["dynamic","constants"].contains(mode) else { throw ProbeError("Unknown --mode") }
    let out = URL(fileURLWithPath:try option("--output"),isDirectory:true)
    try FileManager.default.createDirectory(at:out,withIntermediateDirectories:true)
    guard try FileManager.default.contentsOfDirectory(atPath:out.path).isEmpty else { throw ProbeError("Output directory must be empty") }
    output = out
    report["kind"] = kind; report["mode"] = mode
    if kind == "derivative" { report["derivativeCoverage"] = "Position derivatives only. Negative/mixed-slope affine fixtures are not implemented; no numerical proof of fwidth absolute-value behavior for negative slopes." }
    var artifacts: [[String:Any]] = []
    for path in [apple,floor] {
        let url = URL(fileURLWithPath:path)
        let attributes = try FileManager.default.attributesOfItem(atPath:path)
        guard let size = attributes[.size] as? NSNumber, size.int64Value >= 0,
              size.int64Value < 32*1024*1024 else { throw ProbeError("Input exceeds 32 MiB") }
        let handle = try FileHandle(forReadingFrom:url)
        let data: Data
        do { data = try handle.read(upToCount:32*1024*1024) ?? Data(); try handle.close() }
        catch { try? handle.close(); throw error }
        guard data.count == size.intValue else { throw ProbeError("Input size changed or input read was incomplete") }
        artifacts.append(["path":url.path,"sha256":hash(data),"bytes":data.count])
    }
    report["artifacts"] = artifacts
    stage = "device"
    guard let device = MTLCreateSystemDefaultDevice() else { report["status"] = "unavailable"; code = 77; throw ProbeError("No MTLDevice available; GPU numerical tests not run") }
    report["device"] = device.name
    stage = "libraryLoading"
    var libs: [MTLLibrary] = [], loading: [String:Any] = [:]
    var loaded = Set<String>()
    // Attempt BOTH originals even if the first fails; preserve individual loader diagnostics.
    for (label,path) in [("apple",apple),("floor",floor)] {
        do { libs.append(try device.makeLibrary(URL:URL(fileURLWithPath:path))); loaded.insert(label); loading[label] = ["status":"loaded"] }
        catch { loading[label] = ["status":"rejected","error":String(describing:error)] }
    }
    report["libraryLoading"] = loading
    let loadCode = libraryLoadExitCode(appleLoaded:loaded.contains("apple"),floorLoaded:loaded.contains("floor"))
    report["libraryLoadingStatus"] = loadCode == 0 ? "passed" : loadCode == 77 ? "unavailable" : "failed"
    if loadCode == 77 {
        report["status"] = "unavailable"; code = 77
        throw ProbeError("Apple reference library rejected; numerical comparison unavailable. Both original loader diagnostics are preserved; platform incompatibility is not assumed.")
    }
    if loadCode == 1 {
        code = 1
        throw ProbeError("Apple reference loaded but FLOOR library rejected: runtime library correctness failure for the same-target pair.")
    }
    guard let queue = device.makeCommandQueue() else { throw ProbeError("Command queue unavailable") }
    stage = "pipeline_or_execution"
    let checks: Int
    if kind == "derivative" { checks = try derivatives(device,queue,libs,out) }
    else { checks = try integers(device,queue,libs,mode == "constants",out) }
    report["pipelineCreation"] = "passed"; report["execution"] = "completed"; report["numericalComparison"] = "passed"
    report["checkedValues"] = checks; report["status"] = "passed"; code = 0
} catch {
    report["error"] = String(describing:error); report["stoppedStage"] = stage
    if code != 77 { report["status"] = "failed"; if stage != "libraryLoading" { report[stage] = "failed" } }
}
report["elapsedSeconds"] = Date().timeIntervalSince(start)
if let out = output {
    do {
        var evidence: [[String:Any]] = []
        for url in try FileManager.default.contentsOfDirectory(at:out,includingPropertiesForKeys:nil).sorted(by:{$0.path < $1.path}) where url.lastPathComponent != "report.json" {
            let data = try Data(contentsOf:url)
            evidence.append(["file":url.lastPathComponent,"sha256":hash(data),"bytes":data.count])
        }
        report["evidence"] = evidence
        try save(report,out.appendingPathComponent("report.json"))
    } catch { fputs("Report write failed: \(error)\n",stderr); code = 1 }
}
if let data = try? JSONSerialization.data(withJSONObject:report,options:[.sortedKeys]), let text = String(data:data,encoding:.utf8) { print(text) }
exit(code)
