# Metal 4.1 coverage and Mac validation plan

Updated evidence snapshot: 10 November 2026, after the returned Mac run. Repository: [n3crosis/floor_llvm](https://github.com/n3crosis/floor_llvm).
Branch: `wasm-rebased-functional-20261110`.
Audited commit: [`81d255965a578d9dd55ec4cd2b53a2f239a989f1`](https://github.com/n3crosis/floor_llvm/commit/81d255965a578d9dd55ec4cd2b53a2f239a989f1).

## Selected direction: genuine Metal 4.1

The requested destination is now **Metal 4.1 itself**. Prioritize a real language/version and OS 27 target path, then explicitly tracked 4.1 features. The earlier iOS 18/26 tests remain useful regression evidence but are not the destination and must not delay that work. Preserve their provenance rather than relabeling them. This document separates the executed `81d255…` baseline from the isolated, published, not-yet-built 4.1 candidate. The core API and interleave/deinterleave candidate are published at [`1accfd4`](https://github.com/n3crosis/floor_llvm/commit/1accfd44d88898b2885390cafd527e48b4f00479); the [fresh checkpoint build](https://github.com/n3crosis/floor_llvm/actions/runs/42801805934) is in progress. No new compiler artifact is qualified yet. Their progress is recorded in `development-status.json`; it does not promote baseline feature coverage.

## What the current baseline covers

This is an authored compatibility subset evaluated against the **Metal Shading Language 4.1 specification**, not a claim that the compiler implements Metal 4.1. The important distinction is visible in the actual source:

- The baseline v1/v2 C API accepts iOS 18 and iOS 26 deployment targets, but invokes **`-std=metal3.2` for both**. The iOS 26 path emits AIR 2.7 / MSL 3.2 internally while its metallib `VERS` wrapper chooses AIR 2.8 / MSL 4.0 from the deployment target. **This known legacy mismatch remains open.** Actual library loading does not establish version coherence.
- The Apple comparison uses iOS 18 / `metal3.2` and iOS 26 / `metal4.0`, with explicit conservative or fast math.
- The specification maps `metal4.1` to iOS/iPadOS/macOS/tvOS/visionOS 27. The published baseline API has no OS 27 / Metal 4.1 option. A staged `air_compile_v3` candidate introduces explicit matched tuples `(18,320)`, `(26,400)`, `(27,410)` and checks metadata agreement, but has not been freshly built or natively qualified.
- The baseline inherited frontend already recognizes `metal4.1` and initializes `MetalVersion = 410`. The immediate gap is exposing and validating that mode through the public WASM API, not adding a new token. Its language-standard flags also enable newer C++/GNU/OpenCL extensions, so official MSL language restrictions need explicit audit and negative tests.
- Equal acceptance of the same source under these settings is useful compatibility evidence, but it is not identical language-mode conformance. The new tested functions predate Metal 4.1.

Source: [`air_compiler.cpp`, lines 425–460](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp#L425-L460) and [`apple-reference.mjs`](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/apple-reference.mjs). Inherited mode definitions: [`LangStandards.def`, lines 216–225](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/include/clang/Basic/LangStandards.def#L216-L225) and [`CompilerInvocation.cpp`, lines 3266–3280](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/lib/Frontend/CompilerInvocation.cpp#L3266-L3280).

The accompanying `coverage-matrix.md` and `coverage-matrix.json` inventory 30 feature families. `case-ledger.json` records the 34 exact positive Apple/FLOOR comparisons, source hashes, language modes, math profiles and GPU eligibility. These files reconcile source inventory with identity-checked execution reports. `execution-evidence.json` records report identities and run separation. They do not replace the original reports or claim a green aggregate result.

## Evidence available now

**The original baseline GPU gate failed.** The corrected derivative follow-up now passes four pairs, 4,320 pixel-lane checks each. Constant-integer discrepancies remain unresolved. Original failed-run records are preserved separately from this corrected fixture/harness run.

| Evidence | Result and scope |
|---|---|
| Source inspection | Pinned baseline source audited at `81d255…`; candidate source work is recorded separately. |
| Baseline helper/assertion tests | 107 Node and 26 Python tests passed. These are helper, fixture, mutation and source-contract tests. |
| Fresh exact-head Linux build | [`81d255…`, run 42790141243](https://github.com/n3crosis/floor_llvm/actions/runs/42790141243), build job `129746593015`, passed **285 compiler cases: 168 positive (65 AIR + 103 metallib) and 117 expected rejections**. This is a successful build job, not a successful whole Apple/GPU gate. |
| Artifact identity | [Artifact 13752442598](https://github.com/n3crosis/floor_llvm/actions/runs/42790141243/artifacts/13752442598) was downloaded and verified on the Mac: ZIP digest, extracted members, exact commit/tree, source/headers, receipt and runtime identity. The Mac did not rebuild the compiler or rerun all 285 cases. |
| Minimal Apple 4.1 capability | **Accepted and linked** on Apple M1 Max, macOS 27.2, Xcode 27.2, iPhoneOS SDK 27.2, Metal `32023.922`. One authored compute source used `-target air64-apple-ios27.0 -std=metal4.1 -fno-fast-math`. No library loading, GPU execution or broad 4.1 feature conformance was tested by this probe. |
| Unchanged Mac runner | Failed fast at `case-1`: two compile/link pairs completed, first dynamic integer pair passed, first constant integer pair failed. Preserve that original failed result. |
| Separate Mac continuation | **34/34 Apple compiles, 34/34 Apple links and 34/34 FLOOR compiles passed.** This separate continuation completed the matrix after the original fail-fast result; it is not a green run of the unchanged runner. |
| Original library loading | Both unchanged iOS-targeted libraries loaded in **all 12 GPU-eligible pairs** on the M1 Max. The 22 common-function pairs have no loading/GPU harness and remain `not_covered` at those layers. |
| Dynamic integer numerics | Cases 0, 2, 4 and 6 passed **46,656 checks each** against Apple, FLOOR and the independent CPU oracle. |
| Constant integer numerics | Cases 1, 3, 5 and 7 failed at the first `integer_constants_uint2` comparison. FLOOR matched the CPU oracle; Apple retained the initialization sentinel at four output slots. Cause is unresolved. Later constant entry points were not run. |
| Derivatives | Cases 8–11 loaded both libraries, then the first Apple render pipeline failed because scalar output was paired with `RGBA32Float`. FLOOR derivative pipelines and all derivative GPU execution/numerics remain unrun. A separate corrected fixture/harness run subsequently passed all four pairs, 4,320 pixel-lane checks each; the original failure rows are not rewritten. |
| GitHub Apple gate | The CI Apple report also failed at `case-1` after `case-0` passed 46,656 checks on an Apple Paravirtual device under macOS 15.8.2. It has two completed compile pairs, not 34. Keep it distinct from the complete Mac continuation. |
| Older texture/vector evidence | Useful historical evidence only. No promotion to current texture, depth, SIMD, atomics, tessellation or discard coverage when this suite contains no such probe. |

Exact baseline artifact ZIP SHA-256: `05b9ff737b04de5cbfa7ae1cfe235d1c14aafa1b5be2ef64250286b98adf30f4`.

### Failures that must remain explicit

The four constant-integer failures involve `extract_bits(x,32,0)` and `insert_bits(x,7,32,0)`. Apple left `0xDEADBEEF` at scalar slots 8, 9, 14 and 15; the expected values were `0, 0, 0, 0x80000000`. Preserve this discrepancy and isolate the source-domain assumptions, Apple optimization, driver and harness behavior before assigning cause. Do not remove the boundary tests just to obtain a pass.

The derivative failure is a known harness format mismatch, not evidence that FLOOR derivatives are wrong. It occurs during the first Apple pipeline, before FLOOR pipeline creation or GPU commands. The corrected follow-up has now been natively validated. It uses augmented source and new libraries on the same authenticated baseline runtime; its pass does not change the original source-hash cases.

The supplemental top-level compile report retains default/stale GPU aggregate fields. This document derives each layer from the 12 individual GPU reports and checks their library hashes against the compile report. It does not change the original reports. The resulting facts are: 12 pairs loaded, 8 pairs executed attempted integer commands, 4 dynamic numerical passes, 4 constant numerical failures and 4 derivative pipeline failures. There is no full numerical pass.

### Corrected derivative and Apple 4.1 follow-ups

The corrected derivative run passed **4 pairs × 4,320 pixel-lane checks**, retaining 96 pixel readbacks. The compiler was the same authenticated `81d2559` baseline; source and harness were augmented and the libraries newly compiled. It covers position-derived derivatives only, with width-appropriate target formats and a four-component wrapper for the three-lane case. Negative/mixed slopes and divergent control flow remain outside scope. Private evidence bundle SHA-256: `edccc10a35193fea3c5faffc500dcba8418e64f1491802c2e053677b5070beda`.

Separate boundary/Metal 4.1 metadata evidence is privately retained with bundle SHA-256 `b79e1a4120f7c4eda6593a70f69d0eb79548b29df1031e15b6e129e5c5717579`. These digests are native evidence receipts; this documentation snapshot does not claim an additional local rehash of those private bundles. No private download URL or local machine path is needed to interpret the results.

The Apple-only 4.1 source preflight accepted **all 36 interleave/deinterleave combinations**. Across its original 40 descriptors, 39 compiled/produced textual AIR/linked and one exploratory noexcept positive was rejected. Accepted metadata was AIR 2.9.0 / Metal 4.1.0 / iOS 27. A separate corrected language control was accepted later; it is not a rerun converting that original result to 40/40. The new FLOOR runtime remains unbuilt. Candidate configuration currently contains **497 compiler cases, 82 Apple reference pairs and 48 GPU-eligible pairs**; none of those candidate counts is a passing-result claim. Builds are batched at checkpoints.

### Exact counts from the checked-in case generators

| Group | Total compiler cases | Positive AIR | Positive metallib | Expected rejections | Apple pairs | GPU-eligible pairs |
|---|---:|---:|---:|---:|---:|---:|
| Integer vectors | 53 | 8 | 8 | 37 | 8 | 8 |
| Float derivatives | 38 | 4 | 4 | 30 | 4 | 4 |
| Float common functions | 76 | 22 | 22 | 32 | 22 | 0 |
| These three groups | 167 | 34 | 34 | 99 | 34 | 12 |

The full 285-case compiler suite includes earlier ABI, metadata and math regressions beyond these three groups. It does not contain feature probes for tessellation, SIMD, atomics, texture/depth operations or discard; those AIR cells are `not_covered`, not pending or passed merely because headers exist. Apple pairs deduplicate AIR/metallib output-kind copies by source hash, target and math profile. A source can contain many entry points; pair count is not an overload-coverage percentage.

## Validation layers and promotion rules

Keep these columns separate for every feature, target and math profile:

1. **Source support:** an authored declaration or implementation exists. A forward declaration is not an implementation. A compile rejection outside the documented subset is an expected FLOOR result, not necessarily an Apple rejection.
2. **FLOOR compilation and AIR:** a freshly built, identity-verified compiler accepts/rejects the fixture as expected; AIR assertions validate types, lane dataflow, exact symbols, convergence and math flags.
3. **Metallib structure:** the emitted container passes independent bounds, record, metadata, byte-length and hash checks. This does not show that Apple can load it.
4. **Apple reference compile/link:** Apple compiles the identical source bytes using recorded SDK, language, target and math flags, then links its own library. This does not show that FLOOR's library loads.
5. **Original library loading:** load the unchanged Apple and FLOOR libraries on the actual device. Record each outcome independently.
6. **Pipeline and GPU execution:** create the intended pipeline, submit work, wait with a bounded timeout, inspect command errors and read results back.
7. **Numerical validation:** compare both outputs to an independent CPU/analytic oracle, with the stated legal input domain and tolerance. Record a nonzero number of comparisons, inputs, outputs and hashes.

Statuses include `passed`, `passed_ci`, `failed`, `completed`, `not_run`, `not_covered`, `blocked` and `unavailable`. `passed_ci` means only the configured authored subset passed in the fresh exact-head build. `completed` records attempted GPU commands, not completion of every entry point or numerical success. `pending` is only a scheduling state for a requested build. A skip, absent GPU, rejected Apple library or missing toolchain must never become a pass. Earlier rows or older commits do not automatically promote later layers.

The existing GPU harness returns 0 for a numerical pass, 77 for unavailable and 1 for failure. If Apple loads and FLOOR rejects, that is a failure. If the original Apple library cannot load, there is no matched reference execution on that host, so the pair is unavailable, with both diagnostics retained. The report must retain actual loader facts even when aggregate numerical status is unavailable.

A pass for all 12 GPU-eligible pairs is only a **bounded integer/position-derivative pass**. It does not cover all 34 compile pairs or the full Metal language. Structural equality of AIR/metallib bytes is not a semantic oracle.

## Mac runner and evidence requirements

Use the separately supplied standalone runner against the immutable artifact from the exact-head workflow. The baseline command is:

```sh
python3 run_mac_validation.py --artifact /path/to/downloaded-artifact.zip
```

Optional arguments are `--output NEW_DIRECTORY` and `--developer-dir /Applications/Xcode_26.app/Contents/Developer`. The runner owns the final executable invocation and prerequisite checks; consult its accompanying README. Its actual Mac result and separate continuation are summarized above. Do not replace those original failure records with results from a repaired harness.

The independent capability command is `python3 run_mac_validation.py --capability-only`; it does not need a compiler artifact or Node. Its minimal Apple 4.1 compile/link probe passed on the returned Mac run. It is not one of the 34 baseline comparisons, does not change their targets and cannot establish full 4.1 feature conformance.

The runner is designed to avoid installations, sign-in, global Xcode selection changes and retargeting. It requires usable Apple command-line tools, Xcode 26 or newer, a suitable iPhoneOS SDK, Node and Python. Selecting an Xcode by version alone is insufficient: record the actual SDK and Metal tool versions and test the required targets.

Before importing the WASM runtime, bind all of the following:

- Commit `81d255965a578d9dd55ec4cd2b53a2f239a989f1` and tree `84703aa5fcb717ed1677681e9a3f7ee5f3f74987`.
- Matching source lock, locked source/header hashes, complete source archive and build receipt.
- Runtime archive/member hashes and immutable workflow/artifact identity.
- Embedded header SHA-256 `5b2cbcaea61eb90f878c0d16e500d742079d1674aa5b331c21cc0589f5d6ca3e`, reported by the actual runtime exports, with API/header-bundle version 2.

Runner outputs include `summary.txt`, `result.json`, `validation-matrix.json`, retained diagnostic logs and `evidence.zip`. Record the actual runner version/hash. Preserve the 34-pair ledger, exact command arguments, source bytes/hash, output hashes, independent layer statuses, nonzero numerical counts and failure diagnostics. Hardware facts should include OS build, architecture, device name, supported GPU families and relevant feature capabilities where available. Avoid machine serial numbers and other unnecessary identifiers.

### OS and GPU tiers

| Tier | Host/target | What can be established | Required interpretation |
|---|---|---|---|
| A: source and build | Linux/cloud, exact source and verified WASM | Helper tests, compiler probes, AIR and metallib structural evidence | No Apple compiler, loader or GPU proof. |
| B: Apple toolchain | Mac with usable Xcode/Metal/iPhoneOS SDK; compile iOS 18/3.2 and iOS 26/4.0 | 34 Apple/FLOOR compile comparisons and Apple linking | May run without a usable GPU. Compilation uses target settings, not host OS as a substitute. |
| C: Mac capability probe | Actual Mac MTLDevice, loading those **unchanged iOS-targeted** libraries | Loader and bounded numerical results only if the actual host accepts both | Having an Apple GPU does not guarantee iOS-target library acceptance. A platform rejection is unavailable; do not relabel the library or silently compile a macOS replacement. |
| D: matching iOS execution | Compatible iPhone/iPad runtime and GPU for each original iOS target | Stronger evidence for the actual deployment platform | Requires a separate device-host harness and any required provisioning. Current desktop Swift executable is not an iOS test app. No device run is claimed. |
| E: native macOS support | Future explicitly added FLOOR macOS target and separately compiled Apple references | Native Mac compatibility and numerics for that distinct target | Product/API extension and separate evidence, not a workaround that retroactively qualifies iOS artifacts. |
| F: genuine 4.1 | Toolchain accepting `metal4.1`, appropriate OS 27 target/runtime and feature-capable GPU | New 4.1 syntax, ABI and hardware features | Minimal Apple 4.1 capability passed on the returned Mac; the staged FLOOR 4.1 candidate remains unbuilt. No broad 4.1 feature/GPU claim. Apple silicon and per-feature capability checks still apply. |

Do not assign all M-series or A-series chips the same capability tier from their name. Discover the actual device and supported families/features. At least one oldest-supported and one newer-capability execution device should ultimately cover each advertised deployment tier. Add hardware-dependent features only when an applicable device and explicit acceptance test exist.

## Priority and exit criteria

### P0: finish and qualify the staged 4.1 compiler path

The isolated, not-yet-built core candidate already stages `air_compile_v3`, exact target/version tuples, macros, a C++17-based 4.1 configuration, public restriction checks and AIR/VERS assertions. Unit/source checks are not a fresh compiler. The following are acceptance requirements, not claims that native validation has completed.

1. Expose the existing frontend `metal4.1` path through the API and audit its semantic settings, including the correct C++ language baseline, version predicates and diagnostics. Verify `__METAL_VERSION__ == 410` and applicable platform/unified-language macros. Merely changing the version string or output metadata is not completion.
2. Add an explicit OS 27 target path and an unambiguous API contract for selecting 4.1. Retain old API behavior unless deliberately versioned; do not silently change an iOS 18/26 request into an OS 27 artifact. Bind AIR language/deployment metadata to the chosen mode, with independently corroborated ABI facts rather than guessed version tags.
3. Add fixture pairs that distinguish 4.1 from earlier versions: valid 4.1 syntax/API, intentional earlier-version rejection, accurate diagnostics, macro probes, correct metadata and deliberate failure for unsupported target/version combinations.
4. Extend the already successful minimal Apple 4.1 capability probe into actual candidate feature comparisons, recording exact commands, SDK/tool versions and errors. Xcode 26 or the existing 3.2/4.0 reference gate is not proof of 4.1 support. If unavailable, mark **Apple 4.1 validation blocked by toolchain**; keep independent implementation work moving without substituting an older language mode.
5. Build a new compiler artifact from the 4.1 implementation commit. Extend the Mac runner's manifest/case contract explicitly when that artifact exists; the current runner pinned to `81d255…` must not accept an unmatched new artifact.

Exit: the language/target path has a fresh identity-bound build and positive/negative version tests. Apple compiler and GPU evidence remain separately reported, including exact blockers. These checks establish a versioned path, not complete 4.1 library conformance.

### P1: build and validate the staged interleave feature

`interleave` and `deinterleave` source and tests are staged in a separate candidate. Fresh compiler and native feature validation remain pending. Section 6.4 requires exact type-preserving signatures:

- `uchar2` and `ushort`.
- `ushort2` and `uint`.
- `uint2` and `ulong`.
- Both scalar-pair and two-lane-vector interleave overloads.

Validate return types, zero/all-one and alternating patterns, each bit position, maximum values, randomized inputs and both round-trip directions. Exhaust the smallest input domain where practical. Use an independent bit-position oracle. Add wrong signedness/width/vector-size rejection cases and version-gate tests. An ordinary-integer lowering may avoid new AIR intrinsic dependencies, but still needs correct types, shifts, LLVM verification, fresh embedded-header identity and Apple 4.1 comparison.

Exit: all specified overloads pass source/type, AIR/dataflow, artifact and appropriate Apple checks. A GPU claim needs successful unchanged-library loading and independent numerical comparisons on a compatible target. Do not count existing extract/insert/reverse functions as this feature.

### Parallel baseline validation: resolve observed failures

1. Retain the successful exact-head 285-case Linux build and artifact provenance. Do not label the whole workflow green: the Apple numerical gate failed.
2. Retain all 34 compile/link results and all 12 independent loader results from the separate Mac continuation. They are scoped to the baseline, not the new 4.1 candidate.
3. Isolate the four constant-integer discrepancies. Keep the four dynamic passes and unrun later constant entry points visible.
4. Retain the corrected derivative follow-up: four pipeline/execution/numerical passes, 4,320 pixel-lane checks each. Add negative/mixed-slope derivatives separately; keep the original failing harness records intact.
5. Keep the legacy v1/v2 iOS 26 AIR/VERS mismatch as an explicit open compatibility issue. The staged v3 matched tuples avoid that mismatch for new requests but do not repair old calls.
6. The Apple job remains an additional check, not a condition on the existing optional release-publication step. If publication must depend on Apple/GPU success, make that dependency a separate reviewed change.

Exit: the observed failures have explained, retested outcomes on the actual host, with no discarded cases or relabeled old reports. Full numerical qualification additionally requires the applicable complete corpus to pass.

### P2: strengthen numerical and existing-feature evidence

**Common functions:** add runtime kernels and a host oracle for scalar and 2/3/4-lane float `mix`, `step`, `smoothstep`, `sign`. Include endpoints, non-dyadic finite values, each lane independently and boundary-adjacent inputs. Enforce `mix` factor in [0,1] and `smoothstep` ordered edges; undefined-domain cases test documented rejection/handling policies, not a nonexistent specification answer. Conservative-profile exceptional-value tests should cover signed zero, infinities and the functions' defined NaN behavior. Fast-profile expectations must respect relaxed NaN/infinity/signed-zero rules. Keep independent mathematical checks rather than merely comparing two potentially wrong compilers.

**Derivatives:** add independent affine inputs such as `2*x - 3*y`, `-x`, `-2*y`, and lane-distinct combinations. For each lane, compare `dfdx` and `dfdy` to known slopes and `fwidth` to `abs(a)+abs(b)`. Use interior pixels, defined uniform control flow and explicit rasterization conventions. Existing position-only slopes cannot catch removal of absolute-value handling for negative derivatives.

**Existing surface:** extend Apple and runtime coverage to precise/fast math, conditional function constants and framebuffer inputs, packed normalized unpacks, texture/depth operations, SIMD vote/shuffle, relaxed atomics and barriers. Tie each fixture to a feature row and actual advertised target. For transcendentals use specification-derived bounds; for bit operations use exact integer/bit-pattern equality. Avoid promoting unrelated older texture checks.

Exit: each advertised implemented feature has positive/negative signature tests, emitted-AIR assertions, Apple acceptance, loader/pipeline evidence and a bounded numerical oracle on at least one applicable device. Broader hardware support remains qualified by the devices actually tested.

### P2: close high-value API gaps without confusing them with 4.1

Inventory exact overloads before claiming broad coverage: half common/derivative/math variants, scalar-vector forms, narrow/wide integer families, boolean masks, matrix/geometric operations and texture shape/access variants. Add fail-closed negative tests where the supported subset deliberately stays smaller than Apple. Test direct standard-library includes separately: functions available through `metal_stdlib` do not establish compatibility with every Apple header name.

The selected 4.1 path takes priority over expanding older convenience overloads. Keep the broader subset useful, but do not let its size imply 4.1 coverage.

### P2/P3: finish the remaining 4.1 feature tracks

After the version/target foundation and first bounded builtin, isolate feature tracks rather than attempting one broad unreviewable change:

- **Next language/runtime track:** placement new and lifetime/address-space behavior.
- **Next compiler-option track:** float-to-float conversion rounding mode, with exact conversion edge cases.
- **Memory-model track:** acquire/release atomics and barriers, including memory-order/scope lowering and litmus tests. This must not be emulated by silently using relaxed operations.
- **Resource track:** new texture reads: clamp-to-edge, integer-coordinate offsets and multi-pixel forms.
- Ray-tracing intersection `function_id`.
- Block-scaling packed formats, multiplane tensors and `tensor_blockwise`.
- New Metal Performance Primitives matrix-multiply type support.

Ray tracing, packed scaling, tensors and MPP require substantial type/ABI and device-capability foundations. Their completion is still part of a full 4.1 goal, but should be tracked separately instead of hidden behind a single supported-version flag. Existing packed unsigned records are not Metal 4.1 block-scaled numeric types. Existing relaxed atomics are not acquire/release support. A parser accepting syntax alone is not implementation completion.

## Sources and reproducibility

Primary reference: [Apple Metal Shading Language Specification](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf), **version 4.1, 2026-06-04, 383 pages**. SHA-256 of the inspected PDF: `41538b30d2f1140a5b2a0c84ce0a9f7b67bf0c707e224cfea0bfe5a44aa26cf5`. The URL may be replaced in place; keep this version/date/hash with evidence.

Key reference sections: 1.3 (new in 4.1), 1.5 and 1.6.10 (language/OS versions), 6.3 Table 6.1 (common functions), 6.4 Table 6.2 (integer functions), 6.11.1.1 Table 6.19 (derivatives). The spec cautions that language availability does not guarantee support on every GPU.

Audited source paths and SHA-256 values are in `case-ledger.json`; feature-to-source mappings are in the coverage matrix. The 18 primary source hashes came from the partial baseline snapshot. Three supplemental files (`LangStandards.def`, `CompilerInvocation.cpp` and `MetalLibWriterPass.cpp`) came from a separate pinned baseline snapshot collected during the language audit, and were rechecked against its preserved, unedited copies. They are not claimed to exist in the primary partial snapshot. Their commit URLs and separate provenance are recorded in the ledger. Additional cited baseline paths were checked in the appropriate preserved snapshot. Execution evidence identities and shared-file hashes are recorded separately in `execution-evidence.json`. File links should use the pinned commit rather than a moving branch. `build_matrix.py` regenerates the Markdown/JSON feature inventory and a CSV interchange copy from its declared rows and the checked case ledger; it does not execute the compiler. Its statuses reflect this pinned evidence snapshot, not a live monitor.

This documentation update does not change source, branch history, CI, publication settings or GPU configuration. It does not open a pull request. Refresh statuses only from exact-identity execution results. Keep fail-fast CI, unchanged Mac runner, separate continuation, staged repairs and future candidate runs distinct.

## Published checkpoint

The first explicit 4.1 implementation is at [`1accfd4`](https://github.com/n3crosis/floor_llvm/commit/1accfd44d88898b2885390cafd527e48b4f00479). Its [batched build](https://github.com/n3crosis/floor_llvm/actions/runs/42801805934) is in progress. The configured 497 compiler probes, 82 Apple pairs and 48 GPU-eligible pairs are planned validation, not passing counts. Ordinary source or documentation pushes do not start another run.
