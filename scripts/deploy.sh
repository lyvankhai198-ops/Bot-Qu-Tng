#!/usr/bin/env bash
# scripts/deploy.sh — Build + deploy lên VPS
# Gồm: build admin-panel & api-server → upload dist → git pull → restart services
# Yêu cầu: VPS_PASSWORD, VPS_HOST, VPS_USER, VPS_DEPLOY_PATH, VPS_SERVICE trong env.

set -e

VPS="${VPS_USER}@${VPS_HOST}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15"

# ── 1. Build admin-panel ──────────────────────────────────────────────────────
echo "▶ Building admin-panel..."
PORT=3000 BASE_PATH=/admin-panel/ pnpm --filter @workspace/admin-panel run build
echo "✓ admin-panel built"

# ── 2. Build api-server ───────────────────────────────────────────────────────
echo "▶ Building api-server..."
pnpm --filter @workspace/api-server run build
echo "✓ api-server built"

# ── 3. Upload dist files to VPS ───────────────────────────────────────────────
echo "▶ Uploading dist files to VPS..."
sshpass -p "${VPS_PASSWORD}" ssh ${SSH_OPTS} "${VPS}" \
  "mkdir -p ${VPS_DEPLOY_PATH}/artifacts/admin-panel/dist ${VPS_DEPLOY_PATH}/artifacts/api-server/dist"

sshpass -p "${VPS_PASSWORD}" scp ${SSH_OPTS} -r \
  artifacts/admin-panel/dist/public \
  "${VPS}:${VPS_DEPLOY_PATH}/artifacts/admin-panel/dist/"

sshpass -p "${VPS_PASSWORD}" scp ${SSH_OPTS} -r \
  artifacts/api-server/dist \
  "${VPS}:${VPS_DEPLOY_PATH}/artifacts/api-server/"

echo "✓ dist uploaded"

# ── 4. Restart services on VPS ────────────────────────────────────────────────
echo "▶ Restarting services on VPS..."
sshpass -p "${VPS_PASSWORD}" ssh ${SSH_OPTS} "${VPS}" "
  # Ensure DATA_DIR is set correctly in bot-api service
  if ! grep -q 'DATA_DIR' /etc/systemd/system/bot-api.service; then
    sed -i '/Environment=NODE_ENV=production/a Environment=DATA_DIR=${VPS_DEPLOY_PATH}/data' /etc/systemd/system/bot-api.service
    systemctl daemon-reload
  fi
  systemctl restart ${VPS_SERVICE} bot-api && systemctl is-active ${VPS_SERVICE} bot-api
"

echo "✅ Deploy complete → http://${VPS_HOST}/admin-panel/"
