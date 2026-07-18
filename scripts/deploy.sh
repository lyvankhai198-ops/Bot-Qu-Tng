#!/usr/bin/env bash
# scripts/deploy.sh — Build → Git push → VPS git pull → Restart
set -e

VPS="${VPS_USER:-root}@${VPS_HOST:-103.180.138.203}"
DEPLOY_PATH="${VPS_DEPLOY_PATH:-/root/Bot-Qu-Tng}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15"

# ── 1. Build admin-panel ──────────────────────────────────────────────────────
echo "▶ Building admin-panel..."
PORT=3000 BASE_PATH=/admin-panel/ pnpm --filter @workspace/admin-panel run build
echo "✓ admin-panel built"

# ── 2. Build api-server ───────────────────────────────────────────────────────
echo "▶ Building api-server..."
pnpm --filter @workspace/api-server run build
echo "✓ api-server built"

# ── 3. Commit dist + source lên GitHub ───────────────────────────────────────
echo "▶ Pushing to GitHub..."
git add -A
git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')" --allow-empty
echo "✓ committed"

# ── 4. VPS: git pull + restart ────────────────────────────────────────────────
echo "▶ VPS: git pull + restart..."
sshpass -p "${VPS_PASSWORD}" ssh ${SSH_OPTS} "${VPS}" "
  cd ${DEPLOY_PATH}
  git fetch origin main
  git reset --hard origin/main
  # Đảm bảo DATA_DIR có trong service
  if ! grep -q 'DATA_DIR' /etc/systemd/system/bot-api.service; then
    sed -i '/Environment=NODE_ENV=production/a Environment=DATA_DIR=${DEPLOY_PATH}/data' /etc/systemd/system/bot-api.service
    systemctl daemon-reload
  fi
  systemctl restart bot-api
  # Chỉ restart gift-bot khi có thay đổi bot.py hoặc data_manager.py
  if git diff HEAD~1 --name-only 2>/dev/null | grep -qE '^(bot\.py|data_manager\.py|translations\.py)'; then
    systemctl restart gift-bot
    echo "gift-bot restarted (bot.py changed)"
  else
    echo "gift-bot NOT restarted (only admin-panel/api-server changed)"
  fi
  systemctl is-active bot-api gift-bot
"
echo "✅ Deploy complete → http://${VPS_HOST:-103.180.138.203}/admin-panel/"
