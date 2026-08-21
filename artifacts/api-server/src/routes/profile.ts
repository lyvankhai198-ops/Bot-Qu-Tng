/**
 * profile.ts — Customer Profile routes
 *
 * Admin: GET/PUT /bot/profile/config, GET /bot/profile/admin-stats
 * Bot:   GET /bot/profile/:userId/summary, /orders, /points, /activity, /preferences
 *        PUT /bot/profile/:userId/preferences
 */
import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson, now } from "../lib/dataUtils";

const router = Router();

// ── Default config ────────────────────────────────────────────────────────────
const DEFAULT_CONFIG = {
  profileEnabled:    true,
  showOrders:        true,
  showWarranty:      true,
  showPoints:        true,
  showLog:           true,
  showSettings:      true,
  showAchievements:  false,
  showRewards:       false,
  showFavorites:     false,
  showStats:         false,
};

// ── GET /bot/profile/config ───────────────────────────────────────────────────
router.get("/bot/profile/config", requireAuth, (_req: any, res: any) => {
  const cfg = readJson("customer_profile_config", {}) ?? {};
  res.json({ ...DEFAULT_CONFIG, ...cfg });
});

// ── PUT /bot/profile/config ───────────────────────────────────────────────────
router.put("/bot/profile/config", requireAuth, async (req: any, res: any) => {
  const existing = readJson("customer_profile_config", {}) ?? {};
  const merged   = { ...DEFAULT_CONFIG, ...existing, ...req.body };
  await writeJson("customer_profile_config", merged);
  res.json(merged);
});

// ── GET /bot/profile/admin-stats ──────────────────────────────────────────────
router.get("/bot/profile/admin-stats", requireAuth, (_req: any, res: any) => {
  const checkinRecords: any = readJson("checkin_records", {}) ?? {};
  const prefs: any          = readJson("customer_preferences", {}) ?? {};

  const entries = Object.values(checkinRecords) as any[];
  const usersWithCheckin = entries.length;
  const totalPoints = entries.reduce((s: number, r: any) => s + (r.total_points ?? 0), 0);
  const topStreak   = entries.reduce((m: number, r: any) => Math.max(m, r.streak ?? 0), 0);
  const checkedToday = entries.filter((r: any) => r.last_checkin === new Date().toISOString().slice(0, 10)).length;
  const usersWithPrefs = Object.keys(prefs).length;

  res.json({ usersWithCheckin, totalPoints, topStreak, checkedToday, usersWithPrefs });
});

// ── Helper: find orders linked to a telegram userId ───────────────────────────
function getLinkedOrders(userIdStr: string, username: string): [string, any][] {
  const orders: any = readJson("orders", {}) ?? {};
  const uname = (username || "").replace(/^@/, "").toLowerCase();
  const result: [string, any][] = [];
  for (const [oid, o] of Object.entries(orders) as [string, any][]) {
    const tid = String(o.telegramId ?? o.telegram_id ?? o.userId ?? "");
    if (tid && tid === userIdStr) { result.push([oid, o]); continue; }
    if (uname) {
      const tu = (o.telegramUsername ?? o.telegram_username ?? "").replace(/^@/, "").toLowerCase();
      if (tu && tu === uname) { result.push([oid, o]); }
    }
  }
  return result;
}

// ── GET /bot/profile/:userId/summary ─────────────────────────────────────────
router.get("/bot/profile/:userId/summary", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const username   = String(req.query.username ?? "");

  const checkinRec: any = (readJson("checkin_records", {}) ?? {})[userId] ?? {};
  const linked    = getLinkedOrders(userId, username);
  const warranty: any[] = readJson("warranty_requests", []) ?? [];
  const orderIds  = new Set(linked.map(([oid]) => oid));

  const activeWarranty = warranty.filter(
    (r: any) => orderIds.has(r.orderId) && ["pending", "processing"].includes(r.status)
  ).length;

  const refundedCount = linked.filter(([, o]) => o.status === "refunded").length;

  // Count gift claims
  const claimed: any = readJson("claimed_users", {}) ?? {};
  let giftCount = 0;
  for (const roundData of Object.values(claimed) as any[]) {
    if (typeof roundData === "object" && roundData[userId]) giftCount++;
  }

  res.json({
    points:        checkinRec.total_points   ?? 0,
    streak:        checkinRec.streak         ?? 0,
    lastCheckin:   checkinRec.last_checkin   ?? null,
    totalCheckins: checkinRec.total_checkins ?? 0,
    orderCount:    linked.length,
    activeWarranty,
    refundedCount,
    giftCount,
  });
});

// ── GET /bot/profile/:userId/orders ──────────────────────────────────────────
router.get("/bot/profile/:userId/orders", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const username   = String(req.query.username ?? "");
  const page       = Math.max(1, Number(req.query.page ?? 1));
  const limit      = Math.min(Number(req.query.limit ?? 10), 50);

  const linked = getLinkedOrders(userId, username)
    .sort(([, a], [, b]) => (b.purchaseDate ?? "").localeCompare(a.purchaseDate ?? ""));

  const total = linked.length;
  const items = linked.slice((page - 1) * limit, page * limit).map(([oid, o]) => ({
    orderId:     oid,
    productName: o.productName ?? "",
    purchaseDate: (o.purchaseDate ?? "").slice(0, 10),
    status:      o.status      ?? "active",
    price:       o.price       ?? 0,
  }));

  res.json({ total, page, limit, items });
});

// ── GET /bot/profile/:userId/points ──────────────────────────────────────────
router.get("/bot/profile/:userId/points", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const rec: any = (readJson("checkin_records", {}) ?? {})[userId] ?? {};
  res.json({
    points:        rec.total_points   ?? 0,
    streak:        rec.streak         ?? 0,
    lastCheckin:   rec.last_checkin   ?? null,
    totalCheckins: rec.total_checkins ?? 0,
  });
});

// ── GET /bot/profile/:userId/activity ────────────────────────────────────────
router.get("/bot/profile/:userId/activity", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const username   = String(req.query.username ?? "");
  const page       = Math.max(1, Number(req.query.page ?? 1));
  const limit      = Math.min(Number(req.query.limit ?? 10), 50);

  const linked    = getLinkedOrders(userId, username);
  const orderIds  = new Set(linked.map(([oid]) => oid));
  const activities: any[] = [];

  // Check-in
  const rec: any = (readJson("checkin_records", {}) ?? {})[userId];
  if (rec?.last_checkin) {
    activities.push({
      time: rec.last_checkin + "T00:00:00",
      icon: "🔥",
      type: "checkin",
      desc: `Điểm danh — chuỗi ${rec.streak ?? 0} ngày, ${rec.total_points ?? 0} điểm`,
    });
  }

  // Gifts
  const claimed: any = readJson("claimed_users", {}) ?? {};
  for (const [roundId, roundData] of Object.entries(claimed) as [string, any][]) {
    if (typeof roundData === "object" && roundData[userId]) {
      const entry = roundData[userId];
      activities.push({
        time: entry.claim_time ?? "",
        icon: "🎁",
        type: "gift",
        desc: `Nhận quà đợt ${roundId}`,
      });
    }
  }

  // Warranty requests
  const warranty: any[] = readJson("warranty_requests", []) ?? [];
  for (const r of warranty) {
    if (!orderIds.has(r.orderId)) continue;
    activities.push({
      time: r.submittedAt ?? r.createdAt ?? "",
      icon: "🛡",
      type: "warranty",
      desc: `Yêu cầu BH đơn ${(r.orderId ?? "").slice(0, 8)}... — ${r.status ?? ""}`,
    });
  }

  // Refund history
  const refunds: any[] = readJson("refund_history", []) ?? [];
  for (const r of refunds) {
    if (!orderIds.has(r.orderId)) continue;
    activities.push({
      time: r.refundedAt ?? "",
      icon: "💰",
      type: "refund",
      desc: `Hoàn tiền đơn ${(r.orderId ?? "").slice(0, 8)}...`,
    });
  }

  activities.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));

  const total = activities.length;
  const items = activities.slice((page - 1) * limit, page * limit);
  res.json({ total, page, limit, items });
});

// ── GET /bot/profile/:userId/preferences ─────────────────────────────────────
router.get("/bot/profile/:userId/preferences", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const prefs: any = readJson("customer_preferences", {}) ?? {};
  const defaults = { notifNewGift: true, notifWarrantyUpdate: true, notifRefundResult: true, notifPromotion: false };
  res.json({ ...defaults, ...(prefs[userId] ?? {}) });
});

// ── PUT /bot/profile/:userId/preferences ─────────────────────────────────────
router.put("/bot/profile/:userId/preferences", requireAuth, async (req: any, res: any) => {
  const { userId } = req.params;
  const allowed = new Set(["notifNewGift", "notifWarrantyUpdate", "notifRefundResult", "notifPromotion"]);
  const updates: any = {};
  for (const [k, v] of Object.entries(req.body ?? {})) {
    if (allowed.has(k)) updates[k] = Boolean(v);
  }
  const prefs: any = readJson("customer_preferences", {}) ?? {};
  prefs[userId] = { ...(prefs[userId] ?? {}), ...updates };
  await writeJson("customer_preferences", prefs);
  res.json(prefs[userId]);
});

export default router;
