# Current Metal support

Updated 10 November 2026. The first actual Metal 4.1 checkpoint, [`1accfd4`](https://github.com/n3crosis/floor_llvm/commit/1accfd44d88898b2885390cafd527e48b4f00479), is built and its compiler artifact is authenticated. **This is a tested subset, not full Metal 4.1 support. The native GPU gate remains failed.**

## Built checkpoint results

- **497 ordered compiler cases passed:** 113 positive AIR outputs, 145 positive metallib outputs and 239 expected rejections.
- **82 Apple/FLOOR source/target/math pairs compiled and linked.** These include 8 integer, 4 derivative, 22 common-function, 12 language/API and 36 interleave/deinterleave pairs.
- **Both original libraries loaded in all 48 GPU-eligible pairs**, without retargeting.
- **8 numerical passes:** 4 dynamic integer pairs with 46,656 checks each, and 4 corrected position-derivative pairs with 4,320 pixel-lane checks each.
- **4 constant-integer discrepancies:** Apple retains its initialization sentinel at zero-width endpoint extract/insert outputs; FLOOR matches the CPU oracle. The cause is unresolved and later constant entry points were not run.
- **36 interleave pairs blocked at Apple pipeline creation** on Apple Paravirtual / macOS 27.0.1 / Xcode 27.2. FLOOR pipeline creation, dispatch and numerics were not run. This hosted paired run has no interleave GPU execution or raw numerical evidence; separate hardware FLOOR-only execution is recorded below. Generic diagnostics do not establish an environment-only cause or a FLOOR defect. The hardware Mac run also retains the paired failure; separate FLOOR-only results are below.

## Current feature tracks

| Feature | FLOOR compiler | Apple/native evidence | Remaining limit |
|---|---|---|---|
| Explicit Metal 4.1 API v3, truthful macros, OS 27 and matched metadata | Built checkpoint authored tests passed | 12 language/API reference pairs passed | Not a full language conformance audit; no GPU qualification for these probes |
| Metal 4.1 interleave/deinterleave | Built checkpoint tests passed | 36 compile/link pairs and both original library loads passed | Paired run: 36 Apple pipelines failed, FLOOR pipeline/execution unrun. Separate hardware FLOOR-only CPU-oracle checks passed; no Apple parity |
| Dynamic int/uint vectors, widths 2–4 | Passed | 4 GPU passes, 46,656 checks each | Bounded fixture coverage |
| Constant integer boundary fixtures | Passed | 4 Apple-only sentinel discrepancies; FLOOR matches CPU | Unresolved endpoint discrepancy; later entry points unrun |
| Float position-derived dfdx, dfdy, fwidth | Passed | 4 GPU passes, 4,320 checks each | No negative/mixed-slope or divergent-control-flow coverage |
| Float mix, step, smoothstep, sign | Passed | 22 reference compile/link pairs passed | No GPU harness |
| Placement new | Published source candidate, not built | Apple preflight / harness-build evidence only | 74 compiler cases and 6 separate supplemental GPU cases configured, not passed |
| New texture reads | Published source candidate, not built | Apple preflight / harness-build evidence only | 71 compiler cases and 24 separate supplemental GPU cases configured, not passed |
| Acquire/release barriers | Published source candidate, not built | Apple preflight / harness-build evidence only | 141 compiler cases and 8 separate supplemental GPU cases configured, not passed; broader atomics unqualified |
| Other 4.1 families | Unsupported or unvalidated | No qualifying feature corpus | RTZ conversion option, ray-tracing function_id, block scaling, multiplane tensors/tensor_blockwise and expanded MPP matrix types |

## Next source candidate

The newer source batch configures **788 compiler cases: 215 AIR + 229 metallib + 344 expected rejections**, and **172 Apple pairs**. Its **48 generic GPU pairs** remain separate from the planned **24 texture, 6 placement and 8 barrier supplemental GPU cases**. These are generated test counts, not results. Source publication does not establish a fresh compiler build. No new FLOOR compiler or GPU qualification is claimed for this batch.

## Provenance and boundaries

The [checkpoint workflow](https://github.com/n3crosis/floor_llvm/actions/runs/42801805934) produced compiler artifact 13758518162 and native evidence artifact 13760600850. See `checkpoint-evidence.json` for exact identities and `checkpoint-case-matrix.csv` for all 82 per-pair outcomes. The native report is failed even though all 497 compiler cases passed.

The original `81d2559` baseline remains historical evidence in `case-ledger.json` and `execution-evidence.json`. Its original derivative failures are not rewritten by corrected follow-up or checkpoint passes. The baseline v1/v2 iOS 26 frontend/AIR versus container-version mismatch remains open; v3 matched tuples do not repair legacy behavior. No iPhone/iPad execution or full Metal 4.1 conformance is claimed.

See `coverage-matrix.md` for the explicitly historical 30-family table and separate current tracks, and `development-status.json` for machine-readable development status.

## Hardware checkpoint follow-up, separate evidence

The same authenticated `1accfd4` compiler was tested on **Apple M1 Max, macOS 27.2, Xcode/iPhoneOS SDK 27.2**. Its unchanged paired gate remains **failed**: 82 compile/link pairs, both libraries loaded in 48 eligible pairs, 8 numerical passes, 4 known Apple-only constant-boundary sentinel discrepancies, and 36 Apple interleave pipeline failures. The hardware diagnostic reports **unlowered air.interleave / air.deinterleave intrinsic calls**. Original paired FLOOR interleave pipeline creation and both backends' interleave execution remain `not_run`.

Separate diagnostics created both Apple and FLOOR pipelines for the original no-interleave MSL4.1/iOS27 control. All 36 original FLOOR interleave pipelines then created successfully, while all 36 Apple interleave pipelines still failed. This isolates Apple intrinsic lowering on this device/toolchain, rather than a blanket inability to create any 4.1 pipeline. It does not distinguish an unsupported GPU feature from an Apple compiler/driver defect or establish failure on other devices. No control GPU execution is claimed.

A **separate FLOOR-only run passed all 36 cases, 1,446 dispatches and 2,192 output words against an independent CPU oracle** using original libraries. This is bounded unsigned 8/16/32-bit scalar/vector interleave and deinterleave coverage across dynamic/constants and both math settings. **It is not Apple/FLOOR parity:** Apple interleave execution remains unrun and the original aggregate remains failed. Neither these results nor source publication qualify the newer unbuilt candidate.

The independent evidence audit checked 662 shared files, all 82 source identities and 48 original GPU report contracts, replayed 203,984 original logical values, and separately replayed all 1,446 FLOOR-only dispatch records / 2,192 words. Omitted binaries (249 main entries and 3 supplement entries) were not rehashed; their retained hashes are provenance, not another binary verification. No GPU execution was rerun during the audit.

See `hardware-checkpoint-evidence.json`, `hardware-checkpoint-case-matrix.csv` and `floor-only-interleave-case-matrix.csv`. The hosted `checkpoint-evidence.json` and `checkpoint-case-matrix.csv` remain unchanged historical records; their hardware-pending field describes that earlier snapshot only. The main hardware return ZIP is a path-redacted copy, not the original locally retained ZIP. Its SHA-256 is `01c85d2645f9d4f3749ca923826f341b83b0f5523cbb94731365b69e2f93d40d`; the separate supplement SHA-256 is `8bebb55f9c8f36640e783a2b9bb50ec8124afdb2603a75b0caa6cfb5176fc938`.

