/**
 * marketOrders.ts — API routes cho "Đơn hàng chợ"
 * Module MỚI, không thay đổi bất kỳ route cũ nào.
 *
 * GET  /bot/market-orders              — danh sách đơn hàng chợ (có search/filter)
 * GET  /bot/market-orders/status       — trạng thái sync
 * GET  /bot/market-orders/logs         — lịch sử sync
 * POST /bot/market-orders/sync         — kích hoạt đồng bộ thủ công
 * GET  /bot/market-orders/config       — đọc cấu hình đồng bộ
 * PUT  /bot/market-orders/config       — lưu cấu hình đồng bộ
 */
import { Router }           from "express";
import fs                   from "fs";
import path                 from "path";
import { execFile }         from "child_process";
import { promisify }        from "util";
import { requireAuth }      from "../lib/auth";

const execFileAsync = promisify(execFile);
const router        = Router();

const DATA_DIR     = process.env.DATA_DIR     ?? path.resolve(process.cwd(), "../../data");
const BASE_DIR     = process.env.BOT_BASE_DIR  ?? path.resolve(process.cwd());

function dataFile(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name: string, fallback: unknown = null): any {
  const file = dataFile(name);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function now() { return new Date().toISOString(); }

// ── GET /bot/market-orders ─────────────────────────────────────────────────────
router.get("/bot/market-orders", requireAuth, (req: any, res: any) => {
  const stored: Record<string, any> = readJson("market_orders", {}) ?? {};

  const search = ((req.query.search as string) ?? "").toLowerCase().trim();
  const status = ((req.query.status as string) ?? "all").trim();
  const seller = ((req.query.seller as string) ?? "").toLowerCase().trim();
  const from   = (req.query.from   as string) ?? "";
  const to     = (req.query.to     as string) ?? "";

  let orders = Object.values(stored);

  // Search
  if (search) {
    orders = orders.filter((o: any) =>
      (o.order_id    || "").toLowerCase().includes(search) ||
      (o.seller      || "").toLowerCase().includes(search) ||
      (o.buyer       || "").toLowerCase().includes(search) ||
      (o.product_name || "").toLowerCase().includes(search)
    );
  }
  // Status filter
  if (status && status !== "all") {
    orders = orders.filter((o: any) =>
      (o.status || "").toLowerCase().includes(status.toLowerCase())
    );
  }
  // Seller filter
  if (seller) {
    orders = orders.filter((o: any) =>
      (o.seller || "").toLowerCase().includes(seller)
    );
  }
  // Date filter (completed_at)
  if (from) {
    orders = orders.filter((o: any) => {
      const d = (o.completed_at || o.created_at || "").slice(0, 10);
      return d >= from;
    });
  }
  if (to) {
    orders = orders.filter((o: any) => {
      const d = (o.completed_at || o.created_at || "").slice(0, 10);
      return !d || d <= to;
    });
  }

  // Sort by completed_at / synced_at desc
  orders.sort((a: any, b: any) => {
    const da = b.completed_at || b.synced_at || "";
    const db = a.completed_at || a.synced_at || "";
    return da.localeCompare(db);
  });

  res.json({ total: orders.length, orders });
});

// ── GET /bot/market-orders/status ─────────────────────────────────────────────
router.get("/bot/market-orders/status", requireAuth, (_req: any, res: any) => {
  const status: any = readJson("market_order_sync_status", {}) ?? {};
  const total  = Object.keys(readJson("market_orders", {}) ?? {}).length;

  // Auto-reset nếu running: true quá 10 phút mà không có process (process bị kill đột ngột)
  if (status.running) {
    const startedAt = status.last_started_at ?? status.updated_at ?? "";
    const ageMs = startedAt ? (Date.now() - new Date(startedAt).getTime()) : Infinity;
    if (ageMs > 10 * 60 * 1000) {
      status.running = false;
      status.last_run = {
        ...(status.last_run ?? {}),
        success: false,
        message: "⚠️ Sync bị gián đoạn (process bị kill) — tự động reset sau 10 phút",
        ended_at: new Date().toISOString(),
      };
      try {
        fs.writeFileSync(dataFile("market_order_sync_status"), JSON.stringify(status, null, 2), "utf-8");
      } catch { /* ignore */ }
    }
  }

  res.json({ ...status, total_stored: total });
});

// ── GET /bot/market-orders/logs ───────────────────────────────────────────────
router.get("/bot/market-orders/logs", requireAuth, (req: any, res: any) => {
  const logs: any[] = readJson("market_order_sync_logs", []) ?? [];
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  res.json({ logs: [...logs].reverse().slice(0, limit) });
});

// ── GET /bot/market-orders/config ─────────────────────────────────────────────
// PHẢI đứng trước /:orderId để "config" không bị match như orderId
router.get("/bot/market-orders/config", requireAuth, (_req: any, res: any) => {
  const syncCfg: any   = readJson("sync_robot_config",  {}) ?? {};
  const sheetsCfg: any = readJson("sheets_config",      {}) ?? {};

  res.json({
    market_sync_enabled: syncCfg.market_sync_enabled  ?? true,
    market_sync_hour:    syncCfg.market_sync_hour     ?? 3,
    market_sync_minute:  syncCfg.market_sync_minute   ?? 0,
    market_tab:          sheetsCfg.market_tab          ?? "Đơn hàng chợ",
    has_site_url:  !!(syncCfg.site_url),
    has_email:     !!(syncCfg.email),
    has_password:  !!(syncCfg.password),
  });
});

// ── PUT /bot/market-orders/config ─────────────────────────────────────────────
router.put("/bot/market-orders/config", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};

  const syncCfg: any = readJson("sync_robot_config", {}) ?? {};
  if (typeof body.market_sync_enabled === "boolean")
    syncCfg.market_sync_enabled = body.market_sync_enabled;
  if (typeof body.market_sync_hour === "number")
    syncCfg.market_sync_hour = Math.min(23, Math.max(0, Math.floor(body.market_sync_hour)));
  if (typeof body.market_sync_minute === "number")
    syncCfg.market_sync_minute = Math.min(59, Math.max(0, Math.floor(body.market_sync_minute)));

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(dataFile("sync_robot_config"), JSON.stringify(syncCfg, null, 2), "utf-8");
  } catch (e: any) {
    res.status(500).json({ ok: false, message: `Lỗi lưu sync config: ${e.message}` });
    return;
  }

  if (typeof body.market_tab === "string" && body.market_tab.trim()) {
    const sheetsCfg: any = readJson("sheets_config", {}) ?? {};
    sheetsCfg.market_tab = body.market_tab.trim();
    try {
      fs.writeFileSync(dataFile("sheets_config"), JSON.stringify(sheetsCfg, null, 2), "utf-8");
    } catch { /* sheets config optional */ }
  }

  res.json({ ok: true, message: "Đã lưu cấu hình đồng bộ Đơn hàng chợ" });
});

// ── GET /bot/market-orders/:orderId ───────────────────────────────────────────
router.get("/bot/market-orders/:orderId", requireAuth, (req: any, res: any) => {
  const orders = readJson("market_orders", {}) ?? {};
  const order  = orders[req.params.orderId];
  if (!order) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  res.json(order);
});

// ── POST /bot/market-orders/sync ──────────────────────────────────────────────
// Kích hoạt đồng bộ thủ công. Chạy Python script không đồng bộ (fire-and-forget).
router.post("/bot/market-orders/sync", requireAuth, (req: any, res: any) => {
  const status = readJson("market_order_sync_status", {}) ?? {};
  if (status.running) {
    res.json({ ok: false, message: "Đang có lần đồng bộ chạy — vui lòng chờ" });
    return;
  }

  // Update status to running
  const startedAt = now();
  const statusObj = { running: true, last_started_at: startedAt, updated_at: startedAt };
  const statusFile = dataFile("market_order_sync_status");
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(statusFile, JSON.stringify(statusObj, null, 2), "utf-8");
  } catch {}

  // Fire-and-forget Python process
  const pythonBin  = process.env.PYTHON_BIN ?? "python3";
  const scriptPath = path.join(BASE_DIR, "market_order_sync.py");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR,
    PYTHONPATH: BASE_DIR,
  };

  const child = require("child_process").spawn(pythonBin, [scriptPath], {
    env,
    cwd: BASE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  child.stdout?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log(`[market-sync] ${line}`);
  });
  child.stderr?.on("data", (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.error(`[market-sync] ${line}`);
  });
  child.on("exit", (code: number) => {
    console.log(`[market-sync] Process exited with code ${code}`);
  });
  child.unref();

  res.json({
    ok:      true,
    message: "Đã khởi động đồng bộ Đơn hàng chợ",
    started_at: startedAt,
  });
});


export default router;
