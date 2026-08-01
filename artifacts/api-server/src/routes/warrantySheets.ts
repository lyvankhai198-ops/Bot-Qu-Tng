/**
 * warrantySheets.ts — API routes cho tính năng Quét Đơn Còn Bảo Hành
 *
 * POST /bot/warranty-scan/preview       — xem trước kết quả quét (không ghi Sheet)
 * POST /bot/warranty-scan/create-sheet  — tạo tab Google Sheet + lưu lịch sử
 * GET  /bot/warranty-scan/history       — danh sách lịch sử đợt quét
 * DELETE /bot/warranty-scan/history/:id — xóa bản ghi lịch sử
 * GET  /bot/warranty-scan/export/:id/xlsx — tải file XLSX
 * GET  /bot/warranty-scan/export/:id/csv  — tải file CSV
 * GET  /bot/warranty-scan/presets          — danh sách presets
 */
import { Router } from "express";
import fs   from "fs";
import path from "path";
import { spawn } from "child_process";

const router     = Router();
const DATA_DIR   = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function requireAuth(req: any, res: any, next: any) {
  const auth  = (req.headers.authorization as string) ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  next();
}

function readJson(name: string, fallback: unknown = null): any {
  const file = path.join(DATA_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return fallback; }
}

function spawnScript(args: string[]): Promise<any> {
  return new Promise((resolve) => {
    const BASE_DIR  = path.resolve(DATA_DIR, "..");
    const pythonBin = process.env.PYTHON_BIN ?? "python3";
    const script    = path.join(BASE_DIR, "warranty_scan.py");

    const child = spawn(pythonBin, [script, ...args], {
      env:   { ...process.env, DATA_DIR },
      cwd:   BASE_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { err += d.toString(); });

    child.on("close", (code: number) => {
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ ok: code === 0, message: out.trim() || err.trim() || `Exit ${code}` });
      }
    });
  });
}

// ── GET /bot/warranty-scan/presets ────────────────────────────────────────────
router.get("/bot/warranty-scan/presets", requireAuth, (_req: any, res: any) => {
  res.json([
    { key: "chatgpt_30d",  label: "ChatGPT Plus BHF 30D",  warranty_days: 30 },
    { key: "grok_super",   label: "Grok Super BHF",          warranty_days: 30 },
  ]);
});

// ── POST /bot/warranty-scan/preview ───────────────────────────────────────────
router.post("/bot/warranty-scan/preview", requireAuth, async (req: any, res: any) => {
  const { preset = "chatgpt_30d", date, warranty_days, refund_mode = "sell_price", refund_price = 0 } = req.body ?? {};

  const args = [
    "--mode", "preview",
    "--preset", String(preset),
    "--refund-mode", String(refund_mode),
    "--refund-price", String(Number(refund_price) || 0),
  ];
  if (date)            args.push("--date", String(date));
  if (warranty_days)   args.push("--warranty-days", String(Number(warranty_days)));

  const result = await spawnScript(args);
  res.json(result);
});

// ── POST /bot/warranty-scan/create-sheet ──────────────────────────────────────
router.post("/bot/warranty-scan/create-sheet", requireAuth, async (req: any, res: any) => {
  const { preset = "chatgpt_30d", date, warranty_days, refund_mode = "sell_price", refund_price = 0 } = req.body ?? {};

  const args = [
    "--mode", "create-sheet",
    "--preset", String(preset),
    "--refund-mode", String(refund_mode),
    "--refund-price", String(Number(refund_price) || 0),
  ];
  if (date)            args.push("--date", String(date));
  if (warranty_days)   args.push("--warranty-days", String(Number(warranty_days)));

  const result = await spawnScript(args);
  res.json(result);
});

// ── GET /bot/warranty-scan/history ────────────────────────────────────────────
router.get("/bot/warranty-scan/history", requireAuth, (_req: any, res: any) => {
  const history: any[] = readJson("warranty_scan_history", []) ?? [];
  // Trả về tất cả trừ orders_snapshot (nặng)
  const slim = history.map(({ orders_snapshot: _snap, ...rest }: any) => rest);
  res.json(slim);
});

// ── DELETE /bot/warranty-scan/history/:id ─────────────────────────────────────
router.delete("/bot/warranty-scan/history/:id", requireAuth, (req: any, res: any) => {
  const { id } = req.params;
  const history: any[] = readJson("warranty_scan_history", []) ?? [];
  const idx = history.findIndex((h: any) => h.scan_id === id);
  if (idx === -1) {
    res.status(404).json({ ok: false, error: "Không tìm thấy đợt quét" });
    return;
  }

  // Xóa file export nếu có
  for (const ext of ["xlsx", "csv"]) {
    const fp = path.join(DATA_DIR, "warranty_exports", `${id}.${ext}`);
    if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch { /* ignore */ } }
  }

  history.splice(idx, 1);
  try {
    fs.writeFileSync(path.join(DATA_DIR, "warranty_scan_history.json"), JSON.stringify(history, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── GET /bot/warranty-scan/export/:id/xlsx ────────────────────────────────────
router.get("/bot/warranty-scan/export/:id/xlsx", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const cachedPath = path.join(DATA_DIR, "warranty_exports", `${id}.xlsx`);

  // Dùng cache nếu đã có
  if (!fs.existsSync(cachedPath)) {
    const result = await spawnScript(["--mode", "export-xlsx", "--scan-id", id]);
    if (!result?.ok) {
      res.status(500).json(result);
      return;
    }
  }

  if (!fs.existsSync(cachedPath)) {
    res.status(500).json({ ok: false, error: "Không tạo được file XLSX" });
    return;
  }

  // Lấy tên file từ history
  const history: any[] = readJson("warranty_scan_history", []) ?? [];
  const entry = history.find((h: any) => h.scan_id === id);
  const filename = `${entry?.sheet_name ?? id}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  fs.createReadStream(cachedPath).pipe(res);
});

// ── GET /bot/warranty-scan/export/:id/csv ─────────────────────────────────────
router.get("/bot/warranty-scan/export/:id/csv", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const cachedPath = path.join(DATA_DIR, "warranty_exports", `${id}.csv`);

  if (!fs.existsSync(cachedPath)) {
    const result = await spawnScript(["--mode", "export-csv", "--scan-id", id]);
    if (!result?.ok) {
      res.status(500).json(result);
      return;
    }
  }

  if (!fs.existsSync(cachedPath)) {
    res.status(500).json({ ok: false, error: "Không tạo được file CSV" });
    return;
  }

  const history: any[] = readJson("warranty_scan_history", []) ?? [];
  const entry = history.find((h: any) => h.scan_id === id);
  const filename = `${entry?.sheet_name ?? id}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  fs.createReadStream(cachedPath).pipe(res);
});

export default router;
