# ok2eat — Product Hunt launch prep

Working doc. Edit anything that doesn't read right.

---

## Account setup (~5 min, one-time)

Sign in at https://www.producthunt.com — easiest is **Sign in with X** so it auto-pulls @ok2eatapp's avatar/handle. After the OAuth handshake:

1. Set the **maker profile** name to **Greg** (first name only — keeps the founder presence personal without surfacing the full legal name in public copy).
2. Add a one-line bio: *"Solo maker. Building ok2eat — the fridge tracker that answers 'what do we have to eat?'"*
3. Link **website** to https://ok2eat.com
4. Verify the email matches `hello@ok2eat.com` (so launch-day comment notifications come to the inbox you read).

---

## Launch date

**Target: Saturday, 2026-05-16** — gives us 11 days to capture screenshots, build "Upcoming" subscribers, and queue a newsletter blast. Saturday rationale: lower launch volume than Tue/Wed, so easier to crack top 10 with a small audience. PH's homepage doesn't reset for weekends, so weekend products stay featured into Monday.

Backup date if 5/16 looks crowded: **Saturday, 2026-05-23**.

---

## Tagline (60 char hard limit)

PH shows the tagline next to the logo in the homepage feed — it's the single most important piece of copy because it determines whether people click through. Three options, ranked:

1. **"Snap a grocery receipt. Your fridge populates in 10 seconds."** *(59 chars)* — concrete, shows the unique unlock, leads with verb. Recommended.
2. **"The fridge tracker that answers 'what do we have to eat?'"** *(56 chars)* — leans on the hero framing from the website. Good if we want continuity with the X thread.
3. **"Track your fridge by snapping the grocery receipt"** *(49 chars)* — shorter, punchier, but slightly less benefit-forward.

---

## Description (260 char limit)

For couples and households who never know what to make for dinner. Snap a grocery receipt — fridge populates in 10 seconds. See what's expiring soon, get 3 recipes from what you have, share inventory across phones. Free, iOS + web. No subscription, no ads.

*(256 chars — fits.)*

---

## Topics (pick up to 4)

- **Productivity**
- **Lifestyle**
- **iOS** (or "iOS Apps" depending on PH's current taxonomy)
- **Food and Drink** (or "Cooking")

---

## Logo

`assets/ph/logo-240.png` — already resized to PH's 240×240 spec from `assets/icon.png`. Cream background + avocado. Solid background avoids any transparency issues with PH's dark/light theme switching.

---

## Gallery (4-6 images, you upload these)

**You need to capture 5 iOS screenshots from your device.** Easiest path:

1. Run the app on your iPhone (the v1.14 TestFlight or App Store build).
2. Take screenshots via volume-up + side button.
3. AirDrop them to your Mac → save into `~/fridgeai-native/assets/ph/`.
4. Recommended sequence (in upload order):
   - **01-home.png** — fridge home view with several items, one or two highlighted as "expiring soon"
   - **02-receipt.png** — receipt-scan screen mid-flow (the camera/preview), or the result screen showing items just added
   - **03-recipes.png** — recipe ideas screen, three options visible, ingredients used highlighted
   - **04-shared.png** — shared list / household view (shows the multi-phone story)
   - **05-digest.png** — daily digest / morning notification, or settings showing the digest configuration

**Optional but high-leverage:** a 30-60 second screen recording of the receipt-scan flow. iOS has this built in:

> Settings → Control Center → add **Screen Recording** to your controls. Then swipe down from the top-right corner of the home screen, tap the red record button, do the demo (open app → Scan Receipt → snap photo → fridge populates → tap one item → see recipes), tap the red bar at the top to stop. The video lands in Photos. AirDrop to Mac, save into `assets/ph/demo.mov`.

Products with video consistently outperform static-only on PH.

**Brand fallback (already in repo):** `assets/ig-carousel/01-hero.png` through `05-cta.png` are 1080×1080 typographic posters in the brand palette. Note that 01-hero still shows the old *"Less waste, more savings"* tagline — skip that one unless we update the text first. Slides 02-05 are tagline-neutral and usable as supporting gallery slots if we run short on real screenshots.

---

## Maker comment (the most important text on the whole page)

This is the first comment on the launch, posted by the maker (you). It's what people read before deciding to upvote. Aim for ~250 words, founder voice, story-led.

> Hi PH 👋
>
> I'm Greg, the maker of ok2eat. I built it because for years my wife and I never knew what to make for dinner. We'd open the fridge at 7pm, stare, close it, and order takeout — four nights a week. The fridge was full; we just couldn't see what we had clearly enough to assemble a meal in the time we had patience for.
>
> Every previous "track your fridge" app I tried (or tried to build for myself with a notes app, a whiteboard, even a Trello board) collapsed within two weeks because nobody wants to type in 30 grocery items.
>
> So I built ok2eat around one unlock: snap a photo of the grocery receipt, and AI vision reads every item, sets expiry estimates, populates your fridge — about 10 seconds, no typing. From there: a home view sorted by what's expiring soonest, three AI-generated recipe ideas built from what's actually in there tonight, real-time inventory sync between household members.
>
> Six months of using it ourselves: takeout dropped from 4 nights/week to 1, grocery bill dropped ~25%, and the 7pm staring-at-the-fridge moment basically disappeared.
>
> Free. No subscription, no ads. iOS + web (so Android works through the browser). I'm here all day — would love to hear what you're using now, what's working, what isn't. Real feedback shapes the roadmap directly (tier-1 next: SMS-based shared fridge for households where one person doesn't want another app on their phone).
>
> — Greg

---

## Pre-launch (the 11 days before 5/16)

The "Upcoming products" page is free pre-launch traffic — visitors can subscribe to be notified the morning of launch. Goal: 100+ "notify me" signups before launch. PH-internal data shows products with 100+ pre-launch subscribers usually crack top 10.

Once your account is live, schedule the launch via PH's "Coming Soon" flow. That generates the upcoming-products URL. Then:

- Drop the URL in your existing X thread as a quote-post: *"Going live on Product Hunt next Saturday — get notified ↓"*
- Add it to the next newsletter blast (you can run `scripts/send_post_blast.py` with a dedicated post that announces the launch + asks subscribers to subscribe to the PH page).
- Personal asks to friends/family/early users: send a DM with the upcoming URL and "would mean a lot if you'd hit notify."
- Drop the URL in your X profile bio for the week.

---

## Launch day (Saturday 5/16) playbook

**5:00 AM Pacific** — launch goes live (PH days start at midnight Pacific, but most engagement is 5am-noon).

**5:00-5:30 AM** — post your maker comment as the first reply. This must be the FIRST comment on the launch.

**5:30 AM** — push the launch from your channels:
- Quote-post the X thread with the PH URL
- Newsletter blast: subject line *"We're live on Product Hunt today"*, one-paragraph body, big CTA button to the PH page
- DM the 5-10 friends/family/users who said they'd support
- Personal LinkedIn post if applicable

**Throughout the day** — reply to every comment within an hour. Engagement velocity is what the algorithm rewards.

**~Noon Pacific** — the rankings firm up. You'll know if you're top 10 by then.

**~5pm Pacific** — final push. Re-share to anyone in your network who hasn't seen it yet.

**Bedtime** — screenshot your final ranking. The badge is permanent on the PH page regardless of where you land.

---

## After the launch

Whatever badge you earn (Top 5 / Top 10 / Featured), grab the embed code from the PH page and add it to:
- ok2eat.com homepage (right under the App Store CTA)
- The blog footer
- Your X profile bio

These badges are social proof that compounds — they make the next launch (or App Store reviewer, or future investor pitch) easier.

---

## Open questions for Greg

- Want me to draft the launch-day **newsletter blast** copy too? Different vibe than the launch thread — short, urgent, "today only" framing.
- Want me to draft the **launch-day X thread** (a 3-tweet quote-post chain pointing back at the original 9-tweet thread + the PH page)?
- Do you have anyone in your network who'd be willing to be a "hunter" (PH user with their own following who submits the product instead of you)? Self-hunting works fine but a hunter with 1k+ followers can amplify reach materially. If yes, name them and I'll draft a DM ask.
