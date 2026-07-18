# Bot Quà Tặng AI

Bot Telegram tặng quà tự động với admin panel web và API server, hỗ trợ song ngữ Việt/Anh.

## Run & Operate

- `python bot.py` — chạy Telegram bot (polling mode + Flask keep-alive :5000)
- `pnpm --filter @workspace/api-server run dev` — API server (port 8080)
- `pnpm --filter @workspace/admin-panel run dev` — Admin panel tại `/admin-panel/`
- `pnpm --filter @workspace/api-spec run codegen` — tái tạo API hooks từ OpenAPI spec
- `bash scripts/deploy.sh` — push GitHub + deploy VPS (dùng bởi agent)

> Sau codegen luôn chạy: `sed -i 's/zod\.looseObject/zod.object/g' lib/api-zod/src/generated/api.ts`

## Stack

- Python 3 + python-telegram-bot 22 + Flask (bot)
- pnpm workspaces, Node.js, TypeScript
- API: Express (artifacts/api-server)
- Frontend: React + Vite + Tailwind (artifacts/admin-panel)
- Dữ liệu: flat JSON files trong `data/`
- API codegen: Orval (từ lib/api-spec/openapi.yaml)

## Where things live

- `bot.py` — entry point bot Telegram
- `data_manager.py` — đọc/ghi tất cả JSON files
- `translations.py` — chuỗi VI/EN
- `data/` — accounts, users, orders, warranty_requests, settings, logs, pending_broadcasts
- `lib/api-spec/openapi.yaml` — nguồn gốc sự thật API
- `artifacts/api-server/src/routes/botAdmin.ts` — tất cả REST routes
- `artifacts/admin-panel/src/pages/` — các trang admin

## Architecture decisions

- Không dùng database — flat JSON files, cả bot và api-server đọc/ghi trực tiếp
- Broadcast targeting qua field `target` trong pending_broadcasts.json: `"all"|"has_received"|"no_received"|"user:<id>"`
- Bot không expose thông tin admin — user tự tra đơn hàng qua ID/email
- Zod codegen ra `zod.looseObject` (v4 API) nhưng workspace dùng Zod v3 — phải patch sau mỗi codegen

## User preferences

- **Auto-deploy sau mỗi lần cập nhật**: Sau khi hoàn thành thay đổi, agent tự động push GitHub rồi deploy VPS qua `scripts/deploy.sh`
- VPS: `root@103.180.138.203`, thư mục `/root/Bot-Qu-Tng`, service `gift-bot`
- Credentials lưu trong Replit Secrets: `VPS_PASSWORD`, `VPS_HOST`, `VPS_USER`, `VPS_DEPLOY_PATH`, `VPS_SERVICE`

## Gotchas

- Sau `pnpm run codegen` phải chạy ngay lệnh sed patch Zod (xem trên)
- Bot dùng polling mode — nếu restart bị lỗi 409 Conflict thì tự resolve sau vài giây
- VPS dùng Python virtualenv tại `/root/Bot-Qu-Tng/venv/` (tránh conflict system packages)
- Force push GitHub nếu nhánh diverge: `git push origin main --force`
