# ok2eat v1.16 — App Store screenshots

Six App Store screenshots for the v1.16 submission, generated from HTML at exact 6.7" iPhone 15 Pro Max dimensions (1290×2796px). Each frame follows the storyboard in `.appstoreconnect/v1_16_app_store_listing.md` §7.

## Frame inventory

| # | File | What it sells |
|---|------|---------------|
| 1 | `01_eat_me_first.html`   | Headline tab — fridge ranked by urgency. THE reposition. |
| 2 | `02_recipe_modal.html`   | One-tap recipes for what's about to spoil. |
| 3 | `03_dashboard.html`      | Money saved · pounds rescued · CO₂ avoided. Proof of value. |
| 4 | `04_receipt_scan.html`   | Snap a receipt, your fridge fills itself. |
| 5 | `05_settings.html`       | Dietary chips + allergens + household stepper. Personalization. |
| 6 | `06_dual_date.html`      | USDA shelf life pill — "the app shows both." Authority. |

## How to render to PNG

The PNGs already committed here were rendered in the Cowork sandbox, which doesn't have a color emoji font installed — food emojis show as squares. **Run the render script on your Mac to get correct emoji rendering** (Apple Color Emoji is bundled with macOS).

```bash
cd marketing/app_store_screenshots
chmod +x render.sh
./render.sh
```

Output: six PNGs at 1290×2796 px, ready to upload.

If headless Chrome ever fails for some reason, you can also screenshot manually:

```bash
open 01_eat_me_first.html
# In Chrome: View → Developer → Developer Tools → ⌘⇧P → "Capture full size screenshot"
```

## Where they go

App Store Connect → ok2eat → version 1.16 → **6.7" Display** screenshot slot. Upload all six in order (Apple infers the carousel order from filename when you drag-multi-select; if it asks you to confirm, the numerical prefix keeps them in storyline order).

Apple also has slots for **6.5"** (older iPhone Pro Max) and **5.5"** (older iPhone Plus). For an indie launch:

- **6.7"** is required and required first. The 1290×2796 PNGs we generate fit perfectly.
- **6.5"** is shown on iPhone 11 Pro Max etc. Resize the same PNGs to 1242×2688 (use `sips -z 2688 1242 *.png -o ../6_5_inch/`).
- **5.5"** is increasingly optional — Apple will fall back to a downscaled 6.7" image if you skip it. Skip for v1.16 launch; revisit if conversion is weak.

## Editing copy

Each frame's marketing band has three customizable pieces:

- **Eyebrow** (`<div class="eyebrow">`) — small caps DM Mono, e.g. `// V1.16`
- **Headline** (`<h1 class="headline">`) — Bricolage Grotesque 700, the lead line. `<em>` wraps the green-accent words.
- **Subhead** — optional second line of context.

The 30% top band leaves enough breathing room for ~3 lines of headline. Keep one line on dense screens (Receipt Scan), let it stretch to 3 on the punchiest ones (Eat Me First, Dashboard).

## Brand spec

Pulled from `.appstoreconnect/marketing_strategy/brand_context.md`:

- Cream `#F0EADC` — background, marketing band
- Surface `#F7F3E8`
- Forest green `#3E721D` — accent text + brand mark
- Soft green `#A6D388` — the halo glow upper-right of each marketing band
- Text `#1C261C`

Fonts: **Bricolage Grotesque** (headlines + body) + **DM Mono** (eyebrows + small caps). Both loaded from Google Fonts at render time.

## Why screenshot mockups instead of real device screenshots?

Three reasons, in order of importance:

1. **No real-data dependency.** Frame 3 (Dashboard) shows $84.20 of lifetime money saved. Capturing that on a real device requires either an account with weeks of tracked usage (which I don't have on the founder account at submission time) or fake data. Mockup is more honest about being a marketing visual + more controllable.
2. **Carousel cohesion.** App Store readers swipe through 6 frames in 4-5 seconds. The first thing their eye locks onto is the brand band — making it consistent across all 6 frames gives the carousel a single visual rhythm. Real device screenshots vary in lighting, scroll position, status bar (battery, time), and notification dots.
3. **Iterate without rebuilding.** A copy tweak (e.g. moving the dashboard hero number from $84 to $120 next quarter) is a one-line HTML edit + re-render. A real device screenshot needs a fresh build, a fresh account state, and a fresh screenshot.

Apple's review guidelines explicitly allow mockup-style screenshots as long as they "accurately represent the app's functionality and visual experience." Every UI element in these frames maps directly to a real v1.16 screen.
