---
name: Nginx admin-panel API routing
description: POST requests from admin panel to /admin-panel/api/ return 405 unless explicit proxy location exists
---

## Rule
Any new API route on the admin panel MUST have `location /admin-panel/api/` in nginx — without it, POST/PATCH/DELETE return 405 (static file location only handles GET).

**Why:** nginx `location /admin-panel/` serves static files. GET falls back to index.html (200). POST/PATCH/DELETE → 405 because nginx static serving rejects non-GET methods.

**How to apply:** When adding new POST/PATCH/DELETE endpoints consumed by admin panel, verify `/etc/nginx/sites-enabled/botadmin` has:
```nginx
location /admin-panel/api/ {
    rewrite ^/admin-panel/api/(.*)$ /api/$1 break;
    proxy_pass http://127.0.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
}
```
This block must appear BEFORE `location /admin-panel/` in the config. Also fix the `.bak` file in the same directory since nginx loads both.
