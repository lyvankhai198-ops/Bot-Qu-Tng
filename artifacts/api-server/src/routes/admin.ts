import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../lib/auth";
import {
  readJson, writeJson, addLog, normalizeAccount, now, readSettings,
} from "../lib/dataUtils";

const router = Router();

// ── GET /bot/pending-counts ───────────────────────────────────────────────────
router.get("/bot/pending-counts", requireAuth, (_req: any, res: any) => {
  const warranty:   any[] = readJson("warranty_requests", []) ?? [];
  const delivery:   any[] = readJson("delivery_requests", []) ?? [];
  const syncStatus: any   = readJson("sync_robot_status", {}) ?? {};
  res.json({
    delivery:   delivery.filter((r: any) => r.status === "pending").length,
    warranty:   warranty.filter((w: any) => ["pending", "processing"].includes(w.status)).length,
    syncRobot:  Number(syncStatus?.last_run?.errors ?? 0),
  });
});

// ── GET /bot/stats ────────────────────────────────────────────────────────────
router.get("/bot/stats", requireAuth, (_req: any, res: any) => {
  const s = readSettings();
  const users:    any   = readJson("users",    {}) ?? {};
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const banned:   string[] = readJson("banned_users", []) ?? [];
  const claimed:  any   = readJson("claimed_users", {}) ?? {};
  const orders:   any   = readJson("orders",   {}) ?? {};
  const warranty: any[] = readJson("warranty_requests", []) ?? [];
  const roundClaims = claimed[s.round_id] ?? {};
  const stock = accounts.filter((a: any) => a.status === "available").length;
  const ns: any = readJson("notification_settings", {}) ?? {};
  const urgentMinutes: number = ns.urgentMinutes ?? 30;
  const nowMs = Date.now();
  res.json({
    totalUsers:         Object.keys(users).length,
    stock,
    claimed:            Object.keys(roundClaims).length,
    banned:             banned.length,
    roundId:            s.round_id,
    totalOrders:        Object.keys(orders).length,
    warrantyPending:    warranty.filter((w: any) => w.status === "pending").length,
    warrantyProcessing: warranty.filter((w: any) => w.status === "processing").length,
    warrantyResolved:   warranty.filter((w: any) => ["resolved", "send_failed"].includes(w.status)).length,
    warrantyRejected:   warranty.filter((w: any) => w.status === "rejected").length,
    warrantyOverdue:    warranty.filter((w: any) => {
      if (!["pending", "processing"].includes(w.status)) return false;
      if (w.acknowledgedAt) return false;
      return (nowMs - new Date(w.submittedAt).getTime()) / 60000 > urgentMinutes;
    }).length,
  });
});

// ── GET /bot/users ────────────────────────────────────────────────────────────
router.get("/bot/users", requireAuth, (_req: any, res: any) => {
  const users: any = readJson("users", {}) ?? {};
  res.json(Object.entries(users).map(([uid, u]: [string, any]) => ({
    userId: uid, username: u.username ?? "", firstName: u.first_name ?? "",
    startedAt: u.started_at ?? "", lastActive: u.last_active ?? "",
    usageCount: u.usage_count ?? 0, hasReceivedGift: u.has_received_gift ?? false,
    giftReceived: u.gift_received ?? null, banned: u.banned ?? false,
  })));
});

// ── POST /bot/users/:userId/ban ───────────────────────────────────────────────
router.post("/bot/users/:userId/ban", requireAuth, async (req: any, res: any) => {
  const uid = req.params.userId;
  const banned: string[] = readJson("banned_users", []) ?? [];
  if (!banned.includes(uid)) banned.push(uid);
  await writeJson("banned_users", banned);
  const users: any = readJson("users", {}) ?? {};
  if (users[uid]) { users[uid].banned = true; await writeJson("users", users); }
  addLog("BAN", uid, "web-admin").catch(() => {});
  res.json({ ok: true, message: `Đã chặn ${uid}` });
});

// ── POST /bot/users/:userId/unban ─────────────────────────────────────────────
router.post("/bot/users/:userId/unban", requireAuth, async (req: any, res: any) => {
  const uid = req.params.userId;
  const banned: string[] = (readJson("banned_users", []) ?? []).filter((b: string) => b !== uid);
  await writeJson("banned_users", banned);
  const users: any = readJson("users", {}) ?? {};
  if (users[uid]) { users[uid].banned = false; await writeJson("users", users); }
  addLog("UNBAN", uid, "web-admin").catch(() => {});
  res.json({ ok: true, message: `Đã bỏ chặn ${uid}` });
});

// ── POST /bot/users/:userId/reset-gift ───────────────────────────────────────
router.post("/bot/users/:userId/reset-gift", requireAuth, async (req: any, res: any) => {
  const uid = req.params.userId;
  const users: any = readJson("users", {}) ?? {};
  if (!users[uid]) { res.status(404).json({ ok: false, message: "User không tồn tại" }); return; }
  users[uid].has_received_gift = false;
  users[uid].gift_received = null;
  await writeJson("users", users);
  addLog("RESET_GIFT", uid, "web-admin").catch(() => {});
  res.json({ ok: true, message: `Đã reset quà cho ${uid}` });
});

// ── GET /bot/logs ─────────────────────────────────────────────────────────────
router.get("/bot/logs", requireAuth, (req: any, res: any) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const logs: any[] = readJson("logs", []) ?? [];
  res.json(logs.slice(-limit).reverse());
});

// ── GET /bot/receivers ────────────────────────────────────────────────────────
router.get("/bot/receivers", requireAuth, (_req: any, res: any) => {
  const s = readSettings();
  const claimed: any = readJson("claimed_users", {}) ?? {};
  const roundClaims = claimed[s.round_id] ?? {};
  res.json(Object.values(roundClaims).map((r: any) => ({
    userId: String(r.user_id ?? ""), username: r.username ?? "", firstName: r.first_name ?? "",
    claimTime: r.claim_time ?? "", accountEmail: r.account_email ?? "", roundId: r.round_id ?? s.round_id,
  })));
});

// ── POST /bot/broadcast ───────────────────────────────────────────────────────
router.post("/bot/broadcast", requireAuth, async (req: any, res: any) => {
  const { message, target = "all" } = req.body ?? {};
  if (!message) { res.status(400).json({ ok: false, message: "message là bắt buộc" }); return; }
  const pending: any[] = readJson("pending_broadcasts", []) ?? [];
  pending.push({ message, target, queued_at: now() });
  await writeJson("pending_broadcasts", pending);
  addLog("QUEUE_BROADCAST", `target=${target}`, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã thêm vào hàng đợi" });
});

// ── POST /bot/round ───────────────────────────────────────────────────────────
router.post("/bot/round", requireAuth, async (req: any, res: any) => {
  const { roundId } = req.body ?? {};
  if (!roundId) { res.status(400).json({ ok: false, message: "roundId là bắt buộc" }); return; }
  const s = readJson("settings", {}) ?? {};
  const oldRound = s.round_id ?? "dot1";
  s.round_id = roundId;
  await writeJson("settings", s);
  const claimed: any = readJson("claimed_users", {}) ?? {};
  delete claimed[oldRound];
  await writeJson("claimed_users", claimed);
  addLog("NEW_ROUND", roundId, "web-admin").catch(() => {});
  res.json({ ok: true, message: `Đã mở đợt mới: ${roundId}` });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GIFT BOXES
// ═══════════════════════════════════════════════════════════════════════════════

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
  return assigned.map((prizeId, index) => ({ index, prizeId, opened: false, openedBy: null, openedByName: null, openedAt: null }));
}

function reassignBoxPrizes(totalBoxes: number, prizes: any[], existing: any[]): any[] {
  return assignBoxPrizes(totalBoxes, prizes).map((nb, i) => (existing?.[i]?.opened ? existing[i] : nb));
}

router.get("/bot/gift-boxes", requireAuth, (_req: any, res: any) => {
  res.json(readJson("gift_boxes", []) ?? []);
});

router.post("/bot/gift-boxes", requireAuth, async (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const body = req.body ?? {};
  const prizes: any[] = Array.isArray(body.prizes) ? body.prizes.map((p: any, i: number) => ({ ...p, id: p.id ?? `p_${Date.now()}_${i}` })) : [];
  const totalBoxes = Number(body.totalBoxes) || 25;
  const newEvent = {
    id: `gb_${Date.now()}`, name: body.name || "Sự kiện mới", enabled: false,
    startTime: body.startTime ?? "", endTime: body.endTime ?? "", totalBoxes,
    maxPicksPerUser: Number(body.maxPicksPerUser) || 1,
    membersOnly: body.membersOnly ?? false, buyersOnly: body.buyersOnly ?? false,
    prizes, boxes: assignBoxPrizes(totalBoxes, prizes), createdAt: now(),
  };
  events.push(newEvent);
  await writeJson("gift_boxes", events);
  addLog("GIFT_BOX_CREATE", `name=${newEvent.name} boxes=${totalBoxes}`, "web-admin").catch(() => {});
  res.json(newEvent);
});

router.put("/bot/gift-boxes/:id", requireAuth, async (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const idx = events.findIndex((e: any) => e.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const old = events[idx];
  const newTotal = body.totalBoxes != null ? Number(body.totalBoxes) : old.totalBoxes;
  const newPrizes: any[] = Array.isArray(body.prizes) ? body.prizes.map((p: any, i: number) => ({ ...p, id: p.id ?? `p_${Date.now()}_${i}` })) : old.prizes;
  const needsReassign = body.prizes != null || (body.totalBoxes != null && body.totalBoxes !== old.totalBoxes);
  const boxes = needsReassign ? reassignBoxPrizes(newTotal, newPrizes, old.boxes) : old.boxes;
  events[idx] = { ...old, ...body, id: req.params.id, prizes: newPrizes, boxes, totalBoxes: newTotal };
  await writeJson("gift_boxes", events);
  addLog("GIFT_BOX_UPDATE", `id=${req.params.id}`, "web-admin").catch(() => {});
  res.json(events[idx]);
});

router.delete("/bot/gift-boxes/:id", requireAuth, async (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  await writeJson("gift_boxes", events.filter((e: any) => e.id !== req.params.id));
  addLog("GIFT_BOX_DELETE", `id=${req.params.id}`, "web-admin").catch(() => {});
  res.json({ ok: true });
});

router.get("/bot/gift-boxes/:id/stats", requireAuth, (req: any, res: any) => {
  const events: any[] = readJson("gift_boxes", []) ?? [];
  const ev = events.find((e: any) => e.id === req.params.id);
  if (!ev) { res.status(404).json({ error: "Not found" }); return; }
  const boxes: any[] = ev.boxes ?? [];
  const prizeMap = Object.fromEntries((ev.prizes ?? []).map((p: any) => [p.id, p]));
  const openedBoxes = boxes.filter((b: any) => b.opened);
  res.json({
    totalBoxes: boxes.length, openedBoxes: openedBoxes.length,
    remainingBoxes: boxes.length - openedBoxes.length,
    participants: new Set(openedBoxes.map((b: any) => b.openedBy)).size,
    winners: openedBoxes.map((b: any) => ({ boxIndex: b.index, openedBy: b.openedBy, openedByName: b.openedByName, openedAt: b.openedAt, prize: prizeMap[b.prizeId] ?? null })),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECRET CODES
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/bot/secret-codes", requireAuth, (_req: any, res: any) => {
  res.json(readJson("secret_codes", []) ?? []);
});

router.post("/bot/secret-codes", requireAuth, async (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const body = req.body ?? {};
  const newCode = {
    id: `sc_${Date.now()}`, enabled: false,
    code: (body.code ?? "").toUpperCase().trim(),
    reward: body.reward ?? { type: "custom", label: "", value: "" },
    maxWinners: body.maxWinners ?? 0,
    startTime: body.startTime ?? "", endTime: body.endTime ?? "",
    membersOnly: body.membersOnly ?? false,
    onePerUser: body.onePerUser !== false,
    winMessage: body.winMessage ?? "🎉 Chúc mừng! Bạn nhận được:\n🎁 {reward}",
    exhaustedMessage: body.exhaustedMessage ?? "😔 Mã đã hết lượt nhận. Theo dõi bot để không bỏ lỡ sự kiện tiếp theo!",
    invalidMessage: body.invalidMessage ?? "❌ Mã không hợp lệ. Vui lòng kiểm tra lại.",
    createdAt: now(), winners: [],
  };
  codes.push(newCode);
  await writeJson("secret_codes", codes);
  addLog("SECRET_CODE_CREATE", `code=${newCode.code}`, "web-admin").catch(() => {});
  res.json(newCode);
});

router.put("/bot/secret-codes/:id", requireAuth, async (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const idx = codes.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  if (body.code) body.code = String(body.code).toUpperCase().trim();
  codes[idx] = { ...codes[idx], ...body, id: req.params.id, winners: codes[idx].winners ?? [] };
  await writeJson("secret_codes", codes);
  addLog("SECRET_CODE_UPDATE", `id=${req.params.id} code=${codes[idx].code}`, "web-admin").catch(() => {});
  res.json(codes[idx]);
});

router.delete("/bot/secret-codes/:id", requireAuth, async (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const target = codes.find((c: any) => c.id === req.params.id);
  await writeJson("secret_codes", codes.filter((c: any) => c.id !== req.params.id));
  addLog("SECRET_CODE_DELETE", `id=${req.params.id} code=${target?.code ?? "?"}`, "web-admin").catch(() => {});
  res.json({ ok: true });
});

router.get("/bot/secret-codes/:id/winners", requireAuth, (req: any, res: any) => {
  const codes: any[] = readJson("secret_codes", []) ?? [];
  const code = codes.find((c: any) => c.id === req.params.id);
  if (!code) { res.status(404).json({ error: "Not found" }); return; }
  res.json(code.winners ?? []);
});

// ═══════════════════════════════════════════════════════════════════════════════
// BACKUP / RESET
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/bot/backup", requireAuth, (_req: any, res: any) => {
  const files = ["users", "accounts", "settings", "claimed_users", "banned_users", "logs", "orders", "warranty_requests", "intro", "pending_broadcasts"];
  const backup: any = { exportedAt: now() };
  for (const f of files) backup[f] = readJson(f, null);
  res.setHeader("Content-Disposition", `attachment; filename="backup-${Date.now()}.json"`);
  res.json(backup);
});

router.post("/bot/reset-data", requireAuth, async (_req: any, res: any) => {
  try {
    const resetList: Array<{ name: string; empty: unknown }> = [
      { name: "orders", empty: [] }, { name: "order_items", empty: [] },
      { name: "users", empty: {} }, { name: "logs", empty: [] },
      { name: "warranty_requests", empty: [] }, { name: "delivery_requests", empty: [] },
      { name: "pending_broadcasts", empty: [] }, { name: "account_replacements", empty: [] },
      { name: "claimed_users", empty: {} }, { name: "banned_users", empty: [] },
      { name: "refund_history", empty: [] }, { name: "notification_logs", empty: [] },
      { name: "user_states", empty: {} }, { name: "user_channel_memberships", empty: {} },
      { name: "rate_limits", empty: {} }, { name: "rate_violations", empty: [] },
      { name: "sync_robot_logs", empty: [] }, { name: "sync_robot_status", empty: {} },
      { name: "sync_watch_state", empty: {} }, { name: "sync_robot_trigger", empty: {} },
      { name: "health_jobs", empty: [] }, { name: "order_health", empty: [] },
      { name: "account_health", empty: [] }, { name: "checkin_records", empty: [] },
      { name: "checkin_logs", empty: [] }, { name: "gift_box_invites", empty: [] },
      { name: "gift_box_link_map", empty: {} }, { name: "accounts", empty: [] },
      { name: "settings", empty: {} }, { name: "intro", empty: {} },
      { name: "gift_boxes", empty: [] }, { name: "secret_codes", empty: [] },
      { name: "required_channels", empty: [] }, { name: "shop_channels", empty: [] },
      { name: "gift_shop_channels", empty: [] }, { name: "checkin_settings", empty: {} },
      { name: "notification_settings", empty: {} }, { name: "sync_robot_config", empty: {} },
      { name: "stock_notify_settings", empty: {} },
    ];
    const cleared: string[] = [];
    for (const { name, empty } of resetList) {
      try { await writeJson(name, empty); cleared.push(name); } catch {}
    }
    addLog("system", "reset_data", `Đã xoá sạch ${cleared.length} file dữ liệu vận hành`).catch(() => {});
    res.json({ ok: true, cleared });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
