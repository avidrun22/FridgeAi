#!/usr/bin/env python3
"""
Power-users + audience report — finds who to ask for feedback.

Three lists, one report:
  1. TOP APP USERS by activity (last 30d) — pulled from PostHog. High-intent
     events only (item_added_*, recipe_saved, scan_receipt, shopping_list_*,
     web_app_scan_completed). Ranked by total count.
  2. NEWSLETTER SUBSCRIBERS not in auth.users — the warm-but-unconverted
     list. Cross-references Resend newsletter audience against Supabase
     auth.users.
  3. ANDROID WAITLIST — everyone who asked to be notified when Android ships.

Outputs marketing/power_users_report_{YYYY-MM-DD}.md.

Reads creds from .appstoreconnect/telegram_config.json (same pattern as the
other Python scripts).

Usage:
  python3 scripts/power_users_report.py
  python3 scripts/power_users_report.py --days 14   # different window
  python3 scripts/power_users_report.py --top 50    # show more rows
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
CONFIG_PATH = PROJECT_ROOT / ".appstoreconnect" / "telegram_config.json"


# ────────────────────────────────────────────────────────────────────────────
# Config + tiny HTTP helper
# ────────────────────────────────────────────────────────────────────────────
def load_config() -> dict[str, str]:
    if not CONFIG_PATH.exists():
        sys.exit(f"Missing config at {CONFIG_PATH}")
    return json.loads(CONFIG_PATH.read_text())


def http(method: str, url: str, headers: dict[str, str], body: Any = None,
         expect_json: bool = True) -> Any:
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}
    # Resend sits behind Cloudflare, which 403s the default Python-urllib UA
    # with error 1010. Set a real-looking UA on every request.
    headers = {"User-Agent": "ok2eat-power-users-report/1.0 (+greg@ok2eat.com)",
               "Accept": "application/json", **headers}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")
        sys.exit(f"HTTP {e.code} on {method} {url}\n{msg[:600]}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error on {method} {url}: {e.reason}")
    if not expect_json:
        return raw
    if not raw:
        return None
    return json.loads(raw)


# ────────────────────────────────────────────────────────────────────────────
# Source 1 — PostHog: top users by high-intent event count
# ────────────────────────────────────────────────────────────────────────────
HIGH_INTENT_EVENTS = [
    "item_added_manual",
    "item_added_bulk",
    "item_quick_added",
    "item_scanned",
    "item_used",
    "recipe_saved",
    "recipe_pick",
    "eat_me_first_recipes_requested",
    "scan_receipt",
    "web_app_scan_completed",
    "shopping_list_created",
    "shopping_list_bulk_added",
    "shopping_list_item_added",
]


def posthog_top_users(cfg: dict[str, str], days: int, top_n: int) -> list[dict]:
    """Return list of {distinct_id, email, total_events, by_event{}} sorted desc."""
    host = cfg["posthog_host"].rstrip("/")
    api_key = cfg["posthog_api_key"]
    project_id = cfg["posthog_project_id"]
    headers = {"Authorization": f"Bearer {api_key}"}

    # HogQL: events joined with persons to get email. Group by person, sum.
    event_list = ", ".join(f"'{e}'" for e in HIGH_INTENT_EVENTS)
    query = f"""
        SELECT
            person.id AS distinct_id,
            person.properties.email AS email,
            event AS event_name,
            count() AS n
        FROM events
        WHERE timestamp > now() - INTERVAL {days} DAY
          AND event IN ({event_list})
        GROUP BY person.id, person.properties.email, event
        ORDER BY n DESC
        LIMIT 5000
    """
    res = http(
        "POST",
        f"{host}/api/projects/{project_id}/query/",
        headers=headers,
        body={"query": {"kind": "HogQLQuery", "query": query}},
    )
    rows = res.get("results", [])
    # Pivot: aggregate by user
    by_user: dict[str, dict] = {}
    for r in rows:
        did, email, ev, n = r
        rec = by_user.setdefault(did, {"distinct_id": did, "email": email or "",
                                        "total": 0, "by_event": {}})
        rec["total"] += int(n)
        rec["by_event"][ev] = rec["by_event"].get(ev, 0) + int(n)
    ranked = sorted(by_user.values(), key=lambda r: -r["total"])
    return ranked[:top_n]


def posthog_top_users_by_session_time(cfg, days, top_n) -> list[dict]:
    """Sum session_duration per person via HogQL — proxy for time-spent."""
    host = cfg["posthog_host"].rstrip("/")
    api_key = cfg["posthog_api_key"]
    project_id = cfg["posthog_project_id"]
    headers = {"Authorization": f"Bearer {api_key}"}
    query = f"""
        SELECT
            person.id AS distinct_id,
            person.properties.email AS email,
            sum(session.$session_duration) AS total_seconds,
            count(DISTINCT session.id) AS sessions
        FROM events
        WHERE timestamp > now() - INTERVAL {days} DAY
          AND session.$session_duration IS NOT NULL
        GROUP BY person.id, person.properties.email
        HAVING total_seconds > 0
        ORDER BY total_seconds DESC
        LIMIT {top_n}
    """
    res = http(
        "POST",
        f"{host}/api/projects/{project_id}/query/",
        headers=headers,
        body={"query": {"kind": "HogQLQuery", "query": query}},
    )
    rows = res.get("results", [])
    return [
        {"distinct_id": r[0], "email": r[1] or "",
         "total_seconds": int(r[2] or 0), "sessions": int(r[3] or 0)}
        for r in rows
    ]


# ────────────────────────────────────────────────────────────────────────────
# Source 2 — Supabase: auth.users + android_waitlist
# ────────────────────────────────────────────────────────────────────────────
def supabase_url(cfg) -> str:
    # The Edge Functions hit https://qemarhvgeuzhlwybmbie.supabase.co — same host
    # for the REST + admin APIs.
    return cfg["supabase_url"].rstrip("/")


def supabase_auth_users(cfg) -> list[dict]:
    """Page through GoTrue admin API to get all auth.users."""
    base = supabase_url(cfg)
    headers = {
        "Authorization": f"Bearer {cfg['supabase_service_role_key']}",
        "apikey": cfg["supabase_service_role_key"],
    }
    out: list[dict] = []
    page = 1
    while True:
        url = f"{base}/auth/v1/admin/users?page={page}&per_page=200"
        res = http("GET", url, headers=headers)
        users = res.get("users", []) or []
        if not users:
            break
        for u in users:
            out.append({
                "id": u.get("id"),
                "email": (u.get("email") or "").lower(),
                "created_at": u.get("created_at"),
                "last_sign_in_at": u.get("last_sign_in_at"),
                "confirmed_at": u.get("email_confirmed_at") or u.get("confirmed_at"),
            })
        if len(users) < 200:
            break
        page += 1
    return out


def supabase_android_waitlist(cfg) -> list[dict]:
    base = supabase_url(cfg)
    headers = {
        "Authorization": f"Bearer {cfg['supabase_service_role_key']}",
        "apikey": cfg["supabase_service_role_key"],
    }
    url = f"{base}/rest/v1/android_waitlist?select=email,source,signed_up_at&order=signed_up_at.desc&limit=1000"
    res = http("GET", url, headers=headers)
    return res or []


# ────────────────────────────────────────────────────────────────────────────
# Source 3 — Resend: newsletter audience contacts
# ────────────────────────────────────────────────────────────────────────────
def resend_newsletter_emails(cfg) -> tuple[str | None, list[dict]]:
    """Find the newsletter audience by name match, return its contacts."""
    api_key = cfg["resend_api_key"]
    headers = {"Authorization": f"Bearer {api_key}"}

    # List audiences. There may be more than one (e.g. android_audience).
    res = http("GET", "https://api.resend.com/audiences", headers=headers)
    audiences = (res or {}).get("data") or []
    # Pick the one whose name suggests "newsletter" / "blog"; fall back to
    # whichever has the most contacts.
    chosen = None
    for a in audiences:
        name = (a.get("name") or "").lower()
        if any(t in name for t in ("newsletter", "blog", "ok2eat")):
            chosen = a
            break
    if not chosen and audiences:
        chosen = audiences[0]
    if not chosen:
        return None, []

    aid = chosen["id"]
    cres = http("GET", f"https://api.resend.com/audiences/{aid}/contacts",
                headers=headers)
    contacts = (cres or {}).get("data") or []
    return chosen.get("name") or aid, [
        {
            "email": (c.get("email") or "").lower(),
            "created_at": c.get("created_at"),
            "unsubscribed": c.get("unsubscribed"),
        }
        for c in contacts
        if (c.get("email") and not c.get("unsubscribed"))
    ]


# ────────────────────────────────────────────────────────────────────────────
# Report writer
# ────────────────────────────────────────────────────────────────────────────
def fmt_seconds(s: int) -> str:
    if s < 60:
        return f"{s}s"
    if s < 3600:
        return f"{s // 60}m {s % 60}s"
    h = s // 3600
    m = (s % 3600) // 60
    return f"{h}h {m}m"


def write_report(args, top_actions, top_time, app_users, waitlist,
                 newsletter_name, newsletter, gap, out_path: Path):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: list[str] = []
    add = lines.append

    add(f"# Power-users + audience report — {now}")
    add("")
    add(f"Window: last {args.days} days.  Generated by `scripts/power_users_report.py`.")
    add("")
    add("## Summary")
    add("")
    add(f"- App users (auth.users): **{len(app_users)}**")
    add(f"- Newsletter subscribers ({newsletter_name or 'Resend audience'}): **{len(newsletter)}**")
    add(f"- Newsletter ∩ NOT app users (the warm-but-unconverted list): **{len(gap)}**")
    add(f"- Android waitlist: **{len(waitlist)}**")
    add(f"- Top app users by high-intent events (last {args.days}d): **{len(top_actions)}**")
    add("")

    # Top users by activity
    add(f"## Top {args.top} app users by high-intent events (last {args.days}d)")
    add("")
    add("\"High-intent\" = item_added/used/scanned, recipe_saved, recipe_pick, "
        "eat_me_first_recipes_requested, scan_receipt, web_app_scan_completed, "
        "shopping_list_*. These are the people getting the most value out of "
        "ok2eat — best candidates for feedback outreach.")
    add("")
    add("`distinct_id` is the stable user identifier — match it against "
        "auth.users in Supabase (it's the Supabase user UUID once a user signs in) "
        "or use it to find the person in PostHog directly.")
    add("")
    add("| # | distinct_id | Email | Total events | Top events |")
    add("|---|-------------|-------|--------------|------------|")
    for i, r in enumerate(top_actions, 1):
        top_evs = sorted(r["by_event"].items(), key=lambda kv: -kv[1])[:3]
        ev_str = ", ".join(f"{e} ({n})" for e, n in top_evs)
        did = r.get("distinct_id") or "—"
        email = r["email"] or "_(no email)_"
        add(f"| {i} | `{did}` | {email} | {r['total']} | {ev_str} |")
    add("")

    # Top users by session time
    add(f"## Top {args.top} app users by total session time (last {args.days}d)")
    add("")
    add("Sum of `$session_duration` across all sessions. Includes both web "
        "app and iOS app time (anyone PostHog identifies as the same person).")
    add("")
    add("| # | distinct_id | Email | Total time | Sessions |")
    add("|---|-------------|-------|------------|----------|")
    for i, r in enumerate(top_time, 1):
        did = r.get("distinct_id") or "—"
        email = r["email"] or "_(no email)_"
        add(f"| {i} | `{did}` | {email} | {fmt_seconds(r['total_seconds'])} | {r['sessions']} |")
    add("")

    # Newsletter-not-app gap
    add(f"## Newsletter subscribers who haven't signed up for the app")
    add("")
    add("Warm leads — they cared enough about ok2eat content to subscribe but "
        "never created an account. Send them a personal nudge.")
    add("")
    if gap:
        add("| # | Email | Subscribed |")
        add("|---|-------|------------|")
        for i, c in enumerate(gap, 1):
            add(f"| {i} | {c['email']} | {c.get('created_at') or '—'} |")
    else:
        add("_(none — every newsletter subscriber has an app account)_")
    add("")

    # Android waitlist
    add(f"## Android waitlist")
    add("")
    if waitlist:
        add("| # | Email | Source | Signed up |")
        add("|---|-------|--------|-----------|")
        for i, w in enumerate(waitlist, 1):
            add(f"| {i} | {w.get('email')} | {w.get('source') or '—'} | {w.get('signed_up_at') or '—'} |")
    else:
        add("_(no Android waitlist signups yet)_")
    add("")

    add("---")
    add("")
    add("Run again any time with `python3 scripts/power_users_report.py`. "
        "Override window with `--days N`, list size with `--top N`.")

    out_path.write_text("\n".join(lines))
    print(f"\n✓ wrote {out_path}  ({out_path.stat().st_size // 1024} KB)")


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30,
                    help="Lookback window for activity + session time (default 30)")
    ap.add_argument("--top", type=int, default=25,
                    help="How many top users to include (default 25)")
    args = ap.parse_args()

    cfg = load_config()
    if "supabase_url" not in cfg:
        cfg["supabase_url"] = "https://qemarhvgeuzhlwybmbie.supabase.co"

    print("Pulling PostHog top users by activity…")
    top_actions = posthog_top_users(cfg, args.days, args.top)
    print(f"  {len(top_actions)} users")

    print("Pulling PostHog top users by session time…")
    try:
        top_time = posthog_top_users_by_session_time(cfg, args.days, args.top)
    except SystemExit:
        # If session_duration HogQL fails (older project setup), don't kill the
        # whole report — just empty that section.
        top_time = []
    print(f"  {len(top_time)} users")

    print("Pulling Supabase auth.users…")
    app_users = supabase_auth_users(cfg)
    print(f"  {len(app_users)} users")

    print("Pulling Supabase android_waitlist…")
    waitlist = supabase_android_waitlist(cfg)
    print(f"  {len(waitlist)} signups")

    print("Pulling Resend newsletter audience…")
    try:
        audience_name, newsletter = resend_newsletter_emails(cfg)
        print(f"  '{audience_name}' — {len(newsletter)} contacts")
    except SystemExit as e:
        # Soft-fail: usually a restricted API key (only audiences.read perm
        # needed) or a Cloudflare block. Report the rest anyway and surface
        # the error in the report so Greg sees it.
        print(f"  ⚠ Resend pull failed — newsletter section will be empty.")
        print(f"    {e}")
        audience_name, newsletter = "_(Resend pull failed — see script output)_", []

    # Diff: newsletter NOT in auth.users
    app_emails = {(u["email"] or "").lower() for u in app_users if u["email"]}
    gap = [c for c in newsletter if c["email"] and c["email"] not in app_emails]

    date_slug = datetime.now().strftime("%Y-%m-%d")
    out_path = PROJECT_ROOT / "marketing" / f"power_users_report_{date_slug}.md"
    write_report(args, top_actions, top_time, app_users, waitlist,
                 audience_name, newsletter, gap, out_path)


if __name__ == "__main__":
    main()
