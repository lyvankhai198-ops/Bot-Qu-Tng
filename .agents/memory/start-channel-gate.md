---
name: Start channel gate
description: Cổng bắt buộc tham gia kênh cộng đồng ngay sau khi user chọn ngôn ngữ ở /start
---

## Design

- Setting: `require_start_channel_check` (bool) in settings.json — toggle trong admin panel
- Data: reuses `required_channels.json` (same as gift gate)
- Admins (`is_admin(user.id)`) bypass the gate entirely
- Callback pattern: `check_community_join` (vs `check_join` for gift gate)

## Flow

1. `/start` → user chọn ngôn ngữ → `callback_lang` called
2. Nếu `require_start_channel_check=True` và user không phải admin:
   - Gọi `_check_channels_membership()` fresh (không dùng cache)
   - Nếu chưa join: gửi join prompt với `_build_community_join_markup()`, return
   - Nếu đã join tất cả: tiếp tục xuống → gửi main_keyboard
3. User bấm "✅ Tôi đã tham gia" → `callback_check_community_join`:
   - Gọi lại `_check_channels_membership()` fresh
   - Nếu chưa join: edit message với danh sách kênh còn thiếu + giữ nguyên buttons
   - Nếu đã join: edit message "✅ Xác minh thành công" → gửi shop_channels inline → gửi main_keyboard

## Key decisions

**Why reuse required_channels instead of new community_channels:**  
Admin đã biết cách cấu hình required_channels. Tránh nhầm lẫn 2 danh sách. Nếu cần tách sau này có thể thêm `type` field.

**Why not cache on start gate:**  
First interaction — chưa có cache. Cache chỉ hữu ích khi user tap nhiều lần trong 1 session, không áp dụng ở /start.

## Admin panel

Settings page: mục "Kênh bắt buộc tham gia trước khi nhận quà" → có thêm toggle mới phía trên:
- "Bắt buộc tham gia kênh khi /start" → `requireStartChannelCheck`

**How to apply:** Khi sửa logic /start channel check, đọc file này trước.
