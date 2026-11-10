# Current Metal support

## Three distinct source and evidence snapshots

1. **Built and authenticated: `1accfd4`.** Its 497 compiler cases passed. Hosted and hardware paired GPU gates remain failed, while the separate hardware FLOOR-only interleave run passed 1,446 dispatches / 2,192 output words. No Apple interleave parity is claimed.
2. **Published placement/texture/barrier source: `8026ac51d6e9f3e2a547445343ff5a206f0ed0ec`.** Its 788-case build is in progress. The initial `65c735a` checkpoint failed before compilation because preflight hard-coded 10 headers. Correction [`0895444`](https://github.com/n3crosis/floor_llvm/commit/0895444c9befcebe4eeea580642dc43d385abe83) checks the exact 11 headers with regressions. [Run 42824346921](https://github.com/n3crosis/floor_llvm/actions/runs/42824346921) passed preflight and is compiling at this snapshot. **No artifact or new compiler pass is available.** Configured totals remain 788 = 215 AIR + 229 metallib + 344 rejections, with 172 Apple pairs.
3. **Later uint-atomic source published with this revision; unbuilt.** Adds 166 contracts (66 AIR, 50 metallib, 44 frontend and 6 invalid-IR rejections) and 64 Apple pairs, bringing the candidate to **954 = 281 AIR + 279 metallib + 394 rejections; 236 Apple pairs**. Local source checks passed: 633 Node, 34 release Python and 68 texture tests, with source locks verified. These are helper/source checks, not 954 compiled outcomes. The production native atomic ABI reference and validator review fixes are in place, but there is **no modified compiler, atomic pipeline/GPU result or acquire-release synchronization proof**.

The atomic native reference contains 86 Apple probes. Of 74 MSL 4.1 cases, 54 were accepted and 20 non-relaxed three-argument forms rejected; each earlier-language set accepted two and rejected four. The flags operand precedes volatility. Apple textual AIR accepts some dynamic/unknown controls that the bounded FLOOR API deliberately rejects. These acceptance observations do not prove that unknown controls are valid or qualify the modified compiler.

## Latest bounded Apple discrepancy isolation

A separate Apple-only diagnostic used both **native macOS 27 and iOS 27 targets**, MSL 4.1, conservative math and default optimization on the same M1 Max/macOS 27.2/Xcode 27.2 stack. All six source/target groups compiled, emitted textual AIR, linked and loaded. Across both targets, 404 dispatches completed: 364 numerical passes and 40 failures; another 18 interleave pipelines failed. The diagnostic itself remains failed. No Apple/FLOOR parity or replacement of earlier gates is implied.

The `(offset,count)=(32,0)` endpoint **is defined for 32-bit operands** by MSL 4.1 Table 6.2: extract returns zero and insert returns the base; the undefined condition is a sum greater than the width, not equality. The new evidence confirms Apple-stack numerical nonconformance dependent on operand constancy and scalar/vector form. Per target, 12 scalar failures return the after-guard value, while 8 uint2 failures retain the selected prefill. All fully runtime-loaded operands/parameters pass, and dynamic-input uint2 extraction with literal endpoint also passes. All tested non-endpoint controls and guard words pass. Do not characterize every literal form as failing or every failure as sentinel retention.

The separately compiled textual AIR retains the failing literal intrinsic calls and result-dependent volatile stores. A constant-specialized intrinsic/native-lowering defect is the leading explanation, but the exact compiler pass, AIR-contract mapping, driver component or instruction is not established. Source-level shifting by 32, lack of general bit-operation capability and purely iOS-on-Mac targeting do not explain these observations.

All nine interleave/deinterleave pipelines per target fail with unlowered `air.interleave.i16/i32/i64` or `air.deinterleave.i16/i32/i64` calls (AGXMetalG13X, code 3); simple controls execute successfully. This is an Apple intrinsic-lowering/availability blocker on the measured stack. Native macOS reproduction rules out a purely iOS-library-on-Mac explanation. An intended architecture restriction versus missing/defective Apple lowering remains unresolved; no conclusion about newer GPUs or other software versions follows. FLOOR's separate CPU-oracle pass shows the results can be computed on this device, not that Apple's intrinsics are available.

The independent audit verified 467 shared files, 404 raw output files and 1,816 output words. All executed output words agree across target variants; 56 result words mismatch the oracle in the 40 failed records, with guards correct. Thirteen omitted binaries were not independently rehashed or disassembled. Textual AIR is a separate compilation, not disassembly of the omitted linked libraries. Optional `-O0` was not advertised or attempted; actual support is unknown. Preserve specification-correct FLOOR semantics, endpoint tests and the strict failed gate.

See `APPLE-DISCREPANCY-FINDINGS.md`, `apple-discrepancy-evidence.json` and `apple-discrepancy-audit.json` for the bounded findings, identities, exact form matrix and verification limits. Earlier original evidence files remain unchanged snapshots; their then-unresolved endpoint wording is superseded by this separate diagnostic, not edited retroactively.


Updated 10 November 2026. The first actual Metal 4.1 checkpoint, [`1accfd4`](https://github.com/n3crosis/floor_llvm/commit/1accfd44d88898b2885390cafd527e48b4f00479), is built and its compiler artifact is authenticated. **This is a tested subset, not full Metal 4.1 support. The native GPU gate remains failed.**

## Built checkpoint results

- **497 ordered compiler cases passed:** 113 positive AIR outputs, 145 positive metallib outputs and 239 expected rejections.
- **82 Apple/FLOOR source/target/math pairs compiled and linked.** These include 8 integer, 4 derivative, 22 common-function, 12 language/API and 36 interleave/deinterleave pairs.
- **Both original libraries loaded in all 48 GPU-eligible pairs**, without retargeting.
- **8 numerical passes:** 4 dynamic integer pairs with 46,656 checks each, and 4 corrected position-derivative pairs with 4,320 pixel-lane checks each.
- **4 constant-integer discrepancies:** Apple retains its initialization sentinel at zero-width endpoint extract/insert outputs; FLOOR matches the CPU oracle. The later diagnostic confirms a defined-endpoint Apple-stack discrepancy; exact lowering cause remains unresolved. Later original constant entry points were not run.
- **36 interleave pairs blocked at Apple pipeline creation** on Apple Paravirtual / macOS 27.0.1 / Xcode 27.2. FLOOR pipeline creation, dispatch and numerics were not run. This hosted paired run has no interleave GPU execution or raw numerical evidence; separate hardware FLOOR-only execution is recorded below. Generic diagnostics do not establish an environment-only cause or a FLOOR defect. The hardware Mac run also retains the paired failure; separate FLOOR-only results are below.

## Current feature tracks

| Feature | FLOOR compiler | Apple/native evidence | Remaining limit |
|---|---|---|---|
| Explicit Metal 4.1 API v3, truthful macros, OS 27 and matched metadata | Built checkpoint authored tests passed | 12 language/API reference pairs passed | Not a full language conformance audit; no GPU qualification for these probes |
| Metal 4.1 interleave/deinterleave | Built checkpoint tests passed | 36 compile/link pairs and both original library loads passed | Paired run: 36 Apple pipelines failed, FLOOR pipeline/execution unrun. Separate hardware FLOOR-only CPU-oracle checks passed; no Apple parity |
| Dynamic int/uint vectors, widths 2–4 | Passed | 4 GPU passes, 46,656 checks each | Bounded fixture coverage |
| Constant integer boundary fixtures | Passed | 4 Apple-only sentinel discrepancies; FLOOR matches CPU | Defined-endpoint Apple-stack discrepancy; exact cause unresolved, later original entry points unrun |
| Float position-derived dfdx, dfdy, fwidth | Passed | 4 GPU passes, 4,320 checks each | No negative/mixed-slope or divergent-control-flow coverage |
| Float mix, step, smoothstep, sign | Passed | 22 reference compile/link pairs passed | No GPU harness |
| Placement new | Published source, build in progress; no artifact | Apple preflight / harness-build evidence only | 74 compiler cases and 6 separate supplemental GPU cases configured, not passed |
| New texture reads | Published source, build in progress; no artifact | Apple preflight / harness-build evidence only | 71 compiler cases and 24 separate supplemental GPU cases configured, not passed |
| Acquire/release barriers | Published source, build in progress; no artifact | Apple preflight / harness-build evidence only | 141 compiler cases and 8 separate supplemental GPU cases configured, not passed; broader atomics unqualified |
| Uint atomic orders and flags | Source published with this revision; unbuilt | Production native ABI reference only | 166 additional contracts / 64 Apple pairs configured; no modified compiler, GPU or synchronization proof |
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

