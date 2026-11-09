// CI-only release integrity check. Each compilation gets a fresh process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const expectedHeader = "5b12c0fd953caf1d7a470478f47cc0e81340fb6677934dc79786e27dd4de97c5";
const outputLimit = 64 * 1024 * 1024;
const requiredExports = [
  "malloc", "free", "air_compile_v1", "air_compile_v2", "air_result_status",
  "air_result_data", "air_result_size", "air_result_diagnostics",
  "air_result_diagnostics_size", "air_result_free", "air_compiler_header_sha256",
  "air_compiler_header_bundle_version",
];
// Original synthetic input, not a compatibility corpus or application shader.
const source = "#include <metal_stdlib>\nusing namespace metal;\nkernel void smoke_write(device unsigned int *output [[buffer(0)]]) { output[0] = 1u; }\n";
const cases = [
  { name: "kernel-metallib", source, ios: 18, status: 0 },
  { name: "invalid-source", source: "kernel void broken( {\n", ios: 18, status: 3 },
  { name: "bad-options", source, ios: 0, status: 2 },
];
// Authored vertex regressions exercise empty AIR return/argument metadata.
// They are intentionally independent of any game's shader or SDK files.
const metalHeader = "#include <metal_stdlib>\nusing namespace metal;\n";
const vertexCases = {
  "void-vertex-write": "vertex void capture_vertex(device uint* output [[buffer(0)]], uint id [[vertex_id]]) { output[id] = id; }",
  "void-vertex-empty": "vertex void empty_vertex() {}",
  "position-vertex-no-arguments": "struct Out { float4 position [[position]]; }; vertex Out constant_vertex() { Out o; o.position = float4(0.0f,0.0f,0.0f,1.0f); return o; }",
  "position-vertex-input": "struct In { float4 position [[attribute(0)]]; }; struct Out { float4 position [[position]]; }; vertex Out passthrough_vertex(In input [[stage_in]]) { Out o; o.position = input.position; return o; }",
  "compute-write": "kernel void fill(device uint* output [[buffer(0)]]) { output[0] = 1u; }",
  "fragment-color": "fragment float4 color_fragment() { return float4(1.0f); }",
};
for (const ios of [18, 26]) for (const math of [0, 1]) {
  for (const [shader, body] of Object.entries(vertexCases)) {
    for (const kind of shader.startsWith("void-vertex") ? [0, 1] : [0]) {
      cases.push({ name: `${shader}-ios${ios}-math${math}-kind${kind}`,
        source: metalHeader + body, ios, math, kind, shader, status: 0 });
    }
  }
}

// Authored math and color-side regressions. No title inputs or SDK headers.
const mathBody = `kernel void exact_math(device uint* out [[buffer(0)]]) {
  out[0]=all(int4(-1,-2,-3,-4)); out[1]=all(int4(-1,0,-1,-1));
  out[2]=all(int4(1,1,1,1));
  out[3]=as_type<uint>(saturate(as_type<float>(0x7fc12345u)));
  out[4]=as_type<uint>(saturate(-0.0f)); out[5]=as_type<uint>(saturate(0.5f));
  out[6]=as_type<uint>(floor(-1.25f)); out[7]=as_type<uint>(floor(-0.0f));
  out[8]=as_type<uint>(floor(as_type<float>(0x7fc12345u)));
}`;
const colorBody = `#pragma clang fp contract(off)
struct Out { float4 color [[color(0)]]; };
constant bool enabled [[function_constant(200)]];
fragment Out color_side(float4 current [[color(0),function_constant(enabled)]], constant uint4* mask [[buffer(29)]]) {
  Out o; o.color=float4(0.5f);
  if(enabled && !all(mask[0]==uint4(0u))) o.color=floor(saturate(current)*255.0f+0.5f)/255.0f;
  return o;
}`;
for (const ios of [18,26]) for(const math of [0,1]) {
  cases.push({name:`color-side-ios${ios}-math${math}`,source:metalHeader+colorBody,ios,math,status:0});
  cases.push({name:`math-helpers-ios${ios}-math${math}`,source:metalHeader+mathBody,ios,math,status:0});
  cases.push({name:`reject-integer-saturate-ios${ios}-math${math}`,
    source:metalHeader+'kernel void bad(device int* out [[buffer(0)]]) { out[0]=saturate(2); }',ios,math,status:3});
}
cases.push({name:'exact-math-ir',source:metalHeader+mathBody,ios:18,math:0,kind:1,shader:'exact-math',status:0});

// Generic authored vertex-storage and normalized-unpack probes. Intrinsics use
// the existing AIR ABI, while packed storage and mask arithmetic stay explicit.
const packedBody = `kernel void packed_read(device const packed_uint2* p2 [[buffer(0)]],
  device const packed_uint3* p3 [[buffer(1)]], device const packed_uint4* p4 [[buffer(2)]],
  device uint* out [[buffer(3)]], device const uint* index [[buffer(4)]],
  constant packed_uint3* cp3 [[buffer(5)]]) {
  uint id=index[0];
  uint2 a=uint2(p2[id]); uint3 b=uint3(p3[id]); uint4 c=uint4(p4[id]);
  packed_uint3 local={id,id+1u,id+2u}; uint3 local3=uint3(local), constant3=uint3(cp3[id]);
  out[id*9+0]=a.x+local3.x+constant3.x; out[id*9+1]=a.y;
  out[id*9+2]=b.x; out[id*9+3]=b.y; out[id*9+4]=b.z;
  out[id*9+5]=c.x; out[id*9+6]=c.y; out[id*9+7]=c.z; out[id*9+8]=c.w;
}`;
const unpackBody = `kernel void unpack_words(device const uint* in [[buffer(0)]], device float4* out [[buffer(1)]]) {
  uint v=in[0];
  out[0]=unpack_unorm4x8_to_float(v); out[1]=unpack_snorm4x8_to_float(v);
  out[2]=float4(unpack_unorm2x16_to_float(v),0.0f,0.0f);
  out[3]=float4(unpack_snorm2x16_to_float(v),0.0f,0.0f);
  out[4]=unpack_unorm10a2_to_float(v);
}`;
const selectBody = `kernel void select_masks(device uint4* out [[buffer(0)]], device const float4* in [[buffer(1)]]) {
  out[0]=select(uint4(11u),uint4(22u),int4(-1,0,1,(-2147483647-1)));
  out[1]=as_type<uint4>(max(in[0],-1.0f));
  out[2]=as_type<uint4>(select(float4(0.0f),float4(-0.0f),int4(-1,0,1,-1)));
  float nan=as_type<float>(0x7fc12345u);
  out[3]=as_type<uint4>(float4(max(-0.0f,0.0f),max(0.0f,-0.0f),max(nan,0.25f),max(-0.0f,nan))) ^ uint4(256u);
  out[4]=uint4(as_type<uint>(max(nan,as_type<float>(0x7fc54321u))) ^ 256u);
}`;
for (const ios of [18,26]) for (const math of [0,1]) {
  for (const [shader,body] of Object.entries({packed:packedBody,unpack:unpackBody,select:selectBody}))
    cases.push({name:`${shader}-ios${ios}-math${math}`,source:metalHeader+body,ios,math,status:0});
  cases.push({name:`reject-user-unpack-asm-ios${ios}-math${math}`,source:metalHeader+
    'float4 fake(uint) __asm__("air.unpack.unorm4x8.v4f32") __attribute__((const)); kernel void bad(device float4* out [[buffer(0)]]) { out[0]=fake(1u); }',ios,math,status:3});
  cases.push({name:`reject-line-spoof-unpack-asm-ios${ios}-math${math}`,source:metalHeader+
    '#line 1 "/include/metal_math"\nfloat4 fake(uint) __asm__("air.unpack.unorm4x8.v4f32") __attribute__((const)); kernel void bad(device float4* out [[buffer(0)]]) { out[0]=fake(1u); }',ios,math,status:3});
}
for (const [shader,body] of Object.entries({packed:packedBody,unpack:unpackBody,select:selectBody}))
  cases.push({name:`${shader}-ir`,source:metalHeader+body,ios:18,math:0,kind:1,shader,status:0});

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    assert(["--build", "--header", "--output", "--case"].includes(key), "Unknown option");
    assert(args[i + 1] && !args[i + 1].startsWith("--") && !(key in result), "Invalid option");
    result[key] = args[i + 1];
  }
  assert(result["--build"] && result["--header"] === expectedHeader,
    "Usage: node probe.mjs --build DIR --header EXPECTED_SHA --output REPORT.json");
  assert(Boolean(result["--output"]) !== Boolean(result["--case"]), "Specify output or internal case");
  return result;
}

async function boundedFile(path, maximum) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= maximum,
    `Invalid bounded input: ${path}`);
  const bytes = await readFile(path);
  assert.equal(bytes.length, info.size, "Input changed while reading");
  return bytes;
}

function heapSlice(module, pointer, length, maximum) {
  assert(Number.isSafeInteger(pointer) && pointer >= 0, "Invalid result pointer");
  assert(Number.isSafeInteger(length) && length >= 0 && length <= maximum, "Invalid result length");
  assert((length === 0 || pointer > 0) && pointer + length <= module.HEAPU8.length,
    "Result is outside WASM memory");
  return module.HEAPU8.subarray(pointer, pointer + length);
}

async function runCase(build, name) {
  const test = cases.find((candidate) => candidate.name === name);
  assert(test, "Unknown smoke case");
  const entry = pathToFileURL(resolve(build, "air_wasm.mjs")).href;
  await boundedFile(resolve(build, "air_wasm.mjs"), 1024 * 1024);
  const wasm = await boundedFile(resolve(build, "air_wasm.wasm"), 128 * 1024 * 1024);
  globalThis.self = globalThis;
  globalThis.location = { href: "https://invalid.test/isolated-worker.mjs" };
  const noNetwork = () => { throw new Error("Probe network access is forbidden"); };
  globalThis.fetch = globalThis.importScripts = noNetwork;
  globalThis.XMLHttpRequest = globalThis.WebSocket = noNetwork;
  const compiled = await WebAssembly.compile(wasm);
  const factory = (await import(entry)).default;
  assert.equal(typeof factory, "function", "Missing ES module factory");
  const module = await factory({
    print() {}, printErr() {}, locateFile: noNetwork,
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(compiled, imports);
      receive(instance, compiled);
      return instance.exports;
    },
  });
  for (const name of requiredExports)
    assert.equal(typeof module[`_${name}`], "function", `Missing public export: ${name}`);
  assert(module.HEAPU8 instanceof Uint8Array, "Missing exported memory view");
  const header = heapSlice(module, module._air_compiler_header_sha256(), 65, 65);
  assert.equal(header[64], 0, "Header identity is not terminated");
  assert.equal(new TextDecoder().decode(header.subarray(0, 64)), expectedHeader, "Header identity mismatch");
  assert.equal(module._air_compiler_header_bundle_version(), 2, "Header bundle version mismatch");

  const bytes = new TextEncoder().encode(test.source);
  const pointer = module._malloc(bytes.length);
  assert(pointer, "Source allocation failed");
  let result = 0;
  try {
    heapSlice(module, pointer, bytes.length, 4096).set(bytes);
    result = module._air_compile_v2(pointer, bytes.length, test.ios, test.kind ?? 0, test.math ?? 0);
    assert(result, "Compilation returned no result");
    const status = module._air_result_status(result);
    const output = heapSlice(module, module._air_result_data(result), module._air_result_size(result), outputLimit);
    const diagnostics = heapSlice(module, module._air_result_diagnostics(result),
      module._air_result_diagnostics_size(result), 64 * 1024);
    assert.equal(status, test.status,
      `${test.name}: ${new TextDecoder().decode(diagnostics).slice(0, 2048)}`);
    if (status === 0) {
      assert(output.length > 4, "Empty compiled library");
      if (test.kind === 1 && test.shader === "exact-math") {
        const ir = new TextDecoder("utf-8", { fatal: true }).decode(output);
        assert(ir.includes("!air.kernel"), "Missing AIR compute metadata");
        assert(!ir.includes("air.fast_floor"), "Conservative floor used fast intrinsic");
        for (const constant of ["1056964608", "-1073741824", "-2147483648", "2143363909"])
          assert(ir.includes(constant), "Missing exact math result " + constant);
      } else if (test.kind === 1 && ["packed","unpack","select"].includes(test.shader)) {
        const ir = new TextDecoder("utf-8", { fatal: true }).decode(output);
        assert(ir.includes("!air.kernel"), "Missing AIR compute metadata");
        if (test.shader === "unpack") {
          for (const symbol of ["air.unpack.unorm4x8.v4f32","air.unpack.snorm4x8.v4f32",
              "air.unpack.unorm2x16.v2f32","air.unpack.snorm2x16.v2f32","air.unpack.unorm.rgb10a2.v4f32"])
            assert(ir.includes(symbol), "Missing exact unpack intrinsic " + symbol);
          assert(!ir.includes("fdiv"), "Normalized unpack became approximate division");
        } else if (test.shader === "packed") {
          assert(/load [^\n]+align 4/.test(ir), "Packed input lost scalar alignment");
          assert(ir.includes("packed_uint3"), "Packed storage identity was lost");
          assert(/type (?:<)?\{ i32, i32, i32 \}(?:>)?/.test(ir), "Packed three-word layout was lost");
        } else {
          assert(!ir.includes("air.fast_fmax"), "Conservative maximum used a fast intrinsic");
          assert(ir.includes("<i32 256, i32 256, i32 1048576256, i32 -2147483392>"), "Maximum changed NaN or signed-zero selection");
          assert(ir.includes("2143633953"), "Two-NaN maximum lost the selected payload");
          assert(ir.includes("<i32 22, i32 11, i32 11, i32 22>"), "Comparison-mask sign-bit selection changed");
          assert(ir.includes("<i32 -2147483648, i32 0, i32 0, i32 -2147483648>") ||
            ir.includes("<float -0.000000e+00, float 0.000000e+00, float 0.000000e+00, float -0.000000e+00>"), "Vector select lost signed zero");
        }
      } else if (test.kind === 1) {
        const ir = new TextDecoder("utf-8", { fatal: true }).decode(output);
        assert(ir.includes("!air.vertex"), "Missing AIR vertex metadata");
        assert.match(ir, /!\d+ = !\{\}/, "Expected empty return/argument metadata");
        if (test.shader === "void-vertex-write") {
          assert.match(ir, /define void @capture_vertex\(/, "Missing void vertex entry");
          assert.match(ir, /store i32 %id,/, "Vertex output write was lost");
        }
      } else {
        assert.deepEqual(Array.from(output.subarray(0, 4)), [77, 84, 76, 66], "Missing MTLB magic");
      }
    } else {
      assert.equal(output.length, 0, "Rejected input produced output");
      assert(diagnostics.length > 0, "Rejected input has no diagnostic");
    }
    return { name, passed: true, status, outputBytes: output.length, diagnosticBytes: diagnostics.length };
  } finally {
    if (result) module._air_result_free(result);
    module._free(pointer);
  }
}

async function main() {
  const args = options(process.argv.slice(2));
  assert.equal(process.env.CI, "true", "Compiler probes run only in CI");
  const build = resolve(args["--build"]);
  if (args["--case"]) {
    process.stdout.write(JSON.stringify(await runCase(build, args["--case"])) + "\n");
    return;
  }
  const deadline = Date.now() + 300_000;
  const results = [];
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  for (const test of cases) {
    const remaining = deadline - Date.now();
    assert(remaining > 0, "Overall probe deadline exceeded");
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url),
      "--build", build, "--header", expectedHeader, "--case", test.name], {
      env, encoding: "utf8", timeout: Math.min(120_000, remaining),
      killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    });
    assert(!child.error && child.status === 0,
      `${test.name} failed: ${child.error?.message ?? child.stderr ?? child.signal}`);
    const result = JSON.parse(child.stdout.trim());
    assert(result.name === test.name && result.passed === true && result.status === test.status,
      "Invalid child report");
    results.push(result);
  }
  const report = {
    schemaVersion: 1, exportsVerified: true, headerVerified: true,
    abiVersion: 2, headerBundleVersion: 2, headerSha256: expectedHeader,
    smoke: { passed: true, cases: results }, browserExecutionVerified: false,
    deviceExecutionVerified: false, gpuExecutionVerified: false, fullApplicationVerified: false,
  };
  await writeFile(resolve(args["--output"]), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}

main().catch((error) => {
  process.stderr.write(`AIR release probe: ${error.stack ?? error}\n`);
  process.exitCode = 1;
});
