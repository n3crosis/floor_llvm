# Standalone MSL 4.1 sampler-read GPU comparison

This bundle is isolated from the frozen compiler patch. It does not rebuild, patch, retarget, publish, or invoke CI. It compares original Apple and FLOOR iOS 27 / Metal 4.1 metallibs from the same exact source and math profile. Compiler acceptance, Swift compilation, library loading, pipeline creation, execution, and numerical correctness remain separate evidence layers.

## Current verification

- 62 Python CPU, source-contract, receipt, raw-evidence, and synthetic orchestration tests pass locally.
- All 480 geometry/mode queries match an independent direct-coordinate CPU oracle. The 24 source/math descriptors reuse 12 geometry/mode fixtures, so a full matrix executes 960 queries per backend, 1,920 dispatches total.
- The authored sources are byte-identical to the final argument-buffer matrix already accepted and linked by Apple. No new FLOOR texture binary or paired GPU execution has been produced here.
- Native Swift v2 SHA256 eafb0ed0cc917d3f5c35da981108325d7d6b8e85961791a68a8c3f1e7c2fa668 compiled successfully with -O on the Mac; only the managed-storage deprecation warning was reported. Native compile evidence ZIP SHA256: a09436e82c42a191a5072528e6668bca81167e55637afafc194de2f42fe03c67. This proves Swift compilation only, not library loading or GPU execution.
- The spec basis is the June 4, 2026 Metal Shading Language Specification, pp. 239–240: add offset before clamp-to-edge; offsets are per-component -8 through +7; lod and array slice are not clamped; out-of-bounds full-RGBA reads return zero.

## Files

- `metal-texture-read-numerical.swift`: standalone host runner.
- `metal-texture-read-gpu-cases.json`: 24 exact source/math descriptors, with source SHA256 and entry names.
- `source-pins.json`: 12 geometry/mode source hashes, also embedded in Swift.
- `texture-read-oracle-fixtures.json`: 12 geometry/mode fixtures, 480 queries, exact binary32 expected words.
- `make_texture_read_fixtures.py`: deterministic fixture authoring tool. It defaults to the bundled module-relative descriptor input, or accepts --source PATH. Both routes require the exact frozen source hashes. Regeneration does not automatically change the Swift or verifier fixture pin.
- `make_texture_read_pair_receipt.py`: requires an actual successful paired compile/link record and byte-identical sources/libraries. It does not infer success from file existence.
- `verify_texture_read_report.py`: strict successful-GPU evidence gate, checks original libraries, every output, guards, hashes, and stage outcomes.
- `test_texture_read_gpu.py`: CPU and source/evidence tests, including synthetic reports explicitly confined to temporary test directories.
- `run_texture_read_gpu_matrix.py`: standalone all-24 post-processor for existing paired compiler outputs.
- `test_texture_read_matrix.py`: synthetic orchestration, subprocess timeout, and bounded-log tests.

## Build and local tests

```
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_texture_read_gpu test_texture_read_matrix
xcrun swiftc -O metal-texture-read-numerical.swift -framework Metal -o metal-texture-read-numerical
```

Keep Swift compiler stdout, stderr, exit status, tool versions, source hash, and executable hash separately. Never use an older Swift source's successful type check as proof for a changed hash.

## Pair original libraries

First run the normal paired Apple/FLOOR compiler checkpoint when the integration owner chooses a meaningful batch. Do not trigger one for every push. The helper consumes the existing `apple-reference.mjs` schemaVersion 2 report with mode `apple-reference-compile-link`.

Choose the row whose aliases include the exact GPU descriptor name and whose source hash and math profile match. The reference runner deduplicates kind0/kind1 descriptors into a binary-output case named `case-N`; this is expected because source bytes are identical. Do not hardcode N. Each row must have appleCompile, appleLink and floorCompile equal to passed, api 3, ios 27, and both selected Metal versions 410.

Example after identifying the matching case:

```
CASE=msl41-sampler-read-texture2d-dynamic-math0-kind1
python3 make_texture_read_pair_receipt.py \
  --compile-report /evidence/reference/report.json --case "$CASE" \
  --source /evidence/reference/case-N.metal \
  --apple /evidence/reference/case-N.apple.metallib \
  --floor /evidence/reference/case-N.floor.metallib \
  --output /evidence/pair.json
```

The receipt contains schemaVersion 1, api, ios, metalVersion, math, sourceSha256, appleMetallibSha256, floorMetallibSha256, and the originating compile-report SHA256/case identity. Keep the original report, sources, commands/logs, and binaries. Hash matching ties artifacts together; it is not cryptographic proof of which compiler produced them.

## Run one descriptor

```
./metal-texture-read-numerical \
  --apple /evidence/reference/case-N.apple.metallib \
  --floor /evidence/reference/case-N.floor.metallib \
  --descriptors metal-texture-read-gpu-cases.json --case "$CASE" \
  --pair-receipt /evidence/pair.json \
  --oracle-fixtures texture-read-oracle-fixtures.json \
  --output /evidence/texture-case-N-gpu
```

Use a fresh output directory for each invocation. Run under a caller-side 240-second process timeout, since native library/pipeline creation calls can block outside the runner's cooperative deadline. The runner has a 180-second cooperative budget, 20 seconds per GPU command, at most 128 queries per backend, 32 MiB per original library, and bounded metadata files. Retain timeout/crash/stderr outcomes; never treat missing reports as success.

Exit codes: 0 paired numerical success; 1 failed validation/execution; 77 unavailable original Apple target or Metal device. Both library loads are attempted, and each successfully loaded backend runs independently. If Apple cannot load the original iOS-target library on this Mac, the pair is unavailable even if FLOOR executes. Do not retarget either artifact to macOS to manufacture a pass.

For exit 0, require the strict gate as well:

```
python3 verify_texture_read_report.py /evidence/texture-case-N-gpu \
  --apple /evidence/reference/case-N.apple.metallib \
  --floor /evidence/reference/case-N.floor.metallib
```

Archive `report.json`, `source.metal`, `pair-receipt.json`, both `*-queries.json`, both `*-output.bin`, original libraries, and process exit/logs. Raw outputs include four guard words after each query's four or eight active words, all little-endian binary32 bit patterns. The report includes resource payload hashes, argument-buffer layout observations, and separate backend load/pipeline/resource/execution/numerical outcomes. Partial evidence remains partial.

## Resource and mathematical contract

The exact sources use texture ID 1 and sampler ID 2 in Resources at buffer 0. Host buffers 1–4 are signed coordinates, signed offsets, uint LOD, and float4 output; arrays additionally use uint layer at buffer 5. int3 inputs have 16-byte ABI stride. Each backend obtains its own function.makeArgumentEncoder(bufferIndex:0), allocates that encoder's encodedLength, and encodes IDs 1 and 2 separately. Apple and FLOOR physical layouts need not match. The indirect texture is declared with useResource(.read) before dispatch.

Textures are deterministic RGBA32Float, base 8×4 or 8×4×4, three mip levels, and three array slices. Each component is exactly representable:

`1 + 10000*lod + 1000*layer + 100*z + 10*y + x + channel/4`

Samplers use clampToEdge on all axes and nearest filters. normalizedCoordinates is true to retain a valid ordinary mipmapped sampler configuration. The source operation is read with signed integer coordinates, not sample with floating-point normalized coordinates; its integer coordinate/offset arithmetic is unchanged.

Modes cover dynamic offsets, default offset/LOD, fixed extreme offsets, and adjacent legacy reads. Cases distinguish addition-before-clamping from prematurely clamping, test -8/+7, x/y/z ordering, multiple mip sizes and array slices, invalid LOD/slice zero behavior, and unclamped legacy reads. These bounded representative float sample-access cases do not certify other texel types/access modes, every texture shape, sparse/block reads, or complete MSL 4.1 support.

## Standalone all-24 post-processing

Place all files together under `wasm/release/gpu/texture` or another directory. Descriptors, fixtures, source pins, receipt helper, and verifier are resolved relative to module files, never the caller's working directory or an old cloud path.

Run after the existing full Apple/FLOOR compile checkpoint has finished and left `report.json`, `case-N.metal`, `case-N.apple.metallib`, and `case-N.floor.metallib` in its output directory:

```
python3 wasm/release/gpu/texture/run_texture_read_gpu_matrix.py \
  --compile-dir /evidence/reference \
  --harness /validated/bin/metal-texture-read-numerical \
  --output /evidence/texture-matrix-new
```

The output directory must not exist. The runner snapshots the compile report and records its SHA256, executable SHA256, frozen Swift source hash, and fixture/descriptor hashes. It resolves every one of the 24 exact descriptors by alias, source hash, and math profile. It requires the original successful compiler stages and validates actual source/library bytes before creating a per-case receipt. An unrelated failure in the generic gate does not suppress eligible texture cases. Do not invoke the post-processor through shell `&&` after that generic gate: schedule it as a separate step that still runs when the main gate exits unsuccessfully, and preserve both results.

For each eligible case, the runner invokes the frozen Swift executable and then calls the strict raw-evidence verifier for exit-zero reports. Missing, blocked, failed, unavailable, timed-out, and successful cases all remain in `matrix-report.json`. It snapshots progress after each case and continues after individual failures. A crash or process/report status disagreement is failure, never unavailability. A successful exit with no report remains missing evidence, never success. The matrix schema is separate from the generic GPU gate and is not written into the original compile report.

`--case-timeout` defaults to 240 seconds, supported range 1–300. `--matrix-timeout` defaults to 1,800 seconds, supported range 1–7,200. If the remaining matrix budget is shorter, it limits the next process. Unstarted cases after budget exhaustion are blocked. A timed-out subprocess group is killed, with termination uncertainty recorded if needed. Each stdout/stderr stream is drained while retaining at most 256 KiB, plus captured/total byte counts, truncation flags, and SHA256. Reports and partial outputs are preserved even on timeout.

Matrix exits:

- 0: all 24 cases passed the strict evidence verifier.
- 1: malformed setup evidence, case failure, crash, or timeout.
- 2: missing or blocked cases without a higher-priority failure.
- 77: some cases are unavailable and all remaining cases passed.

The matrix output contains `compile-report-input.json`, `matrix-report.json`, and `case-00` through `case-23` directories, each with available receipts, bounded logs, and its `gpu` evidence directory. Do not promote per-backend execution to paired success when the other original library is unavailable.

Do not pass this executable directly as the existing generic `--gpu-probe`: its per-backend report schema and CLI are deliberately separate. The standalone post-processor requires no changes to `apple-reference.mjs`, generic validators, or compiler implementation. It does not invoke compilers, rebuild libraries, retarget iOS artifacts, push commits, or trigger CI.

### Failure classification and timeout fence

The postprocessor rejects an unavailable result when an attempted backend pipeline, resource setup, execution or numerical stage failed. It blocks later dispatches after a process timeout, uncertain termination, or reported incomplete GPU execution, including the frozen Swift semaphore-timeout diagnostic. Ordinary completed failures do not hide later cases. This hardening changes Python orchestration only; the native-compiled Swift bytes are unchanged. The integration suite has 68 tests.
