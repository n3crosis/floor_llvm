# Current Metal support matrix

Updated 10 November 2026. Executed compiler baseline: [`81d2559`](https://github.com/n3crosis/floor_llvm/commit/81d255965a578d9dd55ec4cd2b53a2f239a989f1). The new Metal 4.1 source candidate is published but not yet built into a qualified compiler artifact.

**The implemented compatibility subset is usable in tested areas; full Metal 4.1 support is not complete.** The executed baseline WASM API selects Metal 3.2 source mode for its iOS 18/26 targets.

| Area | FLOOR compiler evidence | Apple compile/link | GPU result |
|---|---|---|---|
| Dynamic 32-bit integer vectors: clz, ctz, popcount, reverse, extract, insert; int/uint, widths 2–4 | Passed | Passed, 4 target/profile pairs | Passed: 46,656 checks per pair |
| Constant integer boundary fixtures | Passed | Passed, 4 pairs | Unresolved discrepancy for literal offset 32/count 0. FLOOR matches CPU oracle; Apple output retains initialization sentinel. Later constant entry points were not run. |
| Float scalar/vector dfdx, dfdy, fwidth | Passed | Passed | Corrected position-derivative fixtures passed 4 pairs, 4,320 pixel-lane checks each. Original harness format failures remain recorded. Negative/mixed slopes are not covered. |
| Float mix, step, smoothstep, sign, widths 1–4 | Passed: 76 positive/negative compiler cases | Passed, 22 pairs | Not covered |
| Existing float math, packed storage/unpacks, interfaces and function constants | Authored CI subsets passed | Not covered by this 34-pair gate | Not covered by this GPU gate |
| Texture/depth, SIMD, relaxed atomics, tessellation and discard headers | Partial source implementations exist; no feature probes in this 285-case suite | Not covered here | Not covered here |
| Metal 4.1 public API, macros, OS 27 and coherent metadata | Source-staged v3 candidate; fresh compiler pending | Minimal Apple 4.1 capability passed, not a FLOOR candidate comparison | Not yet qualified |
| Metal 4.1 interleave/deinterleave | Source and tests staged; fresh compiler pending | All 36 Apple reference combinations accepted | No dual-backend GPU qualification |
| Other new Metal 4.1 families | Unsupported or unvalidated in the authored subset | No qualifying feature corpus | No qualifying feature corpus |

## Evidence totals

- Fresh Linux build: **285 compiler probes passed**, including 65 positive AIR outputs, 103 positive metallib outputs and 117 expected rejections.
- Mac continuation: **34 Apple/FLOOR source/target/profile pairs compiled and linked**, and **both original libraries loaded in all 12 GPU-eligible pairs**.
- Baseline integer numerics: four dynamic passes and four constant failures. The original four derivative pipeline failures were followed by a separately qualified corrected fixture/harness run. Do not treat the original fail-fast CI or Mac runner as green.
- Apple M1 Max, macOS 27.2, Xcode/iPhoneOS SDK 27.2: a minimal `metal4.1` / iOS 27 source compiled and linked. This establishes toolchain capability, not complete language or feature conformance.

## What remains for Metal 4.1

The immediate work is a batched, identity-verified compiler checkpoint for the staged changes, then actual FLOOR-versus-Apple 4.1 comparisons and GPU oracles. The candidate configures 497 compiler cases, 82 Apple pairs and 48 GPU-eligible pairs; these are not completed results. Other 4.1 tracks remain explicit:

- Placement new.
- Float-to-float round-toward-zero conversion option.
- Acquire/release atomics and barriers.
- Clamp-to-edge, integer-offset and multi-pixel texture reads.
- Ray-tracing intersection `function_id`.
- Block-scaling packed numeric formats.
- Multiplane tensors and `tensor_blockwise`.
- Expanded Metal Performance Primitives matrix-multiply types.

The baseline iOS 26 v1/v2 API has a known language/AIR-versus-container version mismatch. The staged v3 matched tuples avoid it for new requests; legacy behavior remains a separate open issue. Successful loading does not resolve that mismatch.

See `coverage-matrix.md` for all 30 audited feature families, `case-ledger.json` for the original 34 comparisons and `execution-evidence.json` for run identities. Corrected derivative follow-up evidence is kept separate from the original source-hash ledger.

## Published checkpoint

The first explicit 4.1 implementation is at [`1accfd4`](https://github.com/n3crosis/floor_llvm/commit/1accfd44d88898b2885390cafd527e48b4f00479). Its [batched build](https://github.com/n3crosis/floor_llvm/actions/runs/42801805934) is in progress. The configured 497 compiler probes, 82 Apple pairs and 48 GPU-eligible pairs are planned validation, not passing counts. Ordinary source or documentation pushes do not start another run.
