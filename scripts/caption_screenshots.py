#!/usr/bin/env python3
"""
Add App Store caption overlays to ok2eat screenshots.

Overlays a bold caption at the TOP of each screenshot, replacing the
ok2eat brand-header band (y~120-340). iOS status bar above and page
content below stay intact.

Output: ~/Downloads/redacted/captioned/IMG_*.PNG
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

SRC_DIR = Path("/sessions/wizardly-great-cray/mnt/Downloads/redacted")
OUT_DIR = SRC_DIR / "captioned"
OUT_DIR.mkdir(exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf"

# Caption bar geometry — covers the brand-header band, preserves iOS status bar
BAR_Y0 = 120
BAR_Y1 = 340
BAR_BG = (12, 124, 75)   # ok2eat green — high-contrast brand color
TEXT_FILL = (255, 255, 255)  # white on green for max impact

# (filename, caption text, font_size override if needed)
CAPTIONS = [
    ("IMG_7892.PNG", "Never throw out food again",     58),  # Fridge home
    ("IMG_7897.PNG", "Save what's about to spoil",      60),  # Alerts
    ("IMG_7899.PNG", "Share your fridge with family",   58),  # Manage inventory
    ("IMG_7896.PNG", "One list. Both phones. In sync.", 56),  # Shopping list
    ("IMG_7898.PNG", "Reorder from any retailer",       60),  # Reorder picker
    ("IMG_7894.PNG", "Recipe ideas from your fridge",   58),  # Plan tab
]


def caption_screenshot(src_path: Path, out_path: Path, caption: str, font_size: int):
    img = Image.open(src_path).convert("RGB")
    W, H = img.size
    draw = ImageDraw.Draw(img)
    # Solid brand-color bar covering the ok2eat header band
    draw.rectangle((0, BAR_Y0, W, BAR_Y1), fill=BAR_BG)
    # Center caption text in the bar
    font = ImageFont.truetype(FONT_BOLD, font_size)
    bbox = draw.textbbox((0, 0), caption, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    text_x = (W - text_w) // 2
    text_y = BAR_Y0 + ((BAR_Y1 - BAR_Y0) - text_h) // 2 - bbox[1]
    draw.text((text_x, text_y), caption, font=font, fill=TEXT_FILL)
    img.save(out_path, "PNG")
    print(f"  ✔ {src_path.name}: \"{caption}\"")


def main():
    print(f"Captioning {len(CAPTIONS)} screenshots → {OUT_DIR}")
    for fname, caption, fsize in CAPTIONS:
        src = SRC_DIR / fname
        out = OUT_DIR / fname
        if not src.exists():
            print(f"  ⚠ skipped (not found): {src}")
            continue
        caption_screenshot(src, out, caption, fsize)
    print(f"\nDone. Upload these to App Store Connect.")


if __name__ == "__main__":
    main()
