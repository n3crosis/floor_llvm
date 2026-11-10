#!/usr/bin/env python3
"""Pinned, no-install Mac validation. Python 3.9+, standard library only.

Never changes an existing repository or global settings. Output must be new.
Run --help; see README.md for artifact selection and evidence limitations.
"""
from __future__ import annotations

import argparse
import collections
import glob
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import zipfile

REPOSITORY = "n3crosis/floor_llvm"
COMMIT = "81d255965a578d9dd55ec4cd2b53a2f239a989f1"
TREE = "84703aa5fcb717ed1677681e9a3f7ee5f3f74987"
HEADER = "5b2cbcaea61eb90f878c0d16e500d742079d1674aa5b331c21cc0589f5d6ca3e"
RUN_ID = "42790141243"
RUN_URL = f"https://github.com/{REPOSITORY}/actions/runs/{RUN_ID}"
ARTIFACT_NAME = f"air-wasm-dev-{COMMIT[:12]}-{COMMIT}"
ARTIFACT_ID = "13752442598"
ARTIFACT_ZIP_BYTES = 186234725
ARTIFACT_ZIP_SHA256 = "05b9ff737b04de5cbfa7ae1cfe235d1c14aafa1b5be2ef64250286b98adf30f4"
MIB = 1024 * 1024
# Generated from the exact authored source snapshot; no downloaded code runs
# until Git, source-lock, artifact, receipt, headers and these hashes agree.
HARNESS_PINS = {'wasm/source-lock.json': 'e0bc03d6dbd4b6771b7b5e45bf644ff7b3b712521b1b64349ef4cf34c0bcb2e1',
 'wasm/release/apple-reference.mjs': '05f778322f6000e90f09b3147909a2913aa916a957534fb4513c0ded955e5f94',
 'wasm/release/integer-vector.mjs': 'b7e99ae0568f7842b32161fe42919882e20c01e71a49370288a6ef768be20bbc',
 'wasm/release/derivative-vector.mjs': 'ccbabbc2e261db39c9ef03e3c5c86abd6138fe007cca9c0e621040f6a5532be8',
 'wasm/release/common-functions.mjs': '71f218680ebaeb1b751a7421657f14fef20cbc5f2adc362431605f8cc3772561',
 'wasm/release/common-functions-ir.mjs': '74307f0b124caf5bebc5831208cc16c9c1291355aca3a58f8304372d2ad99b23',
 'wasm/release/verify-apple-runtime.py': 'f99a6580adea5dc8a37285dcada27ac2fa7e0f2cfb8570c7b361d16e61ac8d56',
 'wasm/release/metal-numerical.swift': 'cd05357963b03339ce7ff38fc9f950ef21cda44e86e718e39b2c1f2c8d538eee'}
CASES = [{'name': 'case-0',
  'ios': 18,
  'math': 0,
  'kind': 'integer',
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios18-math0-kind0', 'integer-vector-dynamic-ios18-math0-kind1']},
 {'name': 'case-1',
  'ios': 18,
  'math': 0,
  'kind': 'integer',
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios18-math0-kind0', 'integer-vector-constants-ios18-math0-kind1']},
 {'name': 'case-2',
  'ios': 18,
  'math': 1,
  'kind': 'integer',
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios18-math1-kind0', 'integer-vector-dynamic-ios18-math1-kind1']},
 {'name': 'case-3',
  'ios': 18,
  'math': 1,
  'kind': 'integer',
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios18-math1-kind0', 'integer-vector-constants-ios18-math1-kind1']},
 {'name': 'case-4',
  'ios': 26,
  'math': 0,
  'kind': 'integer',
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios26-math0-kind0', 'integer-vector-dynamic-ios26-math0-kind1']},
 {'name': 'case-5',
  'ios': 26,
  'math': 0,
  'kind': 'integer',
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios26-math0-kind0', 'integer-vector-constants-ios26-math0-kind1']},
 {'name': 'case-6',
  'ios': 26,
  'math': 1,
  'kind': 'integer',
  'sourceSha256': '741fcc6e734fbabe68ccbc0dc16d14cf41e902e64fb202b2859bebcc4699091e',
  'aliases': ['integer-vector-dynamic-ios26-math1-kind0', 'integer-vector-dynamic-ios26-math1-kind1']},
 {'name': 'case-7',
  'ios': 26,
  'math': 1,
  'kind': 'integer',
  'sourceSha256': '5489f3069c4cc95dc740be390461de9ea25a7f41b96e144e5c8843dc00500053',
  'aliases': ['integer-vector-constants-ios26-math1-kind0', 'integer-vector-constants-ios26-math1-kind1']},
 {'name': 'case-8',
  'ios': 18,
  'math': 0,
  'kind': 'derivative',
  'sourceSha256': '91d6c9de45d0c1474cd1fd6380cd924b770a6fca8957c53fe7b49c41e2181f82',
  'aliases': ['derivative-vector-ios18-math0-kind0', 'derivative-vector-ios18-math0-kind1']},
 {'name': 'case-9',
  'ios': 18,
  'math': 1,
  'kind': 'derivative',
  'sourceSha256': '91d6c9de45d0c1474cd1fd6380cd924b770a6fca8957c53fe7b49c41e2181f82',
  'aliases': ['derivative-vector-ios18-math1-kind0', 'derivative-vector-ios18-math1-kind1']},
 {'name': 'case-10',
  'ios': 26,
  'math': 0,
  'kind': 'derivative',
  'sourceSha256': '91d6c9de45d0c1474cd1fd6380cd924b770a6fca8957c53fe7b49c41e2181f82',
  'aliases': ['derivative-vector-ios26-math0-kind0', 'derivative-vector-ios26-math0-kind1']},
 {'name': 'case-11',
  'ios': 26,
  'math': 1,
  'kind': 'derivative',
  'sourceSha256': '91d6c9de45d0c1474cd1fd6380cd924b770a6fca8957c53fe7b49c41e2181f82',
  'aliases': ['derivative-vector-ios26-math1-kind0', 'derivative-vector-ios26-math1-kind1']},
 {'name': 'case-12',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios18-math0-kind0', 'common-dynamic-ios18-math0-kind1']},
 {'name': 'case-13',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios18-math0-kind0', 'common-constants1-ios18-math0-kind1']},
 {'name': 'case-14',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios18-math0-kind0', 'common-constants2-ios18-math0-kind1']},
 {'name': 'case-15',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios18-math0-kind0', 'common-constants3-ios18-math0-kind1']},
 {'name': 'case-16',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios18-math0-kind0', 'common-constants4-ios18-math0-kind1']},
 {'name': 'case-17',
  'ios': 18,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '99bb1dfdb92747ddf0738d54071b76468817ac01c14d4ec8f615a3a1eab5d1e4',
  'aliases': ['common-step-special-ios18-kind0', 'common-step-special-ios18-kind1']},
 {'name': 'case-18',
  'ios': 18,
  'math': 1,
  'kind': 'common',
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios18-math1-kind0', 'common-dynamic-ios18-math1-kind1']},
 {'name': 'case-19',
  'ios': 18,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios18-math1-kind0', 'common-constants1-ios18-math1-kind1']},
 {'name': 'case-20',
  'ios': 18,
  'math': 1,
  'kind': 'common',
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios18-math1-kind0', 'common-constants2-ios18-math1-kind1']},
 {'name': 'case-21',
  'ios': 18,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios18-math1-kind0', 'common-constants3-ios18-math1-kind1']},
 {'name': 'case-22',
  'ios': 18,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios18-math1-kind0', 'common-constants4-ios18-math1-kind1']},
 {'name': 'case-23',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios26-math0-kind0', 'common-dynamic-ios26-math0-kind1']},
 {'name': 'case-24',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios26-math0-kind0', 'common-constants1-ios26-math0-kind1']},
 {'name': 'case-25',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios26-math0-kind0', 'common-constants2-ios26-math0-kind1']},
 {'name': 'case-26',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios26-math0-kind0', 'common-constants3-ios26-math0-kind1']},
 {'name': 'case-27',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios26-math0-kind0', 'common-constants4-ios26-math0-kind1']},
 {'name': 'case-28',
  'ios': 26,
  'math': 0,
  'kind': 'common',
  'sourceSha256': '99bb1dfdb92747ddf0738d54071b76468817ac01c14d4ec8f615a3a1eab5d1e4',
  'aliases': ['common-step-special-ios26-kind0', 'common-step-special-ios26-kind1']},
 {'name': 'case-29',
  'ios': 26,
  'math': 1,
  'kind': 'common',
  'sourceSha256': 'a6241c55c22de735cfe119b1bb829e8145a1febfe8d7e6371b99c72f64ac828d',
  'aliases': ['common-dynamic-ios26-math1-kind0', 'common-dynamic-ios26-math1-kind1']},
 {'name': 'case-30',
  'ios': 26,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '9e632cc559753e9e64ab6ef6bbaebf6f0f5010d83e16782b2828a17ad8f509cd',
  'aliases': ['common-constants1-ios26-math1-kind0', 'common-constants1-ios26-math1-kind1']},
 {'name': 'case-31',
  'ios': 26,
  'math': 1,
  'kind': 'common',
  'sourceSha256': 'be3e468641ea145856b1cace64638d236f4bb944c5d6fcfae04d9a17bafa0f0c',
  'aliases': ['common-constants2-ios26-math1-kind0', 'common-constants2-ios26-math1-kind1']},
 {'name': 'case-32',
  'ios': 26,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '78e5be4e1a3f097a003cd7f513a596098abe96584fe621b582b4f0e604fc858c',
  'aliases': ['common-constants3-ios26-math1-kind0', 'common-constants3-ios26-math1-kind1']},
 {'name': 'case-33',
  'ios': 26,
  'math': 1,
  'kind': 'common',
  'sourceSha256': '9940ab7253995d567cd5c542234f68f3e22a68941269153b4149163ff0287f6c',
  'aliases': ['common-constants4-ios26-math1-kind0', 'common-constants4-ios26-math1-kind1']}]


class Stop(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def require(ok, message, code=1):
    if not ok:
        raise Stop(message, code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(MIB), b""):
            h.update(block)
    return h.hexdigest()


def safe_name(name, basename=False):
    require(isinstance(name, str) and name and "\\" not in name and "\x00" not in name,
            "Invalid archive path")
    p = PurePosixPath(name)
    require(not p.is_absolute() and ".." not in p.parts and ":" not in name,
            "Unsafe archive path")
    require(not basename or p.name == name, "Asset name must be a basename")
    return name


def read_json(path, limit=MIB):
    require(Path(path).stat().st_size <= limit, "JSON exceeds size limit")
    return json.loads(Path(path).read_text())


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def manifest_identity(m):
    expected = {"schemaVersion": 1, "status": "final", "kind": "fork-built-compiler",
                "repository": REPOSITORY, "commit": COMMIT, "tree": TREE,
                "binaryBuiltFromNewFork": True, "apiVersion": 2,
                "headerBundleVersion": 2, "headerSha256": HEADER}
    for key, value in expected.items():
        require(m.get(key) == value, f"Wrong artifact: {key} does not match this pinned runner")
    require(set(m["assets"]) == {"runtime", "correspondingSource", "buildInputs"},
            "Missing or unexpected artifact assets")
    names = set()
    for kind, limit in (("runtime", 128*MIB), ("correspondingSource", 256*MIB), ("buildInputs", MIB)):
        pin = m["assets"][kind]
        safe_name(pin["name"], basename=True)
        require(pin["name"] not in names, "Duplicate artifact asset")
        names.add(pin["name"])
        require(type(pin["bytes"]) is int and 0 < pin["bytes"] <= limit, "Invalid asset size")
        require(re.fullmatch("[0-9a-f]{64}", pin["sha256"]), "Invalid asset hash")


def pinned_zip_manifest(path):
    """Authenticate the original GitHub artifact ZIP before parsing its manifest."""
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Original compiler artifact ZIP missing or symlink input rejected", 2)
    with path.open("rb") as stream:
        require(os.fstat(stream.fileno()).st_size == ARTIFACT_ZIP_BYTES, "Artifact ZIP size differs from the immutable GitHub artifact")
        h = hashlib.sha256()
        for block in iter(lambda: stream.read(MIB), b""):
            h.update(block)
        require(h.hexdigest() == ARTIFACT_ZIP_SHA256, "Artifact ZIP SHA-256 differs from the immutable GitHub artifact")
        stream.seek(0)
        with zipfile.ZipFile(stream) as archive:
            matches = [i for i in archive.infolist() if i.filename.endswith("-manifest.json") and not i.is_dir()]
            require(len(matches) == 1 and matches[0].file_size <= MIB, "Pinned ZIP has an invalid manifest inventory")
            return archive.read(matches[0])


def stage_artifact(source, destination, original_zip=None):
    """Bind every accepted input to the immutable downloaded GitHub ZIP digest."""
    source = Path(source)
    require(source.exists(), "Artifact not found. Download the pinned CI artifact; do not use an older build.", 2)
    if source.is_dir():
        require(original_zip is not None,
                "Extracted-folder input also requires --original-zip with the original, unchanged GitHub download.", 2)
        trusted_manifest = pinned_zip_manifest(original_zip)
    else:
        require(original_zip is None, "Use --original-zip only with an extracted artifact folder", 2)
        trusted_manifest = pinned_zip_manifest(source)
    return _stage_artifact_files(source, destination, trusted_manifest)


def _stage_artifact_files(source, destination, trusted_manifest=None):
    """Copy only the four declared files, checking hashes without executing them."""
    source = Path(source)
    require(source.exists(), "Artifact not found. Wait for the pinned CI build artifact; do not use an older build.", 2)
    require(not source.is_symlink(), "Artifact input may not be a symbolic link")
    destination.mkdir()
    archive = None
    try:
        if source.is_dir():
            # Accept a direct extracted artifact or one wrapper directory, not an
            # arbitrary recursive walk through user files.
            manifests = list(source.glob("*-manifest.json")) + list(source.glob("*/*-manifest.json"))
            require(len(manifests) == 1, "Expected exactly one compiler manifest in artifact folder")
            manifest = manifests[0]
            require(not manifest.is_symlink() and not manifest.parent.is_symlink(), "Symlink artifact rejected")
            require(manifest.stat().st_size <= MIB, "Manifest too large")
            raw = manifest.read_bytes()
            def open_asset(name):
                p = manifest.parent / name
                require(p.is_file() and not p.is_symlink(), "Missing or symlink artifact asset: " + name)
                return p.open("rb")
        else:
            require(zipfile.is_zipfile(source), "Provide the workflow artifact ZIP or its extracted folder", 2)
            archive = zipfile.ZipFile(source)
            infos = archive.infolist()
            require(len(infos) <= 100, "Too many entries in artifact ZIP")
            seen = set()
            for item in infos:
                safe_name(item.filename)
                require(item.filename not in seen, "Duplicate ZIP path")
                seen.add(item.filename)
                kind = stat.S_IFMT(item.external_attr >> 16)
                require(kind in (0, stat.S_IFREG, stat.S_IFDIR), "Non-regular ZIP member rejected")
                require(not item.flag_bits & 1, "Encrypted ZIP rejected")
                require(item.file_size <= 300*MIB, "Oversized ZIP member")
            candidates = [i for i in infos if i.filename.endswith("-manifest.json") and not i.is_dir()]
            require(len(candidates) == 1, "Expected exactly one compiler manifest; Apple evidence is not a compiler artifact")
            item = candidates[0]
            require(item.file_size <= MIB, "Manifest too large")
            raw = archive.read(item)
            manifest = PurePosixPath(item.filename)
            prefix = str(manifest.parent)
            def open_asset(name):
                key = name if prefix == "." else prefix + "/" + name
                require(key in seen, "Missing artifact asset: " + name)
                return archive.open(key)
        require(trusted_manifest is None or raw == trusted_manifest, "Artifact manifest differs from the pinned original ZIP")
        m = json.loads(raw)
        manifest_identity(m)
        (destination / Path(str(manifest)).name).write_bytes(raw)
        for pin in m["assets"].values():
            total, h = 0, hashlib.sha256()
            with open_asset(pin["name"]) as src, (destination/pin["name"]).open("xb") as dst:
                while True:
                    block = src.read(MIB)
                    if not block:
                        break
                    total += len(block)
                    require(total <= pin["bytes"], "Asset longer than declared: " + pin["name"])
                    h.update(block)
                    dst.write(block)
            require(total == pin["bytes"] and h.hexdigest() == pin["sha256"], "Artifact hash mismatch: " + pin["name"])
        return m
    finally:
        if archive is not None:
            archive.close()


def sanitize(text, replacements):
    for old, new in sorted(replacements, key=lambda p: len(p[0]), reverse=True):
        if old:
            text = text.replace(old, new)
    # Additional common host-path and bearer-token forms. No environment dump,
    # username, hostname, serial, credentials or account identifiers are collected.
    text = re.sub(r"/(?:Users|home)/[^/\s\"']+", "<HOME>", text)
    text = re.sub(r"(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]+", "<REDACTED_TOKEN>", text)
    text = re.sub(r"(?i)(authorization\s*[:=]\s*(?:bearer|token)\s+)\S+", r"\1<REDACTED>", text)
    return text


class Runner:
    OUTPUT_LIMIT = 2*MIB  # Per stream, per command; never capture unlimited logs.

    def __init__(self, output, artifact, developer_dir=None, capability_only=False, original_zip=None):
        self.output = Path(output)
        self.artifact = Path(artifact).expanduser().resolve() if artifact else None
        self.capability_only = capability_only
        self.original_zip = Path(original_zip).expanduser().resolve() if original_zip else None
        self.work, self.share = self.output/"work", self.output/"share"
        self.work.mkdir()
        self.share.mkdir()
        self.replacements = [(str(self.output), "<RUN>"), (str(Path.home()), "<HOME>")]
        if self.artifact:
            self.replacements.append((str(self.artifact), "<ARTIFACT>"))
        if self.original_zip:
            self.replacements.append((str(self.original_zip), "<ORIGINAL_ARTIFACT_ZIP>"))
        self.developer_dir = developer_dir
        self.stage = "artifact"
        self.result = {"schemaVersion": 1, "repository": REPOSITORY, "commit": COMMIT, "tree": TREE,
                       "expectedWorkflowRun": RUN_URL, "expectedArtifactName": ARTIFACT_NAME,
                       "workflowOrigin": "not_checked",
                       "expectedArtifactZip": {"artifactID": ARTIFACT_ID, "bytes": ARTIFACT_ZIP_BYTES, "sha256": ARTIFACT_ZIP_SHA256},
                       "runnerSha256": file_hash(__file__), "status": "not_run", "stages": {},
                       "mode": "apple_metal41_capability_only" if capability_only else "pinned_baseline_plus_apple_metal41_capability",
                       "limitations": ["Bounded authored cases, not full Metal or application compatibility.",
                           "FLOOR uses Metal 3.2 source dialect for both iOS targets.",
                           "The pinned FLOOR baseline does not exercise MSL 4.1 language mode; the separate Apple probe has only minimal compile/link scope.",
                           "No iPhone or iPad device execution; this run uses the Mac's actual MTLDevice.",
                           "No common-function GPU cases, negative/mixed-slope derivatives, edge pixels or divergent flow.",
                           "An unavailable original iOS library is never a GPU or numerical pass."]}
        # Minimal subprocess environment. Do not pass tokens, Node injection flags,
        # dyld overrides, Python startup hooks or personal Git configuration.
        self.env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
                    "HOME": str(self.work/"home"), "TMPDIR": str(self.work/"tmp"),
                    "LANG": "en_US.UTF-8", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null",
                    "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "/usr/bin/false", "SSH_ASKPASS": "/usr/bin/false"}
        for key in ("HOME", "TMPDIR"):
            Path(self.env[key]).mkdir()
        self.commands = []

    def run(self, args, timeout=120, check=True, input_text=None):
        args = [str(a) for a in args]
        require(input_text is None or len(input_text.encode()) <= 16384, "Command input exceeds bounded pipe budget")
        # A new process group lets interruption/timeout stop every descendant,
        # including compiler and GPU worker processes, rather than orphaning them.
        child = subprocess.Popen(args, cwd=self.work, env=self.env, stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace", start_new_session=True)
        captured = [[], []]
        overflow = threading.Event()
        def read_bounded(stream, slot):
            remaining = self.OUTPUT_LIMIT
            while True:
                chunk = stream.read(16384)
                if not chunk:
                    return
                if remaining > 0:
                    captured[slot].append(chunk[:remaining])
                remaining -= len(chunk)
                if remaining < 0:
                    overflow.set()
        readers = [threading.Thread(target=read_bounded, args=(stream, slot), daemon=True)
                   for slot, stream in enumerate((child.stdout, child.stderr))]
        for thread in readers:
            thread.start()
        error = None
        try:
            if input_text is not None:
                try:
                    child.stdin.write(input_text)
                    child.stdin.close()
                except BrokenPipeError:
                    pass
            deadline = time.monotonic() + timeout
            while child.poll() is None:
                if overflow.is_set():
                    raise Stop("Command exceeded the 2 MiB per-stream output budget; partial diagnostics retained")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise subprocess.TimeoutExpired(args, timeout)
                try:
                    child.wait(timeout=min(0.1, remaining))
                except subprocess.TimeoutExpired:
                    pass
        except (subprocess.TimeoutExpired, KeyboardInterrupt, Stop) as caught:
            error = caught
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        finally:
            for thread in readers:
                thread.join(timeout=5)
            # Descendants may retain a pipe after their parent exits. Do not
            # wait forever or leave such a process group running.
            if any(t.is_alive() for t in readers):
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                for thread in readers:
                    thread.join(timeout=5)
                error = error or Stop("Command left descendant output pipes open; process group stopped")
            stdout, stderr = ("".join(parts) for parts in captured)
            self.commands.append({"args": args, "returncode": child.returncode, "stdout": stdout, "stderr": stderr,
                                  "interruptedOrTimedOut": isinstance(error, (subprocess.TimeoutExpired, KeyboardInterrupt)),
                                  "outputTruncated": overflow.is_set()})
            child.stdout.close()
            child.stderr.close()
        if error:
            raise error
        require(not overflow.is_set(), "Command exceeded the 2 MiB per-stream output budget; partial diagnostics retained")
        if check:
            require(child.returncode == 0, f"Command failed ({child.returncode}): {Path(args[0]).name}; see commands.log")
        return child.returncode, stdout, stderr

    def prerequisites(self, compiler_only=False):
        require(sys.platform == "darwin", "Mac validation requires macOS; Apple/Swift/GPU tests were not run.", 2)
        for tool in (("xcodebuild", "xcrun") if compiler_only else ("git", "node", "xcodebuild", "xcrun")):
            require(shutil.which(tool, path=self.env["PATH"]), f"Missing {tool}; install prerequisites yourself, then rerun.", 2)
        node = git_version = "not required for capability-only mode"
        if not compiler_only:
            _, node, _ = self.run(["node", "--version"])
            require(re.fullmatch(r"v24\.\d+\.\d+\s*", node), "Node 24.x is required; no alternate-major fallback.", 2)
            _, git_version, _ = self.run(["git", "--version"])
            m = re.search(r"git version (\d+)\.(\d+)", git_version)
            require(m and tuple(map(int, m.groups())) >= (2, 25), "Git 2.25+ is required for sparse checkout.", 2)
        candidates = []
        paths = [self.developer_dir] if self.developer_dir else glob.glob("/Applications/Xcode*.app/Contents/Developer")
        if not self.developer_dir:
            if os.environ.get("DEVELOPER_DIR"):
                paths.append(os.environ["DEVELOPER_DIR"])
            rc, selected, _ = self.run(["/usr/bin/xcode-select", "-p"], check=False)
            if rc == 0:
                paths.append(selected.strip())
        for path in sorted(set(p for p in paths if p)):
            self.env["DEVELOPER_DIR"] = str(Path(path).expanduser().resolve())
            rc, version, _ = self.run(["xcodebuild", "-version"], check=False)
            match = re.search(r"^Xcode (\d+(?:\.\d+)*)", version)
            if rc == 0 and match and int(match[1].split(".")[0]) >= 26:
                candidates.append((tuple(map(int, match[1].split("."))), self.env["DEVELOPER_DIR"], version.strip()))
        require(candidates, "Xcode 26+ is unavailable. No install, license acceptance or xcode-select change was attempted.", 2)
        _, selected, version = max(candidates)
        self.env["DEVELOPER_DIR"] = selected
        self.replacements.append((selected, "<XCODE>"))
        sdk_rc, sdk, _ = self.run(["xcrun", "-sdk", "iphoneos", "--show-sdk-version"], check=False)
        require(sdk_rc == 0 and re.fullmatch(r"\d+(?:\.\d+)*\s*", sdk) and int(sdk.split(".")[0]) >= 26,
                "iPhoneOS SDK 26+ is required for the unchanged target matrix.", 2)
        metal_rc, metal, _ = self.run(["xcrun", "-sdk", "iphoneos", "metal", "--version"], check=False)
        require(metal_rc == 0, "Apple Metal command-line tool unavailable; no component download or installation attempted.", 2)
        swift = "not required for capability-only mode"
        if not compiler_only:
            swift_rc, swift, _ = self.run(["xcrun", "-sdk", "macosx", "swiftc", "--version"], check=False)
            require(swift_rc == 0, "Swift compiler unavailable; no installation attempted.", 2)
        self.result["host"] = {"macOS": platform.mac_ver()[0], "architecture": platform.machine(),
                               "xcode": version, "iPhoneOSSDK": sdk.strip(), "metal": metal.strip(),
                               "swift": swift.strip(), "node": node.strip(), "python": platform.python_version(),
                               "git": git_version.strip()}

    def metal41_probe(self):
        self.stage = "appleMetal41Capability"
        print("Checking minimal Apple Metal 4.1 source acceptance (separate from FLOOR)...", flush=True)
        folder = self.work/"apple-metal41-capability"
        folder.mkdir()
        source = folder/"minimal.metal"
        source.write_text("#include <metal_stdlib>\nusing namespace metal;\n"
                          "kernel void metal41_capability(device uint* output [[buffer(0)]], "
                          "uint index [[thread_position_in_grid]]) { output[index] = index + 1u; }\n")
        air, library = folder/"minimal.air", folder/"minimal.metallib"
        args = ["xcrun", "-sdk", "iphoneos", "metal", "-target", "air64-apple-ios27.0", "-std=metal4.1", "-fno-fast-math", "-c", source, "-o", air]
        result = {"schemaVersion": 1, "scope": "Minimal Apple source compile/link capability only, not Metal 4.1 feature conformance or FLOOR 4.1 support.",
                  "sourceSha256": file_hash(source), "sdk": self.result["host"]["iPhoneOSSDK"],
                  "compiler": self.result["host"]["metal"], "target": "air64-apple-ios27.0", "language": "metal4.1",
                  "targetNote": "MSL 4.1's iOS 27 deployment profile is probed explicitly. An older selected SDK may reject this request.",
                  "sdkAtLeast27": int(self.result["host"]["iPhoneOSSDK"].split(".")[0]) >= 27,
                  "sdkLimitation": "An SDK below 27 remains a validation limitation even if this minimal compiler flag is accepted.",
                  "compile": "not_run", "link": "not_run", "libraryLoading": "not_run", "gpuExecution": "not_run", "numericalComparison": "not_run"}
        rc, stdout, stderr = self.run(args, check=False)
        result.update(compileExitCode=rc, compileStdout=stdout, compileStderr=stderr, compileCommand=[str(a) for a in args])
        if rc != 0:
            diagnostics = (stdout + "\n" + stderr).lower()
            unsupported = ("metal4.1" in diagnostics and any(word in diagnostics for word in ("invalid", "unsupported", "not supported", "unrecognized", "unknown")))
            result.update(compile="unsupported" if unsupported else "rejected", status="unsupported" if unsupported else "rejected")
        else:
            require(air.is_file() and air.stat().st_size > 0, "Apple capability compiler accepted but produced no AIR")
            result.update(compile="accepted", airSha256=file_hash(air))
            link_args = ["xcrun", "-sdk", "iphoneos", "metallib", air, "-o", library]
            link_rc, stdout, stderr = self.run(link_args, check=False)
            result.update(linkExitCode=link_rc, linkStdout=stdout, linkStderr=stderr, linkCommand=[str(a) for a in link_args])
            if link_rc == 0 and library.is_file() and library.read_bytes()[:4] == b"MTLB":
                result.update(link="accepted", status="minimal_compile_link_accepted", metallibSha256=file_hash(library))
            else:
                result.update(link="failed", status="link_failed")
        write_json(folder/"report.json", result)
        self.result["appleMetal41Capability"] = result
        self.result["stages"][self.stage] = result["status"]

    def checkout(self):
        checkout = self.work/"checkout"
        checkout.mkdir()
        git = ["git", "-c", "core.hooksPath=/dev/null", "-C", checkout]
        self.run(git + ["init", "--template="])
        self.run(git + ["remote", "add", "origin", f"https://github.com/{REPOSITORY}.git"])
        self.run(git + ["config", "remote.origin.promisor", "true"])
        self.run(git + ["config", "remote.origin.partialclonefilter", "blob:none"])
        # --filter fetches commit/tree metadata; sparse checkout materializes wasm
        # and locked source inputs only, never a full LLVM working tree.
        self.run(git + ["fetch", "--no-tags", "--depth=1", "--filter=blob:none", "origin", COMMIT], timeout=900)
        self.run(git + ["sparse-checkout", "init", "--no-cone"])
        self.run(git + ["sparse-checkout", "set", "--no-cone", "--stdin"], input_text="/wasm/\n/.github/workflows/release-air-wasm.yml\n")
        self.run(git + ["checkout", "--detach", "FETCH_HEAD"], timeout=300)
        _, head, _ = self.run(git + ["rev-parse", "HEAD"])
        _, tree, _ = self.run(git + ["rev-parse", "HEAD^{tree}"])
        require(head.strip() == COMMIT and tree.strip() == TREE, "Fetched Git identity differs from the pinned commit/tree")
        lock = read_json(checkout/"wasm/source-lock.json")
        inputs = dict(lock["compilerFiles"])
        inputs.update({"wasm/" + name: value for name, value in lock["sdkFiles"].items()})
        for name in inputs:
            safe_name(name)
            require(re.fullmatch(r"[A-Za-z0-9_.+/-]+", name), "Invalid source-lock path")
        paths = ["/wasm/", "/.github/workflows/release-air-wasm.yml"] + ["/" + name for name in inputs if not name.startswith("wasm/")]
        self.run(git + ["sparse-checkout", "set", "--no-cone", "--stdin"], timeout=300, input_text="\n".join(paths) + "\n")
        for name, expected in {**inputs, **HARNESS_PINS}.items():
            p = checkout/name
            require(p.is_file() and not p.is_symlink() and file_hash(p) == expected, "Pinned source mismatch: " + name)
        _, dirty, _ = self.run(git + ["status", "--porcelain", "--untracked-files=all"])
        require(not dirty, "Fresh checkout unexpectedly changed")
        return checkout, inputs

    def provenance(self, m, checkout, inputs):
        artifact = self.work/"artifact"
        lock_sha = file_hash(checkout/"wasm/source-lock.json")
        fingerprint = sha(("floor-air-wasm-source-v1\n" + REPOSITORY + "\n" + COMMIT + "\n" + TREE + "\n" + lock_sha + "\n" +
                           "".join(p + "\0" + inputs[p] + "\n" for p in sorted(inputs))).encode())
        require(m["sourceLockSha256"] == lock_sha and m["sourceFingerprintSha256"] == fingerprint, "Source identity mismatch")
        build = read_json(artifact/m["assets"]["buildInputs"]["name"])
        for key in ("repository", "commit", "tree", "sourceLockSha256", "sourceFingerprintSha256"):
            require(build[key] == m[key], "Build-input identity mismatch: " + key)
        require(build["sourceInputs"] == inputs, "Build-input source inventory mismatch")
        for name, expected in HARNESS_PINS.items():
            if name.startswith("wasm/release/") and not name.endswith(".test.mjs"):
                require(build["tooling"].get(name) == expected, "Build did not disclose this exact harness: " + name)
        # Verify every locked compiler/wrapper input and executed harness in the
        # corresponding-source archive without extracting a full LLVM checkout.
        wanted = {**inputs, **HARNESS_PINS}
        prefix = build["sourceArchivePrefix"]
        require(prefix == f"air-wasm-{m['version']}-source/", "Unexpected source archive prefix")
        seen, byte_budget, entry_count = set(), 0, 0
        with tarfile.open(artifact/m["assets"]["correspondingSource"]["name"], "r|gz") as archive:
            for member in archive:
                entry_count += 1
                safe_name(member.name)
                byte_budget += member.size
                require(entry_count <= 400000 and byte_budget <= 8*1024*MIB and member.size <= 256*MIB,
                        "Corresponding-source archive exceeds inspection budget")
                if not member.name.startswith(prefix):
                    continue
                name = member.name[len(prefix):]
                if name not in wanted:
                    continue
                require(name not in seen and member.isfile(), "Invalid source archive member: " + name)
                stream = archive.extractfile(member)
                h = hashlib.sha256()
                for block in iter(lambda: stream.read(MIB), b""):
                    h.update(block)
                require(h.hexdigest() == wanted[name], "Corresponding-source mismatch: " + name)
                seen.add(name)
        require(seen == set(wanted), "Corresponding-source archive omits locked source or harness files")
        runtime = self.work/"runtime"
        self.run([sys.executable, "-I", checkout/"wasm/release/verify-apple-runtime.py", artifact, checkout, runtime, COMMIT])
        receipt = read_json(runtime/"build-report.json")
        require(receipt["sourceInputs"] == inputs and receipt["sourceFingerprintSha256"] == fingerprint,
                "Runtime receipt source inputs differ")
        smoke = receipt.get("verification", {}).get("smoke", {})
        require(smoke.get("passed") is True and len(smoke.get("cases", [])) == 285,
                "Expected a passing 285-case compiler build receipt")
        self.result["artifact"] = {"manifestSha256": file_hash(next(artifact.glob("*-manifest.json"))),
                                   "assets": m["assets"], "headerSha256": HEADER, "sourceLockSha256": lock_sha,
                                   "sourceFingerprintSha256": fingerprint, "lockedSourceFilesChecked": len(inputs),
                                   "correspondingSourceScope": "Archive digest plus every locked input and pinned harness; no full source rebuild.",
                                   "compilerBuildReceipt": {"status": "reported_passed", "cases": 285,
                                                            "rerunByThisRunner": False}}
        return runtime

    def execute(self):
        if self.capability_only:
            self.stage = "prerequisites"
            self.prerequisites(compiler_only=True)
            self.result["stages"][self.stage] = "passed"
            self.metal41_probe()
            return
        for stage, action in [("artifact", lambda: stage_artifact(self.artifact, self.work/"artifact", self.original_zip)),
                              ("prerequisites", self.prerequisites), ("checkout", self.checkout)]:
            self.stage = stage
            print("Checking " + stage + "...", flush=True)
            value = action()
            self.result["stages"][stage] = "passed"
            if stage == "artifact":
                manifest = value
                self.result["workflowOrigin"] = "Original GitHub ZIP digest and size match the pinned immutable artifact; extracted manifest/assets are bound to that ZIP."
            elif stage == "checkout":
                checkout, inputs = value
        self.metal41_probe()
        self.stage = "provenance"
        print("Verifying source and runtime provenance...", flush=True)
        runtime = self.provenance(manifest, checkout, inputs)
        self.result["stages"][self.stage] = "passed"
        self.stage = "swiftBuild"
        print("Compiling the unchanged Swift Metal probe...", flush=True)
        probe = self.work/"metal-numerical"
        rc, _, _ = self.run(["xcrun", "-sdk", "macosx", "swiftc", checkout/"wasm/release/metal-numerical.swift",
                             "-framework", "Metal", "-framework", "Foundation", "-o", probe], timeout=300, check=False)
        self.result["stages"][self.stage] = "passed" if rc == 0 else "failed"
        self.stage = "appleReference"
        print("Running 34 same-source compile/link comparisons" + (" and up to 12 GPU pairs..." if rc == 0 else " (Swift build failed; GPU checks will not run)..."), flush=True)
        args = ["node", checkout/"wasm/release/apple-reference.mjs", runtime, self.work/"apple-reference"]
        if rc == 0:
            args += ["--gpu-probe", probe]
        reference_rc, _, _ = self.run(args, timeout=2400, check=False)
        self.result["stages"][self.stage] = "completed" if reference_rc == 0 else "failed"
        require(rc == 0 and reference_rc == 0, "Swift build or Apple reference gate failed; layer-specific partial evidence was retained")

    def finish(self, code):
        try:
            matrix = build_matrix(self.work/"apple-reference")
        except Exception as error:
            # Malformed/contradictory reports are themselves failures, but still
            # package the raw evidence and logs so the user can report the bug.
            code = 1
            self.result["error"] = "Invalid layer evidence: " + str(error)
            matrix = build_matrix(self.work/"no-report-fallback")
        if code == 0 and self.capability_only:
            status = self.result.get("appleMetal41Capability", {}).get("status")
            if status == "minimal_compile_link_accepted":
                self.result["status"] = "apple_metal41_minimal_accepted"
            elif status == "unsupported":
                self.result["status"] = "apple_metal41_unsupported"
                code = 77
            else:
                self.result["error"] = "Minimal Metal 4.1 probe rejected or failed; inspect the recorded diagnostics"
                code = 1
        elif code == 0:
            compile_ok = all(row[key] == "passed" for row in matrix["cases"] for key in ("appleCompile", "appleLink", "floorCompile"))
            eligible = [r for r in matrix["cases"] if r["gpuEligible"]]
            gpu_ok = all(r["numericalComparison"] == "passed" and r["gpuStatus"] == "passed" for r in eligible)
            unavailable = all(r["gpuStatus"] in ("passed", "unavailable") for r in eligible)
            if not compile_ok or not unavailable:
                code = 1
                self.result["error"] = "Incomplete or inconsistent layer evidence; no pass claimed"
            elif gpu_ok:
                self.result["status"] = "passed_bounded_scope"
            else:
                code = 77
                self.result["status"] = "compile_passed_gpu_unavailable"
        if code not in (0, 77):
            self.result["status"] = "blocked" if code == 2 else "interrupted" if code == 130 else "failed"
        self.result["exitCode"] = code
        self.result["layers"] = matrix["totals"]
        self.result["privacy"] = "Share contains sanitized selected test outputs only. Review before sharing; no automatic upload. Raw local evidence stays under work/."
        # Save only allowlisted generated evidence, never .git, HOME, environment,
        # downloaded compiler/source bundles or compiled host executable.
        inventory = []
        budget = 128*MIB
        for reference in (self.work/"apple-reference", self.work/"apple-metal41-capability"):
            if not reference.exists():
                continue
            for path in sorted(reference.rglob("*")):
                if not path.is_file() or path.is_symlink() or path.suffix not in (".json", ".metal", ".air", ".metallib", ".f32le"):
                    continue
                rel = Path("evidence")/reference.name/path.relative_to(reference)
                if path.suffix in (".air", ".metallib"):
                    inventory.append({"file": str(rel), "originalSha256": file_hash(path),
                                      "omitted": "Binary may embed host paths; unchanged original retained locally"})
                    continue
                size = path.stat().st_size
                if size > budget:
                    inventory.append({"file": str(rel), "omitted": "share archive size budget; retained locally"})
                    continue
                data = path.read_bytes()
                original = sha(data)
                if path.suffix in (".json", ".metal"):
                    data = sanitize(data.decode("utf-8", errors="replace"), self.replacements).encode()
                target = self.share/rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                budget -= size
                inventory.append({"file": str(rel), "originalSha256": original, "sharedSha256": sha(data),
                                  "sharedBytes": len(data), "redacted": original != sha(data)})
        summary = ["FLOOR Mac validation: " + self.result["status"], "Mode: " + self.result["mode"], "Baseline commit: " + COMMIT,
                   "Expected artifact run: " + RUN_URL, "", "Observed layers:"]
        for key, counts in matrix["totals"].items():
            summary.append("- " + key + ": " + ", ".join(f"{status}={n}" for status, n in sorted(counts.items())))
        if "error" in self.result:
            summary += ["", "Stopped: " + self.result["error"]]
        capability = self.result.get("appleMetal41Capability")
        if capability:
            summary += ["", "Separate Apple Metal 4.1 capability: " + capability["status"],
                        "This tests one minimal source at iOS 27 / MSL 4.1, not feature conformance or FLOOR 4.1 support."]
        if self.capability_only:
            summary += ["Baseline FLOOR compiler/GPU comparisons were not run in capability-only mode."]
        summary += ["", "Baseline planned scope: 34 compiler comparisons; only 12 pairs eligible for GPU evidence.",
                    "Apple: iOS 18 / MSL 3.2 and iOS 26 / MSL 4.0. FLOOR: MSL 3.2 for both targets.",
                    "The baseline uses MSL 4.1 only as an interface reference. Libraries are never retargeted.",
                    "Compile/link success is not library, pipeline, GPU or numerical proof.",
                    "Unavailable is not passed. Common functions have no GPU numerical coverage.",
                    "Baseline mode checks a 285-case CI receipt; that entire corpus is not rerun locally.",
                    "", "Send back summary.txt and evidence.zip after reviewing them for private information."]
        (self.share/"summary.txt").write_text(sanitize("\n".join(summary) + "\n", self.replacements))
        for name, value in (("result.json", self.result), ("validation-matrix.json", matrix), ("evidence-inventory.json", inventory)):
            (self.share/name).write_text(sanitize(json.dumps(value, indent=2, sort_keys=True) + "\n", self.replacements))
        logs = []
        for index, command in enumerate(self.commands, 1):
            logs.append(f"[{index}] " + json.dumps(command, indent=2))
        (self.share/"commands.log").write_text(sanitize("\n".join(logs) + "\n", self.replacements))
        (self.share/"PRIVACY.txt").write_text("This is a selected, sanitized evidence bundle, not a byte-for-byte copy of the local reports.\n"
            "Original and shared hashes are listed separately in evidence-inventory.json.\n"
            "Nested report hashes refer to original local files. Use sharedSha256 to validate the attached copy.\n"
            "No credentials, environment dump, host serial, username, hostname, .git directory, compiler executable or source archive is intentionally included.\n"
            "AIR and metallib binaries can embed private paths, so only their hashes are shared; unchanged binaries remain local.\n"
            "macOS, architecture, Xcode/SDK/tool versions and the generic GPU model can appear.\n"
            "Known home/output/SDK paths and common GitHub-token forms are redacted. Review before sharing; redaction is best effort.\n")
        archive_path = self.output/"evidence.zip"
        with zipfile.ZipFile(archive_path, "x", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(self.share.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(self.share).as_posix())
        print((self.share/"summary.txt").read_text())
        print("Summary:", self.share/"summary.txt")
        print("Review and return:", archive_path)
        return code


def build_matrix(reference):
    report = read_json(reference/"report.json", 16*MIB) if (reference/"report.json").exists() else {}
    observed = {c["name"]: c for c in report.get("cases", [])}
    require(len(observed) == len(report.get("cases", [])), "Duplicate case reports")
    require(set(observed) <= {c["name"] for c in CASES}, "Unexpected case report")
    rows = []
    for expected in CASES:
        item = observed.get(expected["name"], {})
        for key in ("sourceSha256", "ios", "math"):
            if item:
                require(item.get(key) == expected[key], "Case identity mismatch: " + expected["name"])
        eligible = expected["kind"] != "common"
        row = dict(expected, gpuEligible=eligible, appleDialect="metal3.2" if expected["ios"] == 18 else "metal4.0",
                   floorDialect="metal3.2", mathProfile="fast" if expected["math"] else "conservative")
        for key in ("appleCompile", "appleLink", "floorCompile"):
            value = item.get(key, "not_run")
            row[key] = "not_run" if value == "pending" else value
        detail_path = reference/(expected["name"] + "-gpu")/"report.json"
        details = read_json(detail_path, 16*MIB) if detail_path.exists() else {}
        default = "not_run" if eligible else "not_in_scope"
        row["gpuStatus"] = details.get("status", default)
        for label in ("apple", "floor"):
            row[label + "LibraryLoad"] = details.get("libraryLoading", {}).get(label, {}).get("status", default)
        for field, key in (("pipelineCreation", "pipelineCreation"), ("gpuExecution", "execution"), ("numericalComparison", "numericalComparison")):
            value = details.get(key, default)
            row[field] = "passed" if value == "completed" else value
        row["checkedValues"] = details.get("checkedValues", 0)
        if details.get("error"):
            row["gpuDiagnostic"] = details["error"]
        if details:
            hashes = [a.get("sha256") for a in details.get("artifacts", [])]
            require(hashes == [item.get("appleMetallibSha256"), item.get("floorMetallibSha256")], "GPU artifact hashes differ")
            if row["appleLibraryLoad"] == "loaded" and row["floorLibraryLoad"] == "rejected":
                row["gpuStatus"] = "failed"
            if row["gpuStatus"] == "passed":
                require(row["appleLibraryLoad"] == row["floorLibraryLoad"] == "loaded" and
                        all(row[k] == "passed" for k in ("pipelineCreation", "gpuExecution", "numericalComparison")) and
                        type(row["checkedValues"]) is int and row["checkedValues"] > 0,
                        "GPU pass lacks required layer evidence")
        rows.append(row)
    keys = ("appleCompile", "appleLink", "floorCompile", "appleLibraryLoad", "floorLibraryLoad",
            "pipelineCreation", "gpuExecution", "numericalComparison", "gpuStatus")
    return {"schemaVersion": 1, "commit": COMMIT, "cases": rows,
            "totals": {k: dict(collections.Counter(row[k] for row in rows)) for k in keys},
            "scope": {"floorCICorpus": 285, "successfulMetallibCICases": 103, "sameSourcePairs": 34, "gpuEligiblePairs": 12,
                "features": {"integer": "int2/3/4 and uint2/3/4 clz, ctz, popcount, reverse_bits, extract_bits, insert_bits",
                             "derivative": "float/float2/3/4 dfdx, dfdy, fwidth; position-only interior-pixel numerical cases",
                             "common": "same-width float/float2/3/4 mix, step, smoothstep, sign; compile/link only on Mac"},
                "unsupported": ["Half and integer common-function operands", "Mixed/scalar-vector common-function overloads", "Half/integer derivative operands"],
                "untested": ["MSL 4.1 language mode", "iPhone/iPad execution", "Common-function GPU numerics", "Negative/mixed-slope derivatives", "Divergent control flow", "Full applications"]}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--artifact", help="Downloaded exact-run compiler artifact ZIP or extracted folder")
    mode.add_argument("--capability-only", action="store_true", help="Probe installed Apple Metal 4.1 compile/link capability, no artifact or Git/Node needed")
    parser.add_argument("--original-zip", help="Original unchanged pinned ZIP, required when --artifact is an extracted folder")
    parser.add_argument("--output", help="New output directory; must not exist (default: unique directory in current folder)")
    parser.add_argument("--developer-dir", help="Use this installed Xcode Developer directory, still requiring Xcode 26+")
    args = parser.parse_args(argv)
    require(not (args.capability_only and args.original_zip), "--original-zip applies only to --artifact folder input", 2)
    if args.output:
        output = Path(args.output).expanduser().absolute()
        require(not output.exists() and not output.is_symlink(), "Output already exists; choose a NEW directory", 2)
        require(output.parent.is_dir(), "Output parent must already exist", 2)
        output.mkdir(mode=0o700)
    else:
        output = Path(tempfile.mkdtemp(prefix="floor-mac-validation-", dir=Path.cwd())).resolve()
    runner = Runner(output, args.artifact, args.developer_dir, args.capability_only, args.original_zip)
    code = 0
    try:
        runner.execute()
    except KeyboardInterrupt:
        code = 130
        runner.result["error"] = "Interrupted by user; completed evidence retained"
    except Exception as error:
        code = error.code if isinstance(error, Stop) else 1
        runner.result["error"] = str(error)
        runner.result["stages"][runner.stage] = "blocked" if code == 2 else "failed"
    try:
        return runner.finish(code)
    except Exception as error:
        # Even malformed or incomplete harness JSON must not destroy failure logs.
        runner.result["status"] = "failed"
        runner.result["error"] = "Evidence finalization failed: " + str(error)
        (runner.share/"result.json").write_text(sanitize(json.dumps(runner.result, indent=2), runner.replacements))
        (runner.share/"commands.log").write_text(sanitize(json.dumps(runner.commands, indent=2), runner.replacements))
        print("Evidence finalization failed; local work retained at", output, file=sys.stderr)
        print(sanitize(str(error), runner.replacements), file=sys.stderr)
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Stop as error:
        print(str(error), file=sys.stderr)
        sys.exit(error.code)
