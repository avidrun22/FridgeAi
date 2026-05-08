#!/usr/bin/env python3
"""
Build /shelf-life/ static pages from data/foodkeeper.json.

For each of the 660 USDA FoodKeeper items, emit a per-item page at
shelf-life/{slug}.html. Each page is a long-tail SEO target for queries
like "how long does spinach last in the fridge" — the H1 mirrors the query
language, the JSON-LD FAQPage markup makes it eligible for rich results,
and the app CTA at the bottom funnels search traffic into installs.

Also emits the index page at shelf-life/index.html with a client-side
search/filter over all 660 items.

Outputs (relative to repo root):
  shelf-life/index.html             — index w/ search
  shelf-life/{slug}.html            — one per item
  shelf-life/styles.css             — shared CSS for all pages
  scripts/_shelf_life_sitemap.txt   — line-per-URL list, consumed by deploy/sitemap

Run:
  python3 scripts/build_shelf_life_pages.py

Idempotent: regenerates all pages from current foodkeeper.json. Safe to
re-run after data refreshes.
"""
from __future__ import annotations

import html
import json
import re
from pathlib import Path
from datetime import date

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = ROOT / "data" / "foodkeeper.json"
OUT_DIR = ROOT / "shelf-life"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SITE_URL = "https://ok2eat.com"
APP_STORE_URL = "https://apps.apple.com/us/app/ok2eat/id6761730687"
WEB_APP_URL = "https://app.ok2eat.com"
USDA_SOURCE = "https://www.fsis.usda.gov/shared/data/EN/foodkeeper.json"
DATA_VERSION_TEXT = "USDA FSIS FoodKeeper v128 (last updated by USDA 2025-01-22)"


def slugify(name: str, used: set) -> str:
    """URL slug, deduplicated against `used`. Strips punctuation, lowercases,
    collapses whitespace to hyphens. If a duplicate, appends -2, -3, etc."""
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if not s:
        s = "item"
    base = s
    n = 2
    while s in used:
        s = f"{base}-{n}"
        n += 1
    used.add(s)
    return s


def fmt_range(mn, mx, unit="days"):
    """'7' or '7–14' or '7 days' or '7–14 days' — None-safe."""
    if mn is None and mx is None:
        return None
    if mn is None or mx is None or mn == mx:
        v = mn if mn is not None else mx
        # Pretty-print whole numbers without trailing .0
        v = int(v) if v == int(v) else round(v, 1)
        return f"{v} {unit}" if unit else f"{v}"
    a = int(mn) if mn == int(mn) else round(mn, 1)
    b = int(mx) if mx == int(mx) else round(mx, 1)
    return f"{a}–{b} {unit}" if unit else f"{a}–{b}"


def humanize_days(d) -> str:
    """7 → '1 week', 30 → '1 month', 365 → '1 year', 14 → '2 weeks', etc.
    Used in the meta description so search engines can match natural-language
    queries ("how long does spinach last weeks")."""
    if d is None:
        return ""
    if d >= 365:
        y = d / 365
        return f"about {round(y, 1)} year{'s' if y != 1 else ''}"
    if d >= 30:
        m = d / 30
        return f"about {round(m, 1)} month{'s' if m != 1 else ''}"
    if d >= 7:
        w = d / 7
        return f"about {round(w, 1)} week{'s' if w != 1 else ''}"
    return f"{int(d) if d == int(d) else round(d, 1)} day{'s' if d != 1 else ''}"


# ─── HTML head + footer (shared by all pages) ────────────────────────────────

def page_head(title, description, canonical, json_ld_blocks):
    """Returns the opening HTML through </head>, including JSON-LD."""
    json_ld = "\n".join(
        f'<script type="application/ld+json">{json.dumps(b, ensure_ascii=False)}</script>'
        for b in json_ld_blocks
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{canonical}">
<meta name="theme-color" content="#F0EADC">
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:type" content="article">
<meta property="og:url" content="{canonical}">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'%3E%3Crect width='36' height='36' rx='8' fill='%23F0EADC'/%3E%3Cpath fill='%233E721D' d='M35 5.904c2.394 6.042-1.438 20.543-10.5 26.5-9.06 5.957-20.395 3.573-23.097-6.443-1.669-6.186 2.79-10.721 11.851-16.677C22.315 3.327 32.64-.053 35 5.904z'/%3E%3Cpath fill='%23A6D388' d='M19.815 26.578c-5.757 4.013-13.482 3.097-16.29-.934C.718 21.613 4 14.474 9.757 10.463c5.755-4.011 20.258-9.264 23.068-5.234 2.807 4.03-4.825 16.175-13.01 21.349'/%3E%3Cpath fill='%23662113' d='M11.162 12.488c3.48-2.332 7.382-1.495 9.798.995 1.433 1.477-.88 5.382-4.359 7.714-3.478 2.33-7.769 1.763-8.239.731-1.44-3.157-.677-7.109 2.8-9.44z'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,700;12..96,800&family=DM+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shelf-life/styles.css">
{json_ld}
</head>
<body>

<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="avocado" viewBox="0 0 36 36">
    <rect width="36" height="36" rx="8" fill="#F0EADC"/>
    <path fill="#3E721D" d="M35 5.904c2.394 6.042-1.438 20.543-10.5 26.5-9.06 5.957-20.395 3.573-23.097-6.443-1.669-6.186 2.79-10.721 11.851-16.677C22.315 3.327 32.64-.053 35 5.904z"/>
    <path fill="#A6D388" d="M19.815 26.578c-5.757 4.013-13.482 3.097-16.29-.934C.718 21.613 4 14.474 9.757 10.463c5.755-4.011 20.258-9.264 23.068-5.234 2.807 4.03-4.825 16.175-13.01 21.349"/>
    <path fill="#662113" d="M11.162 12.488c3.48-2.332 7.382-1.495 9.798.995 1.433 1.477-.88 5.382-4.359 7.714-3.478 2.33-7.769 1.763-8.239.731-1.44-3.157-.677-7.109 2.8-9.44z"/>
  </symbol>
</svg>

<nav>
  <a href="/" class="nav-logo"><svg><use href="#avocado"/></svg> ok2eat</a>
  <ul class="nav-links">
    <li><a href="/#features">Features</a></li>
    <li><a href="/#how">How it works</a></li>
    <li><a href="/blog/">Blog</a></li>
    <li><a href="/shelf-life/" class="is-active">Shelf life</a></li>
    <li><a href="/#support">Support</a></li>
    <li><a href="https://app.ok2eat.com">Log in</a></li>
    <li><a href="https://apps.apple.com/us/app/ok2eat/id6761730687" class="nav-cta">Download</a></li>
  </ul>
</nav>
"""


PAGE_FOOTER = """
<footer class="footer">
  <p class="disclaimer">
    Information on this page is sourced from the <a href="https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/foodkeeper-app">USDA Food Safety and Inspection Service FoodKeeper database</a>, a publicly available US government dataset. ok2eat is republishing this information; we do not produce food-safety guidance ourselves and the values shown are guidelines, not guarantees. Storage times are estimates for typical storage conditions and unopened/opened product states; actual freshness depends on initial product condition, storage temperature, packaging, and handling. <strong>When in doubt, throw it out</strong> — trust your senses (smell, sight, texture) over any stated timeframe.
  </p>
  <p>
    <a href="/">Home</a>
    <a href="/shelf-life/">Shelf life directory</a>
    <a href="/blog/">Blog</a>
    <a href="/privacy/">Privacy</a>
    <a href="mailto:hello@ok2eat.com">hello@ok2eat.com</a>
  </p>
  <p class="copy">© 2026 ok2eat · Data sourced from <a href="https://catalog.data.gov/dataset/fsis-foodkeeper-data">USDA FSIS FoodKeeper</a></p>
</footer>

</body>
</html>
"""


# ─── Item page renderer ──────────────────────────────────────────────────────

def render_item_page(item, slug, related):
    name = item["name"]
    subtitle = item.get("subtitle")
    pretty_name = name + (f", {subtitle}" if subtitle else "")
    title = f"How long does {pretty_name.lower()} last? — Storage guide"
    canonical = f"{SITE_URL}/shelf-life/{slug}.html"

    # Description: prioritize the most-specific data we have. Fridge first (most queries),
    # then pantry, then freezer.
    desc_parts = []
    if item.get("fridge_min_days") is not None:
        r = fmt_range(item.get("fridge_min_days"), item.get("fridge_max_days"))
        desc_parts.append(f"In the fridge: {r}")
    if item.get("freezer_min_days") is not None:
        r = fmt_range(item.get("freezer_min_days"), item.get("freezer_max_days"))
        desc_parts.append(f"in the freezer: {r}")
    if item.get("pantry_min_days") is not None:
        r = fmt_range(item.get("pantry_min_days"), item.get("pantry_max_days"))
        desc_parts.append(f"in the pantry: {r}")
    if not desc_parts:
        desc_parts.append("Storage and freshness info from USDA FoodKeeper data")
    description = f"How long does {pretty_name.lower()} last? " + ", ".join(desc_parts) + ". USDA FoodKeeper data."

    # Build sections — only show storage modes with at least an unopened range.
    # (Some items have only "after opening" data, which doesn't make sense as
    # a standalone card; skip those modes silently.)
    sections = []
    if item.get("pantry_min_days") is not None or item.get("pantry_max_days") is not None:
        sections.append(("Pantry", "🧂", item.get("pantry_min_days"), item.get("pantry_max_days"),
                         item.get("pantry_open_min_days"), item.get("pantry_open_max_days")))
    if item.get("fridge_min_days") is not None or item.get("fridge_max_days") is not None:
        sections.append(("Fridge", "🧊", item.get("fridge_min_days"), item.get("fridge_max_days"),
                         item.get("fridge_open_min_days"), item.get("fridge_open_max_days")))
    if item.get("freezer_min_days") is not None or item.get("freezer_max_days") is not None:
        sections.append(("Freezer", "❄️", item.get("freezer_min_days"), item.get("freezer_max_days"),
                         None, None))

    # JSON-LD: FAQPage with one Q/A per storage mode that has data
    faq_questions = []
    for label, _, mn, mx, omn, omx in sections:
        r = fmt_range(mn, mx)
        if r:
            faq_questions.append({
                "@type": "Question",
                "name": f"How long does {pretty_name.lower()} last in the {label.lower()}?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": f"Unopened {pretty_name.lower()} keeps {r} in the {label.lower()}, according to USDA FoodKeeper data."
                            + (f" Once opened, {fmt_range(omn, omx)}." if omn is not None else ""),
                },
            })

    json_ld_blocks = [
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faq_questions,
        },
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "ok2eat", "item": SITE_URL},
                {"@type": "ListItem", "position": 2, "name": "Shelf life directory", "item": f"{SITE_URL}/shelf-life/"},
                {"@type": "ListItem", "position": 3, "name": pretty_name, "item": canonical},
            ],
        },
    ]

    # Render the body
    sections_html = ""
    for label, emoji, mn, mx, omn, omx in sections:
        r = fmt_range(mn, mx)
        opened = fmt_range(omn, omx) if omn is not None else None
        sections_html += f"""
        <section class="storage-card">
          <div class="storage-icon">{emoji}</div>
          <div class="storage-body">
            <h2 class="storage-label">{label}</h2>
            <p class="storage-range">{html.escape(r)}<span class="storage-sub"> unopened</span></p>
            {f'<p class="storage-opened">After opening: {html.escape(opened)}</p>' if opened else ''}
          </div>
        </section>"""

    tips_html = ""
    if item.get("tips"):
        tips_html = f"""
      <section class="tips-card">
        <h2 class="tips-label">Storage tips from USDA</h2>
        <p>{html.escape(item['tips'])}</p>
      </section>"""

    related_html = ""
    if related:
        related_html = '<section class="related"><h2>Related items</h2><ul>'
        for r_item, r_slug in related[:6]:
            related_html += f'<li><a href="/shelf-life/{r_slug}.html">{html.escape(r_item["name"])}</a></li>'
        related_html += "</ul></section>"

    body = f"""
<main class="shelf-page">
  <nav class="breadcrumbs" aria-label="breadcrumb">
    <a href="/">Home</a> · <a href="/shelf-life/">Shelf life directory</a> · <span>{html.escape(pretty_name)}</span>
  </nav>

  <article>
    <header class="item-header">
      <p class="item-category">{html.escape(item.get('category') or '')}</p>
      <h1>How long does {html.escape(pretty_name.lower())} last?</h1>
      <p class="item-subtitle">{html.escape(subtitle or '')}</p>
    </header>

    <div class="storage-grid">
      {sections_html}
    </div>

    {tips_html}

    <section class="cta-card">
      <h2>Stop guessing — let ok2eat track this for you</h2>
      <p>Add an item once, and ok2eat reminds you before it goes bad. Free, no subscription.</p>
      <a href="{APP_STORE_URL}" class="btn-primary">Download for iOS</a>
      <a href="{WEB_APP_URL}" class="btn-secondary">Try the web app</a>
    </section>

    {related_html}

    <section class="source-attribution">
      <h2>Data source</h2>
      <p>The shelf-life ranges shown above are from the <a href="https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/foodkeeper-app" rel="noopener">USDA Food Safety and Inspection Service FoodKeeper database</a>, a publicly maintained reference. ok2eat republishes this data unmodified except for unit normalization (everything shown in days). Source dataset: {DATA_VERSION_TEXT}.</p>
    </section>
  </article>
</main>
"""
    return page_head(title, description, canonical, json_ld_blocks) + body + PAGE_FOOTER


# ─── Index page (with search) ────────────────────────────────────────────────

def render_index_page(items_with_slugs, by_category):
    """Index page lists all 660 items, grouped by category, with a client-side
    fuzzy search that filters the list as the user types. SEO-targeted at
    queries like 'food shelf life chart' / 'how long does food last'."""
    title = "How long does food last? — ok2eat shelf life directory"
    description = (
        f"Shelf life directory for {len(items_with_slugs)} food items, sourced from the "
        "USDA FoodKeeper database. Pantry, fridge, and freezer storage times for milk, eggs, "
        "meat, produce, and more."
    )
    canonical = f"{SITE_URL}/shelf-life/"

    # Build a flat search index — JSON embedded in the page so client-side
    # filtering doesn't need a network request. Only the lightweight fields
    # for filtering (name, category, slug, keywords) are included; the full
    # detail is on each per-item page.
    search_index = [
        {
            "n": it["name"],
            "s": it.get("subtitle") or "",
            "c": it.get("category") or "",
            "k": it.get("keywords") or "",
            "u": f"/shelf-life/{slug}.html",
        }
        for it, slug in items_with_slugs
    ]

    json_ld = [
        {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Shelf life directory",
            "description": description,
            "url": canonical,
            "isPartOf": {"@type": "WebSite", "name": "ok2eat", "url": SITE_URL},
        }
    ]

    cats_html = ""
    for cat, items in sorted(by_category.items(), key=lambda x: x[0] or "ZZZ"):
        if not items:
            continue
        cats_html += f'<section class="cat-section" data-cat="{html.escape(cat or "Other")}">'
        cats_html += f'<h2>{html.escape(cat or "Uncategorized")}</h2>'
        cats_html += '<ul class="item-list">'
        for it, slug in sorted(items, key=lambda x: x[0]["name"].lower()):
            cats_html += f'<li><a href="/shelf-life/{slug}.html">{html.escape(it["name"])}{(" — " + html.escape(it["subtitle"])) if it.get("subtitle") else ""}</a></li>'
        cats_html += "</ul></section>"

    body = f"""
<main class="shelf-index">
  <header class="index-header">
    <p class="index-eyebrow">// shelf life directory</p>
    <h1>How long does food last?</h1>
    <p class="index-tagline">Storage times for {len(items_with_slugs)} foods, from the USDA FoodKeeper database. Search or browse below.</p>
  </header>

  <div class="search-wrap">
    <input type="search" id="shelf-search" placeholder="Search a food item — milk, spinach, eggs…" autocomplete="off" />
    <p id="shelf-search-msg" class="search-msg" aria-live="polite"></p>
  </div>

  <div id="shelf-results">
    {cats_html}
  </div>

  <section class="cta-card">
    <h2>Track your fridge automatically</h2>
    <p>ok2eat scans your grocery receipt and tracks expiration for every item — no typing required. Free for iOS + web.</p>
    <a href="{APP_STORE_URL}" class="btn-primary">Download for iOS</a>
    <a href="{WEB_APP_URL}" class="btn-secondary">Try the web app</a>
  </section>

  <section class="source-attribution">
    <p>All storage times sourced from the <a href="https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/foodkeeper-app">USDA Food Safety and Inspection Service FoodKeeper database</a>. {DATA_VERSION_TEXT}. Updated {date.today().isoformat()}.</p>
  </section>
</main>

<script>
// Tiny client-side filter. Indexed at build time.
const __SHELF_INDEX__ = {json.dumps(search_index, ensure_ascii=False)};
(function(){{
  const input = document.getElementById('shelf-search');
  const results = document.getElementById('shelf-results');
  const msg = document.getElementById('shelf-search-msg');
  if (!input || !results) return;
  let timer = null;
  // Pre-fill from URL ?q= or #hash so homepage / external links land on a filtered view.
  function prefillFromUrl() {{
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || (window.location.hash ? decodeURIComponent(window.location.hash.replace(/^#/, '')) : '');
    if (q) {{
      input.value = q;
      filter();
      input.focus();
    }}
  }}
  input.addEventListener('input', () => {{
    if (timer) clearTimeout(timer);
    timer = setTimeout(filter, 80);
  }});
  window.addEventListener('hashchange', prefillFromUrl);
  prefillFromUrl();
  function filter() {{
    const q = input.value.trim().toLowerCase();
    if (!q) {{
      // Show full grouped list
      results.querySelectorAll('.cat-section').forEach(s => s.style.display = '');
      results.querySelectorAll('.item-list li').forEach(li => li.style.display = '');
      msg.textContent = '';
      return;
    }}
    // Hide everything that doesn't match (substring against name + keywords)
    let matched = 0;
    const allLis = results.querySelectorAll('.item-list li');
    allLis.forEach(li => {{
      const txt = li.textContent.toLowerCase();
      // Cross-reference the data index for keyword match
      const linkUrl = li.querySelector('a').getAttribute('href');
      const idx = __SHELF_INDEX__.find(it => it.u === linkUrl);
      const haystack = (txt + ' ' + (idx ? idx.k.toLowerCase() : '')).trim();
      const hit = haystack.includes(q);
      li.style.display = hit ? '' : 'none';
      if (hit) matched++;
    }});
    // Hide empty category sections
    results.querySelectorAll('.cat-section').forEach(s => {{
      const visible = s.querySelectorAll('.item-list li:not([style*="display: none"])').length;
      s.style.display = visible > 0 ? '' : 'none';
    }});
    msg.textContent = matched === 0 ? 'No matches — try a different term.' : `${{matched}} match${{matched === 1 ? '' : 'es'}}.`;
  }}
}})();
</script>
"""
    return page_head(title, description, canonical, json_ld) + body + PAGE_FOOTER


# ─── CSS ─────────────────────────────────────────────────────────────────────

CSS = """
/* Shared style for /shelf-life/ pages. Mirrors the cream-and-green palette
   used on the marketing site + blog. */
:root {
  --bg: #F0EADC;
  --surface: #F7F3E8;
  --card: #FFFFFF;
  --border: #E2DCCB;
  --text: #1C261C;
  --text-soft: #3A4A38;
  --muted: #6B8264;
  --green: #3E721D;
  --green-soft: rgba(62, 114, 29, 0.08);
}

* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  font-family: 'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
}

a { color: var(--green); text-decoration: none; }
a:hover { text-decoration: underline; }

nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 32px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.nav-logo {
  display: flex; align-items: center; gap: 8px;
  font-weight: 700; font-size: 18px;
  color: var(--green);
}
.nav-logo svg { width: 28px; height: 28px; }
.nav-links { display: flex; gap: 16px; list-style: none; padding: 0; margin: 0; }
.nav-links a { color: var(--text); font-weight: 500; font-size: 14px; }
.nav-links a.is-active { color: var(--green); font-weight: 700; }
.nav-cta { background: var(--green); color: var(--bg) !important; padding: 8px 14px; border-radius: 6px; }
@media (max-width: 720px) {
  nav { flex-direction: column; gap: 12px; padding: 12px 16px; }
  .nav-links { gap: 10px; flex-wrap: wrap; justify-content: center; }
}

main {
  max-width: 720px;
  margin: 0 auto;
  padding: 48px 24px;
}

.breadcrumbs {
  font-size: 13px;
  color: var(--muted);
  margin-bottom: 24px;
}
.breadcrumbs span { color: var(--text-soft); }

.item-header { margin-bottom: 32px; }
.item-category {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 8px;
}
.item-header h1 {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.5px;
  line-height: 1.2;
  margin: 0 0 8px;
}
.item-subtitle {
  font-style: italic;
  color: var(--text-soft);
  margin: 0;
}

.storage-grid {
  display: grid;
  gap: 12px;
  margin-bottom: 32px;
}

.storage-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
}
.storage-icon { font-size: 32px; }
.storage-body { flex: 1; }
.storage-label {
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 4px;
  font-family: 'DM Mono', ui-monospace, monospace;
}
.storage-range {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}
.storage-sub {
  font-weight: 400;
  color: var(--muted);
  font-size: 16px;
}
.storage-opened {
  margin: 6px 0 0;
  color: var(--text-soft);
  font-size: 14px;
}

.tips-card {
  padding: 20px;
  background: var(--green-soft);
  border: 1px solid rgba(62, 114, 29, 0.2);
  border-radius: 12px;
  margin-bottom: 32px;
}
.tips-label {
  font-size: 12px;
  color: var(--green);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: 'DM Mono', ui-monospace, monospace;
  margin: 0 0 8px;
}
.tips-card p { margin: 0; color: var(--text-soft); font-size: 14px; }

.cta-card {
  padding: 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  text-align: center;
  margin: 32px 0;
}
.cta-card h2 { margin: 0 0 8px; font-size: 20px; }
.cta-card p { margin: 0 0 20px; color: var(--text-soft); }
.btn-primary, .btn-secondary {
  display: inline-block;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  margin: 4px;
}
.btn-primary { background: var(--green); color: var(--bg); }
.btn-primary:hover { text-decoration: none; opacity: 0.9; }
.btn-secondary {
  background: var(--card);
  color: var(--green);
  border: 1px solid var(--green);
}

.related h2 {
  font-size: 14px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 32px 0 12px;
  font-family: 'DM Mono', ui-monospace, monospace;
}
.related ul { padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px; }
.related li a {
  display: inline-block;
  padding: 6px 12px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  font-size: 13px;
}

.source-attribution {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--muted);
}
.source-attribution h2 {
  font-size: 13px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-family: 'DM Mono', ui-monospace, monospace;
  margin: 0 0 8px;
}

/* Index page */
.shelf-index { max-width: 800px; }
.index-header { text-align: center; margin-bottom: 32px; }
.index-eyebrow {
  font-family: 'DM Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 8px;
}
.index-header h1 {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -1px;
  margin: 0 0 12px;
}
.index-tagline {
  color: var(--text-soft);
  font-size: 16px;
  max-width: 560px;
  margin: 0 auto;
}

.search-wrap { margin: 32px 0; }
#shelf-search {
  width: 100%;
  padding: 14px 18px;
  font-size: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--card);
  font-family: inherit;
}
#shelf-search:focus { outline: none; border-color: var(--green); }
.search-msg { font-size: 13px; color: var(--muted); margin: 8px 0 0; min-height: 16px; }

.cat-section { margin-bottom: 32px; }
.cat-section h2 {
  font-size: 14px;
  color: var(--green);
  font-family: 'DM Mono', ui-monospace, monospace;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 0 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.item-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 4px 16px;
}
.item-list li a {
  display: block;
  padding: 6px 0;
  color: var(--text);
  font-size: 14px;
}
.item-list li a:hover { color: var(--green); }

.footer {
  max-width: 720px;
  margin: 64px auto 32px;
  padding: 32px 24px;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--muted);
  text-align: center;
}
.footer .disclaimer {
  text-align: left;
  font-size: 12px;
  background: var(--surface);
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 24px;
  line-height: 1.65;
}
.footer p a { color: var(--green); margin: 0 8px; }
.footer .copy { font-family: 'DM Mono', ui-monospace, monospace; font-size: 11px; opacity: 0.7; margin-top: 16px; }
"""


def main():
    items = json.loads(DATA.read_text())
    print(f"Loaded {len(items)} items")

    used_slugs: set[str] = set()
    items_with_slugs = []
    by_category: dict[str, list] = {}

    for it in items:
        slug = slugify(it["name"], used_slugs)
        items_with_slugs.append((it, slug))
        cat = it.get("category") or "Other"
        by_category.setdefault(cat, []).append((it, slug))

    # Compute "related" — same category, sorted by name, exclude self
    related_by_id = {}
    for it, slug in items_with_slugs:
        cat = it.get("category") or "Other"
        same = [(o, oslug) for o, oslug in by_category[cat] if o["id"] != it["id"]]
        same.sort(key=lambda x: x[0]["name"].lower())
        related_by_id[it["id"]] = same[:6]

    # Write CSS once
    (OUT_DIR / "styles.css").write_text(CSS)
    print(f"Wrote shelf-life/styles.css ({(OUT_DIR / 'styles.css').stat().st_size:,} bytes)")

    # Write index
    index_html = render_index_page(items_with_slugs, by_category)
    (OUT_DIR / "index.html").write_text(index_html)
    print(f"Wrote shelf-life/index.html ({(OUT_DIR / 'index.html').stat().st_size:,} bytes)")

    # Write per-item pages
    sitemap_lines = []
    for it, slug in items_with_slugs:
        page = render_item_page(it, slug, related_by_id[it["id"]])
        (OUT_DIR / f"{slug}.html").write_text(page)
        sitemap_lines.append(f"https://ok2eat.com/shelf-life/{slug}.html")

    # Sitemap helper file
    sitemap_lines.insert(0, "https://ok2eat.com/shelf-life/")
    (HERE / "_shelf_life_sitemap.txt").write_text("\n".join(sitemap_lines) + "\n")

    print(f"Wrote {len(items_with_slugs)} item pages")
    print(f"Wrote sitemap helper: scripts/_shelf_life_sitemap.txt ({len(sitemap_lines)} URLs)")


if __name__ == "__main__":
    main()
