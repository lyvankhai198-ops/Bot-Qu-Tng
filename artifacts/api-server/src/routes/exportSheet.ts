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

/** Kiểm tra tên sản phẩm khớp rule include/exclude */
function productMatches(productName: string, include: string[], exclude: string[]): boolean {
  const norm = normName(productName);
  if (exclude.some(kw => norm.includes(kw.toLowerCase()))) return false;
  if (!include.length) return true;
  return include.some(kw => norm.includes(kw.toLowerCase()));
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

/** Parse content string → { email, password, twofa } */
function parseContent(content: string): { email: string; password: string; twofa: string } {
  const s = (content ?? "").trim();
  if (!s) return { email: "", password: "", twofa: "" };

  // Thử pipe: email|pass|2fa
  let parts = s.split("|").map(p => p.trim());
  if (parts.length >= 2 && parts[0].includes("@")) {
    return { email: parts[0] ?? "", password: parts[1] ?? "", twofa: parts[2] ?? "" };
  }
  // Thử dấu xuống dòng
  parts = s.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Mỗi dòng có thể là "key: value" hoặc "value"
    const map: Record<string, string> = {};
    const plain: string[] = [];
    for (const line of parts) {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) map[m[1].toLowerCase().trim()] = m[2].trim();
      else    plain.push(line);
    }
    const email    = map["email"]    || map["mail"]     || plain[0] || "";
    const password = map["password"] || map["pass"]     || map["mật khẩu"] || plain[1] || "";
    const twofa    = map["2fa"]      || map["totp"]     || map["secret"]   || plain[2] || "";
    if (email) return { email, password, twofa };
  }
  // Thử colon: email:pass:2fa
  parts = s.split(":").map(p => p.trim());
  if (parts.length >= 2) {
    return { email: parts[0] ?? "", password: parts[1] ?? "", twofa: parts[2] ?? "" };
  }
  // Thử khoảng trắng
  parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { email: parts[0] ?? "", password: parts[1] ?? "", twofa: parts[2] ?? "" };
  }
  return { email: s, password: "", twofa: "" };
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

  const rows = matched.map((o: any) => {
    const { email, password, twofa } = parseContent(o.content ?? "");
    const dateRaw = o.completed_at || o.delivered_at || o.payment_at
                  || o.created_at_raw || o.created_at || "";
    return {
      email,
      password,
      twofa,
      date:    fmtDate(dateRaw),
      price:   o.sell_price ?? o.price ?? "",
      seller:  o.seller ?? "",
      product: o.product_name ?? "",
    };
  });

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
    const { email, password, twofa } = parseContent(order.content ?? "");
    const dateRaw = order.completed_at || order.delivered_at
                  || order.payment_at  || order.created_at_raw || order.created_at || "";
    const price = order.sell_price ?? order.price ?? "";
    rows.push([email, password, twofa, fmtDate(dateRaw), price]);
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
