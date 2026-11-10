# CI builds and optional releases

Pushes to `wasm` build the compiler and upload runtime, corresponding-source,
build-input, manifest, and checksum artifacts. A manual run with `release_version`
left empty does the same. These builds use `dev-<commit>` names and never create,
change, or require a GitHub release. Merge commits are supported; the receipt
records the actual checked-out commit, tree, and source-lock hashes.

GitHub's manual-dispatch UI requires the workflow on the repository's default
branch. If the default remains the compiler-only branch, use the `wasm` push
trigger (or rerun an existing build); this change does not add WASM tooling to
the compiler-only branch or change the default branch.

To deliberately publish a new prerelease, manually run the workflow on the
desired source with an unused `release_version`, for example `v0.2.0`. Existing
tags or releases, including drafts, are rejected before building and again before
publication. Nothing rewrites an old tag or replaces an existing release asset.
If publication is interrupted after remote changes, inspect the draft/tag and
retained artifacts before deciding how to recover; rerunning does not overwrite
them. Ordinary builds never republish `v0.1.0`.

The workflow keeps Emscripten 4.0.20 pinned, checks source hashes, compiles the
compiler, and runs fresh ABI, header, and compile-smoke probes before packaging.
The probes include 118 authored vertex, fragment, and compute regressions across
iOS 18/26 and both math profiles. Empty vertex return/argument metadata is tested
in both LLVM IR and metallib output, including a void vertex that writes to a
buffer. These checks do not establish Apple loader, GPU, or device acceptance.
The local regression suite (`python3 -m unittest discover -s wasm/release -v`)
tests helper behavior with synthetic source/artifact fixtures, not the compiler.

The authored math regressions also cover signed comparison-mask `all`, float/float-vector `saturate`, exact conservative float `floor`, and color function-constant entries. Integer saturation is intentionally rejected. The header fingerprint changes with these additions; no device or GPU execution is claimed.

The vertex-storage probes cover authored packed unsigned-word vectors, five exact normalized-unpack AIR calls, signed vector comparison-mask selection, and conservative vector/scalar maximum. IR checks preserve three-word storage and scalar alignment and reject user assembly labels even under a forged `#line` filename. These tests exercise the compiler ABI, not device vertex-fetch numerical equivalence.

The math subset also exposes conservative float/float-vector `sqrt`, `rsqrt`, `exp2`, `log2`, `sin`, `cos`, `ceil`, `rint`, and exact bitwise `trunc` and floating `abs`. Explicit `precise::min`, `precise::max`, and `precise::clamp` use their non-fast AIR operations. Authored IR checks verify non-fast symbols and conservative-profile call flags, plus truncation/absolute-value NaN, infinity, subnormal and signed-zero bits. Conservative `min`/`clamp`/`abs` float overloads prevent accidental conversion through integer helpers. Conditional color interfaces accept `float4` and `uint4`; other widths and unsupported element types still fail closed. The scalar AIR unary signatures are corroborated by the public `trn_math_precise.ll` fixture at [metal2vulkan commit 219f013](https://github.com/steelbrain/metal2vulkan/blob/219f01365dc4c8eb346816c405b5b17403793764/crates/metal2vulkan-validation/fixtures/public/engine/trn_math_precise.ll), and precise min/max/clamp by nxkit's `air-emit` source. Only symbol/type facts are used, not copied shader inputs. The explicitly selected global fast-math profile still permits relaxed arithmetic, including on precise-named calls; only the default conservative profile preserves strict call flags. No numerical or device equivalence is claimed.

Conditional framebuffer-input AIR metadata now derives its name from the actual Clang parameter type using the existing canonical type helper. Authored regressions bind each check to its fragment entry and input metadata list, then verify the parameter index, signature type, attachment slot, argument name, bool predicate and required function-constant initializer/index. Float and uint inputs, typedefs/qualifiers, sparse slots 2 and 7, reversed parameter order and buffer 29 are checked for iOS 18/26 and both math profiles, in IR and metallib form. Return metadata cannot satisfy input-type assertions. This is compiler ABI validation, not Apple pipeline or GPU execution proof.

Metal library public/private metadata lengths now include their own four-byte prefixes. All 69 successful metallib cases validate serialized function records, boundaries, metadata tags, AIR sizes and hashes; 16 also bind constants to exact authored entry parameters. The validator never rewrites output bytes. Run `node --test wasm/release/conditional-color.test.mjs wasm/release/metallib-metadata.test.mjs` for 41 synthetic assertion tests; these run in CI before each compiler build. The receipt includes both validation helpers in its tooling inventory.

The wasm branch merges upstream `a2flo/floor_toolchain_1406` at `9c7e27fe79744c25a405395b5b98c726dfa6dd87` (CUDA 13.5 / PTX 9.5). The source lock records that upstream commit and hashes all six changed upstream source files. Existing WASM history, Metal/AIR changes, and earlier SDK compatibility fixes remain intact.
