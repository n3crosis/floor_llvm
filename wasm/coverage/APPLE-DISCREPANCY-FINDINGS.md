# Apple Metal discrepancy isolation: completed findings

## Evidence and scope

The separately authored diagnostic ran on Apple M1 Max, macOS 27.2 (26B123), Xcode 27.2 (27B52), SDKs 27.2, Apple metal 32023.922 (metalfe-32023.922.4), and Swift 6.4.2. Runtime queries report Apple7 support, no Apple8/Apple9 support, and unified memory.

The returned evidence ZIP is 240,112 bytes with SHA-256 `3c7149091e45a6e50a179a2983c7fce0cf8afe64c797b2a15046cdbdaa163a36`. Its original input bundle is identified by SHA-256 `72eeb1fb521a64971d5f206039cd4a7dc75d8152834f612c8767af0ed6a8cef7`.

The independent audit verified all 467 shared-file hashes, the exact original source/harness identities, semantic identity of reserialized JSON fixtures, all 404 raw output files, and 1,816 output words using an independent shift/mask CPU calculation. It also checked the commands, per-case statuses, exact intrinsic diagnostics, and textual AIR result-dependent volatile stores. All executed output words are identical between the iOS and macOS target variants. There are 56 mismatched result words across 40 failed dispatch records; every guard word is correct.

The host executable, six binary AIR files and six metallibs remain on the Mac and are omitted from the shared archive. Their recorded identities agree between inventory, commands and reports, but this return audit did not independently rehash or disassemble those 13 omitted binaries. Textual AIR is a separate compilation of the same authenticated source/options. The earlier original-checkpoint linked-metallib disassembly remains separate evidence.

No compiler source was changed, no extra native probe was run during this audit, and neither target was rewritten or substituted. These are Apple-only diagnostics, not Apple/FLOOR numerical parity.

## Native outcomes

All six source/target groups compiled, emitted textual AIR, linked and loaded. Both targets explicitly used Metal 4.1 and `-fno-fast-math`, with default compiler optimization:

- iOS: `air64-apple-ios27.0`, `iphoneos` SDK.
- Native macOS: `air64-apple-macosx27.0`, `macosx` SDK.

Each target had exactly the following outcomes:

- Copy control: one pipeline, two completed dispatches, two numerical passes.
- Integer: all 60 pipelines created; all 200 dispatches completed; 180 passed and 20 failed numerically.
- Interleave/deinterleave: all nine pipelines failed; no dispatch and no numerical comparison.

Across both targets: 404 completed dispatches, 364 passes, 40 numerical failures, and 18 additional pipeline failures. Runner exit status is **1, failed**. Optional `-O0` was not advertised by the installed tool's saved help output and was not attempted. This is not proof that the tool cannot support `-O0`.

## Integer endpoint: confirmed Apple-stack numerical discrepancy

The tested zero-width endpoint `(offset,count)=(32,0)` is defined for 32-bit operands under MSL 4.1 section 6.4/Table 6.2, printed page 203. Extraction should return zero; insertion should return the base. The specified undefined condition is a sum greater than the operand width, not equality. These shaders call builtins and do not explicitly shift a 32-bit source operand by 32. Source-level shift undefined behavior does not explain the result.

All failures occur at this endpoint with literal parameters, but **not every literal-parameter form fails**. On each target:

| Form | Extract | Insert |
| --- | --- | --- |
| Scalar uint, all literal | 2 failures | 2 failures |
| Scalar uint, dynamic x / literal parameters | 4 failures | 4 failures |
| Vector uint2, all literal | 2 failures | 2 failures |
| Vector uint2, dynamic x / literal parameters | 4 passes | 4 failures |
| Scalar/vector, all runtime-loaded operands and parameters | All pass | All pass |

The counts include both prefills and, for dynamic operands, two input values. Every tested `(0,0)`, `(31,0)`, `(31,1)` and `(0,32)` case passes. All 80 fully runtime-loaded integer dispatches per target pass, including the 16 endpoint dispatches.

Two distinct failure patterns are verified against raw bytes:

- Twelve scalar failures per target return `0x11223344`, the after-guard value, regardless of prefill or input. They do not retain the sentinel.
- Eight uint2 failures per target retain `0xdeadbeef` or `0xa5a5a5a5` in both result lanes according to the selected prefill. The before/after guard lanes remain correct.

All seven failing kernel forms retain the exact literal endpoint intrinsic call and result-dependent volatile store in the separately emitted textual AIR, on both targets. The passing dynamic-x uint2 extraction also retains its vector intrinsic and literal endpoint. Source-to-textual-AIR elimination of the result stores does not explain these observations, and a simple universal rule that all literal endpoint calls fail does not fit. This does not exclude a frontend mistake in mapping the source builtin to an AIR intrinsic whose endpoint contract is not independently established.

**Classification:** A reproducible Apple-stack numerical nonconformance relative to the reviewed MSL builtin contract, dependent on operand constancy and scalar/vector form. It is not explained by lack of general bit-operation hardware capability, source-level undefined behavior, or purely iOS-on-macOS targeting. A constant-specialized intrinsic/native-lowering defect is the leading explanation. These observations do not identify the exact optimizer pass, AIR-contract interpretation, driver component, or machine instruction, and prefill retention alone does not prove omission of a particular native store.

## Interleave: target-independent native pipeline blocker on this stack

For both target variants, scalar interleave, vector interleave and deinterleave at every legal width fail with domain `AGXMetalG13X`, code 3. The diagnostic names an unlowered `air.interleave.i16/i32/i64` or `air.deinterleave.i16/i32/i64` call. The corresponding simple control runs successfully.

**Classification:** An Apple intrinsic-lowering/availability blocker on the tested M1 Max software stack. Reproduction in separately compiled native macOS libraries rules out a purely iOS-targeted-library-on-Mac explanation for these probes. The error's suggestion to verify GPU support does not establish an intended hardware-family restriction. Missing runtime/backend lowering versus a deliberate architecture restriction remains unresolved; this run says nothing about newer Apple GPUs or other software versions.

The earlier FLOOR shift/mask implementation passed its independent CPU-oracle suite on this device, proving those outputs can be computed there. It does not prove that Apple's AIR intrinsics are available or that Apple/FLOOR parity was achieved.

## Repository-safe disposition

- Keep the original failed checkpoint matrix and the supplemental failed result unchanged and separately labeled.
- Retain FLOOR's specification-correct zero-count semantics. Do not imitate Apple's incorrect output, silently remove the endpoint cases, or weaken the strict numerical gate based on this evidence.
- Record interleave as an Apple pipeline blocker on the measured stack; do not describe it as a proven FLOOR numerical defect, a proven hardware limitation, or a passing parity test.
- Treat precise compiler-pass attribution and newer-device support as open questions. No further probes or source changes are necessary to preserve these current conclusions; any expansion should be coordinated separately.

## Sources

- Returned archive: `inputs/`, `output/commands.json`, `output/result.json`, per-target GPU reports, corresponding `.bin` outputs and textual `.ll` files.
- Independent replay: `apple-discrepancy-audit.json`; independent audit script retained with the evidence.
- [Apple Metal Shading Language specification](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf), reviewed Version 4.1, June 4, 2026, Table 6.2, pp. 202-203; PDF SHA-256 `41538b30d2f1140a5b2a0c84ce0a9f7b67bf0c707e224cfea0bfe5a44aa26cf5`.
- [Apple GPU feature-family tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf), October 23, 2026 revision. M1 is Apple7; this broad mapping alone does not establish individual intrinsic lowering availability.
