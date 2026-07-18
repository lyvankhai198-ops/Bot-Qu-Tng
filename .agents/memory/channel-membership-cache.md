---
name: Channel membership cache
description: How the gift-gate channel membership verification works and is cached
---

## Design

- **Storage**: `data/user_channel_memberships.json` — `{telegram_user_id: {channel_cache_key: record}}`
- **Cache TTL**: 6 hours (`MEMBERSHIP_CACHE_TTL_HOURS = 6` in data_manager.py)
- **Cache key**: `channel_cache_key(ch)` = `(ch.chatId or ch.username or ch.id).strip().lower()`

## Channel config (`required_channels.json`)

Each channel now has: `{id, name, username, chatId, url, enabled}`

- `chatId` = numeric Telegram channel ID (e.g. `-1001234567890`) — **required for private channels**
- `username` = `@handle` — works for public channels only
- Bot must be **admin** of the channel for `getChatMember` to work
- If neither chatId nor username is set → bot blocks user, cannot verify

## Gift flow (handle_gift)

1. Check each enabled channel against cache (`is_membership_cache_valid`)
2. Channels with valid cache (within TTL) → skip, no API call
3. Channels needing fresh check → call `_check_channels_membership`
4. `_check_channels_membership` returns `(not_joined, no_chat_id, api_errors)`
   - `no_chat_id`: block with "admin needs to configure Channel ID"
   - `api_errors`: block with "bot not admin" message
   - `not_joined`: show join prompt (only missing channels shown)
5. On pass → straight to stock check

## "Tôi đã tham gia" callback (callback_check_join)

- **Always** calls `getChatMember` fresh — never uses cache (spec §7)
- Returns same 3-tuple
- On all pass → cache saved by `_check_channels_membership` → **immediately delivers gift** (no need to tap "Nhận Quà" again)
- `restricted` status: only counts as joined if `is_member=True`

## data_manager functions

- `set_membership_verified(user_id, channel_key, status)` — save verified
- `set_membership_left(user_id, channel_key, status)` — save left/kicked
- `is_membership_cache_valid(user_id, channel_key, ttl_hours=6)` → bool
- `get_user_memberships(user_id)` → dict
- `get_all_memberships()` → full file

## Admin panel

- Settings page: channel form has `chatId` field (green badge if set, red "⚠️ Chưa có ID" if missing)
- "Kiểm tra kết nối kênh" button prefers `chatId` over `username` for the check-channel API call
- Debug endpoint: `GET /api/giveaway/membership-debug/:telegramUserId` returns live getChatMember result + cached state (`savedStatus`, `isVerified`, `verifiedAt`, `cacheValid`)

**Why:** Users were bypassing the join gate by trusting the button tap. Caching avoids re-verifying on every "Nhận Quà" tap (UX), while always re-verifying on the explicit "Tôi đã tham gia" tap (security).
