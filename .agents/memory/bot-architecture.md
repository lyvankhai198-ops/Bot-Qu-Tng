---
name: Bot architecture
description: How the Telegram bot, API server, and admin panel are wired together
---

## Structure
- `bot.py` — Python PTB bot + Flask keep-alive on port 5000. 5 menu buttons. No admin contact info shown to users.
- `artifacts/api-server` — Node.js/Express/TypeScript REST API on port 8080. Auth via SESSION_SECRET Bearer token. Reads/writes data/ JSON files directly.
- `artifacts/admin-panel` — React + Vite SPA on port 20130 at /admin-panel/. Calls api-server via generated hooks from @workspace/api-client-react.
- `data/` — shared JSON file store at workspace root. Both bot.py and api-server read/write the same files.

## Data files
accounts.json, users.json, user_states.json, settings.json, claimed_users.json, banned_users.json, logs.json, pending_broadcasts.json, orders.json, warranty_requests.json, intro.json

## Bot conversation states (stored in user_states.json)
- conv_state: "support_lookup" | "check_lookup" | "report_issue"
- _report_order_id: stored order ID when in report_issue state

## Key decisions
**Why:** Admin info must never be shown on bot; support flow uses order lookup instead of showing contact username.
**How to apply:** Support button → ask for order ID/email → look up orders.json → show details → inline Báo Lỗi button → create warranty_requests entry.
