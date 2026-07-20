---
name: Grok Cloudflare Block
description: VPS datacenter IP blocked by Cloudflare Managed Challenge on grok.com/auth/login — no browser automation can bypass this
---

## Rule
VPS datacenter IPs are blocked by Cloudflare Managed Challenge on grok.com/auth/login. No stealth browser patches bypass IP-level CF blocks.

**Evidence:** 50s wait + multiple reloads — CF never auto-resolved. Main grok.com loads OK (24s JS challenge auto-solved) but /auth/login triggers Managed Challenge.

**Why:** CF checks both IP reputation (datacenter = flagged) AND browser fingerprint. IP block can't be bypassed by code alone.

**How to apply:**
- Cookie-based health check: user pastes session cookie from real browser → checker calls /api/auth/session directly (no Playwright, bypasses CF)
- Residential proxy: route Playwright through non-datacenter IP
- Run checker from non-VPS environment

**Other bugs fixed this session:**
- Bug 1: orders.email empty → enqueue filter skips order → fixed: fallback to order_items[orderId][0].email
- Bug 2: playwright npm package missing on VPS → fixed: /tmp install + copy in deploy.sh
- Bug 3: worker default timeout 60s too short → increased to 120s
