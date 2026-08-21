import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  readJson, writeJson, addLog, normalizeAccount, now,
} from "../lib/dataUtils";

const router = Router();

// ── GET /bot/accounts ─────────────────────────────────────────────────────────
router.get("/bot/accounts", requireAuth, (_req: any, res: any) => {
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  res.json(accounts);
});

// ── POST /bot/accounts ────────────────────────────────────────────────────────
router.post("/bot/accounts", requireAuth, async (req: any, res: any) => {
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
  await writeJson("accounts", accounts);
  addLog("ADD_ACCOUNTS", `added=${added}`, "web-admin").catch(() => {});

  // Queue stock notification if requested and accounts were actually added
  if (added > 0 && req.body?.notify !== false) {
    const ns = readJson("stock_notify_settings", {}) ?? {};
    const notifyEnabled = req.body?.notify === true || ns.enabled !== false;
    if (notifyEnabled) {
      const message =
        typeof req.body?.notifyMessage === "string" && req.body.notifyMessage.trim()
          ? req.body.notifyMessage.trim()
          : (ns.message || "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!");
      const target = ns.target || "no_received";
      const pending: any[] = readJson("pending_broadcasts", []) ?? [];
      pending.push({ id: `stock_${Date.now()}`, message, target, createdAt: now() });
      await writeJson("pending_broadcasts", pending);
      addLog("STOCK_NOTIFY_QUEUED", `added=${added} target=${target}`, "web-admin").catch(() => {});
    }
  }
  res.json({ added, total: accounts.length });
});

// ── PUT /bot/accounts/:email ──────────────────────────────────────────────────
router.put("/bot/accounts/:email", requireAuth, async (req: any, res: any) => {
  const email = decodeURIComponent(req.params.email);
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const idx = accounts.findIndex((a: any) => a.email === email);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const allowed = ["type", "password", "note", "status"];
  for (const k of allowed) {
    if (req.body[k] !== undefined) accounts[idx][k] = req.body[k];
  }
  await writeJson("accounts", accounts);
  res.json({ ok: true, message: "Đã cập nhật" });
});

// ── DELETE /bot/accounts/:email ───────────────────────────────────────────────
router.delete("/bot/accounts/:email", requireAuth, async (req: any, res: any) => {
  const email = decodeURIComponent(req.params.email);
  const accounts: any[] = (readJson("accounts", []) ?? []).map(normalizeAccount);
  const filtered = accounts.filter((a: any) => a.email !== email);
  if (filtered.length === accounts.length) {
    res.status(404).json({ ok: false, message: "Không tìm thấy" }); return;
  }
  await writeJson("accounts", filtered);
  addLog("DELETE_ACCOUNT", email, "web-admin").catch(() => {});
  res.json({ ok: true, message: `Đã xoá ${email}` });
});

export default router;
