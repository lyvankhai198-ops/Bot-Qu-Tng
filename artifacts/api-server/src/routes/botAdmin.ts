import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import hmac from "crypto";

const router = Router();

// ── Data directory ──────────────────────────────────────────────────────────
// The api-server runs from artifacts/api-server/ (pnpm changes cwd to package).
// data/ lives at workspace root, i.e. ../../data relative to this package.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

function dataFile(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name: string, fallback: unknown = null) {
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
  fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2), "utf-8");
}

// ── Auth middleware ─────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

// ── POST /bot/auth ──────────────────────────────────────────────────────────
router.post("/bot/auth", (req: any, res: any) => {
  const { password } = req.body ?? {};
  if (!ADMIN_SECRET || password !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }
  res.json({ token: ADMIN_SECRET });
});

// ── GET /bot/stats ──────────────────────────────────────────────────────────
router.get("/bot/stats", requireAuth, (_req: any, res: any) => {
  const settings = (readJson("settings", {}) as any) ?? {};
  const roundId = settings.round_id ?? "dot1";
  const users = (readJson("users", {}) as Record<string, unknown>) ?? {};
  const accounts = (readJson("accounts", []) as unknown[]) ?? [];
  const banned = (readJson("banned_users", []) as unknown[]) ?? [];
  const claimed = (readJson("claimed_users", {}) as Record<string, Record<string, unknown>>) ?? {};
  const roundClaims = claimed[roundId] ?? {};

  res.json({
    totalUsers: Object.keys(users).length,
    stock: accounts.length,
    claimed: Object.keys(roundClaims).length,
    banned: banned.length,
    roundId,
  });
});

// ── GET /bot/settings ───────────────────────────────────────────────────────
router.get("/bot/settings", requireAuth, (_req: any, res: any) => {
  const s = (readJson("settings", {}) as any) ?? {};
  res.json({
    shopLink: s.shop_link ?? "",
    shopUsername: s.shop_username ?? "",
    supportUsername: s.support_username ?? "",
    cooldownHours: s.cooldown_hours ?? 0,
    roundId: s.round_id ?? "dot1",
  });
});

// ── PUT /bot/settings ───────────────────────────────────────────────────────
router.put("/bot/settings", requireAuth, (req: any, res: any) => {
  const s = (readJson("settings", {}) as any) ?? {};
  const body = req.body ?? {};
  if (body.shopLink !== undefined) s.shop_link = body.shopLink;
  if (body.shopUsername !== undefined) s.shop_username = body.shopUsername;
  if (body.supportUsername !== undefined) s.support_username = body.supportUsername;
  if (body.cooldownHours !== undefined) s.cooldown_hours = Number(body.cooldownHours);
  if (body.roundId !== undefined) s.round_id = body.roundId;
  writeJson("settings", s);
  res.json({
    shopLink: s.shop_link ?? "",
    shopUsername: s.shop_username ?? "",
    supportUsername: s.support_username ?? "",
    cooldownHours: s.cooldown_hours ?? 0,
    roundId: s.round_id ?? "dot1",
  });
});

// ── GET /bot/accounts ───────────────────────────────────────────────────────
router.get("/bot/accounts", requireAuth, (_req: any, res: any) => {
  const accounts = (readJson("accounts", []) as { email: string; password: string }[]) ?? [];
  res.json(accounts);
});

// ── POST /bot/accounts ──────────────────────────────────────────────────────
router.post("/bot/accounts", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  const incoming: { email: string; password: string }[] = Array.isArray(body.accounts)
    ? body.accounts
    : [];
  const accounts = (readJson("accounts", []) as { email: string; password: string }[]) ?? [];
  const existing = new Set(accounts.map((a) => a.email));
  let added = 0;
  for (const acc of incoming) {
    if (acc.email && !existing.has(acc.email)) {
      accounts.push({ email: acc.email, password: acc.password ?? "" });
      existing.add(acc.email);
      added++;
    }
  }
  writeJson("accounts", accounts);
  res.json({ added, total: accounts.length });
});

// ── DELETE /bot/accounts/:email ─────────────────────────────────────────────
router.delete("/bot/accounts/:email", requireAuth, (req: any, res: any) => {
  const email = decodeURIComponent(req.params.email);
  const accounts = (readJson("accounts", []) as { email: string; password: string }[]) ?? [];
  const filtered = accounts.filter((a) => a.email !== email);
  if (filtered.length === accounts.length) {
    res.status(404).json({ ok: false, message: "Account not found" });
    return;
  }
  writeJson("accounts", filtered);
  res.json({ ok: true, message: `Deleted ${email}` });
});

// ── GET /bot/users ──────────────────────────────────────────────────────────
router.get("/bot/users", requireAuth, (_req: any, res: any) => {
  const users = (readJson("users", {}) as Record<string, any>) ?? {};
  const banned = new Set((readJson("banned_users", []) as string[]) ?? []);
  const result = Object.entries(users).map(([uid, u]: [string, any]) => ({
    userId: uid,
    username: u.username ?? "",
    firstName: u.first_name ?? "",
    startedAt: u.started_at ?? "",
    banned: banned.has(uid),
  }));
  res.json(result);
});

// ── POST /bot/users/:userId/ban ─────────────────────────────────────────────
router.post("/bot/users/:userId/ban", requireAuth, (req: any, res: any) => {
  const uid = req.params.userId;
  const banned = (readJson("banned_users", []) as string[]) ?? [];
  if (banned.includes(uid)) {
    res.json({ ok: false, message: "Already banned" });
    return;
  }
  banned.push(uid);
  writeJson("banned_users", banned);
  // Log it
  const logs = (readJson("logs", []) as any[]) ?? [];
  logs.push({ time: new Date().toISOString().slice(0, 19).replace("T", " "), action: "BAN", user: uid, admin: "web" });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  writeJson("logs", logs);
  res.json({ ok: true, message: `Banned ${uid}` });
});

// ── POST /bot/users/:userId/unban ───────────────────────────────────────────
router.post("/bot/users/:userId/unban", requireAuth, (req: any, res: any) => {
  const uid = req.params.userId;
  const banned = (readJson("banned_users", []) as string[]) ?? [];
  const idx = banned.indexOf(uid);
  if (idx === -1) {
    res.json({ ok: false, message: "User not banned" });
    return;
  }
  banned.splice(idx, 1);
  writeJson("banned_users", banned);
  const logs = (readJson("logs", []) as any[]) ?? [];
  logs.push({ time: new Date().toISOString().slice(0, 19).replace("T", " "), action: "UNBAN", user: uid, admin: "web" });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  writeJson("logs", logs);
  res.json({ ok: true, message: `Unbanned ${uid}` });
});

// ── GET /bot/logs ───────────────────────────────────────────────────────────
router.get("/bot/logs", requireAuth, (req: any, res: any) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const logs = (readJson("logs", []) as any[]) ?? [];
  res.json(logs.slice(-limit).reverse());
});

// ── GET /bot/receivers ──────────────────────────────────────────────────────
router.get("/bot/receivers", requireAuth, (_req: any, res: any) => {
  const settings = (readJson("settings", {}) as any) ?? {};
  const roundId = settings.round_id ?? "dot1";
  const claimed = (readJson("claimed_users", {}) as Record<string, Record<string, any>>) ?? {};
  const roundClaims = claimed[roundId] ?? {};
  const result = Object.values(roundClaims).map((r: any) => ({
    userId: String(r.user_id ?? ""),
    username: r.username ?? "",
    firstName: r.first_name ?? "",
    claimTime: r.claim_time ?? "",
    accountEmail: r.account_email ?? "",
    roundId: r.round_id ?? roundId,
  }));
  res.json(result);
});

// ── POST /bot/broadcast ─────────────────────────────────────────────────────
router.post("/bot/broadcast", requireAuth, (req: any, res: any) => {
  const { message } = req.body ?? {};
  if (!message) {
    res.status(400).json({ ok: false, message: "message is required" });
    return;
  }
  const pending = (readJson("pending_broadcasts", []) as any[]) ?? [];
  pending.push({
    message,
    queued_at: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
  writeJson("pending_broadcasts", pending);
  // Save to announcements too
  const ann = (readJson("announcements", []) as any[]) ?? [];
  ann.push({ msg: message, time: new Date().toISOString().slice(0, 19).replace("T", " ") });
  writeJson("announcements", ann);
  res.json({ ok: true, message: "Broadcast queued" });
});

// ── POST /bot/round ─────────────────────────────────────────────────────────
router.post("/bot/round", requireAuth, (req: any, res: any) => {
  const { roundId } = req.body ?? {};
  if (!roundId) {
    res.status(400).json({ ok: false, message: "roundId is required" });
    return;
  }
  const settings = (readJson("settings", {}) as any) ?? {};
  const oldRound = settings.round_id ?? "dot1";
  settings.round_id = roundId;
  writeJson("settings", settings);
  // Reset claims for old round
  const claimed = (readJson("claimed_users", {}) as Record<string, unknown>) ?? {};
  delete claimed[oldRound];
  writeJson("claimed_users", claimed);
  // Log it
  const logs = (readJson("logs", []) as any[]) ?? [];
  logs.push({ time: new Date().toISOString().slice(0, 19).replace("T", " "), action: "NEW_ROUND", user: roundId, admin: "web" });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
  writeJson("logs", logs);
  res.json({ ok: true, message: `Round changed to ${roundId}` });
});

export default router;
