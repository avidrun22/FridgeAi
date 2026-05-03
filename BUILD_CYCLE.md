# iOS Build & Ship Cycle

Reproducible step-by-step for shipping an ok2eat iOS update. Every section
calls out gotchas we've actually hit — read them once, paste-and-go forever.

**Replace `<NEW_VERSION>` and `<NEW_BUILD>` throughout with your target
values** (e.g. `1.15` and `19`). The whole cycle takes ~15-20 min once the
code change is committed.

---

## Naming convention (read this first if shipping a new version)

We use **two-segment versions** (`1.13`, `1.14`, `1.15`, etc.) — never
three-segment (`1.0.x`, `1.1.x`).

**Why:** Apple's iTunes Lookup API normalizes `X.Y.Z` by concatenating the
last two segments — `1.0.10` becomes `1.10`, `1.1.0` becomes `1.11`. This
is genuinely ambiguous when parsed back as a version (does `1.10` mean
`[1,10]` or `[1,1,0]`?), and bit us in v1.0.9 → v1.0.10 → v1.1.0 ships:
the in-app update prompt looped because the version compare always
disagreed with itself. Switching to two-segment patches sidesteps the
problem entirely. See `compareVersions` in `App.js` for the workaround
that exists for older builds.

**Build numbers** must increase monotonically across all uploads, even if
you re-upload the same version (e.g. `1.14/18` → `1.14/19` is OK,
`1.14/18` → `1.14/18` is rejected). When in doubt, leave a small buffer —
v1.13 skipped build 16 and uploaded as build 17 for headroom.

---

## 0. Preflight (in your shell, repo root)

```bash
python3 -c "import json; d=json.load(open('app.json')); e=d['expo']; print(f\"app.json: version={e['version']}, build={e['ios']['buildNumber']}\")"
```

Confirm output matches your target version + build.

```bash
git status --short
git log --oneline -1
```

Working tree should be clean (no `M` lines for tracked files). Latest
commit should be the one introducing your changes for this version.

---

## 1. Prebuild — regenerates `ios/`

```bash
npx expo prebuild --clean --platform ios
```

⚠️ `--clean` wipes the entire `ios/` folder and regenerates it from
`app.json` + Expo plugins. This is intentional: produces a clean,
reproducible Xcode project. Any manual edits to `ios/*` files are gone.

Takes ~30-60 seconds. Output ends with CocoaPods installing.

---

## 2. Bump `MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` in pbxproj

After prebuild, the Xcode project gets default version/build numbers
(usually `1.0` / `1`). You **must** sed these to match `app.json`. macOS
BSD `sed` requires the empty string after `-i`:

```bash
sed -i '' 's/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = <NEW_VERSION>;/g' ios/*.xcodeproj/project.pbxproj
sed -i '' 's/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = <NEW_BUILD>;/g' ios/*.xcodeproj/project.pbxproj
grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION" ios/*.xcodeproj/project.pbxproj | sort -u
```

Verify output looks like:

```
				CURRENT_PROJECT_VERSION = <NEW_BUILD>;
				MARKETING_VERSION = <NEW_VERSION>;
```

Both fields appear twice in the project (Debug + Release configurations).
After `sort -u` they collapse to one line each. **If you see an old
value mixed in,** rerun the sed step — sometimes the regex misses a
field that has a trailing space or different formatting.

---

## 3. Open Xcode

```bash
open ios/*.xcworkspace
```

Use the **`.xcworkspace`** file, NOT `.xcodeproj` — the workspace pulls
in CocoaPods dependencies. Opening `.xcodeproj` directly will fail to
link native modules at build time.

First open after a prebuild can take 30-60 seconds while Xcode indexes.
Activity indicator at the top will spin until ready.

---

## 4. Archive

In Xcode:

1. Top toolbar — **destination dropdown** (says "iPhone 15" or similar
   simulator by default). Click it and select **"Any iOS Device (arm64)"**
   at the top of the list.
2. Menu bar: **Product → Archive**
3. Wait 5-10 minutes — toolbar shows "Building" then "Archiving."

When archive completes, the **Organizer window** auto-opens with your new
archive at the top of the list.

---

## 5. Upload to App Store Connect

In Organizer:

1. Pick the just-built archive (top of the list, dated today)
2. Click **"Distribute App"**
3. Choose **"App Store Connect"** → **Next**
4. Choose **"Upload"** → **Next**
5. Leave default options (signing automatic, symbols included)
6. Click **Upload**
7. Wait for upload (~2-5 min) — Organizer shows progress

After upload, App Store Connect needs another ~5-15 min to "process" the
build. During processing, the build appears in TestFlight in a
"Processing" state.

---

## 6. Submit for review in App Store Connect

Open [appstoreconnect.apple.com](https://appstoreconnect.apple.com):

1. **My Apps** → **ok2eat**
2. **App Store** tab (NOT TestFlight)
3. Click the **"+ Version"** button next to ok2eat → enter `<NEW_VERSION>`
   → Create. (If `<NEW_VERSION>` already exists from a prior attempt,
   click into it.)
4. Paste your release notes into the **"What's New in This Version"**
   field. **NO EMOJI** (see below).
5. Scroll down to **Build** → click "+" → pick the build you just
   uploaded. (It only appears here once App Store Connect finishes
   processing.)
6. **Save** at the top right
7. Click **"Add for Review"** at the top right
8. Answer the export-compliance + content rights questions (same as
   prior submissions — typically "no encryption beyond HTTPS" and "no
   third-party content")
9. **Submit to App Review**

Apple typically reviews in 24-72 hours.

---

## Release notes — what works, what doesn't

### Avoid emoji in "What's New in This Version"

App Store Connect's release-notes field rejects emoji silently with a
generic error code. Discovered the hard way during v1.14. Use plain
text only — no `🔍`, `✅`, `📷`, etc.

### Format that works

- 5-line max per item: 1-line header in plain English, 2-3 lines of
  description.
- Lead with the user benefit, not the feature name.
- 4-6 items per release is the sweet spot. More than 6 and reviewers
  glaze over.
- End with the tagline: "— Less waste, more savings."
- Soft hyphens / em-dashes (`—`) work fine.

### Example structure (no emoji)

```
What's new in vX.Y:

Headline of biggest user benefit
2-3 lines explaining what they can now do that they couldn't before.

Second feature
Same pattern.

[etc.]

— Less waste, more savings.
```

---

## Common pitfalls

| Pitfall | Symptom | Fix |
|---|---|---|
| Forgot to `sed` after prebuild | "Bundle version must be greater than the previous one" at upload | Run Step 2's sed commands; verify with grep |
| Build number reused | "The build version X has already been used. Build versions must increase." | Bump build number, repeat from Step 1 |
| `sed -i` without `''` | Linux-style sed fails on macOS, leaves project unchanged | Always use `sed -i ''` on macOS (BSD sed) |
| Archived against simulator | Archive button missing or grayed out | Switch destination to "Any iOS Device (arm64)" |
| Opened `.xcodeproj` instead of `.xcworkspace` | Native module link errors at build | Always `open ios/*.xcworkspace` |
| Three-segment version (`1.0.10`) | Apple normalizes to `1.10` → in-app update prompt loops | Use two-segment versions only (`1.14`, `1.15`) |
| Emoji in "What's New" | Generic error, save fails | Plain text only |
| Upload finishes but build doesn't appear in ASC | Build still processing | Wait 5-15 min, refresh ASC TestFlight tab |
| TestFlight shows "Missing Compliance" | Upload succeeded but missing export-compliance answer | Click into the build in TestFlight → answer "Does your app use encryption?" → Submit |

---

## Quick recap card

Replace `<V>` and `<B>` with your target version + build:

```
After commit + push:

1. npx expo prebuild --clean --platform ios
2. sed -i '' 's/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = <V>;/g' ios/*.xcodeproj/project.pbxproj
3. sed -i '' 's/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = <B>;/g' ios/*.xcodeproj/project.pbxproj
4. grep -E "MARKETING_VERSION|CURRENT_PROJECT_VERSION" ios/*.xcodeproj/project.pbxproj | sort -u
5. open ios/*.xcworkspace
6. Xcode: destination = Any iOS Device → Product → Archive
7. Organizer → Distribute App → App Store Connect → Upload
8. ASC: My Apps → ok2eat → + Version <V> → paste release notes (NO emoji)
   → pick build <B> → Submit
```

---

## Per-ship checklist (copy this section into your commit message)

- [ ] Code change committed + pushed
- [ ] `app.json` bumped: version + iOS build number
- [ ] `lib/openFoodFacts.js` User-Agent matches new version (if you
      bumped MAJOR/MINOR — patch bumps don't strictly need it)
- [ ] Prebuild ran clean
- [ ] sed step verified by grep
- [ ] Xcode archive succeeded
- [ ] Upload succeeded; build processing in ASC TestFlight
- [ ] Release notes pasted (plain text, no emoji)
- [ ] Build picked in App Store version
- [ ] Export-compliance + content rights answered
- [ ] Submitted to App Review

---

## History — what shipped how

| Version | Build | Shipped | Notes |
|---|---|---|---|
| 1.0.3 | 1 | 2026-04-21 | First TestFlight |
| 1.0.4-1.0.6 | 2-7 | 2026-04-22 to 28 | Iterative fixes |
| 1.0.8 | — | 2026-04-29 | Shared household inventory |
| 1.0.9 | — | 2026-04-29 | Hotfix migration same-day |
| 1.0.10 | 12 | 2026-04-30 | "Fewer taps everywhere" |
| 1.1.0 / 1.11 | 14 | 2026-05-01 | Multi-list shopping + universal links. Apple normalized to "1.11" |
| 1.12 | 15 | 2026-05-01 | In-app update prompt hotfix; first 2-segment version |
| 1.13 | 17 | 2026-05-02 | 8 features (3 fixes + 5 list features); skipped build 16 |
| 1.14 | 18 | 2026-05-03 | OFF lib refactor + push notif hardening + ship catalog/type-ahead |
