"""Local helper regression tests. Synthetic artifacts are never compiler validation."""
from email.utils import formatdate
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch
import urllib.error

import release


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / "repo"
        self.root.mkdir()
        self.work = Path(self.temporary.name) / "work"
        self.work.mkdir()
        self.environment = patch.dict(os.environ, {
            "AIR_RELEASE_VERSION": "", "GITHUB_EVENT_NAME": "push",
            "GITHUB_OUTPUT": str(self.work / "outputs"),
            "GIT_AUTHOR_NAME": "Test", "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Test", "GIT_COMMITTER_EMAIL": "test@example.invalid",
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.git("init", "-q", "-b", "wasm")
        self.config = {"schemaVersion": 1, "emsdkCommit": release.SDK_COMMIT,
                       "emscriptenVersion": "4.0.20", "headerSha256": "test-header"}
        compiler = {f"clang/input-{i}.cpp": f"compiler input {i}\n" for i in range(33)}
        sdk = {f"api/input-{i}.h": f"SDK input {i}\n" for i in range(19)}
        for path, data in compiler.items():
            self.put(path, data.encode())
        for path, data in sdk.items():
            self.put("wasm/" + path, data.encode())
        self.lock = {"compilerFiles": {p: release.digest(d.encode()) for p, d in compiler.items()},
                     "sdkFiles": {p: release.digest(d.encode()) for p, d in sdk.items()}}
        self.put("wasm/source-lock.json", release.encoded(self.lock))
        self.commit()
        # Use a genuine two-parent merge with no historical release anchor.
        self.git("checkout", "-qb", "upstream")
        self.put("upstream.txt", b"upstream change\n")
        self.commit()
        self.git("checkout", "-q", "wasm")
        self.put("wrapper.txt", b"WASM change\n")
        self.commit()
        self.git("merge", "--no-ff", "-qm", "Merge upstream", "upstream")
        self.commit_sha = self.git("rev-parse", "HEAD")
        os.environ["GITHUB_SHA"] = self.commit_sha
        self.root_patch = patch.object(release, "ROOT", self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.repository_patch = patch.object(release, "REPOSITORY", "example/compiler")
        self.repository_patch.start()
        self.addCleanup(self.repository_patch.stop)

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root,
                                       stderr=subprocess.STDOUT).decode().strip()

    def put(self, path, data):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Synthetic fixture")

    def test_merge_uses_actual_commit_tree_and_current_inventory(self):
        identity = release.source_identity(self.config)
        self.assertEqual(len(self.git("show", "-s", "--format=%P").split()), 2)
        self.assertEqual(identity["commit"], self.commit_sha)
        self.assertEqual(identity["tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.assertEqual(identity["version"], "dev-" + self.commit_sha[:12])
        self.assertEqual(len(identity["sourceInputs"]), 52)

    def test_source_digest_mismatch_still_fails(self):
        self.put("clang/input-0.cpp", b"changed after lock\n")
        self.commit()
        os.environ["GITHUB_SHA"] = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(release.ReleaseError, "digest mismatch"):
            release.source_identity(self.config)

    def test_dirty_checkout_still_fails(self):
        self.put("untracked.txt", b"untracked\n")
        with self.assertRaisesRegex(release.ReleaseError, "completely clean"):
            release.source_identity(self.config)

    def test_artifact_preflight_does_not_access_github_releases(self):
        (self.work / "GPL-2.0.txt").write_bytes(b"synthetic license fixture")
        pin = release.descriptor(self.work / "GPL-2.0.txt")
        real_run = subprocess.run

        def run_without_node(args, **kwargs):
            if args[:2] == ["node", "wasm/build.mjs"]:
                return subprocess.CompletedProcess(args, 0)
            return real_run(args, **kwargs)

        with patch.object(release, "GitHub", side_effect=AssertionError("unexpected API access")), \
             patch.object(release, "header_identity", return_value="test-header"), \
             patch.object(release, "NOTICE_PATHS", ()), \
             patch.object(release, "GPL_PIN", pin), \
             patch.object(release.shutil, "disk_usage", return_value=Mock(free=20 * 1024**3)), \
             patch.object(release.os, "sysconf", side_effect=[4096, 4 * 1024**2]), \
             patch.object(release.subprocess, "run", side_effect=run_without_node) as check:
            release.preflight(self.config, self.work)
        check.assert_any_call(["node", "wasm/build.mjs", "check"], cwd=self.root, check=True)
        context = json.loads((self.work / "context.json").read_text())
        self.assertEqual(context["version"], "dev-" + self.commit_sha[:12])

    def test_publish_without_explicit_version_is_rejected_before_any_api_call(self):
        with patch.object(release, "GitHub", side_effect=AssertionError("unexpected API access")):
            with self.assertRaisesRegex(release.ReleaseError, "Artifact-only"):
                release.publish(self.config, self.work)

    def test_release_version_is_explicit_manual_and_safe(self):
        with patch.dict(os.environ, {"AIR_RELEASE_VERSION": "v0.2.0"}):
            with self.assertRaisesRegex(release.ReleaseError, "manual"):
                release.release_version()
            with patch.dict(os.environ, {"GITHUB_EVENT_NAME": "workflow_dispatch"}):
                self.assertEqual(release.source_identity(self.config)["version"], "v0.2.0")
                os.environ["AIR_RELEASE_VERSION"] = "../../old-version"
                with self.assertRaisesRegex(release.ReleaseError, "version tag"):
                    release.release_version()

    def test_existing_tags_and_releases_are_immutable(self):
        api = Mock()
        for existing_commit in (self.commit_sha, "f" * 40):
            api.tag_commit.return_value = existing_commit
            with self.assertRaisesRegex(release.ReleaseError, "tag already exists"):
                release.require_new_release(api, "v0.1.0")
        api.tag_commit.return_value = None
        api.release_by_tag.return_value = {"draft": True}
        with self.assertRaisesRegex(release.ReleaseError, "Release already exists"):
            release.require_new_release(api, "v0.1.0")
        api.release_by_tag.return_value = None
        release.require_new_release(api, "v0.2.0")
        api.request.assert_not_called()

    def test_source_archive_uses_dynamic_version_and_exact_merge_source(self):
        identity = release.source_identity(self.config)
        release.write_json(self.work / "sdk-runtime-inventory.json", {"files": {}})
        archive = self.work / "source.tar.gz"
        notices = {"licenses/GPL-2.0.txt": b"synthetic notice", "licenses/ORIGINS.json": b"{}"}
        release.source_archive(archive, identity, notices, self.work)
        prefix = release.artifact_prefix(identity)
        with tarfile.open(archive) as source:
            self.assertEqual(source.pax_headers["comment"], self.commit_sha)
            self.assertEqual(source.extractfile(prefix + "-source/upstream.txt").read(), b"upstream change\n")
            self.assertEqual(source.extractfile(prefix + "-source/wrapper.txt").read(), b"WASM change\n")
            self.assertIn(prefix + "-sdk-runtime/FILES.json", source.getnames())
            self.assertNotIn("v0.1.0", "\n".join(source.getnames()))

    def test_package_and_publish_use_requested_version_without_overwriting(self):
        # These inert bytes test packaging only, never compile-smoke acceptance.
        os.environ.update(AIR_RELEASE_VERSION="v0.2.0", GITHUB_EVENT_NAME="workflow_dispatch")
        self.put("wasm/api/air_compiler.h", b"synthetic API declaration\n")
        self.put("wasm/api/include/synthetic.h", b"synthetic header\n")
        self.commit()
        os.environ["GITHUB_SHA"] = self.git("rev-parse", "HEAD")
        identity = release.source_identity(self.config)
        dist = self.work / "compiler/api-build-wasm"
        dist.mkdir(parents=True)
        for name in release.OUTPUTS:
            (dist / name).write_bytes(b"inert packaging fixture: " + name.encode())
        receipt = identity | {"files": {name: release.descriptor(dist / name) for name in release.OUTPUTS}}
        release.write_json(self.work / "build-report.json", receipt)
        release.write_json(self.work / "build-inputs.json", identity)
        release.write_json(self.work / "sdk-runtime-inventory.json", {"files": {}})
        notices = {"licenses/GPL-2.0.txt": b"synthetic notice", "licenses/ORIGINS.json": b"{}"}
        source = self.work / "corresponding-source.tar.gz"
        release.source_archive(source, identity, notices, self.work)
        release.write_json(self.work / "source-archive-pin.json", release.descriptor(source))
        with patch.object(release, "notice_members", return_value=notices):
            release.package(self.config, self.work)
        directory = self.work / "release"
        prefix = "air-wasm-v0.2.0"
        self.assertEqual({p.name for p in directory.iterdir()}, {
            prefix + "-runtime.tar.gz", prefix + "-source.tar.gz", prefix + "-build-inputs.json",
            prefix + "-manifest.json", "SHA256SUMS"})
        manifest = json.loads((directory / (prefix + "-manifest.json")).read_text())
        for key in ("version", "commit", "tree", "sourceFingerprintSha256"):
            self.assertEqual(manifest[key], identity[key])
        for line in (directory / "SHA256SUMS").read_text().splitlines():
            checksum, name = line.split("  ")
            self.assertEqual(checksum, release.sha256(directory / name))
        with tarfile.open(directory / (prefix + "-runtime.tar.gz")) as runtime:
            self.assertIn((prefix + "-source/").encode(), runtime.extractfile("README.txt").read())
        api = Mock()
        api.tag_commit.return_value = api.release_by_tag.return_value = None
        with patch.object(release, "GitHub", return_value=api), \
             patch.object(release, "publish_release", return_value={"html_url": "https://example.invalid/release"}) as publish:
            release.publish(self.config, self.work)
            self.assertEqual(publish.call_args.kwargs["tag"], "v0.2.0")
            self.assertEqual(publish.call_args.kwargs["title"], "AIR WASM v0.2.0")
            publish.reset_mock()
            api.tag_commit.return_value = identity["commit"]
            with self.assertRaisesRegex(release.ReleaseError, "tag already exists"):
                release.publish(self.config, self.work)
            publish.assert_not_called()


class NoticeDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.destination = Path(self.temporary.name) / "GPL-2.0.txt"
        self.content = b"synthetic license notice\n"
        self.pin = {"bytes": len(self.content), "sha256": release.digest(self.content)}
        self.opener = Mock()
        pin_patch = patch.object(release, "GPL_PIN", self.pin)
        pin_patch.start()
        self.addCleanup(pin_patch.stop)
        opener_patch = patch.object(release.urllib.request, "build_opener", return_value=self.opener)
        opener_patch.start()
        self.addCleanup(opener_patch.stop)
        sleep_patch = patch.object(release.time, "sleep")
        self.sleep = sleep_patch.start()
        self.addCleanup(sleep_patch.stop)

    def http_error(self, status, retry_after=None):
        headers = {} if retry_after is None else {"Retry-After": retry_after}
        return urllib.error.HTTPError(release.GPL_SOURCE, status, "synthetic failure", headers, None)

    def test_http_429_retry_after_then_success_preserves_hash_check(self):
        self.opener.open.side_effect = [self.http_error(429, "7"), io.BytesIO(self.content)]
        release.download_notice(self.destination)
        release.check_file(self.destination, self.pin)
        self.assertEqual(self.opener.open.call_count, 2)
        self.sleep.assert_called_once_with(7)
        self.assertFalse(self.destination.with_suffix(".txt.partial").exists())

    def test_http_5xx_and_network_failure_use_exponential_backoff(self):
        self.opener.open.side_effect = [self.http_error(503), urllib.error.URLError("temporary network failure"),
                                      TimeoutError("temporary timeout"), io.BytesIO(self.content)]
        release.download_notice(self.destination)
        self.assertEqual([call.args[0] for call in self.sleep.call_args_list], [5, 10, 20])
        release.check_file(self.destination, self.pin)

    def test_retry_after_http_date_and_malformed_value(self):
        with patch.object(release.time, "time", return_value=1_700_000_000):
            self.assertEqual(release.notice_retry_delay(formatdate(1_700_000_012, usegmt=True), 1), 12)
            self.assertEqual(release.notice_retry_delay(formatdate(1_699_999_999, usegmt=True), 1), 0)
        self.assertEqual(release.notice_retry_delay("not a date", 3), 20)
        self.assertEqual(release.notice_retry_delay(None, 4), 30)

    def test_transient_failures_stop_after_five_attempts(self):
        for status in (429, 503):
            with self.subTest(status=status):
                self.opener.open.reset_mock()
                self.sleep.reset_mock()
                self.opener.open.side_effect = [self.http_error(status, "1") for _ in range(5)]
                with self.assertRaisesRegex(release.ReleaseError, "failed after 5 attempts"):
                    release.download_notice(self.destination)
                self.assertEqual(self.opener.open.call_count, 5)
                self.assertEqual(self.sleep.call_count, 4)
                self.assertFalse(self.destination.exists())

    def test_retry_after_beyond_budget_stops_instead_of_retrying_early(self):
        self.opener.open.side_effect = self.http_error(429, "3600")
        with self.assertRaisesRegex(release.ReleaseError, "five-minute budget"):
            release.download_notice(self.destination)
        self.assertEqual(self.opener.open.call_count, 1)
        self.sleep.assert_not_called()

    def test_nontransient_http_errors_are_not_retried(self):
        for status in (302, 403, 404):
            with self.subTest(status=status):
                self.opener.open.reset_mock()
                self.opener.open.side_effect = self.http_error(status)
                with self.assertRaises(urllib.error.HTTPError):
                    release.download_notice(self.destination)
                self.assertEqual(self.opener.open.call_count, 1)
                self.sleep.assert_not_called()

    def test_corrupt_bytes_fail_without_retry(self):
        self.opener.open.return_value = io.BytesIO(b"X" * len(self.content))
        with self.assertRaisesRegex(release.ReleaseError, "SHA-256 mismatch"):
            release.download_notice(self.destination)
        self.assertEqual(self.opener.open.call_count, 1)
        self.sleep.assert_not_called()
        self.assertFalse(self.destination.exists())
        self.assertFalse(self.destination.with_suffix(".txt.partial").exists())

    def test_interrupted_stream_is_cleaned_before_retry(self):
        class Interrupted(io.BytesIO):
            def read(self, size=-1):
                if self.tell():
                    raise ConnectionResetError("synthetic interrupted transfer")
                return super().read(4)

        self.opener.open.side_effect = [Interrupted(self.content), io.BytesIO(self.content)]
        release.download_notice(self.destination)
        self.assertEqual(self.opener.open.call_count, 2)
        self.sleep.assert_called_once_with(5)
        release.check_file(self.destination, self.pin)
        self.assertFalse(self.destination.with_suffix(".txt.partial").exists())


if __name__ == "__main__":
    unittest.main()
