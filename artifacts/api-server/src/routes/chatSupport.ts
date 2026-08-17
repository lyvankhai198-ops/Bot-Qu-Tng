import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson } from "../lib/dataUtils";

const router = Router();

const CHAT_HISTORY_FILE  = "support_chat_history";
const CHAT_SETTINGS_FILE = "support_chat_settings";
const CHAT_SESSIONS_FILE = "support_chat_sessions";
const CHAT_BANNED_FILE   = "support_chat_banned";
const CHAT_ADMINS_FILE   = "support_chat_admins";

const DEFAULT_SETTINGS = {
  timeoutMinutes:     10,
  deleteDelayMinutes:  5,
  spamMaxMsgs:        10,
  spamWindowSec:      60,
  spamWarnAt:          8,
  sessionCooldownSec: 120,
};

// ── GET /bot/chat-support/history ─────────────────────────────────────────────
router.get("/bot/chat-support/history", requireAuth, (req: any, res: any) => {
  const limit  = Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 500);
  const search = String(req.query.search ?? "").toLowerCase().trim();
  const raw: any[] = readJson(CHAT_HISTORY_FILE, []) ?? [];
  let list = raw.slice().reverse();
  if (search) {
    list = list.filter((e: any) =>
      String(e.userId ?? "").includes(search) ||
      (e.username  ?? "").toLowerCase().includes(search) ||
      (e.firstName ?? "").toLowerCase().includes(search)
    );
  }
  res.json(list.slice(0, limit));
});

// ── DELETE /bot/chat-support/history/:uid/:startedAt ─────────────────────────
router.delete("/bot/chat-support/history/:uid/:startedAt", requireAuth, async (req: any, res: any) => {
  const { uid, startedAt } = req.params;
  const raw: any[] = readJson(CHAT_HISTORY_FILE, []) ?? [];
  const before = raw.length;
  const filtered = raw.filter(
    (e: any) => !(String(e.userId) === uid && e.startedAt === startedAt)
  );
  if (filtered.length === before) return res.status(404).json({ error: "Entry not found" });
  await writeJson(CHAT_HISTORY_FILE, filtered);
  res.json({ deleted: before - filtered.length });
});

// ── DELETE /bot/chat-support/history (xoá tất cả) ────────────────────────────
router.delete("/bot/chat-support/history", requireAuth, async (_req: any, res: any) => {
  await writeJson(CHAT_HISTORY_FILE, []);
  res.json({ deleted: true });
});

// ── GET /bot/chat-support/settings ────────────────────────────────────────────
router.get("/bot/chat-support/settings", requireAuth, (_req: any, res: any) => {
  const stored = readJson(CHAT_SETTINGS_FILE, {}) ?? {};
  res.json({ ...DEFAULT_SETTINGS, ...stored });
});

// ── PUT /bot/chat-support/settings ────────────────────────────────────────────
router.put("/bot/chat-support/settings", requireAuth, async (req: any, res: any) => {
  const stored  = readJson(CHAT_SETTINGS_FILE, {}) ?? {};
  const body    = req.body ?? {};
  const updated: any = { ...DEFAULT_SETTINGS, ...stored };

  if (typeof body.timeoutMinutes === "number" && body.timeoutMinutes >= 1 && body.timeoutMinutes <= 120)
    updated.timeoutMinutes = body.timeoutMinutes;
  if (typeof body.deleteDelayMinutes === "number" && body.deleteDelayMinutes >= 1 && body.deleteDelayMinutes <= 60)
    updated.deleteDelayMinutes = body.deleteDelayMinutes;
  if (typeof body.spamMaxMsgs === "number" && body.spamMaxMsgs >= 1 && body.spamMaxMsgs <= 100)
    updated.spamMaxMsgs = body.spamMaxMsgs;
  if (typeof body.spamWindowSec === "number" && body.spamWindowSec >= 10 && body.spamWindowSec <= 600)
    updated.spamWindowSec = body.spamWindowSec;
  if (typeof body.spamWarnAt === "number" && body.spamWarnAt >= 1) {
    const max = typeof body.spamMaxMsgs === "number" ? body.spamMaxMsgs : updated.spamMaxMsgs;
    updated.spamWarnAt = Math.min(body.spamWarnAt, max - 1);
  }
  if (typeof body.sessionCooldownSec === "number" && body.sessionCooldownSec >= 0 && body.sessionCooldownSec <= 600)
    updated.sessionCooldownSec = body.sessionCooldownSec;

  await writeJson(CHAT_SETTINGS_FILE, updated);
  res.json(updated);
});

// ── GET /bot/chat-support/sessions — phiên đang mở ───────────────────────────
router.get("/bot/chat-support/sessions", requireAuth, (_req: any, res: any) => {
  const data = readJson(CHAT_SESSIONS_FILE, { sessions: {} }) ?? { sessions: {} };
  const sessions = data.sessions ?? {};
  const list = Object.entries(sessions)
    .filter(([, s]: [string, any]) => s.status === "active")
    .map(([uid, s]: [string, any]) => ({
      userId:          Number(uid),
      uid,
      firstName:       s.first_name     ?? "",
      username:        s.username        ?? "",
      startedAt:       s.started_at     ?? "",
      lastActive:      s.last_active    ?? "",
      msgCount:        s.msg_count      ?? 0,
      assignedAdminId: s.assigned_admin_id ?? null,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json(list);
});

// ── POST /bot/chat-support/sessions/:uid/close — đóng phiên từ web admin ─────
router.post("/bot/chat-support/sessions/:uid/close", requireAuth, async (req: any, res: any) => {
  const { uid } = req.params;
  const data = readJson(CHAT_SESSIONS_FILE, { sessions: {}, msg_map: {} }) ?? {};
  data.sessions = data.sessions ?? {};
  data.msg_map  = data.msg_map  ?? {};

  const session = data.sessions[uid];
  if (!session || session.status !== "active")
    return res.status(404).json({ error: "Phiên không tồn tại hoặc đã đóng" });

  // Xoá session khỏi active list
  delete data.sessions[uid];
  for (const mid of session.admin_msg_ids ?? []) delete data.msg_map[String(mid)];

  // Thêm vào queue để bot gửi thông báo kết thúc cho user
  data.admin_close_queue = data.admin_close_queue ?? {};
  data.admin_close_queue[uid] = {
    userId:    Number(uid),
    firstName: session.first_name ?? "",
    closedAt:  new Date().toISOString(),
  };

  await writeJson(CHAT_SESSIONS_FILE, data);
  res.json({ ok: true });
});

// ── GET /bot/chat-support/banned ─────────────────────────────────────────────
router.get("/bot/chat-support/banned", requireAuth, (_req: any, res: any) => {
  const list: any[] = readJson(CHAT_BANNED_FILE, []) ?? [];
  // Lọc bỏ ban đã hết hạn
  const now = new Date().toISOString();
  const active = list.filter((u: any) => !u.expiresAt || u.expiresAt > now);
  res.json(active);
});

// ── POST /bot/chat-support/banned/:uid — cấm user ────────────────────────────
router.post("/bot/chat-support/banned/:uid", requireAuth, async (req: any, res: any) => {
  const uid  = String(req.params.uid);
  const { note, expiresAt } = req.body ?? {};
  const list: any[] = readJson(CHAT_BANNED_FILE, []) ?? [];

  // Xoá entry cũ nếu có
  const filtered = list.filter((u: any) => String(u.userId) !== uid);
  filtered.push({
    userId:    Number(uid),
    note:      note      ?? "",
    bannedAt:  new Date().toISOString(),
    expiresAt: expiresAt ?? null,   // null = vĩnh viễn
  });
  await writeJson(CHAT_BANNED_FILE, filtered);
  res.json({ ok: true });
});

// ── DELETE /bot/chat-support/banned/:uid — bỏ cấm ────────────────────────────
router.delete("/bot/chat-support/banned/:uid", requireAuth, async (req: any, res: any) => {
  const uid  = String(req.params.uid);
  const list: any[] = readJson(CHAT_BANNED_FILE, []) ?? [];
  const next = list.filter((u: any) => String(u.userId) !== uid);
  if (next.length === list.length) return res.status(404).json({ error: "Không tìm thấy" });
  await writeJson(CHAT_BANNED_FILE, next);
  res.json({ ok: true });
});

// ── GET /bot/chat-support/admins — danh sách admin phụ ───────────────────────
router.get("/bot/chat-support/admins", requireAuth, (_req: any, res: any) => {
  const list: any[] = readJson(CHAT_ADMINS_FILE, []) ?? [];
  res.json(list);
});

// ── POST /bot/chat-support/admins — thêm admin phụ ───────────────────────────
router.post("/bot/chat-support/admins", requireAuth, async (req: any, res: any) => {
  const { id, name, username } = req.body ?? {};
  if (!id || !name) return res.status(400).json({ error: "Thiếu id hoặc name" });
  const list: any[] = readJson(CHAT_ADMINS_FILE, []) ?? [];
  if (list.find((a: any) => String(a.id) === String(id)))
    return res.status(409).json({ error: "Admin đã tồn tại" });
  list.push({
    id:       Number(id),
    name:     String(name),
    username: username ? String(username) : "",
    enabled:  true,
    addedAt:  new Date().toISOString(),
  });
  await writeJson(CHAT_ADMINS_FILE, list);
  res.json({ ok: true });
});

// ── PUT /bot/chat-support/admins/:id — bật/tắt admin phụ ─────────────────────
router.put("/bot/chat-support/admins/:id", requireAuth, async (req: any, res: any) => {
  const id   = String(req.params.id);
  const list: any[] = readJson(CHAT_ADMINS_FILE, []) ?? [];
  const idx  = list.findIndex((a: any) => String(a.id) === id);
  if (idx === -1) return res.status(404).json({ error: "Không tìm thấy" });
  const { enabled, name } = req.body ?? {};
  if (typeof enabled === "boolean") list[idx].enabled = enabled;
  if (typeof name    === "string" && name.trim()) list[idx].name = name.trim();
  await writeJson(CHAT_ADMINS_FILE, list);
  res.json(list[idx]);
});

// ── DELETE /bot/chat-support/admins/:id — xoá admin phụ ──────────────────────
router.delete("/bot/chat-support/admins/:id", requireAuth, async (req: any, res: any) => {
  const id   = String(req.params.id);
  const list: any[] = readJson(CHAT_ADMINS_FILE, []) ?? [];
  const next = list.filter((a: any) => String(a.id) !== id);
  if (next.length === list.length) return res.status(404).json({ error: "Không tìm thấy" });
  await writeJson(CHAT_ADMINS_FILE, next);
  res.json({ ok: true });
});

export default router;
