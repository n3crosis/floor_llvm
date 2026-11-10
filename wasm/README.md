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
the later-language diagnostics; diagnostics in system headers remain enabled. The version-gated `metal_common` header provides scalar and constant-bound array
placement construction in explicit `thread`, `threadgroup`, and `device` storage,
including constructors, explicit destructors, and over-aligned types. The caller
owns sufficient correctly aligned storage, object lifetimes, and synchronization.
Runtime-bound arrays, custom allocation operators, heap allocation, and delete
remain rejected. Source-mode selection
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


## Metal 4.1 sampler-backed texture reads

The authored texture subset exposes `read(sampler, intN, ..., intN offset, uint lod)`
for `texture2d<float>`, `texture2d_array<float>`, and `texture3d<float>` with
`access::sample`, carried in the existing `[[id]]` argument-buffer resource ABI.
Direct `[[texture]]` and `[[sampler]]` entry bindings remain unsupported. The 2D-array layer precedes the offset. All four implicit-object
address spaces have matching overloads. Defaults remain offset zero and LOD zero.
The sampler and signed offset are preserved as separate AIR operands so addressing
occurs after the offset. Constant offsets outside [-8, 7] are rejected; callers
must keep dynamic offsets within that range. Sampler-less reads are unchanged.

These overloads require actual Metal 4.1 mode. This increment does not implement
read/read_write texture specializations, additional color types, 1D/cube/depth/
multisample textures, sparse reads, block reads, or texture atomics. It does not
claim those wider Metal 4.1 features through the three supported shapes.

`node --test wasm/release/msl41-texture-read.test.mjs` checks the bounded release
case matrix and validator mutation tests. The release probe checks actual rebuilt
IR operand provenance, argument bindings, AIR/MSL versions, and metallib VERS.
The Apple reference gate compiles the same positive sources without substituting
an older standard. Apple compilation, FLOOR compilation, library load, and GPU
results remain separate evidence; no texture GPU execution is implied by a
compile/IR test or the existing integer/derivative/interleave GPU harness.


## Metal 4.1 unsigned atomic memory ordering

The existing `atomic_uint` fetch operations now have explicit four-argument
`(object, value, order, flags)` overloads in Metal 4.1: add/min in device memory
and add/min/max in threadgroup memory. Ordinary and volatile object pointers are
supported by these new overloads. Valid constant orders are relaxed, acquire,
release, acquire-release and sequentially consistent; valid constant memory flags
are the five defined memory-space bits and their combinations, including none.
The ordinary three-argument form remains relaxed-only. No default flags argument
silently enables a non-relaxed three-argument call.

Native Apple 32023.922 references establish that MSL 4.1 uses six AIR operands:
object, value, order, scope, flags, volatile. The relaxed three-argument form uses
flags zero and volatile false. Earlier language modes retain the five-operand ABI
with volatile true. Device/threadgroup scope remains 2/1. Physical declaration
trust and post-optimization controls validate the selected real language mode,
including direct private-helper calls. API v1/v2/v3 signatures are unchanged.

This is a bounded source candidate, not full atomic support: signed/float/64-bit
objects, other RMW operations, load/store/exchange/compare-exchange, fences and
volatile three-argument overloads remain outside this increment. Dynamic or
unknown order/flag controls are deliberately rejected even where Apple's textual
AIR frontend accepts them. This change does not establish GPU synchronization,
Apple library loading, or execution of a newly rebuilt FLOOR compiler.
