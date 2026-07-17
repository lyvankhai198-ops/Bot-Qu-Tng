import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const router = Router();

// ── Data directory ──────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

function dataFile(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name: string, fallback: unknown = null): any {
  const file = dataFile(name);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(name: string, data: unknown) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // backup first
  const file = dataFile(name);
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, dataFile(name + ".bak")); } catch {}
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

function addLog(action: string, user = "", admin = "") {
  const logs: any[] = readJson("logs", []) ?? [];
  logs.push({ time: new Date().toISOString(), action, user, admin });
  if (logs.length > 1000) logs.splice(0, logs.length - 1000);
  writeJson("logs", logs);
}

function now() { return new Date().toISOString(); }

function normalizeAccount(acc: any): any {
  if (!acc || typeof acc !== "object") return { email: String(acc), password: "", status: "available" };
  return {
    id: acc.id ?? crypto.randomUUID().slice(0, 8),
    type: acc.type ?? "",
    email: acc.email ?? "",
    password: acc.password ?? "",
    note: acc.note ?? "",
    addedAt: acc.addedAt ?? now(),
    status: acc.status ?? "available",
    distributedTo: acc.distributedTo ?? null,
    distributedAt: acc.distributedAt ?? null,
  };
}

// ── Auth middleware ─────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const token = auth.slice(7);
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) { res.status(401).json({ error: "Invalid token" }); return; }
  next();
}

// ── Settings helpers ────────────────────────────────────────────────────────
function readSettings(): any {
  const defaults = {
    shop_link: "", shop_username: "", support_username: "",
    cooldown_hours: 0, round_id: "dot1",
    gift_enabled: true, support_enabled: true, intro_enabled: true,
    maintenance_mode: false, refund_formula: "remaining_days", refund_custom_text: "",
  };
  return { ...defaults, ...(readJson("settings", {}) ?? {}) };
}

function settingsToApi(s: any) {
  return {
    shopLink: s.shop_link ?? "",
    shopUsername: s.shop_username ?? "",
    supportUsername: s.support_username ?? "",
    cooldownHours: s.cooldown_hours ?? 0,
    roundId: s.round_id ?? "dot1",
    giftEnabled: s.gift_enabled ?? true,
    supportEnabled: s.support_enabled ?? true,
    introEnabled: s.intro_enabled ?? true,
    maintenanceMode: s.maintenance_mode ?? false,
    refundFormula: s.refund_formula ?? "remaining_days",
    refundCustomText: s.refund_custom_text ?? "",
  };
}

// ── POST /bot/auth ──────────────────────────────────────────────────────────
router.post("/bot/auth", (req: any, res: any) => {
  const { password } = req.body ?? {};
  if (!ADMIN_SECRET || password !== ADMIN_SECRET) {
    res.status(401).json({ error: "Mật khẩu không đúng" });
    return;
  }
  res.json({ token: ADMIN_SECRET });
});

// ── GET /bot/stats ──────────────────────────────────────────────────────────
router.get("/bot/stats", requireAuth, (_req: any, res: any) => {
  const s = readSettings();
  const users: any = readJson("users", {}) ?? {};
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const banned: string[] = readJson("banned_users", []) ?? [];
  const claimed: any = readJson("claimed_users", {}) ?? {};
  const orders: any = readJson("orders", {}) ?? {};
  const warranty: any[] = readJson("warranty_requests", []) ?? [];

  const roundClaims = claimed[s.round_id] ?? {};
  const stock = accounts.filter((a: any) => a.status === "available").length;

  res.json({
    totalUsers: Object.keys(users).length,
    stock,
    claimed: Object.keys(roundClaims).length,
    banned: banned.length,
    roundId: s.round_id,
    totalOrders: Object.keys(orders).length,
    warrantyPending: warranty.filter((w: any) => w.status === "pending").length,
    warrantyResolved: warranty.filter((w: any) => w.status === "resolved").length,
    warrantyRejected: warranty.filter((w: any) => w.status === "rejected").length,
  });
});

// ── GET /bot/settings ───────────────────────────────────────────────────────
router.get("/bot/settings", requireAuth, (_req: any, res: any) => {
  res.json(settingsToApi(readSettings()));
});

// ── PUT /bot/settings ───────────────────────────────────────────────────────
router.put("/bot/settings", requireAuth, (req: any, res: any) => {
  const s = readJson("settings", {}) ?? {};
  const b = req.body ?? {};
  const map: Record<string, string> = {
    shopLink: "shop_link", shopUsername: "shop_username", supportUsername: "support_username",
    cooldownHours: "cooldown_hours", roundId: "round_id",
    giftEnabled: "gift_enabled", supportEnabled: "support_enabled", introEnabled: "intro_enabled",
    maintenanceMode: "maintenance_mode", refundFormula: "refund_formula", refundCustomText: "refund_custom_text",
  };
  for (const [k, v] of Object.entries(map)) {
    if (b[k] !== undefined) s[v] = k === "cooldownHours" ? Number(b[k]) : b[k];
  }
  writeJson("settings", s);
  addLog("UPDATE_SETTINGS", "", "web-admin");
  res.json(settingsToApi({ ...readSettings(), ...s }));
});

// ── GET /bot/accounts ───────────────────────────────────────────────────────
router.get("/bot/accounts", requireAuth, (_req: any, res: any) => {
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  res.json(accounts);
});

// ── POST /bot/accounts ──────────────────────────────────────────────────────
router.post("/bot/accounts", requireAuth, (req: any, res: any) => {
  const incoming: any[] = Array.isArray(req.body?.accounts) ? req.body.accounts : [];
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const existing = new Set(accounts.map((a: any) => a.email));
  let added = 0;
  for (const acc of incoming) {
    if (acc.email && !existing.has(acc.email)) {
      accounts.push(normalizeAccount({ ...acc, addedAt: now(), status: "available" }));
      existing.add(acc.email);
      added++;
    }
  }
  writeJson("accounts", accounts);
  addLog("ADD_ACCOUNTS", `added=${added}`, "web-admin");
  res.json({ added, total: accounts.length });
});

// ── PUT /bot/accounts/:email ────────────────────────────────────────────────
router.put("/bot/accounts/:email", requireAuth, (req: any, res: any) => {
  const email = decodeURIComponent(req.params.email);
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const idx = accounts.findIndex((a: any) => a.email === email);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const allowed = ["type", "password", "note", "status"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) accounts[idx][k] = req.body[k];
  }
  writeJson("accounts", accounts);
  res.json({ ok: true, message: "Đã cập nhật" });
});

// ── DELETE /bot/accounts/:email ─────────────────────────────────────────────
router.delete("/bot/accounts/:email", requireAuth, (req: any, res: any) => {
  const email = decodeURIComponent(req.params.email);
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const filtered = accounts.filter((a: any) => a.email !== email);
  if (filtered.length === accounts.length) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  writeJson("accounts", filtered);
  addLog("DELETE_ACCOUNT", email, "web-admin");
  res.json({ ok: true, message: `Đã xoá ${email}` });
});

// ── GET /bot/users ──────────────────────────────────────────────────────────
router.get("/bot/users", requireAuth, (_req: any, res: any) => {
  const users: any = readJson("users", {}) ?? {};
  const result = Object.entries(users).map(([uid, u]: [string, any]) => ({
    userId: uid,
    username: u.username ?? "",
    firstName: u.first_name ?? "",
    startedAt: u.started_at ?? "",
    lastActive: u.last_active ?? "",
    usageCount: u.usage_count ?? 0,
    hasReceivedGift: u.has_received_gift ?? false,
    giftReceived: u.gift_received ?? null,
    banned: u.banned ?? false,
  }));
  res.json(result);
});

// ── POST /bot/users/:userId/ban ─────────────────────────────────────────────
router.post("/bot/users/:userId/ban", requireAuth, (req: any, res: any) => {
  const uid = req.params.userId;
  const banned: string[] = readJson("banned_users", []) ?? [];
  if (!banned.includes(uid)) banned.push(uid);
  writeJson("banned_users", banned);
  const users: any = readJson("users", {}) ?? {};
  if (users[uid]) { users[uid].banned = true; writeJson("users", users); }
  addLog("BAN", uid, "web-admin");
  res.json({ ok: true, message: `Đã chặn ${uid}` });
});

// ── POST /bot/users/:userId/unban ───────────────────────────────────────────
router.post("/bot/users/:userId/unban", requireAuth, (req: any, res: any) => {
  const uid = req.params.userId;
  const banned: string[] = (readJson("banned_users", []) ?? []).filter((b: string) => b !== uid);
  writeJson("banned_users", banned);
  const users: any = readJson("users", {}) ?? {};
  if (users[uid]) { users[uid].banned = false; writeJson("users", users); }
  addLog("UNBAN", uid, "web-admin");
  res.json({ ok: true, message: `Đã bỏ chặn ${uid}` });
});

// ── POST /bot/users/:userId/reset-gift ──────────────────────────────────────
router.post("/bot/users/:userId/reset-gift", requireAuth, (req: any, res: any) => {
  const uid = req.params.userId;
  const users: any = readJson("users", {}) ?? {};
  if (!users[uid]) { res.status(404).json({ ok: false, message: "User không tồn tại" }); return; }
  users[uid].has_received_gift = false;
  users[uid].gift_received = null;
  writeJson("users", users);
  addLog("RESET_GIFT", uid, "web-admin");
  res.json({ ok: true, message: `Đã reset quà cho ${uid}` });
});

// ── GET /bot/logs ───────────────────────────────────────────────────────────
router.get("/bot/logs", requireAuth, (req: any, res: any) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const logs: any[] = readJson("logs", []) ?? [];
  res.json(logs.slice(-limit).reverse());
});

// ── GET /bot/receivers ──────────────────────────────────────────────────────
router.get("/bot/receivers", requireAuth, (_req: any, res: any) => {
  const s = readSettings();
  const claimed: any = readJson("claimed_users", {}) ?? {};
  const roundClaims = claimed[s.round_id] ?? {};
  const result = Object.values(roundClaims).map((r: any) => ({
    userId: String(r.user_id ?? ""),
    username: r.username ?? "",
    firstName: r.first_name ?? "",
    claimTime: r.claim_time ?? "",
    accountEmail: r.account_email ?? "",
    roundId: r.round_id ?? s.round_id,
  }));
  res.json(result);
});

// ── POST /bot/broadcast ─────────────────────────────────────────────────────
router.post("/bot/broadcast", requireAuth, (req: any, res: any) => {
  const { message, target = "all" } = req.body ?? {};
  if (!message) { res.status(400).json({ ok: false, message: "message là bắt buộc" }); return; }
  const pending: any[] = readJson("pending_broadcasts", []) ?? [];
  pending.push({ message, target, queued_at: now() });
  writeJson("pending_broadcasts", pending);
  addLog("QUEUE_BROADCAST", `target=${target}`, "web-admin");
  res.json({ ok: true, message: "Đã thêm vào hàng đợi" });
});

// ── POST /bot/round ─────────────────────────────────────────────────────────
router.post("/bot/round", requireAuth, (req: any, res: any) => {
  const { roundId } = req.body ?? {};
  if (!roundId) { res.status(400).json({ ok: false, message: "roundId là bắt buộc" }); return; }
  const s = readJson("settings", {}) ?? {};
  const oldRound = s.round_id ?? "dot1";
  s.round_id = roundId;
  writeJson("settings", s);
  const claimed: any = readJson("claimed_users", {}) ?? {};
  delete claimed[oldRound];
  writeJson("claimed_users", claimed);
  addLog("NEW_ROUND", roundId, "web-admin");
  res.json({ ok: true, message: `Đã mở đợt mới: ${roundId}` });
});

// ── GET /bot/orders ─────────────────────────────────────────────────────────
router.get("/bot/orders", requireAuth, (_req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  res.json(Object.values(orders));
});

// ── POST /bot/orders ────────────────────────────────────────────────────────
router.post("/bot/orders", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const orders: any = readJson("orders", {}) ?? {};
  const orderId = body.orderId || ("ORD" + crypto.randomUUID().slice(0, 6).toUpperCase());
  const order = { ...body, orderId, createdAt: now() };
  orders[orderId] = order;
  writeJson("orders", orders);
  addLog("CREATE_ORDER", orderId, "web-admin");
  res.json(order);
});

// ── GET /bot/orders/:orderId ─────────────────────────────────────────────────
router.get("/bot/orders/:orderId", requireAuth, (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  const order = orders[req.params.orderId];
  if (!order) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  res.json(order);
});

// ── PUT /bot/orders/:orderId ─────────────────────────────────────────────────
router.put("/bot/orders/:orderId", requireAuth, (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  const id = req.params.orderId;
  if (!orders[id]) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  orders[id] = { ...orders[id], ...req.body, orderId: id, updatedAt: now() };
  writeJson("orders", orders);
  addLog("UPDATE_ORDER", id, "web-admin");
  res.json({ ok: true, message: "Đã cập nhật" });
});

// ── DELETE /bot/orders/:orderId ──────────────────────────────────────────────
router.delete("/bot/orders/:orderId", requireAuth, (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  const id = req.params.orderId;
  if (!orders[id]) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  delete orders[id];
  writeJson("orders", orders);
  addLog("DELETE_ORDER", id, "web-admin");
  res.json({ ok: true, message: "Đã xoá" });
});

// ── GET /bot/warranty ────────────────────────────────────────────────────────
router.get("/bot/warranty", requireAuth, (_req: any, res: any) => {
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  res.json(requests.sort((a: any, b: any) => b.submittedAt?.localeCompare(a.submittedAt ?? "") ?? 0));
});

// ── Warranty resolve helpers ─────────────────────────────────────────────────
function queueDirectMessage(userId: string, message: string) {
  const pending: any[] = readJson("pending_broadcasts", []) ?? [];
  pending.push({ message, target: `user:${userId}`, queued_at: now() });
  writeJson("pending_broadcasts", pending);
}

// ── POST /bot/warranty/:id/replacement ──────────────────────────────────────
router.post("/bot/warranty/:id/replacement", requireAuth, (req: any, res: any) => {
  const { id } = req.params;
  const { email, password, note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "resolved", resolution: `replacement:${email}`, resolvedAt: now() };
  writeJson("warranty_requests", requests);
  // Update order status
  const orders: any = readJson("orders", {}) ?? {};
  if (req_.orderId && orders[req_.orderId]) {
    orders[req_.orderId].status = "warranted";
    writeJson("orders", orders);
  }
  // Notify user via bot
  const msg = `✅ <b>Yêu cầu bảo hành đã được chấp nhận!</b>\n\n📧 Tài khoản mới:\nEmail: <code>${email}</code>\nMật khẩu: <code>${password}</code>${note ? `\n\n📝 Ghi chú: ${note}` : ""}`;
  queueDirectMessage(req_.userId, msg);
  addLog("WARRANTY_REPLACEMENT", `${id} → ${email}`, "web-admin");
  res.json({ ok: true, message: "Đã gửi tài khoản thay thế" });
});

// ── POST /bot/warranty/:id/refund ────────────────────────────────────────────
router.post("/bot/warranty/:id/refund", requireAuth, (req: any, res: any) => {
  const { id } = req.params;
  const { amount, note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "resolved", resolution: `refund:${amount}`, resolvedAt: now() };
  writeJson("warranty_requests", requests);
  const orders: any = readJson("orders", {}) ?? {};
  if (req_.orderId && orders[req_.orderId]) {
    orders[req_.orderId].status = "refunded";
    writeJson("orders", orders);
  }
  const msg = `💰 <b>Yêu cầu hoàn tiền đã được chấp nhận!</b>\n\nSố tiền hoàn: <b>${Number(amount).toLocaleString("vi")}đ</b>${note ? `\n\n📝 Ghi chú: ${note}` : ""}`;
  queueDirectMessage(req_.userId, msg);
  addLog("WARRANTY_REFUND", `${id} → ${amount}đ`, "web-admin");
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── POST /bot/warranty/:id/reject ────────────────────────────────────────────
router.post("/bot/warranty/:id/reject", requireAuth, (req: any, res: any) => {
  const { id } = req.params;
  const { reason } = req.body ?? {};
  if (!reason) { res.status(400).json({ ok: false, message: "Lý do là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now() };
  writeJson("warranty_requests", requests);
  const msg = `❌ <b>Yêu cầu bảo hành không được chấp nhận.</b>\n\nLý do: ${reason}`;
  queueDirectMessage(req_.userId, msg);
  addLog("WARRANTY_REJECT", `${id}: ${reason}`, "web-admin");
  res.json({ ok: true, message: "Đã từ chối" });
});

// ── GET /bot/intro ───────────────────────────────────────────────────────────
router.get("/bot/intro", requireAuth, (_req: any, res: any) => {
  const defaults = { title: "Giới thiệu", content: "", photoUrl: "", videoUrl: "", buttons: [] };
  res.json({ ...defaults, ...(readJson("intro", {}) ?? {}) });
});

// ── PUT /bot/intro ───────────────────────────────────────────────────────────
router.put("/bot/intro", requireAuth, (req: any, res: any) => {
  writeJson("intro", req.body ?? {});
  addLog("UPDATE_INTRO", "", "web-admin");
  res.json({ ok: true, message: "Đã cập nhật giới thiệu" });
});

// ── GET /bot/backup ──────────────────────────────────────────────────────────
router.get("/bot/backup", requireAuth, (_req: any, res: any) => {
  const files = ["users", "accounts", "settings", "claimed_users", "banned_users", "logs", "orders", "warranty_requests", "intro", "pending_broadcasts"];
  const backup: any = { exportedAt: now() };
  for (const f of files) {
    backup[f] = readJson(f, null);
  }
  res.setHeader("Content-Disposition", `attachment; filename="backup-${Date.now()}.json"`);
  res.json(backup);
});

export default router;
