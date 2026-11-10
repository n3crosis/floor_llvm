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

See `api/air_compiler.h`. The exported `air_*` C functions support synchronous source compilation, output/diagnostic access, result ownership, and header identity. API versions 1, 2 and 3 and header-bundle version 2 remain explicit. The header fingerprint uses the `floor-air-header-bundle-v2` domain and sorted compatibility-header content hashes.

The module is an ES6 modularized Worker factory. Instantiate it from verified WASM bytes with an explicit `instantiateWasm` callback, reacquire `Module.HEAPU8` after calls that may grow memory, and copy result bytes before freeing the result. The recipe exports the heap view, starts at 64 MiB memory, allows up to 2 GiB, uses an 8 MiB stack, and disables the filesystem. Consumers own worker lifecycle, input/output limits, and result validation.

The embedded headers are an authored open-source compatibility subset, not Apple SDK headers. Source/header/build changes require a matching fresh compiler build and new artifact/header identity. Source integrity checks alone do not establish browser, Apple loader, GPU, numerical, or application acceptance, and byte-identical rebuilds across build paths and tool versions are not promised.

## Explicit Metal language mode (API v3)

`air_compile_v3(source, size, ios_major, output_kind, math_profile, metal_version)`
accepts exactly these initial pairs:

- iOS 18 + `AIR_METAL_3_2` (320), AIR 2.7 / MSL 3.2.
- iOS 26 + `AIR_METAL_4_0` (400), AIR 2.8 / MSL 4.0.
- iOS 27 + `AIR_METAL_4_1` (410), AIR 2.9 / MSL 4.1.

There is no downgrade or automatic fallback. Other pairs return `AIR_BAD_OPTIONS`.
The compiler defines `__METAL__` and `__METAL_VERSION__` from its actual language
options. The 4.1 mode uses C++17; the public API rejects later-C++ extensions and
selected prohibited constructs before code generation. A final-expanded-token
check rejects `__extension__`, including macro expansions, so it cannot silence
the later-language diagnostics; diagnostics in system headers remain enabled. Placement new is valid MSL
4.1 but is explicitly unsupported by this header bundle. Source-mode selection
and AIR/VERS consistency are narrower claims than complete language, standard
library, Apple loader, GPU or application compatibility.

v1/v2 keep their ABI, existing iOS 18/26 targets and Metal 3.2 default. A known
legacy iOS 26 inconsistency is intentionally not rewritten in this increment:
its IR says AIR 2.7 / MSL 3.2 while the old OS-selected metallib VERS says AIR 2.8 /
MSL 4.0. Use an explicit v3 tuple when version coherence is required. The matched
v3 tuples are checked against actual frontend options and emitted IR; release
probes decode each metallib entry's VERS instead of trusting a label.

Focused checks (from repository root):

```sh
g++ -std=c++17 -Wall -Wextra -Werror wasm/api/tests/target-options.cpp -o /tmp/air-target-options
/tmp/air-target-options
node --test wasm/release/metal-language.test.mjs wasm/release/metallib-metadata.test.mjs
```

These dependency-free checks test option selection and evidence validators, not
a newly built compiler. Native lit cases and the updated WASM release probe must
run against a fresh compiler build. Apple reference validation additionally needs
a toolchain that demonstrably accepts `-std=metal4.1` and OS 27; Xcode 26+ alone
is insufficient. Retain compile, link, library-load and GPU-result outcomes as
separate evidence, and never silently run the 4.0 reference as a 4.1 fallback.

## Distribution

Binary distributions must include matching complete corresponding source, modifications, build scripts, and applicable notices. Keep compiler source versions and binary receipts accurate; do not assign a new source identity to an older binary.

