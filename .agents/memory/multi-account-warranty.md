---
name: Multi-account warranty support
description: Group warranty flow for reporting multiple accounts in one request
---

## Overview
Users can now report 1–N accounts per support request. Group requests are stored with `type:"group"` in `warranty_requests.json`.

## Bot conversation states
- `support_multi_input` — waiting for email list (one per line)
- `support_multi_desc` — waiting for shared description
- User state keys: `_mw_found` (JSON), `_mw_not_found` (JSON), `_mw_sel` (comma-sep indices)

## Inline keyboard callbacks
- `mw:all` — report all found accounts → skip to desc
- `mw:pick` — enter per-account toggle mode
- `mw:t:N` — toggle account N in selection
- `mw:ok` — confirm selection → go to desc
- `mw:back` — clear state, return to main menu
- `mw:noop` — no-op (disabled button when 0 selected)

## Data structure (warranty_requests.json)
```json
{
  "id": "...",
  "type": "group",
  "accounts": [
    { "id": "reqid-0", "orderId": "...", "email": "...", "productName": "...", "status": "pending", ... }
  ]
}
```
Overall `status` is recomputed from sub-account statuses (see `_recomputeGroupStatus` in botAdmin.ts and `update_warranty_account` in data_manager.py).

## API endpoints (botAdmin.ts)
- `POST /bot/warranty/:id/accounts/:accId/replacement`
- `POST /bot/warranty/:id/accounts/:accId/refund`
- `POST /bot/warranty/:id/accounts/:accId/reject`
- `POST /bot/warranty/:id/accounts/:accId/resend`

**Why:** Each sub-account needs independent resolution; overall group status auto-recomputes.

## Admin panel (warranty.tsx)
- Group requests identified by `w.type === "group"`
- `GroupCard` component with collapsible account list
- Per-account action buttons open shared modal with `activeAcc` state
- Modal title shows the sub-account email when `activeAcc !== null`

## Spam protection
- `get_open_warranty_emails(user_id)` returns set of all emails with open (pending/processing) requests — checked before adding to `found[]`
- Max accounts: `settings.maxAccountsPerRequest` (default 20)

## Ack notification for group
- Customer message says "đã tiếp nhận {N} tài khoản" instead of showing orderId
