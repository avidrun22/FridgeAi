#!/usr/bin/env python3
"""
Fan out a new blog post to every newsletter subscriber via Resend.

Wraps the `send-post-blast` Supabase Edge Function with a friendly CLI:
  - Validates the post file exists locally before attempting to send.
  - Auto-derives subject from the post's <title> when --subject isn't given.
  - Auto-derives preview text from <meta name="description"> when --preview
    isn't given.
  - Supports --dry-run (renders the email server-side, returns the HTML
    bytes + first 800 chars instead of sending).

Config (~/fridgeai-native/.appstoreconnect/telegram_config.json):
  supabase_url     — same as daily_report uses
  cron_secret      — REQUIRED. The shared secret that protects send-daily-digest
                     and send-post-blast. Same value that's set as CRON_SECRET
                     on Supabase via `supabase secrets set CRON_SECRET=...`.
                     Add this key to telegram_config.json once; it is gitignored
                     alongside the existing tokens.

Usage:
  # Send a real blast for the just-shipped post
  python3 scripts/send_post_blast.py blog/cut-grocery-bill-25-percent.html

  # Override subject/preview (otherwise they're scraped from the post)
  python3 scripts/send_post_blast.py blog/MY-POST.html \\
      --subject "How we cut our grocery bill 25%" \\
      --preview "No coupons, no bulk runs."

  # Dry run — see exactly what the email looks like without sending
  python3 scripts/send_post_blast.py blog/MY-POST.html --dry-run

Exit codes:
  0 — broadcast created and sent
  1 — local config / argument error
  2 — Edge Function returned an error
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
CONFIG_PATH = PROJECT_ROOT / ".appstoreconnect" / "telegram_config.json"


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print(f"missing config at {CONFIG_PATH}", file=sys.stderr)
        sys.exit(1)
    cfg = json.loads(CONFIG_PATH.read_text())
    for key in ("supabase_url", "cron_secret"):
        if not cfg.get(key):
            print(
                f"missing `{key}` in {CONFIG_PATH}\n"
                "Run `supabase secrets list` on the project to find CRON_SECRET, "
                "then add it to telegram_config.json under `cron_secret`.",
                file=sys.stderr,
            )
            sys.exit(1)
    return cfg


# --- Local post inspection --------------------------------------------------

def derive_subject(html: str, fallback: str) -> str:
    """Pull the email subject from <title>, stripping the " — ok2eat" suffix
    we use site-wide so the inbox doesn't show "Title — ok2eat — ok2eat" once
    Resend tacks on the From-name."""
    m = re.search(r"<title>([\s\S]*?)</title>", html, re.IGNORECASE)
    if not m:
        return fallback
    raw = re.sub(r"\s+", " ", m.group(1)).strip()
    raw = re.sub(r"\s+[—–-]\s*ok2eat\s*$", "", raw, flags=re.IGNORECASE)
    return raw or fallback


def derive_preview(html: str, fallback: str) -> str:
    # Backreference \2 ensures the closing quote matches the opening quote, so
    # apostrophes inside double-quoted content (e.g. content="what's...") don't
    # truncate the match prematurely.
    m = re.search(
        r'<meta\s+name=(["\'])description\1\s+content=(["\'])(.*?)\2',
        html,
        re.IGNORECASE | re.DOTALL,
    )
    return m.group(3).strip() if m else fallback


# --- HTTP -------------------------------------------------------------------

def call_edge_function(supabase_url: str, cron_secret: str, payload: dict, timeout: int = 60) -> tuple[int, dict | str]:
    url = supabase_url.rstrip("/") + "/functions/v1/send-post-blast"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type":   "application/json",
            "x-cron-secret":  cron_secret,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            try:
                return resp.status, json.loads(raw or b"{}")
            except json.JSONDecodeError:
                return resp.status, raw.decode(errors="replace")
    except urllib.error.HTTPError as e:
        body = (e.read() or b"").decode(errors="replace")
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body


# --- Main -------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Send a new blog post to every newsletter subscriber.")
    parser.add_argument(
        "post_path",
        help="Repo-relative path to the post, e.g. blog/cut-grocery-bill-25-percent.html",
    )
    parser.add_argument("--subject",  help="Override email subject (default: scraped from <title>)")
    parser.add_argument("--preview",  help="Override preheader text (default: scraped from <meta name=description>)")
    parser.add_argument("--dry-run", action="store_true", help="Render email but don't create or send a Resend broadcast")
    args = parser.parse_args()

    # 1. Validate the post exists locally and derive subject/preview from it.
    post_file = (PROJECT_ROOT / args.post_path).resolve()
    if not post_file.exists():
        print(f"post file not found: {post_file}", file=sys.stderr)
        return 1
    if not post_file.is_relative_to(PROJECT_ROOT / "blog"):
        print(f"post must live under blog/: {post_file}", file=sys.stderr)
        return 1
    html_local = post_file.read_text()

    rel = post_file.relative_to(PROJECT_ROOT).as_posix()
    public_url = f"https://ok2eat.com/{rel}"

    subject = (args.subject or derive_subject(html_local, args.post_path)).strip()
    preview = (args.preview or derive_preview(
        html_local,
        f"{subject} — new on the ok2eat blog.",
    )).strip()

    if not subject:
        print("subject empty — pass --subject explicitly", file=sys.stderr)
        return 1

    # 2. Confirm with the user before firing for real (skip on dry-run).
    print(f"post:    {rel}")
    print(f"public:  {public_url}")
    print(f"subject: {subject}")
    print(f"preview: {preview}")
    print()

    cfg = load_config()

    if not args.dry_run:
        ans = input("Send blast to all newsletter subscribers? [y/N] ").strip().lower()
        if ans not in ("y", "yes"):
            print("aborted.")
            return 1

    # 3. Call the Edge Function.
    payload = {
        "post_url": public_url,
        "subject":  subject,
        "preview":  preview,
        "dry_run":  bool(args.dry_run),
    }
    status, body = call_edge_function(cfg["supabase_url"], cfg["cron_secret"], payload)

    if status >= 400 or (isinstance(body, dict) and body.get("error")):
        print(f"send-post-blast returned {status}", file=sys.stderr)
        print(json.dumps(body, indent=2) if isinstance(body, dict) else body, file=sys.stderr)
        return 2

    if args.dry_run:
        print("dry-run OK")
        if isinstance(body, dict):
            print(f"  audience: {body.get('audience_id')}")
            print(f"  from:     {body.get('from')}")
            print(f"  reply_to: {body.get('reply_to')}")
            print(f"  size:     {body.get('html_bytes')} bytes")
            preview_text = body.get("html_preview", "")
            if preview_text:
                print("\n--- html preview (first 800 chars) ---")
                print(preview_text)
        return 0

    if isinstance(body, dict):
        print(f"✓ broadcast sent")
        print(f"  id:       {body.get('broadcast_id')}")
        print(f"  audience: {body.get('audience_id')}")
        print(f"  name:     {body.get('name')}")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
