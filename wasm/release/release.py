#!/usr/bin/env python3
"""Bounded standalone AIR compiler build, receipt, packaging and publication."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

from github_release import GitHub, NoRedirect, ReleaseError, check_file, descriptor, publish_release, require, sha256, stream_download

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "n3crosis/floor_llvm"
SDK_COMMIT = "e4fe26ef59168ff44f4c23c466e497bf60b3411e"
OUTPUTS = ("air_wasm.mjs", "air_wasm.wasm")
TOOLING = (".github/workflows/release-air-wasm.yml", "wasm/release/github_release.py",
           "wasm/release/probe.mjs", "wasm/release/release-config.json", "wasm/release/release.py")
NOTICE_PATHS = ("llvm/LICENSE.TXT", "clang/LICENSE.TXT", "llvm/include/llvm/Support/LICENSE.TXT",
                "llvm/include/llvm/Transforms/LibFloor/cfg/LICENSE", "llvm/lib/Transforms/LibFloor/cfg/LICENSE",
                "llvm/lib/Bitcode/MetalLib/bzip2/LICENSE", "llvm/lib/Bitcode/MetalLib/tar/LICENSE")
GPL_SOURCE = "https://gcc.gnu.org/git/?p=gcc.git;a=blob_plain;f=COPYING;hb=62c888a8f13ddc7184a741dc849fd62e5a2b5962"
GPL_PIN = {"bytes": 18002, "sha256": "231f7edcc7352d7734a96eef0b8030f77982678c516876fcb81e25b32d68564c"}
SDK_SOURCE_ROOTS = ("src", "system/lib", "system/include")
SDK_NOTICES = ("LICENSE", "AUTHORS", "system/lib/compiler-rt/LICENSE.TXT", "system/lib/libc/musl/COPYRIGHT",
               "system/lib/libcxx/LICENSE.TXT", "system/lib/libcxxabi/LICENSE.TXT", "system/lib/libunwind/LICENSE.TXT")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def write_json(path, value):
    Path(path).write_bytes(encoded(value))


def command(*args):
    return subprocess.check_output(list(args), cwd=ROOT, stderr=subprocess.STDOUT).decode().strip()


def git(*args):
    return command("git", *args)


def source_fingerprint(repository, commit, tree, lock_sha, inputs):
    text = "floor-air-wasm-source-v1\n" + repository + "\n" + commit + "\n" + tree + "\n" + lock_sha + "\n"
    text += "".join(path + "\0" + inputs[path] + "\n" for path in sorted(inputs))
    return digest(text.encode())


def source_identity(config):
    require(config["schemaVersion"] == 1 and config["repository"] == REPOSITORY and config["version"] == "v0.1.0", "Unexpected release identity")
    require(config["emsdkCommit"] == SDK_COMMIT and config["emscriptenVersion"] == "4.0.20", "Unapproved SDK pin")
    require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY, "Build is limited to the approved repository")
    commit = git("rev-parse", "HEAD")
    require(commit == os.environ.get("GITHUB_SHA") and re.fullmatch(r"[a-f0-9]{40}", commit), "Checkout differs from workflow commit")
    require(not git("status", "--porcelain", "--untracked-files=all"), "Source tree must be completely clean")
    tree = git("rev-parse", "HEAD^{tree}")
    lock_path = ROOT / "wasm/source-lock.json"
    lock = json.loads(lock_path.read_text())
    inputs = dict(lock["compilerFiles"])
    for path, value in lock["sdkFiles"].items():
        full = "wasm/" + path
        require(full not in inputs, "Duplicate source input")
        inputs[full] = value
    require(len(lock["compilerFiles"]) == 31 and len(lock["sdkFiles"]) == 19 and len(inputs) == 50, "Unexpected source-input closure")
    for path, value in inputs.items():
        require(re.fullmatch(r"[A-Za-z0-9_.+/-]+", path) and ".." not in path.split("/"), "Unsafe source input")
        require(re.fullmatch(r"[a-f0-9]{64}", value) and sha256(ROOT / path) == value, "Source input digest mismatch: " + path)
    lock_sha = sha256(lock_path)
    return {"repository": REPOSITORY, "commit": commit, "tree": tree, "version": config["version"], "sourceTreeClean": True,
            "sourceLockSha256": lock_sha, "sourceInputs": inputs,
            "sourceFingerprintSha256": source_fingerprint(REPOSITORY, commit, tree, lock_sha, inputs)}


def verify_anchor(config):
    base, tree = config["sourceBase"], config["sourceTree"]
    require(base == "4b173e3db383ec7164afb11ee7dc86609c88f052" and re.fullmatch(r"[a-f0-9]{40}", tree), "Full reviewed source identity required")
    # Raw commit headers retain parent identity even in a shallow checkout.
    headers = git("cat-file", "-p", "HEAD").split("\n\n", 1)[0].splitlines()
    require([line[7:] for line in headers if line.startswith("parent ")] == [base], "Release must remain one clean commit above the upstream base")
    tracked = git("ls-files", "--stage", "--", *TOOLING).splitlines()
    require(len(tracked) == len(TOOLING) and all(line.startswith("100644 ") and " 0\t" in line for line in tracked), "Release tooling must be five ordinary tracked files")
    # Compare the whole source tree, not only the fifty fingerprinted inputs.
    # The temporary index avoids altering the checkout or needing an orphaned
    # pre-amend commit to remain fetchable from the hosting service.
    with tempfile.TemporaryDirectory(prefix="air-source-index-") as temporary:
        environment = os.environ | {"GIT_INDEX_FILE": str(Path(temporary) / "index")}
        subprocess.run(["git", "read-tree", "HEAD"], cwd=ROOT, env=environment, check=True)
        subprocess.run(["git", "update-index", "--force-remove", "--", *TOOLING], cwd=ROOT, env=environment, check=True)
        actual = subprocess.check_output(["git", "write-tree"], cwd=ROOT, env=environment).decode().strip()
    require(actual == tree, "Source excluding the five release files differs from the reviewed clean tree")


def header_identity():
    include = ROOT / "wasm/api/include"
    files = sorted(p for p in include.rglob("*") if p.is_file())
    require(len(files) == 10 and all(not p.is_symlink() for p in files), "Unexpected header bundle")
    return digest(("floor-air-header-bundle-v2\n" + "".join(p.relative_to(include).as_posix() + ":" + sha256(p) + "\n" for p in files)).encode())


def output(name, value):
    require(re.fullmatch(r"[a-z_]+", name) and "\n" not in str(value), "Invalid workflow output")
    with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
        stream.write(name + "=" + str(value) + "\n")


def preflight(config, work):
    verify_anchor(config)
    identity = source_identity(config)
    require(header_identity() == config["headerSha256"], "Header identity changed")
    subprocess.run(["node", "wasm/build.mjs", "check"], cwd=ROOT, check=True)
    memory = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    require(memory >= 6 * 1024**3 and shutil.disk_usage(work).free >= 12 * 1024**3, "Cold build requires at least 6 GiB RAM and 12 GiB free disk")
    jobs = max(1, min(4, os.cpu_count() or 1, memory // (2 * 1024**3)))
    api = GitHub(REPOSITORY)
    tag = api.tag_commit(config["version"])
    require(tag in (None, identity["commit"]), "Existing release tag targets another source commit")
    existing = api.release_by_tag(config["version"])
    require(existing is None, "A release already exists; reconcile its verified assets instead of launching a new compiler build")
    # Artifact-only license text. Resolve this small external dependency before
    # the expensive compiler build, never by restoring a license folder in Git.
    gpl = work / "GPL-2.0.txt"
    if not gpl.exists():
        request = urllib.request.Request(GPL_SOURCE, headers={"User-Agent": "air-wasm-release/1"})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            stream_download(response, gpl, GPL_PIN)
    check_file(gpl, GPL_PIN)
    for path in NOTICE_PATHS:
        require((ROOT / path).is_file() and not (ROOT / path).is_symlink(), "Missing upstream notice: " + path)
    identity["jobs"] = jobs
    identity["sourceDateEpoch"] = int(git("show", "-s", "--format=%ct", "HEAD"))
    write_json(work / "context.json", identity)
    output("source_fingerprint", identity["sourceFingerprintSha256"])
    output("compiler_jobs", jobs)
    print(f"Cold build budget: 150 minutes, {jobs} compile jobs, one link job; no cross-repository caches")


def run_bounded(argv, deadline, environment):
    remaining = deadline - time.monotonic()
    require(remaining > 0, "Compiler build deadline exceeded")
    child = subprocess.Popen(argv, cwd=ROOT, env=environment, start_new_session=True)
    try:
        result = child.wait(timeout=remaining)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        raise ReleaseError("Compiler build deadline exceeded; the process group was terminated") from None
    require(result == 0, "Build/probe failed: " + argv[0])


def sdk_sources(sdk, work, *, snapshot=False):
    root = sdk / "upstream/emscripten"
    paths = [root / "LICENSE", root / "AUTHORS"]
    for name in SDK_SOURCE_ROOTS:
        directory = root / name
        require(directory.is_dir() and not directory.is_symlink(), "Missing SDK runtime source directory: " + name)
        paths.extend(path for path in directory.rglob("*") if not path.is_dir() or path.is_symlink())
    require(0 < len(paths) <= 10000, "Unexpected SDK runtime source count")
    files, total = {}, 0
    for path in sorted(paths):
        require(path.is_file() and not path.is_symlink(), "SDK runtime source must be a regular file: " + str(path))
        relative = path.relative_to(root).as_posix()
        size = path.stat().st_size
        total += size
        require(size <= 8 * 1024**2 and total <= 128 * 1024**2, "SDK runtime source snapshot exceeds bounded size")
        files[relative] = {"bytes": size, "sha256": sha256(path)}
        if snapshot:
            target = work / "sdk-runtime" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            check_file(target, files[relative])
    require(all(path in files for path in SDK_NOTICES), "SDK runtime notice closure is incomplete")
    result = {"schemaVersion": 1, "emsdkCommit": SDK_COMMIT, "emscriptenVersion": "4.0.20",
              "sourceRoot": "upstream/emscripten", "files": files}
    require(len(encoded(result)) <= 2 * 1024**2, "SDK runtime source inventory exceeds bounded size")
    if snapshot:
        write_json(work / "sdk-runtime-inventory.json", result)
        print(f"Pinned SDK runtime source snapshot: {len(files)} files, {total} uncompressed bytes")
    return result


def build(config, work):
    context = json.loads((work / "context.json").read_text())
    identity = source_identity(config)
    require(all(context[k] == v for k, v in identity.items()), "Source changed after preflight")
    sdk = Path(os.environ["EMSDK"])
    require(subprocess.check_output(["git", "-C", str(sdk), "rev-parse", "HEAD"]).decode().strip() == SDK_COMMIT, "SDK checkout pin mismatch")
    versions = {"node": command("node", "--version"), "emcc": command("emcc", "--version"),
                "cmake": command("cmake", "--version"), "ninja": command("ninja", "--version"),
                "nativeCompiler": command("c++", "--version"), "python": command("python3", "--version"),
                "ccache": command("ccache", "--version")}
    require(re.match(r"v24\.", versions["node"]) and re.match(r"emcc .* 4\.0\.20(?:\s|$)", versions["emcc"]), "Build tool version mismatch")
    build_tool = {"emscriptenVersion": "4.0.20", "emsdkCommit": SDK_COMMIT, "nodeMajor": 24,
                  "platform": "Linux", "versions": versions, "jobs": context["jobs"], "byteIdenticalRebuildClaimed": False,
                  "runner": {"imageOS": os.environ.get("ImageOS", ""), "imageVersion": os.environ.get("ImageVersion", ""),
                             "os": os.environ.get("RUNNER_OS", ""), "arch": os.environ.get("RUNNER_ARCH", "")}}
    require(all(build_tool["runner"].values()), "Runner image identity is missing")
    sdk_snapshot = sdk_sources(sdk, work, snapshot=True)
    # Check the real compressed source-artifact budget before spending time on
    # compilation, including the external runtime-source and notice closure.
    prepared_source = work / "corresponding-source.tar.gz"
    source_archive(prepared_source, identity, notice_members(identity, work), work)
    source_pin = descriptor(prepared_source)
    require(0 < source_pin["bytes"] <= 256 * 1024**2, "Source archive exceeds the consumer limit before compilation")
    write_json(work / "source-archive-pin.json", source_pin)
    print(f"Prepared full fork/SDK-runtime source artifact: {source_pin['bytes']} compressed bytes")
    environment = os.environ | {"SOURCE_DATE_EPOCH": str(context["sourceDateEpoch"])}
    build_root = work / "compiler"
    commands = [["node", "wasm/build.mjs", step, "--work", str(build_root), "--jobs", str(context["jobs"])] for step in ("build-host-tools", "build-wasm")]
    deadline = time.monotonic() + 150 * 60
    for args in commands:
        run_bounded(args, deadline, environment)
    dist = build_root / "api-build-wasm"
    report_path = work / "probe.json"
    probe = ["node", "wasm/release/probe.mjs", "--build", str(dist), "--header", config["headerSha256"], "--output", str(report_path)]
    run_bounded(probe, deadline, environment)
    verification = json.loads(report_path.read_text())
    require(verification["exportsVerified"] is True and verification["headerVerified"] is True and verification["smoke"]["passed"] is True, "Compiler probe did not pass")
    require(verification["abiVersion"] == 2 and verification["headerBundleVersion"] == 2 and verification["headerSha256"] == config["headerSha256"], "Compiler ABI/header mismatch")
    require(all(verification[key] is False for key in ("browserExecutionVerified", "deviceExecutionVerified", "gpuExecutionVerified", "fullApplicationVerified")), "Overstated validation scope")
    require(source_identity(config) == identity, "Source changed during compiler build")
    require(sdk_sources(sdk, work) == sdk_snapshot, "SDK runtime sources changed during compiler build")
    files = {name: {k: v for k, v in descriptor(dist / name).items() if k != "name"} for name in OUTPUTS}
    require(0 < files["air_wasm.mjs"]["bytes"] <= 1024**2 and 0 < files["air_wasm.wasm"]["bytes"] <= 128 * 1024**2, "Compiler outputs exceed release limits")
    receipt = {"schemaVersion": 1, "kind": "floor-air-wasm-build", **identity, "apiVersion": 2, "headerBundleVersion": 2,
               "sourceLanguage": "floor-metal-3.2", "headerSha256": config["headerSha256"], "buildTool": build_tool,
               "files": files, "verification": verification}
    write_json(work / "build-report.json", receipt)
    tooling = {path: sha256(ROOT / path) for path in TOOLING}
    # Replace runner-local paths in disclosed commands with a documented variable.
    commands = [[arg.replace(str(work), "$AIR_RELEASE_WORK") for arg in args] for args in commands + [probe]]
    inputs = {"schemaVersion": 1, **identity, "buildTool": build_tool, "commands": commands, "tooling": tooling,
              "sourceDateEpoch": context["sourceDateEpoch"], "sourceArchivePrefix": "air-wasm-v0.1.0-source/",
              "sdkSource": {"repository": "https://github.com/emscripten-core/emsdk", "commit": SDK_COMMIT,
                            "manifestSha256": sha256(sdk / "emsdk_manifest.json"),
                            "runtimeSources": {"archivePrefix": "air-wasm-v0.1.0-sdk-runtime/",
                                "fileCount": len(sdk_snapshot["files"]),
                                "bytes": sum(item["bytes"] for item in sdk_snapshot["files"].values()),
                                "inventorySha256": sha256(work / "sdk-runtime-inventory.json")}}}
    write_json(work / "build-inputs.json", inputs)


def deterministic_tar(path, members):
    with Path(path).open("xb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(mode="w|", fileobj=compressed, format=tarfile.USTAR_FORMAT) as archive:
                for name, data in sorted(members.items()):
                    item = tarfile.TarInfo(name)
                    item.size = len(data)
                    item.mode = 0o644
                    item.mtime = item.uid = item.gid = 0
                    archive.addfile(item, io.BytesIO(data))


def notice_members(identity, work):
    members, origins = {}, {}
    for path in NOTICE_PATHS:
        source = ROOT / path
        require(source.is_file() and not source.is_symlink(), "Invalid upstream notice: " + path)
        data = source.read_bytes()
        name = "licenses/" + path
        members[name] = data
        origins[name] = {"repositoryPath": path, "bytes": len(data), "sha256": digest(data)}
    check_file(work / "GPL-2.0.txt", GPL_PIN)
    members["licenses/GPL-2.0.txt"] = (work / "GPL-2.0.txt").read_bytes()
    origins["licenses/GPL-2.0.txt"] = {"sourceUrl": GPL_SOURCE, **GPL_PIN}
    sdk_inventory = json.loads((work / "sdk-runtime-inventory.json").read_text())
    require(sdk_inventory["emsdkCommit"] == SDK_COMMIT and sdk_inventory["emscriptenVersion"] == "4.0.20", "SDK snapshot identity mismatch")
    for path in SDK_NOTICES:
        source = work / "sdk-runtime" / path
        check_file(source, sdk_inventory["files"][path])
        name = "licenses/emscripten/" + path
        members[name] = source.read_bytes()
        origins[name] = {"sdkPath": path, "emsdkCommit": SDK_COMMIT, "emscriptenVersion": "4.0.20",
                         **sdk_inventory["files"][path]}
    members["licenses/ORIGINS.json"] = encoded({"schemaVersion": 1,
        **{key: identity[key] for key in ("repository", "commit", "tree")}, "files": origins})
    return members


def source_archive(destination, identity, notices, work):
    # Git files are unchanged under source/; the sibling directory is explicitly
    # artifact-only distribution material, not represented as part of the tree.
    prefix = "air-wasm-v0.1.0-source/"
    child = subprocess.Popen(["git", "archive", "--format=tar", "--prefix=" + prefix, identity["commit"]],
                             cwd=ROOT, stdout=subprocess.PIPE)
    try:
        with Path(destination).open("xb") as target, gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(mode="r|", fileobj=child.stdout) as source:
                with tarfile.open(mode="w|", fileobj=compressed, format=tarfile.PAX_FORMAT,
                                  pax_headers={"comment": identity["commit"]}) as archive:
                    for item in source:
                        require(item.name == prefix.rstrip("/") or item.name.startswith(prefix), "Unexpected Git archive path")
                        archive.addfile(item, source.extractfile(item) if item.isfile() else None)
                    for name in ("GPL-2.0.txt", "ORIGINS.json"):
                        data = notices["licenses/" + name]
                        item = tarfile.TarInfo("air-wasm-v0.1.0-notices/" + name)
                        item.size, item.mode, item.mtime = len(data), 0o644, 0
                        archive.addfile(item, io.BytesIO(data))
                    inventory = json.loads((work / "sdk-runtime-inventory.json").read_text())
                    for name, record in sorted(inventory["files"].items()):
                        require(not name.startswith("/") and ".." not in name.split("/"), "Unsafe SDK runtime source path")
                        path = work / "sdk-runtime" / name
                        check_file(path, record)
                        item = tarfile.TarInfo("air-wasm-v0.1.0-sdk-runtime/" + name)
                        item.size, item.mode, item.mtime = record["bytes"], 0o644, 0
                        with path.open("rb") as data:
                            archive.addfile(item, data)
                    data = encoded(inventory)
                    item = tarfile.TarInfo("air-wasm-v0.1.0-sdk-runtime/FILES.json")
                    item.size, item.mode, item.mtime = len(data), 0o644, 0
                    archive.addfile(item, io.BytesIO(data))
            child.stdout.read()  # Drain Git's trailing tar padding before wait.
        require(child.wait() == 0, "Exact source Git archive failed")
    finally:
        child.stdout.close()
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=10)


def package(config, work):
    identity = source_identity(config)
    receipt_path = work / "build-report.json"
    receipt = json.loads(receipt_path.read_text())
    require(all(receipt[k] == value for k, value in identity.items()), "Build receipt source identity differs")
    dist = work / "compiler/api-build-wasm"
    members = {name: (dist / name).read_bytes() for name in OUTPUTS}
    for name in OUTPUTS:
        check_file(dist / name, receipt["files"][name])
    members["build-report.json"] = receipt_path.read_bytes()
    members["source-lock.json"] = (ROOT / "wasm/source-lock.json").read_bytes()
    members["air_compiler.h"] = (ROOT / "wasm/api/air_compiler.h").read_bytes()
    base = ROOT / "wasm/api/include"
    for path in sorted(base.rglob("*")):
        if path.is_file():
            require(not path.is_symlink(), "Runtime inputs cannot be symbolic links")
            members["include/" + path.relative_to(base).as_posix()] = path.read_bytes()
    notices = notice_members(identity, work)
    members.update(notices)
    members["README.txt"] = b"Experimental AIR WASM compiler. Built from the exact fork commit in build-report.json.\nThe source archive includes unchanged Git files under air-wasm-v0.1.0-source/, including compiler, SDK wrapper, workflow and build tooling.\nSibling air-wasm-v0.1.0-notices/ contains artifact-only GPL text and provenance, not additional Git source files.\nSibling air-wasm-v0.1.0-sdk-runtime/ contains exact installed Emscripten src/, system/lib/, system/include/, LICENSE and AUTHORS with a per-file FILES.json inventory, not the entire external SDK toolchain.\nOnly generic compiler smoke and ABI/header probes are claimed, not browser, GPU, device or application acceptance.\nPreserve all file-specific license notices; this archive is not a single-license claim. Upstream texts and exact origins are in licenses/.\n"
    members["CONTENTS.sha256"] = "".join(digest(data) + "  " + name + "\n" for name, data in sorted(members.items())).encode()
    require(len(members) <= 64, "Runtime inventory exceeds the consumer limit")
    require(all(0 < len(data) <= (128 * 1024**2 if name == "air_wasm.wasm" else 1024**2)
                for name, data in members.items()), "Runtime member exceeds the consumer limit")
    output_dir = work / "release"
    output_dir.mkdir()
    runtime = output_dir / "air-wasm-v0.1.0-runtime.tar.gz"
    deterministic_tar(runtime, members)
    source = output_dir / "air-wasm-v0.1.0-source.tar.gz"
    prepared_source = work / "corresponding-source.tar.gz"
    source_pin = json.loads((work / "source-archive-pin.json").read_text())
    check_file(prepared_source, source_pin)
    shutil.copyfile(prepared_source, source)
    check_file(source, source_pin)
    inputs = output_dir / "air-wasm-v0.1.0-build-inputs.json"
    shutil.copyfile(work / "build-inputs.json", inputs)
    require(0 < runtime.stat().st_size <= 128 * 1024**2, "Runtime archive exceeds the consumer limit")
    require(0 < source.stat().st_size <= 256 * 1024**2, "Source archive exceeds the consumer limit")
    require(0 < inputs.stat().st_size <= 1024**2, "Build-input disclosure exceeds the consumer limit")
    manifest = {"schemaVersion": 1, "status": "final", "kind": "fork-built-compiler",
                **{key: identity[key] for key in ("repository", "commit", "tree", "version", "sourceLockSha256", "sourceFingerprintSha256")},
                "apiVersion": 2, "headerBundleVersion": 2, "sourceLanguage": "floor-metal-3.2", "headerSha256": config["headerSha256"],
                "binaryBuiltFromNewFork": True, "buildReceiptSha256": sha256(receipt_path), "files": receipt["files"],
                "runtimeFiles": {name: {"bytes": len(data), "sha256": digest(data)} for name, data in sorted(members.items())},
                "assets": {"runtime": descriptor(runtime), "correspondingSource": descriptor(source), "buildInputs": descriptor(inputs)}}
    write_json(output_dir / "air-wasm-v0.1.0-manifest.json", manifest)
    require((output_dir / "air-wasm-v0.1.0-manifest.json").stat().st_size <= 1024**2, "Manifest exceeds the consumer limit")
    sums = "".join(sha256(path) + "  " + path.name + "\n" for path in sorted(output_dir.iterdir()))
    (output_dir / "SHA256SUMS").write_text(sums)
    require(source_identity(config) == identity, "Source tree changed during packaging")
    print("Prepared exact source and runtime assets; manifest SHA-256 " + sha256(output_dir / "air-wasm-v0.1.0-manifest.json"))


def publish(config, work):
    identity = source_identity(config)
    directory = work / "release"
    manifest = json.loads((directory / "air-wasm-v0.1.0-manifest.json").read_text())
    require(manifest["commit"] == identity["commit"] and manifest["tree"] == identity["tree"], "Published source identity mismatch")
    for pin in manifest["assets"].values():
        check_file(directory / pin["name"], pin)
    body = ("Initial standalone AIR WebAssembly compiler prerelease.\n\n"
            + "Built from https://github.com/" + REPOSITORY + "/commit/" + identity["commit"] + ".\n"
            + "Includes unchanged Git source files under the source prefix, sibling artifact-only distribution notices and pinned installed SDK runtime sources, reproducible-input disclosure, runtime, build receipt and checksums. "
            + "The fresh compiler passed generic public smoke and ABI/header identity probes. No byte-identical rebuild, browser, device, GPU or full-application acceptance is claimed. "
            + "Preserve all file-specific license notices.\n")
    api = GitHub(REPOSITORY)
    result = publish_release(api, tag=config["version"], commit=identity["commit"], title="AIR WASM v0.1.0", body=body,
                             paths=sorted(directory.iterdir()), directory=work)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as stream:
            stream.write("AIR WASM prerelease: " + result["html_url"] + "\n\nManifest SHA-256: " + sha256(directory / "air-wasm-v0.1.0-manifest.json") + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("preflight", "build", "package", "publish"))
    parser.add_argument("--work", type=Path, required=True)
    args = parser.parse_args()
    require(os.environ.get("CI") == "true" and os.environ.get("RUNNER_OS") == "Linux", "Release operations run only on the approved Linux CI runner")
    config = json.loads(Path(__file__).with_name("release-config.json").read_text())
    work = args.work.resolve()
    require(ROOT not in work.parents and work != ROOT, "Build outputs must stay outside the clean source checkout")
    work.mkdir(parents=True, exist_ok=True)
    globals()[args.operation](config, work)


if __name__ == "__main__":
    try:
        main()
    except (ReleaseError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        raise SystemExit("AIR release stopped: " + str(exc))
