# Screenshot Redaction (App Store / marketing)

Reusable workflow for replacing PII (real names, emails, household names)
in app screenshots with **realistic fake data** — so they look like a real
user's app, not a censored field. App Store reviewers and prospective users
both react better to "Sarah · Member" than to "█████████████ · Member".

Example output: `IMG_7892.PNG` had "Grila" → "My Family"; `IMG_7899.PNG`
had three real emails → `greg@example.com` / `sarah@example.com` /
`alex@example.com`. Done in a script, not by hand, so it's repeatable.

---

## When to use

- App Store Connect screenshot uploads
- Marketing-page hero images
- Demo videos that need staged accounts
- Press kit / blog post screenshots

## When NOT to use

- Internal QA — leave PII visible there for debugging
- Where you actually want to show a public-facing brand (logos, etc.)

---

## How to use the script

`scripts/redact_screenshots.py` is parameterized via a `JOBS` list at the
top of the file. Each job specifies one source file + a list of redactions
to apply. Workflow:

1. **Save your screenshots** somewhere accessible (`~/Downloads`).
2. **Profile the rows** to find exact text positions:
   ```python
   from PIL import Image
   img = Image.open("IMG_XXXX.PNG").convert("RGB")
   from scripts.redact_screenshots import profile_rows
   profile_rows(img, x0=130, x1=700, y0=300, y1=2000, step=10)
   ```
   Look for spikes in dark-pixel count — those are text rows. Use the
   y-bands to fill in your cover bboxes.
3. **Edit `JOBS`** to match your screenshots.
4. **Run** `python scripts/redact_screenshots.py ~/Downloads ~/Downloads/redacted`
5. **Inspect output** — first run almost never gets it right. Iterate.

---

## Lessons learned

### Cover background sampling

- **Sample from a clean swatch**, not "near the text" — text pixels mixed
  in tint your fill.
- **For card UI** (white cards on tinted page bg), sample card INTERIOR.
  Page-bg sample leaves visible "tabs" sticking out past rounded card
  edges.

### Cover bounds

- Extend bounds **5-10px past visual text bbox** to catch antialiasing.
  Bold "G" curves and "y" descenders extend further than expected.
- Stop bounds **before adjacent UI elements** (pills, icons, the next
  card). Easier to tweak than to undo an over-cover.

### Auto-detection vs hardcoded

- **Pixel-row scanning** > eyeballing for finding text positions.
- **Hardcoded bboxes** > auto-detection for the actual cover step.
  Auto-detection grabs too much (subtitles, pills, adjacent cards).

### Font choices

- **Liberation Sans Bold** is the closest free analog to SF Pro Display
  on Linux/Docker. Available out of the box on Ubuntu/Debian.
- For exact iOS fidelity you'd need SF Pro from Apple's developer site —
  not redistributable.
- Match font *size* by measuring the original text height in pixels;
  use 1.1-1.2× as the font size value (Pillow's text height is slightly
  smaller than the bbox).

---

## Free tools (alternative to this script)

If you don't want to script it, several free apps cover the same ground:

### Image redaction (alternatives to this Python script)

| Tool | Cost | Best for |
|---|---|---|
| **Preview** (built-in macOS) | Free | Quick black-bar redaction. Annotate → Rectangle. No text replacement. |
| **Figma** | Free for individuals | Best balance — paste screenshot, draw white rectangles + text overlays. UI-friendly. |
| **Photopea** ([photopea.com](https://www.photopea.com)) | Free web app | Photoshop-equivalent, runs in browser, full layer/text support. |
| **GIMP** | Free, open source | Most powerful but steepest learning curve. |
| **Pixelmator Pro** | $50 one-time | Polished native macOS, great text rendering. |

**Recommendation for ok2eat-style work:** **Figma** for one-offs (paste,
edit, export), this **Python script** for batches you'll want to re-run.

### Video editing (for demo clips)

| Tool | Cost | Best for |
|---|---|---|
| **iMovie** (built-in macOS) | Free | The 3 storyboards from the BACKLOG. Solid for landscape clips destined for website hero. |
| **CapCut** ([capcut.com](https://www.capcut.com)) | Free | Vertical/social cuts (TikTok, Reels, Shorts). **Auto-captions** are a killer feature given the backlog calls out "captions baked in." |
| **DaVinci Resolve** | Free | Professional-grade. Overkill for short marketing clips but the free tier is fully featured. |
| **Descript** | Free 1hr/month | Text-based editing — edit the transcript, the video follows. Auto-transcript. Great for talking-head founder videos. |
| **ScreenFlow** | $169 one-time | Mac-native screencast tool. Worth it if you're doing many demo videos. |

**Recommendation for the 3 demo clips in the backlog:**
- iOS Simulator + `xcrun simctl io booted recordVideo --codec=h264 ./clip.mov` for clean source captures
- **iMovie** for landscape edits → website hero / YouTube
- **CapCut** for vertical 9:16 cuts → IG Reels / TikTok / Shorts (auto-captions = essential since most people watch muted)

---

## Future improvements

- **Auto-OCR**: instead of profile_rows + manual bbox, use Tesseract or
  Apple's Vision API to find text bboxes automatically. Reliable for
  printed UI text.
- **Watermark template**: standard "Demo data — fictional accounts"
  watermark to apply to all marketing screenshots, ensures clarity even
  if a screenshot is reused later.
- **Locale variants**: same JOBS structure could output English / Spanish
  / French screenshot variants if we ever localize.

---

## File checklist for an App Store ship

For each ship, the iPhone 6.5" device family needs these 5 screenshots
in App Store Connect → App Store tab → 1.X version page:

1. **Hero shot** — fridge with real-feeling staged data
2. **AddModal** showing receipt-scan + barcode tiles
3. **Shared shopping list** with creator initials
4. **Past lists** with reuse CTA
5. **Order-via-retailer** picker

Run through this script as the final step before upload, regardless of
whether you used real or fake accounts to capture.
