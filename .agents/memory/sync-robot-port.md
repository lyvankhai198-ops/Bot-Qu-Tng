---
name: Sync robot port mismatch
description: sync-robot.service có API_BASE_URL=http://localhost:8081 nhưng API server chạy ở port 3002
---

## Rule
Khi sync robot báo `download_ok: true` nhưng `new_orders: 0, skipped_orders: 0` và API call hoàn thành < 50ms → kiểm tra `API_BASE_URL` trong `/etc/systemd/system/sync-robot.service`.

**Why:** sync_robot.py gọi `os.environ.get("API_BASE_URL", "http://localhost:8081")`. Service file set sai port. Connection refused → exception bị catch silently → trả về `{"new": 0}`.

**How to apply:** Fix bằng `sed -i 's|localhost:8081|localhost:3002|g' /etc/systemd/system/sync-robot.service && systemctl daemon-reload && systemctl restart sync-robot.service`. Confirm bằng journalctl thấy "X đơn mới" thay vì "0 đơn mới".
