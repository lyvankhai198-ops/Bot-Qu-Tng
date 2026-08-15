import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson } from "../lib/dataUtils";

const router = Router();

const CHAT_HISTORY_FILE  = "support_chat_history";
const CHAT_SETTINGS_FILE = "support_chat_settings";

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

  let list = raw.slice().reverse(); // newest first
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
  if (filtered.length === before) {
    return res.status(404).json({ error: "Entry not found" });
  }
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

  // Phiên chat
  if (typeof body.timeoutMinutes === "number" && body.timeoutMinutes >= 1 && body.timeoutMinutes <= 120) {
    updated.timeoutMinutes = body.timeoutMinutes;
  }
  if (typeof body.deleteDelayMinutes === "number" && body.deleteDelayMinutes >= 1 && body.deleteDelayMinutes <= 60) {
    updated.deleteDelayMinutes = body.deleteDelayMinutes;
  }

  // Chống spam
  if (typeof body.spamMaxMsgs === "number" && body.spamMaxMsgs >= 1 && body.spamMaxMsgs <= 100) {
    updated.spamMaxMsgs = body.spamMaxMsgs;
  }
  if (typeof body.spamWindowSec === "number" && body.spamWindowSec >= 10 && body.spamWindowSec <= 600) {
    updated.spamWindowSec = body.spamWindowSec;
  }
  if (typeof body.spamWarnAt === "number" && body.spamWarnAt >= 1) {
    // spamWarnAt phải nhỏ hơn spamMaxMsgs
    const max = typeof body.spamMaxMsgs === "number" ? body.spamMaxMsgs : updated.spamMaxMsgs;
    updated.spamWarnAt = Math.min(body.spamWarnAt, max - 1);
  }
  if (typeof body.sessionCooldownSec === "number" && body.sessionCooldownSec >= 0 && body.sessionCooldownSec <= 600) {
    updated.sessionCooldownSec = body.sessionCooldownSec;
  }

  await writeJson(CHAT_SETTINGS_FILE, updated);
  res.json(updated);
});

export default router;
