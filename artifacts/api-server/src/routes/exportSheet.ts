/**
 * exportSheet.ts — Xuất file .xlsx từ đơn hàng chợ theo rule lọc
 *
 * GET  /bot/export-sheet/config    — đọc danh sách rule
 * PUT  /bot/export-sheet/config    — lưu danh sách rule
 * POST /bot/export-sheet/preview   — xem trước (JSON)
 * POST /bot/export-sheet/download  — tải file .xlsx
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

// ── Helpers: lọc ──────────────────────────────────────────────────────────────

function normName(s: string): string {
  return (s ?? "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}
function sellerMatches(orderSeller: string, sellers: string[]): boolean {
  if (!sellers.length) return true;
  const norm = (orderSeller ?? "").toLowerCase().replace(/^@/, "");
  return sellers.some(s => norm.includes(s.toLowerCase().replace(/^@/, "")));
}
function kwTokenMatch(productNorm: string, keyword: string): boolean {
  return keyword.toLowerCase().split(/\s+/).filter(Boolean).every(t => productNorm.includes(t));
}
function productMatches(productName: string, include: string[], exclude: string[]): boolean {
  const norm = normName(productName);
  if (exclude.some(kw => kwTokenMatch(norm, kw))) return false;
  if (!include.length) return true;
  return include.some(kw => kwTokenMatch(norm, kw));
}

// ── Helpers: giá và ngày ──────────────────────────────────────────────────────

/** Parse "110.000đ" hoặc 110000 → number */
function parsePrice(raw: string | number): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").replace(/[^\d]/g, "");
  return parseInt(s, 10) || 0;
}

/** Giá mua — đã trừ 3% sẵn trong data, lấy thẳng */
function adjustPrice(raw: string | number): number {
  return parsePrice(raw);
}

/**
 * Parse ngày mua từ order.
 * Ưu tiên completed_at / delivered_at / payment_at (format VN: "HH:MM:SS DD/MM/YYYY")
 * Fallback: created_at (ISO).
 */
function parsePurchaseDate(order: any): Date | null {
  const raw = order.completed_at || order.delivered_at || order.payment_at
            || order.created_at_raw || order.created_at;
  if (!raw) return null;
  const s = String(raw);
  // Format VN: "21:24:09 30/07/2026" hoặc chỉ "30/07/2026"
  const vnMatch = s.match(/(\d{1,2})\/(\d{2})\/(\d{4})/);
  if (vnMatch) {
    const [, dd, mm, yyyy] = vnMatch;
    return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
  }
  // ISO
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Date → DD/MM/YYYY */
function fmtDate(d: Date | null): string {
  if (!d || isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Số ngày còn lại tính từ hôm nay */
function calcRemaining(purchaseDate: Date, warrantyDays: number): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const p = new Date(purchaseDate); p.setHours(0, 0, 0, 0);
  const used = Math.floor((today.getTime() - p.getTime()) / 86_400_000);
  return Math.max(0, warrantyDays - used);
}

/** Tiền hoàn = giá mua (sau -3%) × ngày còn lại / warrantyDays */
function calcRefund(adjPrice: number, remaining: number, warrantyDays: number): number {
  if (warrantyDays <= 0) return 0;
  return Math.round(adjPrice * remaining / warrantyDays);
}

/** Parse content → mảng {email, password, twofa} */
function parseContent(content: string): { email: string; password: string; twofa: string }[] {
  const s = (content ?? "").trim();
  if (!s) return [];
  const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results: { email: string; password: string; twofa: string }[] = [];
  for (const line of lines) {
    const segs = line.split(" | ").map(p => p.trim());
    const acct  = segs[0] ?? "";
    const slash = acct.lastIndexOf(" / ");
    let email = "", password = "";
    if (slash !== -1) { email = acct.slice(0, slash).trim(); password = acct.slice(slash + 3).trim(); }
    else { email = acct; }
    let twofa = "";
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].startsWith("Verify: ")) { twofa = segs[i].slice(8).trim(); break; }
    }
    if (email) results.push({ email, password, twofa });
  }
  if (results.length) return results;
  const pipe = s.split("|").map(p => p.trim());
  if (pipe.length >= 2 && pipe[0].includes("@")) return [{ email: pipe[0], password: pipe[1] ?? "", twofa: pipe[2] ?? "" }];
  const colon = s.split(":").map(p => p.trim());
  if (colon.length >= 2) return [{ email: colon[0], password: colon[1] ?? "", twofa: colon[2] ?? "" }];
  return [{ email: s, password: "", twofa: "" }];
}

// ── Kiểu dữ liệu row nội bộ ───────────────────────────────────────────────────

interface RowData {
  seller:        string;
  email:         string;
  password:      string;
  twofa:         string;
  purchaseDate:  Date | null;
  expiryDate:    Date | null;
  adjPrice:      number;
  remaining:     number;
  refund:        number;
}

// ── Lọc + build rows ──────────────────────────────────────────────────────────

function filterAndBuild(rule: {
  sellers?: string[]; include?: string[]; exclude?: string[]; warranty_days?: number;
}): RowData[] {
  const warrantyDays = (rule.warranty_days && rule.warranty_days > 0) ? rule.warranty_days : 30;
  const allOrders: Record<string, any> = readJson("market_orders", {}) ?? {};

  const matched = Object.values(allOrders).filter((o: any) => {
    if (!sellerMatches(o.seller ?? "", rule.sellers ?? [])) return false;
    if (!productMatches(o.product_name ?? "", rule.include ?? [], rule.exclude ?? [])) return false;
    if (warrantyDays > 0) {
      const pd = parsePurchaseDate(o);
      if (pd) {
        const elapsed = (Date.now() - pd.getTime()) / 86_400_000;
        if (elapsed > warrantyDays) return false;
      }
    }
    return true;
  });

  // Sắp xếp: seller → ngày mua
  matched.sort((a: any, b: any) => {
    const sa = (a.seller ?? "").toLowerCase();
    const sb = (b.seller ?? "").toLowerCase();
    if (sa !== sb) return sa.localeCompare(sb);
    const da = parsePurchaseDate(a), db = parsePurchaseDate(b);
    if (!da || !db) return 0;
    return da.getTime() - db.getTime();
  });

  const rows: RowData[] = [];
  for (const o of matched) {
    const accounts     = parseContent(o.content ?? "");
    const purchaseDate = parsePurchaseDate(o);
    const adjPrice     = adjustPrice(o.price ?? "");
    const remaining    = purchaseDate ? calcRemaining(purchaseDate, warrantyDays) : 0;
    const expiryDate   = purchaseDate
      ? new Date(purchaseDate.getTime() + warrantyDays * 86_400_000)
      : null;
    const refund = calcRefund(adjPrice, remaining, warrantyDays);
    const seller = o.seller ?? "";

    if (!accounts.length) {
      rows.push({ seller, email: "", password: "", twofa: "", purchaseDate, expiryDate, adjPrice, remaining, refund });
    } else {
      for (const { email, password, twofa } of accounts) {
        rows.push({ seller, email, password, twofa, purchaseDate, expiryDate, adjPrice, remaining, refund });
      }
    }
  }
  return rows;
}

// ── Build XLSX buffer ─────────────────────────────────────────────────────────

function buildXlsx(rows: RowData[]): Buffer {
  const DATA_START = 2; // row 0 = header, row 1 = blank spacer

  // Gộp dữ liệu: header + blank + data
  const wsData: any[][] = [
    ["Tên seller", "Email", "Mật khẩu", "2FA", "Giá mua", "Ngày mua", "Hết hạn BH", "Tiền hoàn"],
    ["", "", "", "", "", "", "", ""],
  ];

  // Theo dõi nhóm seller để merge cells
  interface SellerGroup { start: number; end: number }
  const sellerGroups: SellerGroup[] = [];
  let curSeller = "\0"; // sentinel
  let curStart  = DATA_START;

  rows.forEach((r, i) => {
    const rowIdx = DATA_START + i;
    if (r.seller !== curSeller) {
      if (i > 0) sellerGroups.push({ start: curStart, end: rowIdx - 1 });
      curSeller = r.seller;
      curStart  = rowIdx;
    }
    wsData.push([
      r.seller,
      r.email,
      r.password,
      r.twofa,
      r.adjPrice,
      fmtDate(r.purchaseDate),
      fmtDate(r.expiryDate),
      r.refund,
    ]);
  });
  if (rows.length > 0) sellerGroups.push({ start: curStart, end: DATA_START + rows.length - 1 });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // ── Độ rộng cột ─────────────────────────────────────────────────────────────
  ws["!cols"] = [
    { wch: 22 }, // Tên seller
    { wch: 36 }, // Email
    { wch: 22 }, // Mật khẩu
    { wch: 36 }, // 2FA
    { wch: 14 }, // Giá mua
    { wch: 14 }, // Ngày mua
    { wch: 14 }, // Hết hạn BH
    { wch: 14 }, // Tiền hoàn
  ];

  // ── Chiều cao dòng header ─────────────────────────────────────────────────
  ws["!rows"] = [{ hpt: 24 }, { hpt: 6 }]; // header + spacer

  // ── Merge seller cells ───────────────────────────────────────────────────────
  const merges: XLSX.Range[] = [];
  for (const g of sellerGroups) {
    if (g.end > g.start) {
      merges.push({ s: { r: g.start, c: 0 }, e: { r: g.end, c: 0 } });
    }
  }
  ws["!merges"] = merges;

  // ── Styles ───────────────────────────────────────────────────────────────────
  const GREEN  = "92D050";
  const THIN   = (rgb = "AAAAAA") => ({ style: "thin" as const, color: { rgb } });
  const BORDER = { top: THIN(), bottom: THIN(), left: THIN(), right: THIN() };

  const totalCols = 8;
  const totalRows = wsData.length;

  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: "s", v: "" };
      const cell = ws[addr];

      if (r === 0) {
        // Header: nền xanh lá, chữ đen đậm, căn giữa
        cell.s = {
          font:      { bold: true, sz: 11, color: { rgb: "000000" } },
          fill:      { patternType: "solid", fgColor: { rgb: GREEN } },
          alignment: { horizontal: "center", vertical: "center" },
          border:    BORDER,
        };
      } else if (r === 1) {
        // Dòng trống spacer
        cell.s = { fill: { patternType: "solid", fgColor: { rgb: "FFFFFF" } } };
      } else {
        // Dòng dữ liệu: xen kẽ màu trắng / xám nhạt
        const bg  = (r - DATA_START) % 2 === 0 ? "FFFFFF" : "F5F5F5";
        const isNum = c === 4 || c === 7; // Giá mua, Tiền hoàn

        cell.s = {
          font:      { sz: 10 },
          fill:      { patternType: "solid", fgColor: { rgb: bg } },
          alignment: {
            horizontal: isNum ? "right" : c === 0 ? "center" : "left",
            vertical:   "center",
            wrapText:   c === 0,
          },
          border: BORDER,
          ...(isNum ? { numFmt: "#,##0" } : {}),
        };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Danh sách");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── Warranty parsing ──────────────────────────────────────────────────────────

/**
 * Chuẩn hoá tiếng Việt về ASCII để regex dễ match (chỉ dùng nội bộ).
 * "bảo hành" → "bao hanh", "tháng" → "thang", v.v.
 */
function vietNorm(s: string): string {
  return s
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/gi, "a")
    .replace(/[èéẹẻẽêềếệểễ]/gi, "e")
    .replace(/[ìíịỉĩ]/gi, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/gi, "o")
    .replace(/[ùúụủũưừứựửữ]/gi, "u")
    .replace(/[ỳýỵỷỹ]/gi, "y")
    .replace(/[đ]/gi, "d");
}

/**
 * Đọc thời hạn bảo hành (số ngày) từ tên sản phẩm.
 *
 * Quy tắc (không phân biệt hoa/thường):
 *   KBH / không bảo hành          → 0
 *   BH 7 ngày / BH 7D / 7D BHF   → 7
 *   BH 1 tháng / BH 1TH / 1m     → 30
 *   BH 2 tháng / 2TH              → 60
 *   BHF / bảo hành full / BH full → 30
 *   BH (không có số)              → 30
 *   Không có gì                   → 30  (default)
 */
function parseWarrantyDays(productName: string): number {
  const s = vietNorm(productName ?? "").toLowerCase();

  // KBH / không bảo hành → 0
  if (/\bkbh\b|khong bao hanh/.test(s)) return 0;

  // BHF số ngày: "bhf 7d", "bhf 7 ngay", "bh 7d", "bh 7 ngay", "7d bhf", "7 ngay bhf"
  const dayMatch =
    s.match(/\bbhf?\s*(\d+)\s*(?:d\b|days?\b|ngay\b)/) ||
    s.match(/\b(\d+)\s*(?:d\b|days?\b|ngay\b)\s*bhf?\b/);
  if (dayMatch) return parseInt(dayMatch[1]);

  // Tháng: "bh 1 thang", "bh 1th", "bhf 2th", "1th bhf", "1m"
  const monthMatch =
    s.match(/\bbhf?\s*(\d+)\s*(?:th\b|thang\b|months?\b)/) ||
    s.match(/\b(\d+)\s*(?:th\b|thang\b|months?\b)\s*bhf?\b/) ||
    s.match(/\b(\d+)m\b/);
  if (monthMatch) return parseInt(monthMatch[1]) * 30;

  // BHF alone / bảo hành full / bh full → 30
  if (/\bbhf\b|bao hanh full|\bbh\s+full\b/.test(s)) return 30;

  // BH alone (có bảo hành nhưng không ghi rõ số) → default 30
  if (/\bbh\b/.test(s)) return 30;

  // Không có thông tin bảo hành → mặc định 30
  return 30;
}

// ── Keyword extraction ────────────────────────────────────────────────────────

/** Prefix vô nghĩa ở đầu tên sản phẩm */
const SKIP_PREFIX_RE = /^(cdk|api|admin|slot|code|mã|key|tk|redeem|add|hot|vip|best seller|best|top)\s+/i;

/**
 * Token bảo hành / mô tả tài khoản — loại bỏ hoàn toàn khi extract keyword.
 *
 * Bao gồm:
 *   - bhf, bh, bv, bvh, kbh            (bảo hành / không bảo hành)
 *   - \d+d, \d+day, \d+days            (30D, 30day)
 *   - \d+m, \d+th                      (1m, 3m, 1th, 2th)
 *   - \d+ngay, \d+thang                (30ngay)
 *   - full                             (bảo hành full)
 *   - acc, cấp, cap, slot, ngày        (loại tài khoản)
 *   - apple, pay, gmail, icloud, phone (chi tiết phụ)
 *   - via                              (via gmail...)
 */
const NOISE_TOKEN_RE = /^(bhf|bvh?|bh|kbh|full|via|acc|c[aấ]p|slot|ngày|ngay|ngan|thang|th|tháng|apple|pay|gmail|icloud|phone|\d+(m|d|th|day|days|ngay|thang))$/i;

/**
 * Extract keyword ngắn gọn từ tên sản phẩm để dùng trong rule include.
 * "ChatGPT 1m Acc cấp BHF"         → "chatgpt plus" (nếu có Plus ở các đơn khác)
 * "ChatGPT Plus Apple Pay BHF 30D" → "chatgpt plus"
 * "CHATGPT PLUS 30D BHF"           → "chatgpt plus"
 * "Grok supper 30D BHF"            → "grok supper"
 */
function extractKeyword(productName: string): string {
  let s = productName
    .replace(/[^\w\s\u00C0-\u024F\u1E00-\u1EFF]/g, " ")
    .replace(/\[.*?\]/g, " ").replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ").trim();

  // Bỏ prefix vô nghĩa ở đầu (lặp tối đa 3 lần)
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(SKIP_PREFIX_RE, "").trim();
    if (s === before) break;
  }

  // Lọc từng token — bỏ noise, giữ lại từ có ý nghĩa (≥ 2 ký tự, không phải số thuần)
  const words = s.toLowerCase()
    .split(/\s+/)
    .filter(w =>
      w.length >= 2 &&
      !/^\d+$/.test(w) &&
      !NOISE_TOKEN_RE.test(w)
    );

  return words.slice(0, 2).join(" ").trim() || productName.slice(0, 20).toLowerCase();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /bot/export-sheet/suggestions — gợi ý rule từ đơn hàng còn bảo hành
router.get("/bot/export-sheet/suggestions", requireAuth, (_req: any, res: any) => {
  const allOrders: Record<string, any> = readJson("market_orders", {}) ?? {};

  // Group by (seller, keyword) — chỉ đếm đơn CÒN bảo hành (remaining > 0)
  const groups = new Map<string, {
    seller:     string;
    keyword:    string;
    products:   Set<string>;   // tên gốc để hiển thị đại diện
    count:      number;
    price:      number;
    minRemain:  number;        // số ngày BH còn lại tối thiểu trong nhóm
    warranty:   number;        // warranty_days gợi ý cho rule (max trong nhóm)
  }>();

  for (const o of Object.values(allOrders)) {
    const seller  = (o.seller       ?? "").trim();
    const product = (o.product_name ?? "").trim();
    if (!seller && !product) continue;

    // Đọc thời hạn BH thực tế từ tên sản phẩm
    const warrantyDays = parseWarrantyDays(product);
    if (warrantyDays === 0) continue;               // KBH → bỏ

    // Tính còn bảo hành không
    const pDate = parsePurchaseDate(o);
    if (!pDate) continue;                           // không có ngày → bỏ
    const remaining = calcRemaining(pDate, warrantyDays);
    if (remaining <= 0) continue;                   // hết bảo hành → bỏ

    const keyword = extractKeyword(product);
    const key     = `${seller}|||${keyword}`;
    const price   = parsePrice(o.price ?? "");

    if (!groups.has(key)) {
      groups.set(key, { seller, keyword, products: new Set(), count: 0, price: 0, minRemain: 999, warranty: 0 });
    }
    const g = groups.get(key)!;
    g.count++;
    g.products.add(product);
    if (price) g.price = price;
    if (remaining  < g.minRemain) g.minRemain = remaining;
    if (warrantyDays > g.warranty) g.warranty = warrantyDays;  // lấy cao nhất làm gợi ý
  }

  const suggestions = Array.from(groups.values())
    .sort((a, b) => {
      const sa = a.seller.toLowerCase().replace(/^@/, "");
      const sb = b.seller.toLowerCase().replace(/^@/, "");
      if (sa !== sb) return sa.localeCompare(sb, "vi");
      return a.keyword.localeCompare(b.keyword, "vi");
    })
    .map(g => ({
      seller:    g.seller,
      keyword:   g.keyword,
      product:   [...g.products].sort((a, b) => a.length - b.length)[0], // tên ngắn nhất làm đại diện
      count:     g.count,
      price:     g.price,
      minRemain: g.minRemain === 999 ? 0 : g.minRemain,
      warranty:  g.warranty,   // warranty_days gợi ý cho rule
    }));

  res.json({ total: suggestions.length, suggestions });
});

// GET /bot/export-sheet/config
router.get("/bot/export-sheet/config", requireAuth, (_req: any, res: any) => {
  res.json(readJson("export_sheet_config", { rules: [] }));
});

// PUT /bot/export-sheet/config
router.put("/bot/export-sheet/config", requireAuth, (req: any, res: any) => {
  const body = req.body ?? {};
  if (!Array.isArray(body.rules)) return res.status(400).json({ error: "rules phải là mảng" });
  writeJson("export_sheet_config", { rules: body.rules });
  res.json({ ok: true });
});

// POST /bot/export-sheet/preview
router.post("/bot/export-sheet/preview", requireAuth, (req: any, res: any) => {
  const rule = req.body ?? {};
  const rows  = filterAndBuild(rule);
  res.json({
    total: rows.length,
    rows: rows.map(r => ({
      seller:    r.seller,
      email:     r.email,
      password:  r.password,
      twofa:     r.twofa,
      price:     r.adjPrice,
      date:      fmtDate(r.purchaseDate),
      expiry:    fmtDate(r.expiryDate),
      remaining: r.remaining,
      refund:    r.refund,
    })),
  });
});

// POST /bot/export-sheet/download
router.post("/bot/export-sheet/download", requireAuth, (req: any, res: any) => {
  const rule = req.body ?? {};
  if (!rule) return res.status(400).json({ error: "Thiếu thông tin rule" });

  const rows = filterAndBuild(rule);
  if (!rows.length) {
    return res.status(200).json({ ok: false, message: "Không có đơn nào khớp với rule này." });
  }

  const buf = buildXlsx(rows);

  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safeName = (rule.name || "export").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
  const filename = `${safeName}_${today}.xlsx`;

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
});

export default router;
