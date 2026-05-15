# v1.20 — Animated demo tutorial reel (storyboard)

Reframed from the user's Chrome-iOS feedback: "I think an animated tutorial would be better, to teach the user. Then you want them to get the App."

Right call. The static screenshot reel I built earlier (`v1_20_demo_reel.mp4`) sells the *idea* well enough, but it doesn't teach. An animated tutorial shows the user the exact taps that pay off — and the payoff *is* the conversion.

---

## Format

- **9:16 vertical, 1080×1920, 30fps** — same as the static reel
- **45 seconds total** — long enough to teach the flow, short enough for Reels/Shorts/TikTok auto-play
- **No voice-over** — every screen has on-screen captions, plays muted by default (the social-feed default)
- **Soft background loop** — optional 80-100 BPM lo-fi, royalty-free, ducked to -20dB. We're not relying on audio.
- **Animated finger taps** — a single semi-transparent green circle pulses + shrinks on each tap. Industry standard for app demos.

---

## Storyboard (8 scenes, 45s)

### Scene 1 — Cold open (0:00–0:04, 4s)

**Visual:** Cream background. Centered: a screenshot of the user's iPhone home screen (or a generic blank smartphone frame). The Safari/Chrome icon glows briefly. Cursor taps it. Browser opens, types `app.ok2eat.com/demo`, hits Go.

**Caption (top of frame, fades in over 0.5s):** `Most apps make you sign up first. Watch this.`

**Why it works:** Sets up the comparison without showing competitors. The "watch this" creates a "wait, what" lean-in.

### Scene 2 — Demo screen loads (0:04–0:08, 4s)

**Visual:** Phone frame already on screen. The /demo page fills it. Cream banner ("You're in demo mode") slides in from top. Then the 5 ranked items fade in one-by-one with a 100ms stagger (Cilantro → Salmon → Spinach → Milk → Beef).

**Caption (bottom):** `5 real items. Ranked by what spoils first.`

**Why it works:** The cascade animation makes the urgency-ranking concept visually obvious — items appear in priority order, not alphabetical.

### Scene 3 — Tap an item, see details (0:08–0:14, 6s)

**Visual:** Green tap circle pulses on `Cilantro` row → row briefly highlights → item-detail modal slides up from bottom. Shows: big emoji, name, "Expired" pill, 2×2 grid (Quantity / Category / Container / Status), Added + Expires dates.

**Caption (top):** `Tap any item — see what we track per row.`

**Sub-caption (overlaid in modal):** `Quantity · Category · Container · Status · Dates`

**Why it works:** This is the "ok2eat is *deeper* than it looks" moment. Selling depth without listing features. Most users don't realize an item has this much structure behind it.

### Scene 4 — Get recipes (0:14–0:22, 8s)

**Visual:** Detail modal slides down, tap circle pulses on `Get recipes` button on Cilantro row. Recipe modal slides up. Three recipe cards stack from top: Cilantro-lime salmon, Beef + spinach quesadillas, Creamy spinach skillet. Each card fades in with a 200ms stagger. The cursor scrolls down to reveal the third card.

**Caption (top):** `Three recipes that use what's already in your fridge.`

**Sub-caption (overlay on first card):** `Uses 3 of your top 5 items.`

**Why it works:** The connection from "expired item" to "specific recipe that solves it" is the entire pitch. We dwell on this scene the longest (8s) because it's the hero moment.

### Scene 5 — Add by hand (0:22–0:30, 8s)

**Visual:** Recipe modal slides down. Cursor taps `Add by hand` tile in the top row. AddDemoItem modal slides up. Cursor taps the input field. The word `Kale` types in character-by-character (~150ms per char). Cursor taps `Add to demo fridge`. Modal slides down. New `Kale` row slides into position #3 (slotting into the urgency ranking between Salmon and Spinach). Brief green glow on the new row.

**Caption (top, two-line):** `Type any food.\nWatch it slot into the ranking.`

**Why it works:** The slot-in animation IS the product. Once a viewer sees "I type, it appears in the right place," they get how the entire ranking system works.

### Scene 6 — The conversion gates (0:30–0:36, 6s)

**Visual:** Cursor taps `Scan a receipt` tile. SignupPromptModal slides up: "Scan your grocery receipt — snap a photo and we'll fill your fridge in seconds. Sign up free to try it on your next grocery run." Cursor hovers on `Create your account — free` button (doesn't tap).

**Caption (top):** `For the rest — receipt scan, saved fridge, shared lists — it's free.`

**Why it works:** Acknowledges the conversion gate honestly. Doesn't try to hide it. "It's free" lands harder when paired with the "no signup to try" framing from earlier.

### Scene 7 — Closing CTA (0:36–0:42, 6s)

**Visual:** Phone fades back to cream. Big text scales in from 80%: `app.ok2eat.com/demo`. Three short lines fade in below:
- "5 items pre-loaded"
- "Tap any one for 3 recipes"
- "60 seconds. No account."

The down-arrow from the static reel returns.

**Caption (top):** `Try it — link below.`

**Why it works:** Repeats the URL as the last thing on screen. Most viewers will pause-on-URL or screenshot, both of which help conversion.

### Scene 8 — Brand sting (0:42–0:45, 3s)

**Visual:** ok2eat logomark grows from small, settles centered. Tag below: `built solo · iOS + web · free, no ads`.

**Why it works:** Identity signature. Soft close. Founder framing earns the "I built this" trust.

---

## Production paths (pick one)

The honest gap: my sandbox can't render emoji and can't drive a real headless browser to record actual app interactions. So building this as I built the static reel — frame-by-frame in PIL — would be 30-50 hours of work for an animator-grade result. Three realistic paths:

### Path A — Greg records on Mac, I edit (fastest, ~2 hours total)

1. **You record** the live demo on your Mac:
   - Open `app.ok2eat.com/demo` in Safari, set window to iPhone-shape (430×932 via Inspect → Device)
   - QuickTime → New Screen Recording → record the 8-scene flow above at your own pace (~60-90s of raw footage)
   - Save the .mov to `/sessions/wizardly-great-cray/mnt/uploads/`
2. **I edit** the raw footage with ffmpeg:
   - Trim/speed-ramp each scene to hit the storyboard timings
   - Overlay captions (using ffmpeg's drawtext filter with Lato Bold)
   - Add animated tap circles at the exact tap moments
   - Render to 1080×1920 MP4 + 1080×1080 square variant for IG feed posts

This is the format I used for v1.16 (task #123-#124). Proven workflow.

### Path B — Find an indie animator on Fiverr / 99designs (~$80-200, 3-5 days)

Hand them this storyboard doc + the static reel as a visual reference. Look for "Lottie app animation" or "explainer animation 30s" listings. Output: a Lottie .json that can be exported as MP4 at any resolution. Reusable for future versions because Lottie is text-editable.

### Path C — Try Rive / Lottiefiles editor (DIY, ~3-4 hours your time)

Both have free tiers with mobile-app templates. Drop in your brand colors, drag screenshots in, animate the transitions, export MP4. Higher ceiling than Path A, lower ceiling than Path B.

**My recommendation:** Path A. You already have the screen-recording rhythm from v1.16, the storyboard is detailed enough to make a clean recording, and "edit + caption" is exactly what ffmpeg is good at.

---

## Caption font + color (consistent across all 8 scenes)

- Primary captions: **Bricolage Grotesque ExtraBold**, white text, 80px on a 12px-stroke `var(--text)` shadow. (When ffmpeg renders, we'll use **Poppins Bold** since Bricolage isn't on Greg's font path — both have similar character widths.)
- Sub-captions: **DM Mono Bold**, var(--green) `#3E721D`, 36px.
- Tap-circles: 200px diameter, `rgba(62, 114, 29, 0.45)`, scales from 1.0 → 1.4 over 350ms with ease-out, opacity fades 0.45 → 0 over same duration.
- All animations use `cubic-bezier(0.4, 0, 0.2, 1)` — Tailwind's default ease-in-out — for visual consistency with the actual web app.

---

## Captions sheet (paste into ffmpeg drawtext or Path-B animator brief)

| Scene | Start | End  | Position    | Text                                                          |
|-------|-------|------|-------------|---------------------------------------------------------------|
| 1     | 0.5s  | 4.0s | Top         | Most apps make you sign up first. Watch this.                 |
| 2     | 5.0s  | 8.0s | Bottom      | 5 real items. Ranked by what spoils first.                    |
| 3     | 9.0s  | 13.5s| Top         | Tap any item — see what we track per row.                     |
| 3     | 10.5s | 13.5s| Middle-lower| Quantity · Category · Container · Status · Dates              |
| 4     | 15.0s | 22.0s| Top         | Three recipes that use what's already in your fridge.         |
| 4     | 17.5s | 22.0s| Card overlay| Uses 3 of your top 5 items.                                   |
| 5     | 23.0s | 30.0s| Top (2 line)| Type any food.\nWatch it slot into the ranking.               |
| 6     | 31.0s | 36.0s| Top         | For the rest — receipt scan, saved fridge — it's free.        |
| 7     | 37.0s | 42.0s| Top         | Try it — link below.                                          |
| 7     | 38.0s | 42.0s| Center      | app.ok2eat.com/demo                                           |
| 7     | 39.5s | 42.0s| Below URL   | 5 items pre-loaded · Tap any one · 60 seconds · No account.   |
| 8     | 42.5s | 45.0s| Center      | built solo · iOS + web · free, no ads                         |

---

## Open questions for you

1. **Music?** I lean toward dropping it entirely — most reels are watched muted, and brand audio is more effort than it's worth for v1.20. If you want music, suggest a specific track (Epidemic Sound / Artlist).
2. **Square (1:1) variant?** YT Shorts + IG Reels are 9:16; IG feed + LinkedIn auto-prefer 1:1 or 4:5. Want me to also output 1080×1080 from the same source?
3. **End frame still?** Reels auto-pause on the last frame for ~5s. The brand-sting scene at 42-45s is built to be a good freeze frame, but if you want the URL frame as the freeze instead, we swap the order (scene 7 last). Worth thinking about.

Pick your path (A/B/C) and answer those three questions, and we ship the v2 reel.
