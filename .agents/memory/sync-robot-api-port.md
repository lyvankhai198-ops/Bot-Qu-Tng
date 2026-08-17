---
name: Sync robot API port & canboso XLSX structure
description: Critical config fix for sync_robot.py + how canboso orders tabs map to XLSX downloads
---

## Rule
`API_BASE_URL` in `/etc/systemd/system/sync-robot.service` MUST be `http://localhost:3002` (not 8081).

**Why:** The Node.js API server binds to port 3002 (from `artifacts/api-server`). When `API_BASE_URL=localhost:8081`, `get_admin_token()` silently fails → token="" → all `call_api()` calls return HTTP 401 → `existing_order_ids` = empty set → all 1371 XLSX rows pass `new_only` filter → import API also returns 401 → result 0 new orders, everything silently skipped.

**How to apply:** If sync shows "1371 dòng mới" but "0 đơn mới" at end → check `API_BASE_URL` in service file. Fix: `sed -i 's|localhost:8081|localhost:3002|' /etc/systemd/system/sync-robot.service && systemctl daemon-reload && systemctl restart sync-robot`

## Canboso orders page XLSX structure

- Default download (any tab click) → 854323B → 1371 rows → `pre_order` type orders
- Tab "Đơn hàng chợ" → same 854323B → same 1371 rows (same file, includes market_order type in same XLSX)
- Tab "Đơn hàng slot" → separate XLSX, 42583B → 50 rows → slot orders with `Email slot` column
- Tab "Đơn đặt trước" → no download button (default download covers it)
- Tab "Đơn bảo hành" → no download button
- Tab "Đơn đang hold tiền" → download times out

`market_order` type orders appear in the MAIN 1371-row XLSX (same file as "Đơn hàng chợ" tab). They have `accounts=[]` (no delivered accounts in XLSX). The xlsx-import API handles empty accounts fine — creates order without items.

## ORDERWRAHHNFR6
Not found in any XLSX download from canboso. Not in market_order API results. Likely a typo or deleted order. Lower priority.
