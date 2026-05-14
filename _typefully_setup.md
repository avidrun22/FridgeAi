# Typefully setup — autodm + scheduling for ok2eat

A 10-minute one-time setup to enable the lead magnet workflow.

## Step 1 — Sign up for Typefully

Go to [typefully.com](https://typefully.com). Plans:

- **Free** — scheduling only, no autodm
- **Starter ($12.50/mo annual or $15/mo monthly)** — includes auto-DM. **This is what you need.**
- Pro and Premium are overkill at this stage

Sign up with your `hello@ok2eat.com` Google account so the billing receipts land in the right inbox.

## Step 2 — Connect the `@ok2eatapp` X account

1. Click your avatar (top right) → Settings → Accounts
2. Click "Connect X account"
3. Authorize via OAuth — this redirects you to X to grant access
4. Make sure you're logged into `@ok2eatapp` in the same browser before you do this, otherwise it'll connect the wrong account

If you accidentally connect the wrong account, click "Disconnect" on the account row and start over.

## Step 3 — Configure the autodm for the lead magnet post

After scheduling the lead magnet draft (Step 4 below), open the post in Typefully and:

1. Click "Auto-DM" in the right sidebar
2. **Trigger word**: `EXPIRE` (must match the keyword in the tweet body)
3. **Trigger**: "Reply contains keyword"
4. **Follow required**: Yes (forces commenters to follow before they get the DM)
5. **Reply required**: Yes
6. **Retweet required**: No (extra friction for marginal benefit)
7. **DM message**: paste the template from `_lead_magnet_drafts.md` (the "DM template" section)
8. **Sender link preview**: enable so the link shows a thumbnail in the DM
9. Save

## Step 4 — Schedule the post

1. Open `_lead_magnet_drafts.md` and copy your chosen variant (recommended: Variant A)
2. In Typefully, click "Compose"
3. Paste the tweet body
4. Click the image attach icon, upload `_v1_16_ig_image.png`
5. Set posting time per the recommendation in `_lead_magnet_drafts.md` (Tue/Wed/Thu 8-10am ET ideal)
6. Click "Schedule"

## Step 5 — Add the autodm warning line to the post body

⚠️ **Required by X TOS**: The post must mention that commenters will receive a DM, otherwise X may flag it.

Edit the scheduled post to include one of:

- "Comment EXPIRE — I'll DM you the link." (already in all variants ✓)
- Or "Reply EXPIRE for the DM."

The current drafts already include this, so you're covered.

## Step 6 — Pre-launch checklist

Before the post goes live, verify:

- [ ] You're logged into `@ok2eatapp` (not your personal X) in the same browser as Typefully
- [ ] The image preview looks correct in Typefully's preview pane
- [ ] The autodm is set to the same trigger word as the tweet body
- [ ] The DM template has the correct ok2eat.com/shelf-life URL
- [ ] The DM template has the correct App Store URL
- [ ] Push notifications are on so you can see comments coming in

## Step 7 — Day-of playbook (per `lead_magnet_principles.md`)

When the post goes live:

1. **First hour** — Reply to the first 5-10 commenters manually. A simple "Sent! Let me know what surprises you most." Boosts the post in the algo and humanizes the autodm.
2. **Hour 6** — Check Typefully autodm dashboard. If DMs sent < 20, the post is underperforming; plan a different hook for next week.
3. **Hour 24** — Check final engagement. Screenshot for `social_originals/lead_magnet_results.md`.
4. **Hour 48** — Pull data:
   - Comments with keyword
   - DMs sent (from Typefully)
   - New followers (from X analytics)
   - /shelf-life/ clicks (from PostHog — filter `outbound_web_app_click` events with referrer = x.com)
   - App installs from x.com referrer (PostHog)

Drop the numbers into the daily report Telegram so we have a record.

## Limitations to know

- Typefully's autodm only runs for **3 days** after the post goes live. Late comments don't get the DM. Most posts die off after 48h anyway, so this rarely bites.
- X's official autodm tools sometimes change rules. If Typefully ever stops working, alternatives: TweetHunter, Tweetpik, or DMagic. All similar pricing, similar features.
- DMs require the recipient to be **following you** OR have **DMs from anyone** turned on. Most casual users have DMs from anyone enabled by default, but a small percentage won't get the DM through. They'll get a reply on the post instead — which Typefully also handles automatically.

## Cost

- Typefully Starter: **$12.50/mo** (annual) or $15/mo
- This is the only new line item in the social stack. Everything else (PostHog, social_drafts.py, X account) is already paid or free.

## When to upgrade

Stay on Starter until you're posting 3+ lead magnets per month and want analytics across them. Pro is $30/mo and adds: deeper analytics, multiple X accounts, AI features (you don't need these — the Claude project replaces them).

## Sources

The Typefully autodm flow is the same one walked through in this video:
- [Hybrid method X writing system (transcript pasted in chat)](https://typefully.com)
