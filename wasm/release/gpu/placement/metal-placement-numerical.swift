// Standalone optional GPU evidence. Never compiles, retargets, or rewrites a library.
// xcrun swiftc metal-placement-numerical.swift -framework Metal -o metal-placement-numerical
// metal-placement-numerical --descriptor CASE.json --source CASE.metal
//   --apple APPLE.metallib --floor FLOOR.metallib --output NEW_DIRECTORY
// CPU-only cross-check: --oracle-fixture placement-gpu-oracle.json --output NEW_DIRECTORY
// GPU exit: 0=both backends pass CPU oracle, 1=failure, 77=unavailable (not pass).
import Foundation
import Dispatch
import Metal
import CryptoKit

struct ProbeError: Error, CustomStringConvertible {
    let description: String
    init(_ value: String) { description = value }
}
struct PlacementCase {
    let name: String
    let space: String
    let form: String
    var count: Int { form == "array" ? 2 : 1 }
    var json: [String: Any] { ["name": name, "space": space, "form": form, "count": count] }
}
let suite = "floor-metal41-placement-gpu-v1"
let cases = ["thread", "threadgroup", "device"].flatMap { space in
    ["scalar", "array"].map { PlacementCase(name: "placement_gpu_\(space)_\($0)", space: space, form: $0) }
}
let sourceIdentities: [String: [String: Any]] = [
    "placement_gpu_thread_scalar": ["sha256": "821648c4169f54bb3780bf4f96b09768031113eb7f60c10dc7220c7e11ddc0d2", "bytes": 2039],
    "placement_gpu_thread_array": ["sha256": "5191ef8619b4e6062e6d093f6453f2bc48784b213331b6a447db777ffcd1f73a", "bytes": 2230],
    "placement_gpu_threadgroup_scalar": ["sha256": "ff24647449c6c568e932a49e16824074ff7a96bd70974e14ad604650119335ed", "bytes": 2190],
    "placement_gpu_threadgroup_array": ["sha256": "b9a8b7ace3cf5baaaa217f648f3202c66492fcf556fabab432d4cc954fdb0791", "bytes": 2421],
    "placement_gpu_device_scalar": ["sha256": "ffe3181108b7eced88eb78a8e865cbf26bb9a07fe436e6dfb6f65c75720a76b9", "bytes": 2040],
    "placement_gpu_device_array": ["sha256": "dfc3043eea50aa23e8f0346bed1b0c6c6968ed9784128dbe088fb14baeb587be", "bytes": 2231],
]
func bindings(_ c: PlacementCase) -> [String: Any] {
    ["inputBuffer": 0, "inputBytes": 24, "outputBuffer": 1,
     "outputBindingByteOffset": 16, "outputActiveBytes": 128, "outputAllocationBytes": 160,
     "arenaBuffer": c.space == "device" ? 2 as Any : NSNull(), "arenaBytes": 64,
     "threadgroupIndex": c.space == "threadgroup" ? 0 as Any : NSNull(),
     "threadgroupBytes": c.space == "threadgroup" ? 64 : 0,
     "threadgroups": [1,1,1], "threadsPerThreadgroup": [1,1,1]]
}
func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
func jsonData(_ object: Any) throws -> Data {
    try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
}
func saveJSON(_ object: Any, _ path: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]).write(to: path, options: .atomic)
}
func boundedRead(_ path: String, maximum: Int) throws -> Data {
    let url = URL(fileURLWithPath: path)
    let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
    guard info.isRegularFile == true, info.isSymbolicLink != true,
          let size = info.fileSize, size > 0, size <= maximum else { throw ProbeError("Expected bounded regular file: \(path)") }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    guard let data = try handle.read(upToCount: maximum + 1), data.count == size else { throw ProbeError("File size changed while reading: \(path)") }
    return data
}
func words(_ values: [UInt32]) -> Data {
    Data(values.flatMap { v in (0..<4).map { UInt8(truncatingIfNeeded: v >> (8*$0)) } })
}
func inputVectors() -> [[UInt32]] {
    var result: [[UInt32]] = [[0,0,0,0,0,0], Array(repeating: UInt32.max, count: 6),
        [0x80000000,0x7fffffff,1,0xffffffff,0xaaaaaaaa,0x55555555],
        [0x13579bdf,0x2468ace0,0xdeadbeef,0x10203040,0x01020304,0xfedcba98]]
    var state: UInt32 = 0x41c0ffee
    for _ in 0..<8 {
        var vector: [UInt32] = []
        for _ in 0..<6 { state = state &* 1664525 &+ 1013904223; vector.append(state) }
        result.append(vector)
    }
    return result
}
func initialOutput() -> Data { words((0..<40).map { 0x6a09e667 ^ (UInt32($0+1) &* 0x01020305) }) }
struct Expected {
    let trace: [UInt32]
    let arena: Data
    let output: Data
}
// Independent CPU model: direct state/byte expectations, no shader execution,
// placement pointers, AIR interpreter, or Apple-output-as-oracle substitution.
func expected(_ c: PlacementCase, _ input: [UInt32]) -> Expected {
    precondition(input.count == 6)
    let array = c.count == 2
    let firstValue: UInt32 = array ? 0x13579bdf : input[0]
    let firstStamp: UInt32 = array ? 0x2468ace0 : input[1]
    let deadValue = firstValue ^ 0xa5a5a5a5
    let deadStamp = firstStamp &+ 0x10203040
    let trace: [UInt32] = [0x504c4143, UInt32(c.count), 1, 8, 4,
        firstValue, firstStamp, array ? firstValue : 0, array ? firstStamp : 0,
        deadValue, deadStamp, array ? deadValue : 0, array ? deadStamp : 0,
        1, array ? 1 : 0, input[2] ^ (array ? input[4] : 0)]
    var arena = Data((0..<64).map { UInt8(truncatingIfNeeded: UInt32($0*37) ^ input[0] ^ (input[5] >> 8) ^ 0x5a) })
    for index in 0..<c.count {
        let final = words([input[2+index*2] ^ 0xa5a5a5a5, input[3+index*2] &+ 0x10203040])
        arena.replaceSubrange((16+index*8)..<(24+index*8), with: final)
    }
    var output = initialOutput()
    output.replaceSubrange(16..<80, with: words(trace))
    output.replaceSubrange(80..<144, with: arena)
    return Expected(trace: trace, arena: arena, output: output)
}
func oracleFixture() -> [String: Any] {
    var records: [[String: Any]] = []
    for c in cases { for (index,input) in inputVectors().enumerated() {
        let e = expected(c,input)
        records.append(["name": c.name, "trial": index, "input": input, "trace": e.trace,
            "arenaHex": hex(e.arena), "outputHex": hex(e.output), "sha256": hash(e.output)])
    } }
    return ["schema": 1, "suite": suite, "sourceIdentities": sourceIdentities, "cases": records]
}
func makeBuffer(_ bytes: Data, _ device: MTLDevice) throws -> MTLBuffer {
    guard !bytes.isEmpty else { throw ProbeError("Empty buffer") }
    return try bytes.withUnsafeBytes { raw in
        guard let pointer = raw.baseAddress, let buffer = device.makeBuffer(bytes: pointer, length: raw.count, options: .storageModeShared) else { throw ProbeError("Buffer allocation failed") }
        return buffer
    }
}
func mismatch(_ actual: Data, _ expected: Data) -> [String: Any] {
    let a = [UInt8](actual), e = [UInt8](expected)
    let bad = (0..<min(a.count,e.count)).filter { a[$0] != e[$0] }
    return ["count": bad.count + abs(a.count-e.count), "first": bad.prefix(16).map { ["byteOffset": $0, "expected": Int(e[$0]), "actual": Int(a[$0])] },
            "actualBytes": a.count, "expectedBytes": e.count]
}
func parsedArguments() throws -> [String: String] {
    let a = Array(CommandLine.arguments.dropFirst())
    guard a.count % 2 == 0 else { throw ProbeError("Arguments must be unique option/value pairs") }
    var result: [String: String] = [:]
    let allowed = Set(["--descriptor","--source","--apple","--floor","--output","--oracle-fixture"])
    for i in stride(from: 0, to: a.count, by: 2) {
        guard allowed.contains(a[i]), result[a[i]] == nil, !a[i+1].isEmpty, !a[i+1].hasPrefix("--") else { throw ProbeError("Unknown, duplicate or missing option: \(a[i])") }
        result[a[i]] = a[i+1]
    }
    let expected = result["--oracle-fixture"] == nil ? Set(["--descriptor","--source","--apple","--floor","--output"]) : Set(["--oracle-fixture","--output"])
    guard Set(result.keys) == expected else { throw ProbeError("Missing/extra options; GPU and CPU-only modes cannot be mixed") }
    return result
}
let started = Date()
// Soft pre-dispatch budget. Synchronous Metal load/pipeline API calls cannot
// be interrupted here; callers must also impose an outer process timeout.
func deadline() throws { if Date().timeIntervalSince(started) > 120 { throw ProbeError("120-second pre-dispatch budget exceeded") } }
var outputDirectory: URL?
var report: [String: Any] = ["schema": 1, "suite": suite, "feature": "msl41-placement-gpu",
    "status": "not_run", "scope": "gpu_pair",
    "qualification": "numerical_only", "compilerProvenance": "requires_external_compile_record_review",
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "device": NSNull(), "pairComparison": ["status": "not_run"],
    "targetPolicy": "Original same-source iOS27/Metal4.1 conservative-math libraries only. Bytes are hashed and loaded unchanged. Descriptor provenance still requires review of producing compile commands; it is not inferred from file names."]
func persist() throws { if let dir = outputDirectory { try saveJSON(report,dir.appendingPathComponent("report.json")) } }
func rawEvidence(_ data: Data, _ filename: String) throws -> [String: Any] {
    guard let dir = outputDirectory else { throw ProbeError("Output directory unavailable") }
    try data.write(to: dir.appendingPathComponent(filename), options: .atomic)
    return ["file": filename, "sha256": hash(data), "bytes": data.count]
}
var backendReports: [String: [String: Any]] = [:]
func freshBackend() -> [String: Any] {
    ["load": ["status": "not_run"], "pipeline": ["status": "not_run"],
     "execution": ["status": "not_run", "trialsCompleted": 0], "numerical": ["status": "not_run"], "trials": []]
}
func setStage(_ label: String, _ stage: String, _ value: [String: Any]) throws {
    backendReports[label]?[stage] = value; report["backends"] = backendReports; try persist()
}
func stageStatus(_ label: String, _ stage: String) -> String {
    (backendReports[label]?[stage] as? [String: Any])?["status"] as? String ?? "not_run"
}
var exitCode: Int32 = 1
var globalStage = "arguments"
do {
    let options = try parsedArguments()
    let dir = URL(fileURLWithPath: options["--output"]!, isDirectory: true)
    guard !FileManager.default.fileExists(atPath: dir.path) else { throw ProbeError("Output directory already exists; refusing to overwrite evidence") }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    outputDirectory = dir; report["status"] = "in_progress"; try persist()
    if let fixturePath = options["--oracle-fixture"] {
        globalStage = "oracleSelfTest"
        let bytes = try boundedRead(fixturePath, maximum: 512*1024)
        let external = try JSONSerialization.jsonObject(with: bytes)
        let matches = try jsonData(external) == jsonData(oracleFixture())
        report["scope"] = "cpu_oracle_only"; report["gpuValidation"] = "not_run"
        report["fixtureSha256"] = hash(bytes); report["records"] = 72
        report["status"] = matches ? "oracle_self_test_passed" : "failed"
        report["oracleSelfTest"] = matches ? "passed" : "failed"; exitCode = matches ? 0 : 1
    } else {
        globalStage = "descriptorValidation"
        let descriptorBytes = try boundedRead(options["--descriptor"]!, maximum: 64*1024)
        guard let descriptor = try JSONSerialization.jsonObject(with: descriptorBytes) as? [String: Any],
              let describedCase = descriptor["case"] as? [String: Any], let name = describedCase["name"] as? String,
              let c = cases.first(where: { $0.name == name }) else { throw ProbeError("Unknown placement descriptor case") }
        let source = try boundedRead(options["--source"]!, maximum: 4096)
        var libraryData: [String: Data] = [:]
        for label in ["apple","floor"] {
            let bytes = try boundedRead(options["--"+label]!, maximum: 32*1024*1024)
            guard Array(bytes.prefix(4)) == [77,84,76,66] else { throw ProbeError("\(label) input is not a metallib") }
            libraryData[label] = bytes
        }
        let intended: [String: Any] = ["schema": 1, "suite": suite, "feature": "msl41-placement-gpu", "case": c.json,
            "source": sourceIdentities[c.name]!, "bindings": bindings(c), "target": ["metalVersion": 410, "ios": 27, "mathProfile": 0],
            "apple": ["sha256": hash(libraryData["apple"]!), "bytes": libraryData["apple"]!.count],
            "floor": ["sha256": hash(libraryData["floor"]!), "bytes": libraryData["floor"]!.count]]
        guard hash(source) == sourceIdentities[c.name]!["sha256"] as? String,
              source.count == sourceIdentities[c.name]!["bytes"] as? Int,
              try jsonData(descriptor) == jsonData(intended) else { throw ProbeError("Descriptor/source/library identity or binding contract mismatch") }
        report["case"] = c.json; report["descriptor"] = intended; report["descriptorSha256"] = hash(descriptorBytes)
        report["descriptorValidation"] = "passed"; report["inputVectors"] = inputVectors()
        for label in ["apple","floor"] { backendReports[label] = freshBackend() }
        report["backends"] = backendReports
        var expectations: [Expected] = []
        var fixtures: [[String: Any]] = []
        for (index,input) in inputVectors().enumerated() {
            let e = expected(c,input); expectations.append(e)
            fixtures.append(["trial": index, "input": input, "trace": e.trace,
                "inputRaw": try rawEvidence(words(input),"trial-\(index)-input.u32le"),
                "expectedOutput": try rawEvidence(e.output,"trial-\(index)-expected-output.u8le"),
                "expectedArena": try rawEvidence(e.arena,"trial-\(index)-expected-arena.u8le")])
        }
        report["fixtures"] = fixtures; report["initialOutput"] = try rawEvidence(initialOutput(),"initial-output.u8le")
        try persist()
        if let device = MTLCreateSystemDefaultDevice() {
            report["device"] = device.name; report["registryID"] = String(device.registryID)
            var pipelines: [String: MTLComputePipelineState] = [:]
            // Every backend is attempted independently. A failure in one never
            // rewrites another backend's successful or not-run stage evidence.
            for label in ["apple","floor"] {
                globalStage = "\(label).load"
                try setStage(label,"load",["status":"in_progress"])
                let bytes = libraryData[label]!
                let dispatch = bytes.withUnsafeBytes { DispatchData(bytes: $0) }
                let library: MTLLibrary
                do { library = try device.makeLibrary(data: dispatch) }
                catch { try setStage(label,"load",["status":"failed","error":String(describing:error)]); continue }
                // Persist outside the API catch: an evidence-write failure is
                // never mislabeled as a library-load or pipeline failure.
                try setStage(label,"load",["status":"passed","sha256":hash(bytes),"bytes":bytes.count])
                globalStage = "\(label).pipeline"
                try setStage(label,"pipeline",["status":"in_progress","entry":c.name])
                let pipeline: MTLComputePipelineState
                do {
                    guard let function = library.makeFunction(name:c.name) else { throw ProbeError("Missing entry \(c.name)") }
                    pipeline = try device.makeComputePipelineState(function:function)
                    guard pipeline.maxTotalThreadsPerThreadgroup >= 1 else { throw ProbeError("Pipeline cannot dispatch one thread") }
                } catch { try setStage(label,"pipeline",["status":"failed","error":String(describing:error),"entry":c.name]); continue }
                pipelines[label] = pipeline
                try setStage(label,"pipeline",["status":"passed","entry":c.name])
            }
            var outputs: [String: [Data]] = [:]
            var gpuCommandPending = false
            for label in ["apple","floor"] {
                guard let pipeline = pipelines[label] else { continue }
                if gpuCommandPending { try setStage(label,"execution",["status":"not_run","reason":"Previous GPU command timed out and may still be pending","trialsCompleted":0]); continue }
                var records: [[String: Any]] = []
                var allPass = true
                var completedCommands = 0
                outputs[label] = []
                for (index,input) in inputVectors().enumerated() {
                    globalStage = "\(label).execution"
                    var trial: [String: Any] = ["trial":index,"execution":"in_progress","numerical":"not_run"]
                    do {
                        try deadline()
                        try setStage(label,"execution",["status":"in_progress","trialsCompleted":outputs[label]!.count])
                        guard let queue = device.makeCommandQueue() else { throw ProbeError("Cannot create command queue") }
                        let inputBuffer = try makeBuffer(words(input),device), destination = try makeBuffer(initialOutput(),device)
                        let arena = c.space == "device" ? try makeBuffer(Data(repeating:0xcc,count:64),device) : nil
                        guard let command = queue.makeCommandBuffer(), let encoder = command.makeComputeCommandEncoder() else { throw ProbeError("Cannot create command encoder") }
                        encoder.setComputePipelineState(pipeline)
                        encoder.setBuffer(inputBuffer,offset:0,index:0)
                        encoder.setBuffer(destination,offset:16,index:1)
                        if let arena = arena { encoder.setBuffer(arena,offset:0,index:2) }
                        if c.space == "threadgroup" { encoder.setThreadgroupMemoryLength(64,index:0) }
                        encoder.dispatchThreadgroups(MTLSize(width:1,height:1,depth:1),threadsPerThreadgroup:MTLSize(width:1,height:1,depth:1))
                        encoder.endEncoding()
                        let signal = DispatchSemaphore(value:0)
                        command.addCompletedHandler { _ in signal.signal() }
                        command.commit()
                        guard signal.wait(timeout:.now()+20) == .success else { gpuCommandPending = true; throw ProbeError("GPU command timed out; output not read while work may be pending") }
                        guard command.status == .completed else { throw ProbeError("GPU command failed: \(String(describing:command.error))") }
                        trial["execution"] = "passed"; completedCommands += 1
                        globalStage = "\(label).evidenceSaving"
                        // Copy raw bytes only after successful command completion.
                        let actual = Data(bytes:destination.contents(),count:160)
                        let actualArena = arena.map { Data(bytes:$0.contents(),count:64) }
                        let snapshot = actual.subdata(in:80..<144)
                        trial["output"] = try rawEvidence(actual,"\(label)-trial-\(index)-output.u8le")
                        trial["arenaSnapshot"] = try rawEvidence(snapshot,"\(label)-trial-\(index)-arena-snapshot.u8le")
                        if let actualArena = actualArena { trial["deviceArena"] = try rawEvidence(actualArena,"\(label)-trial-\(index)-device-arena.u8le") }
                        globalStage = "\(label).numerical"
                        let e = expectations[index]
                        let passed = actual == e.output && (actualArena == nil || actualArena == e.arena)
                        trial["numerical"] = passed ? "passed" : "failed"
                        trial["outputMismatch"] = mismatch(actual,e.output)
                        if let actualArena = actualArena { trial["arenaMismatch"] = mismatch(actualArena,e.arena) }
                        outputs[label]!.append(actual); allPass = allPass && passed
                        records.append(trial); backendReports[label]?["trials"] = records
                        try setStage(label,"numerical",["status":allPass ? "in_progress" : "failed","trialsCompared":records.count])
                    } catch {
                        allPass = false
                        if trial["execution"] as? String != "passed" { trial["execution"] = gpuCommandPending ? "timed_out" : "failed" }
                        trial["error"] = String(describing:error)
                        records.append(trial); backendReports[label]?["trials"] = records
                        let executed = trial["execution"] as? String == "passed"
                        try setStage(label,"execution",["status":executed ? "incomplete" : gpuCommandPending ? "timed_out" : "failed","error":String(describing:error),"trialsCompleted":completedCommands])
                        try setStage(label,"numerical",["status":executed ? "failed" : outputs[label]!.isEmpty ? "not_run" : "incomplete", "error":executed ? "Evidence persistence or comparison failed" : "Execution stopped before all trials completed", "trialsCompared":outputs[label]!.count])
                        break
                    }
                }
                if outputs[label]!.count == inputVectors().count {
                    try setStage(label,"execution",["status":"passed","trialsCompleted":outputs[label]!.count])
                    try setStage(label,"numerical",["status":allPass ? "passed" : "failed","trialsCompared":outputs[label]!.count])
                }
            }
            if let apple = outputs["apple"], let floor = outputs["floor"], apple.count == 12, floor.count == 12 {
                report["pairComparison"] = ["status":apple == floor ? "passed" : "failed","trialsCompared":12]
            }
            let observedFailure = ["apple","floor"].contains { label in
                ["pipeline","execution","numerical"].contains { stage in
                    ["failed","timed_out","incomplete"].contains(stageStatus(label,stage))
                }
            }
            if observedFailure { report["status"] = "failed"; report["reason"] = "An executed backend stage failed, independently of reference availability"; exitCode = 1 }
            else if stageStatus("apple","load") != "passed" { report["status"] = "unavailable"; report["reason"] = "Apple reference library could not load; paired GPU validation unavailable"; exitCode = 77 }
            else if ["apple","floor"].allSatisfy({ label in ["load","pipeline","execution","numerical"].allSatisfy { stageStatus(label,$0) == "passed" } }) {
                report["status"] = "passed"; exitCode = 0
            } else { report["status"] = "failed"; exitCode = 1 }
        } else { report["status"] = "unavailable"; report["reason"] = "No Metal device"; exitCode = 77 }
    }
    report["exitCode"] = exitCode; report["elapsedSeconds"] = Date().timeIntervalSince(started)
    try persist()
} catch {
    report["status"] = "failed"; report["failedStage"] = globalStage; report["error"] = String(describing:error); report["exitCode"] = 1
    do { try persist() } catch { fputs("Could not persist failure report: \(error)\n",stderr) }
    fputs("Placement harness failed: \(error)\n",stderr); exitCode = 1
}
exit(exitCode)
