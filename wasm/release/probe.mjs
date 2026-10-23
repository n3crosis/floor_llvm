// CI-only release integrity check. Each compilation gets a fresh process.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const expectedHeader = "694371baef693289d23f75c9b5721227b8290281c513dc81cc6f8f696b3ec7eb";
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
    result = module._air_compile_v2(pointer, bytes.length, test.ios, 0, 0);
    assert(result, "Compilation returned no result");
    const status = module._air_result_status(result);
    const output = heapSlice(module, module._air_result_data(result), module._air_result_size(result), outputLimit);
    const diagnostics = heapSlice(module, module._air_result_diagnostics(result),
      module._air_result_diagnostics_size(result), 64 * 1024);
    assert.equal(status, test.status,
      `${test.name}: ${new TextDecoder().decode(diagnostics).slice(0, 2048)}`);
    if (status === 0) {
      assert(output.length > 4, "Empty compiled library");
      assert.deepEqual(Array.from(output.subarray(0, 4)), [77, 84, 76, 66], "Missing MTLB magic");
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
