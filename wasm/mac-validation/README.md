# Mac Metal validation runner, v2

V2 adds a mandatory pin for the original GitHub compiler-artifact ZIP. The
capability-only mode is unchanged. Use this package for baseline artifact runs.

Two independent checks are available. Neither installs software, changes your
existing repository, switches global Xcode settings, signs in, uploads results,
or rewrites/retargets a compiled library. Every run creates a fresh directory.

## 1. Test Apple's Metal 4.1 support now

This does **not** need our compiler artifact, Node, Git, or network access. You
need macOS, Python 3.9+, and an installed Xcode 26+ with an iPhoneOS SDK and the
Metal command-line component already available.

From the extracted runner folder:

```sh
python3 run_mac_validation.py --capability-only
```

The runner selects the highest installed Xcode 26+ it finds. It records the SDK
and compiler versions, compiles one tiny authored compute shader using exactly
`-std=metal4.1 -target air64-apple-ios27.0`, and links it if compilation succeeds.
It preserves the source, flags and diagnostics. The iOS 27 target is deliberate:
MSL 4.1 is associated with that deployment generation.

- An explicit rejection of Metal 4.1 language mode is reported as unsupported.
- Other compiler errors are reported as rejected, not misclassified as unsupported.
- Accepted means **only this minimal source compiled and linked**. It establishes
  neither full MSL 4.1 feature conformance, FLOOR support, library loading nor GPU execution.
- An SDK older than 27 remains a recorded limitation even if the compiler accepts
  the language flag. There is no silent fallback to Metal 4.0 or an older target.

To select a particular already-installed Xcode without changing your Mac's
global selection, append:

```sh
--developer-dir "/Applications/Xcode_27.app/Contents/Developer"
```

Use the actual installed path. The example does not claim that Xcode 27 is
installed or available on your machine. Missing components are reported, never
downloaded or installed automatically.

## 2. Compare the pinned FLOOR baseline with Apple

This is the existing baseline, **not a FLOOR Metal 4.1 implementation**:

- Repository: `n3crosis/floor_llvm`
- Branch: `wasm-rebased-functional-20261110`
- Exact commit: `81d255965a578d9dd55ec4cd2b53a2f239a989f1`
- Exact tree: `84703aa5fcb717ed1677681e9a3f7ee5f3f74987`
- Build run: https://github.com/n3crosis/floor_llvm/actions/runs/42790141243
- Required artifact name:
  `air-wasm-dev-81d255965a57-81d255965a578d9dd55ec4cd2b53a2f239a989f1`
- Immutable artifact ID: `13752442598`
- Original ZIP size: `186234725` bytes
- Original ZIP SHA-256:
  `05b9ff737b04de5cbfa7ae1cfe235d1c14aafa1b5be2ef64250286b98adf30f4`

On that run page, download the **compiler artifact** named above. It is now
available. Preserve the original ZIP. Do not download the `apple-reference-*` evidence
artifact or substitute an earlier vector-only build. If its artifact later
expires or is removed, this baseline check cannot use a different build.
The capability-only check above is still useful immediately.

Baseline prerequisites: macOS, Python 3.9+, **Node 24.x**, Git 2.25+, Xcode 26+,
iPhoneOS SDK 26+, Metal command-line compiler, and Swift compiler. The runner
does not install or update prerequisites. Leave a few GB of free space for the
download, verified copies and a sparse checkout. It fetches the public pinned
Git commit over HTTPS, with no credential prompt. The exact runtime and authored
harness are executed only after integrity checks pass.

```sh
python3 run_mac_validation.py --artifact "$HOME/Downloads/air-wasm-dev-81d255965a57-81d255965a578d9dd55ec4cd2b53a2f239a989f1.zip"
```

An extracted artifact directory works only when you also supply the original,
unchanged ZIP. Its manifest must exactly match the manifest authenticated by that
ZIP digest, and every declared asset must match the authenticated manifest:

```sh
python3 run_mac_validation.py --artifact "$HOME/Downloads/extracted-compiler-artifact" \
  --original-zip "$HOME/Downloads/air-wasm-dev-81d255965a57-81d255965a578d9dd55ec4cd2b53a2f239a989f1.zip"
```

Optional: if GitHub CLI is **already installed and authorized**, you can download
the exact artifact yourself instead of using the browser. Choose a fresh path:

```sh
(set -C; gh api repos/n3crosis/floor_llvm/actions/artifacts/13752442598/zip \
  > "$HOME/Downloads/floor-artifact-13752442598.zip")
```

The subshell refuses to overwrite an existing file. `gh run download` normally
extracts the artifact, so it is not enough by itself for v2; preserve or download
the original ZIP. A newly re-zipped folder will have a different digest and is
rejected. You may rename the unchanged original ZIP.

No CLI installation, sign-in or credentials are needed by this runner. Before
artifact parsing or execution, v2 checks the exact original ZIP size and SHA-256
against the immutable GitHub artifact pin above. The authenticated manifest then
binds runtime/archive/member hashes to the pinned source identity and headers.
A self-consistent replacement manifest alone is not accepted. This checks byte
identity to the retrieved GitHub artifact digest, not an independent reproducible
build or an Apple endorsement.

The baseline command also records the separate minimal Apple 4.1 capability
probe. Rejection of that optional probe does not relabel the baseline results.

## What to send back

The command prints the new output directory and these files:

- `share/summary.txt`: short, human-readable result and counts.
- `share/result.json`: environment versions, provenance, overall result, stages,
  and separate Metal 4.1 probe result.
- `share/validation-matrix.json`: all 34 baseline cases, expected source hashes,
  targets, dialects, math profiles and each observed validation layer.
- `share/commands.log`: bounded, redacted command output and return codes.
- `evidence.zip`: the shareable reports, source fixtures, numerical records,
  available float output data, and an evidence inventory.

**Review and send back `summary.txt` and `evidence.zip`, even on failure.** The
runner never uploads anything. Tell us which mode you ran and whether the Mac is
Apple Silicon or Intel if that information is useful; the architecture and
generic GPU model are normally already recorded.

Known output/home/Xcode paths and common token forms are redacted from selected
text reports. Redaction is best effort. No environment dump, username, hostname,
serial, credentials or `.git` folder is intentionally shared. AIR/metallib
binaries can embed private paths, so their hashes and omission reasons appear
in the inventory, but the binaries themselves stay unchanged under `work/`.
Float output `.f32le` files contain generated test values and are included.
Do not send the whole `work/` directory without reviewing it.

Original and sanitized report hashes differ. The inventory records both;
nested hashes in raw-derived reports refer to the originals. A 128 MiB evidence
budget can omit a large file with an explicit reason, while retaining it locally.

You can add `--output "/path/to/a-new-directory"`; an existing path is refused,
even if empty. Re-running needs another fresh directory. Ctrl-C stops the runner's
subprocess group and retains completed evidence. No cleanup deletes your files.

## Validation matrix and limits

| Layer | Baseline scope | Meaning of success |
|---|---|---|
| Pinned source/artifact | Immutable original GitHub ZIP digest/size, commit, tree, all locked compiler/wrapper inputs, headers, harness hashes, archive/member digests, build receipt | Download matches the pinned GitHub artifact; declared build inputs agree; not an independent reproducible rebuild |
| Apple compiler | 34 authored positive source/target/math combinations | Apple accepts those sources with recorded flags |
| Apple linker | Same 34 combinations | Apple creates a metallib; no loading or GPU claim |
| FLOOR compilation | Same 34 sources, embedded header identity checked | FLOOR produces a metallib; no loading or GPU claim |
| Original library loading | Up to 12 eligible Apple/FLOOR pairs | Both original iOS-targeted libraries load on this Mac's device |
| Pipelines | Same 12 eligible pairs | Required compute/render pipelines are created |
| GPU execution | Same 12 eligible pairs | Command buffers complete |
| Numerical comparisons | 8 integer-vector + 4 position-derivative pairs | Bounded outputs match both libraries and independent CPU/analytic expectations |
| Separate Apple MSL 4.1 probe | One minimal compute source, explicit iOS 27 target | Minimal compile and link acceptance only; no GPU or FLOOR claim |

**Platforms and dialects:** Apple uses iOS 18 / Metal 3.2 and iOS 26 / Metal 4.0,
with conservative and fast-math profiles. FLOOR fixes its **source dialect to
Metal 3.2 for both iOS targets**. Changing the deployment target does not add
Metal 4.0 or 4.1 language support. Existing test libraries are never retargeted to
macOS. The separate 4.1 probe creates only its own new tiny source and outputs.

**GPU feature scope:** Integer cases cover `int2/3/4` and `uint2/3/4` forms of
`clz`, `ctz`, `popcount`, `reverse_bits`, `extract_bits`, and `insert_bits`, with
fixed/random bit patterns and legal range endpoints. Three-lane vectors use
16-byte stride. Derivative cases cover `dfdx`, `dfdy`, and `fwidth` for
`float/float2/3/4`, using only position-based interior pixels.

**Compile-only Mac scope:** Same-width float common functions `mix`, `step`,
`smoothstep`, and `sign` are included in compile/link comparisons but have no GPU
numerical cases. Half/integer common operands, mixed or scalar/vector common
overloads, and half/integer derivative operands are unsupported by this subset.

**Not tested:** full MSL conformance; negative/mixed-slope derivatives; `fwidth`
absolute-value behavior for negative slopes; divergent control flow; edge pixels;
common-function GPU numerics; iPhone/iPad execution; full applications. This
runner does not rerun the entire 285-case CI compiler suite or independently
establish all 103 CI metallib successes. It checks the 285-case passing receipt
and runs only the 34 comparison cases locally.

## Read the outcome carefully

- `0`: baseline passed **only the documented bounded scope**, or capability-only
  minimal Apple 4.1 compile/link was accepted. Check the named mode and result.
- `77`: baseline compile/link passed but one or more GPU pairs were unavailable,
  **or** capability-only explicitly rejected Metal 4.1 language support. Not a pass.
- `1`: compilation, Swift build, integrity, GPU/numerical or evidence failure, or
  an unclassified capability compiler rejection. Diagnostics and partial results
  are retained. A Swift build failure still permits compile-only comparisons.
- `2`: prerequisites or input artifact unavailable. Baseline stages remain unrun.
- `130`: interrupted; completed evidence is retained.

No Metal GPU, or an Apple reference iOS library rejected by the Mac, means GPU
comparison unavailable. The report preserves **both** library loader outcomes.
If Apple loads but FLOOR rejects, the result is a **failure**, not unavailable.
Unsupported language flags, pipeline failures and numerical mismatches are never
silently counted as passes. The underlying baseline harness stops at its first
actual failure, so remaining cases correctly stay `not_run`.

## Verification of this runner

This package was syntax-checked and exercised with offline synthetic tests on
Linux, including a real local sparse checkout. It has **not** been run on a Mac;
Swift, external Apple compiler and GPU execution remain untested here. See
`VALIDATION.txt`. To rerun the package's synthetic tests:

```sh
python3 -m unittest -v test_runner.py
```
