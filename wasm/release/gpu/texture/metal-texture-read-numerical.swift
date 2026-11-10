// Standalone paired GPU evidence for the exact authored MSL 4.1 read corpus.
// Never rebuilds, rewrites, or retargets either original iOS metallib.
// Build: xcrun swiftc -O metal-texture-read-numerical.swift -framework Metal -o metal-texture-read-numerical
// Run: --apple A.metallib --floor F.metallib --descriptors metal-texture-read-gpu-cases.json
//      --case NAME --pair-receipt pair.json --oracle-fixtures texture-read-oracle-fixtures.json --output NEW_DIRECTORY
// Exit 0=paired numerical pass; 1=failure; 77=unavailable (never a pass).
import Foundation
import Dispatch
import Metal
import CryptoKit

struct ProbeError: Error, CustomStringConvertible {
    let description: String
    init(_ text: String) { description = text }
}
struct Descriptor: Decodable {
    let name: String, source: String, sourceSha256: String, entry: String
    let api: Int, ios: Int, metalVersion: Int, math: Int, kind: Int, status: Int
    let msl41TextureRead: Bool, textureGeometry: String, textureReadMode: String
}
struct PairReceipt: Decodable {
    let schemaVersion: Int, api: Int, ios: Int, metalVersion: Int, math: Int
    let sourceSha256: String, appleMetallibSha256: String, floorMetallibSha256: String
}
struct Query: Decodable {
    let label: String, coordinate: [Int], offset: [Int]
    let lod: UInt32, layer: UInt32, expectedBits: [UInt32]
}
struct FixtureCase: Decodable { let geometry: String, mode: String, queries: [Query] }
struct Fixtures: Decodable {
    let schemaVersion: Int, pixelFormat: String, mipLevels: Int, arrayLayers: Int
    let baseDimensions: [Int], payload: String, cases: [FixtureCase]
}
let sourcePins: [String: String] = [
    "texture2d/boundaries": "58f6ca4f9cc852967775b070aadd6ba11a6d4c5f6e12ec603375308b1be466d5",
    "texture2d/defaults": "76f5c8d9c08724774012b6a505fc59a5049f6b1ae5cf8058ba60b1d182c0335c",
    "texture2d/dynamic": "1cb4fb976f3849c97812b2e00e8093338a67e9d0ab38c908fb0d7e872f569e30",
    "texture2d/mixed": "ac11e57e2f01392c7a57a6699c0d9f25a846a03ea1a64d562a16bb43ba1cce34",
    "texture2d_array/boundaries": "648edc5c32e91fb09c5cbb345f36bff363f700826899e3dbe93bf6a0088eeb49",
    "texture2d_array/defaults": "2ec0482c4a2193e6c125e3c093b5536accc43c2ff9c07fda9d5393bd4dc19889",
    "texture2d_array/dynamic": "5f742f795c21eb0c17f0d6db834970a31e63af27a84a98e9c585cac0607f7094",
    "texture2d_array/mixed": "362535b61ab7467fd821785223426c903775cbde49e4fbfad606392483493115",
    "texture3d/boundaries": "658dd065cbd701d024988a0384e2ac57ed6a592c35c2dae6d5007a176c1c704d",
    "texture3d/defaults": "6b06c69ebbc40f29457d4153ef2b5b4a5e14a8869424f1e363d3ee1ed96d85d6",
    "texture3d/dynamic": "841078873abf1c770a152939ea4b33a74ea85537f2bb8c93b9a5881182343395",
    "texture3d/mixed": "f9565f3753a11591dd0f5e5755a6fd3daeb4d12a87261479ff7a91149fbcfe57",
]
let oracleFixtureSHA256 = "ada170386aff9f8e4ff30840333ab74b647f4e80fc510ff3599ebe3a94bb9f62"
let started = Date()
let guardWord: UInt32 = 0x7fc12345
let names = ["apple", "floor"]
var outputDirectory: URL?
var report: [String: Any] = [
    "schemaVersion": 1, "kind": "msl41-texture-read", "status": "not_run",
    "os": ProcessInfo.processInfo.operatingSystemVersionString,
    "targetPolicy": "Original iOS27/MSL4.1 library bytes are hashed and loaded unchanged. No macOS retargeting.",
    "pipelineCreation": "not_run", "execution": "not_run", "numericalComparison": "not_run",
    "checkedValues": 0, "pairedComparison": "not_run", "backends": [:]
]
func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
func require(_ condition: Bool, _ message: String) throws { if !condition { throw ProbeError(message) } }
func option(_ key: String) throws -> String {
    let args = CommandLine.arguments
    guard args.filter({ $0 == key }).count == 1, let i = args.firstIndex(of: key), i+1 < args.count,
          !args[i+1].hasPrefix("--") else { throw ProbeError("Missing or duplicate \(key)") }
    return args[i+1]
}
func boundedFile(_ path: String, _ maximum: Int) throws -> Data {
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    guard attributes[.type] as? FileAttributeType == .typeRegular,
          let size = attributes[.size] as? NSNumber, size.intValue > 0, size.intValue <= maximum else {
        throw ProbeError("Input is not a bounded regular file: \(URL(fileURLWithPath:path).lastPathComponent)")
    }
    let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath:path)); defer { try? handle.close() }
    let data = try handle.read(upToCount: maximum+1) ?? Data()
    try require(data.count == size.intValue && data.count <= maximum, "Input changed or exceeded size bound")
    return data
}
func saveJSON(_ object: Any, _ filename: String) throws {
    guard let directory = outputDirectory else { throw ProbeError("No output directory") }
    try JSONSerialization.data(withJSONObject:object,options:[.prettyPrinted,.sortedKeys]).write(to:directory.appendingPathComponent(filename),options:.atomic)
}
func saveReport() throws { try saveJSON(report,"report.json") }
func backend(_ name: String) -> [String: Any] { (report["backends"] as? [String: [String: Any]])?[name] ?? [:] }
func setBackend(_ name: String, _ key: String, _ value: Any) {
    var all = report["backends"] as? [String: [String: Any]] ?? [:]
    var valueForBackend = all[name] ?? [:]; valueForBackend[key] = value; all[name] = valueForBackend; report["backends"] = all
}
func deadline() throws { try require(Date().timeIntervalSince(started) < 180, "180 second total probe budget exceeded") }
func wordsData(_ words: [UInt32]) -> Data {
    let values = words.map { $0.littleEndian }
    return values.withUnsafeBytes { Data($0) }
}
func newBuffer(_ words: [UInt32], _ device: MTLDevice) throws -> MTLBuffer {
    let bytes = wordsData(words)
    guard let result = bytes.withUnsafeBytes({ device.makeBuffer(bytes:$0.baseAddress!,length:$0.count,options:.storageModeShared) }) else {
        throw ProbeError("Buffer allocation failed")
    }
    return result
}
func complete(_ command: MTLCommandBuffer) throws {
    try deadline()
    let semaphore = DispatchSemaphore(value:0)
    command.addCompletedHandler { _ in semaphore.signal() }
    command.commit()
    try require(semaphore.wait(timeout:.now()+20) == .success, "GPU command completion exceeded 20 seconds")
    try require(command.status == .completed, "GPU command failed: \(String(describing:command.error))")
}
func dimensions(_ geometry: String, _ lod: Int) -> [Int] {
    [max(1,8 >> lod), max(1,4 >> lod)] + (geometry == "texture3d" ? [max(1,4 >> lod)] : [])
}
// A direct coordinate oracle, cross-checked against independently enumerated
// Python texels in the hash-pinned fixture before either library is loaded.
func oracle(_ descriptor: Descriptor, _ q: Query) -> [UInt32] {
    let geometry = descriptor.textureGeometry, mode = descriptor.textureReadMode
    let width = geometry == "texture3d" ? 3 : 2
    let lod = mode == "defaults" ? 0 : Int(q.lod)
    let layer = geometry == "texture2d_array" ? Int(q.layer) : 0
    let coords = mode == "boundaries" ? Array([-2,4,-1].prefix(width)) : q.coordinate
    let offsets = mode == "defaults" ? Array(repeating:0,count:width) : mode == "boundaries" ? Array([-8,7,1].prefix(width)) : q.offset
    func lookup(_ coordinates: [Int], clamp: Bool) -> [UInt32] {
        guard (0..<3).contains(lod), (0..<(geometry == "texture2d_array" ? 3 : 1)).contains(layer) else { return [0,0,0,0] }
        let extent = dimensions(geometry,lod)
        var effective = coordinates
        for axis in 0..<width {
            if clamp { effective[axis] = min(max(effective[axis],0),extent[axis]-1) }
            else if effective[axis] < 0 || effective[axis] >= extent[axis] { return [0,0,0,0] }
        }
        let x=effective[0], y=effective[1], z=width==3 ? effective[2] : 0
        return (0..<4).map { Float(1 + 10000*lod + 1000*layer + 100*z + 10*y + x).addingProduct(Float($0),0.25).bitPattern }
    }
    var result = lookup(zip(coords,offsets).map { $0.0 + $0.1 },clamp:true)
    if mode == "mixed" { result += lookup(q.coordinate,clamp:false) }
    return result
}
func texture(_ descriptor: Descriptor, _ device: MTLDevice) throws -> (MTLTexture, String, Int) {
    let geometry=descriptor.textureGeometry, desc=MTLTextureDescriptor()
    desc.textureType=geometry=="texture3d" ? .type3D : geometry=="texture2d_array" ? .type2DArray : .type2D
    desc.pixelFormat = .rgba32Float; desc.width=8; desc.height=4; desc.depth=geometry=="texture3d" ? 4 : 1
    desc.arrayLength=geometry=="texture2d_array" ? 3 : 1; desc.mipmapLevelCount=3; desc.usage = .shaderRead
    #if os(macOS)
    if #available(macOS 10.15, *) { desc.storageMode=device.hasUnifiedMemory ? .shared : .managed }
    else { desc.storageMode = .managed }
    #else
    desc.storageMode = .shared
    #endif
    guard let result=device.makeTexture(descriptor:desc) else { throw ProbeError("RGBA32Float texture allocation unavailable for \(geometry)") }
    var input=Data()
    for lod in 0..<3 {
        let size=dimensions(geometry,lod), depth=size.count==3 ? size[2] : 1
        for layer in 0..<desc.arrayLength {
            var values: [UInt32]=[]
            for z in 0..<depth { for y in 0..<size[1] { for x in 0..<size[0] {
                for channel in 0..<4 { values.append((Float(1 + 10000*lod + 1000*layer + 100*z + 10*y + x) + Float(channel)*0.25).bitPattern) }
            } } }
            let bytes=wordsData(values), rowBytes=size[0]*16, imageBytes=rowBytes*size[1]
            input.append(bytes)
            bytes.withUnsafeBytes { raw in
                result.replace(region:MTLRegionMake3D(0,0,0,size[0],size[1],depth),mipmapLevel:lod,slice:layer,
                               withBytes:raw.baseAddress!,bytesPerRow:rowBytes,bytesPerImage:imageBytes)
            }
        }
    }
    return (result,hash(input),input.count)
}
struct BackendResult { let outputs: [[UInt32]], pass: Bool }
func runBackend(_ name: String, _ library: MTLLibrary, _ descriptor: Descriptor, _ fixture: FixtureCase,
                _ device: MTLDevice, _ queue: MTLCommandQueue) -> BackendResult? {
    var stage="pipelineCreation", records:[[String:Any]]=[], raw=Data(), outputs:[[UInt32]]=[]
    var passed=true, checked=0, dispatches=0
    func persist() throws {
        guard let directory=outputDirectory else { throw ProbeError("No output directory") }
        let filename=name+"-output.bin";try raw.write(to:directory.appendingPathComponent(filename),options:.atomic)
        try saveJSON(records,name+"-queries.json")
        setBackend(name,"rawOutput",["file":filename,"sha256":hash(raw),"bytes":raw.count,"wordEndian":"little","guardWordsPerQuery":4])
        setBackend(name,"checkedValues",checked)
        try saveReport()
    }
    do {
        try deadline();setBackend(name,stage,["status":"in_progress"])
        guard let function=library.makeFunction(name:descriptor.entry) else { throw ProbeError("Missing exact source entry \(descriptor.entry)") }
        let pipeline=try device.makeComputePipelineState(function:function)
        // Each original function has its OWN argument encoder. Apple's compact
        // layout and FLOOR's sparse-ID layout are not interchangeable bytes.
        let argumentEncoder=function.makeArgumentEncoder(bufferIndex:0)
        try require(argumentEncoder.encodedLength>=16 && argumentEncoder.encodedLength<=4096,"Unexpected encoded argument-buffer size")
        setBackend(name,stage,["status":"passed","entry":descriptor.entry])
        stage="resourceSetup";setBackend(name,stage,["status":"in_progress"])
        let (image,payloadHash,payloadBytes)=try texture(descriptor,device)
        let samplerDescriptor=MTLSamplerDescriptor()
        samplerDescriptor.sAddressMode = .clampToEdge;samplerDescriptor.tAddressMode = .clampToEdge;samplerDescriptor.rAddressMode = .clampToEdge
        samplerDescriptor.minFilter = .nearest;samplerDescriptor.magFilter = .nearest;samplerDescriptor.mipFilter = .nearest
        // Integer read coordinates remain integer texel coordinates; normalized sampling is unused.
        samplerDescriptor.normalizedCoordinates=true;samplerDescriptor.supportArgumentBuffers=true
        samplerDescriptor.lodMinClamp=0;samplerDescriptor.lodMaxClamp=Float.greatestFiniteMagnitude
        guard let sampler=device.makeSamplerState(descriptor:samplerDescriptor),
              let resources=device.makeBuffer(length:argumentEncoder.encodedLength,options:.storageModeShared) else {
            throw ProbeError("Sampler or argument-buffer allocation failed")
        }
        memset(resources.contents(),0,resources.length)
        argumentEncoder.setArgumentBuffer(resources,offset:0)
        argumentEncoder.setTexture(image,index:1);argumentEncoder.setSamplerState(sampler,index:2)
        setBackend(name,"argumentBuffer",["encodedLength":argumentEncoder.encodedLength,"alignment":argumentEncoder.alignment,"textureID":1,"samplerID":2,"independentlyEncoded":true])
        setBackend(name,"texturePayload",["sha256":payloadHash,"bytes":payloadBytes,"pixelFormat":"rgba32Float","mipLevels":3,"baseDimensions":[8,4,descriptor.textureGeometry=="texture3d" ? 4 : 1],"arrayLayers":descriptor.textureGeometry=="texture2d_array" ? 3 : 1])
        setBackend(name,stage,["status":"passed"])
        stage="execution";setBackend(name,stage,["status":"in_progress","dispatches":0])
        let width=descriptor.textureGeometry=="texture3d" ? 3 : 2, stride=width==3 ? 4 : width
        let activeWords=descriptor.textureReadMode=="mixed" ? 8 : 4
        for (index,q) in fixture.queries.enumerated() {
            try deadline()
            var coords=q.coordinate.map { UInt32(bitPattern:Int32($0)) }, offsets=q.offset.map { UInt32(bitPattern:Int32($0)) }
            coords += Array(repeating:0,count:stride-width);offsets += Array(repeating:0,count:stride-width)
            let c=try newBuffer(coords,device),o=try newBuffer(offsets,device),lod=try newBuffer([q.lod],device),layer=try newBuffer([q.layer],device)
            let destination=try newBuffer(Array(repeating:guardWord,count:activeWords+4),device)
            guard let command=queue.makeCommandBuffer(),let encoder=command.makeComputeCommandEncoder() else { throw ProbeError("Command encoder creation failed") }
            encoder.setComputePipelineState(pipeline)
            encoder.setBuffer(resources,offset:0,index:0);encoder.setBuffer(c,offset:0,index:1);encoder.setBuffer(o,offset:0,index:2)
            encoder.setBuffer(lod,offset:0,index:3);encoder.setBuffer(destination,offset:0,index:4)
            if descriptor.textureGeometry=="texture2d_array" { encoder.setBuffer(layer,offset:0,index:5) }
            encoder.useResource(image,usage:.read) // Explicit residency for the indirect texture.
            encoder.dispatchThreadgroups(MTLSize(width:1,height:1,depth:1),threadsPerThreadgroup:MTLSize(width:1,height:1,depth:1))
            encoder.endEncoding();try complete(command);dispatches+=1
            let words=Array(UnsafeBufferPointer(start:destination.contents().assumingMemoryBound(to:UInt32.self),count:activeWords+4))
            let active=Array(words.prefix(activeWords)),guards=Array(words.suffix(4)),expected=oracle(descriptor,q)
            let matches=active==expected,guardIntact=guards.allSatisfy { $0==guardWord }
            passed = passed && matches && guardIntact;checked+=activeWords;outputs.append(active)
            let byteOffset=raw.count;raw.append(wordsData(words))
            records.append(["index":index,"label":q.label,"coordinate":q.coordinate,"offset":q.offset,"lod":q.lod,"layer":q.layer,
                            "expectedBits":expected,"actualBits":active,"guardBits":guards,"guardIntact":guardIntact,"pass":matches&&guardIntact,"rawByteOffset":byteOffset])
        }
        setBackend(name,"execution",["status":"completed","dispatches":dispatches])
        setBackend(name,"numericalComparison",["status":passed ? "passed":"failed","checkedValues":checked,"comparison":"Exact binary32 bits against independent CPU oracle; output guards checked"])
        stage="evidenceWrite";try persist();return BackendResult(outputs:outputs,pass:passed)
    } catch {
        setBackend(name,stage,["status":"failed","error":String(describing:error),"completedDispatches":dispatches])
        setBackend(name,"error",String(describing:error));setBackend(name,"partialEvidence",true)
        do { try persist() } catch { setBackend(name,"evidenceWriteError",String(describing:error)) }
        return nil
    }
}
func main() throws -> Int32 {
    let out=URL(fileURLWithPath:try option("--output"),isDirectory:true)
    if FileManager.default.fileExists(atPath:out.path) { try require(try FileManager.default.contentsOfDirectory(atPath:out.path).isEmpty,"Output directory must be new or empty") }
    else { try FileManager.default.createDirectory(at:out,withIntermediateDirectories:true) }
    outputDirectory=out
    let allowed=Set(["--apple","--floor","--descriptors","--case","--pair-receipt","--oracle-fixtures","--output"])
    try require(CommandLine.arguments.count==15 && stride(from:1,to:CommandLine.arguments.count,by:2).allSatisfy { allowed.contains(CommandLine.arguments[$0]) },"Unexpected CLI arguments")
    let descriptorBytes=try boundedFile(try option("--descriptors"),512*1024)
    let all=try JSONDecoder().decode([Descriptor].self,from:descriptorBytes),caseName=try option("--case")
    let selected=all.filter { $0.name==caseName };try require(selected.count==1,"Case name missing or duplicated")
    let descriptor=selected[0],sourceHash=hash(Data(descriptor.source.utf8)),key=descriptor.textureGeometry+"/"+descriptor.textureReadMode
    try require(sourcePins[key]==sourceHash && descriptor.sourceSha256==sourceHash,"Descriptor does not contain the exact frozen authored source")
    try require(descriptor.api==3 && descriptor.ios==27 && descriptor.metalVersion==410 && [0,1].contains(descriptor.math) && descriptor.kind==1 && descriptor.status==0 && descriptor.msl41TextureRead,"Wrong descriptor target/profile/feature")
    try require(descriptor.entry=="msl41_read_\(descriptor.textureGeometry)_\(descriptor.textureReadMode)","Wrong descriptor entry")
    try require(descriptor.name=="msl41-sampler-read-\(descriptor.textureGeometry)-\(descriptor.textureReadMode)-math\(descriptor.math)-kind1","Wrong descriptor case identity")
    let fixtureBytes=try boundedFile(try option("--oracle-fixtures"),512*1024)
    try require(hash(fixtureBytes)==oracleFixtureSHA256,"Independent oracle fixture identity mismatch")
    let fixtures=try JSONDecoder().decode(Fixtures.self,from:fixtureBytes)
    try require(fixtures.schemaVersion==1 && fixtures.pixelFormat=="rgba32Float" && fixtures.mipLevels==3 && fixtures.arrayLayers==3 && fixtures.baseDimensions==[8,4,4],"Wrong fixture geometry contract")
    let candidates=fixtures.cases.filter { $0.geometry==descriptor.textureGeometry && $0.mode==descriptor.textureReadMode }
    try require(candidates.count==1,"Missing or duplicate oracle case")
    let fixture=candidates[0],width=descriptor.textureGeometry=="texture3d" ? 3 : 2
    try require((1...128).contains(fixture.queries.count),"Oracle dispatch budget exceeded")
    for q in fixture.queries {
        try require(q.coordinate.count==width && q.offset.count==width && q.coordinate.allSatisfy { (-128...128).contains($0) } && q.offset.allSatisfy { (-8...7).contains($0) } && q.lod<=3 && q.layer<=3,"Invalid bounded query")
        try require(oracle(descriptor,q)==q.expectedBits,"Swift CPU oracle disagrees with independent enumerated fixture: \(q.label)")
    }
    report["descriptor"]=["name":descriptor.name,"entry":descriptor.entry,"sourceSha256":sourceHash,"ios":27,"metalVersion":410,"api":3,"math":descriptor.math,"geometry":descriptor.textureGeometry,"mode":descriptor.textureReadMode]
    report["oracle"]=["fixtureSha256":hash(fixtureBytes),"fixtureCrossCheck":"passed","queries":fixture.queries.count,"independentPythonEnumeration":true]
    try Data(descriptor.source.utf8).write(to:out.appendingPathComponent("source.metal"),options:.atomic)
    let receiptBytes=try boundedFile(try option("--pair-receipt"),16*1024),receipt=try JSONDecoder().decode(PairReceipt.self,from:receiptBytes)
    try require(receipt.schemaVersion==1 && receipt.api==3 && receipt.ios==27 && receipt.metalVersion==410 && receipt.math==descriptor.math && receipt.sourceSha256==sourceHash,"Pair receipt does not match exact source/target/profile")
    try receiptBytes.write(to:out.appendingPathComponent("pair-receipt.json"),options:.atomic)
    var libraries:[String:Data]=[:],artifacts:[[String:Any]]=[]
    for name in names {
        let path=try option("--"+name),bytes=try boundedFile(path,32*1024*1024),expected=name=="apple" ? receipt.appleMetallibSha256:receipt.floorMetallibSha256
        try require(bytes.prefix(4)==Data("MTLB".utf8) && hash(bytes)==expected,"Original \(name) library disagrees with pair receipt")
        libraries[name]=bytes;artifacts.append(["backend":name,"filename":URL(fileURLWithPath:path).lastPathComponent,"sha256":hash(bytes),"bytes":bytes.count,"loadedUnchanged":true])
        for stage in ["libraryLoading","pipelineCreation","resourceSetup","execution","numericalComparison"] { setBackend(name,stage,["status":"not_run"]) }
    }
    report["artifacts"]=artifacts;report["pairReceiptSha256"]=hash(receiptBytes);report["pairReceiptHashMatched"]=true
    try saveReport()
    guard let device=MTLCreateSystemDefaultDevice(),let queue=device.makeCommandQueue() else {
        report["status"]="unavailable";report["reason"]="No Metal device or command queue";try saveReport();return 77
    }
    report["device"]=device.name
    var loaded:[String:MTLLibrary]=[:]
    for name in names {
        do {
            let bytes=libraries[name]!,dispatchData=bytes.withUnsafeBytes { DispatchData(bytes:$0) }
            loaded[name]=try device.makeLibrary(data:dispatchData)
            setBackend(name,"libraryLoading",["status":"loaded"])
        } catch { setBackend(name,"libraryLoading",["status":"rejected","error":String(describing:error)]) }
    }
    // Attempt each available backend independently, even when its pair cannot load.
    // The final paired result remains unavailable if Apple rejects the original target.
    var results:[String:BackendResult]=[:]
    for name in names { if let library=loaded[name] { results[name]=runBackend(name,library,descriptor,fixture,device,queue) } }
    if loaded["apple"]==nil {
        report["status"]="unavailable";report["reason"]="Apple original library could not load on this host";try saveReport();return 77
    }
    if loaded["floor"]==nil {
        report["status"]="failed";report["reason"]="FLOOR original library rejected after Apple load succeeded";try saveReport();return 1
    }
    let paired=results.count==2 && results["apple"]!.outputs==results["floor"]!.outputs
    let passed=paired && results["apple"]?.pass==true && results["floor"]?.pass==true
    report["pairedComparison"]=paired ? "passed":"failed"
    report["pipelineCreation"]=names.allSatisfy { (backend($0)["pipelineCreation"] as? [String:Any])?["status"] as? String == "passed" } ? "passed":"failed"
    report["execution"]=names.allSatisfy { (backend($0)["execution"] as? [String:Any])?["status"] as? String == "completed" } ? "completed":"failed"
    report["numericalComparison"]=passed ? "passed":"failed"
    report["checkedValues"]=names.map { backend($0)["checkedValues"] as? Int ?? 0 }.reduce(0,+)
    report["status"]=passed ? "passed":"failed"
    try saveReport();return passed ? 0:1
}
var code:Int32=1
do { code=try main() }
catch {
    report["status"]="failed";report["error"]=String(describing:error)
    if outputDirectory != nil { do { try saveReport() } catch { fputs("Evidence report write failed: \(error)\n",stderr) } }
    fputs("Texture read probe failed: \(error)\n",stderr)
}
exit(code)
