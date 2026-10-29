# CI builds and optional releases

Pushes to `wasm` build the compiler and upload runtime, corresponding-source,
build-input, manifest, and checksum artifacts. A manual run with `release_version`
left empty does the same. These builds use `dev-<commit>` names and never create,
change, or require a GitHub release. Merge commits are supported; the receipt
records the actual checked-out commit, tree, and source-lock hashes.

GitHub's manual-dispatch UI requires the workflow on the repository's default
branch. If the default remains the compiler-only branch, use the `wasm` push
trigger (or rerun an existing build); this change does not add WASM tooling to
the compiler-only branch or change the default branch.

To deliberately publish a new prerelease, manually run the workflow on the
desired source with an unused `release_version`, for example `v0.2.0`. Existing
tags or releases, including drafts, are rejected before building and again before
publication. Nothing rewrites an old tag or replaces an existing release asset.
If publication is interrupted after remote changes, inspect the draft/tag and
retained artifacts before deciding how to recover; rerunning does not overwrite
them. Ordinary builds never republish `v0.1.0`.

The workflow keeps Emscripten 4.0.20 pinned, checks source hashes, compiles the
compiler, and runs fresh ABI, header, and compile-smoke probes before packaging.
The local regression suite (`python3 -m unittest discover -s wasm/release -v`)
tests helper behavior with synthetic source/artifact fixtures, not the compiler.
