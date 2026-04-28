# ok2eat Telegram bot — commands reference

Bot: **@LogenGGbot** (chat ID `8569688753`)

> Tip: pin this list (or the latest `/help` message) at the top of your Telegram chat with the bot for quick phone access. To pin in Telegram on iOS: tap-and-hold any message → **Pin**.

This file is the canonical reference. The `/help` command in the bot mirrors it. When new commands ship, both this file and `/help` are updated.

---

## 🚀 Action

| Command | What it does |
|---|---|
| `/deploy [msg]` | Deploys the current `ok2eat.html` to **ok2eat.com** via the Netlify API. Optional message becomes the deploy title. ~15 seconds. |
| `/idea <text>` | Appends a new item to the **Inbox** section of `BACKLOG.md` with today's date. Triage later from the doc. |

## 📊 Status checks

| Command | What it does |
|---|---|
| `/ping` | Sanity check — returns `pong`. Confirms the bot poller is running on the Mac Mini. |
| `/status` | Current App Store review state for the latest build. |
| `/uptime` | Mac Mini uptime + load average (`uptime` command output). |
| `/disk` | Disk-free on root (`df -h /`). |
| `/gitstatus` | Working-tree changes (`git status --short`) in the project repo. |
| `/commits [N]` | Last **N** commits, oneline. Default 5, max 20. |
| `/resend` | Resend.com domain verification status — overall + per-record (DKIM, SPF MX, SPF TXT, DMARC). Use this to know when ok2eat.com is verified for sending email. |

## 📋 Reference

| Command | What it does |
|---|---|
| `/backlog` | Returns the full `BACKLOG.md` (truncated if longer than ~3700 chars). |
| `/help` | Lists all commands (mirrors this file). |

## 🛠 Maintenance

| Command | What it does |
|---|---|
| `/reset` | Clears the saved Claude conversation history for the bot's free-text mode. Useful if context drifts or starts feeling off. |

---

## 💬 Free-text messages

**Anything without a leading slash routes to Claude** (running on Anthropic Sonnet 4.6). Claude has read-only tools available:

- App Store review status
- Tail recent logs (`tail_log`)
- Git inspection (`git_status`, `git_log`)
- System stats (`system_stats`)
- PostHog analytics (`event_count`, `active_users`, `new_users`, `top_events`, `total_events`)

Useful for ad-hoc questions like:

- "What's in the last 50 lines of `daily_report.err`?"
- "How many barcode_scanned events this week?"
- "Show the last 10 commits with diffs."
- "Are notifications still firing? Check the digest cron logs."

Conversation history is preserved across messages until you run `/reset`.

---

## 🤖 Behind the scenes

- **Polling loop:** the Mac Mini runs `telegram_trigger.py` via launchd (`com.ok2eat.telegram_trigger`) every minute. It pulls new messages from Telegram's `getUpdates`, dispatches commands, and replies.
- **Free-text routing:** non-slash messages go through `claude_agent.py`, which calls the Anthropic API with a tool-using system prompt and the conversation history.
- **Source files** (on the Mac Mini):
  - Trigger + commands: `~/fridgeai-native/.appstoreconnect/telegram_trigger.py`
  - Claude agent: `~/fridgeai-native/.appstoreconnect/claude_agent.py`
  - Backlog: `~/fridgeai-native/BACKLOG.md`
  - This doc: `~/fridgeai-native/COMMANDS.md`

## 🔄 Adding a new command

1. Add a `cmd_yourname(args)` function in `telegram_trigger.py`.
2. Add it to the `HANDLERS` dict.
3. Add it to the `cmd_help()` text block.
4. Add a row to this file.
5. Test with `python3 ~/fridgeai-native/.appstoreconnect/telegram_trigger.py` once (or just send the new command).
6. Commit.
