/**
 * sheetsSettings.ts — API routes cho cấu hình Google Sheets
 *
 * GET  /bot/sheets/config   — đọc cấu hình sheets (spreadsheet_id, tabs, enabled)
 * PUT  /bot/sheets/config   — lưu cấu hình sheets
 * GET  /bot/sheets/status   — kiểm tra kết nối Google Sheets qua Secret
 */
import { Router } from "express";
import fs         from "fs";
import path       from "path";

const router   = Router();
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function dataFile(name: string) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readJson(name: string, fallback: unknown = null): any {
  const file = dataFile(name);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function requireAuth(req: any, res: any, next: any) {
  const auth  = (req.headers.authorization as string) ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

// ── GET /bot/sheets/config ─────────────────────────────────────────────────────
router.get("/bot/sheets/config", requireAuth, (_req: any, res: any) => {
  const cfg: any = readJson("sheets_config", {}) ?? {};
  res.json({
    spreadsheet_id:  cfg.spreadsheet_id  ?? "",
    default_tab:     cfg.default_tab     ?? "Đơn hàng",
    market_tab:      cfg.market_tab      ?? "Đơn hàng chợ",
    sync_enabled:    cfg.sync_enabled    ?? false,
    tab_mappings:    cfg.tab_mappings    ?? {},
    tab_rules:       cfg.tab_rules       ?? [],
  });
});

// ── PUT /bot/sheets/config ─────────────────────────────────────────────────────
router.put("/bot/sheets/config", requireAuth, (req: any, res: any) => {
  const body: any = req.body ?? {};
  const cfg: any  = readJson("sheets_config", {}) ?? {};

  if (typeof body.spreadsheet_id === "string")
    cfg.spreadsheet_id = body.spreadsheet_id.trim();
  if (typeof body.default_tab === "string" && body.default_tab.trim())
    cfg.default_tab = body.default_tab.trim();
  if (typeof body.market_tab === "string" && body.market_tab.trim())
    cfg.market_tab = body.market_tab.trim();
  if (typeof body.sync_enabled === "boolean")
    cfg.sync_enabled = body.sync_enabled;
  if (body.tab_mappings && typeof body.tab_mappings === "object")
    cfg.tab_mappings = body.tab_mappings;
  if (Array.isArray(body.tab_rules))
    cfg.tab_rules = body.tab_rules;

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(dataFile("sheets_config"), JSON.stringify(cfg, null, 2), "utf-8");
    res.json({ ok: true, message: "Đã lưu cấu hình Google Sheets" });
  } catch (e: any) {
    res.status(500).json({ ok: false, message: `Lỗi lưu cấu hình: ${e.message}` });
  }
});

// ── GET /bot/sheets/status ─────────────────────────────────────────────────────
// Kiểm tra GOOGLE_SERVICE_ACCOUNT_JSON secret — không cần gọi API Google,
// chỉ xác nhận secret tồn tại và đúng định dạng.
router.get("/bot/sheets/status", requireAuth, (_req: any, res: any) => {
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();

  // Fallback: đọc từ data/google_sa.json (dùng trên VPS khi không có env var)
  if (!raw) {
    const saFile = path.join(DATA_DIR, "google_sa.json");
    if (fs.existsSync(saFile)) {
      try { raw = fs.readFileSync(saFile, "utf-8").trim(); } catch { /* ignore */ }
    }
  }

  if (!raw) {
    res.json({
      connected: false,
      message:   "Chưa cấu hình Secret GOOGLE_SERVICE_ACCOUNT_JSON.",
      fix:       "Replit: Vào Secrets → Thêm GOOGLE_SERVICE_ACCOUNT_JSON. VPS: Upload file data/google_sa.json.",
    });
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    res.json({
      connected: false,
      message:   "GOOGLE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ.",
      fix:       "Kiểm tra lại nội dung Secret — phải là file JSON Service Account nguyên vẹn.",
    });
    return;
  }

  const required = ["type", "project_id", "private_key", "client_email", "token_uri"];
  const missing  = required.filter(k => !parsed[k]);

  if (missing.length > 0) {
    res.json({
      connected: false,
      message:   `JSON thiếu trường bắt buộc: ${missing.join(", ")}`,
      fix:       "Tải lại file JSON Service Account từ Google Cloud Console và cập nhật Secret.",
    });
    return;
  }

  if (parsed.type !== "service_account") {
    res.json({
      connected: false,
      message:   `Loại credentials không hợp lệ: "${parsed.type}". Cần "service_account".`,
      fix:       "Đảm bảo tải đúng loại key JSON (Service Account Key) từ Google Cloud.",
    });
    return;
  }

  res.json({
    connected:    true,
    message:      "Đã kết nối Google Sheets thành công.",
    project_id:   parsed.project_id,
    client_email: parsed.client_email,
  });
});

// ── POST /bot/sheets/push-all ─────────────────────────────────────────────────
// Đẩy tất cả đơn trong market_orders.json lên Sheets (bỏ qua đã sync)
router.post("/bot/sheets/push-all", requireAuth, (req: any, res: any) => {
  const { spawn } = require("child_process");
  const pathMod   = require("path");
  const BASE_DIR  = path.resolve(DATA_DIR, "..");
  const pythonBin = process.env.PYTHON_BIN ?? "python3";
  const script    = pathMod.join(BASE_DIR, "market_order_sync.py");

  const filterTab: string = (req.body?.tab ?? "all").toString().trim();
  const args = filterTab && filterTab !== "all"
    ? [script, "--push-all", "--tab", filterTab]
    : [script, "--push-all"];

  const child = spawn(pythonBin, args, {
    env: { ...process.env, DATA_DIR },
    cwd: BASE_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let out = "";
  child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { console.error("[push-all]", d.toString().trim()); });

  child.on("close", (code: number) => {
    try {
      const result = JSON.parse(out.trim());
      res.json(result);
    } catch {
      res.json({ ok: code === 0, message: out.trim() || `Exit ${code}` });
    }
  });
});

// ── GET /bot/sheets/synced ─────────────────────────────────────────────────────
// Trả danh sách đơn đã được ghi lên Google Sheets (từ market_sheets_synced.json)
router.get("/bot/sheets/synced", requireAuth, (_req: any, res: any) => {
  const synced: Record<string, any> = readJson("market_sheets_synced", {}) ?? {};
  const entries = Object.entries(synced).map(([order_id, info]: [string, any]) => ({
    order_id,
    tab:       typeof info === "string" ? info : (info?.tab ?? ""),
    synced_at: typeof info === "object" ? info?.synced_at : undefined,
  }));
  // Sort mới nhất lên trước
  entries.sort((a, b) => (b.synced_at ?? "").localeCompare(a.synced_at ?? ""));
  res.json(entries);
});

export default router;
