# FLOOR API3 / Metal 4.1 checkpoint Mac validation

**Checkpoint-specific Mac test runner.** The original GitHub compiler artifact ZIP is immutably pinned by artifact ID, byte count and SHA-256. Never substitute baseline artifacts, a repacked ZIP or another compiler build. The release verification record is in VALIDATION.txt.

This new runner does not modify or supersede the independently pinned baseline-v2 package.

## Exact checkpoint

- Repository: n3crosis/floor_llvm
- Commit: 1accfd44d88898b2885390cafd527e48b4f00479
- Tree: e0a6df98d895c4b268d475a9bf0a82adfe51bfff
- Header bundle SHA-256: c37e3f178be981e4176c9145ef651ac8c29b527d9b179ef642e135ec871193e4
- Workflow run: https://github.com/n3crosis/floor_llvm/actions/runs/42801805934
- Artifact ID: 13758518162
- Artifact name: air-wasm-dev-1accfd44d888-1accfd44d88898b2885390cafd527e48b4f00479
- Original ZIP bytes: 186307629
- Original ZIP SHA-256: d12ee8cff0597baae8f684048ead6efe0a458619e40aa90933ce95140189e063
- API3, with API1 and API2 retained; header bundle version 2.
- Explicit API3 tuples: iOS18/MSL3.2, iOS26/MSL4.0, iOS27/MSL4.1.
- Legacy API1/API2 use FLOOR MSL3.2. Historical unlabeled API2/iOS26 comparisons use Apple MSL4.0, so they are explicitly labeled as language-mismatched comparisons.

The source and harness are checkpoint-pinned, including all transitive JavaScript imports and the corrected derivative fixtures. Later documentation commits do not change the compiler checkpoint. This runner uses a fresh sparse checkout of the exact commit, never the user's working repository.

## Capability-only, independent of the artifact

Run with Python 3.9 or newer on the Mac:

    python3 run_mac_validation.py --capability-only --output "$HOME/Desktop/floor-apple41-capability"

Choose a NEW output folder. This mode needs an installed Xcode 26+ and iPhoneOS SDK 26+, with Metal command-line tools already available. It does not require Node, Git, a downloaded compiler, credentials or network. An explicit iOS27/MSL4.1 compile request and a __METAL_VERSION__ == 410 assertion check actual tool acceptance. It then links the original AIR. An older SDK may reject the request. A below-27 SDK remains a recorded limitation even if this minimal source compiles.

This is only a minimal Apple compile/link capability check. It never proves feature conformance, FLOOR compilation, library loading, pipeline creation, GPU execution or numerical agreement. Capability-only results retain the entire FLOOR matrix as not_run.

If a particular installed Xcode should be selected, add:

    --developer-dir /Applications/Xcode.app/Contents/Developer

The selection is scoped to child processes; xcode-select and system settings are never changed. No installs, license acceptance or component downloads are attempted.

## Artifact validation

Download the compiler artifact for the exact run above using your normal browser. Downloading privately requires your own browser access; the runner does not request, read or pass credentials. Do not select an Apple-evidence artifact, an old baseline artifact, a rebuilt ZIP or a newer compiler.

    python3 run_mac_validation.py --artifact "$HOME/Downloads/EXACT_ORIGINAL_ARTIFACT.zip" --output "$HOME/Desktop/floor-api3-validation"

For an already extracted artifact, also supply the original unchanged ZIP:

    python3 run_mac_validation.py --artifact "$HOME/Downloads/extracted-artifact" --original-zip "$HOME/Downloads/EXACT_ORIGINAL_ARTIFACT.zip" --output "$HOME/Desktop/floor-api3-validation"

Artifact mode requires installed Python 3.9+, Node 24.x, Git, Xcode 26+, iPhoneOS SDK 26+, Metal tools and Swift. Public GitHub access is needed to retrieve the exact checkpoint. A missing dependency produces a blocker, not an installation request or a hidden fallback. No account setup, credential requirements, changes to an existing checkout or automatic uploads occur.

The ZIP's original digest and size are checked **before parsing/extraction**. Folder input is bound to the original ZIP manifest. Asset sizes and hashes, Git commit/tree, source lock, source inventory/fingerprint, runtime members, build receipt, headers, API capabilities and executable harness hashes must agree. The source archive is inspected without rebuilding LLVM or extracting the full source tree. Symlinks, path traversal, unexpected/duplicate members, oversized data and forged manifests are rejected.

## Actual bounded test scope

The full 82-case plan is in validation-plan.json and embedded in the standalone runner. Sources and identities are deduplicated by the checkpoint harness, not guessed from case counts.

- 8 integer pairs: dynamic/constants, iOS18/iOS26, conservative/fast math.
- 4 position-based derivative pairs: original float/float2/float3/float4 entry points and padded float4 numerical fixtures for the 3-channel render case. Defined alpha is checked; no source repair or target rewriting occurs at runtime.
- 36 MSL4.1 interleave pairs: unsigned 8/16/32-bit × scalar interleave/vector interleave/deinterleave × dynamic/constants × conservative/fast math. Every pair retains API3, iOS27 and MSL4.1 identity.
- 34 other compile/link-only pairs, including common functions, explicit/legacy language probes and the checkpoint's native-accepted constant-namespace source fixture.

Only those 48 eligible pairs can produce GPU numerical evidence. Common functions and language-only probes have no GPU numerical coverage. The 497-case CI receipt (258 positive cases: 113 AIR + 145 metallib; 239 expected rejections) is authenticated and checked, not rerun as a 497-case Mac compiler corpus. A configured expected corpus is not a passing build result until the actual receipt verifies.

Each source pair reports Apple compilation, Apple linking, FLOOR compilation, original Apple/FLOOR library loading, pipeline creation, GPU execution and numerical comparison separately. Every independent compiler and later case continues after a failure. Apple4.1 unavailability does not suppress FLOOR4.1 compilation. The gate preserves failure diagnostics and partial reports. Original library SHA-256 identities are bound to GPU results. iOS libraries are never retargeted to macOS to obtain a pass. The Mac's actual MTLDevice may reject an unchanged iOS library; that is unavailable, not passed. FLOOR rejection after Apple library loading succeeds is a failure.

Scope excludes full Metal4.1 conformance, full applications, browser execution, iPhone/iPad execution, common-function GPU numerics, negative/mixed-slope derivatives, edge pixels and divergent control flow. Merely accepting source or writing a metallib is not GPU proof.

## Results and exit status

- 0: all required bounded layers passed, or capability-only minimal Apple compile/link accepted. Read the mode; these are different claims.
- 77: tool/library availability prevents the requested proof. Never a pass.
- 1: failed, incomplete or contradictory evidence.
- 2: blocked prerequisite, pending artifact identity or invalid invocation.
- 130: interrupted; completed evidence is retained where possible.

The new output folder contains raw local work under work/, sanitized selected evidence under share/, and evidence.zip. Read share/summary.txt and share/result.json first. The matrix records actual compiler dialects, APIs and target identities, per-layer statuses, case errors and counts. A partial failure remains visible even if later cases passed.

Review share/summary.txt and evidence.zip, then return them through the conversation. Nothing is uploaded automatically. The share archive omits compiler binaries, full source, Git metadata, environment dumps and host AIR/metallib bytes (which may embed paths). Original binaries remain unchanged locally and their hashes are recorded. Sanitized JSON/text files have separate original and shared hashes; nested report hashes refer to original local bytes. Float numerical outputs are included. Known home/output/SDK paths and common token forms are redacted; redaction is best effort, so review before sharing. Platform/tool versions and generic GPU model may remain.

## Offline validation

    python3 -m unittest -v test_runner

These are synthetic security, identity, evidence and orchestration tests, not Metal execution. Linux cannot establish Mac or GPU success. See VALIDATION.txt for what was actually run and what remains pending.

The package pins cannot be overridden through command-line options or an input manifest. A different compiler artifact needs a separately verified runner. The original baseline-v2 package remains independent and unchanged.
