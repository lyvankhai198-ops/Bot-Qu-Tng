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
# Dùng GITHUB_TOKEN (classic PAT, scope: repo) để push qua HTTPS
REPO_URL="https://lyvankhai198-ops:${GITHUB_TOKEN}@github.com/lyvankhai198-ops/Bot-Qu-Tng.git"
git push "${REPO_URL}" main || git push "${REPO_URL}" main --force
echo "✓ pushed to GitHub"

# ── 4. VPS: git pull + restart ────────────────────────────────────────────────
echo "▶ VPS: git pull + restart..."
sshpass -p "${VPS_PASSWORD}" ssh ${SSH_OPTS} "${VPS}" "
  cd ${DEPLOY_PATH}
  git fetch origin main

  # Backup data/ trước khi reset (data/ vừa được bỏ khỏi git tracking)
  if [ -d data ]; then
    cp -r data /tmp/bot_data_backup
  fi

  git reset --hard origin/main

  # Khôi phục data/ sau reset (git reset --hard sẽ xóa file đã untrack)
  if [ -d /tmp/bot_data_backup ]; then
    mkdir -p data
    cp -rn /tmp/bot_data_backup/. data/
    rm -rf /tmp/bot_data_backup
  fi

  # Đảm bảo DATA_DIR có trong service
  if ! grep -q 'DATA_DIR' /etc/systemd/system/bot-api.service; then
    sed -i '/Environment=NODE_ENV=production/a Environment=DATA_DIR=${DEPLOY_PATH}/data' /etc/systemd/system/bot-api.service
    systemctl daemon-reload
  fi
  # ── Cài openpyxl + playwright Python (--break-system-packages cho Ubuntu mới) ─
  pip3 install --break-system-packages -q openpyxl playwright || \
    pip3 install -q openpyxl playwright || true

  # ── Cài Chromium cho Python Playwright ───────────────────────────────────────
  python3 -m playwright install chromium --with-deps || true

  # ── Cài Node.js Playwright + Chromium (cho health-check worker) ──────────────
  cd ${DEPLOY_PATH}/artifacts/api-server
  # Đảm bảo playwright npm package có trong node_modules
  if [ ! -d node_modules/playwright ]; then
    npm install playwright 2>&1 | tail -3 || true
  fi
  # Cài browser binary — thử 2 lần, log đầy đủ lần đầu
  npx playwright install chromium --with-deps 2>&1 | tail -20 || \
    npx playwright install chromium 2>&1 | tail -10 || true
  # Kiểm tra xem chromium đã cài chưa
  npx playwright --version 2>&1 | head -2 || true
  ls ~/.cache/ms-playwright/ 2>/dev/null | head -5 || true
  cd ${DEPLOY_PATH}

  # ── Tạo / cập nhật systemd service cho sync-robot ────────────────────────────
  cat > /etc/systemd/system/sync-robot.service << 'UNIT'
[Unit]
Description=Bot Sync Robot
After=network.target bot-api.service
Requires=bot-api.service

[Service]
Type=simple
WorkingDirectory=/root/Bot-Qu-Tng
Environment=DATA_DIR=/root/Bot-Qu-Tng/data
Environment=API_BASE_URL=http://localhost:8081
Environment=SESSION_SECRET=Admin123
ExecStart=/usr/bin/python3 /root/Bot-Qu-Tng/sync_robot.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable sync-robot

  systemctl restart bot-api gift-bot sync-robot
  systemctl is-active bot-api gift-bot sync-robot
"
echo "✅ Deploy complete → http://${VPS_HOST:-103.180.138.203}/admin-panel/"
