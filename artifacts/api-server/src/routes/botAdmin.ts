import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

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
  if (!acc || typeof acc !== "object") {
    // Legacy plain-string entry — always assign a stable id so health history can be keyed
    return { id: crypto.randomUUID().slice(0, 8), email: String(acc), password: "", status: "available", type: "", note: "", addedAt: now(), distributedTo: null, distributedAt: null };
  }
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
    require_channel_check: false,
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
    requireChannelCheck: s.require_channel_check ?? false,
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

// ── GET /bot/pending-counts ─────────────────────────────────────────────────
// Lightweight single-request summary used by the sidebar badge system.
router.get("/bot/pending-counts", requireAuth, (_req: any, res: any) => {
  const warranty:  any[] = readJson("warranty_requests", []) ?? [];
  const delivery:  any[] = readJson("delivery_requests", []) ?? [];
  const syncStatus: any  = readJson("sync_robot_status", {}) ?? {};

  const deliveryPending  = delivery.filter((r: any) => r.status === "pending").length;
  const warrantyPending  = warranty.filter((w: any) => ["pending", "processing"].includes(w.status)).length;
  // Sync-robot badge: errors reported in last run (errors > 0)
  const syncErrors       = Number(syncStatus?.last_run?.errors ?? 0);

  res.json({ delivery: deliveryPending, warranty: warrantyPending, syncRobot: syncErrors });
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
    requireChannelCheck: "require_channel_check",
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

// ── GET /bot/stock-notify-settings ──────────────────────────────────────────
router.get("/bot/stock-notify-settings", requireAuth, (_req: any, res: any) => {
  const defaults = {
    enabled: true,
    message: "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!",
    target: "no_received",
  };
  const stored = readJson("stock_notify_settings", {}) ?? {};
  res.json({ ...defaults, ...stored });
});

// ── PUT /bot/stock-notify-settings ──────────────────────────────────────────
router.put("/bot/stock-notify-settings", requireAuth, (req: any, res: any) => {
  const defaults = {
    enabled: true,
    message: "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!",
    target: "no_received",
  };
  const stored = readJson("stock_notify_settings", {}) ?? {};
  const updated = { ...defaults, ...stored, ...req.body };
  writeJson("stock_notify_settings", updated);
  addLog("STOCK_NOTIFY_SETTINGS_UPDATE", "", "web-admin");
  res.json(updated);
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

  // Queue stock notification if requested and accounts were actually added
  if (added > 0 && req.body?.notify !== false) {
    const ns = readJson("stock_notify_settings", {}) ?? {};
    const notifyEnabled = req.body?.notify === true || ns.enabled !== false;
    if (notifyEnabled) {
      const message = (typeof req.body?.notifyMessage === "string" && req.body.notifyMessage.trim())
        ? req.body.notifyMessage.trim()
        : (ns.message || "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!");
      const target = ns.target || "no_received";
      const pending: any[] = readJson("pending_broadcasts", []) ?? [];
      pending.push({ id: `stock_${Date.now()}`, message, target, createdAt: now() });
      writeJson("pending_broadcasts", pending);
      addLog("STOCK_NOTIFY_QUEUED", `added=${added} target=${target}`, "web-admin");
    }
  }

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
  const today = new Date(); today.setHours(0, 0, 0, 0);

  // ── 1. Tính status động theo warrantyExpiry ───────────────────────────────
  const result: any[] = Object.values(orders).map((order: any) => {
    let status = order.status || "active";
    if (status !== "refunded") {
      const weStr = order.warrantyExpiry || order.warrantyDate || "";
      if (weStr) {
        try {
          const expiry = new Date(weStr.slice(0, 10));
          status = expiry >= today ? "active" : "expired";
        } catch {}
      }
    }
    return { ...order, status };
  });

  // ── 2. Sắp xếp mới nhất lên trên ────────────────────────────────────────
  result.sort((a: any, b: any) => {
    const ta = a.createdAt || a.purchaseDate || "";
    const tb = b.createdAt || b.purchaseDate || "";
    return tb.localeCompare(ta);
  });

  // ── 3. Auto-sync đơn hoàn tiền → refund_history ──────────────────────────
  const refundHistory: any[] = readJson("refund_history", []) ?? [];
  const refundedInHistory = new Set(refundHistory.map((r: any) => r.orderId).filter(Boolean));
  let historyDirty = false;
  for (const order of result) {
    if (order.status === "refunded" && order.orderId && !refundedInHistory.has(order.orderId)) {
      refundHistory.push({
        id: crypto.randomUUID(),
        warrantyRequestId: null,
        orderId: order.orderId,
        orderCode: order.orderId,
        account: order.email || "",
        email: order.email || "",
        amount: Number(order.refundAmount || 0),
        note: "Tự động đồng bộ từ đơn hàng",
        refundedAt: order.refundedAt || now(),
        refundedBy: order.refundedBy || "system",
        reason: "",
        source: "order",
      });
      refundedInHistory.add(order.orderId);
      historyDirty = true;
    }
  }
  if (historyDirty) writeJson("refund_history", refundHistory);

  res.json(result);
});

// ── POST /bot/orders ────────────────────────────────────────────────────────
router.post("/bot/orders", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const orders: any = readJson("orders", {}) ?? {};
  // Use provided orderCode as orderId if present, else auto-generate
  const orderId = body.orderCode
    ? String(body.orderCode).trim().toUpperCase()
    : "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
  const { orderCode: _oc, ...rest } = body;
  const order = { ...rest, orderId, createdAt: now() };
  orders[orderId] = order;
  writeJson("orders", orders);

  // Also create an order_item entry if email is present
  if (order.email) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    if (!orderItems[orderId]) orderItems[orderId] = [];
    const alreadyExists = (orderItems[orderId] as any[]).some(
      (it: any) => it.email?.toLowerCase() === order.email.toLowerCase()
    );
    if (!alreadyExists) {
      const itemWd = Number(order.warrantyDays || 0);
      let itemWarrantyEnd: string | null = null;
      if (order.purchaseDate && itemWd) {
        try {
          const d = new Date(order.purchaseDate.slice(0, 10));
          d.setDate(d.getDate() + itemWd);
          itemWarrantyEnd = d.toISOString().slice(0, 10);
        } catch {}
      }
      if (!itemWarrantyEnd && (order.warrantyExpiry || order.warrantyDate)) {
        itemWarrantyEnd = (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null;
      }
      orderItems[orderId].push({
        itemId:                        crypto.randomUUID().slice(0, 8).toUpperCase(),
        email:                         order.email,
        original_account:              order.email,
        current_account:               order.email,
        current_replacement_number:    0,
        original_delivered_at:         order.purchaseDate || now(),
        warranty_days:                 itemWd || null,
        warranty_end_date:             itemWarrantyEnd,
        item_status:                   order.status ?? "active",
        password:                      order.password  ?? null,
        twoFA:                         order.twoFA     ?? null,
        status:                        order.status    ?? "active",
        createdAt:                     now(),
      });
      writeJson("order_items", orderItems);
    }
  }

  addLog("CREATE_ORDER", orderId, "web-admin");
  res.json(order);
});

// ── POST /bot/orders/bulk ────────────────────────────────────────────────────
// If `orderCode` is provided: creates ONE shared order + multiple order_items (new multi-account model).
// Without `orderCode`: creates one order per account (legacy behavior, backward compat).
router.post("/bot/orders/bulk", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const { productName, price, purchaseDate, expiryDate, warrantyExpiry, usagePeriod, warrantyPeriod, notes, accounts, orderCode, status, warrantyDays, customerName, paymentMethod } = body;
  if (!productName || !purchaseDate || !Array.isArray(accounts) || accounts.length === 0) {
    res.status(400).json({ ok: false, message: "productName, purchaseDate và accounts là bắt buộc" }); return;
  }

  const orders: any     = readJson("orders", {}) ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};
  const errors: { email: string; reason: string }[] = [];
  let added = 0, skipped = 0;

  if (orderCode) {
    // ── NEW BEHAVIOR: one shared order + multiple items ──────────────────────
    const sharedId = String(orderCode).trim().toUpperCase();

    // Build set of all emails already in order_items (global dup check)
    const existingItemEmails = new Set<string>();
    for (const itemList of Object.values(orderItems) as any[][]) {
      for (const it of itemList) {
        if (it.email) existingItemEmails.add(it.email.toLowerCase());
      }
    }

    // Create or update the shared order header
    if (!orders[sharedId]) {
      orders[sharedId] = {
        orderId: sharedId,
        productName,
        price:          price          ?? null,
        purchaseDate:   purchaseDate   ?? null,
        expiryDate:     expiryDate     ?? null,
        warrantyExpiry: warrantyExpiry ?? null,
        warrantyDays:   warrantyDays   ?? null,
        usagePeriod:    usagePeriod    ?? null,
        warrantyPeriod: warrantyPeriod ?? null,
        customerName:   customerName   ?? null,
        paymentMethod:  paymentMethod  ?? null,
        notes:          notes          ?? null,
        status:         status         ?? "active",
        quantity:       0,
        createdAt:      now(),
      };
    }
    if (!orderItems[sharedId]) orderItems[sharedId] = [];

    for (const acc of accounts) {
      const email: string = (acc.email ?? "").trim();
      if (!email) { errors.push({ email: "(trống)", reason: "Thiếu email" }); skipped++; continue; }
      if (existingItemEmails.has(email.toLowerCase())) {
        errors.push({ email, reason: "Email đã tồn tại trong hệ thống" }); skipped++; continue;
      }
      const bWd = Number(warrantyDays || 0);
      let bWarrantyEnd: string | null = null;
      if (purchaseDate && bWd) {
        try {
          const d = new Date((purchaseDate as string).slice(0, 10));
          d.setDate(d.getDate() + bWd);
          bWarrantyEnd = d.toISOString().slice(0, 10);
        } catch {}
      }
      if (!bWarrantyEnd && warrantyExpiry) bWarrantyEnd = (warrantyExpiry as string).slice(0, 10) || null;
      orderItems[sharedId].push({
        itemId:                        crypto.randomUUID().slice(0, 8).toUpperCase(),
        email,
        original_account:              email,
        current_account:               email,
        current_replacement_number:    0,
        original_delivered_at:         purchaseDate || now(),
        warranty_days:                 bWd || null,
        warranty_end_date:             bWarrantyEnd,
        item_status:                   "active",
        password:                      acc.password || null,
        twoFA:                         acc.twoFA    || null,
        status:                        "active",
        createdAt:                     now(),
      });
      existingItemEmails.add(email.toLowerCase());
      added++;
    }

    // Sync quantity on order header
    orders[sharedId].quantity = orderItems[sharedId].length;
    writeJson("orders", orders);
    writeJson("order_items", orderItems);
    addLog("BULK_CREATE_ORDERS", `orderCode=${sharedId} added=${added} skipped=${skipped}`, "web-admin");
    return res.json({ added, skipped, errors, orderId: sharedId });
  }

  // ── LEGACY BEHAVIOR: one order per account ─────────────────────────────────
  const existingEmails = new Set(
    Object.values(orders).map((o: any) => (o.email ?? "").toLowerCase())
  );

  for (const acc of accounts) {
    const email: string = (acc.email ?? "").trim();
    if (!email) { errors.push({ email: "(trống)", reason: "Thiếu email" }); skipped++; continue; }
    if (existingEmails.has(email.toLowerCase())) {
      errors.push({ email, reason: "Email đã tồn tại trong hệ thống" }); skipped++; continue;
    }
    const orderId = "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
    orders[orderId] = {
      orderId, email,
      password:       acc.password    || null,
      twoFA:          acc.twoFA       || null,
      productName,
      price:          price          ?? null,
      purchaseDate:   purchaseDate   ?? null,
      expiryDate:     expiryDate     ?? null,
      warrantyExpiry: warrantyExpiry ?? null,
      usagePeriod:    usagePeriod    ?? null,
      warrantyPeriod: warrantyPeriod ?? null,
      notes:          notes          ?? null,
      status: "active",
      createdAt: now(),
    };
    // Also create item with chain fields
    if (!orderItems[orderId]) orderItems[orderId] = [];
    const lWd = Number(warrantyDays || 0);
    let lWarrantyEnd: string | null = null;
    if (purchaseDate && lWd) {
      try {
        const d = new Date((purchaseDate as string).slice(0, 10));
        d.setDate(d.getDate() + lWd);
        lWarrantyEnd = d.toISOString().slice(0, 10);
      } catch {}
    }
    if (!lWarrantyEnd && warrantyExpiry) lWarrantyEnd = (warrantyExpiry as string).slice(0, 10) || null;
    orderItems[orderId].push({
      itemId:                        crypto.randomUUID().slice(0, 8).toUpperCase(),
      email,
      original_account:              email,
      current_account:               email,
      current_replacement_number:    0,
      original_delivered_at:         purchaseDate || now(),
      warranty_days:                 lWd || null,
      warranty_end_date:             lWarrantyEnd,
      item_status:                   "active",
      password:                      acc.password || null,
      twoFA:                         acc.twoFA    || null,
      status:                        "active",
      createdAt:                     now(),
    });
    existingEmails.add(email.toLowerCase());
    added++;
  }

  writeJson("orders", orders);
  writeJson("order_items", orderItems);
  addLog("BULK_CREATE_ORDERS", `added=${added} skipped=${skipped}`, "web-admin");
  res.json({ added, skipped, errors });
});

// ── POST /bot/orders/xlsx-import ─────────────────────────────────────────────
// Receives pre-parsed, validated rows from the admin panel XLSX import dialog.
router.post("/bot/orders/xlsx-import", requireAuth, (req: any, res: any) => {
  const { rows, syncMode } = req.body ?? {};
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ ok: false, message: "rows is required" }); return;
  }
  // syncMode="full"     → cập nhật password/twoFA cho đơn cũ nếu đang trống
  // syncMode="new_only" → bỏ qua toàn bộ đơn đã tồn tại
  // undefined/"skip"   → hành vi cũ (skip duplicate)

  const orders: any     = readJson("orders", {}) ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};

  // Build global set of account emails already in the system
  const existingItemEmails = new Set<string>();
  for (const itemList of Object.values(orderItems) as any[][]) {
    for (const it of itemList) {
      const e = (it.email || it.original_account || "").toLowerCase().trim();
      if (e) existingItemEmails.add(e);
    }
  }

  const results: any[] = [];
  let newCount = 0, updatedCount = 0, unchangedCount = 0, failCount = 0, skippedCount = 0;
  let accountsAdded = 0, dupOrders = 0, dupAccountsTotal = 0;

  for (const row of rows) {
    const {
      rowIndex, orderCode, productNameMapped, productNameRaw, quantity,
      totalPrice, unitPrice, status, customerName, customerEmail,
      purchaseDate, originalDeliveredAt, expiryDate, warrantyEndDate,
      warrantyDays, usageDays, accounts,
      conflictAction = "skip",
    } = row;

    try {
      const orderId = String(orderCode || "").trim().toUpperCase();
      if (!orderId) {
        failCount++;
        results.push({ rowIndex, status: "error", message: "Thiếu mã đơn" });
        continue;
      }

      const existingOrder = orders[orderId];
      if (existingOrder) {
        dupOrders++;
        // new_only: bỏ qua toàn bộ đơn cũ
        if (syncMode === "new_only" || conflictAction === "skip") {
          skippedCount++;
          results.push({ rowIndex, status: "skipped", message: syncMode === "new_only" ? "Chế độ đơn mới: bỏ qua đơn đã tồn tại" : "Mã đơn đã tồn tại, bỏ qua" });
          continue;
        }
      }

      // Lấy thông tin đăng nhập từ tài khoản đầu tiên trong deliveredAccounts
      const firstAcc = Array.isArray(accounts) ? accounts[0] : null;
      const loginPassword: string = firstAcc?.password || "";
      const loginTwoFA: string    = firstAcc?.twoFA    || "";

      const wd = Number(warrantyDays || 0);
      const ud = Number(usageDays || 0);
      const tp = Number(totalPrice || 0);
      const up = Number(unitPrice || 0) || (tp && quantity > 1 ? Math.round(tp / quantity) : tp);

      const resolvedName = productNameMapped || productNameRaw || "";
      const orderObj: any = {
        orderId,
        email: customerEmail || "",
        productName: resolvedName,
        price: up || null,
        totalPrice: tp || null,
        quantity: Number(quantity || 0) || 1,
        purchaseDate: purchaseDate || null,
        expiryDate: expiryDate || null,
        warrantyExpiry: warrantyEndDate || null,
        warrantyDays: wd || null,
        usageDays: ud || null,
        customerName: customerName || null,
        status: status || "active",
        // Lưu mật khẩu tài khoản vào order để Health Check dùng
        password: loginPassword || null,
        twoFA: loginTwoFA || null,
        createdAt: existingOrder?.createdAt ?? now(),
        updatedAt: now(),
      };

      if (!existingOrder) {
        orders[orderId] = orderObj;
      } else if (conflictAction === "update") {
        orders[orderId] = { ...existingOrder, ...orderObj };
      } else if (conflictAction === "add_missing") {
        // Cập nhật các trường còn rỗng/null trong đơn cũ (tên SP, ngày, bảo hành, mật khẩu)
        const ex = existingOrder;
        if (!ex.productName   && resolvedName)            ex.productName   = resolvedName;
        if (!ex.warrantyDays  && wd)                      ex.warrantyDays  = wd;
        if (!ex.usageDays     && ud)                      ex.usageDays     = ud;
        if (!ex.expiryDate    && orderObj.expiryDate)     ex.expiryDate    = orderObj.expiryDate;
        if (!ex.warrantyExpiry && orderObj.warrantyExpiry) ex.warrantyExpiry = orderObj.warrantyExpiry;
        if (!ex.purchaseDate  && orderObj.purchaseDate)   ex.purchaseDate  = orderObj.purchaseDate;
        // Full sync: cập nhật mật khẩu nếu đơn cũ chưa có
        if (syncMode === "full" && loginPassword && !ex.password) ex.password = loginPassword;
        if (syncMode === "full" && loginTwoFA    && !ex.twoFA)    ex.twoFA    = loginTwoFA;
        orders[orderId] = ex;
      }

      if (!orderItems[orderId]) orderItems[orderId] = [];
      let itemsAddedThisRow = 0, dupThisRow = 0;

      if (Array.isArray(accounts)) {
        const orderEmailSet = new Set(
          (orderItems[orderId] as any[]).map((it: any) =>
            (it.email || it.original_account || "").toLowerCase().trim()
          )
        );

        for (const acc of accounts) {
          const email: string = (acc.email || "").trim();
          if (!email) continue;
          const emailLower = email.toLowerCase();

          if (existingOrder && conflictAction === "add_missing" && orderEmailSet.has(emailLower)) {
            dupThisRow++; continue;
          }
          if (existingItemEmails.has(emailLower)) {
            dupThisRow++; dupAccountsTotal++; continue;
          }

          const delAt = (originalDeliveredAt || purchaseDate || "").slice(0, 10) || now().slice(0, 10);
          let warrantyEnd = (warrantyEndDate || "").slice(0, 10) || null;
          if (!warrantyEnd && delAt && wd) {
            try {
              const d = new Date(delAt);
              d.setDate(d.getDate() + wd);
              warrantyEnd = d.toISOString().slice(0, 10);
            } catch {}
          }

          orderItems[orderId].push({
            itemId:                       crypto.randomUUID().slice(0, 8).toUpperCase(),
            email,
            original_account:             email,
            current_account:              email,
            current_replacement_number:   0,
            original_delivered_at:        delAt,
            warranty_days:                wd || null,
            warranty_end_date:            warrantyEnd,
            item_status:                  "active",
            password:                     acc.password || null,
            twoFA:                        acc.twoFA    || null,
            status:                       "active",
            createdAt:                    now(),
          });
          existingItemEmails.add(emailLower);
          orderEmailSet.add(emailLower);
          itemsAddedThisRow++;
        }
      }

      orders[orderId].quantity = orderItems[orderId].length;
      writeJson("orders", orders);
      writeJson("order_items", orderItems);
      addLog("XLSX_IMPORT_ORDER", orderId, "web-admin");

      if (!existingOrder) {
        newCount++;
      } else if (itemsAddedThisRow > 0) {
        updatedCount++;
      } else {
        unchangedCount++;
      }
      accountsAdded += itemsAddedThisRow;
      results.push({ rowIndex, status: "ok", orderId, isNew: !existingOrder, itemsAdded: itemsAddedThisRow, dupAccounts: dupThisRow });

    } catch (err: any) {
      failCount++;
      results.push({ rowIndex, status: "error", message: String(err?.message ?? "Lỗi không xác định") });
    }
  }

  res.json({ ok: true, new: newCount, updated: updatedCount, unchanged: unchangedCount, success: newCount + updatedCount, failed: failCount, skipped: skippedCount, accountsAdded, dupOrders, dupAccounts: dupAccountsTotal, results });
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
const TERMINAL_STATUSES = ["resolved", "rejected", "done"];

function _recomputeGroupStatus(req: any): void {
  const accs: any[] = req.accounts ?? [];
  const statuses = accs.map((a: any) => a.status ?? "pending");
  if (statuses.length > 0 && statuses.every((s: string) => TERMINAL_STATUSES.includes(s))) {
    req.status = "resolved";
    if (!req.resolvedAt) req.resolvedAt = now();
    // Disable reminders once fully resolved
    req.reminderEnabled = false;
    req.nextReminderAt = null;
    req.reminderProcessing = false;
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

async function sendTelegramWithButton(
  userId: string,
  message: string,
  buttonText: string,
  buttonUrl: string
): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: message,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: buttonText, url: buttonUrl }]] },
      }),
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
    lines.push(`📦 Order: <code>${req_.orderId}</code>`);
    if (req_.productName) lines.push(`🛍 Product: <b>${req_.productName}</b>`);
    lines.push(`\n🔑 <b>Replacement Account:</b>`);
    lines.push(`📧 Email/Account: <code>${email}</code>`);
    lines.push(`🔒 Password: <code>${password}</code>`);
    if (twoFA) lines.push(`🛡 2FA / Extra info: <code>${twoFA}</code>`);
    if (note) lines.push(`📝 Note: ${note}`);
    lines.push(`\nPlease verify your account immediately after receiving.`);
  } else {
    lines.push(`✅ <b>YÊU CẦU BẢO HÀNH ĐÃ ĐƯỢC GIẢI QUYẾT</b>\n`);
    lines.push(`📦 Mã đơn: <code>${req_.orderId}</code>`);
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

  // ── Write replacement chain record ──────────────────────────────────────────
  // Find the item that corresponds to the warranty request email and record the replacement
  if (req_.orderId) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[req_.orderId] ?? [];
    const prevEmailLower = (req_.email || "").toLowerCase();
    const itemIdx = prevEmailLower
      ? itemList.findIndex(
          (it: any) => (it.original_account || it.email || "").toLowerCase() === prevEmailLower ||
                       (it.current_account  || it.email || "").toLowerCase() === prevEmailLower
        )
      : -1;

    if (itemIdx !== -1) {
      // ── Case A: matching item found — update it ──────────────────────────
      const item = itemList[itemIdx];
      const repNumber = (item.current_replacement_number ?? 0) + 1;
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[item.itemId]) allReps[item.itemId] = [];
      allReps[item.itemId].push({
        id: crypto.randomUUID().slice(0, 12),
        orderId: req_.orderId,
        orderItemId: item.itemId,
        previousAccount: item.current_account || item.email || "",
        newAccount: email,
        newPassword: password,
        newTwoFA: twoFA || null,
        replacementNumber: repNumber,
        deliveredAt: now(),
        reason: note || "",
        supportTicketId: id,
        createdBy: "web-admin",
        createdAt: now(),
        status: "delivered",
      });
      writeJson("account_replacements", allReps);
      itemList[itemIdx] = {
        ...item,
        current_account: email,
        current_password: password,
        current_two_fa: twoFA || null,
        current_replacement_number: repNumber,
        item_status: "active",
        updatedAt: now(),
      };
      orderItems[req_.orderId] = itemList;
      writeJson("order_items", orderItems);
    } else {
      // ── Case B: no matching item (order has no items or original email is empty)
      //    Create a new order_item so the replacement email is searchable via bot ──
      const newItemId = crypto.randomUUID().slice(0, 8).toUpperCase();
      const order = orders[req_.orderId] ?? {};
      const newItem: any = {
        itemId: newItemId,
        orderId: req_.orderId,
        email: req_.email || email,
        original_account: req_.email || "",
        current_account: email,
        current_password: password,
        current_two_fa: twoFA || null,
        current_replacement_number: 1,
        original_delivered_at: order.purchaseDate || order.paymentAt || now(),
        productName: order.productName || "",
        warranty_days: order.warrantyDays || 0,
        item_status: "active",
        createdAt: now(),
        updatedAt: now(),
        _from_warranty_replacement: true,
      };
      itemList.push(newItem);
      orderItems[req_.orderId] = itemList;
      writeJson("order_items", orderItems);
      // Also record in account_replacements
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[newItemId]) allReps[newItemId] = [];
      allReps[newItemId].push({
        id: crypto.randomUUID().slice(0, 12),
        orderId: req_.orderId,
        orderItemId: newItemId,
        previousAccount: req_.email || "",
        newAccount: email,
        newPassword: password,
        newTwoFA: twoFA || null,
        replacementNumber: 1,
        deliveredAt: now(),
        reason: note || "",
        supportTicketId: id,
        createdBy: "web-admin",
        createdAt: now(),
        status: "delivered",
      });
      writeJson("account_replacements", allReps);
    }
  }

  const reminderOff = { reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  if (result.ok) {
    requests[idx] = { ...req_, ...replacementData, ...reminderOff, status: "resolved", resolution: `replacement:${email}`, sentStatus: "sent", sentAt: now(), sentError: null };
    writeJson("warranty_requests", requests);
    addLog("WARRANTY_REPLACEMENT", `${id} → ${email} | sent OK`, "web-admin");
    res.json({ ok: true, sentStatus: "sent", message: "Đã gửi tài khoản thay thế cho khách" });
  } else {
    requests[idx] = { ...req_, ...replacementData, ...reminderOff, status: "send_failed", resolution: `replacement:${email}`, sentStatus: "failed", sentError: result.error, sentAt: null };
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
  const orderId = req_.orderId || "N/A";
  const msg = `✅ <b>YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN</b>\n\nMã đơn: <code>${orderId}</code>\n\nShop đã nhận được yêu cầu bảo hành của bạn và đang tiến hành kiểm tra. Kết quả xử lý sẽ được bot thông báo ngay khi hoàn tất. Vui lòng chờ và không gửi lại yêu cầu trùng lặp.`;
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

  // ── Write replacement chain record (same logic as single replacement) ────────
  // acc.orderId is set when group requests are created from order:report_all / order:pick_items
  const accOrderId = acc.orderId || req_.orderId || "";
  const accEmail   = (acc.email || "").toLowerCase();
  if (accOrderId && accEmail) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[accOrderId] ?? [];
    const itemIdx = itemList.findIndex(
      (it: any) => (it.original_account || it.email || "").toLowerCase() === accEmail ||
                   (it.current_account  || it.email || "").toLowerCase() === accEmail
    );
    if (itemIdx !== -1) {
      const item = itemList[itemIdx];
      const repNumber = (item.current_replacement_number ?? 0) + 1;
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[item.itemId]) allReps[item.itemId] = [];
      allReps[item.itemId].push({
        id: crypto.randomUUID().slice(0, 12),
        orderId: accOrderId,
        orderItemId: item.itemId,
        previousAccount: item.current_account || item.email || "",
        newAccount: email,
        newPassword: password,
        newTwoFA: twoFA || null,
        replacementNumber: repNumber,
        deliveredAt: now(),
        reason: note || "",
        supportTicketId: id,
        createdBy: "web-admin",
        createdAt: now(),
        status: "delivered",
      });
      writeJson("account_replacements", allReps);
      itemList[itemIdx] = {
        ...item,
        current_account: email,
        current_password: password,
        current_two_fa: twoFA || null,
        current_replacement_number: repNumber,
        item_status: "active",
        updatedAt: now(),
      };
      orderItems[accOrderId] = itemList;
      writeJson("order_items", orderItems);
    }
  }

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

  // Block double refund
  if (acc.status === "resolved" && (acc.resolution || "").startsWith("refund:")) {
    res.status(400).json({ ok: false, code: "ORDER_ALREADY_REFUNDED", message: "Tài khoản này đã được hoàn tiền rồi." }); return;
  }

  const refundedAt = now();
  requests[idx].accounts[accIdx] = { ...acc, status: "resolved", resolution: `refund:${amount}`, resolvedAt: refundedAt, resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);

  // Update order_items: mark this specific account's item as refunded
  const accOrderId = acc.orderId || req_.orderId || "";
  const accEmailLower = (acc.email || "").toLowerCase();
  let foundItemId: string | null = null;
  if (accOrderId && accEmailLower) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[accOrderId] ?? [];
    for (let i = 0; i < itemList.length; i++) {
      const it = itemList[i];
      const orig = (it.original_account || it.email || "").toLowerCase();
      const curr = (it.current_account  || it.email || "").toLowerCase();
      if (orig === accEmailLower || curr === accEmailLower) {
        foundItemId = it.itemId || null;
        itemList[i] = { ...it, item_status: "refunded", refunded_at: refundedAt, refund_amount: Number(amount), refund_admin_id: "web-admin", support_enabled: false };
        break;
      }
    }
    orderItems[accOrderId] = itemList;
    writeJson("order_items", orderItems);
    // If ALL items in the order are now refunded → mark the order fully refunded
    const allRefunded = itemList.every((it: any) => it.item_status === "refunded");
    if (allRefunded) {
      const orders: any = readJson("orders", {}) ?? {};
      if (orders[accOrderId]) {
        orders[accOrderId].status = "refunded";
        orders[accOrderId].refundedAt = refundedAt;
        orders[accOrderId].refundAmount = Number(amount);
        writeJson("orders", orders);
      }
    }
  }

  // Save to refund_history
  const history: any[] = readJson("refund_history", []) ?? [];
  history.push({
    id: crypto.randomUUID(),
    warrantyRequestId: id,
    orderId: accOrderId || null,
    orderItemId: foundItemId,
    orderCode: accOrderId || null,
    account: acc.email || "",
    email: acc.email || "",
    amount: Number(amount),
    note: note || "",
    refundedAt,
    refundedBy: "web-admin",
    reason: note || "",
    supportTicketId: id,
  });
  writeJson("refund_history", history);

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

// ── POST /bot/warranty/:id/accounts/:accId/respond ───────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/respond", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { message } = req.body ?? {};
  if (!message || !String(message).trim()) { res.status(400).json({ ok: false, message: "Nội dung phản hồi không được rỗng" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  const sentAt = now();
  const responseEntry = { message: String(message).trim(), sentAt, adminId: "web-admin" };
  const prevResponses: any[] = acc.responses ?? [];
  // Chuyển sub-account và group sang "processing" khi phản hồi lần đầu
  const newAccStatus = acc.status === "pending" ? "processing" : acc.status;
  requests[idx].accounts[accIdx] = { ...acc, status: newAccStatus, responses: [...prevResponses, responseEntry] };
  if (!req_.acknowledgedAt) {
    requests[idx].acknowledgedAt = sentAt;
    requests[idx].acknowledgedBy = "web-admin";
  }
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);
  const teleMsg = `💬 <b>Phản hồi từ admin (tài khoản <code>${acc.email}</code>):</b>\n\n${String(message).trim()}`;
  const result = await sendTelegramMessage(req_.userId, teleMsg);
  addLog("GROUP_RESPOND", `${id}/${accId}: ${String(message).trim().slice(0, 60)}`, "web-admin");
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi phản hồi cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
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
  const { amount, note, adminName } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];

  // Block double refund
  if (req_.status === "resolved" && (req_.resolution || "").startsWith("refund:")) {
    res.status(400).json({ ok: false, code: "ORDER_ALREADY_REFUNDED", message: "Đơn hàng này đã được hoàn tiền rồi. Không thể hoàn tiền lần hai." }); return;
  }

  const resolvedBy = adminName || "web-admin";
  const refundedAt = now();
  const email = req_.email || (req_.accounts && req_.accounts[0]?.originalEmail) || "";

  // Mark this ticket as resolved
  requests[idx] = { ...req_, status: "resolved", resolution: `refund:${amount}`, resolvedAt: refundedAt, resolvedBy, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };

  // Close all other open tickets for the same order/email (prevent reminders & re-reporting)
  for (let i = 0; i < requests.length; i++) {
    if (i === idx) continue;
    const r = requests[i];
    const rEmail = r.email || "";
    if (r.orderId === req_.orderId && rEmail === email && !["resolved", "rejected", "refunded"].includes(r.status)) {
      requests[i] = { ...r, status: "refunded", resolvedAt: refundedAt, resolvedBy, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
    }
  }
  writeJson("warranty_requests", requests);

  // Update order_items: mark the specific item as refunded
  const orderItems: any = readJson("order_items", {}) ?? {};
  const emailLower = email.toLowerCase();
  let foundItemId: string | null = null;
  if (req_.orderId && emailLower) {
    const itemList: any[] = orderItems[req_.orderId] ?? [];
    for (let i = 0; i < itemList.length; i++) {
      const it = itemList[i];
      const orig = (it.original_account || it.email || "").toLowerCase();
      const curr = (it.current_account  || it.email || "").toLowerCase();
      if (orig === emailLower || curr === emailLower) {
        foundItemId = it.itemId || null;
        itemList[i] = { ...it, item_status: "refunded", refunded_at: refundedAt, refund_amount: Number(amount), refund_admin_id: resolvedBy, support_enabled: false };
        break;
      }
    }
    orderItems[req_.orderId] = itemList;
    writeJson("order_items", orderItems);
    // If ALL items in the order are now refunded → mark the order fully refunded
    const allRefunded = (itemList as any[]).every((it: any) => it.item_status === "refunded");
    const orders: any = readJson("orders", {}) ?? {};
    if (allRefunded && orders[req_.orderId]) {
      orders[req_.orderId].status = "refunded";
      orders[req_.orderId].refundedAt = refundedAt;
      orders[req_.orderId].refundAmount = Number(amount);
      writeJson("orders", orders);
    } else if (!allRefunded && req_.orderId && orders[req_.orderId]) {
      // Partial refund on multi-account order: keep order status, just save orders if needed
      // (no status change needed)
    }
  } else if (req_.orderId) {
    // Single-account order without order_items entry: mark the whole order as refunded
    const orders: any = readJson("orders", {}) ?? {};
    if (orders[req_.orderId]) {
      orders[req_.orderId].status = "refunded";
      orders[req_.orderId].refundedAt = refundedAt;
      orders[req_.orderId].refundAmount = Number(amount);
      writeJson("orders", orders);
    }
  }

  // Save to refund_history.json (expanded fields per spec)
  const history: any[] = readJson("refund_history", []) ?? [];
  history.push({
    id: crypto.randomUUID(),
    warrantyRequestId: id,
    orderId: req_.orderId || null,
    orderItemId: foundItemId,
    orderCode: req_.orderId || null,
    account: email,
    email,
    amount: Number(amount),
    note: note || "",
    refundedAt,
    refundedBy: resolvedBy,
    reason: note || "",
    supportTicketId: id,
  });
  writeJson("refund_history", history);

  // Send notification to customer
  const amountStr = Number(amount).toLocaleString("vi");
  const msg =
    `💰 <b>Hoàn tiền thành công</b>\n\n` +
    `📧 Tài khoản: <code>${email}</code>\n` +
    `💵 Số tiền hoàn: <b>${amountStr}đ</b>` +
    (note ? `\n\n📝 Ghi chú: ${note}` : "") +
    `\n\n📝 Lưu ý:\nTiền hoàn sẽ được cộng trực tiếp vào ví mua hàng của quý khách tại Kênh Mua Hàng và có thể sử dụng cho các đơn hàng tiếp theo.`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("WARRANTY_REFUND", `${id} → ${amountStr}đ | ${email}`, resolvedBy);
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── GET /bot/required-channels ───────────────────────────────────────────────
router.get("/bot/required-channels", requireAuth, (_req: any, res: any) => {
  res.json(readJson("required_channels", []) ?? []);
});

// ── PUT /bot/required-channels ───────────────────────────────────────────────
router.put("/bot/required-channels", requireAuth, (req: any, res: any) => {
  const channels = Array.isArray(req.body) ? req.body : [];
  writeJson("required_channels", channels);
  addLog("UPDATE_REQUIRED_CHANNELS", `${channels.length} channel(s)`, "web-admin");
  res.json(channels);
});

// ── GET /bot/rate-violations ──────────────────────────────────────────────────
router.get("/bot/rate-violations", requireAuth, (req: any, res: any) => {
  const violations: any[] = readJson("rate_violations", []) ?? [];
  const { user_id, action, from, to, is_locked } = req.query;
  let result = [...violations].reverse(); // newest first
  if (user_id)   result = result.filter((r: any) => String(r.user_id) === String(user_id));
  if (action)    result = result.filter((r: any) => r.action === String(action));
  if (from)      result = result.filter((r: any) => r.timestamp >= String(from));
  if (to)        result = result.filter((r: any) => r.timestamp <= String(to) + "T23:59:59");
  if (is_locked === "true") result = result.filter((r: any) => r.is_locked === true);

  // Summary stats
  const summary = {
    total: result.length,
    by_action: {} as Record<string, number>,
    locked_count: result.filter((r: any) => r.is_locked).length,
    unique_users: new Set(result.map((r: any) => r.user_id)).size,
  };
  for (const r of result) {
    summary.by_action[r.action] = (summary.by_action[r.action] || 0) + 1;
  }

  res.json({ summary, items: result.slice(0, 500) });
});

// ── GET /bot/rate-limits/user/:userId ────────────────────────────────────────
router.get("/bot/rate-limits/user/:userId", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const data: any = readJson("rate_limits", {}) ?? {};
  const now = Date.now() / 1000;
  const userState = data[String(userId)] ?? {};
  const result: any = {};
  for (const [action, state] of Object.entries(userState) as [string, any][]) {
    const lockUntil     = state.lock_until ?? null;
    const cooldownUntil = state.cooldown_until ?? null;
    result[action] = {
      violation_count:        state.violation_count ?? 0,
      is_locked:              !!(lockUntil && now < lockUntil),
      lock_remaining_s:       lockUntil && now < lockUntil ? Math.max(0, Math.round(lockUntil - now)) : 0,
      is_on_cooldown:         !!(cooldownUntil && now < cooldownUntil),
      cooldown_remaining_s:   cooldownUntil && now < cooldownUntil ? Math.max(0, Math.round(cooldownUntil - now)) : 0,
      last_violation_at:      state.last_violation_at ?? null,
    };
  }
  res.json({ user_id: userId, status: result });
});

// ── DELETE /bot/rate-limits/user/:userId ─────────────────────────────────────
// Admin can manually clear a user's rate limit state (e.g. false positive)
router.delete("/bot/rate-limits/user/:userId", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const { action } = req.query;
  const data: any = readJson("rate_limits", {}) ?? {};
  const uid = String(userId);
  if (!data[uid]) { res.json({ ok: true, message: "Không tìm thấy dữ liệu cho user này" }); return; }
  if (action) {
    delete data[uid][String(action)];
    addLog("RATE_LIMIT_CLEARED", `user ${uid} action=${action}`, "web-admin");
  } else {
    delete data[uid];
    addLog("RATE_LIMIT_CLEARED", `user ${uid} all actions`, "web-admin");
  }
  writeJson("rate_limits", data);
  res.json({ ok: true, message: "Đã xóa rate limit" });
});

// ── GET /bot/refund-history ───────────────────────────────────────────────────
router.get("/bot/refund-history", requireAuth, (req: any, res: any) => {
  const history: any[] = readJson("refund_history", []) ?? [];
  const { orderId, email, from, to } = req.query;
  let result = [...history].reverse(); // newest first
  if (orderId) result = result.filter((r: any) => (r.orderId || "").includes(String(orderId)));
  if (email)   result = result.filter((r: any) => (r.email || "").toLowerCase().includes(String(email).toLowerCase()));
  if (from)    result = result.filter((r: any) => r.refundedAt >= String(from));
  if (to)      result = result.filter((r: any) => r.refundedAt <= String(to) + "T23:59:59");
  res.json(result);
});

// ── POST /bot/refund-history/manual ──────────────────────────────────────────
router.post("/bot/refund-history/manual", requireAuth, (req: any, res: any) => {
  const { orderId, amount, note, email } = req.body ?? {};
  if (!orderId || !String(orderId).trim()) {
    res.status(400).json({ ok: false, message: "orderId là bắt buộc" }); return;
  }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ ok: false, message: "Số tiền hoàn không hợp lệ" }); return;
  }
  const history: any[] = readJson("refund_history", []) ?? [];
  const entry = {
    id: crypto.randomUUID(),
    warrantyRequestId: null,
    orderId: String(orderId).trim().toUpperCase(),
    orderCode: String(orderId).trim().toUpperCase(),
    account: email || "",
    email: email || "",
    amount: Number(amount),
    note: note || "",
    refundedAt: now(),
    refundedBy: "web-admin",
    reason: note || "",
    source: "manual",
  };
  history.push(entry);
  writeJson("refund_history", history);
  // Also mark order as refunded so bot blocks báo lỗi
  const orders: any = readJson("orders", {}) ?? {};
  const oKey = String(orderId).trim().toUpperCase();
  if (orders[oKey]) {
    orders[oKey].status = "refunded";
    orders[oKey].refundedAt = entry.refundedAt;
    orders[oKey].refundAmount = Number(amount);
    writeJson("orders", orders);
  }
  addLog("MANUAL_REFUND", `${entry.orderId} → ${Number(amount).toLocaleString("vi")}đ`, "web-admin");
  res.json({ ok: true, record: entry });
});

// ── DELETE /bot/refund-history/:id ───────────────────────────────────────────
router.delete("/bot/refund-history/:id", requireAuth, (req: any, res: any) => {
  const { id } = req.params;
  const history: any[] = readJson("refund_history", []) ?? [];
  const idx = history.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy bản ghi" }); return; }
  history.splice(idx, 1);
  writeJson("refund_history", history);
  addLog("DELETE_REFUND_RECORD", id, "web-admin");
  res.json({ ok: true });
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
  requests[idx] = { ...req_, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now(), resolvedBy: "web-admin", reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  writeJson("warranty_requests", requests);
  const msg = `❌ <b>Yêu cầu bảo hành không được chấp nhận.</b>\n\nLý do: ${reason}`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("WARRANTY_REJECT", `${id}: ${reason}`, "web-admin");
  res.json({ ok: true, message: "Đã từ chối" });
});

// ── POST /bot/warranty/:id/done ──────────────────────────────────────────────
router.post("/bot/warranty/:id/done", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi";
  const isEN = userLang === "en";
  requests[idx] = {
    ...req_,
    status: "done",
    resolution: `done:${note || ""}`,
    resolvedAt: now(),
    resolvedBy: "web-admin",
    reminderEnabled: false,
    nextReminderAt: null,
    reminderProcessing: false,
  };
  writeJson("warranty_requests", requests);
  let msg = isEN
    ? `✅ <b>Your warranty request has been processed.</b>\n\nIf the issue persists, you can submit a new warranty request.`
    : `✅ <b>Yêu cầu bảo hành của bạn đã được xử lý xong.</b>\n\nNếu vấn đề vẫn còn tồn tại, bạn có thể gửi yêu cầu bảo hành mới.`;
  if (note) msg += isEN ? `\n\n📝 Note: ${note}` : `\n\n📝 Ghi chú: ${note}`;
  const result = await sendTelegramMessage(req_.userId, msg);
  addLog("WARRANTY_DONE", id, "web-admin");
  res.json({ ok: result.ok, message: result.ok ? "Đã đánh dấu hoàn thành" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/accounts/:accId/done ───────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/done", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  requests[idx].accounts[accIdx] = { ...acc, status: "done", resolution: `done:${note || ""}`, resolvedAt: now(), resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  writeJson("warranty_requests", requests);
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi";
  const isEN = userLang === "en";
  let msg = isEN
    ? `✅ <b>Account <code>${acc.email}</code> warranty request has been processed.</b>\n\nIf the issue persists, you can submit a new warranty request.`
    : `✅ <b>Yêu cầu bảo hành tài khoản <code>${acc.email}</code> đã được xử lý xong.</b>\n\nNếu vấn đề vẫn còn tồn tại, bạn có thể gửi yêu cầu bảo hành mới.`;
  if (note) msg += isEN ? `\n\n📝 Note: ${note}` : `\n\n📝 Ghi chú: ${note}`;
  const result = await sendTelegramMessage(req_.userId, msg);
  addLog("GROUP_DONE", `${id}/${accId}`, "web-admin");
  res.json({ ok: result.ok, message: result.ok ? "Đã đánh dấu hoàn thành" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/respond ───────────────────────────────────────────
router.post("/bot/warranty/:id/respond", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { message } = req.body ?? {};
  if (!message || !String(message).trim()) { res.status(400).json({ ok: false, message: "Nội dung phản hồi không được rỗng" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const sentAt = now();
  const responseEntry = { message: String(message).trim(), sentAt, adminId: "web-admin" };
  const prevResponses: any[] = req_.responses ?? [];
  // Chuyển sang "processing" khi phản hồi lần đầu (nếu còn "pending")
  const newStatus = req_.status === "pending" ? "processing" : req_.status;
  const ackPatch = req_.acknowledgedAt ? {} : { acknowledgedAt: sentAt, acknowledgedBy: "web-admin" };
  requests[idx] = { ...req_, ...ackPatch, status: newStatus, responses: [...prevResponses, responseEntry] };
  writeJson("warranty_requests", requests);
  const teleMsg = `💬 <b>Phản hồi từ admin:</b>\n\n${String(message).trim()}`;
  const result = await sendTelegramMessage(req_.userId, teleMsg);
  addLog("WARRANTY_RESPOND", `${id}: ${String(message).trim().slice(0, 60)}`, "web-admin");
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi phản hồi cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── GET /orders/lookup?query=... ─────────────────────────────────────────────
// Spec §13: returns structured response with isMultiAccountOrder, item vs items.
router.get("/orders/lookup", requireAuth, (req: any, res: any) => {
  const query = String(req.query.query ?? "").trim();
  if (!query) { res.status(400).json({ found: false, error: "query là bắt buộc" }); return; }

  const orders: any     = readJson("orders", {}) ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};
  const allReps: any    = readJson("account_replacements", {}) ?? {};
  const settings: any   = readJson("settings", {}) ?? {};

  // Strip common label prefixes (§1)
  const normalized = query
    .replace(/^(?:m[aã]\s*[đd][oơ]n|order\s*(?:code|id)?|email\s*\/?\s*t[àa]i\s*kho[ảa]n|email|t[àa]i\s*kho[ảa]n)\s*[:：]\s*/i, "")
    .trim();

  // ── BHF: suy ra số ngày bảo hành từ tên sản phẩm (BHF = Bảo Hành Full) ──────
  function inferBhfDays(productName: string): number {
    const norm = productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    let m: RegExpMatchArray | null;
    if ((m = norm.match(/(\d+)\s*NAM\b/)))   return parseInt(m[1]) * 365;  // Năm
    if ((m = norm.match(/(\d+)\s*THANG\b/))) return parseInt(m[1]) * 30;   // Tháng
    if ((m = norm.match(/(\d+)\s*NGAY\b/)))  return parseInt(m[1]);        // Ngày
    return 0;
  }

  // ── Warranty computation helper ──────────────────────────────────────────────
  // Pre-load refund_history orderId set for canReport gate
  const refundHistorySet = new Set<string>(
    (readJson("refund_history", []) as any[]).map((r: any) => r.orderId).filter(Boolean)
  );
  function calcWarranty(item: any, order: any, orderId?: string) {
    // Block if item was individually refunded
    if (item.item_status === "refunded") {
      const warrantyDaysR = Number(item.warranty_days || order?.warrantyDays || 0);
      return { warrantyStatus: "refunded", remainingDays: null, canReport: false,
               refundAmount: 0, warrantyEndDate: null, originalDeliveredAt: null, warrantyDays: warrantyDaysR };
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    // §7: date priority — original_delivered_at > paymentAt > purchaseDate
    const startStr = item.original_delivered_at || item.deliveredAt ||
                     order?.paymentAt || order?.purchaseDate || "";
    const pnameRaw = item.productName || order?.productName || '';
    let warrantyDays = Number(item.warranty_days || order?.warrantyDays || 0);
    // BHF inference: khi warrantyDays = 0 mà tên SP chứa BHF
    if (!warrantyDays && /\bBHF\b/i.test(pnameRaw)) {
      warrantyDays = inferBhfDays(pnameRaw);
    }
    let warrantyEnd: Date | null = null;
    // Prefer stored warranty_end_date, then compute, then fall back to order field
    if (item.warranty_end_date) {
      try { warrantyEnd = new Date(item.warranty_end_date.slice(0, 10)); } catch {}
    }
    if (!warrantyEnd && startStr && warrantyDays) {
      try {
        warrantyEnd = new Date(startStr.slice(0, 10));
        warrantyEnd.setDate(warrantyEnd.getDate() + warrantyDays);
      } catch {}
    }
    if (!warrantyEnd) {
      const we = order?.warrantyExpiry || order?.warrantyDate || "";
      if (we) { try { warrantyEnd = new Date(we.slice(0, 10)); } catch {} }
    }
    // §14: if no date data at all → no_data
    if (!startStr && !warrantyEnd) {
      return { warrantyStatus: "no_data", remainingDays: null, canReport: false,
               refundAmount: 0, warrantyEndDate: null, originalDeliveredAt: null, warrantyDays };
    }
    let remainingDays: number | null = null;
    let warrantyStatus = "unknown";
    let canReport = false;
    if (warrantyEnd) {
      remainingDays = Math.max(0, Math.floor((warrantyEnd.getTime() - today.getTime()) / 86400000));
      warrantyStatus = remainingDays > 0 ? "active" : "expired";
      canReport = warrantyStatus === "active";
    }
    // Block if full order was refunded (by status or by refund_history record)
    if (order?.status === "refunded") { canReport = false; }
    if (orderId && refundHistorySet.has(orderId)) { canReport = false; }
    const price = Number(order?.price || 0);
    let refundAmount: number | string = 0;
    if (remainingDays && remainingDays > 0 && price && warrantyDays) {
      refundAmount = settings.refund_formula === "custom" && settings.refund_custom_text
        ? settings.refund_custom_text
        : Math.round(price * remainingDays / warrantyDays);
    }
    return {
      warrantyStatus, remainingDays, canReport, refundAmount,
      warrantyEndDate: warrantyEnd ? warrantyEnd.toISOString().slice(0, 10) : null,
      originalDeliveredAt: startStr || null,
      warrantyDays,
    };
  }

  // ── Build spec §13 "order" object ────────────────────────────────────────────
  function buildOrderObj(orderId: string, order: any, allItemList: any[]) {
    const w = calcWarranty({ warranty_days: order.warrantyDays, warranty_end_date: order.warrantyExpiry || order.warrantyDate }, order, orderId);
    return {
      orderCode:    orderId,
      product:      order.productName || "",
      customer:     order.customerName || "",
      purchaseDate: (order.purchaseDate || order.paymentAt || "").slice(0, 10) || null,
      expiryDate:   (order.expiryDate || "").slice(0, 10) || null,
      warrantyEndDate: w.warrantyEndDate || (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null,
      originalPrice: Number(order.price || 0),
      quantity:     allItemList.length || (order.quantity ?? 0),
      status:       order.status || "active",
    };
  }

  // ── Build spec §13 "item" object ──────────────────────────────────────────────
  function buildItemObj(item: any, order: any, orderId?: string) {
    const reps: any[] = (allReps[item.itemId] ?? []).sort((a: any, b: any) => a.replacementNumber - b.replacementNumber);
    const wdata = calcWarranty(item, order, orderId);
    const repCount = item.current_replacement_number ?? reps.length;
    return {
      orderItemId:      item.itemId,
      originalAccount:  item.original_account || item.email || "",
      currentAccount:   item.current_account  || item.email || "",
      replacementCount: repCount,
      itemStatus:       item.item_status || item.status || "active",
      warrantyStatus:   wdata.warrantyStatus,
      remainingDays:    wdata.remainingDays,
      canReport:        wdata.canReport,
      refundAmount:     wdata.refundAmount,
      warrantyEndDate:  wdata.warrantyEndDate,
      originalDeliveredAt: wdata.originalDeliveredAt,
      warrantyDays:     wdata.warrantyDays,
      replacementHistory: reps.map((r: any) => ({
        replacementNumber: r.replacementNumber,
        previousAccount: r.previousAccount,
        newAccount: r.newAccount,
        deliveredAt: r.deliveredAt,
        reason: r.reason || "",
      })),
    };
  }

  // ── 1. Order ID / order-code match (case-insensitive) ────────────────────────
  const normUpper = normalized.toUpperCase();
  const orderKey = normUpper in orders ? normUpper : (normalized in orders ? normalized : null);
  if (orderKey) {
    const itemList: any[] = orderItems[orderKey] ?? [];
    const orderObj = buildOrderObj(orderKey, orders[orderKey], itemList);
    const isMulti = itemList.length > 1;
    if (isMulti) {
      return res.json({
        found: true,
        lookupType: "order_code",
        isMultiAccountOrder: true,
        order: orderObj,
        items: itemList.map(it => buildItemObj(it, orders[orderKey], orderKey)),
      });
    }
    // Single-item or no items
    const singleItem = itemList[0] ?? null;
    const itemObj = singleItem ? buildItemObj(singleItem, orders[orderKey], orderKey) : null;
    const wdata = singleItem ? calcWarranty(singleItem, orders[orderKey], orderKey) : null;
    return res.json({
      found: true,
      lookupType: "order_code",
      isMultiAccountOrder: false,
      order: orderObj,
      ...(itemObj ? { item: itemObj } : {}),
      remainingDays:  wdata?.remainingDays  ?? null,
      warrantyStatus: wdata?.warrantyStatus ?? "unknown",
      refundAmount:   wdata?.refundAmount   ?? 0,
      canReport:      wdata?.canReport      ?? false,
    });
  }

  const emailLower = normalized.toLowerCase();

  // ── 2. Search full replacement chain (original, current, history) ─────────────
  for (const [orderId, itemList] of Object.entries(orderItems) as [string, any[]][]) {
    for (const item of (itemList as any[])) {
      const orig = (item.original_account || item.email || "").toLowerCase();
      const curr = (item.current_account  || item.email || "").toLowerCase();
      const matchesDirect = emailLower === orig || emailLower === curr;
      const matchesHistory = !matchesDirect && (allReps[item.itemId] ?? []).some(
        (r: any) => (r.previousAccount || "").toLowerCase() === emailLower ||
                    (r.newAccount      || "").toLowerCase() === emailLower
      );
      if (!matchesDirect && !matchesHistory) continue;
      const order = orders[orderId] ?? {};
      const allItemsForOrder: any[] = orderItems[orderId] ?? [];
      const isMulti = allItemsForOrder.length > 1;
      const itemObj = buildItemObj(item, order, orderId);
      const orderObj = buildOrderObj(orderId, order, allItemsForOrder);
      return res.json({
        found: true,
        lookupType: "email",
        isMultiAccountOrder: isMulti,
        order: orderObj,
        item: itemObj,
        remainingDays:  itemObj.remainingDays,
        warrantyStatus: itemObj.warrantyStatus,
        refundAmount:   itemObj.refundAmount,
        canReport:      itemObj.canReport,
      });
    }
  }

  // ── 3. Fallback: email in orders.json header ──────────────────────────────────
  for (const [orderId, order] of Object.entries(orders) as [string, any][]) {
    if ((order.email || "").toLowerCase() === emailLower) {
      const allItemsForOrder: any[] = orderItems[orderId] ?? [];
      const orderObj = buildOrderObj(orderId, order, allItemsForOrder);
      return res.json({ found: true, lookupType: "email", isMultiAccountOrder: false, order: orderObj, item: null, remainingDays: null, warrantyStatus: "unknown", refundAmount: 0, canReport: false });
    }
  }

  return res.json({ found: false });
});

// ── GET /bot/orders/:orderId/items ───────────────────────────────────────────
router.get("/bot/orders/:orderId/items", requireAuth, (req: any, res: any) => {
  const orderItems: any = readJson("order_items", {}) ?? {};
  res.json(orderItems[req.params.orderId] ?? []);
});

// ── GET /bot/orders/:orderId/items/:itemId/replacements ───────────────────────
router.get("/bot/orders/:orderId/items/:itemId/replacements", requireAuth, (req: any, res: any) => {
  const { itemId } = req.params;
  const allReps: any = readJson("account_replacements", {}) ?? {};
  const reps: any[] = (allReps[itemId] ?? []).sort(
    (a: any, b: any) => (a.replacementNumber ?? 0) - (b.replacementNumber ?? 0)
  );
  res.json(reps);
});

// ── POST /bot/orders/:orderId/items ──────────────────────────────────────────
router.post("/bot/orders/:orderId/items", requireAuth, (req: any, res: any) => {
  const { orderId } = req.params;
  const orders: any = readJson("orders", {}) ?? {};
  if (!orders[orderId]) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  const { email, password, twoFA } = req.body ?? {};
  if (!email) { res.status(400).json({ ok: false, message: "email là bắt buộc" }); return; }
  const orderItems: any = readJson("order_items", {}) ?? {};
  if (!orderItems[orderId]) orderItems[orderId] = [];
  const order = orders[orderId];
  const iWd = Number(order.warrantyDays || 0);
  let iWarrantyEnd: string | null = null;
  if (order.purchaseDate && iWd) {
    try {
      const d = new Date(order.purchaseDate.slice(0, 10));
      d.setDate(d.getDate() + iWd);
      iWarrantyEnd = d.toISOString().slice(0, 10);
    } catch {}
  }
  if (!iWarrantyEnd && (order.warrantyExpiry || order.warrantyDate)) {
    iWarrantyEnd = (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null;
  }
  const itemId = crypto.randomUUID().slice(0, 8).toUpperCase();
  const item = {
    itemId, email,
    original_account:           email,
    current_account:            email,
    current_replacement_number: 0,
    original_delivered_at:      order.purchaseDate || now(),
    warranty_days:              iWd || null,
    warranty_end_date:          iWarrantyEnd,
    item_status:                "active",
    password:                   password ?? null,
    twoFA:                      twoFA ?? null,
    status:                     "active",
    createdAt:                  now(),
  };
  orderItems[orderId].push(item);
  writeJson("order_items", orderItems);
  addLog("CREATE_ORDER_ITEM", `${orderId}/${itemId}`, "web-admin");
  res.json({ ok: true, item });
});

// ── PUT /bot/orders/:orderId/items/:itemId ───────────────────────────────────
router.put("/bot/orders/:orderId/items/:itemId", requireAuth, (req: any, res: any) => {
  const { orderId, itemId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {};
  const items: any[] = orderItems[orderId] ?? [];
  const idx = items.findIndex((it: any) => it.itemId === itemId);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy item" }); return; }
  items[idx] = { ...items[idx], ...req.body, itemId, updatedAt: now() };
  orderItems[orderId] = items;
  writeJson("order_items", orderItems);
  addLog("UPDATE_ORDER_ITEM", `${orderId}/${itemId}`, "web-admin");
  res.json({ ok: true, item: items[idx] });
});

// ── GET /bot/intro ───────────────────────────────────────────────────────────
router.get("/bot/intro", requireAuth, (_req: any, res: any) => {
  const defaults = { title: "Giới thiệu", content: "", titleEn: "Introduction", contentEn: "", photoUrl: "", videoUrl: "", buttons: [] };
  res.json({ ...defaults, ...(readJson("intro", {}) ?? {}) });
});

// ── PUT /bot/intro ───────────────────────────────────────────────────────────
router.put("/bot/intro", requireAuth, (req: any, res: any) => {
  writeJson("intro", req.body ?? {});
  addLog("UPDATE_INTRO", "", "web-admin");
  res.json({ ok: true, message: "Đã cập nhật giới thiệu" });
});

// ── GET /giveaway/membership-debug/:telegramUserId ───────────────────────────
router.get("/giveaway/membership-debug/:telegramUserId", requireAuth, async (req: any, res: any) => {
  const { telegramUserId } = req.params;
  if (!TG_TOKEN) { res.status(503).json({ error: "TELEGRAM_BOT_TOKEN not configured" }); return; }

  const channels: any[] = readJson("required_channels", []) ?? [];
  const enabled = channels.filter((c: any) => c.enabled !== false);
  const JOINED = new Set(["member", "administrator", "creator"]);
  const CACHE_TTL_HOURS = 6;

  // Load membership cache for this user
  const allMemberships: any = readJson("user_channel_memberships", {}) ?? {};
  const userCache: any = allMemberships[telegramUserId] ?? {};

  function channelCacheKey(ch: any): string {
    const cid = (ch.chatId || ch.username || ch.id || "").trim();
    return cid.toLowerCase();
  }
  function isCacheValid(entry: any): boolean {
    if (!entry?.is_verified || !entry?.verified_at) return false;
    const vt = new Date(entry.verified_at).getTime();
    return Date.now() < vt + CACHE_TTL_HOURS * 3600_000;
  }

  const results = await Promise.all(enabled.map(async (ch: any) => {
    const rawChatId = (ch.chatId || ch.username || "").trim();
    const cacheKey = channelCacheKey(ch);
    const cached = userCache[cacheKey] ?? null;

    const entry: any = {
      title: ch.name,
      channelId: rawChatId || "(none — no chatId configured)",
      inviteUrl: ch.url || "",
      enabled: true,
      // Cache info
      savedStatus: cached?.membership_status ?? null,
      isVerified: cached?.is_verified ?? false,
      verifiedAt: cached?.verified_at ?? null,
      lastCheckedAt: cached?.last_checked_at ?? null,
      cacheValid: cached ? isCacheValid(cached) : false,
    };

    if (!rawChatId) {
      entry.botCanAccess = null;
      entry.telegramStatus = null;
      entry.configError = "No chatId configured — getChatMember cannot be called";
      return entry;
    }

    const normalized = rawChatId.startsWith("-") || rawChatId.startsWith("+") || rawChatId.startsWith("@")
      ? rawChatId : `@${rawChatId}`;

    try {
      const chatResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChat?chat_id=${encodeURIComponent(normalized)}`);
      const chatData: any = await chatResp.json();
      entry.botCanAccess = chatData.ok;
      if (!chatData.ok) {
        entry.telegramStatus = null;
        entry.apiError = chatData.description ?? "cannot access channel";
        return entry;
      }
      const mResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChatMember?chat_id=${encodeURIComponent(normalized)}&user_id=${telegramUserId}`);
      const mData: any = await mResp.json();
      if (mData.ok) {
        entry.telegramStatus = mData.result.status;
        if (mData.result.status === "restricted") entry.is_member = mData.result.is_member ?? false;
      } else {
        entry.telegramStatus = null;
        entry.apiError = mData.description ?? "getChatMember failed";
        entry.botCanAccess = false;
      }
    } catch (e: any) {
      entry.botCanAccess = false;
      entry.telegramStatus = null;
      entry.apiError = e?.message ?? "network error";
    }
    return entry;
  }));

  const JOINED_CHECK = (r: any) => {
    if (!r.channelId || r.channelId.includes("none")) return false; // missing config = not OK
    if (r.telegramStatus === "restricted") return r.is_member === true;
    return JOINED.has(r.telegramStatus);
  };
  const allJoined = results.every(JOINED_CHECK);
  const missingCount = results.filter(r => !JOINED_CHECK(r)).length;

  res.json({ telegramUserId, channels: results, allJoined, missingCount });
});

// ── GET /bot/check-channel/:channelId ────────────────────────────────────────
router.get("/bot/check-channel/:channelId", requireAuth, async (req: any, res: any) => {
  if (!TG_TOKEN) { res.status(503).json({ ok: false, error: "TELEGRAM_BOT_TOKEN not configured" }); return; }
  const raw = decodeURIComponent(req.params.channelId);
  if (!raw) { res.status(400).json({ ok: false, error: "channelId required" }); return; }
  const chatId = raw.startsWith("-") || raw.startsWith("@") ? raw : `@${raw}`;
  try {
    const chatResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const chatData: any = await chatResp.json();
    if (!chatData.ok) { res.json({ ok: false, canAccess: false, error: chatData.description ?? "Cannot access channel" }); return; }
    const meResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getMe`);
    const meData: any = await meResp.json();
    const botId = meData.result?.id;
    let isAdmin = false; let botStatus = "unknown";
    if (botId) {
      const mResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${botId}`);
      const mData: any = await mResp.json();
      if (mData.ok) { botStatus = mData.result.status; isAdmin = ["administrator", "creator"].includes(botStatus); }
    }
    const chat = chatData.result;
    res.json({
      ok: true, canAccess: true,
      chatId: String(chat?.id ?? ""),          // numeric e.g. "-1001234567890"
      title: chat?.title ?? null,
      username: chat?.username ? `@${chat.username}` : null,
      type: chat?.type ?? null,
      botStatus, isAdmin, getChatMemberWorks: isAdmin,
    });
  } catch (e: any) { res.json({ ok: false, canAccess: false, error: e?.message ?? "Network error" }); }
});

// ── GET /bot/shop-channels ────────────────────────────────────────────────────
router.get("/bot/shop-channels", requireAuth, (_req: any, res: any) => {
  const channels: any[] = (readJson("shop_channels", []) ?? []);
  channels.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
  res.json(channels);
});

// ── POST /bot/shop-channels ───────────────────────────────────────────────────
router.post("/bot/shop-channels", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const { name, username, link, icon, enabled } = req.body ?? {};
  if (!name?.trim() || !link?.trim()) return res.status(400).json({ error: "name và link là bắt buộc" });
  const maxOrder = channels.reduce((m: number, c: any) => Math.max(m, c.order ?? 0), 0);
  const ch = {
    id: Date.now().toString(),
    name: name.trim(),
    username: username?.trim() ?? "",
    link: link.trim(),
    icon: icon?.trim() || "🛒",
    order: maxOrder + 1,
    enabled: enabled !== false,
  };
  channels.push(ch);
  writeJson("shop_channels", channels);
  addLog("SHOP_CHANNEL_ADD", ch.name, "web-admin");
  res.json(ch);
});

// ── PUT /bot/shop-channels/reorder ────────────────────────────────────────────
router.put("/bot/shop-channels/reorder", requireAuth, (req: any, res: any) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const ordered = ids.map((id: string, idx: number) => {
    const ch = channels.find((c: any) => c.id === id);
    return ch ? { ...ch, order: idx + 1 } : null;
  }).filter(Boolean);
  writeJson("shop_channels", ordered);
  res.json(ordered);
});

// ── PUT /bot/shop-channels/:id ────────────────────────────────────────────────
router.put("/bot/shop-channels/:id", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const idx = channels.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Không tìm thấy kênh" });
  channels[idx] = { ...channels[idx], ...req.body, id: req.params.id };
  writeJson("shop_channels", channels);
  addLog("SHOP_CHANNEL_UPDATE", channels[idx].name, "web-admin");
  res.json(channels[idx]);
});

// ── DELETE /bot/shop-channels/:id ─────────────────────────────────────────────
router.delete("/bot/shop-channels/:id", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const ch = channels.find((c: any) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: "Không tìm thấy kênh" });
  const updated = channels.filter((c: any) => c.id !== req.params.id);
  writeJson("shop_channels", updated);
  addLog("SHOP_CHANNEL_DELETE", ch.name, "web-admin");
  res.json({ ok: true });
});

// ── GET /bot/gift-shop-channels ───────────────────────────────────────────────
router.get("/bot/gift-shop-channels", requireAuth, (_req: any, res: any) => {
  const channels: any[] = (readJson("gift_shop_channels", []) ?? []);
  channels.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
  res.json(channels);
});

// ── POST /bot/gift-shop-channels ──────────────────────────────────────────────
router.post("/bot/gift-shop-channels", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const { name, username, link, icon, enabled } = req.body ?? {};
  if (!name?.trim() || !link?.trim()) return res.status(400).json({ error: "name và link là bắt buộc" });
  const maxOrder = channels.reduce((m: number, c: any) => Math.max(m, c.order ?? 0), 0);
  const ch = {
    id: Date.now().toString(),
    name: name.trim(), username: username?.trim() ?? "",
    link: link.trim(), icon: icon?.trim() || "🛍️",
    order: maxOrder + 1, enabled: enabled !== false,
  };
  channels.push(ch);
  writeJson("gift_shop_channels", channels);
  addLog("GIFT_SHOP_CHANNEL_ADD", ch.name, "web-admin");
  res.json(ch);
});

// ── PUT /bot/gift-shop-channels/reorder ───────────────────────────────────────
router.put("/bot/gift-shop-channels/reorder", requireAuth, (req: any, res: any) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const ordered = ids.map((id: string, idx: number) => {
    const ch = channels.find((c: any) => c.id === id);
    return ch ? { ...ch, order: idx + 1 } : null;
  }).filter(Boolean);
  writeJson("gift_shop_channels", ordered);
  res.json(ordered);
});

// ── PUT /bot/gift-shop-channels/:id ───────────────────────────────────────────
router.put("/bot/gift-shop-channels/:id", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const idx = channels.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Không tìm thấy kênh" });
  channels[idx] = { ...channels[idx], ...req.body, id: req.params.id };
  writeJson("gift_shop_channels", channels);
  addLog("GIFT_SHOP_CHANNEL_UPDATE", channels[idx].name, "web-admin");
  res.json(channels[idx]);
});

// ── DELETE /bot/gift-shop-channels/:id ────────────────────────────────────────
router.delete("/bot/gift-shop-channels/:id", requireAuth, (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const ch = channels.find((c: any) => c.id === req.params.id);
  if (!ch) return res.status(404).json({ error: "Không tìm thấy kênh" });
  writeJson("gift_shop_channels", channels.filter((c: any) => c.id !== req.params.id));
  addLog("GIFT_SHOP_CHANNEL_DELETE", ch.name, "web-admin");
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC ROBOT API
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /bot/sync-robot/config ────────────────────────────────────────────────
router.get("/bot/sync-robot/config", requireAuth, (_req: any, res: any) => {
  const cfg: any = readJson("sync_robot_config", {}) ?? {};
  // Never return plaintext password
  res.json({
    enabled:    cfg.enabled    ?? false,
    site_url:   cfg.site_url   ?? "",
    login_url:  cfg.login_url  ?? "",
    orders_url: cfg.orders_url ?? "",
    email:      cfg.email      ?? "",
    password:   cfg.password   ? "***" : "",
    interval_s: cfg.interval_s ?? 300,
    sync_mode:  cfg.sync_mode  ?? "full",
  });
});

// ── PUT /bot/sync-robot/config ────────────────────────────────────────────────
router.put("/bot/sync-robot/config", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const current: any = readJson("sync_robot_config", {}) ?? {};
  const updated: any = {
    ...current,
    enabled:    body.enabled    !== undefined ? !!body.enabled : (current.enabled ?? false),
    site_url:   body.site_url   !== undefined ? String(body.site_url).trim()   : (current.site_url   ?? ""),
    login_url:  body.login_url  !== undefined ? String(body.login_url).trim()  : (current.login_url  ?? ""),
    orders_url: body.orders_url !== undefined ? String(body.orders_url).trim() : (current.orders_url ?? ""),
    email:      body.email      !== undefined ? String(body.email).trim()      : (current.email      ?? ""),
    interval_s: body.interval_s !== undefined ? Number(body.interval_s)        : (current.interval_s ?? 300),
    sync_mode:  (body.sync_mode === "new_only" ? "new_only" : (body.sync_mode === "full" ? "full" : (current.sync_mode ?? "full"))),
  };
  // Only update password if provided and not the masked sentinel "***"
  if (body.password && body.password !== "***") {
    updated.password = String(body.password);
  }
  writeJson("sync_robot_config", updated);
  addLog("SYNC_ROBOT_CONFIG", `enabled=${updated.enabled} interval=${updated.interval_s}s mode=${updated.sync_mode}`, "web-admin");
  res.json({ ok: true, message: "Đã lưu cấu hình robot" });
});

// ── GET /bot/sync-robot/status ────────────────────────────────────────────────
router.get("/bot/sync-robot/status", requireAuth, (_req: any, res: any) => {
  res.json(readJson("sync_robot_status", { running: false, last_run: null, next_run_at: null }) ?? {});
});

// ── GET /bot/sync-robot/logs ──────────────────────────────────────────────────
router.get("/bot/sync-robot/logs", requireAuth, (req: any, res: any) => {
  const logs: any[] = readJson("sync_robot_logs", []) ?? [];
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  res.json(logs.slice(-limit));
});

// ── POST /bot/sync-robot/trigger ──────────────────────────────────────────────
// Signal the robot to run a sync immediately
router.post("/bot/sync-robot/trigger", requireAuth, (_req: any, res: any) => {
  writeJson("sync_robot_trigger", { trigger: true, triggered_at: now(), triggered_by: "web-admin" });
  addLog("SYNC_ROBOT_TRIGGER", "manual trigger via admin panel", "web-admin");
  res.json({ ok: true, message: "Đã kích hoạt đồng bộ ngay" });
});

// ── POST /bot/sync-robot/test-login ──────────────────────────────────────────
// Spawns python3 sync_robot.py --test-login and waits for result (≤60s)
router.post("/bot/sync-robot/test-login", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const current: any = readJson("sync_robot_config", {}) ?? {};
  const cfg: any = {
    ...current,
    site_url:   body.site_url   ?? current.site_url   ?? "",
    login_url:  body.login_url  ?? current.login_url  ?? "",
    orders_url: body.orders_url ?? current.orders_url ?? "",
    email:      body.email      ?? current.email      ?? "",
  };
  if (body.password && body.password !== "***") {
    cfg.password = body.password;
  }
  // Save updated config so subprocess can read it
  writeJson("sync_robot_config", cfg);
  addLog("SYNC_ROBOT_TEST_LOGIN", `email=${cfg.email}`, "web-admin");

  // Resolve path to sync_robot.py (sibling of data/ dir)
  const robotScript = path.resolve(DATA_DIR, "..", "sync_robot.py");
  const env = {
    ...process.env,
    DATA_DIR,
    API_BASE_URL: process.env["API_BASE_URL"] ?? "http://localhost:8080",
  };

  execFile("python3", [robotScript, "--test-login"], { env, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
    let result: any = { ok: false, message: "Không nhận được phản hồi từ robot", steps: [] };
    // Python logger now writes to stderr; stdout should contain only the JSON print().
    // As a fallback, scan lines in reverse to find the last valid JSON line.
    const raw = (stdout || "").trim();
    if (raw) {
      const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
      let parsed = false;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith("{") || line.startsWith("[")) {
          try {
            result = JSON.parse(line);
            parsed = true;
            break;
          } catch { /* try previous line */ }
        }
      }
      if (!parsed) {
        result = { ok: false, message: `Robot không trả JSON hợp lệ: ${raw.slice(0, 300)}`, steps: [] };
      }
    } else if (err) {
      const msg = (stderr || err.message || "").slice(0, 500);
      result = { ok: false, message: `Lỗi: ${msg}`, steps: [] };
    }

    // Lưu tóm tắt vào sync_robot_logs (không lưu screenshot để tránh file quá lớn)
    try {
      const logs: any[] = readJson("sync_robot_logs", []) ?? [];
      const summary: any = {
        type: "test_login",
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_s: result.duration_s ?? 0,
        success: result.ok,
        login_ok: result.ok,
        download_ok: false,
        import_ok: false,
        new_orders: 0,
        updated_orders: 0,
        skipped_orders: 0,
        errors: result.ok ? 0 : 1,
        message: result.message ?? "",
        url: result.url ?? "",
        title: result.title ?? "",
        error_text: result.error_text ?? "",
        step_count: Array.isArray(result.steps) ? result.steps.length : 0,
        steps_summary: Array.isArray(result.steps)
          ? result.steps.map((s: any) => ({ step: s.step, ok: s.ok, note: s.note }))
          : [],
      };
      logs.push(summary);
      if (logs.length > 200) logs.splice(0, logs.length - 200);
      writeJson("sync_robot_logs", logs);
    } catch (_) { /* không fail nếu ghi log lỗi */ }

    res.json(result);
  });
});

// ── GET /bot/sync-robot/screenshot/:filename ─────────────────────────────────
// Serve screenshot files saved by do_test_login_only
router.get("/bot/sync-robot/screenshot/:filename", requireAuth, (req: any, res: any) => {
  const { filename } = req.params;
  // Sanitize: only allow safe filenames (no path traversal)
  if (!/^[\w\-\.]+\.jpg$/i.test(filename)) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const screenshotsDir = path.join(DATA_DIR, "screenshots");
  const filePath = path.join(screenshotsDir, filename);
  // Ensure the resolved path stays within screenshots dir
  if (!filePath.startsWith(screenshotsDir)) {
    return res.status(400).json({ error: "Invalid path" });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Screenshot not found" });
  }
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=86400");
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => res.status(500).end());
  stream.pipe(res);
});

// ── GET /bot/sync-robot/existing-sets ────────────────────────────────────────
// Called by the robot process to get current order IDs + item emails for dedup
router.get("/bot/sync-robot/existing-sets", requireAuth, (_req: any, res: any) => {
  const orders:     any = readJson("orders", {})      ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};
  const orderIds = Object.keys(orders);
  const itemEmails: string[] = [];
  for (const items of Object.values(orderItems) as any[][]) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const orig = (it.original_account || it.email || "").toLowerCase();
      const curr = (it.current_account  || "").toLowerCase();
      if (orig) itemEmails.push(orig);
      if (curr && curr !== orig) itemEmails.push(curr);
    }
  }
  res.json({ orderIds, itemEmails: [...new Set(itemEmails)] });
});

// ═══════════════════════════════════════════════════════════════════════════
// DAILY CHECK-IN
// ═══════════════════════════════════════════════════════════════════════════

const CHECKIN_SETTINGS_DEFAULTS = {
  enabled: true,
  hour: 7,
  minute: 0,
  timezone: "Asia/Ho_Chi_Minh",
  points_per_day: 10,
  streak_bonuses: [
    { days: 7,  bonus_points: 20  },
    { days: 30, bonus_points: 100 },
  ],
};

function readCheckinSettings(): any {
  return { ...CHECKIN_SETTINGS_DEFAULTS, ...(readJson("checkin_settings", {}) ?? {}) };
}

// ── GET /bot/checkin/settings ────────────────────────────────────────────────
router.get("/bot/checkin/settings", requireAuth, (_req: any, res: any) => {
  res.json(readCheckinSettings());
});

// ── PUT /bot/checkin/settings ────────────────────────────────────────────────
router.put("/bot/checkin/settings", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const current = readCheckinSettings();
  const updated = {
    ...current,
    enabled:         typeof body.enabled === "boolean"  ? body.enabled         : current.enabled,
    hour:            body.hour            != null        ? Number(body.hour)    : current.hour,
    minute:          body.minute          != null        ? Number(body.minute)  : current.minute,
    timezone:        typeof body.timezone === "string"   ? body.timezone        : current.timezone,
    points_per_day:  body.points_per_day  != null        ? Number(body.points_per_day) : current.points_per_day,
    streak_bonuses:  Array.isArray(body.streak_bonuses)  ? body.streak_bonuses  : current.streak_bonuses,
  };
  writeJson("checkin_settings", updated);
  addLog("CHECKIN_SETTINGS_UPDATE", "", "web-admin");
  res.json(updated);
});

// ── GET /bot/checkin/stats ───────────────────────────────────────────────────
router.get("/bot/checkin/stats", requireAuth, (_req: any, res: any) => {
  const records: any = readJson("checkin_records", {}) ?? {};
  const users:   any = readJson("users",           {}) ?? {};
  const logs:    any = readJson("checkin_logs",    {}) ?? {};

  const today = new Date().toISOString().slice(0, 10);
  const todayLog = logs[today] ?? {};

  let checkedInToday = 0;
  let longestStreak = 0;
  let totalPointsToday = 0;

  for (const rec of Object.values(records) as any[]) {
    if (rec.last_checkin === today) checkedInToday++;
    if ((rec.streak ?? 0) > longestStreak) longestStreak = rec.streak;
  }

  // Total points handed out today = checkedInToday × points_per_day (approx)
  // Use stored log value if available (more accurate with bonuses)
  totalPointsToday = todayLog.total_points_distributed ?? 0;

  const totalUsers = Object.keys(users).length;
  const notCheckedInToday = totalUsers - checkedInToday;

  res.json({
    today,
    checkedInToday,
    notCheckedInToday,
    longestStreak,
    totalPointsToday,
    notifSent:   todayLog.sent   ?? 0,
    notifFailed: todayLog.failed ?? 0,
    triggeredAt: todayLog.triggered_at ?? null,
    totalUsersWithRecords: Object.keys(records).length,
  });
});

// ── GET /bot/checkin/records ─────────────────────────────────────────────────
router.get("/bot/checkin/records", requireAuth, (_req: any, res: any) => {
  const records: any = readJson("checkin_records", {}) ?? {};
  const users:   any = readJson("users",           {}) ?? {};
  const today = new Date().toISOString().slice(0, 10);

  const list = Object.entries(records).map(([uid, rec]: [string, any]) => {
    const user = users[uid] ?? {};
    return {
      userId:        rec.user_id ?? uid,
      username:      user.username   ?? "",
      firstName:     user.firstName  ?? user.first_name ?? "",
      lastCheckin:   rec.last_checkin ?? "",
      streak:        rec.streak       ?? 0,
      totalPoints:   rec.total_points ?? 0,
      totalCheckins: rec.total_checkins ?? 0,
      checkedInToday: rec.last_checkin === today,
    };
  });

  // Sort by total_points desc
  list.sort((a, b) => b.totalPoints - a.totalPoints);
  res.json(list);
});

// ── POST /bot/checkin/trigger ────────────────────────────────────────────────
// Manual trigger — queues the checkin notification broadcast immediately
router.post("/bot/checkin/trigger", requireAuth, (_req: any, res: any) => {
  const pending: any[] = readJson("pending_broadcasts", []) ?? [];
  pending.push({
    id:       `checkin_${Date.now()}`,
    message:  "__CHECKIN_NOTIFICATION__",  // Special sentinel bot.py recognises
    target:   "checkin_notify",
    createdAt: now(),
  });
  writeJson("pending_broadcasts", pending);
  addLog("CHECKIN_TRIGGER_MANUAL", "", "web-admin");
  res.json({ ok: true, message: "Checkin notification queued" });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── GIFT BOXES (Ô Quà Bí Mật) ────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function assignBoxPrizes(totalBoxes: number, prizes: any[]): any[] {
  const pool: string[] = [];
  let unlimitedId: string | null = null;
  for (const p of prizes) {
    const qty = Number(p.quantity ?? 0);
    if (!qty) { unlimitedId = p.id; }
    else { for (let i = 0; i < qty && pool.length < totalBoxes; i++) pool.push(p.id); }
  }
  shuffleArray(pool);
  const assigned = pool.slice(0, totalBoxes);
  while (assigned.length < totalBoxes) assigned.push(unlimitedId ?? "__lucky__");
  shuffleArray(assigned);
  return assigned.map((prizeId, index) => ({
    index, prizeId, opened: false, openedBy: null, openedByName: null, openedAt: null,
  }));
}

function reassignBoxPrizes(totalBoxes: number, prizes: any[], existing: any[]): any[] {
  const fresh = assignBoxPrizes(totalBoxes, prizes);
  return fresh.map((nb, i) => (existing?.[i]?.opened ? existing[i] : nb));
}

// ── GET /bot/gift-boxes ───────────────────────────────────────────────────────
router.get("/bot/gift-boxes", requireAuth, (_req: any, res: any) => {
  res.json(readJson("gift_boxes", []) ?? []);
});

// ── POST /bot/gift-boxes ──────────────────────────────────────────────────────
router.post("/bot/gift-boxes", requireAuth, (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const body = req.body ?? {};
  const prizes: any[] = Array.isArray(body.prizes) ? body.prizes.map((p: any, i: number) => ({
    ...p, id: p.id ?? `p_${Date.now()}_${i}`,
  })) : [];
  const totalBoxes = Number(body.totalBoxes) || 25;
  const newEvent = {
    id: `gb_${Date.now()}`,
    name: body.name || "Sự kiện mới",
    enabled: false,
    startTime: body.startTime ?? "",
    endTime: body.endTime ?? "",
    totalBoxes,
    maxPicksPerUser: Number(body.maxPicksPerUser) || 1,
    membersOnly: body.membersOnly ?? false,
    buyersOnly: body.buyersOnly ?? false,
    prizes,
    boxes: assignBoxPrizes(totalBoxes, prizes),
    createdAt: now(),
  };
  events.push(newEvent);
  writeJson("gift_boxes", events);
  addLog("GIFT_BOX_CREATE", `name=${newEvent.name} boxes=${totalBoxes}`, "web-admin");
  res.json(newEvent);
});

// ── PUT /bot/gift-boxes/:id ───────────────────────────────────────────────────
router.put("/bot/gift-boxes/:id", requireAuth, (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const idx = events.findIndex((e: any) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const body = req.body ?? {};
  const old = events[idx];
  const newTotal  = body.totalBoxes != null ? Number(body.totalBoxes) : old.totalBoxes;
  const newPrizes: any[] = Array.isArray(body.prizes) ? body.prizes.map((p: any, i: number) => ({
    ...p, id: p.id ?? `p_${Date.now()}_${i}`,
  })) : old.prizes;
  // Re-assign boxes if prizes or size changed (preserve already-opened boxes)
  const needsReassign = body.prizes != null || (body.totalBoxes != null && body.totalBoxes !== old.totalBoxes);
  const boxes = needsReassign ? reassignBoxPrizes(newTotal, newPrizes, old.boxes) : old.boxes;
  events[idx] = { ...old, ...body, id: req.params.id, prizes: newPrizes, boxes, totalBoxes: newTotal };
  writeJson("gift_boxes", events);
  addLog("GIFT_BOX_UPDATE", `id=${req.params.id}`, "web-admin");
  res.json(events[idx]);
});

// ── DELETE /bot/gift-boxes/:id ────────────────────────────────────────────────
router.delete("/bot/gift-boxes/:id", requireAuth, (req: any, res: any) => {
  let events: any[] = readJson("gift_boxes", []) ?? [];
  events = events.filter((e: any) => e.id !== req.params.id);
  writeJson("gift_boxes", events);
  addLog("GIFT_BOX_DELETE", `id=${req.params.id}`, "web-admin");
  res.json({ ok: true });
});

// ── GET /bot/gift-boxes/:id/stats ─────────────────────────────────────────────
router.get("/bot/gift-boxes/:id/stats", requireAuth, (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const ev = events.find((e: any) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: "Not found" });
  const boxes: any[] = ev.boxes ?? [];
  const prizeMap = Object.fromEntries((ev.prizes ?? []).map((p: any) => [p.id, p]));
  const openedBoxes = boxes.filter((b: any) => b.opened);
  res.json({
    totalBoxes: boxes.length,
    openedBoxes: openedBoxes.length,
    remainingBoxes: boxes.length - openedBoxes.length,
    participants: new Set(openedBoxes.map((b: any) => b.openedBy)).size,
    winners: openedBoxes.map((b: any) => ({
      boxIndex: b.index,
      openedBy: b.openedBy,
      openedByName: b.openedByName,
      openedAt: b.openedAt,
      prize: prizeMap[b.prizeId] ?? null,
    })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── SECRET CODES (Săn mã bí mật) ─────────────────────────────────────────────

// ── GET /bot/secret-codes ────────────────────────────────────────────────────
router.get("/bot/secret-codes", requireAuth, (_req: any, res: any) => {
  const codes = readJson("secret_codes", []) ?? [];
  res.json(codes);
});

// ── POST /bot/secret-codes ───────────────────────────────────────────────────
router.post("/bot/secret-codes", requireAuth, (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const body = req.body ?? {};
  const newCode = {
    id: `sc_${Date.now()}`,
    enabled: false,
    code: (body.code ?? "").toUpperCase().trim(),
    reward: body.reward ?? { type: "custom", label: "", value: "" },
    maxWinners: body.maxWinners ?? 0,
    startTime: body.startTime ?? "",
    endTime: body.endTime ?? "",
    membersOnly: body.membersOnly ?? false,
    onePerUser: body.onePerUser !== false,
    winMessage: body.winMessage ?? "🎉 Chúc mừng! Bạn nhận được:\n🎁 {reward}",
    exhaustedMessage: body.exhaustedMessage ?? "😔 Mã đã hết lượt nhận. Theo dõi bot để không bỏ lỡ sự kiện tiếp theo!",
    invalidMessage: body.invalidMessage ?? "❌ Mã không hợp lệ. Vui lòng kiểm tra lại.",
    createdAt: now(),
    winners: [],
  };
  codes.push(newCode);
  writeJson("secret_codes", codes);
  addLog("SECRET_CODE_CREATE", `code=${newCode.code}`, "web-admin");
  res.json(newCode);
});

// ── PUT /bot/secret-codes/:id ────────────────────────────────────────────────
router.put("/bot/secret-codes/:id", requireAuth, (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const idx = codes.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const body = req.body ?? {};
  if (body.code) body.code = String(body.code).toUpperCase().trim();
  codes[idx] = { ...codes[idx], ...body, id: req.params.id, winners: codes[idx].winners ?? [] };
  writeJson("secret_codes", codes);
  addLog("SECRET_CODE_UPDATE", `id=${req.params.id} code=${codes[idx].code}`, "web-admin");
  res.json(codes[idx]);
});

// ── DELETE /bot/secret-codes/:id ─────────────────────────────────────────────
router.delete("/bot/secret-codes/:id", requireAuth, (req: any, res: any) => {
  let codes: any[] = readJson("secret_codes", []) ?? [];
  const target = codes.find((c: any) => c.id === req.params.id);
  codes = codes.filter((c: any) => c.id !== req.params.id);
  writeJson("secret_codes", codes);
  addLog("SECRET_CODE_DELETE", `id=${req.params.id} code=${target?.code ?? "?"}`, "web-admin");
  res.json({ ok: true });
});

// ── GET /bot/secret-codes/:id/winners ────────────────────────────────────────
router.get("/bot/secret-codes/:id/winners", requireAuth, (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const code = codes.find((c: any) => c.id === req.params.id);
  if (!code) return res.status(404).json({ error: "Not found" });
  res.json(code.winners ?? []);
});

// DELIVERY REQUESTS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /bot/delivery-reminder-settings ──────────────────────────────────────
const DELIVERY_REMINDER_DEFAULTS = { enabled: true, reminderMinutes: [10, 30, 60] };
router.get("/bot/delivery-reminder-settings", requireAuth, (_req: any, res: any) => {
  const stored = readJson("delivery_reminder_settings", {}) ?? {};
  res.json({ ...DELIVERY_REMINDER_DEFAULTS, ...stored });
});

// ── PUT /bot/delivery-reminder-settings ──────────────────────────────────────
router.put("/bot/delivery-reminder-settings", requireAuth, (req: any, res: any) => {
  const stored = readJson("delivery_reminder_settings", {}) ?? {};
  const body = req.body ?? {};
  const updated: any = { ...DELIVERY_REMINDER_DEFAULTS, ...stored };

  if (typeof body.enabled === "boolean") updated.enabled = body.enabled;
  if (Array.isArray(body.reminderMinutes)) {
    const mins = body.reminderMinutes
      .map((v: any) => parseInt(v, 10))
      .filter((v: number) => !isNaN(v) && v > 0)
      .sort((a: number, b: number) => a - b);
    if (mins.length > 0) updated.reminderMinutes = mins;
  }

  writeJson("delivery_reminder_settings", updated);
  addLog("DELIVERY_REMINDER_SETTINGS_UPDATE", JSON.stringify(updated).slice(0, 120), "web-admin");
  res.json(updated);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC (no auth) — Customer unlock page
// ═══════════════════════════════════════════════════════════════════════════════

const CUSTOMER_PAGE_URL = process.env["CUSTOMER_PAGE_URL"] ?? "http://103.180.138.203/api/customer-page";

// ── GET /customer-page ────────────────────────────────────────────────────────
router.get("/customer-page", (_req: any, res: any) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nhận tài khoản</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:28px 24px;width:100%;max-width:440px}
  h1{font-size:1.25rem;font-weight:700;margin-bottom:4px;color:#1a202c}
  .subtitle{font-size:.875rem;color:#718096;margin-bottom:24px}
  label{font-size:.8125rem;font-weight:600;color:#4a5568;display:block;margin-bottom:6px}
  input{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:.9375rem;outline:none;transition:border .15s}
  input:focus{border-color:#4f46e5}
  .btn{display:block;width:100%;padding:12px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .15s}
  .btn-primary{background:#4f46e5;color:#fff}
  .btn-primary:hover{opacity:.9}
  .btn-unlock{background:linear-gradient(135deg,#059669,#047857);color:#fff;margin-top:18px}
  .btn-unlock:hover{opacity:.9}
  .btn-unlock:disabled{opacity:.5;cursor:not-allowed}
  .section{margin-top:20px}
  .info-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f4f8;font-size:.875rem}
  .info-row:last-child{border-bottom:none}
  .info-label{color:#718096}
  .info-val{font-weight:600;color:#1a202c;text-align:right;max-width:200px;word-break:break-all}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.75rem;font-weight:600}
  .badge-wait{background:#fef3c7;color:#92400e}
  .badge-ok{background:#d1fae5;color:#065f46}
  .badge-refunded{background:#ede9fe;color:#5b21b6}
  .lock-box{background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;margin-top:18px;text-align:center}
  .lock-icon{font-size:2.5rem;margin-bottom:8px}
  .lock-text{font-size:.875rem;color:#718096;margin-bottom:4px}
  .lock-hint{font-size:.8125rem;color:#a0aec0}
  .cred-box{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:20px;margin-top:18px}
  .cred-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
  .cred-row:last-child{margin-bottom:0}
  .cred-label{font-size:.8125rem;color:#065f46;font-weight:600}
  .cred-val{font-family:monospace;font-size:.9375rem;font-weight:700;color:#1a202c;word-break:break-all;text-align:right}
  .copy-btn{background:#e0fce7;border:none;border-radius:6px;padding:4px 8px;font-size:.75rem;cursor:pointer;color:#047857;font-weight:600;flex-shrink:0;margin-left:8px}
  .copy-btn:active{background:#bbf7d0}
  .alert{border-radius:8px;padding:12px 14px;font-size:.875rem;margin-top:16px}
  .alert-err{background:#fff5f5;color:#c53030;border:1px solid #fed7d7}
  .alert-warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
  .mt-16{margin-top:16px}
  .spinner{border:3px solid #e2e8f0;border-top:3px solid #4f46e5;border-radius:50%;width:22px;height:22px;animation:spin .7s linear infinite;margin:0 auto 12px}
  @keyframes spin{to{transform:rotate(360deg)}}
  #lookup-section,#result-section{display:none}
</style>
</head>
<body>
<div class="card">
  <h1>📦 Nhận tài khoản của bạn</h1>
  <p class="subtitle">Nhập mã đơn hàng để xem và mở khoá tài khoản</p>

  <div id="lookup-section">
    <label for="order-input">Mã đơn hàng</label>
    <input id="order-input" placeholder="VD: ORD-XXXXXXXX" autocomplete="off" />
    <button class="btn btn-primary mt-16" onclick="lookupOrder()">🔍 Tra cứu</button>
    <div id="lookup-err" class="alert alert-err" style="display:none"></div>
  </div>

  <div id="loading" style="display:none;text-align:center;padding:24px 0">
    <div class="spinner"></div>
    <p style="color:#718096;font-size:.875rem">Đang tải...</p>
  </div>

  <div id="result-section">
    <div class="section">
      <div class="info-row"><span class="info-label">Mã đơn</span><span class="info-val" id="r-orderId"></span></div>
      <div class="info-row"><span class="info-label">Sản phẩm</span><span class="info-val" id="r-product"></span></div>
      <div class="info-row"><span class="info-label">Bảo hành đến</span><span class="info-val" id="r-warranty"></span></div>
      <div class="info-row"><span class="info-label">Trạng thái</span><span class="info-val" id="r-status"></span></div>
    </div>

    <div id="lock-box" class="lock-box">
      <div class="lock-icon">🔒</div>
      <div class="lock-text">Tài khoản đang được bảo vệ</div>
      <div class="lock-hint">Nhấn nút bên dưới để mở khoá và xem thông tin đăng nhập</div>
      <button class="btn btn-unlock" id="unlock-btn" onclick="unlockAccount()">🔓 Mở khoá nhận tài khoản</button>
    </div>

    <div id="cred-box" class="cred-box" style="display:none">
      <div style="font-weight:700;color:#065f46;margin-bottom:14px">✅ Thông tin tài khoản</div>
      <div class="cred-row">
        <span class="cred-label">📧 Tài khoản</span>
        <div style="display:flex;align-items:center">
          <span class="cred-val" id="c-email"></span>
          <button class="copy-btn" onclick="copy('c-email',this)">Sao chép</button>
        </div>
      </div>
      <div class="cred-row">
        <span class="cred-label">🔒 Mật khẩu</span>
        <div style="display:flex;align-items:center">
          <span class="cred-val" id="c-pass"></span>
          <button class="copy-btn" onclick="copy('c-pass',this)">Sao chép</button>
        </div>
      </div>
      <div class="cred-row" id="row-2fa" style="display:none">
        <span class="cred-label">🛡 2FA</span>
        <div style="display:flex;align-items:center">
          <span class="cred-val" id="c-2fa"></span>
          <button class="copy-btn" onclick="copy('c-2fa',this)">Sao chép</button>
        </div>
      </div>
      <div class="alert alert-warn" style="margin-top:14px;font-size:.8125rem">⚠️ Vui lòng lưu lại thông tin này. Hãy đổi mật khẩu ngay sau khi đăng nhập.</div>
    </div>
    <div id="result-err" class="alert alert-err" style="display:none;margin-top:12px"></div>
  </div>
</div>

<script>
const BASE = '';
let currentOrderId = '';

function getParam(key) {
  return new URLSearchParams(location.search).get(key) || '';
}

function showLoading(v) {
  document.getElementById('loading').style.display = v ? 'block' : 'none';
}

function copy(id, btn) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el.textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓';
    setTimeout(() => btn.textContent = orig, 1500);
  });
}

function statusBadge(status) {
  if (status === 'pending_unlock') return '<span class="badge badge-wait">⏳ Chờ mở khoá</span>';
  if (status === 'unlocked' || status === 'sent') return '<span class="badge badge-ok">✅ Đã giao</span>';
  if (status === 'refunded') return '<span class="badge badge-refunded">💰 Hoàn tiền</span>';
  return '<span class="badge badge-wait">' + status + '</span>';
}

async function lookupOrder() {
  const input = document.getElementById('order-input').value.trim();
  if (!input) return;
  currentOrderId = input;
  doLookup(input);
}

async function doLookup(orderId) {
  showLoading(true);
  document.getElementById('lookup-section').style.display = 'none';
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('lookup-err').style.display = 'none';

  try {
    const resp = await fetch(BASE + '/api/public/order/' + encodeURIComponent(orderId));
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      showLoading(false);
      document.getElementById('lookup-section').style.display = 'block';
      const errEl = document.getElementById('lookup-err');
      errEl.textContent = data.message || 'Không tìm thấy đơn hàng. Vui lòng kiểm tra lại mã đơn.';
      errEl.style.display = 'block';
      return;
    }
    showLoading(false);
    document.getElementById('result-section').style.display = 'block';
    document.getElementById('r-orderId').textContent = data.orderId;
    document.getElementById('r-product').textContent = data.productName || '—';
    document.getElementById('r-warranty').textContent = data.warrantyEnd || '—';
    document.getElementById('r-status').innerHTML = statusBadge(data.status);

    if (data.unlocked) {
      showCredentials(data.account, data.password, data.twoFA);
    } else {
      document.getElementById('lock-box').style.display = 'block';
      document.getElementById('cred-box').style.display = 'none';
    }
  } catch(e) {
    showLoading(false);
    document.getElementById('lookup-section').style.display = 'block';
    const errEl = document.getElementById('lookup-err');
    errEl.textContent = 'Lỗi kết nối. Vui lòng thử lại.';
    errEl.style.display = 'block';
  }
}

function showCredentials(email, password, twoFA) {
  document.getElementById('lock-box').style.display = 'none';
  document.getElementById('cred-box').style.display = 'block';
  document.getElementById('c-email').textContent = email || '';
  document.getElementById('c-pass').textContent = password || '';
  if (twoFA) {
    document.getElementById('c-2fa').textContent = twoFA;
    document.getElementById('row-2fa').style.display = 'flex';
  }
}

async function unlockAccount() {
  const btn = document.getElementById('unlock-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý...';
  document.getElementById('result-err').style.display = 'none';
  try {
    const resp = await fetch(BASE + '/api/public/order/' + encodeURIComponent(currentOrderId) + '/unlock', { method: 'POST' });
    const data = await resp.json();
    if (!resp.ok || !data.ok) {
      const errEl = document.getElementById('result-err');
      errEl.textContent = data.message || 'Không thể mở khoá. Vui lòng thử lại.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = '🔓 Mở khoá nhận tài khoản';
      return;
    }
    showCredentials(data.account, data.password, data.twoFA);
  } catch(e) {
    const errEl = document.getElementById('result-err');
    errEl.textContent = 'Lỗi kết nối. Vui lòng thử lại.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '🔓 Mở khoá nhận tài khoản';
  }
}

// Init
window.onload = function() {
  const id = getParam('id');
  if (id) {
    currentOrderId = id;
    doLookup(id);
  } else {
    document.getElementById('lookup-section').style.display = 'block';
  }
};
</script>
</body>
</html>`);
});

// ── GET /public/order/:orderId ────────────────────────────────────────────────
router.get("/public/order/:orderId", (req: any, res: any) => {
  const { orderId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {};
  const orders: any = readJson("orders", {}) ?? {};

  const items: any[] = (orderItems[orderId] ?? []).filter(
    (it: any) => it.source === "manual_delivery" || it.email
  );
  if (!items.length) {
    res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng. Vui lòng kiểm tra lại mã đơn." });
    return;
  }

  // Get most recent item (could be re-delivered)
  const item = items[items.length - 1];
  const order: any = orders[orderId] ?? {};

  const unlocked = item.unlocked === true;
  const result: any = {
    ok: true,
    orderId,
    productName: item.productName || order.productName || "",
    warrantyEnd: item.warranty_end_date || order.warrantyExpiry || null,
    status: unlocked ? "unlocked" : "pending_unlock",
    unlocked,
  };

  if (unlocked) {
    result.account = item.email || item.original_account || "";
    result.password = item.password || "";
    result.twoFA = item.twoFA || null;
  }

  res.json(result);
});

// ── POST /public/order/:orderId/unlock ────────────────────────────────────────
router.post("/public/order/:orderId/unlock", async (req: any, res: any) => {
  const { orderId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {};
  const items: any[] = orderItems[orderId] ?? [];

  const idx = items.findLastIndex
    ? items.findLastIndex((it: any) => it.source === "manual_delivery" || it.email)
    : [...items].reverse().findIndex((it: any) => it.source === "manual_delivery" || it.email);
  const realIdx = idx >= 0 && !items.findLastIndex ? items.length - 1 - idx : idx;

  if (realIdx < 0) {
    res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản cho đơn hàng này" });
    return;
  }
  const item = items[realIdx];

  // Mark unlocked
  items[realIdx] = { ...item, unlocked: true, unlockedAt: now() };
  orderItems[orderId] = items;
  writeJson("order_items", orderItems);

  // Mark delivery request → sent
  const deliveryRequests: any[] = readJson("delivery_requests", []) ?? [];
  const drIdx = deliveryRequests.findIndex(
    (r: any) => r.orderId === orderId && r.status === "pending_unlock"
  );
  if (drIdx >= 0) {
    const dr = deliveryRequests[drIdx];
    deliveryRequests[drIdx] = { ...dr, status: "sent", sentAt: now(), deliveredViaWeb: true };
    writeJson("delivery_requests", deliveryRequests);

    // Update order status → active if not already
    const orders: any = readJson("orders", {}) ?? {};
    const order: any = orders[orderId] ?? {};
    if (order.status === "pending" || !order.status) {
      orders[orderId] = { ...order, status: "active", updatedAt: now() };
      writeJson("orders", orders);
    }
  }

  addLog("DELIVERY_UNLOCKED", orderId, "customer-web");

  res.json({
    ok: true,
    account: item.email || item.original_account || "",
    password: item.password || "",
    twoFA: item.twoFA || null,
  });
});

// ── GET /bot/delivery ─────────────────────────────────────────────────────────
router.get("/bot/delivery", requireAuth, (_req: any, res: any) => {
  const requests: any[] = readJson("delivery_requests", []) ?? [];
  res.json(requests.sort((a: any, b: any) => b.submittedAt?.localeCompare(a.submittedAt ?? "") ?? 0));
});

// ── POST /bot/delivery/:id/send ───────────────────────────────────────────────
// Lưu tài khoản vào order_items (unlocked=false), gửi Telegram link mở khoá.
// Khách tự bấm "Mở khoá" trên web → tài khoản hiển thị + đơn tự đánh dấu đã giao.
router.post("/bot/delivery/:id/send", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { account, password, twoFA } = req.body ?? {};
  if (!account || !password) {
    res.status(400).json({ ok: false, message: "Tài khoản và mật khẩu là bắt buộc" });
    return;
  }

  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx];

  const deliveredAt = now();
  const orders: any  = readJson("orders", {}) ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};
  const order: any   = orders[dr.orderId] ?? {};

  // ── Tính warranty_end_date ────────────────────────────────────────────────
  let warrantyEndDate: string | null = order.warrantyExpiry || order.warrantyDate || null;
  if (!warrantyEndDate) {
    const wDays = Number(order.warrantyDays || 0);
    const startStr = order.purchaseDate || order.paymentAt || deliveredAt;
    if (wDays > 0 && startStr) {
      try {
        const d = new Date(startStr.slice(0, 10));
        d.setDate(d.getDate() + wDays);
        warrantyEndDate = d.toISOString().slice(0, 10);
      } catch {}
    }
  }

  // ── Ghi order_items với unlocked=false ────────────────────────────────────
  const existingItems: any[] = orderItems[dr.orderId] ?? [];
  const existIdx = existingItems.findIndex(
    (it: any) => (it.original_account || it.email || "").toLowerCase() === account.toLowerCase()
  );
  const itemEntry: any = {
    itemId: existIdx >= 0 ? existingItems[existIdx].itemId : crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
    email:    account,
    password: password || null,
    twoFA:    twoFA    || null,
    unlocked: false,
    status:   "delivered",
    item_status: "active",
    productName: order.productName || dr.productName || "",
    createdAt: existIdx >= 0 ? existingItems[existIdx].createdAt : deliveredAt,
    original_account:   account,
    current_account:    account,
    current_replacement_number: 0,
    original_delivered_at: deliveredAt,
    warranty_days: Number(order.warrantyDays || 0) || null,
    warranty_end_date: warrantyEndDate,
    source: "manual_delivery",
  };
  if (existIdx >= 0) {
    existingItems[existIdx] = { ...existingItems[existIdx], ...itemEntry };
  } else {
    existingItems.push(itemEntry);
  }
  orderItems[dr.orderId] = existingItems;
  writeJson("order_items", orderItems);
  // ─────────────────────────────────────────────────────────────────────────

  // ── Đặt delivery request → pending_unlock ────────────────────────────────
  requests[idx] = {
    ...dr,
    status: "pending_unlock",
    sentAt: deliveredAt,
    sentBy: "web-admin",
    accountInfo: { account, password, twoFA: twoFA || null },
    reminderEnabled: false,
    nextReminderAt: null,
    reminderProcessing: false,
  };
  writeJson("delivery_requests", requests);

  // ── Gửi Telegram link mở khoá ─────────────────────────────────────────────
  const unlockUrl = `${CUSTOMER_PAGE_URL}?id=${encodeURIComponent(dr.orderId)}`;
  const userLang = dr.userLang ?? "vi";
  const isEN = userLang === "en";
  const notifyLines: string[] = [];
  if (isEN) {
    notifyLines.push(`📦 <b>Your account is ready!</b>`);
    notifyLines.push(`Order: <code>${dr.orderId}</code>`);
    notifyLines.push(`\nClick the button below to unlock and receive your account credentials.`);
    notifyLines.push(`\n<i>Your account is protected — only you can unlock it.</i>`);
  } else {
    notifyLines.push(`📦 <b>Tài khoản của bạn đã sẵn sàng!</b>`);
    notifyLines.push(`Mã đơn: <code>${dr.orderId}</code>`);
    notifyLines.push(`\nNhấn nút bên dưới để mở khoá và nhận thông tin tài khoản.`);
    notifyLines.push(`\n<i>Tài khoản được bảo vệ — chỉ bạn mới có thể mở khoá.</i>`);
  }
  const notifyMsg = notifyLines.join("\n");
  const btnText = isEN ? "🔓 Unlock Account" : "🔓 Mở khoá nhận tài khoản";

  const result = await sendTelegramWithButton(dr.userId, notifyMsg, btnText, unlockUrl);

  addLog("DELIVERY_PENDING_UNLOCK", `${dr.username || dr.userId} → ${account}`, "web-admin");

  if (!result.ok) {
    // Telegram failed — still saved to order_items, khách vẫn có thể tra trực tiếp
    res.json({ ok: true, warned: `Đã lưu tài khoản nhưng gửi Telegram thất bại: ${result.error}. Khách có thể tra tại: ${unlockUrl}` });
    return;
  }
  res.json({ ok: true, unlockUrl });
});

// ── POST /bot/delivery/:id/done ───────────────────────────────────────────────
router.post("/bot/delivery/:id/done", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { note, notify } = req.body ?? {};

  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx];

  requests[idx] = {
    ...dr,
    status: "done",
    doneAt: now(),
    doneBy: "web-admin",
    doneNote: note || null,
    reminderEnabled: false,
    nextReminderAt: null,
    reminderProcessing: false,
  };
  writeJson("delivery_requests", requests);
  addLog("DELIVERY_DONE", `${dr.username || dr.userId} | Order: ${dr.orderId}`, "web-admin");

  // Optionally notify customer
  if (notify) {
    const userLang = dr.userLang ?? "vi";
    const isEN = userLang === "en";
    const lines: string[] = [];
    if (isEN) {
      lines.push(`✅ <b>Your delivery request has been processed.</b>`);
      lines.push(`📦 Order: <code>${dr.orderId}</code>`);
      if (note) lines.push(`📝 Note: ${note}`);
    } else {
      lines.push(`✅ <b>Yêu cầu giao tài khoản của bạn đã được xử lý xong.</b>`);
      lines.push(`📦 Mã đơn: <code>${dr.orderId}</code>`);
      if (note) lines.push(`📝 Ghi chú: ${note}`);
    }
    const result = await sendTelegramMessage(dr.userId, lines.join("\n"));
    if (!result.ok) {
      res.json({ ok: true, warned: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
      return;
    }
  }

  res.json({ ok: true });
});

// ── POST /bot/delivery/:id/refund ─────────────────────────────────────────────
router.post("/bot/delivery/:id/refund", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { amount, note } = req.body ?? {};
  if (!amount && amount !== 0) {
    res.status(400).json({ ok: false, message: "Số tiền hoàn là bắt buộc" });
    return;
  }

  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx];

  const userLang = dr.userLang ?? "vi";
  const isEN = userLang === "en";
  const amtNum = Number(amount) || 0;
  const amtStr = amtNum.toLocaleString("vi-VN") + "đ";
  const lines: string[] = [];
  if (isEN) {
    lines.push(`💰 <b>Your delivery request has been refunded</b>\n`);
    lines.push(`📦 Order: <code>${dr.orderId}</code>`);
    lines.push(`💵 Refund amount: <b>${amtStr}</b>`);
    if (note) lines.push(`📝 Note: ${note}`);
    lines.push(`\nPlease contact support if you have any questions.`);
  } else {
    lines.push(`💰 <b>Yêu cầu giao tài khoản đã được hoàn tiền</b>\n`);
    lines.push(`📦 Mã đơn: <code>${dr.orderId}</code>`);
    lines.push(`💵 Số tiền hoàn: <b>${amtStr}</b>`);
    if (note) lines.push(`📝 Ghi chú: ${note}`);
    lines.push(`\nVui lòng liên hệ hỗ trợ nếu bạn có thắc mắc.`);
  }
  const message = lines.join("\n");
  const result = await sendTelegramMessage(dr.userId, message);

  const refundedAt = now();
  requests[idx] = {
    ...dr,
    status: "refunded",
    refundedAt,
    refundedBy: "web-admin",
    refundAmount: amtNum,
    refundNote: note || null,
    reminderEnabled: false,
    nextReminderAt: null,
    reminderProcessing: false,
  };
  writeJson("delivery_requests", requests);

  // Also update orders.json so the bot's báo lỗi gate sees this as refunded
  const orders: any = readJson("orders", {}) ?? {};
  if (dr.orderId && orders[dr.orderId]) {
    orders[dr.orderId].status = "refunded";
    orders[dr.orderId].refundedAt = refundedAt;
    orders[dr.orderId].refundAmount = amtNum;
    writeJson("orders", orders);
  }
  // Update all order_items for this order to refunded as well
  const orderItems: any = readJson("order_items", {}) ?? {};
  const itemList: any[] = orderItems[dr.orderId] ?? [];
  if (itemList.length > 0) {
    orderItems[dr.orderId] = itemList.map((it: any) => ({
      ...it,
      item_status: "refunded",
      refunded_at: refundedAt,
      refund_amount: amtNum,
      refund_admin_id: "web-admin",
      support_enabled: false,
    }));
    writeJson("order_items", orderItems);
  }
  // Add refund record so order lookup shows the refund detail block
  const refundRecords: any = readJson("refund_records", {}) ?? {};
  refundRecords[dr.orderId] = {
    orderId: dr.orderId,
    amount: amtNum,
    note: note || null,
    refundedAt,
    refundedBy: "web-admin",
    source: "delivery",
  };
  writeJson("refund_records", refundRecords);

  // Also save to refund_history so it shows in refund history page and blocks báo bảo hành
  const deliveryRefundHistory: any[] = readJson("refund_history", []) ?? [];
  deliveryRefundHistory.push({
    id: crypto.randomUUID(),
    warrantyRequestId: null,
    orderId: dr.orderId || null,
    orderCode: dr.orderId || null,
    account: dr.username || dr.userId || "",
    email: "",
    amount: amtNum,
    note: note || "",
    refundedAt,
    refundedBy: "web-admin",
    reason: note || "",
    source: "delivery",
  });
  writeJson("refund_history", deliveryRefundHistory);

  addLog("DELIVERY_REFUNDED", `${dr.username || dr.userId} | ${amtStr}`, "web-admin");

  if (!result.ok) {
    res.status(500).json({ ok: false, message: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
    return;
  }
  res.json({ ok: true });
});

// BACKUP
// ═══════════════════════════════════════════════════════════════════════════

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
