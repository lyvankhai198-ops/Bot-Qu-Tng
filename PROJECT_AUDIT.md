# PROJECT AUDIT — Bot Quà Tặng AI
> Ngày audit: 2026-08-18 | Source: https://github.com/lyvankhai198-ops/Bot-Qu-Tng

---

## 1. TELEGRAM COMMANDS

| Command | Alias | Chức năng | File | Function | Ghi chú |
|---------|-------|-----------|------|----------|---------|
| `/start` | — | Welcome + chọn ngôn ngữ VI/EN | `bot.py:544` | `cmd_start` | Hiện inline button chọn ngôn ngữ |
| `/support` | — | Vào menu hỗ trợ khách hàng | `bot.py:752` | `cmd_support` | → `handle_support_menu` |
| `/gift` | — | Nhận quà miễn phí | `bot.py:755` | `cmd_gift` | Kiểm tra channel membership, gift box |
| `/orders` | `/order` | Kiểm tra đơn hàng | `bot.py:758` | `cmd_orders` | Tra theo mã đơn hoặc email TK |
| `/myid` | — | Hiện Telegram ID của user | `bot.py:749` | `cmd_myid` | Reply ngay |
| `/clean` | — | Xoá tin nhắn rác, về trang chủ | `bot.py:719` | `cmd_clean` | Xoá batch + reset state |
| `/code` | — | Nhập mã bí mật (secret code) | `bot.py:4697` | `cmd_code` | Tra `data/secret_codes.json` → phát quà nếu đúng |

---

## 2. BUTTONS / MENU / CALLBACKS

### 2a. Main Keyboard (ReplyKeyboard — luôn hiện)

| Button Key | Label VI | Label EN | File:Line | Function xử lý |
|------------|----------|----------|-----------|----------------|
| `btn_support` | 💬 Hỗ Trợ | 💬 Support | `bot.py:2669` | `handle_support_menu` |
| `btn_gift` | 🎁 Nhận Quà | 🎁 Get Gift | `bot.py:2675` | gift flow |
| `btn_check_order` | 📋 Kiểm tra đơn | 📋 Check Order | `bot.py:2677` | `handle_order_lookup` |
| `btn_shop` | 🛍 Kênh Bán Hàng | 🛍 Shop Channel | `bot.py:2679` | `handle_shop` |
| `btn_chat_support` | 💬 Chat với Support | 💬 Chat with Support | `bot.py:2685` | `handle_chat_support_start` |
| `btn_intro` | 📖 Giới thiệu | 📖 Introduction | `bot.py:2681` | `handle_intro` |
| `btn_home` | 🏠 Trang chủ | 🏠 Home | `bot.py:2660` | Reset state + main keyboard |

### 2b. Support Sub-menu (ReplyKeyboard — sau khi bấm Hỗ Trợ)

| Button Key | Label VI | Label EN | Function xử lý |
|------------|----------|----------|----------------|
| `btn_bao_loi` | ⚠️ Báo lỗi bảo hành | ⚠️ Report Warranty Issue | `handle_support` (`bot.py:1824`) |
| `btn_yeu_cau_giao` | 📦 Yêu cầu nhận tài khoản | 📦 Request Account Delivery | `handle_yeu_cau_giao_hang` (`bot.py:1661`) |
| `btn_home` | 🏠 Trang chủ | 🏠 Home | Reset về main |

### 2c. Chat Session Keyboard

| Button Key | Label VI | Label EN | Function xử lý |
|------------|----------|----------|----------------|
| `btn_end_chat` | 🔚 Kết thúc chat | 🔚 End Chat | `handle_end_chat` (`bot.py:3976`) |

### 2d. Inline Callbacks — Order Card

| Callback Data | Label | File:Line | Function | Điều kiện hiện |
|--------------|-------|-----------|----------|----------------|
| `order:report:<id>` | ⚠️ Báo Lỗi | `bot.py:2380` | `callback_order` | Còn BH, chưa refund, không KBH |
| `order:report_all:<id>` | 📋 Báo lỗi tất cả (N) | `bot.py:2380` | `callback_order` | Có nhiều item còn BH |
| `order:pick_items:<id>` | 🔘 Chọn cụ thể | `bot.py:2380` | `callback_order` | Có nhiều item còn BH |
| `order:back` | ⬅️ Quay lại | `bot.py:2380` | `callback_order` | Luôn hiện |

### 2e. Inline Callbacks — Multi-account Warranty Selection

| Callback Data | Label | Function |
|--------------|-------|----------|
| `mw:all` | 📋 Báo lỗi tất cả (N) | `callback_multi_warranty` (`bot.py:1941`) |
| `mw:pick` | 🔘 Chọn cụ thể | `callback_multi_warranty` |
| `mw:t:<i>` | Toggle tài khoản thứ i | `callback_multi_warranty` |
| `mw:ok` | ✅ Xác nhận | `callback_multi_warranty` |
| `mw:back` | 🔙 Quay lại | `callback_multi_warranty` |
| `mw:noop` | *(vô hiệu)* | `callback_multi_warranty` |

### 2f. Inline Callbacks — Warranty Admin

| Callback Data | Label | File:Line | Function |
|--------------|-------|-----------|----------|
| `warranty_ack:<req_id>` | ✅ Tiếp nhận xử lý | `bot.py:3099` | `callback_warranty_ack` |
| `warranty_noop` | ✅ Đã tiếp nhận *(disabled)* | `bot.py:3183` | `callback_warranty_noop` |

### 2g. Inline Callbacks — Live Chat Transfer

| Callback Data | Label | Function |
|--------------|-------|----------|
| `spt_menu:<uid>` | ↗️ Chuyển phiên | `callback_support_transfer_menu` (`bot.py:5100`) |
| `spt_cancel:<uid>` | ❌ Huỷ | `callback_support_transfer_cancel` (`bot.py:5126`) |
| `spt:<uid>:<admin_id>` | 👤 Tên Admin | `callback_support_transfer` (`bot.py:5143`) |
| `spt_ok:<uid>` | ✅ Chấp nhận | `callback_spt_ok` |
| `spt_no:<uid>` | ❌ Từ chối | `callback_spt_no` |

### 2h. Inline Callbacks — Khác

| Callback Data | Label | Function |
|--------------|-------|----------|
| `lang:vi` | 🇻🇳 Tiếng Việt | `callback_lang` |
| `lang:en` | 🇬🇧 English | `callback_lang` |
| `back_main` | ⬅️ Quay lại | `callback_back_main` |
| `check_join` | ✅ Tôi đã tham gia | `callback_check_join` |
| `check_community_join` | ✅ Kiểm tra | `callback_check_community_join` |
| `return_gift_init` | ↩️ Nhường quà | `callback_return_gift_init` |
| `return_gift_confirm` | ✅ Xác nhận nhường | `callback_return_gift_confirm` |
| `return_gift_cancel` | ❌ Huỷ | `callback_return_gift_cancel` |
| `gbox:<eid>:<i>` | ⬜ Chọn ô | `callback_gift_box` |
| `gbox_view:<eid>:<i>` | emoji đã mở | `callback_gift_box` |
| `gbox_open:<eid>` | 🎁 Nhận quà ngay | `callback_gift_box` |
| `checkin` | Check-in | `callback_checkin` |
| `unlock_del:<id>` | Mở khoá giao | `callback_unlock_delivery` |

---

## 3. ERROR REPORT FLOW

### Đường 1 — Báo lỗi qua menu Hỗ Trợ (đa tài khoản)

```
[1] User bấm "💬 Hỗ Trợ"
      → handle_support_menu (bot.py:1649)
      → Hiện sub-menu: [📦 Yêu cầu nhận TK] [⚠️ Báo lỗi BH] [🏠 Về]

[2] User bấm "⚠️ Báo lỗi bảo hành"
      → handle_support (bot.py:1824)
      → Check support_enabled (settings.json) — nếu False → báo disabled
      → Set conv_state = "support_multi_input"
      → Bot hỏi: "Nhập mã đơn hoặc email TK (tối đa N)"

[3] User nhập email / mã đơn (mỗi dòng một cái)
      → handle_multi_account_input (bot.py:1843)
      → Parse + dedup → gọi db.find_order_with_items() cho mỗi email
      → Phân loại:
          found       → còn BH, chưa refund → có thể chọn báo lỗi
          expired     → hết BH              → hiện card, không có nút
          kbh         → KBH (Không BH)     → hiện card, không có nút
          not_found   → không tìm thấy
          blocked     → đang có request mở → báo chờ xử lý
      → Hiện card thông tin đơn (tối đa 3 card inline)
      → Inline keyboard: [📋 Báo tất cả] [🔘 Chọn cụ thể] hoặc tick từng TK

[4] User chọn TK (mw:t:0, mw:t:1...) → bấm "✅ Xác nhận" (mw:ok)
      → callback_multi_warranty (bot.py:1941)
      → Set conv_state = "support_multi_desc"
      → Bot hỏi mô tả lỗi:
          "Ví dụ: Die TK / Rớt gói / Không đăng nhập được"

[5] User nhập mô tả lỗi
      → handle_multi_warranty_desc (bot.py:2030)
      → Rate limit check (rate_limiter.py)
      → Server-side warranty gate: re-verify từng TK còn BH không
      → Duplicate check: nếu đã có request pending → từ chối + thông báo
      → db.create_warranty_request(...) → lưu warranty_requests.json
      → Bot xác nhận: "✅ Đã gửi N tài khoản"
      → Background thread: _notify_admins_warranty (bot.py:2855)

[6] _notify_admins_warranty (background, bot.py:2855)
      → Gửi Telegram cho ADMIN_ID + tất cả sub_admins
      → Nội dung: user info + danh sách TK + mô tả lỗi
      → Kèm button: [✅ Tiếp nhận xử lý]
      → Lên lịch reminder (warranty_reminder_worker)

[7] Admin bấm [✅ Tiếp nhận xử lý]
      → callback_warranty_ack (bot.py:3099)
      → Validate quyền admin
      → Update: status pending → processing, acknowledgedAt, tắt reminder
      → Auto-ack duplicate requests cùng user
      → Gửi cho khách: "✅ YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN"
      → Admin xử lý tiếp qua web panel (Admin Panel → Warranty)
```

### Đường 2 — Báo lỗi đơn lẻ qua /orders hoặc Kiểm tra đơn

```
[1] User gõ /orders hoặc bấm "📋 Kiểm tra đơn"
      → handle_order_lookup (bot.py:2146)
      → Set conv_state = "check_order_input"
      → Bot hỏi: "Nhập mã đơn hoặc email TK"

[2] User nhập mã đơn / email
      → db.find_order_with_items(query)
      → Hiện card đơn hàng + inline buttons:
          [⚠️ Báo Lỗi]         → order:report:<id>      (nếu 1 item)
          [📋 Báo lỗi tất cả]  → order:report_all:<id>  (nếu nhiều item)
          [🔘 Chọn cụ thể]     → order:pick_items:<id>
          [⬅️ Quay lại]        → order:back

[3] User bấm [⚠️ Báo Lỗi]
      → callback_order (bot.py:2380)
      → Gate checks:
          - order.status == "refunded" → từ chối
          - KBH trong productName → từ chối
          - item_status == "refunded" → từ chối
          - calc_item_warranty → canReport == False → từ chối
      → Set conv_state = "report_issue"
      → Bot hỏi mô tả lỗi

[4] User nhập mô tả
      → Xử lý qua message router → tạo warranty request
      → Notify admin (tương tự Đường 1 từ bước 6)
```

**⚠️ Quan trọng:** "Rớt gói", "Không đăng nhập", "Không kích hoạt" KHÔNG phải flow riêng. Chỉ là **ví dụ gợi ý** trong prompt mô tả lỗi. Bot không phân loại category — toàn bộ vào 1 text field.

---

## 4. WARRANTY FLOW

### Điều kiện để báo lỗi bảo hành

```
✅ ĐƯỢC phép báo lỗi khi:
  - Sản phẩm KHÔNG phải KBH
  - warranty_end_date > ngày hôm nay
  - Đơn chưa bị refunded
  - Không có request BH pending/processing từ user này

❌ KHÔNG được báo lỗi khi:
  - Sản phẩm có "KBH" trong tên
  - warranty_end_date <= ngày hôm nay (hết hạn)
  - order.status == "refunded"
  - item.item_status == "refunded"
  - Có record trong refund_history.json (defence-in-depth)
  - Đã có request pending
```

### Tính thời gian bảo hành (`data_manager.py:704 — calc_item_warranty`)

```
Ngày bắt đầu BH (ưu tiên từ trên xuống):
  item.original_delivered_at
  > item.deliveredAt
  > order.purchaseDate
  > order.paymentAt

Số ngày BH (ưu tiên từ trên xuống):
  item.warranty_days
  > order.warrantyDays
  > Parse tên sản phẩm:
      "BH24H", "BH48H"  → BHxH → ceil(x/24) ngày
      "BHF"             → BHF  → infer từ chu kỳ gói (ví dụ 1 tháng = 30 ngày)
      "1D", "2D"        → xD   → x ngày (override)
      "KBH"             → Không bảo hành

Ngày kết thúc BH:
  item.warranty_end_date (stored)
  > tính: start + warranty_days
  > order.warrantyExpiry
  > order.warrantyDate

Trạng thái:
  active     → remaining_days > 0 → CÓ THỂ báo lỗi
  expired    → remaining_days = 0 → KHÔNG báo lỗi
  no_data    → không đủ dữ liệu  → hiện cảnh báo
  no_warranty → KBH              → không báo lỗi
  refunded   → đã hoàn tiền      → không báo lỗi
  unknown    → fallback
```

### Warranty Request Lifecycle

```
pending     → Admin chưa tiếp nhận → có reminder
processing  → Admin đã bấm tiếp nhận → reminder tắt
resolved    → Admin xử lý xong (web panel)
rejected    → Admin từ chối (web panel)
```

### Reminder System (`warranty_reminder_worker` — background thread)

```
Lần 1: sau reminder1Minutes (mặc định 5 phút)
Lần 2: sau reminder2Minutes (mặc định 15 phút)
Urgent: sau urgentMinutes   (mặc định 30 phút)
→ Cấu hình tại: data/notification_settings.json
→ Admin nhận: emoji leo thang (🔔 → ⚠️ → 🚨)
→ Tin cũ tự xoá trước khi gửi nhắc mới
```

---

## 5. REFUND FLOW

### Quan trọng: KHÔNG có flow refund do user khởi tạo

```
Refund hoàn toàn do admin xử lý qua web panel.

User chỉ có thể:
  - Xem "💵 Hoàn dự kiến: ~X đ" trong card đơn hàng (thông tin, không phải action)
  - Tra trạng thái "💰 ĐÃ HOÀN TIỀN" + ngày hoàn qua /orders
```

### Công thức tính refund hiển thị (`data_manager.py:810`)

```python
# Formula "remaining_days" (mặc định):
refund_amount = round(price × remaining_days / warranty_days)

# Formula "custom" (admin cấu hình text tự do):
refund_amount = settings.refund_custom_text  # ví dụ: "Liên hệ shop để hoàn"
```

Cấu hình tại: `data/settings.json`
- `refund_formula`: `"remaining_days"` hoặc `"custom"`
- `refund_custom_text`: text tuỳ ý (chỉ dùng khi formula = "custom")

### Khi admin xử lý refund (web panel)

```
Admin Panel → Warranty / Orders → Đánh dấu hoàn tiền
→ order.status = "refunded" HOẶC item.item_status = "refunded"
→ Ghi vào data/refund_history.json
→ KHÔNG gửi Telegram tự động cho user (NOT IMPLEMENTED)
User tự tra qua /orders để biết trạng thái
```

---

## 6. PRODUCT ACTIVATION GUIDE

### Tính năng "Giới thiệu" (`handle_intro` — `bot.py:2579`)

```
Trigger: User bấm "📖 Giới thiệu" (btn_intro)

Đọc từ: data/intro.json (admin cấu hình qua web panel)
Cấu trúc:
  {
    "title":    "...",       // tiêu đề VI
    "titleEn":  "...",       // tiêu đề EN
    "content":  "...",       // nội dung VI
    "contentEn":"...",       // nội dung EN
    "photoUrl": "...",       // ảnh đính kèm
    "videoUrl": "...",       // video đính kèm
    "buttons":  [            // inline buttons tuỳ chọn
      { "text": "...", "url": "https://..." }
    ],
    "enabled":  true
  }

Ghi chú:
  - 1 nội dung duy nhất cho toàn bộ, KHÔNG chia theo sản phẩm
  - Hỗ trợ ảnh hoặc video đính kèm
  - Có thể thêm inline buttons dẫn link ngoài
```

### Hướng dẫn kích hoạt theo sản phẩm: **NOT IMPLEMENTED**

```
- Không có flow hướng dẫn kích hoạt riêng theo SP
- Không có flow "không đăng nhập được" riêng
- Không có flow "không kích hoạt được" riêng
- Không có flow "rớt gói" riêng
→ Tất cả đều được user tự mô tả trong field "mô tả lỗi"
```

---

## 7. ADMIN HANDOFF FLOW

### Handoff A — Warranty Request (qua Hỗ Trợ / /orders)

```
Bot → ADMIN_ID + sub_admins (Telegram):
  Nội dung: user info + danh sách TK + mô tả lỗi
  Button:   [✅ Tiếp nhận xử lý]

Admin bấm tiếp nhận:
  → callback_warranty_ack
  → Status: pending → processing, reminder tắt
  → Khách nhận: "✅ YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN"
  → Admin tiếp tục xử lý trên Admin Panel (thay TK / hoàn tiền)
```

### Handoff B — Live Chat (qua Chat với Support)

```
[Phase 1 — AI tự trả lời]
User nhắn → _ai_chat_reply (bot.py:3582)
  → Gọi OpenAI API (nếu enabled + có apiKey)
  → Bot phản hồi tự động

[Phase 2 — AI phát hiện cần chuyển nhân viên]
_ai_wants_transfer(ai_reply) = True khi reply chứa:
  "chuyển nhân viên", "nhân viên hỗ trợ", "chờ trong giây lát",
  "kết nối nhân viên", "transfer support", v.v.
→ Bot gửi: "🔗 Đang kết nối với nhân viên hỗ trợ..."
→ _notify_admin_with_history: gửi toàn bộ lịch sử chat lên ADMIN_ID
→ Button: [↗️ Chuyển phiên] → mở danh sách admin phụ

[Phase 3 — Admin chính reply]
Admin reply tin nhắn được forward:
→ _route_admin_chat_reply (bot.py:4169)
→ Map replied_mid → uid (qua msg_map)
→ Forward reply về user với header "💬 Support:"
→ session.admin_engaged = True → tắt AI

[Phase 4 — Chuyển phiên sang admin phụ]
Admin chính chọn admin phụ:
→ callback_support_transfer → gửi yêu cầu Chấp nhận/Từ chối cho admin phụ
Admin phụ chấp nhận (spt_ok):
→ session.assigned_admin_id = admin_phụ.id
→ Admin phụ nhắn bất kỳ → _route_assigned_admin_direct → forward về user

[Phase 5 — Kết thúc]
User bấm "🔚 Kết thúc chat" → handle_end_chat
Timeout (không có hoạt động > N phút) → _chat_timeout_worker
→ Ghi lịch sử vào data/support_chat_history.json
→ Lên lịch xoá tin sau X phút (pending_deletions)
```

### Handoff C — Yêu cầu Giao Hàng

```
Bot → ADMIN_ID (Telegram):
  Nội dung: user info + mã đơn + request ID
  Hướng dẫn: "Vào Admin Panel → Giao tài khoản để xử lý"

Reminder worker: delivery_reminder_worker (background thread)
  → Nhắc lại theo phút cấu hình đến khi admin xử lý
  → Admin xử lý qua web panel (Admin Panel → Giao tài khoản)
```

---

## 8. FILES & FUNCTIONS LIÊN QUAN

| File | Vai trò | Functions chính |
|------|---------|-----------------|
| `bot.py` | Entry point bot Telegram (5400+ dòng) | Toàn bộ handler + workers |
| `data_manager.py` | Đọc/ghi tất cả JSON files (1866 dòng) | `calc_item_warranty`, `find_order_with_items`, `get_refund_record`, `create_warranty_request` |
| `translations.py` | Chuỗi VI/EN | `t(lang, key)` |
| `rate_limiter.py` | Chống spam / rate limit | `check_and_record` |
| `main.py` | Entry point khởi động | Khởi động bot + workers |
| `sync_robot.py` | Đồng bộ dữ liệu (background) | Sync market orders |
| `market_order_sync.py` | Sync đơn hàng chợ | — |
| `warranty_scan.py` | Quét đơn còn BH từ market_orders | CLI tool, không phải bot handler |
| `artifacts/api-server/` | API server Express cho admin panel | Routes trong `src/routes/` |
| `artifacts/admin-panel/` | Web admin panel React | Pages trong `src/pages/` |

### Functions xử lý Customer Support trong `bot.py`

| Function | Dòng | Mô tả |
|----------|------|-------|
| `handle_support_menu` | 1649 | Hiện sub-menu hỗ trợ |
| `handle_yeu_cau_giao_hang` | 1661 | Bước 1: yêu cầu giao hàng |
| `handle_delivery_input` | 1682 | Bước 2: nhận mã đơn, tạo request giao |
| `_notify_admin_delivery` | 1804 | Notify admin có request giao mới |
| `handle_support` | 1824 | Bắt đầu flow báo lỗi multi-account |
| `handle_multi_account_input` | 1843 | Parse email/mã đơn, phân loại |
| `callback_multi_warranty` | 1941 | Xử lý chọn TK inline |
| `handle_multi_warranty_desc` | 2030 | Nhận mô tả, tạo warranty request |
| `handle_order_lookup` | 2146 | Tra cứu đơn hàng |
| `callback_order` | 2380 | Xử lý inline buttons card đơn |
| `_notify_admins_warranty` | 2855 | Notify admin có warranty request mới |
| `warranty_reminder_worker` | ~2900 | Background: gửi reminder định kỳ |
| `callback_warranty_ack` | 3099 | Admin tiếp nhận warranty request |
| `handle_intro` | 2579 | Hiện trang Giới thiệu |
| `handle_chat_support_start` | 3668 | Bắt đầu phiên live chat |
| `handle_live_chat_message` | 3756 | Forward tin nhắn trong phiên |
| `handle_live_chat_media` | 3886 | Forward ảnh trong phiên |
| `handle_end_chat` | 3976 | Kết thúc phiên live chat |
| `_ai_chat_reply` | 3582 | Gọi OpenAI API tự trả lời |
| `_ai_wants_transfer` | 4039 | Phát hiện AI muốn chuyển nhân viên |
| `_notify_admin_with_history` | 4052 | Gửi lịch sử chat lên admin |
| `_route_assigned_admin_direct` | 4106 | Route tin nhắn admin phụ → user |
| `_route_admin_chat_reply` | 4169 | Route reply admin chính → user |
| `_chat_timeout_worker` | 4235 | Background: đóng phiên timeout |

### API Routes liên quan (`artifacts/api-server/src/routes/`)

| File | Base path | Chức năng |
|------|-----------|-----------|
| `botAdmin.ts` | `/bot/` | Toàn bộ CRUD cho admin panel |
| `chatSupport.ts` | `/bot/chat-support/` | History, settings, banned, admins, AI |
| `health.ts` | `/api/healthz` | Health check |

---

## 9. DATABASE (Flat JSON Files)

Tất cả dữ liệu lưu trong thư mục `data/` (flat JSON files, không dùng DB thật).

| File | Nội dung | Đọc/ghi bởi |
|------|---------|-------------|
| `data/settings.json` | Cài đặt chung (refund_formula, maxAccountsPerRequest, support_enabled...) | `data_manager.py` |
| `data/orders.json` | Danh sách đơn hàng chính | `data_manager.py` |
| `data/market_orders.json` | Đơn hàng từ chợ (canboso) | `data_manager.py`, `sync_robot.py` |
| `data/users.json` | Trạng thái user (conv_state, ngôn ngữ, ...) | `data_manager.py` |
| `data/warranty_requests.json` | Tất cả warranty requests | `data_manager.py` |
| `data/refund_history.json` | Lịch sử hoàn tiền | `data_manager.py` |
| `data/notification_settings.json` | Cấu hình reminder admin (ADMIN_ID, minutes...) | `data_manager.py` |
| `data/intro.json` | Nội dung trang Giới thiệu | `data_manager.py` |
| `data/secret_codes.json` | Mã bí mật → quà | `bot.py` |
| `data/support_chat_sessions.json` | Phiên live chat đang mở + msg_map | `bot.py` (in-file) |
| `data/support_chat_history.json` | Lịch sử phiên live chat đã kết thúc | `bot.py` (in-file) |
| `data/support_chat_settings.json` | Cài đặt chat (timeout, spam, working hours) | `bot.py` (in-file) |
| `data/support_chat_admins.json` | Danh sách admin phụ hỗ trợ | `bot.py` (in-file) |
| `data/support_chat_banned.json` | Danh sách user bị cấm chat | `bot.py` (in-file) |
| `data/chat_ai_settings.json` | Cài đặt AI (model, apiKey, systemPrompt, enabled) | `bot.py` (in-file) |
| `data/delivery_requests.json` | Yêu cầu giao hàng | `data_manager.py` |
| `data/accounts.json` | Pool tài khoản | `data_manager.py` |
| `data/pending_broadcasts.json` | Hàng đợi broadcast | `data_manager.py` |
| `data/logs.json` | Log hệ thống | `data_manager.py` |
| `data/shop_channels.json` | Kênh bán hàng | `data_manager.py` |

---

## 10. NHỮNG CHỨC NĂNG NOT IMPLEMENTED / NOT FOUND

| Chức năng | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| Flow riêng "Rớt gói" | **NOT IMPLEMENTED** | Chỉ là text ví dụ trong prompt mô tả lỗi |
| Flow riêng "Không đăng nhập được" | **NOT IMPLEMENTED** | Chỉ là text ví dụ |
| Flow riêng "Không kích hoạt được" | **NOT IMPLEMENTED** | Chỉ là text ví dụ |
| Flow riêng "Refund do user yêu cầu" | **NOT IMPLEMENTED** | Admin xử lý 100% qua web panel |
| Notify user khi admin xử lý xong / refund xong | **NOT IMPLEMENTED** | User phải tự tra /orders |
| Hướng dẫn kích hoạt riêng theo từng sản phẩm | **NOT IMPLEMENTED** | Chỉ có 1 trang intro chung |
| Phân loại lỗi theo category (bot tự route) | **NOT IMPLEMENTED** | Tất cả vào 1 text field |
| Button "Liên hệ Admin" riêng biệt | **NOT IMPLEMENTED** | Dùng Chat với Support hoặc Báo lỗi |
| Tự động hoàn tiền khi BH hết | **NOT IMPLEMENTED** | Admin xử lý thủ công |
| Chatbot phân loại lỗi tự động | **NOT IMPLEMENTED** | AI chỉ trả lời tự do, không route theo lỗi |
| FAQ tự động theo loại lỗi | **NOT IMPLEMENTED** | — |
| Theo dõi trạng thái warranty request realtime (bot) | **PARTIAL** | Khách nhận notify khi admin ACK, nhưng không có update tiếp theo |
| Escalation tự động nếu admin không phản hồi | **PARTIAL** | Có reminder system nhưng không auto-escalate |

---

*Audit được thực hiện tự động từ source code. Không sửa code nào trong quá trình audit.*
