---
name: Warranty scan feature
description: Quét Đơn Còn Bảo Hành — architecture, deploy pattern, and known issues
---

## Files
- `warranty_scan.py` — Python CLI: `--mode preview|create-sheet|export-xlsx|export-csv`
- `artifacts/api-server/src/routes/warrantySheets.ts` — Express routes mounted in index.ts
- `artifacts/admin-panel/src/pages/warranty-scan.tsx` — React page at `/warranty-scan`
- `data/warranty_scan_history.json` — scan history including `orders_snapshot` for re-export
- `data/warranty_exports/<scan_id>.xlsx|csv` — cached export files

## Deploy pattern (VPS)
API server runs compiled JS. After code changes:
1. `git push` to GitHub
2. SSH to VPS: `cd /root/Bot-Qu-Tng/artifacts/api-server && npm run build && systemctl restart bot-api`
3. Admin panel: build locally `PORT=3000 BASE_PATH=/admin-panel/ pnpm --filter @workspace/admin-panel run build`, then SCP dist/public/ to VPS

## Presets
- `chatgpt_30d`: ChatGPT Plus BHF 30D — include: chatgpt/gpt plus keywords + 30d keywords; exclude: api/codex/token/edu etc.
- `grok_super`: Grok Super BHF — include: grok super/grok

## Data flow
market_orders.json → _matches_preset() → _valid_status() → _get_start_date() → calc days_left → _deduplicate() → qualified[]

**Why:** orders_snapshot stored in history so XLSX/CSV can be re-generated without re-running the scan.

## Known issue
Google Sheets 403 "caller does not have permission" on ALL write operations despite SA showing as Editor in sharing UI. SA email: sheet-bot@order-sync-504015.iam.gserviceaccount.com. Fix: user must remove and re-add SA in sheet sharing settings.
