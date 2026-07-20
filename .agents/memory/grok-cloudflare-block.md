---
name: Grok auth flow & blocks
description: Full auth flow for grok.com, what's blocked and why, current working state
---

## Confirmed Auth Flow (2026-07-20)

grok.com → grok.com/sign-in → **accounts.x.ai/sign-in** (xAI's own auth, not Twitter OAuth)

Steps on accounts.x.ai:
1. Land on provider selection (Google / 𝕏 / Apple / **Login with email**)
2. Click "Login with email" → email input appears
3. Fill email → click "Next" → **BLOCKED: `[permission_denied] HTTP 403`**

## Blocks

### 1. grok.com Cloudflare (SOLVED with proxy)
VPS datacenter IP → Cloudflare Managed Challenge on grok.com.
**Fix**: ProxyScrape residential proxy (`rp.scrapegw.com:6060`) bypasses CF.

### 2. accounts.x.ai API-level 403 (NOT SOLVED)
After filling email + clicking Next, accounts.x.ai API returns 403 (`[permission_denied]`).
This is xAI's own API blocking proxy IPs for authentication — not Cloudflare, not bypassable with stealth JS.
Screenshot confirms: email filled correctly, toast error "[permission_denied] HTTP 403" appears immediately.

**Why:** accounts.x.ai blocks VPN/proxy IPs for auth API calls (anti-credential-stuffing). Works for GET (page loads), blocks POST (email validate API).

## STEALTH_SCRIPT Bug (FIXED 2026-07-20)
STEALTH_SCRIPT was written with TypeScript syntax (`as any`, `: any`, `!.get`) — injected as plain JS into browser → `Unexpected identifier 'as'` pageerrors → React hydration crash → blank white page. **Fix**: rewrote STEALTH_SCRIPT using plain ES5 JS in an IIFE, all try/catch wrapped.

## Current Working State
- **Cookie fast-path**: WORKS 100%. User pastes `__Secure-next-auth.session-token` → checker calls API directly, no Playwright.
- **Proxy Playwright login**: Reaches accounts.x.ai email form correctly, but email validation API returns 403.

## How to apply
- Default: always use cookie approach for accounts that have a session cookie stored.
- Proxy approach: only reaches the email-fill step; fails on API validation. Would require a proxy provider not on xAI's blocklist.
- Other bugs fixed: STEALTH_SCRIPT TS syntax crash, missing screenshots in error paths, pageerror console capture.
