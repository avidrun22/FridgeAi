#!/usr/bin/env bash
# Render the 6 ok2eat App Store screenshot HTMLs to PNG at exactly
# 1290×2796 (6.7" iPhone 15 Pro Max — required by Apple).
#
# Two-step pipeline:
#   1. Headless Chrome renders the HTML using whatever viewport size it
#      ends up giving us (macOS Retina + new headless mode produces
#      ~1199×2600 instead of the requested 1290×2796; that's a known
#      Chromium quirk).
#   2. Python+Pillow resizes the rendered PNG to exactly 1290×2796.
#      Apple App Store Connect rejects any 6.7" upload that isn't
#      pixel-exact, so this step is non-negotiable.
#
# Apple Color Emoji ships with macOS, so the food emojis (🥬 🥛 🐟 etc.)
# render correctly here — the sandbox where these HTMLs were authored
# can't render emoji, hence committed PNGs show squares until you re-run.
#
# Run from this directory:
#   chmod +x render.sh && ./render.sh

set -e

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "✗ Google Chrome not found at $CHROME"
  echo "  Install Chrome from https://www.google.com/chrome/ or edit this"
  echo "  script to point at a different Chromium-based browser."
  exit 1
fi

# Pillow check — used for the exact-size resize step. If missing, install
# into the system Python user dir (no virtualenv needed).
if ! python3 -c "import PIL" 2>/dev/null; then
  echo "→ Installing Pillow (one-time)…"
  python3 -m pip install --user --quiet --break-system-packages Pillow 2>/dev/null || \
    python3 -m pip install --user --quiet Pillow
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

# Step 1: render each HTML with headless Chrome.
for frame in 01_eat_me_first 02_recipe_modal 03_dashboard 04_receipt_scan 05_settings 06_dual_date; do
  echo "→ rendering $frame …"
  "$CHROME" \
    --headless \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --force-device-scale-factor=1 \
    --default-background-color=FFFFFFFF \
    --virtual-time-budget=4000 \
    --window-size=1290,2796 \
    --screenshot="$HERE/$frame.png" \
    "file://$HERE/$frame.html" \
    2>/dev/null
done

# Step 2: force exact 1290×2796 via Pillow. LANCZOS for the highest-
# quality resampling.
echo ""
echo "→ resizing all 6 PNGs to exactly 1290×2796 …"
python3 - <<'PY'
from PIL import Image
import os
for name in ["01_eat_me_first", "02_recipe_modal", "03_dashboard",
             "04_receipt_scan", "05_settings", "06_dual_date"]:
    path = f"{name}.png"
    img = Image.open(path)
    if img.size != (1290, 2796):
        img = img.convert("RGB").resize((1290, 2796), Image.LANCZOS)
        img.save(path, "PNG", optimize=True)
    print(f"  ✓ {path}  →  {img.size[0]}×{img.size[1]}")
PY

echo ""
echo "✓ 6 screenshots ready in $HERE"
echo "  Drop them into App Store Connect → ok2eat → v1.16 →"
echo "  6.7\" Display screenshot slot."
