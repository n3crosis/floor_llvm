"""Offline synthetic tests only. These do NOT compile Swift or execute Metal."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("runner", Path(__file__).with_name("run_mac_validation.py"))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def artifact(root):
    root.mkdir()
    manifest = {"schemaVersion": 1, "status": "final", "kind": "fork-built-compiler", "repository": r.REPOSITORY,
                "commit": r.COMMIT, "tree": r.TREE, "binaryBuiltFromNewFork": True, "apiVersion": 2,
                "headerBundleVersion": 2, "headerSha256": r.HEADER, "assets": {}}
    for kind in ("runtime", "correspondingSource", "buildInputs"):
        name = kind + ".bin"
        data = ("synthetic-" + kind).encode()
        (root/name).write_bytes(data)
        manifest["assets"][kind] = {"name": name, "bytes": len(data), "sha256": r.sha(data)}
    (root/"test-manifest.json").write_text(json.dumps(manifest))
    return manifest


def complete_report(root, gpu_status="passed"):
    root.mkdir()
    cases = []
    for c in r.CASES:
        item = {k: c[k] for k in ("name", "ios", "math", "sourceSha256")}
        item.update(appleCompile="passed", appleLink="passed", floorCompile="passed",
                    appleMetallibSha256="a"*64, floorMetallibSha256="f"*64)
        cases.append(item)
        if c["kind"] == "common":
            continue
        d = root/(c["name"] + "-gpu")
        d.mkdir()
        details = {"status": gpu_status, "artifacts": [{"sha256": "a"*64}, {"sha256": "f"*64}],
                   "libraryLoading": {"apple": {"status": "loaded"}, "floor": {"status": "loaded"}},
                   "pipelineCreation": "passed", "execution": "completed", "numericalComparison": "passed", "checkedValues": 23}
        if gpu_status == "unavailable":
            details.update(libraryLoading={"apple": {"status": "rejected"}, "floor": {"status": "rejected"}},
                           pipelineCreation="not_run", execution="not_run", numericalComparison="not_run", checkedValues=0)
        (d/"report.json").write_text(json.dumps(details))
    (root/"report.json").write_text(json.dumps({"cases": cases}))


class ArtifactTests(unittest.TestCase):
    # Test the bounded parser independently. PinnedArtifactTests below exercise
    # the public entry point and its mandatory immutable-ZIP authentication.
    def test_folder_and_wrapped_folder(self):
        for wrapped in (False, True):
            with self.subTest(wrapped=wrapped), tempfile.TemporaryDirectory() as td:
                base = Path(td)
                folder = base/"input"
                folder.mkdir()
                source = folder/"wrapper" if wrapped else folder/"direct"
                expected = artifact(source)
                actual = r._stage_artifact_files(folder, base/"staged")
                self.assertEqual(actual, expected)

    def test_zip_and_wrapped_zip(self):
        for prefix in ("", "artifact/"):
            with self.subTest(prefix=prefix), tempfile.TemporaryDirectory() as td:
                base = Path(td)
                expected = artifact(base/"input")
                with zipfile.ZipFile(base/"a.zip", "w") as archive:
                    for path in (base/"input").iterdir():
                        archive.write(path, prefix + path.name)
                self.assertEqual(r._stage_artifact_files(base/"a.zip", base/"staged"), expected)

    def test_wrong_commit_tree_header_and_status(self):
        for field in ("commit", "tree", "headerSha256", "status", "repository"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as td:
                base = Path(td)
                m = artifact(base/"input")
                m[field] = "wrong"
                (base/"input/test-manifest.json").write_text(json.dumps(m))
                with self.assertRaisesRegex(r.Stop, "Wrong artifact"):
                    r._stage_artifact_files(base/"input", base/"staged")

    def test_tampered_or_missing_asset(self):
        for mode in ("tampered", "missing", "longer"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                base = Path(td)
                artifact(base/"input")
                p = base/"input/runtime.bin"
                if mode == "missing":
                    p.unlink()
                else:
                    p.write_bytes(b"x" * (100 if mode == "longer" else 4))
                with self.assertRaises(r.Stop):
                    r._stage_artifact_files(base/"input", base/"staged")

    def test_zip_slip_and_symlink(self):
        for name, mode in (("../escape", 0), ("/absolute", 0), ("C:/drive", 0), ("link", stat.S_IFLNK)):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as td:
                base = Path(td)
                with zipfile.ZipFile(base/"a.zip", "w") as archive:
                    entry = zipfile.ZipInfo(name)
                    entry.external_attr = mode << 16
                    archive.writestr(entry, b"target")
                with self.assertRaises(r.Stop):
                    r._stage_artifact_files(base/"a.zip", base/"staged")
                self.assertFalse((base/"escape").exists())

    def test_symlink_folder_asset(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            artifact(base/"input")
            p = base/"input/runtime.bin"
            p.unlink()
            p.symlink_to("buildInputs.bin")
            with self.assertRaises(r.Stop):
                r._stage_artifact_files(base/"input", base/"staged")

    def test_missing_artifact_blocks(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(r.Stop) as raised:
                r._stage_artifact_files(Path(td)/"pending.zip", Path(td)/"stage")
            self.assertEqual(raised.exception.code, 2)


class PinnedArtifactTests(unittest.TestCase):
    def zip_fixture(self, base):
        m = artifact(base/"input")
        path = base/"original.zip"
        with zipfile.ZipFile(path, "w") as archive:
            for item in (base/"input").iterdir():
                archive.write(item, item.name)
        return m, path

    def pins(self, path):
        return patch.multiple(r, ARTIFACT_ZIP_BYTES=path.stat().st_size, ARTIFACT_ZIP_SHA256=r.file_hash(path))

    def test_real_download_pin_is_recorded_exactly(self):
        self.assertEqual(r.ARTIFACT_ID, "13752442598")
        self.assertEqual(r.ARTIFACT_ZIP_BYTES, 186234725)
        self.assertEqual(r.ARTIFACT_ZIP_SHA256, "05b9ff737b04de5cbfa7ae1cfe235d1c14aafa1b5be2ef64250286b98adf30f4")

    def test_pinned_zip_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            m, path = self.zip_fixture(base)
            with self.pins(path):
                self.assertEqual(r.stage_artifact(path, base/"stage"), m)

    def test_zip_wrong_size_rejected_before_parsing(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            _, path = self.zip_fixture(base)
            with self.pins(path), patch.object(r.zipfile, "ZipFile", side_effect=AssertionError("must not parse")):
                path.write_bytes(path.read_bytes() + b"x")
                with self.assertRaisesRegex(r.Stop, "ZIP size differs"):
                    r.stage_artifact(path, base/"stage")

    def test_same_size_zip_tampering_rejected_before_parsing(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            _, path = self.zip_fixture(base)
            with self.pins(path), patch.object(r.zipfile, "ZipFile", side_effect=AssertionError("must not parse")):
                data = bytearray(path.read_bytes())
                data[-1] ^= 1
                path.write_bytes(data)
                with self.assertRaisesRegex(r.Stop, "ZIP SHA-256 differs"):
                    r.stage_artifact(path, base/"stage")

    def test_folder_requires_original_zip(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            artifact(base/"input")
            with self.assertRaisesRegex(r.Stop, "requires --original-zip") as error:
                r.stage_artifact(base/"input", base/"stage")
            self.assertEqual(error.exception.code, 2)

    def test_folder_bound_to_original_zip(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            m, path = self.zip_fixture(base)
            with self.pins(path):
                self.assertEqual(r.stage_artifact(base/"input", base/"stage", path), m)

    def test_self_consistent_folder_forgery_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            m, path = self.zip_fixture(base)
            changed = b"forged-runtime"
            (base/"input/runtime.bin").write_bytes(changed)
            m["assets"]["runtime"].update(bytes=len(changed), sha256=r.sha(changed))
            (base/"input/test-manifest.json").write_text(json.dumps(m))
            with self.pins(path), self.assertRaisesRegex(r.Stop, "manifest differs from the pinned original ZIP"):
                r.stage_artifact(base/"input", base/"stage", path)

    def test_folder_asset_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            _, path = self.zip_fixture(base)
            (base/"input/runtime.bin").write_bytes(b"corrupt")
            with self.pins(path), self.assertRaisesRegex(r.Stop, "Artifact hash mismatch"):
                r.stage_artifact(base/"input", base/"stage", path)

    def test_mismatching_original_zip_does_not_authenticate_folder(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            _, path = self.zip_fixture(base)
            with self.pins(path):
                data = bytearray(path.read_bytes())
                data[-1] ^= 1
                path.write_bytes(data)
                with self.assertRaisesRegex(r.Stop, "ZIP SHA-256 differs"):
                    r.stage_artifact(base/"input", base/"stage", path)


class MatrixTests(unittest.TestCase):
    def test_no_report_never_passes(self):
        with tempfile.TemporaryDirectory() as td:
            matrix = r.build_matrix(Path(td))
            self.assertEqual(len(matrix["cases"]), 34)
            self.assertEqual(matrix["totals"]["appleCompile"], {"not_run": 34})
            self.assertEqual(matrix["totals"]["gpuStatus"], {"not_run": 12, "not_in_scope": 22})

    def test_complete_bounded_pass_and_dialect(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)/"report"
            complete_report(root)
            matrix = r.build_matrix(root)
            self.assertEqual(matrix["totals"]["gpuStatus"], {"passed": 12, "not_in_scope": 22})
            self.assertTrue(all(c["floorDialect"] == "metal3.2" for c in matrix["cases"]))
            self.assertEqual({c["appleDialect"] for c in matrix["cases"]}, {"metal3.2", "metal4.0"})

    def test_apple_rejection_is_unavailable(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)/"report"
            complete_report(root, "unavailable")
            matrix = r.build_matrix(root)
            self.assertEqual(matrix["totals"]["gpuStatus"]["unavailable"], 12)
            self.assertNotIn("passed", matrix["totals"]["numericalComparison"])

    def test_apple_load_floor_rejection_is_failure(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)/"report"
            complete_report(root, "unavailable")
            p = root/"case-0-gpu/report.json"
            d = json.loads(p.read_text())
            d["libraryLoading"]["apple"]["status"] = "loaded"
            p.write_text(json.dumps(d))
            self.assertEqual(r.build_matrix(root)["cases"][0]["gpuStatus"], "failed")

    def test_false_gpu_pass_and_wrong_hash_rejected(self):
        for field in ("checkedValues", "pipelineCreation", "artifacts"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as td:
                root = Path(td)/"report"
                complete_report(root)
                p = root/"case-0-gpu/report.json"
                d = json.loads(p.read_text())
                d[field] = 0 if field == "checkedValues" else "failed" if field == "pipelineCreation" else []
                p.write_text(json.dumps(d))
                with self.assertRaises(r.Stop):
                    r.build_matrix(root)

    def test_wrong_case_identity_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)/"report"
            complete_report(root)
            p = root/"report.json"
            d = json.loads(p.read_text())
            d["cases"][0]["ios"] = 99
            p.write_text(json.dumps(d))
            with self.assertRaises(r.Stop):
                r.build_matrix(root)


class RunnerTests(unittest.TestCase):
    def test_no_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td)/"existing"
            p.mkdir()
            (p/"precious").write_text("unchanged")
            with self.assertRaises(r.Stop):
                r.main(["--artifact", "absent", "--output", str(p)])
            self.assertEqual((p/"precious").read_text(), "unchanged")

    def test_missing_artifact_keeps_evidence(self):
        with tempfile.TemporaryDirectory() as td, patch("sys.stdout", new=io.StringIO()):
            p = Path(td)/"output"
            self.assertEqual(r.main(["--artifact", str(Path(td)/"absent"), "--output", str(p)]), 2)
            self.assertTrue((p/"evidence.zip").is_file())
            result = json.loads((p/"share/result.json").read_text())
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["layers"]["appleCompile"], {"not_run": 34})

    def test_no_mac_claim_on_linux(self):
        with tempfile.TemporaryDirectory() as td, patch("sys.platform", "linux"):
            base = Path(td)
            runner = r.Runner(base, base/"artifact")
            with self.assertRaises(r.Stop) as raised:
                runner.prerequisites()
            self.assertEqual(raised.exception.code, 2)
            self.assertEqual(runner.commands, [])

    def test_privacy_redaction(self):
        text = '/Users/alice/private /home/bob/private ghp_abcdef123 authorization: Bearer secret /tmp/output/file'
        redacted = r.sanitize(text, [("/tmp/output", "<RUN>")])
        for private in ("alice", "bob", "abcdef123", "secret", "/tmp/output"):
            self.assertNotIn(private, redacted)

    def test_finish_partial_unavailable_pass_and_failure(self):
        for status, expected in (("passed", 0), ("unavailable", 77), ("failed", 1)):
            with self.subTest(status=status), tempfile.TemporaryDirectory() as td, patch("sys.stdout", new=io.StringIO()):
                base = Path(td)
                runner = r.Runner(base, base/"artifact")
                complete_report(runner.work/"apple-reference", status)
                self.assertEqual(runner.finish(0), expected)
                self.assertTrue((base/"evidence.zip").is_file())
                with zipfile.ZipFile(base/"evidence.zip") as archive:
                    self.assertIn("validation-matrix.json", archive.namelist())
                    self.assertFalse(any(".git" in n for n in archive.namelist()))

    def test_malformed_report_still_packages_failure(self):
        with tempfile.TemporaryDirectory() as td, patch("sys.stdout", new=io.StringIO()):
            base = Path(td)
            runner = r.Runner(base, base/"artifact")
            (runner.work/"apple-reference").mkdir()
            (runner.work/"apple-reference/report.json").write_text("broken json")
            self.assertEqual(runner.finish(0), 1)
            self.assertTrue((base/"evidence.zip").is_file())

    def test_timeout_kills_group_and_records_command(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            runner = r.Runner(base, base/"artifact")
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run(["python3", "-c", "import time; time.sleep(10)"], timeout=0.05)
            self.assertTrue(runner.commands[-1]["interruptedOrTimedOut"])

    def test_output_budget_is_enforced(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            runner = r.Runner(base, base/"artifact")
            runner.OUTPUT_LIMIT = 1024
            with self.assertRaises(r.Stop):
                runner.run(["python3", "-c", "print('x' * 10000)"], check=False)
            self.assertLessEqual(len(runner.commands[-1]["stdout"]), 1024)
            self.assertTrue(runner.commands[-1]["outputTruncated"])

    def test_capability_only_states_and_flags(self):
        for mode, expected in (("accepted", 0), ("unsupported", 77), ("rejected", 1), ("link_failed", 1)):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td, patch("sys.stdout", new=io.StringIO()):
                base = Path(td)
                runner = r.Runner(base, None, capability_only=True)
                runner.result["host"] = {"iPhoneOSSDK": "26.0", "metal": "synthetic compiler version"}
                commands = []
                def run(args, **kwargs):
                    commands.append([str(a) for a in args])
                    if "metal" in args:
                        if mode == "unsupported":
                            return (1, "", "error: invalid value 'metal4.1' in '-std=metal4.1'")
                        if mode == "rejected":
                            return (1, "", "unexpected compiler failure")
                        Path(args[-1]).write_bytes(b"synthetic AIR")
                        return (0, "accepted", "")
                    if mode == "link_failed":
                        return (1, "", "link error")
                    Path(args[-1]).write_bytes(b"MTLBsynthetic")
                    return (0, "", "")
                with patch.object(runner, "run", side_effect=run):
                    runner.metal41_probe()
                self.assertIn("air64-apple-ios27.0", commands[0])
                self.assertIn("-std=metal4.1", commands[0])
                self.assertFalse(runner.result["appleMetal41Capability"]["sdkAtLeast27"])
                self.assertEqual(runner.finish(0), expected)
                self.assertEqual(runner.result["layers"]["floorCompile"], {"not_run": 34})
                self.assertTrue((base/"evidence.zip").is_file())

    def test_binary_privacy_and_float_evidence(self):
        with tempfile.TemporaryDirectory() as td, patch("sys.stdout", new=io.StringIO()):
            base = Path(td)
            runner = r.Runner(base, base/"artifact")
            root = runner.work/"apple-reference"
            root.mkdir()
            (root/"private.air").write_bytes(b"path /Users/private/source")
            (root/"output.f32le").write_bytes(b"\0" * 16)
            runner.finish(2)
            with zipfile.ZipFile(base/"evidence.zip") as archive:
                self.assertFalse(any(name.endswith(".air") for name in archive.namelist()))
                self.assertTrue(any(name.endswith(".f32le") for name in archive.namelist()))
                inventory = json.loads(archive.read("evidence-inventory.json"))
                self.assertTrue(any(x.get("omitted") and x["file"].endswith(".air") for x in inventory))

    def test_real_local_sparse_checkout_without_network(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)
            local = base/"local"
            local.mkdir()
            def git(*args):
                return subprocess.check_output(["git", "-C", str(local), *args], stderr=subprocess.DEVNULL, text=True).strip()
            git("init", "--template=")
            files = {"clang/a.cpp": b"locked compiler", "wasm/api/header": b"header", "wasm/release/harness": b"harness",
                     ".github/workflows/release-air-wasm.yml": b"workflow", "llvm/unneeded.cpp": b"do not check out"}
            for name, data in files.items():
                p = local/name
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
            lock = {"compilerFiles": {"clang/a.cpp": r.sha(files["clang/a.cpp"])}, "sdkFiles": {"api/header": r.sha(files["wasm/api/header"])}}
            (local/"wasm/source-lock.json").write_text(json.dumps(lock))
            git("add", ".")
            git("-c", "user.name=Synthetic Test", "-c", "user.email=test@example.invalid", "commit", "-m", "synthetic")
            output = base/"output"
            output.mkdir()
            runner = r.Runner(output, base/"artifact")
            real_run = runner.run
            def run(args, **kwargs):
                args = [str(a) for a in args]
                args = [str(local) if a == f"https://github.com/{r.REPOSITORY}.git" else a for a in args]
                return real_run(args, **kwargs)
            with patch.object(runner, "run", side_effect=run), patch.object(r, "COMMIT", git("rev-parse", "HEAD")), \
                 patch.object(r, "TREE", git("rev-parse", "HEAD^{tree}")), patch.object(r, "HARNESS_PINS", {}):
                checkout, inputs = runner.checkout()
            self.assertTrue((checkout/"clang/a.cpp").is_file())
            self.assertFalse((checkout/"llvm/unneeded.cpp").exists())
            self.assertTrue((checkout/"wasm/release/harness").is_file())
            self.assertEqual(len(inputs), 2)


if __name__ == "__main__":
    unittest.main()
