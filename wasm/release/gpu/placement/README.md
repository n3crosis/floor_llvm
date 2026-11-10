# Standalone Metal 4.1 placement GPU gate

This deliverable is separate from the frozen placement compiler patch and the shared Apple reference/interleave harness. It does not build a compiler, start CI, alter a library, or establish general Metal 4.1 conformance.

## Current evidence

- 296 local Node tests passed: 228 source/oracle/evidence-verifier tests and 68 postprocessing-matrix tests. These include all six generated sources, 72 CPU fixtures, an independent BigInt byte oracle, strict descriptor/CLI adapters, stage aggregation, raw-evidence corruption, guard corruption, and matching-but-wrong Apple/FLOOR outputs. All matrix execution fixtures are explicitly synthetic unit tests.
- Native preparation succeeded, according to the native validation receipt: frozen-v2 Swift compiled with no diagnostics, its CPU oracle matched all 72 fixtures, and all six unchanged sources compiled and linked with Apple Metal 4.1. Evidence bundle SHA256: `a09436e82c42a191a5072528e6668bca81167e55637afafc194de2f42fe03c67`. This was preparation only, with no GPU execution.
- No original FLOOR placement metallib pair was supplied for this deliverable. Paired library load, pipeline creation, execution, and numerical comparison are **not run**, not passed. The runner's real subprocess tests use explicitly synthetic non-GPU programs only.
- Synthetic reports/metallib headers appear only inside unit tests. They are not compiler or GPU evidence and must never enter a release gate.

## Files

- `metal-placement-numerical.swift`: standalone macOS host harness, frozen v2 for native compilation.
- `placement-gpu.mjs`: authored source generator, CPU object-state oracle, six compile-case descriptors, descriptor writer, and strict GPU argument adapter.
- `sources/*.metal`: six exact, self-contained sources, 2039–2421 UTF-8 bytes each.
- `placement-gpu-descriptor.schema.json`: machine-readable JSON Schema for all six exact descriptor alternatives.
- `source-contract.json`: exact source hashes, target and buffer contracts. Each case's `name` is its kernel entry name.
- `placement-gpu-oracle.json`: 72 expected CPU records for the optional compiled Swift cross-check.
- `verify-placement-gpu.mjs`: independent offline verification of complete saved GPU evidence against regenerated CPU expectations and original input files.
- `placement-gpu.test.mjs`: offline source/oracle/verifier tests.
- `run-placement-matrix.mjs`: independent postprocessor for an existing complete Apple-reference output.
- `placement-matrix.test.mjs`: synthetic postprocessor tests, not native or GPU evidence.

Run offline tests:

```
node --test placement-gpu.test.mjs placement-matrix.test.mjs
```

## Bounded source contract

Cases are `placement_gpu_{thread,threadgroup,device}_{scalar,array}`. All are one kernel, one threadgroup, and one GPU thread. The nontrivial record is two volatile `uint` fields, exactly eight bytes with four-byte alignment, guarded by static assertions. The scalar starts with a parameterized constructor. The two-element fixed array starts with two default constructions. Both explicitly call destructors, inspect ended-object storage only through unsigned-char representation, reconstruct using the newly returned pointers, and explicitly destroy the replacements. Each destructor XORs the first field and adds to the second with unsigned 32-bit wraparound.

Each trial uses six input words and checks:

- constructor field results;
- destructor effects in object representation;
- cookie-free original placement pointer identity;
- replacement pointer identity and constructor values;
- final destructor values;
- all final storage bytes, including arena canaries;
- the full host output allocation, including untouched prefix/suffix guards;
- a separate direct readback of the device arena in device cases.

The placement is at byte 16 inside a 64-byte arena. A scalar occupies bytes 16–23; an array occupies bytes 16–31. Extra suffix capacity keeps the known eight-byte-cookie/pointer-shift regression inside the allocation so the oracle detects corruption rather than relying on out-of-bounds behavior.

Buffer/dispatch bindings:

- buffer 0: six input `uint` words, 24 bytes, offset 0;
- buffer 1: 160-byte output allocation, bound at byte offset 16; kernel writes 128 bytes;
- device cases only: buffer 2 is a separate 64-byte arena, offset 0;
- threadgroup cases only: dynamic threadgroup index 0, 64 bytes;
- thread cases only: local `alignas(4) thread uchar arena[64]`;
- dispatch exactly `(1,1,1)` threadgroups and `(1,1,1)` threads per threadgroup.

Twelve vectors comprise four edge/structured cases plus eight deterministic six-word LCG vectors. GPU outputs never define the expected result. JavaScript models object-state transitions; Swift computes direct trace/byte expectations; an additional BigInt byte oracle cross-checks all 72 records in unit tests.

## Build exact original libraries

Retain compiler versions, source hashes, full commands, stdout/stderr, exit status, source commit/runtime pin, and produced artifact hashes. Library headers and a descriptor cannot prove which compiler produced a file or which flags it used. A numerical pass remains `qualification: numerical_only` until those external production records are reviewed.

Apple, once per exact source:

```
xcrun -sdk iphoneos metal -target air64-apple-ios27.0 -std=metal4.1 -fno-fast-math -c sources/CASE.metal -o CASE.apple.air
xcrun -sdk iphoneos metallib CASE.apple.air -o CASE.apple.metallib
```

FLOOR must use the fresh placement-enabled build and the unchanged source bytes:

```
air_compile_v3(source_pointer, UTF8_byte_count, 27, 0, 0, 410)
```

Here the arguments are iOS 27, compute kind 0, conservative math profile 0, and Metal 410. Require compile status 0; retain diagnostics and original result bytes as `CASE.floor.metallib`. Record the exact runtime/header hashes and source commit. API2 or the first API3/interleave checkpoint does not contain this placement feature. Never inject alternate helper declarations, substitute a different source, relabel an old runtime, or rewrite target metadata to obtain a GPU run.

## Compile host and independently cross-check its CPU oracle

```
xcrun swiftc metal-placement-numerical.swift -framework Metal -o metal-placement-numerical
./metal-placement-numerical --oracle-fixture placement-gpu-oracle.json --output NEW_CPU_SELF_TEST_DIRECTORY
```

CPU-only success returns exit 0 with `scope: cpu_oracle_only`, `gpuValidation: not_run`, and `status: oracle_self_test_passed`. It is never an eligible GPU report. Both modes refuse an existing output directory.

## Descriptor schema and per-case GPU command

After both original libraries exist:

```
node placement-gpu.mjs descriptor CASE CASE.apple.metallib CASE.floor.metallib CASE.descriptor.json
./metal-placement-numerical --descriptor CASE.descriptor.json --source sources/CASE.metal --apple CASE.apple.metallib --floor CASE.floor.metallib --output NEW_GPU_EVIDENCE_DIRECTORY
```

`CASE` is the exact case name. The descriptor is schema 1:

```
{
  "schema": 1,
  "suite": "floor-metal41-placement-gpu-v1",
  "feature": "msl41-placement-gpu",
  "case": { "name": "EXACT_KERNEL_ENTRY", "space": "thread|threadgroup|device", "form": "scalar|array", "count": 1 },
  "source": { "sha256": "EXACT_AUTHORED_SOURCE_SHA256", "bytes": 2039 },
  "bindings": { "...": "the exact bindings() object for the selected case" },
  "target": { "metalVersion": 410, "ios": 27, "mathProfile": 0 },
  "apple": { "sha256": "ORIGINAL_APPLE_METALLIB_SHA256", "bytes": 1234 },
  "floor": { "sha256": "ORIGINAL_FLOOR_METALLIB_SHA256", "bytes": 1234 }
}
```

The example above describes fields, not a runnable fabricated descriptor. Generate real descriptors with the module. Array `count` is 2; all source byte counts/hashes and library sizes are actual values. Unknown keys, changes to bindings/targets/source identity, and mismatched library bytes are rejected by the host's complete descriptor comparison.

The host loads the exact hashed `Data` through `makeLibrary(data:)`. It does not compile, invoke external programs, retarget, or rewrite files. Apple and FLOOR load/pipeline attempts are independent. It records each backend's load, pipeline, execution, and numerical status, then each trial's raw bytes and SHA256. It reads outputs only after the command completes successfully. A pending timed-out command stops further GPU dispatches.

Use an outer process timeout around this command, for example a `spawnSync` timeout. The 120-second host budget is a **soft pre-dispatch** budget, with a 20-second command wait; it cannot interrupt synchronous Metal library/pipeline APIs and is not a hard process deadline. Preserve reports on outer timeout, classify the run as incomplete/failed, and do not accept an intermediate report as success.

Exit codes in GPU mode:

- 0: both original libraries loaded, both pipelines created, all 12 trials per backend completed and matched the CPU oracle;
- 1: malformed inputs, a FLOOR load failure after Apple loaded, or an observed pipeline/execution/numerical/evidence error. An observed backend failure takes precedence over unavailable Apple reference;
- 77: no Metal device, or Apple reference cannot load with no independent observed later-stage failure. Unavailable is not pass.

## Verify saved raw evidence and integrate a separate gate

```
node verify-placement-gpu.mjs --directory NEW_GPU_EVIDENCE_DIRECTORY --descriptor CASE.descriptor.json --source sources/CASE.metal --apple CASE.apple.metallib --floor CASE.floor.metallib
```

The verifier checks original artifact hashes, descriptor-file identity, source bytes, all fixtures, all 12 unique ordered trials per backend, exact entry names and counts, full output and device arena bytes, every evidence hash, and pair agreement. It regenerates expectations rather than trusting the host's saved expected files or reported pass flags. Same wrong output from both backends fails. Successful verification says `verified_numerical_pass`, not compiler-provenance or full language conformance.

Integration entry points are exported by `placement-gpu.mjs`:

- `placementGPUCases()` yields conventional compile cases with `status:0`, `kind:0`, `api:3`, `ios:27`, `metalVersion:410`, `math:0`, source/sourceSha256, exact `entry`, `feature:'msl41-placement-gpu'`, `msl41PlacementGPU:true`, space/form/count, and bindings.
- `gpuArguments(case, {descriptor, source, apple, floor, output})` validates the unchanged full compile contract and returns arguments for **this** standalone executable.
- `descriptor(caseName, applePath, floorPath)` hashes the supplied original files. It requires bounded ordinary MTLB files, but does not prove compiler provenance.

Add a separate dispatch path for the feature marker only after the fresh placement compiler is available. Do not send these shaders to the shared integer/interleave executable or reuse its report validator. Keep per-case compile/link failures and diagnostics, GPU stage results, verifier result, and compiler provenance separate. Aggregate all six cases; a skipped, missing, unavailable, incomplete, failed, or CPU-only case cannot count as six-case GPU validation. Do not manufacture a descriptor with duplicate/substitute/retargeted files while waiting for FLOOR.

## Explicit limits

This is representative testing, not proof of every placement form or Metal 4.1 conformance. Only four-byte alignment is exercised. Apple's known alignas(32) placement frontend crash remains unresolved and is not qualified as support or unsupported syntax. This harness does not exercise cross-thread visibility, synchronization, atomics, constructor invocation order/count side effects, automatic reverse array destruction, dynamic bounds, heap allocation, delete, or custom allocation operators. Destructors are explicit and array elements have independent initial effects. Canaries are checked in the final arena snapshot; transient corruption later restored to the same bytes is not observable. Cookie-free pointer identity and the known shifted-array regression are independently observable. Native Apple acceptance/AIR and CPU-only self-tests do not establish FLOOR GPU behavior.

## Frozen-v2 error-report caveat

If persisting a numerical-stage report fails after a trial was appended, the error handler can append a duplicate failed trial. This cannot produce a qualified success; persistence failure marks failure, and the offline verifier rejects duplicate or excess trials. Swift is frozen for native compilation, so this failure-only reporting cleanup is deferred until that diagnostic cycle.

## Postprocess an existing full Apple-reference run

The standalone runner consumes, but never changes, an existing `apple-reference.mjs` output directory. It does not build libraries or rerun the primary gate:

```
node run-placement-matrix.mjs --reference-directory EXISTING_FULL_REFERENCE_OUTPUT --harness /absolute/path/to/metal-placement-numerical --output NEW_PLACEMENT_MATRIX_DIRECTORY --timeout-ms 180000
```

The output parent must already exist and the matrix output directory must not exist. Default timeout is 180000 ms per Swift invocation, configurable from 1000 through 300000 ms. Output is `matrix-report.json`, plus per-case descriptor, stdout/stderr logs, and the untouched Swift evidence directory. Process command, timeout, exit status/signal/error and log hashes are recorded. Swift remains exactly the native-qualified v2 binary source; the postprocessor does not rewrite it.

The existing primary output must contain the six exact `placementGPUCases()` sources. For each one, the full report must expose one matching alias (or direct exact case name), exact source SHA256, API3, iOS27, math0, Apple/FLOOR Metal410, and `languageMatched:true`. A different earlier placement probe with another source hash cannot substitute. An old full-reference run that omitted these six sources yields six explicit `missing` rows, not a pass.

For every resolved case the runner verifies:

1. `appleCompile`, `appleLink`, and `floorCompile` outcomes, preserving failed/unavailable/incomplete stages;
2. finalized schema2 `apple-reference-compile-link` status/exit agreement and API3 runtime metadata; a completed primary failure is eligible, an unfinished report is not;
3. exactly one successful original Apple compile command using the current 12-argument form, one original Apple link command using its 7-argument form, and one original FLOOR worker command using its 6-argument form; every argument is checked, trailing arguments are rejected, worker Node/script/runtime argument shapes are checked, and source/AIR/JSON/library paths must form one coherent absolute recorded chain; relocated evidence copies are allowed because their hashes are checked independently;
4. exact source bytes and source-bearing compiler input JSON, original Apple AIR hash, original Apple/FLOOR MTLB hashes, bounded ordinary files, and distinct original library bytes;
5. a freshly generated exact descriptor and a separate bounded Swift invocation;
6. report/exit/descriptor identity agreement and strict raw evidence verification using `verify-placement-gpu.mjs` before any success.

Producing commands are validated against the current `apple-reference.mjs` producer contract. If that producer intentionally changes its command shape, update and test this runner explicitly rather than silently accepting unvalidated arguments. The recorded commands are evidence, not cryptographic attestation of a compiler. The matrix retains numerical-only qualification.

All six cases are prelisted before input validation. Missing aliases remain `missing`; incomplete prerequisites are `blocked`; unavailable compiler or GPU stages remain `unavailable`; actual failures remain `failed`. A reported successful compile whose expected original artifact is missing is a failure. One case's ordinary failure does not suppress the other cases. The primary report's overall failed exit or unrelated errors do not prevent this matrix from attempting eligible cases. Do not invoke the matrix only behind `&&` or another primary-success condition.

A timed-out GPU process or an explicit GPU command timeout is different: pending GPU work may remain. The runner preserves that failure and validates later artifacts, but marks further dispatches `blocked` rather than submitting more GPU work. This is not six-case completion.

Matrix exit 0 requires all six cases to pass their independent CPU comparisons and strict raw verification. Exit 1 means at least one failure or invalid matrix inputs. Exit 77 means missing, blocked, or unavailable cases without an observed failure. None of those states counts as GPU success. The postprocessor can succeed independently of an unrelated primary-gate failure, but does not erase or overrule that separate failure.
