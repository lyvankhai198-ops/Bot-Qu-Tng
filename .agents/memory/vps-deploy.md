---
name: VPS Auto-Deploy Workflow
description: Quy trình tự động push GitHub + deploy VPS sau mỗi lần cập nhật
---

## Quy trình bắt buộc sau mỗi lần cập nhật code

Sau khi hoàn thành bất kỳ thay đổi nào, agent PHẢI tự động:
1. Git commit + push lên GitHub (`main`)
2. Build admin-panel và api-server
3. Upload dist lên VPS + restart services

**Why:** User đã yêu cầu rõ ràng — không cần hỏi lại mỗi lần.

## Thực thi — 2 bước bắt buộc

### Bước 1: Commit + Push GitHub (dùng ShellExec + CodeExecution)
```bash
git add -A && git commit -m "<mô tả>"
```
```javascript
// Trong CodeExecution:
const result = await gitPush({});
```
Lý do: GitHub không cho phép password auth qua CLI; gitPush() dùng OAuth của Replit.

### Bước 2: Build + Deploy VPS (dùng ShellExec)
```bash
export VPS_HOST=103.180.138.203 VPS_USER=root VPS_DEPLOY_PATH=/root/Bot-Qu-Tng VPS_SERVICE=gift-bot
export VPS_PASSWORD="$(printenv VPS_PASSWORD)"
bash scripts/deploy.sh
```

Script sẽ:
- Build admin-panel (React → dist/public/)
- Build api-server (TypeScript → dist/index.mjs)
- SCP dist files lên VPS
- Restart gift-bot + bot-api services

## VPS Architecture

- Host: 103.180.138.203
- Thư mục: /root/Bot-Qu-Tng
- **gift-bot** (systemd) — bot.py Telegram, Python venv, port 5000 keep-alive
- **bot-api** (systemd) — api-server Node.js, port 8081
- **nginx** — phục vụ /admin-panel/ (static) + proxy /api/ → port 8081
- Python venv: /root/Bot-Qu-Tng/venv/

## URL công khai VPS

**Admin Panel: http://103.180.138.203/admin-panel/**

## Credentials trong Replit Secrets/Env

- `VPS_PASSWORD` — Replit Secret
- `VPS_HOST` = 103.180.138.203 (env var)
- `VPS_USER` = root (env var)
- `VPS_DEPLOY_PATH` = /root/Bot-Qu-Tng (env var)
- `VPS_SERVICE` = gift-bot (env var)

## Xử lý diverge

Nếu gitPush() bị rejected: dùng `gitPush({ force: true })`.
Trên VPS dùng `git reset --hard origin/main` thay vì `git pull`.

**How to apply:** Cuối mỗi turn có thay đổi file code.
