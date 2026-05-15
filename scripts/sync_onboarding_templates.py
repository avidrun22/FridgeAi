#!/usr/bin/env python3
"""
Sync onboarding email templates from marketing/onboarding_emails/ INTO the
embedded JS template literals in supabase/functions/send-onboarding-emails/
index.ts. The function inlines all 6 templates as TPL_* constants — the
templates/ folder next to index.ts is vestigial.

Run this whenever you edit marketing/onboarding_emails/*.html, then deploy:

    python3 scripts/sync_onboarding_templates.py
    supabase functions deploy send-onboarding-emails
"""
from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
TEMPLATES_DIR = PROJECT_ROOT / "marketing" / "onboarding_emails"
INDEX_TS = PROJECT_ROOT / "supabase" / "functions" / "send-onboarding-emails" / "index.ts"

# Map filename → JS constant name that index.ts uses.
MAPPING = {
    "01_welcome_day0.html":            "TPL_D0",
    "02_profile_setup_day2.html":      "TPL_D2",
    "03_core_walkthrough_day5.html":   "TPL_D5",
    "04_power_user_tips_day10.html":   "TPL_D10",
    "05_behavioral_quick_start.html":  "TPL_QUICK_START",
    "06_behavioral_try_receipt_scan.html": "TPL_TRY_RECEIPT",
}


def escape_for_template_literal(html: str) -> str:
    """Escape backslashes, backticks, and ${ for embedding in a JS template
    literal."""
    return (
        html.replace("\\", "\\\\")
            .replace("`", "\\`")
            .replace("${", "\\${")
    )


def replace_const(ts_source: str, const_name: str, new_html: str) -> str:
    """Replace `const NAME = `...`;` with the new body. Greedy-matches the
    template literal across newlines."""
    # Pattern: const TPL_D0 = `...`;
    # Use non-greedy with [\s\S] so it doesn't grab past the closing backtick.
    pattern = rf"const {re.escape(const_name)} = `[\s\S]*?`;"
    replacement = f"const {const_name} = `{escape_for_template_literal(new_html)}`;"
    new_source, n = re.subn(pattern, replacement, ts_source, count=1)
    if n != 1:
        raise RuntimeError(f"Couldn't find/replace `const {const_name} = ` block in index.ts (matched {n} times)")
    return new_source


def main():
    if not INDEX_TS.exists():
        raise SystemExit(f"Missing {INDEX_TS}")
    src = INDEX_TS.read_text()

    for filename, const_name in MAPPING.items():
        tpl_path = TEMPLATES_DIR / filename
        if not tpl_path.exists():
            raise SystemExit(f"Missing template {tpl_path}")
        html = tpl_path.read_text()
        src = replace_const(src, const_name, html)
        print(f"  → {const_name} <- {filename}  ({len(html)} chars)")

    INDEX_TS.write_text(src)
    print(f"\n✓ Rewrote {INDEX_TS.name}  ({INDEX_TS.stat().st_size // 1024} KB total)")
    print("Next: supabase functions deploy send-onboarding-emails")


if __name__ == "__main__":
    main()
