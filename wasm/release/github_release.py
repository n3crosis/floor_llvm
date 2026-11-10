#!/usr/bin/env python3
"""Small fail-closed GitHub release publisher. Never replaces tags or assets.

Only the current repository's ephemeral GITHUB_TOKEN is used. Download redirects
are followed without Authorization, and no credential is persisted or printed.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request


class ReleaseError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require(urllib.parse.urlparse(newurl).scheme == "https", "Non-HTTPS download redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_file(path, expected):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), f"Not a regular file: {path}")
    require(path.stat().st_size == expected["bytes"], f"Size mismatch: {path.name}")
    require(sha256(path) == expected["sha256"], f"SHA-256 mismatch: {path.name}")


def descriptor(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Release assets must be regular, non-symlink files")
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", path.name), "Unsafe asset name")
    return {"name": path.name, "bytes": path.stat().st_size, "sha256": sha256(path)}


def stream_download(response, destination, expected):
    destination = Path(destination)
    temporary = destination.with_suffix(destination.suffix + ".partial")
    size = 0
    try:
        with temporary.open("wb") as output:
            while block := response.read(1024 * 1024):
                size += len(block)
                require(size <= expected["bytes"], "Download exceeded pinned size")
                output.write(block)
        check_file(temporary, expected)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)



class GitHub:
    def __init__(self, repository):
        require(repository == os.environ.get("GITHUB_REPOSITORY"), "Token may only access the current workflow repository")
        require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository), "Invalid repository")
        token = os.environ.get("GITHUB_TOKEN", "")
        require(bool(token), "GITHUB_TOKEN is required")
        self.repository = repository
        self.base = f"https://api.github.com/repos/{repository}"
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "air-wasm-release/1"}
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, path, *, method="GET", data=None, missing=False):
        url = self.base + path
        payload = None if data is None else json.dumps(data).encode()
        headers = self.headers | {"Content-Type": "application/json"}
        try:
            with self.opener.open(urllib.request.Request(url, payload, headers, method=method), timeout=180) as response:
                body = response.read()
                return json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            if missing and exc.code == 404:
                return None
            raise ReleaseError(f"GitHub {method} {path}: HTTP {exc.code}; reconcile state before retrying") from None
        except urllib.error.URLError:
            raise ReleaseError(f"GitHub {method} {path}: connection outcome uncertain; reconcile before retrying") from None

    def download_api(self, path, destination, expected):
        """Authenticated API hop only. Signed storage redirect is anonymous."""
        req = urllib.request.Request(self.base + path, headers=self.headers | {"Accept": "application/octet-stream"})
        try:
            response = self.opener.open(req, timeout=180)
        except urllib.error.HTTPError as exc:
            require(exc.code in (301, 302, 303, 307, 308), f"Artifact/asset download failed: HTTP {exc.code}")
            location = exc.headers.get("Location", "")
            parsed = urllib.parse.urlparse(location)
            require(parsed.scheme == "https" and not parsed.username and not parsed.password, "Unsafe signed download redirect")
            # The signed URL is returned by api.github.com and never logged.
            response = urllib.request.build_opener(HTTPSRedirect()).open(urllib.request.Request(location, headers={"User-Agent": "air-wasm-release/1"}), timeout=180)
        with response:
            require(urllib.parse.urlparse(response.url).scheme == "https", "Insecure asset redirect")
            stream_download(response, destination, expected)

    def tag_commit(self, tag):
        ref = self.request("/git/ref/tags/" + urllib.parse.quote(tag, safe=""), missing=True)
        if ref is None:
            return None
        obj = ref["object"]
        for _ in range(4):
            if obj["type"] == "commit":
                return obj["sha"]
            require(obj["type"] == "tag", "Release ref is not a commit or annotated tag")
            obj = self.request("/git/tags/" + obj["sha"])["object"]
        raise ReleaseError("Excessively nested annotated tag")

    def assets(self, release_id):
        output = []
        for page in range(1, 11):
            batch = self.request(f"/releases/{release_id}/assets?per_page=100&page={page}")
            output.extend(batch)
            if len(batch) < 100:
                return output
        raise ReleaseError("Unexpectedly many release assets")

    def release_by_tag(self, tag):
        # The tag endpoint documents published releases. Authenticated listing
        # also includes drafts, which is necessary to resume an interrupted upload.
        for page in range(1, 11):
            batch = self.request(f"/releases?per_page=100&page={page}")
            matches = [item for item in batch if item["tag_name"] == tag]
            require(len(matches) <= 1, "Duplicate releases for one tag")
            if matches:
                return matches[0]
            if len(batch) < 100:
                return None
        raise ReleaseError("Release lookup exceeded safe pagination limit")

    def check_remote_asset(self, asset, expected, directory):
        require(asset["state"] == "uploaded", f"Incomplete asset {asset['name']}; manual reconciliation required")
        require(asset["size"] == expected["bytes"], f"Existing asset size differs: {asset['name']}")
        digest = asset.get("digest")
        if digest is not None:
            require(digest == "sha256:" + expected["sha256"], f"Existing asset digest differs: {asset['name']}")
        # Download and hash even if the API digest is present. No overwritten bytes.
        target = Path(directory) / ("verified-" + expected["name"])
        self.download_api(f"/releases/assets/{asset['id']}", target, expected)
        target.unlink()

    def upload(self, release_id, path):
        path = Path(path)
        url = f"https://uploads.github.com/repos/{self.repository}/releases/{release_id}/assets?name={urllib.parse.quote(path.name, safe='')}"
        headers = self.headers | {"Content-Type": "application/octet-stream", "Content-Length": str(path.stat().st_size)}
        try:
            with path.open("rb") as payload:
                with self.opener.open(urllib.request.Request(url, payload, headers, method="POST"), timeout=600) as response:
                    return json.load(response)
        except urllib.error.HTTPError as exc:
            raise ReleaseError(f"Upload {path.name}: HTTP {exc.code}; no automatic overwrite or retry") from None
        except urllib.error.URLError:
            raise ReleaseError(f"Upload {path.name}: connection outcome uncertain; reconcile before retrying") from None


def publish_release(api, *, tag, commit, title, body, paths, directory):
    """Create draft, check each upload, then publish. Retry accepts identical bytes only."""
    require(re.fullmatch(r"[0-9a-f]{40}", commit), "Full release source commit required")
    require(re.fullmatch(r"[A-Za-z0-9._/-]+", tag), "Invalid release tag")
    expected = {p.name: descriptor(p) for p in map(Path, paths)}
    require(len(expected) == len(paths), "Duplicate local release assets")
    existing_tag = api.tag_commit(tag)
    require(existing_tag in (None, commit), "Existing tag targets another commit; refusing to move it")
    release = api.release_by_tag(tag)
    if release is not None:
        require(existing_tag == commit, "Existing release has no exact matching tag")
        require(release["name"] == title and release["body"] == body and release["prerelease"] is True, "Existing release metadata differs")
        present = api.assets(release["id"])
        names = [a["name"] for a in present]
        require(len(names) == len(set(names)) and set(names) <= set(expected), "Unexpected existing release assets")
        for asset in present:
            api.check_remote_asset(asset, expected[asset["name"]], directory)
        if not release["draft"]:
            require(set(names) == set(expected), "Published release is incomplete; refusing to modify it")
            print("Already published with byte-identical assets: " + release["html_url"])
            return release
    # No write occurs until all local files and any remote collisions are checked.
    if existing_tag is None:
        api.request("/git/refs", method="POST", data={"ref": "refs/tags/" + tag, "sha": commit})
    require(api.tag_commit(tag) == commit, "Tag changed before publication")
    if release is None:
        release = api.request("/releases", method="POST", data={"tag_name": tag, "target_commitish": commit, "name": title,
                              "body": body, "draft": True, "prerelease": True, "make_latest": "false", "generate_release_notes": False})
    present = {a["name"]: a for a in api.assets(release["id"])}
    for path in map(Path, paths):
        if path.name not in present:
            asset = api.upload(release["id"], path)
            api.check_remote_asset(asset, expected[path.name], directory)
    final_assets = api.assets(release["id"])
    require({a["name"] for a in final_assets} == set(expected) and len(final_assets) == len(expected), "Release asset set changed")
    for asset in final_assets:
        require(asset["state"] == "uploaded" and asset["size"] == expected[asset["name"]]["bytes"], "Incomplete upload")
        if asset.get("digest") is not None:
            require(asset["digest"] == "sha256:" + expected[asset["name"]]["sha256"], "Uploaded digest changed")
        # An asset could have appeared after the initial draft inventory. Never
        # publish it merely because its name/size matches and digest is absent.
        api.check_remote_asset(asset, expected[asset["name"]], directory)
    require(api.tag_commit(tag) == commit, "Tag changed before publishing draft")
    api.request(f"/releases/{release['id']}", method="PATCH", data={"draft": False, "prerelease": True, "make_latest": "false"})
    final = api.request(f"/releases/{release['id']}")
    require(final["draft"] is False and final["prerelease"] is True and final["tag_name"] == tag, "Publication result is uncertain")
    print("Published prerelease: " + final["html_url"])
    return final
