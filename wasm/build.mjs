import process from "node:process";
// Build-time developer tooling only. Never imported by the browser application.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "source-lock.json"), "utf8"));
const [command, ...args] = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error(`Missing ${name} value`);
  return args[i + 1];
}
const work = resolve(option("--work", join(root, "work")));
const jobs = Number(option("--jobs", "2"));
if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 16) throw Error("jobs must be 1..16");
const source = resolve(root, "..");
const build = join(work, "build");
const apiBuild = join(work, "api-build");
async function digest(path) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
function run(binary, argv, extra = {}) {
  const result = spawnSync(binary, argv, { stdio: "inherit", ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${binary} failed: ${result.status ?? result.signal}`);
}
async function checkSource() {
  for (const [path, expected] of Object.entries(manifest.compilerFiles))
    if ((await digest(join(source, path))) !== expected)
      throw Error(`Fork compiler source mismatch: ${path}`);
  for (const [path, expected] of Object.entries(manifest.sdkFiles))
    if ((await digest(join(root, path))) !== expected)
      throw Error(`Fork WASM SDK source mismatch: ${path}`);
  // Storage layout must not change after record lowering and optimization.
  // Check the actual prepared sources, not a duplicated expected layout string.
  const target = await readFile(join(source, "clang/lib/Basic/Targets/SPIR.h"), "utf8");
  const finalization = await readFile(
    join(source, "llvm/lib/Transforms/LibFloor/MetalFinal.cpp"),
    "utf8",
  );
  const initialLayout = target.match(
    /class LLVM_LIBRARY_VISIBILITY AIR64TargetInfo\b[\s\S]*?resetDataLayout\("([^"]+)"\);/,
  );
  const finalLayouts = [...finalization.matchAll(/\bMod\.setDataLayout\("([^"]+)"\);/g)];
  if (!initialLayout || finalLayouts.length !== 1 || initialLayout[1] !== finalLayouts[0][1])
    throw Error("AIR64 initial and final storage DataLayouts must match");
}
if (command === "build" || command === "build-host-tools") {
  await checkSource();
  run("cmake", [
    "-S",
    join(source, "llvm"),
    "-B",
    build,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DLLVM_ENABLE_PROJECTS=clang",
    "-DLLVM_TARGETS_TO_BUILD=",
    "-DLLVM_ENABLE_ASSERTIONS=ON",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_INCLUDE_EXAMPLES=OFF",
    "-DLLVM_INCLUDE_BENCHMARKS=OFF",
    "-DLLVM_ENABLE_ZLIB=OFF",
    "-DLLVM_ENABLE_ZSTD=OFF",
    "-DLLVM_ENABLE_LIBXML2=OFF",
    "-DLLVM_ENABLE_TERMINFO=OFF",
    "-DLLVM_ENABLE_CURL=OFF",
    "-DCLANG_ENABLE_ARCMT=OFF",
    "-DCLANG_ENABLE_STATIC_ANALYZER=OFF",
    `-DLLVM_PARALLEL_COMPILE_JOBS=${jobs}`,
    "-DLLVM_PARALLEL_LINK_JOBS=1",
  ]);
  run("cmake", [
    "--build",
    build,
    "--target",
    ...(command === "build-host-tools" ? ["llvm-tblgen", "clang-tblgen"] : ["clang"]),
    "--parallel",
    String(jobs),
  ]);
  // 浏览器构建只需要本机表生成器，不必构建或执行完整本机 Clang/API。
  // Browser builds need native table generators only, not a full native Clang/API build or execution.
  if (command === "build") {
    run("cmake", [
      "-S",
      join(root, "api"),
      "-B",
      apiBuild,
      "-G",
      "Ninja",
      "-DCMAKE_BUILD_TYPE=Release",
      `-DLLVM_DIR=${join(build, "lib/cmake/llvm")}`,
      `-DClang_DIR=${join(build, "lib/cmake/clang")}`,
    ]);
    run("cmake", [
      "--build",
      apiBuild,
      "--target",
      "air_api",
      "--parallel",
      "1",
    ]);
  }
} else if (command === "build-wasm") {
  await checkSource();
  // Activate the official Emscripten SDK in the caller's shell first. No downloads
  // or SDK installation are performed by this developer-only command.
  const version = spawnSync("emcc", ["--version"], { encoding: "utf8" });
  if (version.error) throw version.error;
  if (version.status !== 0 || !/\b4\.0\.20\b/.test(version.stdout))
    throw Error("Activate Emscripten 4.0.20 before build-wasm");
  const nativeBuild = resolve(option("--native-build", build));
  const wasmBuild = join(work, "build-wasm");
  const wasmApiBuild = join(work, "api-build-wasm");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const llvmTablegen = join(nativeBuild, "bin", `llvm-tblgen${suffix}`);
  const clangTablegen = join(nativeBuild, "bin", `clang-tblgen${suffix}`);
  if (!existsSync(llvmTablegen) || !existsSync(clangTablegen))
    throw Error("Native llvm-tblgen and clang-tblgen are required; run build-host-tools first");
  run("emcmake", [
    "cmake",
    "-S",
    join(source, "llvm"),
    "-B",
    wasmBuild,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DLLVM_ENABLE_ASSERTIONS=ON",
    "-DLLVM_ENABLE_PROJECTS=clang",
    "-DLLVM_TARGETS_TO_BUILD=",
    "-DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten",
    "-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-emscripten",
    `-DLLVM_TABLEGEN=${llvmTablegen}`,
    `-DCLANG_TABLEGEN=${clangTablegen}`,
    "-DLLVM_ENABLE_THREADS=OFF",
    "-DLLVM_ENABLE_ZLIB=OFF",
    "-DLLVM_ENABLE_ZSTD=OFF",
    "-DLLVM_ENABLE_LIBXML2=OFF",
    "-DLLVM_ENABLE_TERMINFO=OFF",
    "-DLLVM_ENABLE_LIBEDIT=OFF",
    "-DLLVM_ENABLE_LIBPFM=OFF",
    "-DLLVM_ENABLE_CURL=OFF",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_INCLUDE_EXAMPLES=OFF",
    "-DLLVM_INCLUDE_BENCHMARKS=OFF",
    "-DLLVM_INCLUDE_UTILS=OFF",
    "-DLLVM_BUILD_TOOLS=OFF",
    "-DCLANG_BUILD_TOOLS=OFF",
    "-DCLANG_ENABLE_ARCMT=OFF",
    "-DCLANG_ENABLE_STATIC_ANALYZER=OFF",
    "-DLLVM_PARALLEL_LINK_JOBS=1",
    "-DLLVM_ENABLE_LTO=OFF",
  ]);
  run("cmake", [
    "--build",
    wasmBuild,
    "--parallel",
    String(jobs),
    "--target",
    "clangCodeGen",
    "clangFrontend",
    "LLVMMetalLib",
    "LLVMBitWriter140",
  ]);
  run("emcmake", [
    "cmake",
    "-S",
    join(root, "api"),
    "-B",
    wasmApiBuild,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG",
    `-DLLVM_DIR=${join(wasmBuild, "lib/cmake/llvm")}`,
    `-DClang_DIR=${join(wasmBuild, "lib/cmake/clang")}`,
  ]);
  run("cmake", ["--build", wasmApiBuild, "--parallel", "1", "--target", "air_wasm"]);
} else if (command === "check") {
  await checkSource();
  console.log("Verified fork compiler sources and WASM SDK; no code compiled or executed");
} else {
  console.log("Usage: node wasm/build.mjs check|build-host-tools|build-wasm|build [--work DIR] [--jobs 2]");
  if (command && command !== "help") process.exitCode = 1;
}
