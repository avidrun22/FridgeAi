# ADHD-Positioning Marketing Pivot (2026-05-04)

Per Reddit research synthesis — the strongest single growth lever
identified. ADHD adults are ~17M people in the US, vocal, share apps
that work, and ok2eat already serves them perfectly without any
product changes. This doc captures the launch package: hero copy,
homepage rewrites, and the r/ADHD post.

**Important framing:** this is positioning, not the *only* market.
ok2eat still works for everyone; we're just leading with the
strongest emotional hook. Same product, sharper pitch.

---

## Homepage hero rewrites for `ok2eat.html`

Current hero copy is generic ("Less waste, more savings"). Three
candidate hero rewrites, ranked by my gut for this audience:

### Option A — empathic, specific (recommended)

```
Headline:   ok2eat remembers what's in your fridge,
            so you don't have to.

Subhead:    For brains that buy a bag of spinach with
            real intentions and find it liquefied a
            week later.

CTA:        Get ok2eat — Free for iOS
```

### Option B — direct, punchy

```
Headline:   Forgot you bought it?
            We didn't.

Subhead:    ok2eat tracks what's in your fridge,
            reminds you before it spoils, and tells
            you what to make tonight. Free.

CTA:        Get the app
```

### Option C — playful, signals "we get it"

```
Headline:   The crisper drawer is not a graveyard.

Subhead:    ok2eat is the fridge brain you'd build
            for yourself if executive function let you.
            Scan a receipt, get reminders before food
            spoils, and know what to cook tonight.

CTA:        Free for iOS
```

**Pick:** I'd ship A first (most universal) with a short founder note
underneath: *"I built this because I have ADHD and kept buying produce
I forgot to eat. — Greg, ok2eat"*. The "humans built this" signal
performs disproportionately well in this audience.

### Other site copy to update

The sub-features section currently leans utilitarian. Reframe each
feature card with ADHD-empathic copy:

| Feature | Current angle | New ADHD angle |
|---|---|---|
| Receipt scan | "Snap a receipt to add items" | "10 items in 10 seconds. No typing. No clicking." |
| Daily digest | "Email digest of what's expiring" | "Tomorrow's forgotten celery, today" |
| Shared lists | "Share with your household" | "Both phones know we need eggs" |
| Reorder | "Tap to reorder from Instacart" | "Out of milk? Two taps. Done." |
| Recipe ideas | "Suggested recipes from your fridge" | "What can I make tonight with this?" |

---

## r/ADHD launch post (draft)

**Subreddit rules to check before posting:**
- r/ADHD usually requires no promotional/marketing content. Posts must
  read as personal experience, not pitch. Strict mod team.
- r/ADHD_partners — for partners of ADHDers — slightly more lenient,
  good secondary target.
- r/adhdwomen — strong community, often more receptive to tools.
- Best practice: comment helpfully on others' threads for 1-2 weeks
  first to build account credibility before the launch post.

### Draft post (first-person, no pitch, no link in body)

**Title:** I kept throwing out produce so I built an app for ADHD brains
like mine

**Body:**

> Hi all. Long-time lurker, ADHD adult. I do that thing where I buy a
> bag of spinach on Sunday with real intentions, forget it exists by
> Wednesday, and clean out a sad green liquid the following weekend.
> Same with leftovers, deli meat, the half jar of pesto pushed to the
> back.
>
> I tried fridge-tracking apps and they were all built for
> neurotypical planners — type in everything you bought, set the
> expiration manually, remember to check it. The act of opening the
> app to record what I bought defeated the point.
>
> I'm a developer so a few months ago I just made the thing I wanted:
>
> - Snap a photo of your grocery receipt → fridge inventory in ~10s, no
>   typing. Picks up brand names + categories automatically.
> - Daily email at whatever time you pick — "you've got 2 things
>   expiring in 3 days, here's what they are." Low-pressure, no app
>   open required.
> - When you eventually do open the app, it surfaces what's about to go
>   bad first, with one-tap recipe ideas using what you have.
> - Shared with my partner so we both know what's in the fridge before
>   buying duplicates.
>
> It's free, no account upsells, no AI subscription. I'm not making
> money on it — I just got tired of throwing food away. If anyone here
> wants to try it, the App Store link's in my profile. Mostly I'm
> curious whether anyone else has the same fridge-blindness problem
> and what's worked for you.

**Why this voice works:**
- Vulnerable (specific failure: "sad green liquid")
- Personal (not "I'm building," "I built," past tense, lived experience)
- Mentions cost ("free") to short-circuit the "what's the catch"
  reflex
- Asks a question at the end → invites comments → ranks the post
- Link is in profile, not body — respects subreddit no-link norms

**Cross-post strategy:**
- Day 0: r/ADHD primary post
- Day 1-2: light variants on r/adhdwomen, r/ADHD_partners,
  r/foodwaste (if exists), r/zerowaste, r/EatCheapAndHealthy
- Don't simul-post — Reddit penalizes that. Stagger by a day each.

**Account prep before posting:**
- Make sure your Reddit account isn't brand-new (>30 days old, some
  comment history). If it's fresh, comment in r/ADHD for ~2 weeks
  first on others' threads.
- Don't have any obvious "promo" history.

---

## Blog post idea (long-form companion)

Add a new post to ok2eat.com/blog/ matching the same voice, fully
SEO-optimized:

**Title:** "I'm an ADHDer who kept throwing out groceries. Here's
what finally worked."

**Outline:**
1. The pattern — Sunday grocery hope → Tuesday motivation crash →
   Friday fridge of regret. Use the Reddit quote pattern: "Wednesday
   you forget about the vegetables in the crisper drawer."
2. Why every existing app failed me — they all assume executive
   function we don't have. Manual entry, manual category setup,
   manual everything.
3. The mindset shift — passive tracking > active discipline. Your
   brain shouldn't have to do the work.
4. The system that works — receipt scan, daily email, "use it up
   today" surface, shared with partner.
5. (Soft CTA) — "I built ok2eat to do this for me. It's free."

This post hits the SEO target ("ADHD food waste app") AND the
authentic founder narrative AND lands as social-proof for the
homepage hero.

---

## Sequence to ship

1. **Tonight or tomorrow** — pick a hero option, paste into
   `ok2eat.html`, deploy via `/deploy`.
2. **Day 1** — write the blog post (use the outline above as
   skeleton). Add to `/blog/`.
3. **Day 2-3** — Reddit account prep: comment helpfully on r/ADHD
   threads. Don't post yet.
4. **Day 7-10** — drop the Reddit post. Engage with replies in the
   first 2 hours (Reddit's algorithm rewards early-velocity).
5. **Track:** PostHog `user_signed_up` daily count + Search Console
   for "adhd food waste app" rankings. Check daily for 2 weeks.

---

## What to skip

- **Don't pivot the App Store listing yet.** Apple's review team
  is conservative; "ADHD" in the App Store description could trigger
  a medical-claim review. Keep ASC neutral, ADHD positioning lives on
  the website + Reddit only.
- **Don't add medical-claim language** anywhere. We're not "treating"
  ADHD — we're a fridge tracker that happens to serve this audience
  well. The legal line matters.
- **Don't pay for r/ADHD ads.** The community sees ads as
  exploitation. Organic only.
