#!/usr/bin/env bash
# Render the 6 ok2eat App Store screenshot HTMLs to PNG at 1290×2796 (6.7"
# iPhone 15 Pro Max — the required App Store device tier).
#
# Uses headless Chrome on macOS. The Mac's Apple Color Emoji renders the
# food emojis correctly (🥬 🥛 🐟 etc.) — the same HTML rendered in Linux
# headless Chrome shows fallback squares because the sandbox doesn't have
# a color emoji font installed.
#
# Run from this directory:
#   chmod +x render.sh && ./render.sh
#
# Output: 01_eat_me_first.png through 06_dual_date.png, each 1290×2796.
# Drop those straight into App Store Connect → Screenshots → 6.7" iPhone.

set -e

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "✗ Google Chrome not found at $CHROME"
  echo "  Install Chrome from https://www.google.com/chrome/, or edit this"
  echo "  script to point at a different browser (Edge, Brave, Chromium all work)."
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

for frame in 01_eat_me_first 02_recipe_modal 03_dashboard 04_receipt_scan 05_settings 06_dual_date; do
  echo "→ rendering $frame.png …"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --no-sandbox \
    --window-size=1290,2796 \
    --screenshot="$HERE/$frame.png" \
    "file://$HERE/$frame.html" \
    2>/dev/null
done

# Crop any 1px white-fringe at edges from headless rendering (sips is a
# stock macOS tool, no install needed).
for png in *.png; do
  sips -z 2796 1290 "$png" > /dev/null
done

echo ""
echo "✓ 6 screenshots rendered at 1290×2796"
echo "  Drop them into App Store Connect → ok2eat → v1.16 Screenshots → 6.7\" iPhone."
echo ""
ls -lh *.png
