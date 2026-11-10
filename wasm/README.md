# AIR compiler WebAssembly SDK

This directory provides a reusable in-process C API, authored compatibility headers, and a WebAssembly build for the open-source Metal/AIR compiler. Compiler changes live directly in `clang/` and `llvm/`; no patch application is required.

## Build

Use Linux, Node.js 24, a C++20 compiler, CMake 3.20 or newer, and Ninja. Activate official Emscripten 4.0.20 from emsdk commit `e4fe26ef59168ff44f4c23c466e497bf60b3411e`. The build script does not download or install tools.

From the repository root:

```sh
node wasm/build.mjs check
node wasm/build.mjs build-host-tools --work /path/to/build-output --jobs 2
node wasm/build.mjs build-wasm --work /path/to/build-output --jobs 2
```

The outputs are `api-build-wasm/air_wasm.mjs` and `api-build-wasm/air_wasm.wasm` beneath the selected work directory. Native TableGen tools, crosscompiled libraries, and the API module use separate build directories. `--native-build DIR` can select matching existing native TableGen tools. The optional `build` command builds native Clang and the C API library.

The recipe uses Release `-O1 -DNDEBUG`, assertions, explicit wasm32 host/default triples, threads off, SPIR-V off, no LTO, no optional external libraries, and one linker job. The API is built as C++20 without RTTI when required by the compiler libraries.

## API and embedding

See `api/air_compiler.h`. The exported `air_*` C functions support synchronous source compilation, output/diagnostic access, result ownership, and header identity. API version 2 and header-bundle version 2 remain explicit. The header fingerprint uses the `floor-air-header-bundle-v2` domain and sorted compatibility-header content hashes.

The module is an ES6 modularized Worker factory. Instantiate it from verified WASM bytes with an explicit `instantiateWasm` callback, reacquire `Module.HEAPU8` after calls that may grow memory, and copy result bytes before freeing the result. The recipe exports the heap view, starts at 64 MiB memory, allows up to 2 GiB, uses an 8 MiB stack, and disables the filesystem. Consumers own worker lifecycle, input/output limits, and result validation.

The embedded headers are an authored open-source compatibility subset, not Apple SDK headers. Source/header/build changes require a matching fresh compiler build and new artifact/header identity. Source integrity checks alone do not establish browser, Apple loader, GPU, numerical, or application acceptance, and byte-identical rebuilds across build paths and tool versions are not promised.

## Distribution

Binary distributions must include matching complete corresponding source, modifications, build scripts, and applicable notices. Keep compiler source versions and binary receipts accurate; do not assign a new source identity to an older binary.
