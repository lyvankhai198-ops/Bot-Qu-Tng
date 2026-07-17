---
name: Broadcast targeting
description: How the bot's broadcast queue works with different targets
---

## pending_broadcasts.json schema
```json
[{ "message": "...", "target": "all|has_received|no_received|user:<id>", "queued_at": "..." }]
```

## Targets
- `"all"` — send to all users in users.json
- `"has_received"` — only users where has_received_gift == true
- `"no_received"` — only users where has_received_gift == false
- `"user:<id>"` — send directly to one user (used by warranty resolution in api-server)

## Bot worker
Daemon thread in bot.py polls every 30 seconds. Uses urllib (stdlib, no requests needed) to call Telegram Bot API directly for direct messages. Uses PTB context.bot for nothing — all sends are raw HTTP.

**Why:** PTB job_queue requires apscheduler extra. Using a plain thread + urllib avoids the dependency.
