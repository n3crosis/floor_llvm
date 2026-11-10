// Authored bounded barrier compute probe. Never changes or retargets libraries.
// xcrun swiftc metal-barrier-gpu.swift -framework Metal -o metal-barrier-gpu
// metal-barrier-gpu --apple A.metallib --floor F.metallib --kind threadgroup|simdgroup --output DIRECTORY
// Both libraries must contain the original same-source barrier_exchange kernel.
// Exit 0: exact-output pass; 1: failure; 77: unavailable. No complete memory-model claim.
import Foundation
import Metal
import CryptoKit

struct ProbeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}
func option(_ key: String) throws -> String {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: key), i + 1 < args.count else { throw ProbeError("Missing \(key)") }
    return args[i + 1]
}
func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func save(_ object: Any, _ url: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]).write(to: url, options: .atomic)
}
func buffer(_ values: [UInt32], _ device: MTLDevice) throws -> MTLBuffer {
    guard let result = values.withUnsafeBytes({ device.makeBuffer(bytes: $0.baseAddress!, length: $0.count, options: .storageModeShared) }) else { throw ProbeError("Buffer allocation failed") }
    return result
}
func inputValues(_ width: Int, _ iteration: UInt32) -> [UInt32] {
    let special: [UInt32] = [0,0xffffffff,0x80000000,0x7fffffff,0xaaaaaaaa,0x55555555,1,0x01020304]
    var seed: UInt32 = 0xb4a41e25 &+ iteration
    return (0..<width).map { index in
        seed = seed &* 1664525 &+ 1013904223
        return iteration == 0 && index < special.count ? special[index] : seed
    }
}
var report: [String: Any] = ["schema": 1, "status": "not_run", "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "libraryLoading": [:], "pipelineCreation": "not_run", "execution": "not_run", "numericalComparison": "not_run",
    "scope": "Bounded same-source producer/consumer and scratch-reuse test, not proof of the complete Metal memory model.",
    "targetPolicy": "Original libraries unchanged; no retargeting or metadata rewriting."]
var output: URL?
var stage = "arguments"
var unavailable = false
let start = Date()
func deadline() throws { if Date().timeIntervalSince(start) > 90 { throw ProbeError("90 second probe budget exceeded") } }
func complete(_ command: MTLCommandBuffer) throws {
    let signal = DispatchSemaphore(value: 0)
    command.addCompletedHandler { _ in signal.signal() }
    command.commit()
    guard signal.wait(timeout: .now() + 20) == .success else { throw ProbeError("GPU completion timed out after 20 seconds") }
    guard command.status == .completed else { throw ProbeError("GPU command failed: \(String(describing: command.error))") }
}

do {
    let kind = try option("--kind")
    guard ["threadgroup", "simdgroup"].contains(kind) else { throw ProbeError("Unknown barrier kind") }
    let out = URL(fileURLWithPath: try option("--output"), isDirectory: true)
    output = out
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let paths = [try option("--apple"), try option("--floor")]
    let bytes = try paths.map { try Data(contentsOf: URL(fileURLWithPath: $0)) }
    report["kind"] = kind
    report["artifacts"] = zip(["apple", "floor"], bytes).map { label, data in ["compiler": label, "sha256": hash(data), "bytes": data.count] as [String: Any] }
    guard bytes.allSatisfy({ $0.prefix(4) == Data("MTLB".utf8) }) else { throw ProbeError("Input is not a metallib") }
    stage = "device"
    guard let device = MTLCreateSystemDefaultDevice() else { unavailable = true; throw ProbeError("No Metal device") }
    report["device"] = ["name": device.name, "registryID": String(device.registryID)]
    guard let queue = device.makeCommandQueue() else { throw ProbeError("Command queue creation failed") }
    stage = "libraryLoading"
    var libraries: [MTLLibrary] = []
    var loading: [String: Any] = [:]
    // Attempt both libraries even if the Apple reference is unavailable.
    for (i, path) in paths.enumerated() {
        let label = i == 0 ? "apple" : "floor"
        do {
            let library = try device.makeLibrary(URL: URL(fileURLWithPath: path))
            libraries.append(library)
            loading[label] = ["status": "loaded"]
        } catch { loading[label] = ["status": "rejected", "error": String(describing: error)] }
    }
    report["libraryLoading"] = loading
    let appleLoaded = (loading["apple"] as? [String: String])?["status"] == "loaded"
    let floorLoaded = (loading["floor"] as? [String: String])?["status"] == "loaded"
    if !appleLoaded { unavailable = true; throw ProbeError("Apple reference library unavailable on this device") }
    guard floorLoaded else { throw ProbeError("FLOOR library rejected after Apple library loaded") }
    stage = "pipelineCreation"
    let pipelines = try libraries.map { library -> MTLComputePipelineState in
        guard let function = library.makeFunction(name: "barrier_exchange") else { throw ProbeError("Missing barrier_exchange entry") }
        return try device.makeComputePipelineState(function: function)
    }
    report["pipelineCreation"] = "passed"
    let maximum = pipelines.map { $0.maxTotalThreadsPerThreadgroup }.min()!
    // At most one SIMD-group in both pipelines, even if their widths differ.
    let width = kind == "simdgroup" ? min(maximum, pipelines.map { $0.threadExecutionWidth }.min()!) : min(128, maximum)
    guard width > 0, width <= 1024 else { throw ProbeError("Unsupported threadgroup width") }
    report["geometry"] = ["threadgroups": 1, "threadsPerThreadgroup": width, "pipelineSIMDWidths": pipelines.map { $0.threadExecutionWidth }, "threadgroupMemoryBytes": width * 4]
    let count = try buffer([UInt32(width)], device)
    var records: [[String: Any]] = []
    var checkedValues = 0
    for iteration in 0..<16 {
        try deadline()
        let input = inputValues(width, UInt32(iteration))
        let expected = input.map { $0 ^ 0x9e3779b9 }
        let source = try buffer(input, device)
        var actual: [[UInt32]] = []
        for pipeline in pipelines {
            let result = try buffer(Array(repeating: 0xfeedface, count: width), device)
            guard let command = queue.makeCommandBuffer(), let encoder = command.makeComputeCommandEncoder() else { throw ProbeError("Command encoding unavailable") }
            encoder.setComputePipelineState(pipeline)
            encoder.setBuffer(source, offset: 0, index: 0)
            encoder.setBuffer(result, offset: 0, index: 1)
            encoder.setBuffer(count, offset: 0, index: 2)
            encoder.setThreadgroupMemoryLength(width * 4, index: 0)
            encoder.dispatchThreadgroups(MTLSize(width: 1, height: 1, depth: 1), threadsPerThreadgroup: MTLSize(width: width, height: 1, depth: 1))
            encoder.endEncoding()
            stage = "execution"; report["execution"] = "in_progress"
            try complete(command)
            report["execution"] = "completed"
            let values = Array(UnsafeBufferPointer(start: result.contents().bindMemory(to: UInt32.self, capacity: width), count: width))
            actual.append(values)
        }
        let record: [String: Any] = ["iteration": iteration, "input": input, "expected": expected, "apple": actual[0], "floor": actual[1]]
        records.append(record)
        // Save observations before rejecting a mismatch.
        try save(records, out.appendingPathComponent("values.json"))
        stage = "numericalComparison"
        guard actual[0] == expected else { throw ProbeError("Apple output differs from independent oracle at iteration \(iteration)") }
        guard actual[1] == expected else { throw ProbeError("FLOOR output differs from independent oracle at iteration \(iteration)") }
        checkedValues += width * 2
    }
    report["checkedValues"] = checkedValues
    report["numericalComparison"] = "passed"
    report["status"] = "passed"
    try save(report, out.appendingPathComponent("report.json"))
    exit(0)
} catch {
    let status = unavailable ? "unavailable" : "failed"
    report["status"] = status
    report["error"] = ["stage": stage, "message": String(describing: error)]
    if stage == "pipelineCreation" || stage == "execution" || stage == "numericalComparison" { report[stage] = status }
    if let output = output { try? save(report, output.appendingPathComponent("report.json")) }
    fputs("\(status): \(error)\n", stderr)
    exit(unavailable ? 77 : 1)
}
