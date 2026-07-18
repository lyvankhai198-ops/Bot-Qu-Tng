---
name: VPS Auto-Deploy Workflow
description: Thông tin và quy trình tự động push GitHub + deploy VPS sau mỗi lần cập nhật
---

## Quy trình bắt buộc sau mỗi lần cập nhật code

Sau khi hoàn thành bất kỳ thay đổi nào, agent PHẢI tự động:
1. Git commit + push lên GitHub (`main`)
2. SSH vào VPS, git reset --hard origin/main, restart service

**Why:** User đã yêu cầu rõ ràng — không cần hỏi lại mỗi lần.

## Thực thi — 2 bước bắt buộc

### Bước 1: Push GitHub (dùng CodeExecution — KHÔNG dùng git CLI)
```javascript
// Commit trước bằng ShellExec
// git add -A && git commit -m "..."
const result = await gitPush({});
```
Lý do: GitHub không cho phép password auth qua CLI; gitPush() dùng OAuth của Replit.

### Bước 2: Deploy VPS (dùng ShellExec)
```bash
export VPS_HOST=103.180.138.203 VPS_USER=root VPS_DEPLOY_PATH=/root/Bot-Qu-Tng VPS_SERVICE=gift-bot
export VPS_PASSWORD="$(printenv VPS_PASSWORD)"
bash scripts/deploy.sh
```

Các secrets/env vars cần có:
- `VPS_PASSWORD` — Replit Secret
- `VPS_HOST` — env var (103.180.138.203)
- `VPS_USER` — env var (root)
- `VPS_DEPLOY_PATH` — env var (/root/Bot-Qu-Tng)
- `VPS_SERVICE` — env var (gift-bot)

## VPS details

- Host: 103.180.138.203
- User: root
- Deploy path: /root/Bot-Qu-Tng
- Systemd service: gift-bot
- Python venv: /root/Bot-Qu-Tng/venv/ (dùng thay system python)

## Xử lý diverge

Nếu `git push` bị rejected (diverge): dùng `gitPush({ force: true })` qua CodeExecution.
Trên VPS luôn dùng `git reset --hard origin/main` thay vì `git pull`.

**How to apply:** Áp dụng cuối mỗi turn có thay đổi file code.
