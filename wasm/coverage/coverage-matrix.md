# Detailed coverage matrix

## Current feature tracks

The built `1accfd4` checkpoint passes 497 compiler cases and all 82 reference compile/link pairs. Both libraries load in 48 GPU-eligible pairs; native outcomes are 8 numerical passes, 4 constant-integer disagreements and 36 Apple interleave pipeline failures. FLOOR interleave pipelines and numerics are unrun. Hardware Mac validation has returned; the paired gate remains failed, with separate FLOOR-only passes recorded below.

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

The newer published source candidate is unbuilt: 788 compiler cases and 172 Apple pairs are configured, not passing counts. Its 48 generic GPU pairs and 24 texture / 6 placement / 8 barrier supplemental GPU cases are separate plans. See CURRENT-SUPPORT.md, checkpoint-evidence.json and development-status.json.


## Hardware checkpoint follow-up, separate evidence

The same authenticated `1accfd4` compiler was tested on **Apple M1 Max, macOS 27.2, Xcode/iPhoneOS SDK 27.2**. Its unchanged paired gate remains **failed**: 82 compile/link pairs, both libraries loaded in 48 eligible pairs, 8 numerical passes, 4 known Apple-only constant-boundary sentinel discrepancies, and 36 Apple interleave pipeline failures. The hardware diagnostic reports **unlowered air.interleave / air.deinterleave intrinsic calls**. Original paired FLOOR interleave pipeline creation and both backends' interleave execution remain `not_run`.

Separate diagnostics created both Apple and FLOOR pipelines for the original no-interleave MSL4.1/iOS27 control. All 36 original FLOOR interleave pipelines then created successfully, while all 36 Apple interleave pipelines still failed. This isolates Apple intrinsic lowering on this device/toolchain, rather than a blanket inability to create any 4.1 pipeline. It does not distinguish an unsupported GPU feature from an Apple compiler/driver defect or establish failure on other devices. No control GPU execution is claimed.

A **separate FLOOR-only run passed all 36 cases, 1,446 dispatches and 2,192 output words against an independent CPU oracle** using original libraries. This is bounded unsigned 8/16/32-bit scalar/vector interleave and deinterleave coverage across dynamic/constants and both math settings. **It is not Apple/FLOOR parity:** Apple interleave execution remains unrun and the original aggregate remains failed. Neither these results nor source publication qualify the newer unbuilt candidate.

The independent evidence audit checked 662 shared files, all 82 source identities and 48 original GPU report contracts, replayed 203,984 original logical values, and separately replayed all 1,446 FLOOR-only dispatch records / 2,192 words. Omitted binaries (249 main entries and 3 supplement entries) were not rehashed; their retained hashes are provenance, not another binary verification. No GPU execution was rerun during the audit.

See `hardware-checkpoint-evidence.json`, `hardware-checkpoint-case-matrix.csv` and `floor-only-interleave-case-matrix.csv`. The hosted `checkpoint-evidence.json` and `checkpoint-case-matrix.csv` remain unchanged historical records; their hardware-pending field describes that earlier snapshot only. The main hardware return ZIP is a path-redacted copy, not the original locally retained ZIP. Its SHA-256 is `01c85d2645f9d4f3749ca923826f341b83b0f5523cbb94731365b69e2f93d40d`; the separate supplement SHA-256 is `8bebb55f9c8f36640e783a2b9bb50ec8124afdb2603a75b0caa6cfb5176fc938`.

## Historical 81d2559 baseline: 30-family table

**Everything below, including present-tense implementation descriptions and next steps, is the original baseline audit at `81d255965a578d9dd55ec4cd2b53a2f239a989f1`, not current checkpoint status.** These rows are deliberately retained without promotion or rewritten history. The original 285-case suite, 34 reference pairs, 12 load pairs and original derivative pipeline failures remain scoped to that baseline. Later corrected derivative results and the built 1accfd4 checkpoint are separate evidence.

| Feature | Source | Exact-head AIR | Apple compile/link | Original library load | Pipeline | GPU commands | GPU numerics | Priority |
|---|---|---|---|---|---|---|---|---|
| Language and target contract | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P0: genuine 4.1 mode and OS 27 target |
| Scalar/vector types and layout | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Stage interfaces and address spaces | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Function constants and conditional color | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| AIR and metallib container | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | Parallel baseline validation; does not establish 4.1 |
| 32-bit integer bit functions | partial | passed_ci | passed | passed | passed | completed | failed | Parallel baseline validation; does not establish 4.1 |
| Remaining integer overloads/functions | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2 |
| Float common functions | partial | passed_ci | passed | not_covered | not_covered | not_covered | not_covered | Parallel baseline validation; does not establish 4.1 |
| Float math and precise/fast behavior | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Relational, select and bit reinterpretation | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Float derivatives and fwidth | partial | passed_ci | passed | passed | failed | not_run | not_run | Parallel baseline validation; does not establish 4.1 |
| Other fragment operations | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2 |
| SIMD vote and shuffle | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Relaxed atomics and threadgroup barrier | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Authored texture/resource subset | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Authored depth resource subset | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Packed storage and normalized unpack | partial | passed_ci | not_covered | not_covered | not_covered | not_covered | not_covered | P2: existing-feature breadth |
| Tessellation subset | partial | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2 |
| Matrix and geometric APIs | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2 |
| Argument buffers, imageblocks and resource arrays | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3 |
| Ray tracing, visible functions and mesh/object stages | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3 |
| 4.1 placement new | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: remaining 4.1 feature tracks |
| 4.1 float conversion rounding option | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: remaining 4.1 feature tracks |
| 4.1 intersection function_id | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3: 4.1 type/ABI/hardware dependencies |
| 4.1 block-scaling packed numeric formats | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3: 4.1 type/ABI/hardware dependencies |
| 4.1 multiplane tensors and tensor_blockwise | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3: 4.1 type/ABI/hardware dependencies |
| 4.1 interleave/deinterleave | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P1: first bounded 4.1 feature |
| 4.1 acquire/release barriers and atomics | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: remaining 4.1 feature tracks |
| 4.1 new texture reads | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P2: remaining 4.1 feature tracks |
| 4.1 Metal Performance Primitives matrix types | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | not_covered | P3: 4.1 type/ABI/hardware dependencies |

## Feature details

### LANG: Language and target contract

- Specification: 1.5; 1.6.2; 1.6.10 pp 12-21.
- Implemented scope: Baseline v1/v2 accept iOS 18/26 and select metal3.2 for both. iOS 26 AIR/MSL 2.7/3.2 disagrees with metallib VERS 2.8/4.0. Staged explicit v3 tuples are separate and unbuilt.
- Existing validation: Direct source inspection of API and Apple flags. Inherited frontend has metal41 and MetalVersion=410, but the public WASM API does not select it. Newer C++/GNU/OpenCL flags require language-restriction audit.
- Next validation: Build and validate staged explicit v3 tuples 18/320,26/400,27/410; check macros and actual AIR/VERS agreement. Track legacy iOS 26 mismatch separately: it is not fixed by v3 or qualified by loader success.
- Source: [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp), [wasm/release/apple-reference.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/apple-reference.mjs), [clang/include/clang/Basic/LangStandards.def](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/include/clang/Basic/LangStandards.def), [clang/lib/Frontend/CompilerInvocation.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/lib/Frontend/CompilerInvocation.cpp), [llvm/lib/Bitcode/MetalLib/MetalLibWriterPass.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/llvm/lib/Bitcode/MetalLib/MetalLibWriterPass.cpp).

### TYPES: Scalar/vector types and layout

- Specification: 2.1-2.5 pp 25-39.
- Implemented scope: Named char/uchar/short/ushort/int/uint/long/ulong/half/float vectors of widths 2/3/4; vec<T,N> wrapper excludes bool; packed_uint2/3/4 authored records.
- Existing validation: Vertex-storage IR/layout probes; int3/uint3 GPU harness preserves 16-byte stride.
- Next validation: Add explicit size/alignment, vector swizzle and constructor, half conversion, signed/unsigned boundary and packed byte-pattern tests. Native parser support is not complete library support.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs), [wasm/release/metal-numerical.swift](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/metal-numerical.swift).

### ABI: Stage interfaces and address spaces

- Specification: 4; 5.1-5.2.
- Implemented scope: Kernel/vertex/fragment interfaces, buffers, vertex attributes, position and color metadata; member address-space fixes and empty vertex cases.
- Existing validation: Authored compile regressions and Clang Sema/CodeGen tests exist; no new Apple/load/pipeline result.
- Next validation: Pair Apple compile and actual graphics/compute pipeline creation with struct offsets, buffer slots, interpolation and void vertex variants.
- Source: [clang/test/SemaCXX/metal-interface-attributes.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/test/SemaCXX/metal-interface-attributes.cpp), [clang/test/CodeGenCXX/metal-interface-abi.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/clang/test/CodeGenCXX/metal-interface-abi.cpp), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### CONST: Function constants and conditional color

- Specification: 5.8.
- Implemented scope: Bool specialization and conditional framebuffer input/output for float4/uint4; sparse color slots and per-entry constant metadata.
- Existing validation: 16 metallib cases bind constants to exact entries; synthetic metadata mutation tests.
- Next validation: Specialize true and false with Apple and FLOOR, create pipeline, test sparse slots and buffer 29, verify expected pixels. Current 34-case Apple gate excludes this group.
- Source: [wasm/release/conditional-color.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/conditional-color.mjs), [wasm/release/metallib-metadata.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/metallib-metadata.mjs), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### FORMAT: AIR and metallib container

- Specification: Compiler artifact format; not a complete MSL feature.
- Implemented scope: LLVM module finalization and custom MTLB writer; checked public/private record lengths and hashes.
- Existing validation: Fresh exact-head CI passed 285 cases, including 103 structurally validated metallib outputs; validators never rewrite bytes. This suite did not reject the known legacy iOS 26 AIR/VERS version mismatch.
- Next validation: Build the 4.1 candidate and enforce version coherence; retain original baseline evidence. Baseline structural checks passed; loader success for 12 paired sources does not qualify all 103 container cases or fix legacy metadata disagreement.
- Source: [wasm/release/metallib-metadata.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/metallib-metadata.mjs), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs), [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp).

### INT32: 32-bit integer bit functions

- Specification: 6.4 Table 6.2 pp 202-204.
- Implemented scope: clz/ctz/popcount/reverse_bits/extract_bits/insert_bits on int/uint and 2/3/4 vectors; scalar unsigned offset/count; explicit reject other widths.
- Existing validation: Exact-head CI passed 53 cases: 16 successes (8 AIR+8 metallib), 37 rejections. Mac 34-pair continuation passed the 8 integer compile/link pairs and both loads. 4 dynamic pairs passed 46,656 checks each; 4 constants pairs failed at first uint2 entry (Apple sentinel vs FLOOR CPU match). Cause unresolved.
- Next validation: Investigate constant offset 32/count 0 extract/insert discrepancy without suppressing it; isolate defined-domain assumptions, compiler output, driver and harness. Preserve 4 dynamic passes and 4 constant failures separately. Later constant entry points remain unrun.
- Source: [wasm/api/include/metal_integer](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_integer), [wasm/release/integer-vector.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/integer-vector.mjs), [wasm/release/metal-numerical.swift](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/metal-numerical.swift).

### INT_MORE: Remaining integer overloads/functions

- Specification: 6.4 Table 6.2 pp 202-205.
- Implemented scope: Scalar int abs and scalar int/uint min/max/clamp exist; full narrow/wide vector and integer function table not supplied.
- Existing validation: Narrow/wide rejection coverage for implemented 32-bit subset; no full Table 6.2 conformance inventory.
- Next validation: Add signature-by-signature ledger for absdiff/addsat/subsat/hadd/rhadd/mulhi/madhi/madsat/mad24/mul24/rotate and min/max families; preserve explicit unsupported diagnostics.
- Source: [wasm/api/include/metal_integer](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_integer), [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math).

### COMMON: Float common functions

- Specification: 6.3 Table 6.1 pp 200-202.
- Implemented scope: Same-width float/float2/3/4 mix/step/smoothstep/sign via metal_stdlib; existing clamp/saturate. Half, mixed types, scalar-vector additions are out of subset.
- Existing validation: Exact-head CI passed 76 cases: 44 successes (22 AIR+22 metallib), 32 rejections. All 22 Mac Apple/FLOOR compile/link pairs passed. No common GPU harness.
- Next validation: Implement CPU+Apple+FLOOR numerical harness; the 22 positive compile/link pairs already pass. Use legal domains only; current GPU/load/pipeline stages are not covered for common cases.
- Source: [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math), [wasm/release/common-functions.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/common-functions.mjs), [wasm/release/common-functions-ir.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/common-functions-ir.mjs).

### MATH: Float math and precise/fast behavior

- Specification: 6.6; 8.4.
- Implemented scope: Float scalar/vector sqrt/rsqrt/exp2/log2/sin/cos/ceil/rint, bitwise trunc/abs, conservative floor; precise/fast min/max/clamp and related helpers.
- Existing validation: Symbol/signature, call-flag and selected bit-pattern IR checks; bounded helper tests are not numerical device qualification.
- Next validation: Add Apple compilation and GPU oracle corpus per function and profile. Respect spec accuracy and exceptional-value rules; do not demand bitwise equality for all transcendentals.
- Source: [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### REL: Relational, select and bit reinterpretation

- Specification: 6.5; 2.23.
- Implemented scope: as_type equal-size bitcast, scalar/vector select and signed comparison-mask all; custom isnan masks.
- Existing validation: Authored math/color and storage tests; no complete boolean/relational API validation.
- Next validation: Test high-bit mask semantics, all/any distinction, each lane, NaN classes, signed zero and unsupported boolean vector spellings.
- Source: [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math), [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### DERIV: Float derivatives and fwidth

- Specification: 6.11.1.1 Table 6.19 p 235.
- Implemented scope: Float/float2/3/4 dfdx/dfdy/fwidth; fragment-only. Half and integer calls intentionally rejected.
- Existing validation: Exact-head CI passed 38 cases: 8 successes (4 AIR+4 metallib), 30 rejections. All 4 Mac compile/link pairs and both library loads passed. First Apple pipeline failed in all4 pairs because scalar output was paired with RGBA32Float; no derivative execution.
- Next validation: Corrected native follow-up passed four pairs and 4,320 pixel-lane checks each with augmented source/harness. Original pipeline failures remain recorded. Add negative/mixed affine slopes; this bounded position test does not prove fwidth magnitude behavior for negative slopes.
- Source: [wasm/api/include/metal_control](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_control), [wasm/release/derivative-vector.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/derivative-vector.mjs), [wasm/release/metal-numerical.swift](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/metal-numerical.swift).

### FRAG_MORE: Other fragment operations

- Specification: 6.11.1.2-6.11.1.3.
- Implemented scope: discard_fragment wrapper exists; per-sample and wider fragment builtins not inventoried in authored surface.
- Existing validation: No dedicated new Apple/GPU case group.
- Next validation: Test discard coverage/side effects, helper invocation, sample count and sample-position availability; never treat derivatives in nonuniform control flow as defined numerical oracle.
- Source: [wasm/api/include/metal_control](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_control), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### SIMD: SIMD vote and shuffle

- Specification: 6.10.
- Implemented scope: simd_ballot, compute-only simd_all; float and 16/32/64-bit integer scalar/vector shuffle through finite float packet encoding.
- Existing validation: Trusted convergent declarations and authored header; not among new 34 Apple pairs.
- Next validation: Run multiple subgroup widths, boundary lanes, bit patterns and active masks; test convergence and inactive-lane preconditions. Broad reductions/scans are not covered.
- Source: [wasm/api/include/metal_simd](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_simd), [wasm/api/include/metal_control](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_control), [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp).

### ATOMIC: Relaxed atomics and threadgroup barrier

- Specification: 6.10; 6.16.
- Implemented scope: atomic_uint: device add/min; threadgroup add/min/max; constant relaxed order; threadgroup-memory barrier only.
- Existing validation: Header enforces fixed order/flags; no GPU contention or memory-visibility proof in current gate.
- Next validation: Add contention and shared-memory producer/consumer litmus tests with independent host expectations; reject unsupported orders without silently weakening semantics.
- Source: [wasm/api/include/metal_atomic](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_atomic), [wasm/api/atomic_trust.inc](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/atomic_trust.inc).

### TEXTURE: Authored texture/resource subset

- Specification: 2.9-2.10; 6.13.
- Implemented scope: float sampled texture2d/3d/2d_array/cube, selected reads/samples/gathers/queries, float write 2d/3d and buffer reads. Forward declarations do not prove implemented shapes.
- Existing validation: Separate older texture Apple compile evidence exists but is not evidence for this exact head; not in current 34-pair gate.
- Next validation: Build shape/access/type/operation/coordinate/LOD matrix, include 1D zero-LOD restriction and depth-MS-array SDK discrepancy. Compare resource data, pixels and bounds policies on device.
- Source: [wasm/api/include/metal_texture](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_texture), [wasm/api/include/metal_depth](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_depth), [wasm/api/texture_trust.inc](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/texture_trust.inc), [wasm/api/depth_trust.inc](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/depth_trust.inc).

### DEPTH: Authored depth resource subset

- Specification: 6.13.10-6.13.15.
- Implemented scope: depth2d_array<float,sample> and depthcube<float,sample> authored specializations; wider depth declarations do not imply definitions.
- Existing validation: No new dedicated Apple or GPU group.
- Next validation: Probe compare/gather/read/query signatures and sampler comparison semantics, include depth-MS-array signature resolution against Apple.
- Source: [wasm/api/include/metal_depth](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_depth), [wasm/api/include/metal_texture](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_texture).

### PACK: Packed storage and normalized unpack

- Specification: 2.2.3; packing functions.
- Implemented scope: packed_uint2/3/4 with 4-byte alignment; five normalized unsigned-word-to-float-vector unpack operations.
- Existing validation: Storage-layout and exact AIR signature checks; no vertex-fetch or unpack numerical device proof.
- Next validation: Exhaust edge encodings and bounded random payloads; compare integer input bytes,3-lane stride, signed normalized minimum and vertex-fetch pixels.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math), [wasm/release/probe.mjs](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/release/probe.mjs).

### TESS: Tessellation subset

- Specification: 5.1.1.1-5.1.1.2; 5.2.3.2.
- Implemented scope: MTLQuadTessellationFactorsHalf layout and patch_control_point wrapper.
- Existing validation: Compile/source subset only in this inventory; no complete stage or GPU suite.
- Next validation: Inventory patch attributes, control-point address spaces, factor layouts and limits; test runtime tessellation separately by device support.
- Source: [wasm/api/include/metal_tessellation](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_tessellation).

### MATRIX: Matrix and geometric APIs

- Specification: 2.3-2.4; 6.7-6.9.
- Implemented scope: No authored complete matrix/SIMD-matrix/geometric standard-library implementation identified in selected headers.
- Existing validation: No complete signature or numerical suite.
- Next validation: Probe native compiler/type behavior before classifying each signature unsupported; then add layout, multiply/transpose/dot/cross/normalize and numerical tests.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/api/include/metal_math](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_math).

### RESOURCES: Argument buffers, imageblocks and resource arrays

- Specification: 2.11-2.13; 5.6-5.7.
- Implemented scope: No authored complete public surface identified; inherited compiler internals may expose subsets.
- Existing validation: No feature-family coverage claim.
- Next validation: Inventory exact syntax, binding ABI and runtime feature gates before implementation; test resource residency and argument-buffer tiers.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp).

### ADVANCED: Ray tracing, visible functions and mesh/object stages

- Specification: 2.15-2.20; relevant stage/builtin sections.
- Implemented scope: No authored ray-tracing/visible-table/mesh standard-library surface found.
- Existing validation: No feature-family Apple or GPU suite.
- Next validation: Keep separate hardware-gated tracks with explicit stage/type/ABI requirements; do not infer availability from OS or M-series name alone.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib), [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp).

### NEW41_NEW: 4.1 placement new

- Specification: 1.3; 1.5.4; 6.2.
- Implemented scope: No advertised 4.1 language mode or authored placement-new interface; host C++ include<new> is unrelated.
- Existing validation: No 4.1 positive/negative version-gate probe.
- Next validation: After language-mode work: object lifetime/address-space/alignment/destruction tests with Apple 4.1 reference.
- Source: [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp), [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib).

### NEW41_ROUND: 4.1 float conversion rounding option

- Specification: 1.3; 1.6.3.
- Implemented scope: API exposes conservative/fast only, not the 4.1 default float-to-float round-toward-zero option.
- Existing validation: No conversion rounding option or exceptional-value suite.
- Next validation: Design separate option; test rounding boundaries, sign, subnormals, overflow and cross-width conversions with prescribed rounding oracle.
- Source: [wasm/api/air_compiler.h](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.h), [wasm/api/air_compiler.cpp](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/air_compiler.cpp).

### NEW41_FUNCID: 4.1 intersection function_id

- Specification: 1.3; 2.17.4-2.17.5.
- Implemented scope: Intersection result surface is not supplied.
- Existing validation: No source/AIR/runtime suite.
- Next validation: Depends on ray-tracing type and ABI support plus capable device; test function identity for intersections/misses.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib).

### NEW41_PACK: 4.1 block-scaling packed numeric formats

- Specification: 1.3; 2.21.
- Implemented scope: Existing packed_uint records are storage helpers, not these new packed numeric formats.
- Existing validation: No new packed-format type/encoding coverage.
- Next validation: Define type/layout and scale semantics; add packing/unpacking and rounding oracle tests before hardware execution.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib).

### NEW41_TENSOR: 4.1 multiplane tensors and tensor_blockwise

- Specification: 1.3; 2.22.
- Implemented scope: No authored tensor/blockwise surface identified.
- Existing validation: No source/AIR/runtime suite.
- Next validation: Implement prior tensor ABI prerequisites, then shape/stride/plane/block-scale bounds and GPU capability tests.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib).

### NEW41_BITS: 4.1 interleave/deinterleave

- Specification: 1.3; 6.4 pp 202-203.
- Implemented scope: Missing from metal_integer; not the existing reverse/extract/insert 32-bit functions.
- Existing validation: No 4.1 compile or numeric suite.
- Next validation: Good first 4.1 builtin candidate after version gating: uchar2↔ushort, ushort2↔uint, uint2↔ulong; both interleave overloads; fixed patterns, exhaustive small inputs and round trips.
- Source: [wasm/api/include/metal_integer](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_integer).

### NEW41_MEMORY: 4.1 acquire/release barriers and atomics

- Specification: 1.3; 6.10; 6.16.1.2; 6.16.4.
- Implemented scope: Only constant relaxed atomic order and one threadgroup-memory barrier are exposed.
- Existing validation: No acquire/release lowering or memory-model validation.
- Next validation: Add exact order/scope lowering plus legal/illegal combinations, cross-thread visibility and bounded stress/litmus tests. Cannot certify solely from output values in one run.
- Source: [wasm/api/include/metal_atomic](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_atomic), [wasm/api/atomic_trust.inc](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/atomic_trust.inc).

### NEW41_READS: 4.1 new texture reads

- Specification: 1.3; 6.13.
- Implemented scope: No complete clamp-to-edge read, integer-coordinate offset read or multi-pixel read 4.1 interface identified.
- Existing validation: Existing read/sample wrappers are not coverage of new read overloads.
- Next validation: Build exact 4.1 overload matrix and Apple probes; exercise border coordinates, offset limits, component ordering and array/mip cases on capable devices.
- Source: [wasm/api/include/metal_texture](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_texture), [wasm/api/include/metal_depth](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_depth).

### NEW41_MPP: 4.1 Metal Performance Primitives matrix types

- Specification: 1.3; 17.2.1.
- Implemented scope: No authored MPP matrix-multiply interface identified.
- Existing validation: No type, reference compile or numeric suite.
- Next validation: Depends on tensor/packed format ABI and feature-specific hardware support; use shape/type/scale/accuracy matrix.
- Source: [wasm/api/include/metal_stdlib](https://github.com/n3crosis/floor_llvm/blob/81d255965a578d9dd55ec4cd2b53a2f239a989f1/wasm/api/include/metal_stdlib).

