import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  readJson, writeJson, addLog, now,
  readSettings, settingsToApi, DATA_DIR,
} from "../lib/dataUtils";
import { TG_TOKEN } from "../lib/telegram";

const router = Router();

// ── GET /bot/notification-settings ───────────────────────────────────────────
router.get("/bot/notification-settings", requireAuth, (_req: any, res: any) => {
  const defaults = { enabled: true, adminIds: [] as string[], reminderEnabled: true, reminder1Minutes: 5, reminder2Minutes: 15, urgentMinutes: 30 };
  const stored = readJson("notification_settings", {}) ?? {};
  res.json({ ...defaults, ...stored });
});

// ── PUT /bot/notification-settings ───────────────────────────────────────────
router.put("/bot/notification-settings", requireAuth, async (req: any, res: any) => {
  const current = readJson("notification_settings", {}) ?? {};
  const updated = { ...current, ...req.body };
  await writeJson("notification_settings", updated);
  addLog("NOTIF_SETTINGS_UPDATE", JSON.stringify(updated).slice(0, 120), "web-admin").catch(() => {});
  res.json(updated);
});

// ── GET /bot/settings ─────────────────────────────────────────────────────────
router.get("/bot/settings", requireAuth, (_req: any, res: any) => {
  res.json(settingsToApi(readSettings()));
});

// ── PUT /bot/settings ─────────────────────────────────────────────────────────
router.put("/bot/settings", requireAuth, async (req: any, res: any) => {
  const s = readJson("settings", {}) ?? {};
  const b = req.body ?? {};
  const map: Record<string, string> = {
    shopLink: "shop_link", shopUsername: "shop_username", supportUsername: "support_username",
    cooldownHours: "cooldown_hours", roundId: "round_id",
    giftEnabled: "gift_enabled", supportEnabled: "support_enabled", introEnabled: "intro_enabled",
    maintenanceMode: "maintenance_mode", refundFormula: "refund_formula",
    refundCustomText: "refund_custom_text", requireChannelCheck: "require_channel_check",
  };
  for (const [k, v] of Object.entries(map)) {
    if (b[k] !== undefined) s[v] = k === "cooldownHours" ? Number(b[k]) : b[k];
  }
  await writeJson("settings", s);
  addLog("UPDATE_SETTINGS", "", "web-admin").catch(() => {});
  res.json(settingsToApi({ ...readSettings(), ...s }));
});

// ── GET /bot/stock-notify-settings ───────────────────────────────────────────
router.get("/bot/stock-notify-settings", requireAuth, (_req: any, res: any) => {
  const defaults = { enabled: true, message: "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!", target: "no_received" };
  const stored = readJson("stock_notify_settings", {}) ?? {};
  res.json({ ...defaults, ...stored });
});

// ── PUT /bot/stock-notify-settings ───────────────────────────────────────────
router.put("/bot/stock-notify-settings", requireAuth, async (req: any, res: any) => {
  const defaults = { enabled: true, message: "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!", target: "no_received" };
  const stored = readJson("stock_notify_settings", {}) ?? {};
  const updated = { ...defaults, ...stored, ...req.body };
  await writeJson("stock_notify_settings", updated);
  addLog("STOCK_NOTIFY_SETTINGS_UPDATE", "", "web-admin").catch(() => {});
  res.json(updated);
});

// ── GET /bot/intro ────────────────────────────────────────────────────────────
router.get("/bot/intro", requireAuth, (_req: any, res: any) => {
  const defaults = { title: "Giới thiệu", content: "", titleEn: "Introduction", contentEn: "", photoUrl: "", videoUrl: "", buttons: [] };
  res.json({ ...defaults, ...(readJson("intro", {}) ?? {}) });
});

// ── PUT /bot/intro ────────────────────────────────────────────────────────────
router.put("/bot/intro", requireAuth, async (req: any, res: any) => {
  await writeJson("intro", req.body ?? {});
  addLog("UPDATE_INTRO", "", "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã cập nhật giới thiệu" });
});

// ── GET /bot/required-channels ────────────────────────────────────────────────
router.get("/bot/required-channels", requireAuth, (_req: any, res: any) => {
  res.json(readJson("required_channels", []) ?? []);
});

// ── PUT /bot/required-channels ────────────────────────────────────────────────
router.put("/bot/required-channels", requireAuth, async (req: any, res: any) => {
  const channels = Array.isArray(req.body) ? req.body : [];
  await writeJson("required_channels", channels);
  addLog("UPDATE_REQUIRED_CHANNELS", `${channels.length} channel(s)`, "web-admin").catch(() => {});
  res.json(channels);
});

// ── GET /bot/shop-channels ────────────────────────────────────────────────────
router.get("/bot/shop-channels", requireAuth, (_req: any, res: any) => {
  const channels: any[] = (readJson("shop_channels", []) ?? []);
  channels.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
  res.json(channels);
});

// ── POST /bot/shop-channels ───────────────────────────────────────────────────
router.post("/bot/shop-channels", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const { name, username, link, icon, enabled } = req.body ?? {};
  if (!name?.trim() || !link?.trim()) { res.status(400).json({ error: "name và link là bắt buộc" }); return; }
  const maxOrder = channels.reduce((m: number, c: any) => Math.max(m, c.order ?? 0), 0);
  const ch = { id: Date.now().toString(), name: name.trim(), username: username?.trim() ?? "", link: link.trim(), icon: icon?.trim() || "🛒", order: maxOrder + 1, enabled: enabled !== false };
  channels.push(ch);
  await writeJson("shop_channels", channels);
  addLog("SHOP_CHANNEL_ADD", ch.name, "web-admin").catch(() => {});
  res.json(ch);
});

// ── PUT /bot/shop-channels/reorder ────────────────────────────────────────────
router.put("/bot/shop-channels/reorder", requireAuth, async (req: any, res: any) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids array required" }); return; }
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const ordered = ids.map((id: string, idx: number) => {
    const ch = channels.find((c: any) => c.id === id);
    return ch ? { ...ch, order: idx + 1 } : null;
  }).filter(Boolean);
  await writeJson("shop_channels", ordered);
  res.json(ordered);
});

// ── PUT /bot/shop-channels/:id ────────────────────────────────────────────────
router.put("/bot/shop-channels/:id", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const idx = channels.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Không tìm thấy kênh" }); return; }
  channels[idx] = { ...channels[idx], ...req.body, id: req.params.id };
  await writeJson("shop_channels", channels);
  addLog("SHOP_CHANNEL_UPDATE", channels[idx].name, "web-admin").catch(() => {});
  res.json(channels[idx]);
});

// ── DELETE /bot/shop-channels/:id ─────────────────────────────────────────────
router.delete("/bot/shop-channels/:id", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("shop_channels", []) ?? [];
  const ch = channels.find((c: any) => c.id === req.params.id);
  if (!ch) { res.status(404).json({ error: "Không tìm thấy kênh" }); return; }
  const updated = channels.filter((c: any) => c.id !== req.params.id);
  await writeJson("shop_channels", updated);
  addLog("SHOP_CHANNEL_DELETE", ch.name, "web-admin").catch(() => {});
  res.json({ ok: true });
});

// ── GET /bot/gift-shop-channels ───────────────────────────────────────────────
router.get("/bot/gift-shop-channels", requireAuth, (_req: any, res: any) => {
  const channels: any[] = (readJson("gift_shop_channels", []) ?? []);
  channels.sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999));
  res.json(channels);
});

// ── POST /bot/gift-shop-channels ──────────────────────────────────────────────
router.post("/bot/gift-shop-channels", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const { name, username, link, icon, enabled } = req.body ?? {};
  if (!name?.trim() || !link?.trim()) { res.status(400).json({ error: "name và link là bắt buộc" }); return; }
  const maxOrder = channels.reduce((m: number, c: any) => Math.max(m, c.order ?? 0), 0);
  const ch = { id: Date.now().toString(), name: name.trim(), username: username?.trim() ?? "", link: link.trim(), icon: icon?.trim() || "🛍️", order: maxOrder + 1, enabled: enabled !== false };
  channels.push(ch);
  await writeJson("gift_shop_channels", channels);
  addLog("GIFT_SHOP_CHANNEL_ADD", ch.name, "web-admin").catch(() => {});
  res.json(ch);
});

// ── PUT /bot/gift-shop-channels/reorder ───────────────────────────────────────
router.put("/bot/gift-shop-channels/reorder", requireAuth, async (req: any, res: any) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids)) { res.status(400).json({ error: "ids array required" }); return; }
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const ordered = ids.map((id: string, idx: number) => {
    const ch = channels.find((c: any) => c.id === id);
    return ch ? { ...ch, order: idx + 1 } : null;
  }).filter(Boolean);
  await writeJson("gift_shop_channels", ordered);
  res.json(ordered);
});

// ── PUT /bot/gift-shop-channels/:id ───────────────────────────────────────────
router.put("/bot/gift-shop-channels/:id", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const idx = channels.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Không tìm thấy kênh" }); return; }
  channels[idx] = { ...channels[idx], ...req.body, id: req.params.id };
  await writeJson("gift_shop_channels", channels);
  addLog("GIFT_SHOP_CHANNEL_UPDATE", channels[idx].name, "web-admin").catch(() => {});
  res.json(channels[idx]);
});

// ── DELETE /bot/gift-shop-channels/:id ────────────────────────────────────────
router.delete("/bot/gift-shop-channels/:id", requireAuth, async (req: any, res: any) => {
  const channels: any[] = readJson("gift_shop_channels", []) ?? [];
  const ch = channels.find((c: any) => c.id === req.params.id);
  if (!ch) { res.status(404).json({ error: "Không tìm thấy kênh" }); return; }
  await writeJson("gift_shop_channels", channels.filter((c: any) => c.id !== req.params.id));
  addLog("GIFT_SHOP_CHANNEL_DELETE", ch.name, "web-admin").catch(() => {});
  res.json({ ok: true });
});

// ── GET /bot/check-channel/:channelId ─────────────────────────────────────────
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
    res.json({ ok: true, canAccess: true, chatId: String(chat?.id ?? ""), title: chat?.title ?? null, username: chat?.username ? `@${chat.username}` : null, type: chat?.type ?? null, botStatus, isAdmin, getChatMemberWorks: isAdmin });
  } catch (e: any) { res.json({ ok: false, canAccess: false, error: e?.message ?? "Network error" }); }
});

// ── GET /bot/checkin/settings ─────────────────────────────────────────────────
const CHECKIN_SETTINGS_DEFAULTS = {
  enabled: true, hour: 7, minute: 0, timezone: "Asia/Ho_Chi_Minh",
  points_per_day: 10, streak_bonuses: [{ days: 7, bonus_points: 20 }, { days: 30, bonus_points: 100 }],
};
function readCheckinSettings(): any {
  return { ...CHECKIN_SETTINGS_DEFAULTS, ...(readJson("checkin_settings", {}) ?? {}) };
}
router.get("/bot/checkin/settings", requireAuth, (_req: any, res: any) => {
  res.json(readCheckinSettings());
});

// ── PUT /bot/checkin/settings ─────────────────────────────────────────────────
router.put("/bot/checkin/settings", requireAuth, async (req: any, res: any) => {
  const body = req.body ?? {};
  const current = readCheckinSettings();
  const updated = {
    ...current,
    enabled:        typeof body.enabled === "boolean"  ? body.enabled        : current.enabled,
    hour:           body.hour           != null         ? Number(body.hour)   : current.hour,
    minute:         body.minute         != null         ? Number(body.minute) : current.minute,
    timezone:       typeof body.timezone === "string"   ? body.timezone       : current.timezone,
    points_per_day: body.points_per_day != null         ? Number(body.points_per_day) : current.points_per_day,
    streak_bonuses: Array.isArray(body.streak_bonuses)  ? body.streak_bonuses : current.streak_bonuses,
  };
  await writeJson("checkin_settings", updated);
  addLog("CHECKIN_SETTINGS_UPDATE", "", "web-admin").catch(() => {});
  res.json(updated);
});

// ── GET /bot/checkin/stats ────────────────────────────────────────────────────
router.get("/bot/checkin/stats", requireAuth, (_req: any, res: any) => {
  const records: any = readJson("checkin_records", {}) ?? {};
  const users:   any = readJson("users",           {}) ?? {};
  const logs:    any = readJson("checkin_logs",    {}) ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = logs[today] ?? {};
  let checkedInToday = 0, longestStreak = 0;
  for (const rec of Object.values(records) as any[]) {
    if (rec.last_checkin === today) checkedInToday++;
    if ((rec.streak ?? 0) > longestStreak) longestStreak = rec.streak;
  }
  const totalUsers = Object.keys(users).length;
  res.json({
    today, checkedInToday, notCheckedInToday: totalUsers - checkedInToday, longestStreak,
    totalPointsToday: todayLog.total_points_distributed ?? 0,
    notifSent: todayLog.sent ?? 0, notifFailed: todayLog.failed ?? 0,
    triggeredAt: todayLog.triggered_at ?? null,
    totalUsersWithRecords: Object.keys(records).length,
  });
});

// ── GET /bot/checkin/records ──────────────────────────────────────────────────
router.get("/bot/checkin/records", requireAuth, (_req: any, res: any) => {
  const records: any = readJson("checkin_records", {}) ?? {};
  const users:   any = readJson("users",           {}) ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const list = Object.entries(records).map(([uid, rec]: [string, any]) => {
    const user = users[uid] ?? {};
    return {
      userId: rec.user_id ?? uid, username: user.username ?? "",
      firstName: user.firstName ?? user.first_name ?? "",
      lastCheckin: rec.last_checkin ?? "", streak: rec.streak ?? 0,
      totalPoints: rec.total_points ?? 0, totalCheckins: rec.total_checkins ?? 0,
      checkedInToday: rec.last_checkin === today,
    };
  });
  list.sort((a, b) => b.totalPoints - a.totalPoints);
  res.json(list);
});

// ── POST /bot/checkin/trigger ─────────────────────────────────────────────────
router.post("/bot/checkin/trigger", requireAuth, async (_req: any, res: any) => {
  const pending: any[] = readJson("pending_broadcasts", []) ?? [];
  pending.push({ id: `checkin_${Date.now()}`, message: "__CHECKIN_NOTIFICATION__", target: "checkin_notify", createdAt: now() });
  await writeJson("pending_broadcasts", pending);
  addLog("CHECKIN_TRIGGER_MANUAL", "", "web-admin").catch(() => {});
  res.json({ ok: true, message: "Checkin notification queued" });
});

// ── GET /bot/delivery-reminder-settings ───────────────────────────────────────
const DELIVERY_REMINDER_DEFAULTS = { enabled: true, reminderMinutes: [10, 30, 60] };
router.get("/bot/delivery-reminder-settings", requireAuth, (_req: any, res: any) => {
  const stored = readJson("delivery_reminder_settings", {}) ?? {};
  res.json({ ...DELIVERY_REMINDER_DEFAULTS, ...stored });
});

// ── PUT /bot/delivery-reminder-settings ───────────────────────────────────────
router.put("/bot/delivery-reminder-settings", requireAuth, async (req: any, res: any) => {
  const stored = readJson("delivery_reminder_settings", {}) ?? {};
  const body = req.body ?? {};
  const updated: any = { ...DELIVERY_REMINDER_DEFAULTS, ...stored };
  if (typeof body.enabled === "boolean") updated.enabled = body.enabled;
  if (Array.isArray(body.reminderMinutes)) {
    const mins = body.reminderMinutes.map((v: any) => parseInt(v, 10)).filter((v: number) => !isNaN(v) && v > 0).sort((a: number, b: number) => a - b);
    if (mins.length > 0) updated.reminderMinutes = mins;
  }
  await writeJson("delivery_reminder_settings", updated);
  addLog("DELIVERY_REMINDER_SETTINGS_UPDATE", JSON.stringify(updated).slice(0, 120), "web-admin").catch(() => {});
  res.json(updated);
});

export default router;
