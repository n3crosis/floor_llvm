# CI builds and optional releases

Builds are deliberate checkpoints. On `wasm` and
`wasm-rebased-functional-20261110`, a push starts this workflow only when it
changes `wasm/release/validation-checkpoint.json`. Ordinary source and documentation
pushes do not start CI. Update that small file only when a coherent batch needs
fresh compiler and Apple validation. A manual run with `release_version` left
empty also builds artifacts only. Neither route cancels an active run.

Checkpoint builds upload runtime, corresponding-source, build-input, manifest,
and checksum artifacts using `dev-<commit>` names. They never create, change, or
require a GitHub release unless the separate release rules below are satisfied.
The receipt records the actual checked-out commit, tree and source-lock hashes.

GitHub's manual-dispatch UI requires the workflow on the default branch. The
checkpoint path filter provides an explicit trigger without changing the default
branch or adding WASM tooling to the compiler-only branch.

To deliberately publish a new prerelease, manually run the workflow on the
desired source with an unused `release_version`, for example `v0.3.0`, or commit
`wasm/release/release-request.json` with the requested version, repository, exact
`refs/heads/wasm` ref, and current branch head as `baseCommit`. A push-based
release request must also change `validation-checkpoint.json` in the same push
to satisfy the workflow path filter. The request applies
only to the immediate single-parent push from that exact base. Its repository,
branch, Git parent, checkout SHA and GitHub push-before SHA must all match.
Later ordinary pushes retain artifact-only behavior even while the request file
remains in history. The request is part of the source archive and tooling receipt.
The checked-in `v0.3.0` request applies only after `b8fcdc410bf4dedb140c71da61f9155e3f1f8923`. Existing
tags or releases, including drafts, are rejected before building and again before
publication. Nothing rewrites an old tag or replaces an existing release asset.
If publication is interrupted after remote changes, inspect the draft/tag and
retained artifacts before deciding how to recover; rerunning does not overwrite
them. Ordinary builds never republish `v0.1.0`.

The workflow keeps Emscripten 4.0.20 pinned, checks source hashes, compiles the
compiler, and runs fresh ABI, header, and compile-smoke probes before packaging.
The probes include 497 authored vertex, fragment, and compute regressions across
iOS 18/26/27 and both math profiles. Empty vertex return/argument metadata is tested
in both LLVM IR and metallib output, including a void vertex that writes to a
buffer. These checks do not establish Apple loader, GPU, or device acceptance.
The local regression suite (`python3 -m unittest discover -s wasm/release -v`)
tests helper behavior with synthetic source/artifact fixtures, not the compiler.

The authored math regressions also cover signed comparison-mask `all`, float/float-vector `saturate`, exact conservative float `floor`, and color function-constant entries. Integer saturation is intentionally rejected. The header fingerprint changes with these additions; no device or GPU execution is claimed.

The vertex-storage probes cover authored packed unsigned-word vectors, five exact normalized-unpack AIR calls, signed vector comparison-mask selection, and conservative vector/scalar maximum. IR checks preserve three-word storage and scalar alignment and reject user assembly labels even under a forged `#line` filename. These tests exercise the compiler ABI, not device vertex-fetch numerical equivalence.

The math subset also exposes conservative float/float-vector `sqrt`, `rsqrt`, `exp2`, `log2`, `sin`, `cos`, `ceil`, `rint`, and exact bitwise `trunc` and floating `abs`. Explicit `precise::min`, `precise::max`, and `precise::clamp` use their non-fast AIR operations. Authored IR checks verify non-fast symbols and conservative-profile call flags, plus truncation/absolute-value NaN, infinity, subnormal and signed-zero bits. Conservative `min`/`clamp`/`abs` float overloads prevent accidental conversion through integer helpers. Conditional color interfaces accept `float4` and `uint4`; other widths and unsupported element types still fail closed. The scalar AIR unary signatures are corroborated by the public `trn_math_precise.ll` fixture at [metal2vulkan commit 219f013](https://github.com/steelbrain/metal2vulkan/blob/219f01365dc4c8eb346816c405b5b17403793764/crates/metal2vulkan-validation/fixtures/public/engine/trn_math_precise.ll), and precise min/max/clamp by nxkit's `air-emit` source. Only symbol/type facts are used, not copied shader inputs. The explicitly selected global fast-math profile still permits relaxed arithmetic, including on precise-named calls; only the default conservative profile preserves strict call flags. No numerical or device equivalence is claimed.

Conditional framebuffer-input AIR metadata now derives its name from the actual Clang parameter type using the existing canonical type helper. Authored regressions bind each check to its fragment entry and input metadata list, then verify the parameter index, signature type, attachment slot, argument name, bool predicate and required function-constant initializer/index. Float and uint inputs, typedefs/qualifiers, sparse slots 2 and 7, reversed parameter order and buffer 29 are checked for iOS 18/26 and both math profiles, in IR and metallib form. Return metadata cannot satisfy input-type assertions. This is compiler ABI validation, not Apple pipeline or GPU execution proof.

Metal library public/private metadata lengths now include their own four-byte prefixes. All 145 successful metallib cases validate serialized function records, boundaries, metadata tags, AIR sizes and hashes; 16 also bind constants to exact authored entry parameters. The validator never rewrites output bytes. Run `node --test wasm/release/conditional-color.test.mjs wasm/release/metallib-metadata.test.mjs` for 41 synthetic assertion tests; these run in CI before each compiler build. The receipt includes both validation helpers in its tooling inventory.

The wasm branch merges upstream `a2flo/floor_toolchain_1406` at `9c7e27fe79744c25a405395b5b98c726dfa6dd87` (CUDA 13.5 / PTX 9.5). The source lock records that upstream commit and hashes all six changed upstream source files. Existing WASM history, Metal/AIR changes, and earlier SDK compatibility fixes remain intact.

## Generic vector coverage on the functional branch

The functional branch extends two authored compatibility subsets using Apple's
[MSL 4.1 specification](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf)
(2026-06-04) as the interface reference:

- Section 6.4, Table 6.2, pages 202-204: `int2/3/4` and `uint2/3/4` forms of
  `clz`, `ctz`, `popcount`, `reverse_bits`, `extract_bits`, and `insert_bits`.
  Each lane uses the existing 32-bit implementation. Extraction/insertion keep
  scalar unsigned offsets and counts, including the zero/full-width boundaries.
  Unsupported operand families fail instead of silently promoting to 32 bits.
- Section 6.11.1.1, Table 6.19, page 235: `float2/3/4` derivatives and scalar/vector
  `fwidth`. The implementation retains trusted convergent scalar derivative calls,
  preserves each input lane, and adds absolute x/y derivative magnitudes for
  `fwidth`. Fragment-only restrictions remain enforced. Half/integer derivatives
  remain outside this implemented subset.

The new modules provide generic synthetic shader cases, not copied SDK or game
shaders. They exercise both iOS targets and math profiles, inspect successful IR
and metallib structure, and reject unsupported types and derivative stages.
Their assertion tests deliberately mutate expected IR to ensure missing or wrong
operations fail validation. The build receipt hashes both validation modules.

The functional branch is artifact-only at an explicit checkpoint: the historical release request
still names `refs/heads/wasm` and its original base commit. A regression test
ensures it cannot publish from the functional branch. A changed header bundle
requires a fresh compiler build and fingerprint; older binaries are never
relabeled as containing these changes. Compile/IR validation does not establish
Apple loader acceptance, derivative numerical results, or GPU/device execution.

## Common-function coverage

MSL 4.1 section 6.3, Table 6.1 supplies the interface reference for same-width
`float`, `float2`, `float3`, and `float4` forms of `mix`, `step`, `smoothstep`, and
`sign` through `metal_stdlib`. These ordinary arithmetic helpers add no AIR symbols.
`sign` preserves signed zero and returns positive zero for NaN. Half, integer,
mixed-type, and scalar-vector overloads remain outside this subset.

The common-function module contributes 76 compiler cases: 22 AIR and 22 metallib
successes plus 32 expected rejections. Forty synthetic and mutation tests check
its assertions. The AIR checker follows supported straight-line lane dataflow
and destination stores with bounded finite, non-dyadic, signed-zero, infinity,
and NaN values; it rejects unrecognized operations and control flow. Constant
outputs are checked separately. This bounded IR evaluation is not device execution
or proof over all floating-point inputs. Both validation modules are included in
the source provenance. A fresh embedded-header build is required for acceptance.

## Apple reference and optional GPU evidence

After the Linux build passes, a separate `xcode-27` job downloads the immutable
compiler artifact from the same workflow run. Before executing it, the verifier
binds the manifest to the actual checkout commit and tree, source-lock hash,
complete header identity, runtime archive/member hashes, and build receipt.
Compiler exports must report the matching embedded-header identity.

The reference harness selects the highest installed Xcode 27 or newer and runs
82 deduplicated positive source/API/target/profile combinations through both compilers.
Apple uses the iPhoneOS SDK, each explicitly recorded iOS 18/26/27 target and
Metal 3.2/4.0/4.1 language setting, then `metallib`. Historical iOS 26 API2
comparisons keep their recorded Apple 4.0 / FLOOR 3.2 distinction. FLOOR compiles the same
source into its own metallib. Commands, diagnostics, hashes, and layer-specific
results are retained in the `apple-reference-<commit>` artifact even on failure.
FLOOR-subset rejections do not impose invalid rejection expectations on Apple.
Successful source compilation and linking do not establish that FLOOR's output
loads or executes correctly. This is an additional dependent CI job, not a
condition on the existing optional release-publication step in the build job.

An optional Swift harness tries loading both original libraries on the runner's
actual `MTLDevice`. No GPU, or an Apple reference library that cannot load, is
reported as unavailable with diagnostics, never as a pass. If Apple loads but
FLOOR rejects, the job fails. Libraries are never rewritten or retargeted to macOS
to manufacture a result. No paid runner is selected or enabled.

When both libraries load, integer vector kernels run fixed/random bit patterns
and legal bit-range endpoints against an independent CPU oracle, retaining
16-byte stride for three-lane vectors. Position-based derivative fragments render
to a float texture; interior pixels are checked against both libraries and an
analytic result. A numerical pass requires both loads, successful pipeline
creation, completed GPU commands, matching output hashes, and nonzero numerical
comparisons. MSL 4.1 interleave/deinterleave kernels also use independent exact bit-list
oracles with byte-preserving 8/16/32/64-bit layouts. The 48 GPU-eligible pairs
comprise 12 earlier integer/derivative pairs and 36 interleave pairs. Common
functions, language-only probes, negative/mixed-slope derivatives, and divergent
control flow are excluded from the GPU scope. In particular, these position-only
tests cannot establish numerical correctness of `fwidth` absolute-value handling
for negative derivatives. Local source-contract and oracle tests do not compile
Swift or execute Metal. Read the report's individual layers and limitations;
a green compile/link job with GPU unavailable is not device equivalence proof.

## Explicit Metal 4.1 candidate

The versioned C entry point `air_compile_v3` takes an explicit language version.
Its initial supported target/language pairs are iOS 18 / 320, iOS 26 / 400, and
iOS 27 / 410. The compiler selects the real `metal3.2`, `metal4.0`, or `metal4.1`
mode, and validates its LangOptions and emitted AIR metadata. It does not replace
an old language label with a new one. `__METAL__` and `__METAL_VERSION__` are
compiler-defined. Metal 4.1 uses a C++17 baseline with an explicit API rejection
boundary for unsupported constructs. Placement new is still an implementation gap
and receives a rejection diagnostic. This is a limited 4.1 implementation, not
full MSL conformance.

The new API preserves v1/v2 signatures and their default 3.2 source language.
The legacy v1/v2 iOS 26 path retains a known mismatch: its IR identifies AIR 2.7 /
MSL 3.2 while its metallib wrapper identifies AIR 2.8 / MSL 4.0. Do not claim
version agreement for that legacy path. The new v3 tuples are checked separately.
Manifest and receipt API capability is now 3, with supported APIs 1/2/3 and exact
language/target tuples recorded. Header-bundle version remains 2.

All nine MSL 4.1 `interleave` / `deinterleave` signatures from section 6.4,
Table 6.2 are implemented behind `__METAL_VERSION__ >= 410`. The supported
unsigned pairs are uchar/ushort, ushort/uint, and uint/ulong. Scalar-pair and
vector-pair interleave forms preserve even/odd bit order; deinterleave returns
the two narrow lanes. Unsupported and earlier-language calls are rejected.
The 157 feature cases distinguish arithmetic preflight from actual 4.1
qualification, with exact argument/buffer ABI and target/language metadata
checks. Fifty-five additional core cases check version selection, metadata, C++17,
and rejection diagnostics. Together with the earlier baseline, CI requires
497 compiler cases: 113 successful AIR outputs, 145 successful metallibs, and
239 expected rejections.

The candidate's Apple comparison contains 82 source/API/target/profile pairs.
It records actual Apple and FLOOR language modes, including preserved historical
Apple 4.0 / FLOOR 3.2 comparisons. A separate tiny shader must actually compile
with `-std=metal4.1` for iOS 27 before the 4.1 Apple cases are considered available.
No fallback to Metal 4.0 counts as 4.1 validation. The workflow uses GitHub's
standard `xcode-27` runner, whose official inventory supplies Xcode 27.2 and
an iOS 27.2 SDK. It does not enable a paid custom runner or install Xcode.

References: [standard hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [xcode-27 image inventory](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md).

Every comparison continues after a recorded case failure so one discrepancy
cannot hide the remaining matrix. The overall outcome still fails when a layer
fails; unavailable toolchains or devices never count as passes. This source
increment requires a fresh compiler build and native qualification. Older
artifact receipts are not evidence that it was built or executed.

## Retained baseline findings and derivative fixture repair

The immutable `81d2559` baseline passed its 285-case fresh Linux build. Its first
Apple CI run used Xcode 26.3 and iPhoneOS SDK 26.2. Both initial integer sources
compiled/linked, and the dynamic iOS 18 conservative pair loaded and passed
46,656 GPU values on the runner's Apple Paravirtual device. The constant pair
failed: FLOOR matched the CPU oracle, while Apple left the literal offset 32 /
count 0 extract/insert outputs at the initialization sentinel. The original AIR
and linked metallib still contain the intrinsics and volatile stores. This is an
observed downstream discrepancy, not a settled attribution to frontend, linker,
driver, or backend. It remains a recorded failure rather than an excluded test.

Public evidence: [baseline workflow](https://github.com/n3crosis/floor_llvm/actions/runs/42790141243)
and [Apple evidence artifact](https://github.com/n3crosis/floor_llvm/actions/runs/42790141243/artifacts/13752373539).

The earlier derivative harness incorrectly paired scalar outputs with an
RGBA32Float target. Its repair selects R32Float/RG32Float for scalar/float2 and
uses padded-row-aware readback. Since Metal has no RGB32Float target, three
additional authored fragment entries return the float3 derivative in float4
with zero alpha. Both compilers receive the same augmented source; the original
twelve fragment entries remain for compile/IR checks. Existing metallibs are
never rewritten or retargeted. Position-only numerical coverage still excludes
negative/mixed slopes and divergent control flow.

## Local Mac runner and coverage ledger

The [Mac runner](../mac-validation/README.md) can test installed Apple 4.1
capability without downloading a compiler. Its optional artifact run is explicitly
pinned to the historical `81d2559` build; it is not a runner for an unbuilt v3
compiler. Keep baseline evidence separate from new feature qualification.

Apple Xcode 27.2 preflight accepted all 36 interleave sources and built the extended Swift harness. It rejected an earlier `noexcept` positive; explicit `noexcept` is now rejected and that positive uses C++17 nested-namespace syntax. Apple source acceptance and a Swift build do not establish rebuilt FLOOR or GPU correctness.
