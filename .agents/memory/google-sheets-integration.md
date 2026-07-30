---
name: Google Sheets Integration
description: Trạng thái tích hợp Google Sheets — cách đọc credentials, endpoints, và fallback VPS
---

# Google Sheets Integration

## Credential loading (cả Replit và VPS)
- Replit: đọc từ Secret `GOOGLE_SERVICE_ACCOUNT_JSON` (process.env)
- VPS: đọc từ file `data/google_sa.json` (được upload bằng scp trong deploy)
- Cả Python (`market_order_sync.py`) và Node.js (`sheetsSettings.ts`) đều hỗ trợ cả hai cách

**Why:** VPS systemd không thể nhận env var multiline (private key có newlines) nên dùng file fallback.

**How to apply:** Khi deploy lên VPS mới hoặc rebuild, cần scp file `data/google_sa.json` vào VPS trước khi restart bot-api.

## API endpoints (Node.js)
- `GET /bot/sheets/status` — kiểm tra credentials hợp lệ (không gọi Google API, chỉ validate JSON shape)
- `GET /bot/sheets/config` — đọc `data/sheets_config.json`
- `PUT /bot/sheets/config` — lưu `data/sheets_config.json`

## sheets_config.json fields
- `spreadsheet_id` — ID của Google Sheet
- `market_tab` — tên tab cho đơn hàng chợ (default: "Đơn hàng chợ")
- `default_tab` — tên tab mặc định
- `sync_enabled` — bật/tắt sync
- `tab_mappings` — ánh xạ sản phẩm → tab

## Admin panel
- `GoogleSheetsStatusBanner` component trong `market-orders.tsx` (SettingsPanel) hiển thị trạng thái kết nối
- Không thay đổi UI cũ, chỉ thêm banner phía trên khi mở panel
