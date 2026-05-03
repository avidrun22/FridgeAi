#!/usr/bin/env python3
"""
Redact App Store / marketing screenshots — replace PII (emails, household
name, real names) with realistic fake data so they look like real app
usage, not censored output.

Approach: cover the original text with a sampled background color, then
draw replacement text using a similar font (Liberation Sans Bold ≈ SF Pro).

Usage:
    pip install pillow --break-system-packages
    python scripts/redact_screenshots.py <input_dir> <output_dir>

Edit the `JOBS` list below with one entry per source file you want to
process. Each job specifies: file path + a list of (cover-bbox, replacement-
text, font-options) tuples. See the sample for v1.14 ASC screenshots.

Lessons learned (2026-05-03 with iPhone 6.5" screenshots, 1206×2622):
  - Pixel-row scanning > eyeballing for finding text positions:
        cnt = sum(1 for x in range(x0, x1) if is_dark(*px[x, y]))
        # spike == text row, zero == empty
  - Cover bounds need to extend SLIGHTLY past the visual text bbox to
    catch antialiasing — typical text "G" or "y" descenders/openings
    extend ~5-10px beyond what you'd guess.
  - Sample background from a clean swatch, not from "near the text" —
    text pixels mixed in will tint your fill color.
  - For card-style UI (white cards on tinted page bg), sample card
    INTERIOR (right side, between text fields) — page bg sample will
    leave visible "tabs" where the cover extends past card edges.
  - Hardcoded bboxes are more reliable than auto-detection once you
    have the row scan output. Auto-detection tends to grab adjacent
    elements (subtitle below, pill button to the right, etc.).
"""

from pathlib import Path
import sys
import shutil
from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"
FONT_REG  = "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"


def cover(img, x0, y0, x1, y1, fill):
    """Cover a rectangle with solid color."""
    ImageDraw.Draw(img).rectangle((x0, y0, x1, y1), fill=fill)


def draw(img, text, x, y, font_path, font_size, color):
    """Draw text at (x, y)."""
    f = ImageFont.truetype(font_path, font_size)
    ImageDraw.Draw(img).text((x, y), text, font=f, fill=color)


def avg_color(img, x0, y0, x1, y1):
    """Sample average pixel color in a region."""
    px = img.load()
    rs, gs, bs = [], [], []
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, *_ = px[x, y]
            rs.append(r); gs.append(g); bs.append(b)
    n = max(len(rs), 1)
    return (sum(rs) // n, sum(gs) // n, sum(bs) // n)


def profile_rows(img, x0, x1, y0, y1, step=10, bg=None):
    """Print dark-pixel count per row — useful for finding text positions.
    Run this once per screenshot to figure out exact y-bands of each text line."""
    px = img.load()
    if bg is None:
        bg = avg_color(img, 0, 0, 100, 100)
    print(f"  bg sample: {bg}")
    for y in range(y0, y1, step):
        cnt = sum(1 for x in range(x0, x1)
                  if abs(px[x, y][0] - bg[0]) + abs(px[x, y][1] - bg[1]) + abs(px[x, y][2] - bg[2]) > 80)
        print(f"    y={y}: {cnt}")


def apply_redactions(img, redactions):
    """Apply a list of redactions. Each entry:
    {
      "cover": (x0, y0, x1, y1),
      "bg_sample": (x0, y0, x1, y1) | "tuple" of RGB,
      "text": "replacement text",
      "draw_at": (x, y),
      "font": FONT_BOLD | FONT_REG,
      "size": int,
      "color": (r, g, b),
    }"""
    for r in redactions:
        bg = r["bg_sample"]
        if isinstance(bg, tuple) and len(bg) == 4:
            bg = avg_color(img, *bg)
        cover(img, *r["cover"], bg)
        if r.get("text"):
            draw(img, r["text"], *r["draw_at"], r["font"], r["size"], r["color"])


# ─── Sample job: v1.14 ASC screenshots, 1206×2622, IMG_7892 + IMG_7899 ────
# Adapt these coordinates per screenshot batch by running profile_rows() first.

JOBS = [
    {
        "input":  "IMG_7892.PNG",
        "output": "IMG_7892.PNG",
        "redactions": [
            # 'Grila' household-name title in upper-left
            {
                "cover":     (40, 380, 700, 460),
                "bg_sample": (130, 350, 700, 380),
                "text":      "My Family",
                "draw_at":   (130, 380),
                "font":      FONT_BOLD,
                "size":      62,
                "color":     (28, 38, 28),
            },
        ],
    },
    {
        "input":  "IMG_7899.PNG",
        "output": "IMG_7899.PNG",
        "redactions": [
            # 'Grila · 3 members' subtitle
            {
                "cover":     (125, 305, 700, 348),
                "bg_sample": (130, 295, 700, 305),
                "text":      "My Family · 3 members",
                "draw_at":   (130, 305),
                "font":      FONT_REG,
                "size":      34,
                "color":     (120, 130, 120),
            },
            # Email row 1: greg.h.goldberg@gmail.com → greg@example.com
            {
                "cover":     (268, 1380, 1090, 1440),
                "bg_sample": (500, 1380, 700, 1387),
                "text":      "greg@example.com",
                "draw_at":   (270, 1383),
                "font":      FONT_BOLD,
                "size":      42,
                "color":     (28, 38, 28),
            },
            # Email row 2: svqzvf9qsr@privaterelay.appleid.com → sarah@example.com
            {
                "cover":     (268, 1590, 1090, 1650),
                "bg_sample": (500, 1380, 700, 1387),
                "text":      "sarah@example.com",
                "draw_at":   (270, 1593),
                "font":      FONT_BOLD,
                "size":      42,
                "color":     (28, 38, 28),
            },
            # Email row 3: ggoldberg@dnanexus.com → alex@example.com
            {
                "cover":     (268, 1800, 1090, 1860),
                "bg_sample": (500, 1380, 700, 1387),
                "text":      "alex@example.com",
                "draw_at":   (270, 1803),
                "font":      FONT_BOLD,
                "size":      42,
                "color":     (28, 38, 28),
            },
        ],
    },
]


def main(input_dir, output_dir):
    in_dir = Path(input_dir)
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    edited = set()
    for job in JOBS:
        src = in_dir / job["input"]
        dst = out_dir / job["output"]
        if not src.exists():
            print(f"  ⚠ skipping (not found): {src}")
            continue
        img = Image.open(src).convert("RGB")
        apply_redactions(img, job["redactions"])
        img.save(dst, "PNG")
        edited.add(job["input"])
        print(f"  ✔ {job['input']} → {dst}")

    # Copy untouched files alongside, so user has the full set in one place
    for src in in_dir.glob("*.PNG"):
        if src.name not in edited:
            shutil.copy2(src, out_dir / src.name)
            print(f"  ↳ copied untouched: {src.name}")
    for src in in_dir.glob("*.png"):
        if src.name not in edited:
            shutil.copy2(src, out_dir / src.name)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input_dir> <output_dir>")
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
