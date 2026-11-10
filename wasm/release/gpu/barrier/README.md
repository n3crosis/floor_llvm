# Standalone Metal 4.1 barrier GPU matrix

This postprocessor consumes a **completed** `apple-reference.mjs` output directory. It does not compile shaders, retarget or rewrite libraries, run CI, or change the generic GPU schema. A completed primary report may be failed or unavailable because of unrelated cases. The eight barrier cases are resolved and checked independently.

## Run

From the checkout root, build the existing, unchanged Swift harness:

```sh
xcrun swiftc -O wasm/release/metal-barrier-gpu.swift -framework Metal -o /tmp/metal-barrier-gpu
node wasm/release/gpu/barrier/run-barrier-matrix.mjs \
  --reference-directory /absolute/completed-apple-reference-output \
  --harness /tmp/metal-barrier-gpu \
  --output /absolute/new-barrier-matrix-output \
  --timeout-ms 150000 \
  --matrix-timeout-ms 1200000
```

The output directory must not exist, and its parent must exist. Never reuse a GPU evidence directory. The Swift source remains at `wasm/release/metal-barrier-gpu.swift`, with native-compiled source SHA256 `a9200ae311d4ce1ae40c0832f199bea605ccc4cf959b6b5f59505779678e2e61`. The runner verifies this source hash and records/rechecks the supplied executable identity. The caller must build that executable from the frozen source; this runner does not itself attest a compiler invocation.

Run this as a separate always-after-primary CI step, after placement, at the next deliberately chosen checkpoint. Upload its output even when the step fails. Do not gate its invocation on the primary report's overall success. This bundle does not change the workflow or trigger a build.

## Required compiler evidence

For each source variant, the input directory must retain:

- Completed `report.json`, schemaVersion 2, mode `apple-reference-compile-link`, including the runtime API version, successful original compile/link command records and exact case aliases.
- Original `case-N.metal`, `case-N.json`, `case-N.air`, `case-N.apple.metallib` and `case-N.floor.metallib`.
- Source hash, API 3, iOS 27, Metal 4.1 on both compilers, conservative math 0 and metallib output kind 0. The worker JSON source and actual source bytes must match.
- Original AIR/library hashes matching the report. Producing command paths must form one source → AIR → Apple library and source JSON → FLOOR library chain. Relocating the complete input directory is supported; rewriting the original receipts is not.

The sources cover threadgroup/simdgroup × acq_rel/seq_cst × default/explicit scope. `source-pins.json` pins the eight sources that passed native preparation. Runtime dependencies of this supplemental folder are `../../msl41-barriers.mjs` and its existing imports, and `../../metal-barrier-gpu.swift`. Paths resolve relative to the modules, not the shell's current directory.

## Outcomes and safety bounds

`matrix-report.json` prelists all eight expected cases before setup or dispatch. It retains per-case compilation receipts, original artifact identities, process outcomes, bounded logs and GPU details.

- Exit 0: all eight cases have independently verified paired numerical evidence.
- Exit 1: any failed case, timeout, malformed setup or attempted FLOOR load failure, even when the Apple reference was unavailable.
- Exit 2: missing or blocked evidence without another failure.
- Exit 77: only passed/unavailable cases, with at least one unavailable case and no failed FLOOR or GPU execution attempt.

The raw Swift outcome is retained separately. Both rejected library loads are preserved as failed backend attempts; an unavailable Apple reference does not hide a rejected FLOOR load. No-device unavailability does not invent a failed backend attempt. The frozen Swift report is global for pipeline/execution in some failure paths, so unreported backend stages remain explicitly unreported rather than being inferred successful.

Missing, unreadable or semantically invalid completion reports, process signals, process timeouts, reported GPU semaphore timeouts, and incomplete/in-progress execution fence all later GPU dispatches. Remaining cases still get resolution/artifact outcomes and remain visible. Completed numerical failures do not prevent unrelated later cases. The fence is set before fallible log writes.

Default bounds are 150 seconds per process and 20 minutes for the matrix. Supported maxima are 300 seconds per process and 40 minutes total. Subprocess capture is bounded to 1 MiB, saved stdout/stderr to 256 KiB each. Source, report, receipt, original library and raw-value reads also have explicit limits and reject symlinked files. No shell is used for harness execution.

## Raw numerical verification

A pass flag is insufficient. The offline verifier checks:

- Exact original library hashes and sizes, matching dispatch kind, device observation and completed loading/pipeline/execution stages.
- One threadgroup, correct scratch bytes, and at most one active SIMD-group in each pipeline for simdgroup cases.
- All sixteen ordered trial records in `values.json`, with independent deterministic input regeneration and uint32 checks.
- Both Apple and FLOOR raw output-word arrays independently equal the CPU oracle. Stored expected words are checked too, not trusted. Checked-word totals must agree.
- Original source/library bytes still match their receipt after execution.

The two opposite cyclic shifts in the authored kernel cancel, so the independent result is each input word XOR `0x9e3779b9`. This is bounded producer/consumer and scratch-reuse evidence, not proof of the complete Metal memory model. The compiled pipeline's maximum thread count is not present in the frozen report; the verifier checks the reported geometry's safe domain rather than inventing an unreported value.

Recheck one recorded successful case offline:

```sh
node wasm/release/gpu/barrier/verify-barrier-gpu.mjs \
  --directory /absolute/matrix/CASE/gpu \
  --receipt /absolute/matrix/CASE/pair-receipt.json \
  --source /absolute/reference/case-N.metal \
  --apple /absolute/reference/case-N.apple.metallib \
  --floor /absolute/reference/case-N.floor.metallib
```

The offline verifier establishes numerical/file-identity consistency. Original compiler-command provenance is established by the matrix receipt builder, not by a caller-created receipt alone.

## Helper tests

```sh
node --test wasm/release/gpu/barrier/*.test.mjs
```

All test reports, libraries and process stubs are explicitly synthetic. These tests exercise mutation rejection, independent primary-case handling, provenance, missing/failed/unavailable distinctions, timeout/incomplete fences, bounded subprocess behavior and fresh directories. They are not GPU or new compiler qualification.

Runtime files to package: `barrier-gpu.mjs`, `run-barrier-matrix.mjs`, `verify-barrier-gpu.mjs`, `source-pins.json`. Package this README as documentation. The two `.test.mjs` files and `barrier-test-fixtures.mjs` are source-test dependencies only.
