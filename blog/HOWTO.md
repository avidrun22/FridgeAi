# How to publish a blog post

Two posts a week — Tuesdays and Thursdays. The Telegram bot will nudge you each morning at 9am Pacific.

## Quick reference

```
# 1. Start a draft
cp blog/drafts/_template.html blog/drafts/MY-SLUG.html
# 2. Open it in your editor, write the post.

# 3. Preview locally — from the REPO ROOT (not blog/):
cd ~/fridgeai-native && python3 -m http.server 8000
# Open in browser: http://localhost:8000/blog/drafts/MY-SLUG.html
# Iterate until you're happy. Nothing is published yet.

# 4. Publish: move out of drafts/ + add a card to the index
mv blog/drafts/MY-SLUG.html blog/MY-SLUG.html
# (then edit blog/index.html — copy an existing card and update link, date, title, excerpt)

# 5. Deploy
# In Telegram: /deploy
# Or from the Mac: python3 ~/fridgeai-native/scripts/deploy_website.py
```

## What goes in each step

### 1. Drafting

Anything in `blog/drafts/` is **excluded from deploy** so you can iterate freely. The template (`blog/drafts/_template.html`) has the full HTML scaffold — nav, footer, signup form, share styling — so a draft looks identical to a real post when previewed.

Update these fields in the template before writing:
- `<title>` (and the matching `og:title`)
- `<meta name="description">` (and matching `og:description`) — one sentence, used in Google + social previews
- `<meta property="og:url">` and `<link rel="canonical">` — point to the future live URL `https://ok2eat.com/blog/MY-SLUG.html`
- `<meta property="article:published_time">` and the visible `article-meta` date
- The `article-title` heading
- The `article-body` content

### 2. Local preview

`python3 -m http.server 8000` from the **repo root** is essential — running it from `blog/` would break the absolute paths like `/blog/styles.css`. Browse to `http://localhost:8000/blog/drafts/MY-SLUG.html` and you'll see exactly what readers will see, including the signup form (it'll fail to actually submit unless you also expose port 8000 to Supabase, which you don't need for preview).

Stop the server with `Ctrl+C` when done.

### 3. Publishing

Two manual steps before deploy:
1. **Move the file** out of `drafts/`. The deploy script auto-includes everything in `blog/` except the `drafts/` folder.
2. **Add a card** to `blog/index.html`. Just copy an existing `<a class="post-card">…</a>` block, change the href / date / title / excerpt.

### 4. Deploy

`/deploy` in Telegram is the production-deploy button. Roughly 30-second turnaround. The deploy script picks up everything new in `blog/` automatically — no need to update its asset list.

## Editing a published post

Same workflow, minus the move. Open `blog/MY-SLUG.html` in your editor, save, `/deploy`. The change is live in ~30 seconds.

If you want to edit a published post without it being half-broken in production while you work, move it back to `drafts/`, edit, move back, deploy. The downside is the URL 404s during that window.

## Style + voice notes

Personal first-person. Specific over abstract — "an avocado I forgot in the back of the drawer" beats "produce that goes bad." Short paragraphs. One idea per `<h2>` section. End with a soft CTA toward the app or the next post.

Topics for the founder series, in order:
1. Why I built ok2eat — origin story (published 2026-04-29)
2. How I cut our grocery bill by optimizing what we already have
3. How I always know what to buy when I'm not at home
4. What real spending data taught me about my buying habits

After the founder series, alternate between food-waste tips, expiry myths, and simple-recipe posts. Always honest, never preachy.
