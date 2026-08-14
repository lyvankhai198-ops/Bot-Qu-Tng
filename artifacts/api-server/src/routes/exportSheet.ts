/**
 * exportSheet.ts — Xuất file .xlsx từ đơn hàng chợ theo rule lọc
 *
 * GET  /bot/export-sheet/config          — đọc danh sách rule
 * PUT  /bot/export-sheet/config          — lưu danh sách rule
 * POST /bot/export-sheet/download/:ruleId — tạo và trả file .xlsx
 */
import { Router }      from "express";
import fs              from "fs";
import path            from "path";
import * as XLSX       from "xlsx";
import { requireAuth } from "../lib/auth";

const router   = Router();
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "../../data");

function dataFile(name: string) { return path.join(DATA_DIR, `${name}.json`); }
function readJson(name: string, fallback: unknown = null): any {
  const f = dataFile(name);
  if (!fs.existsSync(f)) return fallback;
  try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return fallback; }
}
function writeJson(name: string, data: unknown) {
  fs.writeFileSync(dataFile(name), JSON.stringify(data, null, 2), "utf-8");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Chuẩn hoá tên sản phẩm để so khớp keyword */
function normName(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Kiểm tra seller của đơn có nằm trong danh sách không */
function sellerMatches(orderSeller: string, sellers: string[]): boolean {
  if (!sellers.length) return true;
  const norm = (orderSeller ?? "").toLowerCase().replace(/^@/, "");
  return sellers.some(s => norm.includes(s.toLowerCase().replace(/^@/, "")));
}

/** Kiểm tra tên sản phẩm khớp rule include/exclude
 *
 * Matching theo từng token (tách bởi khoảng trắng):
 *   keyword "chatgpt plus" → tokens ["chatgpt", "plus"]
 *   → tất cả token phải xuất hiện trong tên sản phẩm (thứ tự không quan trọng)
 *   → "ChatGPT 4 Plus", "ChatGPT Plus Pro" đều khớp
 */
function kwTokenMatch(productNorm: string, keyword: string): boolean {
  const tokens = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every(token => productNorm.includes(token));
}

function productMatches(productName: string, include: string[], exclude: string[]): boolean {
  const norm = normName(productName);
  if (exclude.some(kw => kwTokenMatch(norm, kw))) return false;
  if (!include.length) return true;
  return include.some(kw => kwTokenMatch(norm, kw));
}

/** Kiểm tra đơn còn trong thời hạn bảo hành */
function withinWarranty(order: any, warrantyDays: number): boolean {
  if (!warrantyDays || warrantyDays <= 0) return true;
  const raw = order.completed_at || order.delivered_at || order.payment_at
            || order.created_at_raw || order.created_at;
  if (!raw) return true;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return true;
  const elapsedDays = (Date.now() - d.getTime()) / 86_400_000;
  return elapsedDays <= warrantyDays;
}

/**
 * Parse content string → mảng các account { email, password, twofa }
 *
 * Format thực tế từ bot Telegram:
 *   email / password | Verify: 2FA_CODE | Giao: timestamp
 * Nhiều account cách nhau bằng \n
 *
 * Fallback: email|pass|2fa hoặc email:pass:2fa
 */
function parseContent(content: string): { email: string; password: string; twofa: string }[] {
  const s = (content ?? "").trim();
  if (!s) return [];

  // Chuẩn thực tế: mỗi dòng là "email / pass | Verify: 2FA | Giao: time"
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const results: { email: string; password: string; twofa: string }[] = [];

  for (const line of lines) {
    // Tách theo " | "
    const segments = line.split(" | ").map(p => p.trim());

    // Segment 0: "email / password"
    const accountSeg = segments[0] ?? "";
    const slashIdx   = accountSeg.lastIndexOf(" / ");
    let email = "", password = "";
    if (slashIdx !== -1) {
      email    = accountSeg.slice(0, slashIdx).trim();
      password = accountSeg.slice(slashIdx + 3).trim();
    } else {
      email = accountSeg;
    }

    // Segment 1+: tìm "Verify: XXX"
    let twofa = "";
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].startsWith("Verify: ")) {
        twofa = segments[i].slice(8).trim();
        break;
      }
    }

    if (email) results.push({ email, password, twofa });
  }

  if (results.length) return results;

  // Fallback: pipe-separated email|pass|2fa (1 account)
  const pipe = s.split("|").map(p => p.trim());
  if (pipe.length >= 2 && pipe[0].includes("@")) {
    return [{ email: pipe[0], password: pipe[1] ?? "", twofa: pipe[2] ?? "" }];
  }

  // Fallback: colon-separated
  const colon = s.split(":").map(p => p.trim());
  if (colon.length >= 2) {
    return [{ email: colon[0], password: colon[1] ?? "", twofa: colon[2] ?? "" }];
  }

  return [{ email: s, password: "", twofa: "" }];
}

/** Format ngày từ ISO string → dd/mm/yyyy */
function fmtDate(raw: string): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ── POST /bot/export-sheet/preview ─────────────────────────────────────────────
router.post("/bot/export-sheet/preview", requireAuth, (req: any, res: any) => {
  const rule = req.body as {
    sellers:      string[];
    include:      string[];
    exclude:      string[];
    warranty_days: number;
  };

  const allOrders: Record<string, any> = readJson("market_orders", {}) ?? {};

  const matched = Object.values(allOrders).filter((o: any) => {
    if (!sellerMatches(o.seller ?? "", rule.sellers ?? [])) return false;
    if (!productMatches(o.product_name ?? "", rule.include ?? [], rule.exclude ?? [])) return false;
    if (!withinWarranty(o, rule.warranty_days ?? 0)) return false;
    return true;
  });

  const rows: any[] = [];
  for (const o of matched) {
    const accounts = parseContent(o.content ?? "");
    const dateRaw  = o.completed_at || o.delivered_at || o.payment_at
                   || o.created_at_raw || o.created_at || "";
    const date     = fmtDate(dateRaw);
    const price    = o.sell_price ?? o.price ?? "";
    const seller   = o.seller ?? "";
    const product  = o.product_name ?? "";
    if (!accounts.length) {
      rows.push({ email: "", password: "", twofa: "", date, price, seller, product });
    } else {
      for (const acc of accounts) {
        rows.push({ ...acc, date, price, seller, product });
      }
    }
  }

  res.json({ total: rows.length, rows });
});

// ── GET /bot/export-sheet/config ───────────────────────────────────────────────
router.get("/bot/export-sheet/config", requireAuth, (_req: any, res: any) => {
  const cfg = readJson("export_sheet_config", { rules: [] });
  res.json(cfg);
});

// ── PUT /bot/export-sheet/config ───────────────────────────────────────────────
router.put("/bot/export-sheet/config", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  if (!Array.isArray(body.rules)) {
    return res.status(400).json({ error: "rules phải là mảng" });
  }
  writeJson("export_sheet_config", { rules: body.rules });
  res.json({ ok: true });
});

// ── POST /bot/export-sheet/download ────────────────────────────────────────────
router.post("/bot/export-sheet/download", requireAuth, (req: any, res: any) => {
  const rule = req.body as {
    name:         string;
    sellers:      string[];
    include:      string[];
    exclude:      string[];
    warranty_days: number;
  };

  if (!rule) return res.status(400).json({ error: "Thiếu thông tin rule" });

  const allOrders: Record<string, any> = readJson("market_orders", {}) ?? {};

  // ── Lọc đơn theo rule ──────────────────────────────────────────────────────
  const matched = Object.values(allOrders).filter((o: any) => {
    if (!sellerMatches(o.seller ?? "", rule.sellers ?? [])) return false;
    if (!productMatches(o.product_name ?? "", rule.include ?? [], rule.exclude ?? [])) return false;
    if (!withinWarranty(o, rule.warranty_days ?? 0)) return false;
    return true;
  });

  if (!matched.length) {
    return res.status(200).json({ ok: false, message: "Không có đơn nào khớp với rule này." });
  }

  // ── Xây dữ liệu rows ────────────────────────────────────────────────────────
  const rows: (string | number)[][] = [];

  // Header
  rows.push(["Email", "Mật khẩu", "2FA", "Ngày mua", "Giá mua (VNĐ)"]);

  for (const order of matched) {
    const accounts = parseContent(order.content ?? "");
    const dateRaw  = order.completed_at || order.delivered_at
                   || order.payment_at  || order.created_at_raw || order.created_at || "";
    const date  = fmtDate(dateRaw);
    const price = order.sell_price ?? order.price ?? "";
    if (!accounts.length) {
      rows.push(["", "", "", date, price]);
    } else {
      for (const { email, password, twofa } of accounts) {
        rows.push([email, password, twofa, date, price]);
      }
    }
  }

  // ── Tạo workbook xlsx ────────────────────────────────────────────────────────
  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet(rows);

  // Style header (bold) — SheetJS Community edition hỗ trợ cơ bản
  const headerRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
    if (cell) {
      cell.s = { font: { bold: true }, fill: { fgColor: { rgb: "4472C4" } } };
    }
  }

  // Độ rộng cột tự động
  ws["!cols"] = [
    { wch: 36 }, // Email
    { wch: 24 }, // Mật khẩu
    { wch: 36 }, // 2FA
    { wch: 14 }, // Ngày mua
    { wch: 16 }, // Giá mua
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Danh sách");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  // Tên file: <tên rule>_<ngày>.xlsx
  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safeName = (rule.name || "export").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  const filename = `${safeName}_${today}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

export default router;
