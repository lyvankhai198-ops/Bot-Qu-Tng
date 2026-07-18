#!/usr/bin/env bash
# scripts/deploy.sh — Deploy lên VPS (git pull + restart service)
# GitHub push được xử lý riêng bởi gitPush() callback trong CodeExecution.
# Yêu cầu: VPS_PASSWORD, VPS_HOST, VPS_USER, VPS_DEPLOY_PATH, VPS_SERVICE trong env.

set -e

echo "▶ Deploying to VPS ${VPS_HOST}..."

sshpass -p "${VPS_PASSWORD}" ssh \
  -o StrictHostKeyChecking=no \
  -o ConnectTimeout=15 \
  "${VPS_USER}@${VPS_HOST}" \
  "cd ${VPS_DEPLOY_PATH} && git fetch origin && git reset --hard origin/main && systemctl restart ${VPS_SERVICE} && systemctl is-active ${VPS_SERVICE} && echo '✅ VPS deploy complete'"
