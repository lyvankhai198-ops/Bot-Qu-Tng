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

  const ns: any = readJson("notification_settings", {}) ?? {};
  const urgentMinutes: number = ns.urgentMinutes ?? 30;
  const nowMs = Date.now();

  res.json({
    totalUsers: Object.keys(users).length,
    stock,
    claimed: Object.keys(roundClaims).length,
    banned: banned.length,
    roundId: s.round_id,
    totalOrders: Object.keys(orders).length,
    warrantyPending:    warranty.filter((w: any) => w.status === "pending").length,
    warrantyProcessing: warranty.filter((w: any) => w.status === "processing").length,
    warrantyResolved:   warranty.filter((w: any) => ["resolved", "send_failed"].includes(w.status)).length,
    warrantyRejected:   warranty.filter((w: any) => w.status === "rejected").length,
    warrantyOverdue:    warranty.filter((w: any) => {
      if (!["pending", "processing"].includes(w.status)) return false;
      if (w.acknowledgedAt) return false;
      const elapsed = (nowMs - new Date(w.submittedAt).getTime()) / 60000;
      return elapsed > urgentMinutes;
    }).length,
  });
});

// ── GET /bot/notification-settings ──────────────────────────────────────────
router.get("/bot/notification-settings", requireAuth, (_req: any, res: any) => {
  const defaults = { enabled: true, adminIds: [] as string[], reminderEnabled: true, reminder1Minutes: 5, reminder2Minutes: 15, urgentMinutes: 30 };
  const stored = readJson("notification_settings", {}) ?? {};
  res.json({ ...defaults, ...stored });
});

// ── PUT /bot/notification-settings ──────────────────────────────────────────
router.put("/bot/notification-settings", requireAuth, (req: any, res: any) => {
  const current = readJson("notification_settings", {}) ?? {};
  const updated = { ...current, ...req.body };
  writeJson("notification_settings", updated);
  addLog("NOTIF_SETTINGS_UPDATE", JSON.stringify(updated).slice(0, 120), "web-admin");
  res.json(updated);
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
  const orderId = "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
  const order = { ...body, orderId, createdAt: now() };
  orders[orderId] = order;
  writeJson("orders", orders);
  addLog("CREATE_ORDER", orderId, "web-admin");
  res.json(order);
});

// ── POST /bot/orders/bulk ────────────────────────────────────────────────────
router.post("/bot/orders/bulk", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const { productName, price, purchaseDate, expiryDate, warrantyExpiry, usagePeriod, warrantyPeriod, notes, accounts } = body;
  if (!productName || !purchaseDate || !Array.isArray(accounts) || accounts.length === 0) {
    res.status(400).json({ ok: false, message: "productName, purchaseDate và accounts là bắt buộc" }); return;
  }

  const orders: any = readJson("orders", {}) ?? {};
  const existingEmails = new Set(
    Object.values(orders).map((o: any) => (o.email ?? "").toLowerCase())
  );

  const errors: { email: string; reason: string }[] = [];
  let added = 0;
  let skipped = 0;

  for (const acc of accounts) {
    const email: string = (acc.email ?? "").trim();
    if (!email) {
      errors.push({ email: "(trống)", reason: "Thiếu email" });
      skipped++;
      continue;
    }
    if (existingEmails.has(email.toLowerCase())) {
      errors.push({ email, reason: "Email đã tồn tại trong hệ thống" });
      skipped++;
      continue;
    }
    const orderId = "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
    orders[orderId] = {
      orderId,
      email,
      password: acc.password || null,
      twoFA: acc.twoFA || null,
      productName,
      price: price ?? null,
      purchaseDate: purchaseDate ?? null,
      expiryDate: expiryDate ?? null,
      warrantyExpiry: warrantyExpiry ?? null,
      usagePeriod: usagePeriod ?? null,
      warrantyPeriod: warrantyPeriod ?? null,
      notes: notes ?? null,
      status: "active",
      createdAt: now(),
    };
    existingEmails.add(email.toLowerCase());
    added++;
  }

  writeJson("orders", orders);
  addLog("BULK_CREATE_ORDERS", `added=${added} skipped=${skipped}`, "web-admin");
  res.json({ added, skipped, errors });
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

// ── Group warranty status helper ─────────────────────────────────────────────
function _recomputeGroupStatus(req: any): void {
  const accs: any[] = req.accounts ?? [];
  const statuses = accs.map((a: any) => a.status ?? "pending");
  if (statuses.length > 0 && statuses.every((s: string) => ["resolved", "rejected"].includes(s))) {
    req.status = "resolved";
    if (!req.resolvedAt) req.resolvedAt = now();
  } else if (req.acknowledgedAt || statuses.some((s: string) => s === "processing")) {
    if (req.status !== "resolved") req.status = "processing";
  }
}

// ── GET /bot/warranty ────────────────────────────────────────────────────────
router.get("/bot/warranty", requireAuth, (_req: any, res: any) => {
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  res.json(requests.sort((a: any, b: any) => b.submittedAt?.localeCompare(a.submittedAt ?? "") ?? 0));
});

// ── Telegram direct send ─────────────────────────────────────────────────────
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

async function sendTelegramMessage(userId: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: userId, text: message, parse_mode: "HTML" }),
    });
    const data: any = await resp.json();
    if (data.ok) return { ok: true };
    return { ok: false, error: data.description ?? "Telegram error" };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network error" };
  }
}

function buildReplacementMessage(req_: any, email: string, password: string, twoFA?: string, note?: string): string {
  // Use lang stored at warranty submission time (most reliable source)
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi";
  const isEN = userLang === "en";
  const lines: string[] = [];
  if (isEN) {
    lines.push(`✅ <b>WARRANTY REQUEST RESOLVED</b>\n`);
    if (req_.productName) lines.push(`🛍 Product: <b>${req_.productName}</b>`);
    lines.push(`\n🔑 <b>Replacement Account:</b>`);
    lines.push(`📧 Email/Account: <code>${email}</code>`);
    lines.push(`🔒 Password: <code>${password}</code>`);
    if (twoFA) lines.push(`🛡 2FA / Extra info: <code>${twoFA}</code>`);
    if (note) lines.push(`📝 Note: ${note}`);
    lines.push(`\nPlease verify your account immediately after receiving.`);
  } else {
    lines.push(`✅ <b>YÊU CẦU BẢO HÀNH ĐÃ ĐƯỢC GIẢI QUYẾT</b>\n`);
    if (req_.productName) lines.push(`🛍 Sản phẩm: <b>${req_.productName}</b>`);
    lines.push(`\n🔑 <b>Tài khoản thay thế:</b>`);
    lines.push(`📧 Email/Tài khoản: <code>${email}</code>`);
    lines.push(`🔒 Mật khẩu: <code>${password}</code>`);
    if (twoFA) lines.push(`🛡 2FA/Thông tin bổ sung: <code>${twoFA}</code>`);
    if (note) lines.push(`📝 Ghi chú: ${note}`);
    lines.push(`\nVui lòng kiểm tra tài khoản ngay sau khi nhận.`);
  }
  return lines.join("\n");
}

// ── POST /bot/warranty/:id/replacement ──────────────────────────────────────
router.post("/bot/warranty/:id/replacement", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { email, password, twoFA, note } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ ok: false, message: "Email và mật khẩu là bắt buộc" }); return; }

  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];

  // Store replacement info first
  const replacementData = {
    replacementEmail: email,
    replacementPassword: password,
    replacementTwoFA: twoFA || null,
    replacementNote: note || null,
    resolvedAt: now(),
    resolvedBy: "web-admin",
  };

  // Send via Telegram
  const message = buildReplacementMessage(req_, email, password, twoFA, note);
  const result = await sendTelegramMessage(req_.userId, message);

  // Update order status regardless of send outcome
  const orders: any = readJson("orders", {}) ?? {};
  if (req_.orderId && orders[req_.orderId]) { orders[req_.orderId].status = "warranted"; writeJson("orders", orders); }

  if (result.ok) {
    requests[idx] = { ...req_, ...replacementData, status: "resolved", resolution: `replacement:${email}`, sentStatus: "sent", sentAt: now(), sentError: null };
    writeJson("warranty_requests", requests);
    addLog("WARRANTY_REPLACEMENT", `${id} → ${email} | sent OK`, "web-admin");
    res.json({ ok: true, sentStatus: "sent", message: "Đã gửi tài khoản thay thế cho khách" });
  } else {
    requests[idx] = { ...req_, ...replacementData, status: "send_failed", resolution: `replacement:${email}`, sentStatus: "failed", sentError: result.error, sentAt: null };
    writeJson("warranty_requests", requests);
    addLog("WARRANTY_REPLACEMENT_FAIL", `${id} → ${email} | ${result.error}`, "web-admin");
    // Return 200 so admin panel shows the resend button instead of a generic error
    res.json({ ok: false, sentStatus: "failed", message: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/resend-ack ────────────────────────────────────────
router.post("/bot/warranty/:id/resend-ack", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  if (!req_.acknowledgedAt) {
    res.status(400).json({ ok: false, message: "Yêu cầu chưa được tiếp nhận" }); return;
  }
  const msg = `✅ <b>YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN</b>\n\nShop đã nhận được yêu cầu bảo hành của bạn và đang tiến hành kiểm tra. Kết quả xử lý sẽ được bot thông báo ngay khi hoàn tất. Vui lòng chờ và không gửi lại yêu cầu trùng lặp.`;
  const result = await sendTelegramMessage(req_.userId, msg);
  if (result.ok) {
    requests[idx] = { ...req_, ackNotifSentStatus: "sent", ackNotifSentAt: now(), ackNotifError: null };
    writeJson("warranty_requests", requests);
    addLog("WARRANTY_ACK_RESEND", `${id} → sent OK`, "web-admin");
    res.json({ ok: true, message: "Đã gửi lại thông báo tiếp nhận cho khách" });
  } else {
    requests[idx] = { ...req_, ackNotifSentStatus: "failed", ackNotifError: result.error };
    writeJson("warranty_requests", requests);
    res.json({ ok: false, message: `Gửi lại thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/accounts/:accId/replacement ──────────────────────
router.post("/bot/warranty/:id/accounts/:accId/replacement", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { email, password, twoFA, note } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ ok: false, message: "Email và mật khẩu là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];

  const userLang = req_.userLang ?? "vi";
  const isEN = userLang === "en";
  const msgLines: string[] = [];
  if (isEN) {
    msgLines.push(`✅ <b>WARRANTY RESOLVED</b>\n`);
    msgLines.push(`📧 Old account: <code>${acc.email}</code>`);
    msgLines.push(`🔑 <b>Replacement account:</b>`);
    msgLines.push(`📧 Email: <code>${email}</code>`);
    msgLines.push(`🔒 Password: <code>${password}</code>`);
    if (twoFA) msgLines.push(`🛡 2FA: <code>${twoFA}</code>`);
    if (note) msgLines.push(`📝 Note: ${note}`);
    msgLines.push(`\nPlease verify your account immediately after receiving.`);
  } else {
    msgLines.push(`✅ <b>ĐÃ GIẢI QUYẾT BẢO HÀNH</b>\n`);
    msgLines.push(`📧 Tài khoản cũ: <code>${acc.email}</code>`);
    msgLines.push(`🔑 <b>Tài khoản thay thế:</b>`);
    msgLines.push(`📧 Email: <code>${email}</code>`);
    msgLines.push(`🔒 Mật khẩu: <code>${password}</code>`);
    if (twoFA) msgLines.push(`🛡 2FA: <code>${twoFA}</code>`);
    if (note) msgLines.push(`📝 Ghi chú: ${note}`);
    msgLines.push(`\nVui lòng kiểm tra tài khoản ngay sau khi nhận.`);
  }
  const result = await sendTelegramMessage(req_.userId, msgLines.join("\n"));
  const replacementData = { replacementEmail: email, replacementPassword: password, replacementTwoFA: twoFA || null, replacementNote: note || null, resolvedAt: now(), resolvedBy: "web-admin", status: "resolved", resolution: `replacement:${email}`, sentStatus: result.ok ? "sent" : "failed", sentAt: result.ok ? now() : null, sentError: result.ok ? null : result.error };
  requests[idx].accounts[accIdx] = { ...acc, ...replacementData };
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);
  addLog("GROUP_REPLACEMENT", `${id}/${accId} → ${email}`, "web-admin");
  res.json({ ok: result.ok, sentStatus: result.ok ? "sent" : "failed", message: result.ok ? "Đã gửi tài khoản thay thế cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/accounts/:accId/refund ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/refund", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { amount, note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  requests[idx].accounts[accIdx] = { ...acc, status: "resolved", resolution: `refund:${amount}`, resolvedAt: now(), resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);
  const msg = `💰 <b>Hoàn tiền tài khoản: <code>${acc.email}</code></b>\n\nSố tiền: <b>${Number(amount).toLocaleString("vi")}đ</b>${note ? `\nGhi chú: ${note}` : ""}`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("GROUP_REFUND", `${id}/${accId} → ${amount}đ`, "web-admin");
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── POST /bot/warranty/:id/accounts/:accId/reject ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/reject", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { reason } = req.body ?? {};
  if (!reason) { res.status(400).json({ ok: false, message: "Lý do là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  requests[idx].accounts[accIdx] = { ...acc, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now(), resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);
  const msg = `❌ <b>Tài khoản <code>${acc.email}</code> không được bảo hành.</b>\n\nLý do: ${reason}`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("GROUP_REJECT", `${id}/${accId}: ${reason}`, "web-admin");
  res.json({ ok: true, message: "Đã từ chối" });
});

// ── POST /bot/warranty/:id/accounts/:accId/resend ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/resend", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  if (!acc.replacementEmail || !acc.replacementPassword) { res.status(400).json({ ok: false, message: "Không có thông tin tài khoản thay thế" }); return; }
  const fakeReq = { ...req_, orderId: acc.orderId, productName: acc.productName };
  const message = buildReplacementMessage(fakeReq, acc.replacementEmail, acc.replacementPassword, acc.replacementTwoFA, acc.replacementNote);
  const result = await sendTelegramMessage(req_.userId, message);
  if (result.ok) {
    requests[idx].accounts[accIdx] = { ...acc, sentStatus: "sent", sentAt: now(), sentError: null };
  } else {
    requests[idx].accounts[accIdx] = { ...acc, sentStatus: "failed", sentError: result.error };
  }
  writeJson("warranty_requests", requests);
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi lại thành công" : `Gửi lại thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/resend ────────────────────────────────────────────
router.post("/bot/warranty/:id/resend", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  if (!req_.replacementEmail || !req_.replacementPassword) {
    res.status(400).json({ ok: false, message: "Không có thông tin tài khoản thay thế để gửi lại" }); return;
  }
  const message = buildReplacementMessage(req_, req_.replacementEmail, req_.replacementPassword, req_.replacementTwoFA, req_.replacementNote);
  const result = await sendTelegramMessage(req_.userId, message);
  if (result.ok) {
    requests[idx] = { ...req_, status: "resolved", sentStatus: "sent", sentAt: now(), sentError: null };
    writeJson("warranty_requests", requests);
    addLog("WARRANTY_RESEND", `${id} → ${req_.replacementEmail} | OK`, "web-admin");
    res.json({ ok: true, message: "Đã gửi lại thành công" });
  } else {
    requests[idx] = { ...req_, sentStatus: "failed", sentError: result.error };
    writeJson("warranty_requests", requests);
    res.status(500).json({ ok: false, message: `Gửi lại thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/refund ────────────────────────────────────────────
router.post("/bot/warranty/:id/refund", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { amount, note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "resolved", resolution: `refund:${amount}`, resolvedAt: now(), resolvedBy: "web-admin" };
  writeJson("warranty_requests", requests);
  const orders: any = readJson("orders", {}) ?? {};
  if (req_.orderId && orders[req_.orderId]) {
    orders[req_.orderId].status = "refunded";
    writeJson("orders", orders);
  }
  const msg = `💰 <b>Yêu cầu hoàn tiền đã được chấp nhận!</b>\n\nSố tiền hoàn: <b>${Number(amount).toLocaleString("vi")}đ</b>${note ? `\n\n📝 Ghi chú: ${note}` : ""}`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("WARRANTY_REFUND", `${id} → ${amount}đ`, "web-admin");
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── POST /bot/warranty/:id/reject ────────────────────────────────────────────
router.post("/bot/warranty/:id/reject", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { reason } = req.body ?? {};
  if (!reason) { res.status(400).json({ ok: false, message: "Lý do là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now(), resolvedBy: "web-admin" };
  writeJson("warranty_requests", requests);
  const msg = `❌ <b>Yêu cầu bảo hành không được chấp nhận.</b>\n\nLý do: ${reason}`;
  await sendTelegramMessage(req_.userId, msg);
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
