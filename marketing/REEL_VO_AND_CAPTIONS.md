# v1.16 reel — voiceover + caption workflow

Process for layering a voiceover and tighter captions onto `Downloads/v116_phone_reel_v2.mp4`
(25.6s, 1080×1920, 30fps, no audio). Reusable for future reels.

---

## 1. Lock the script to the timeline

The reel already has 8 scene beats. The script has to be paced to those beats — read it out
loud with a stopwatch before recording anything.

| t (s)   | beat                  | line (≈)                                              | word count |
|---------|-----------------------|--------------------------------------------------------|------------|
| 0.0–2.7 | Add modal hook        | "Bought groceries? Add them in seconds."               | 6          |
| 2.7–4.7 | Typing Hass avocado   | "Type, scan, or upload a receipt."                     | 7          |
| 4.7–9.4 | Eat Me First reveal   | "Your fridge — ranked by what's about to go bad."      | 10         |
| 9.4–10.1| Recipe spinner        | "Tap any item…"                                         | 3          |
| 10.1–15.8| Recipe results       | "…and get three recipes that use it, plus four more about to spoil." | 14 |
| 15.8–17.5| Shopping list        | "Plan the next shop together."                         | 5          |
| 17.5–23.2| Diet + allergens     | "Set your diet once. Every recipe respects it."        | 8          |
| 23.2–23.9| Family invite        | (beat — no VO, just music swell)                       | 0          |
| 23.9–25.6| Outro                | "ok2eat — free on iPhone and the web."                 | 8          |

Total: ~61 words over ~25s = **~145 wpm**. That's deliberately on the slow side of
conversational; reel VO that goes faster than 160 wpm gets unintelligible on phone speakers.

Tighten any line you stumble on. The script above is a draft — read it cold three times and
cut any word that doesn't earn its breath.

---

## 2. Record the VO

Three options, ranked by what I'd actually do:

**Option A — your phone + Voice Memos (free, sounds like you).**
1. Quiet room, phone 6–8 inches from your mouth, slightly off-axis (not pointing straight at
   it — that's where the plosives ruin takes).
2. Record one continuous take per line, not the whole script in one go. Easier to redo lines.
3. Export each take as a .m4a. AirDrop or iCloud Drive into `~/fridgeai-native/marketing/vo_takes/`.

**Option B — ElevenLabs (paid, sounds professional, ~5 min).**
1. elevenlabs.io → free tier gives 10k chars/month, enough for many reels.
2. Use the "Adam" or "Bill" preset for a warm male voice that matches a founder tone, or
   pick whatever you like — preview each on the full script.
3. Stability 50, similarity 75, style 0 is a good starting point. Crank style if it sounds
   robotic, drop it if it over-emotes.
4. Generate the full script as one block, download as MP3.

**Option C — OpenAI TTS (cheapest, decent quality).**
```bash
# api key in .appstoreconnect/openai_key.txt or similar
python3 -c "
from openai import OpenAI
c = OpenAI()
r = c.audio.speech.create(model='tts-1-hd', voice='onyx',
    input=open('script.txt').read())
r.stream_to_file('vo.mp3')
"
```
'onyx' is the warmer male voice; 'alloy' is more neutral. tts-1-hd is the higher-quality model
and worth the ~$0.030/1k chars (about a penny for this reel).

For a founder-led launch reel, **Option A** is the right call. Your voice on your product
matters more than studio polish.

---

## 3. Tighten the captions

The current burned-in captions are subtitle bands that span the bottom 7% — fine for sound-off
viewers but they fight the VO. Two changes:

**a. Use word-level captions, not full lines.** Reels/TikTok captions pop one or two words at
a time, synced to the VO. Use [`auto-subtitle`](https://github.com/m1guelpf/auto-subtitle) or
Whisper directly:

```bash
pip install openai-whisper --break-system-packages
whisper vo.mp3 --model medium --output_format srt --word_timestamps True \
  --output_dir /tmp/captions/
```

That gives you `vo.srt` with per-word timestamps. Convert to ASS for proper styling:

```bash
ffmpeg -i vo.srt /tmp/captions/vo.ass
```

Then edit `/tmp/captions/vo.ass` so the `Style:` line uses your brand colors:

```
Style: Default,Inter,72,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,
       -1,0,0,0,100,100,0,0,1,4,0,2,40,40,200,1
```

That's white text, semi-transparent black box, 72pt, anchored bottom-center, 200px above
bottom edge (above the iPhone home indicator).

**b. Burn captions in via ffmpeg, after the VO is mixed:**

```bash
ffmpeg -i v116_phone_reel_v2_with_vo.mp4 -vf "ass=/tmp/captions/vo.ass" \
  -c:v libx264 -pix_fmt yuv420p -c:a copy -movflags +faststart \
  -y v116_phone_reel_final.mp4
```

If you keep the existing baked-in caption bands, the new word-by-word captions will overlap.
Either re-render the scene clips without the `drawbox`/`drawtext` overlays, or move the new
captions higher (change `MarginV` in the ASS Style from 200 to ~500 so they sit mid-frame).

---

## 4. Mix the VO into the video

Assuming you've got `vo.mp3` (or .m4a) totaling ~24s — pad with silence so it matches video
length, then mux:

```bash
# Pad VO to 25.6s with 0.5s lead-in silence
ffmpeg -i vo.mp3 -af "adelay=500|500,apad" -t 25.6 -y vo_padded.m4a

# Mux into video
ffmpeg -i v116_phone_reel_v2.mp4 -i vo_padded.m4a \
  -c:v copy -c:a aac -b:a 192k -shortest \
  -y v116_phone_reel_v2_with_vo.mp4
```

If you want light background music under the VO (most launch reels do):

```bash
# Mix VO (full volume) with music (15% volume), ducked under VO
ffmpeg -i v116_phone_reel_v2.mp4 -i vo_padded.m4a -i music.mp3 \
  -filter_complex "[2:a]volume=0.15,atrim=duration=25.6[m];
                   [1:a][m]amix=inputs=2:duration=first:dropout_transition=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest \
  -y v116_phone_reel_v2_with_vo.mp4
```

Royalty-free music sources:
- **YouTube Audio Library** — free, no attribution, search "upbeat acoustic"
- **Epidemic Sound** — $15/mo, sounds professional, used by most YT creators
- **Pixabay Music** — free, decent quality, watch for tracks that go viral and feel overused

For a launch reel, something acoustic + percussive at 100–120 BPM lands well. Avoid anything
with vocals — they fight your VO.

---

## 5. Quality check before publishing

Watch the final reel on three surfaces:

1. **Your phone, sound on, headphones** — most accurate to how viewers will see it.
2. **Your phone, sound off, captions only** — 85% of feed scrollers watch muted.
3. **A laptop with cheap speakers** — catches if VO is too quiet or music too loud.

Common gotchas:
- VO lands 100–200ms too early on every scene change — bump `adelay` up by ~150ms.
- Captions cover key UI in screen recordings — raise `MarginV` so the action stays visible.
- Music drowns out VO during the quietest VO line — increase music ducking or drop music to 10%.
- Outro card is silent and feels dead — add 1s of music tail before the cut.

---

## 6. Reusable pipeline (for future reels)

Save the final ffmpeg pipeline into `scripts/build_reel.sh` so the next launch reel is one
command from script.txt + vo.mp3 + clips:

```bash
#!/usr/bin/env bash
# build_reel.sh <vo_file> <music_file> <output>
# Assumes clips already concatenated as input.mp4
set -e
VO="$1"; MUSIC="$2"; OUT="$3"

# 1. Transcribe VO to word-timed SRT
whisper "$VO" --model medium --output_format srt --word_timestamps True \
  --output_dir /tmp/captions/

# 2. Convert SRT to styled ASS
ffmpeg -i /tmp/captions/*.srt /tmp/captions/vo.ass

# 3. Pad VO + mix with music + burn captions
ffmpeg -i input.mp4 -i "$VO" -i "$MUSIC" \
  -filter_complex "[1:a]adelay=500|500,apad[v];
                   [2:a]volume=0.15,atrim=duration=25.6[m];
                   [v][m]amix=inputs=2:duration=first[a];
                   [0:v]ass=/tmp/captions/vo.ass[vid]" \
  -map "[vid]" -map "[a]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k \
  -movflags +faststart -y "$OUT"
```

Then for the next reel: write script, record VO, pick music, run `./scripts/build_reel.sh`.

---

## Quick reference

- Reel: `Downloads/v116_phone_reel_v2.mp4` (25.6s, no audio yet)
- Script target: ~145 wpm, ~61 words
- Caption style: 72pt Inter, white on semi-transparent black, 200px from bottom
- VO mix: VO at 100%, music ducked to 15%, 500ms lead-in silence
- Output target: 1080×1920, 30fps, AAC 192k, faststart for web upload
