# CI builds and optional releases

Pushes to `wasm` and `wasm-rebased-functional-20261110` build the compiler and upload runtime, corresponding-source,
build-input, manifest, and checksum artifacts. A manual run with `release_version`
left empty does the same. Ordinary builds use `dev-<commit>` names and never create,
change, or require a GitHub release. An explicit one-push request, described below,
can request publication through the push workflow. Merge commits are supported; the receipt
records the actual checked-out commit, tree, and source-lock hashes.

GitHub's manual-dispatch UI requires the workflow on the repository's default
branch. If the default remains the compiler-only branch, use a configured branch push
trigger (or rerun an existing build); this change does not add WASM tooling to
the compiler-only branch or change the default branch.

To deliberately publish a new prerelease, manually run the workflow on the
desired source with an unused `release_version`, for example `v0.3.0`, or commit
`wasm/release/release-request.json` with the requested version, repository, exact
`refs/heads/wasm` ref, and current branch head as `baseCommit`. The request applies
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
The probes include 285 authored vertex, fragment, and compute regressions across
iOS 18/26 and both math profiles. Empty vertex return/argument metadata is tested
in both LLVM IR and metallib output, including a void vertex that writes to a
buffer. These checks do not establish Apple loader, GPU, or device acceptance.
The local regression suite (`python3 -m unittest discover -s wasm/release -v`)
tests helper behavior with synthetic source/artifact fixtures, not the compiler.

The authored math regressions also cover signed comparison-mask `all`, float/float-vector `saturate`, exact conservative float `floor`, and color function-constant entries. Integer saturation is intentionally rejected. The header fingerprint changes with these additions; no device or GPU execution is claimed.

The vertex-storage probes cover authored packed unsigned-word vectors, five exact normalized-unpack AIR calls, signed vector comparison-mask selection, and conservative vector/scalar maximum. IR checks preserve three-word storage and scalar alignment and reject user assembly labels even under a forged `#line` filename. These tests exercise the compiler ABI, not device vertex-fetch numerical equivalence.

The math subset also exposes conservative float/float-vector `sqrt`, `rsqrt`, `exp2`, `log2`, `sin`, `cos`, `ceil`, `rint`, and exact bitwise `trunc` and floating `abs`. Explicit `precise::min`, `precise::max`, and `precise::clamp` use their non-fast AIR operations. Authored IR checks verify non-fast symbols and conservative-profile call flags, plus truncation/absolute-value NaN, infinity, subnormal and signed-zero bits. Conservative `min`/`clamp`/`abs` float overloads prevent accidental conversion through integer helpers. Conditional color interfaces accept `float4` and `uint4`; other widths and unsupported element types still fail closed. The scalar AIR unary signatures are corroborated by the public `trn_math_precise.ll` fixture at [metal2vulkan commit 219f013](https://github.com/steelbrain/metal2vulkan/blob/219f01365dc4c8eb346816c405b5b17403793764/crates/metal2vulkan-validation/fixtures/public/engine/trn_math_precise.ll), and precise min/max/clamp by nxkit's `air-emit` source. Only symbol/type facts are used, not copied shader inputs. The explicitly selected global fast-math profile still permits relaxed arithmetic, including on precise-named calls; only the default conservative profile preserves strict call flags. No numerical or device equivalence is claimed.

Conditional framebuffer-input AIR metadata now derives its name from the actual Clang parameter type using the existing canonical type helper. Authored regressions bind each check to its fragment entry and input metadata list, then verify the parameter index, signature type, attachment slot, argument name, bool predicate and required function-constant initializer/index. Float and uint inputs, typedefs/qualifiers, sparse slots 2 and 7, reversed parameter order and buffer 29 are checked for iOS 18/26 and both math profiles, in IR and metallib form. Return metadata cannot satisfy input-type assertions. This is compiler ABI validation, not Apple pipeline or GPU execution proof.

Metal library public/private metadata lengths now include their own four-byte prefixes. All 103 successful metallib cases validate serialized function records, boundaries, metadata tags, AIR sizes and hashes; 16 also bind constants to exact authored entry parameters. The validator never rewrites output bytes. Run `node --test wasm/release/conditional-color.test.mjs wasm/release/metallib-metadata.test.mjs` for 41 synthetic assertion tests; these run in CI before each compiler build. The receipt includes both validation helpers in its tooling inventory.

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

The functional branch is artifact-only on push: the historical release request
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
