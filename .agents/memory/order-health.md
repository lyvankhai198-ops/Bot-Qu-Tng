---
name: Order Health Check architecture
description: Health Check redesign — uses orders.json as sole data source, stores results in order_health.json, uses standardised ResultCode enum.
---

## Rule
Health Check KHÔNG dùng accounts.json. Nguồn dữ liệu duy nhất là orders.json (email, password, twoFA đọc từ đơn hàng).

## ResultCode enum (checkers/index.ts)
ACTIVE | PACKAGE_LOST | PASSWORD_INVALID | ACCOUNT_BANNED | ACCOUNT_LOCKED |
REQUIRE_EMAIL | REQUIRE_PHONE | CAPTCHA | NETWORK_ERROR | TIMEOUT | NO_PLUGIN | UNKNOWN

ACTIVE + PACKAGE_LOST = job status "done". Everything else = job status "failed".

## Storage
- `data/order_health.json` — `{ config: {workerCount, timeoutMs}, checks: { [orderId]: HistoryEntry[] } }`
- `data/health_jobs.json` — job queue; key field is now `orderId` (was `accountId`)

## Plugin detection
`detectPluginType(productName)` in checkers/index.ts — lowercase match: "grok" → grok plugin.

## API routes (all under /bot/orders/health/*)
- GET  /bot/orders/health         — all orders + latest healthCode + summary
- GET  /bot/orders/health/config  — worker config
- PUT  /bot/orders/health/config  — update config
- POST /bot/orders/health/check   — body { orderId? } — enqueue one or all non-refunded
- GET  /bot/orders/:id/health     — history for one order (newest first)
- GET  /bot/orders/health/jobs    — job queue (supports ?status=&orderId=)
- DELETE /bot/orders/health/jobs/done — clear finished jobs
- DELETE /bot/orders/health/clear — clear history

Old routes /bot/accounts/health/* still exist but are legacy.
Old /bot/health/jobs also updated to use orderId filter.

## Frontend
- orders.tsx: "Kiểm tra tất cả" button in header, "Kiểm tra" (Stethoscope icon) per row,
  health badge column, Health Check tab inside edit modal (HealthTab component polls jobs).
- account-health.tsx: repurposed as Order Health Monitor — summary cards, queue panel,
  table of all orders with latest health code, per-order check button, history dialog.

**Why:** User spec says "nguồn dữ liệu duy nhất là danh sách đơn hàng". No separate account table.
