---
name: VPS Auto-Deploy Workflow
description: Quy trình tự động push GitHub + deploy VPS sau mỗi lần cập nhật
---

## Quy trình bắt buộc sau mỗi lần cập nhật code

Sau khi hoàn thành bất kỳ thay đổi nào, agent PHẢI tự động:
1. Build admin-panel + api-server
2. Git commit + push lên GitHub (dùng ShellExec với GITHUB_TOKEN)
3. SSH vào VPS: git pull + fix service + restart

**Why:** User đã yêu cầu rõ ràng — không cần hỏi lại mỗi lần.

## Thực thi

### Bước 1: Build
```bash
PORT=3000 BASE_PATH=/admin-panel/ pnpm --filter @workspace/admin-panel run build
pnpm --filter @workspace/api-server run build
```

### Bước 2: Commit + Push GitHub
```bash
git add -A && git commit -m "<mô tả>"
GITHUB_TOKEN="$(printenv GITHUB_TOKEN)"
git push "https://lyvankhai198-ops:${GITHUB_TOKEN}@github.com/lyvankhai198-ops/Bot-Qu-Tng.git" main
```
**Quan trọng:** `gitPush()` trong CodeExecution KHÔNG hoạt động (durable scope). Dùng git CLI + GITHUB_TOKEN qua ShellExec.

### Bước 3: Deploy VPS qua SSH
```bash
VPS_PASSWORD="$(printenv VPS_PASSWORD)"
sshpass -p "${VPS_PASSWORD}" ssh -o StrictHostKeyChecking=no root@103.180.138.203 "
  cd /root/Bot-Qu-Tng
  if [ -d data ]; then cp -r data /tmp/bot_data_backup; fi
  git fetch origin main && git reset --hard origin/main
  if [ -d /tmp/bot_data_backup ]; then cp -rn /tmp/bot_data_backup/. data/ 2>/dev/null; rm -rf /tmp/bot_data_backup; fi
  # Fix service paths
  sed -i 's|WorkingDirectory=.*|WorkingDirectory=/root/Bot-Qu-Tng|g' /etc/systemd/system/bot-api.service
  sed -i 's|ExecStart=.*index.mjs|ExecStart=/usr/bin/node --enable-source-maps /root/Bot-Qu-Tng/artifacts/api-server/dist/index.mjs|g' /etc/systemd/system/bot-api.service
  systemctl daemon-reload && systemctl restart bot-api gift-bot
"
```

## VPS Architecture (đã xác minh thực tế)

- Host: 103.180.138.203
- Deploy dir: /root/Bot-Qu-Tng
- **gift-bot** (systemd) — bot.py Telegram, port 5000 keep-alive
- **bot-api** (systemd) — api-server Node.js, **PORT=3002** (không phải 8081!)
- **nginx** — phục vụ /admin-panel/ (static) + proxy /api/ → port **3002**
- Admin panel URL: http://103.180.138.203/admin-panel/
- **Mật khẩu admin panel: Admin123** (SESSION_SECRET trong bot-api.service)

## GOTCHA: bot-api.service WorkingDirectory

**Vấn đề đã gặp:** `bot-api.service` từng có `WorkingDirectory=/root/autoorder` (sai thư mục) → `/api/bot/auth` trả 404 dù code đúng.
**Fix:** deploy.sh giờ luôn patch `WorkingDirectory` và `ExecStart` về `/root/Bot-Qu-Tng`.
**Why:** VPS có nhiều project; bot-api.service ban đầu cài cho project khác rồi reuse.

## Credentials trong Replit Secrets/Env

- `VPS_PASSWORD` — Replit Secret (SSH root password)
- `GITHUB_TOKEN` — Replit Secret (GitHub PAT, scope: repo)
- `VPS_HOST` = 103.180.138.203 (env var)
- `VPS_USER` = root (env var)
- `VPS_DEPLOY_PATH` = /root/Bot-Qu-Tng (env var)

**How to apply:** Cuối mỗi turn có thay đổi file code.
