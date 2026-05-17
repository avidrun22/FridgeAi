#!/usr/bin/env python3
"""
Deploy ok2eat.com to Netlify via the API.

Reads ok2eat.html (rendered as /index.html) plus everything under blog/, join/,
privacy/, and a few well-known root files (security.txt,
apple-app-site-association, _headers, _redirects, sitemap.xml, robots.txt).
POSTs to Netlify's digest-deploy endpoint and prints the public URL when ready.

Adding a new root-level file? Append it to ASSETS below — auto-include only
covers files inside blog/, join/, privacy/ directories, not the repo root.

Config:
  Reads `netlify_token` and `netlify_site_name` from
  `~/fridgeai-native/.appstoreconnect/telegram_config.json`. That directory is
  gitignored on purpose — it holds bot tokens and the Apple API key. This
  script lives in `scripts/` so it can be versioned alongside the repo, but
  it still resolves config from the gitignored sibling dir for secrets.

Usage:
  python3 scripts/deploy_website.py
  python3 scripts/deploy_website.py --message "v1.1.0 marketing copy"

Exit codes:
  0 = deployed successfully
  1 = config or required-asset error
  2 = upload or network error
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
# Secrets stay in the gitignored dir. The script (which is now versioned)
# reaches into that dir at runtime to grab the Netlify token + site name.
CONFIG_PATH = PROJECT_ROOT / ".appstoreconnect" / "telegram_config.json"
SOURCE_HTML = PROJECT_ROOT / "ok2eat.html"
API_BASE = "https://api.netlify.com/api/v1"

# (public_path, local_path, required) — public_path is the URL path on Netlify.
# If `required` is True and the file is missing, deploy aborts. Otherwise it's
# silently skipped.
ASSETS: list[tuple[str, Path, bool]] = [
    ("/index.html", PROJECT_ROOT / "ok2eat.html", True),
    # v1.22 — Qualifier quiz. 3-question funnel into a persona-tailored
    # landing state. Promoted from the hero CTA. PostHog events fire on
    # every answer so we learn what visitors actually want.
    ("/quiz.html", PROJECT_ROOT / "quiz.html", False),
    ("/.well-known/security.txt", PROJECT_ROOT / ".well-known" / "security.txt", False),
    # v1.1.0 — Universal Links. Apple expects this file at
    # /.well-known/apple-app-site-association with Content-Type: application/json.
    # The Content-Type override is in the repo-root _headers file (Netlify reads
    # that for any file deployed from this script).
    ("/.well-known/apple-app-site-association", PROJECT_ROOT / ".well-known" / "apple-app-site-association", False),
    ("/_headers", PROJECT_ROOT / "_headers", False),
    ("/_redirects", PROJECT_ROOT / "_redirects", False),
    # SEO discovery files at the site root. Sitemap is referenced from
    # robots.txt and submitted to Search Console; future blog posts get
    # auto-discovered when sitemap.xml's lastmod is updated and re-deployed.
    ("/sitemap.xml", PROJECT_ROOT / "sitemap.xml", False),
    ("/robots.txt", PROJECT_ROOT / "robots.txt", False),
    # v1.16 — PNG favicons at the site root. Google Search ignores inline
    # data:image/svg+xml favicons (only shows a generic globe), so we ship
    # real PNG files. Multiple sizes for proper Apple home-screen + Android
    # PWA + Google Search compliance.
    ("/favicon.png", PROJECT_ROOT / "favicon.png", False),
    ("/icon-192.png", PROJECT_ROOT / "icon-192.png", False),
    ("/icon-512.png", PROJECT_ROOT / "icon-512.png", False),
    ("/apple-touch-icon.png", PROJECT_ROOT / "apple-touch-icon.png", False),
]

# Auto-include every file under these top-level directories (recursively).
# Public path mirrors the repo path one-to-one — blog/styles.css → /blog/styles.css,
# join/index.html → /join/index.html, etc. New files in any of these dirs get
# picked up on the next deploy automatically.
#
# `excludes` are path components that skip auto-include (drafts in blog/ stay
# local-only; __pycache__ keeps Python noise out of production).
_AUTO_INCLUDE_DIRS = ["blog", "join", "privacy", "shelf-life", "assets", "scan", "lists", "recipes", "for-business"]
_EXCLUDED_PARTS = {"drafts", "__pycache__"}

for _top in _AUTO_INCLUDE_DIRS:
    _dir = PROJECT_ROOT / _top
    if not _dir.is_dir():
        continue
    for _f in sorted(_dir.rglob("*")):
        if not _f.is_file():
            continue
        if _f.name.startswith("."):
            continue
        if _EXCLUDED_PARTS & set(_f.parts):
            continue
        _rel = _f.relative_to(PROJECT_ROOT).as_posix()
        ASSETS.append((f"/{_rel}", _f, False))


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print(
            f"missing config at {CONFIG_PATH}\n"
            "Expected `.appstoreconnect/telegram_config.json` with `netlify_token` "
            "and `netlify_site_name` keys. That directory is gitignored — secrets "
            "live locally only.",
            file=sys.stderr,
        )
        sys.exit(1)
    cfg = json.loads(CONFIG_PATH.read_text())
    for key in ("netlify_token", "netlify_site_name"):
        if not cfg.get(key):
            print(f"missing {key} in {CONFIG_PATH}", file=sys.stderr)
            sys.exit(1)
    return cfg


def request(method: str, url: str, token: str, body=None, headers=None, timeout=30, max_retries=6):
    """HTTP request with retry on 429 (rate-limit) and 5xx.

    Netlify's per-deploy file upload endpoint rate-limits when many uploads
    arrive at once; once parallelized to 16 workers we'd see HTTP 429 mid-deploy.
    Honor the `Retry-After` header when present, otherwise exponential backoff
    with jitter. Caps at ~6 retries (~60s total worst case per request).
    """
    import random
    req_headers = {"Authorization": f"Bearer {token}"}
    if headers:
        req_headers.update(headers)
    data = None
    if body is not None and isinstance(body, (dict, list)):
        data = json.dumps(body).encode()
        req_headers.setdefault("Content-Type", "application/json")
    elif body is not None:
        data = body
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)

    last_err = None
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                ct = resp.headers.get("Content-Type", "")
                if "json" in ct:
                    return json.loads(raw or b"{}")
                return raw
        except urllib.error.HTTPError as e:
            # 429 = rate limited, 5xx = transient. Anything else: fail fast.
            if e.code == 429 or 500 <= e.code < 600:
                retry_after = e.headers.get("Retry-After")
                if retry_after:
                    try:
                        wait = float(retry_after)
                    except ValueError:
                        wait = 2.0
                else:
                    wait = min(30.0, (2 ** attempt) + random.uniform(0, 1))
                last_err = f"HTTP {e.code} (attempt {attempt + 1}/{max_retries}) — waiting {wait:.1f}s"
                time.sleep(wait)
                continue
            body_preview = (e.read() or b"").decode(errors="replace")[:500]
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {body_preview}")
        except (urllib.error.URLError, TimeoutError) as e:
            # network blips — retry too
            wait = min(15.0, (2 ** attempt) + random.uniform(0, 1))
            last_err = f"{type(e).__name__}: {e} (attempt {attempt + 1}/{max_retries}) — waiting {wait:.1f}s"
            time.sleep(wait)
            continue
    raise RuntimeError(f"exhausted retries on {method} {url}: {last_err}")


def find_site_id(token: str, site_name: str) -> str:
    url = f"{API_BASE}/sites?name={site_name}"
    sites = request("GET", url, token)
    if not isinstance(sites, list) or not sites:
        raise RuntimeError(f"site '{site_name}' not found")
    # name field is the subdomain prefix; match exactly
    for s in sites:
        if s.get("name") == site_name:
            return s["id"]
    return sites[0]["id"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--message", default="cli deploy")
    args = parser.parse_args()

    cfg = load_config()
    token = cfg["netlify_token"]
    site_name = cfg["netlify_site_name"]

    # 1. Resolve site ID
    try:
        site_id = find_site_id(token, site_name)
    except Exception as e:
        print(f"site lookup failed: {e}", file=sys.stderr)
        return 2

    # 2. Read each asset, hash it (SHA1 — what Netlify expects), and build the
    #    manifest. We keep the bytes around keyed by sha1 so we can upload later.
    files_manifest: dict[str, str] = {}
    bytes_by_sha: dict[str, bytes] = {}
    path_by_sha: dict[str, str] = {}
    for public_path, local_path, required_asset in ASSETS:
        if not local_path.exists():
            if required_asset:
                print(f"required asset not found: {local_path}", file=sys.stderr)
                return 1
            print(f"skipping optional asset (not found): {local_path}", file=sys.stderr)
            continue
        body = local_path.read_bytes()
        sha1 = hashlib.sha1(body).hexdigest()
        files_manifest[public_path] = sha1
        bytes_by_sha[sha1] = body
        path_by_sha[sha1] = public_path

    if not files_manifest:
        print("no assets to deploy", file=sys.stderr)
        return 1

    # 3. Create a new deploy with the files manifest
    try:
        deploy = request(
            "POST",
            f"{API_BASE}/sites/{site_id}/deploys",
            token,
            body={"files": files_manifest, "title": args.message},
        )
    except Exception as e:
        print(f"deploy create failed: {e}", file=sys.stderr)
        return 2

    deploy_id = deploy["id"]
    required = deploy.get("required", [])

    # 4. Upload each file Netlify says it needs. Public path already starts
    #    with "/", so the upload URL composes cleanly. Uploads run in parallel
    #    because /shelf-life/ alone is 660 files — sequential PUTs blew past
    #    the 3-min Telegram timeout. 6 workers + per-request 429 backoff keeps
    #    us under Netlify's burst rate-limit while staying well under 1 min
    #    total even on a worst-case full re-upload.
    upload_targets = [(sha1, path_by_sha[sha1]) for sha1 in required if sha1 in bytes_by_sha]
    if upload_targets:
        print(f"uploading {len(upload_targets)} files in parallel...", file=sys.stderr)
        completed = [0]

        def _put(sha_path):
            sha1, public_path = sha_path
            request(
                "PUT",
                f"{API_BASE}/deploys/{deploy_id}/files{public_path}",
                token,
                body=bytes_by_sha[sha1],
                headers={"Content-Type": "application/octet-stream"},
            )
            completed[0] += 1
            # Light progress every 50 files so the run isn't silent for ~30s.
            if completed[0] % 50 == 0:
                print(f"  ...{completed[0]}/{len(upload_targets)} uploaded", file=sys.stderr)
            return public_path

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                # Use map() to surface the first exception if any upload fails.
                for _ in pool.map(_put, upload_targets):
                    pass
        except Exception as e:
            print(f"file upload failed: {e}", file=sys.stderr)
            return 2
        print(f"  ...{completed[0]}/{len(upload_targets)} uploaded", file=sys.stderr)

    # 5. Poll until ready (typically <10 sec for a single static file)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            d = request("GET", f"{API_BASE}/deploys/{deploy_id}", token)
        except Exception as e:
            print(f"poll failed: {e}", file=sys.stderr)
            return 2
        state = d.get("state")
        if state == "ready":
            url = d.get("ssl_url") or d.get("url") or d.get("deploy_ssl_url")
            print(f"deployed: {url}")
            return 0
        if state in ("error", "rejected"):
            print(f"deploy ended in state '{state}': {d.get('error_message','')}", file=sys.stderr)
            return 2
        time.sleep(2)

    print("timed out waiting for deploy to become ready", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
