import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson } from "../lib/dataUtils";

const router = Router();

// ── GET /ai/usage ─────────────────────────────────────────────────────────────
// List all users' usage today + current budget config
router.get("/ai/usage", requireAuth, (_req: any, res: any) => {
  const usageAll: Record<string, any> = readJson("ai_usage", {}) ?? {};
  const aiCfg: Record<string, any>   = readJson("chat_ai_settings", {}) ?? {};

  const tokenLimit   = Number(aiCfg.daily_token_budget   ?? 50000);
  const requestLimit = Number(aiCfg.daily_request_budget ?? 200);

  // today in UTC (matches bot's _ai_budget_today())
  const today = new Date().toISOString().slice(0, 10);

  const users = Object.entries(usageAll)
    .filter(([, rec]) => rec?.date === today)
    .map(([uid, rec]) => ({
      uid,
      date:          rec.date      ?? today,
      tokens:        rec.tokens    ?? 0,
      requests:      rec.requests  ?? 0,
      tokenLimit,
      requestLimit,
      status: (rec.tokens ?? 0) >= tokenLimit || (rec.requests ?? 0) >= requestLimit
        ? "OVER"
        : "OK",
    }))
    .sort((a, b) => b.tokens - a.tokens);

  res.json({ today, tokenLimit, requestLimit, users });
});

// ── PUT /ai/budget ────────────────────────────────────────────────────────────
// Update global daily budget limits (writes to chat_ai_settings.json)
router.put("/ai/budget", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const aiCfg: Record<string, any> = readJson("chat_ai_settings", {}) ?? {};

  const tokenLimit   = Number(body.tokenLimit);
  const requestLimit = Number(body.requestLimit);

  if (isNaN(tokenLimit) || tokenLimit < 1) {
    res.status(400).json({ error: "tokenLimit must be a positive number" });
    return;
  }
  if (isNaN(requestLimit) || requestLimit < 1) {
    res.status(400).json({ error: "requestLimit must be a positive number" });
    return;
  }

  aiCfg.daily_token_budget   = tokenLimit;
  aiCfg.daily_request_budget = requestLimit;
  writeJson("chat_ai_settings", aiCfg);

  res.json({ ok: true, tokenLimit, requestLimit });
});

// ── DELETE /ai/usage/:uid ─────────────────────────────────────────────────────
// Reset a specific user's usage counter
router.delete("/ai/usage/:uid", requireAuth, (req: any, res: any) => {
  const uid    = req.params.uid;
  const usageAll: Record<string, any> = readJson("ai_usage", {}) ?? {};
  delete usageAll[uid];
  writeJson("ai_usage", usageAll);
  res.json({ ok: true, uid });
});

// ── DELETE /ai/usage ──────────────────────────────────────────────────────────
// Reset ALL users' usage (admin convenience)
router.delete("/ai/usage", requireAuth, (_req: any, res: any) => {
  writeJson("ai_usage", {});
  res.json({ ok: true, message: "All usage reset" });
});

export default router;
