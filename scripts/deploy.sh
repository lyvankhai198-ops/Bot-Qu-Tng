#!/usr/bin/env bash
# scripts/deploy.sh — Auto push GitHub + deploy VPS
# Dùng bởi agent sau mỗi lần cập nhật code.
# Yêu cầu: VPS_PASSWORD, VPS_HOST, VPS_USER, VPS_DEPLOY_PATH, VPS_SERVICE trong env.

set -e

# ── 1. Git commit & push ─────────────────────────────────────────────────────
echo "▶ Committing & pushing to GitHub..."

git add -A
if git diff --cached --quiet; then
  echo "  (no changes to commit)"
else
  MSG="${DEPLOY_MSG:-Auto-deploy: $(date '+%Y-%m-%d %H:%M')}"
  git commit -m "$MSG"
fi

git push origin main
echo "✓ GitHub updated"

# ── 2. Deploy to VPS ──────────────────────────────────────────────────────────
echo "▶ Deploying to VPS ${VPS_HOST}..."

sshpass -p "${VPS_PASSWORD}" ssh \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=15 \
  "${VPS_USER}@${VPS_HOST}" \
  "cd ${VPS_DEPLOY_PATH} && git fetch origin && git reset --hard origin/main && systemctl restart ${VPS_SERVICE} && echo '✓ VPS restarted'"

echo "✅ Deploy complete"
