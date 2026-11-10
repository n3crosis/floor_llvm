# Metal 4.1 coverage and validation

Updated 10 November 2026. Repository: [n3crosis/floor_llvm](https://github.com/n3crosis/floor_llvm). Branch: `wasm-rebased-functional-20261110`.

## Current checkpoint and next candidate

Read **[CURRENT-SUPPORT.md](CURRENT-SUPPORT.md)** for the current support matrix. The first actual Metal 4.1 checkpoint `1accfd44d88898b2885390cafd527e48b4f00479` is built: **497 ordered compiler cases pass** (113 AIR + 145 metallib + 239 expected rejections). Its hosted native gate **fails**: all 82 pairs compile/link, all 48 GPU-eligible pairs load both original libraries, 8 numerical pairs pass, 4 constant pairs show Apple-only sentinel discrepancies, and all 36 interleave pairs fail Apple pipeline creation. FLOOR interleave pipelines and GPU execution were not run. Hardware Mac validation has returned; the paired gate remains failed, with separate FLOOR-only passes recorded below.

A newer **published but unbuilt source batch** adds placement, texture-read and barrier work. Its configured 788 compiler cases (215 AIR + 229 metallib + 344 expected rejections), 172 Apple pairs and separate supplemental GPU harness cases are plans, not completed FLOOR results. Apple source preflight or Swift harness compilation is not dual-backend GPU validation.

## Evidence index

| File | Scope |
|---|---|
| CURRENT-SUPPORT.md | Current user-facing feature tracks and limits |
| checkpoint-evidence.json | Built 1accfd4 compiler artifact and hosted native evidence identities and layer counts |
| checkpoint-case-matrix.csv | All 82 checkpoint compile pairs and explicit per-backend native stages |
| hardware-checkpoint-evidence.json | Hardware paired failure and separate control/pipeline/FLOOR-only diagnostics |
| hardware-checkpoint-case-matrix.csv | Original hardware paired outcomes, not overwritten by diagnostics |
| floor-only-interleave-case-matrix.csv | 36 separate FLOOR-only CPU-oracle cases, not Apple parity |
| development-status.json | Built checkpoint versus published but unbuilt source batch |
| coverage-matrix.json | Immutable historical 81d2559 feature rows plus currentFeatureTracks |
| coverage-matrix.csv | Historical 81d2559 rows, explicitly annotated as historical |
| coverage-matrix.md | Current track summary followed by historical 30-family audit |
| case-ledger.json | Unchanged original 34-pair baseline source/hash ledger |
| execution-evidence.json | Unchanged baseline and separate historical follow-up evidence; limits apply to those runs only |
| validation.json | Documentation checks and preserved historical validation record |
| SHA256SUMS | SHA-256 of every other file in this documentation directory |

## Historical baseline, not current checkpoint status

The original `81d255965a578d9dd55ec4cd2b53a2f239a989f1` compiler passed 285 cases: 65 AIR + 103 metallib + 117 expected rejections. Its separate Mac continuation passed 34 Apple/FLOOR compile/link pairs and loaded both unchanged libraries in 12 pairs. Four dynamic pairs passed, four constant pairs disagreed, and four original derivative pipelines failed because of a render-target format mismatch. A separate corrected derivative fixture/harness subsequently passed four pairs on that same baseline runtime, with 4,320 pixel-lane checks each. Neither follow-up nor new checkpoint results erase the original failed runs or source hashes.

The historical baseline API v1/v2 selects MSL 3.2 for iOS 18 and 26. Its iOS 26 AIR/MSL 2.7/3.2 disagrees with wrapper 2.8/4.0. Successful library loading does not establish metadata coherence. New v3 matched tuples (18,320), (26,400), (27,410) are separately tested; legacy behavior remains open.

## Validation layers and promotion rules

Keep source implementation, compiler/AIR tests, metallib structural validation, Apple reference compile/link, each backend's original-library load, each backend's pipeline creation, GPU dispatch and independent numerical comparison separate. A declaration, compile, load, harness build or skip cannot promote later stages to passed. A numerical pass must include nonzero checks and an independent oracle. Original libraries must not be retargeted to obtain a load pass.

`passed_ci` refers only to the authored compiler subset at its recorded commit. `completed` means attempted GPU commands completed, not that later kernels ran or numerics passed. `not_run` means an applicable stage was not executed; `not_covered` means there is no qualifying test for that layer. `preflight_only` is Apple-only source/harness evidence without a new FLOOR comparison. Counts of pairs are not overload-coverage percentages.

The four checkpoint integer constant failures occur at the first uint2 entry: Apple retains 0xDEADBEEF at words 8,9,14,15 for literal offset 32/count 0 extract/insert, while FLOOR matches the CPU oracle. Preserve the disagreement; its ultimate cause and endpoint contract are unresolved. The 36 interleave failures occur before FLOOR pipeline creation and before any interleave GPU commands. Generic Apple CompilerError Code=2 does not identify a toolchain, device or shader cause.

The checkpoint evidence audit validates all 48 report contracts, original hashes and 203,984 replayed logical values. This is an independent replay of recorded bytes, not another GPU run and not a passing native aggregate. Derivative numerics cover interior position derivatives, not mixed/negative slopes or divergent control flow. No full Metal 4.1 or iPhone/iPad qualification is claimed.

## Next work

Use the returned hardware Mac results to isolate the Apple interleave pipeline blocker and constant endpoint discrepancy without suppressing cases. Batch-build the newer source candidate and validate its exact artifact before promoting placement, texture-read or barrier tracks. Retain unsupported/unvalidated 4.1 families explicitly. Ordinary source/documentation changes do not themselves establish new build or execution evidence.

## Hardware checkpoint follow-up, separate evidence

The same authenticated `1accfd4` compiler was tested on **Apple M1 Max, macOS 27.2, Xcode/iPhoneOS SDK 27.2**. Its unchanged paired gate remains **failed**: 82 compile/link pairs, both libraries loaded in 48 eligible pairs, 8 numerical passes, 4 known Apple-only constant-boundary sentinel discrepancies, and 36 Apple interleave pipeline failures. The hardware diagnostic reports **unlowered air.interleave / air.deinterleave intrinsic calls**. Original paired FLOOR interleave pipeline creation and both backends' interleave execution remain `not_run`.

Separate diagnostics created both Apple and FLOOR pipelines for the original no-interleave MSL4.1/iOS27 control. All 36 original FLOOR interleave pipelines then created successfully, while all 36 Apple interleave pipelines still failed. This isolates Apple intrinsic lowering on this device/toolchain, rather than a blanket inability to create any 4.1 pipeline. It does not distinguish an unsupported GPU feature from an Apple compiler/driver defect or establish failure on other devices. No control GPU execution is claimed.

A **separate FLOOR-only run passed all 36 cases, 1,446 dispatches and 2,192 output words against an independent CPU oracle** using original libraries. This is bounded unsigned 8/16/32-bit scalar/vector interleave and deinterleave coverage across dynamic/constants and both math settings. **It is not Apple/FLOOR parity:** Apple interleave execution remains unrun and the original aggregate remains failed. Neither these results nor source publication qualify the newer unbuilt candidate.

The independent evidence audit checked 662 shared files, all 82 source identities and 48 original GPU report contracts, replayed 203,984 original logical values, and separately replayed all 1,446 FLOOR-only dispatch records / 2,192 words. Omitted binaries (249 main entries and 3 supplement entries) were not rehashed; their retained hashes are provenance, not another binary verification. No GPU execution was rerun during the audit.

See `hardware-checkpoint-evidence.json`, `hardware-checkpoint-case-matrix.csv` and `floor-only-interleave-case-matrix.csv`. The hosted `checkpoint-evidence.json` and `checkpoint-case-matrix.csv` remain unchanged historical records; their hardware-pending field describes that earlier snapshot only. The main hardware return ZIP is a path-redacted copy, not the original locally retained ZIP. Its SHA-256 is `01c85d2645f9d4f3749ca923826f341b83b0f5523cbb94731365b69e2f93d40d`; the separate supplement SHA-256 is `8bebb55f9c8f36640e783a2b9bb50ec8124afdb2603a75b0caa6cfb5176fc938`.

