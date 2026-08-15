import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson } from "../lib/dataUtils";

const router = Router();

const CHAT_HISTORY_FILE  = "support_chat_history";
const CHAT_SETTINGS_FILE = "support_chat_settings";

const DEFAULT_SETTINGS = {
  timeoutMinutes:     10,
  deleteDelayMinutes: 5,
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

  if (typeof body.timeoutMinutes === "number" && body.timeoutMinutes >= 1 && body.timeoutMinutes <= 120) {
    updated.timeoutMinutes = body.timeoutMinutes;
  }
  if (typeof body.deleteDelayMinutes === "number" && body.deleteDelayMinutes >= 1 && body.deleteDelayMinutes <= 60) {
    updated.deleteDelayMinutes = body.deleteDelayMinutes;
  }

  await writeJson(CHAT_SETTINGS_FILE, updated);
  res.json(updated);
});

export default router;
