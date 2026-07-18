/**
 * OCR Route — Tesseract.js (local, no API key, no quota)
 * Engine: tesseract.js v5 với tiếng Việt + tiếng Anh
 * Parser: Rule-based regex cho layout "Chi tiết đơn hàng"
 */
import { Router } from "express";
import multer from "multer";

const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!ADMIN_SECRET || auth.slice(7) !== ADMIN_SECRET) { res.status(401).json({ error: "Invalid token" }); return; }
  next();
}

// ── Multer ────────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
    if (ok.includes(file.mimetype) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error(`Không hỗ trợ: ${file.originalname} (${file.mimetype})`));
  },
});

// ── Tesseract worker (singleton, lazy init) ───────────────────────────────────
let _workerPromise: Promise<any> | null = null;

function getWorker(): Promise<any> {
  if (!_workerPromise) {
    console.info("OCR: Khởi tạo Tesseract worker (vie+eng)...");
    _workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["vie", "eng"], 1, {
        cachePath: "/tmp/tessdata",
        logger: (m: any) => {
          if (m.status === "recognizing text") {
            const pct = Math.round((m.progress ?? 0) * 100);
            if (pct % 25 === 0) console.info(`OCR: ${pct}%`);
          }
        },
      });
      console.info("OCR: Tesseract worker sẵn sàng");
      return worker;
    })().catch(err => {
      _workerPromise = null; // retry next time
      throw err;
    });
  }
  return _workerPromise;
}

// Pre-warm worker khi server khởi động (non-blocking)
setTimeout(() => getWorker().catch(() => {}), 3000);

// ── Normalize OCR output ──────────────────────────────────────────────────────
function normalizeOCR(raw: string): string {
  return raw
    // Loại bỏ ký tự lạ hay xuất hiện trong OCR
    .replace(/[|¦]/g, "I")
    .replace(/[`'']/g, "'")
    // Fix O↔0 khi nằm trong chuỗi số
    .replace(/(\d)O(\d)/g, "$10$2")
    .replace(/^O(\d)/gm, "0$1")
    // Fix l↔1 khi nằm trong số
    .replace(/(\d)l(\d)/g, "$11$2")
    // Dấu hai chấm OCR thường bị tách
    .replace(/\s*:\s*/g, ": ")
    // Khoảng trắng dư
    .replace(/[ \t]+/g, " ")
    // Dòng trắng liên tiếp
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractAfterColon(line: string): string {
  const idx = line.indexOf(":");
  return idx >= 0 ? line.slice(idx + 1).trim() : "";
}

function parsePrice(text: string): number | null {
  if (!text) return null;
  // "90.000đ", "90,000 VND", "90000", "90 000"
  const digits = text.replace(/[^\d]/g, "");
  const n = parseInt(digits, 10);
  return isNaN(n) || n === 0 ? null : n;
}

/**
 * Parse date từ nhiều format:
 *   "10:37:12 18/7/2026" → "2026-07-18"
 *   "18/07/2026"         → "2026-07-18"
 *   "2026-07-18"         → "2026-07-18"
 */
function parseDate(text: string): string | null {
  if (!text) return null;

  // "HH:MM:SS DD/M/YYYY" hoặc "HH:MM DD/M/YYYY"
  const withTime = text.match(/\d+:\d+(?::\d+)?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (withTime) {
    const [, d, m, y] = withTime;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }

  // "DD/MM/YYYY" hoặc "D/M/YYYY"
  const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }

  // ISO "YYYY-MM-DD"
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  return null;
}

function inferWarrantyDays(productName: string): number | null {
  const p = productName.toUpperCase();
  // "30D", "30 DAYS", "30 NGÀY"
  const m1 = p.match(/(\d+)\s*D(?:AY|ays)?(?:\b|$)/);
  if (m1) return parseInt(m1[1], 10);
  const m2 = p.match(/(\d+)\s*NG[ÀA]Y/);
  if (m2) return parseInt(m2[1], 10);
  // "3 THÁNG", "3M", "3 MONTH"
  const m3 = p.match(/(\d+)\s*(?:TH[ÁA]NG|MONTHS?|MO\b)/);
  if (m3) return parseInt(m3[1], 10) * 30;
  // "1 NĂM", "1 YEAR"
  const m4 = p.match(/(\d+)\s*(?:N[ĂA]M|YEARS?|YR)/);
  if (m4) return parseInt(m4[1], 10) * 365;
  return null;
}

function fuzzyMatchProduct(query: string, names: string[]): string | null {
  if (!query || !names.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, "");
  const q = norm(query);
  return names.find(n => norm(n) === q)
    ?? names.find(n => norm(n).includes(q) || q.includes(norm(n)))
    ?? null;
}

// ── Rule-based parser ─────────────────────────────────────────────────────────
type Conf = "high" | "medium" | "low";

interface OcrField<T = string | number | null> {
  value: T;
  confidence: Conf;
}

interface ParsedOrder {
  email:         OcrField<string | null>;
  password:      OcrField<string | null>;
  twoFA:         OcrField<string | null>;
  productName:   OcrField<string | null>;
  price:         OcrField<number | null>;
  customerName:  OcrField<string | null>;
  status:        OcrField<string>;
  purchaseDate:  OcrField<string | null>;
  paymentMethod: OcrField<string | null>;
  warrantyDays:  OcrField<number | null>;
}

function parseRules(text: string, existingProducts: string[] = []): ParsedOrder {
  const result: ParsedOrder = {
    email:         { value: null, confidence: "low" },
    password:      { value: null, confidence: "low" },
    twoFA:         { value: null, confidence: "high" }, // null là OK
    productName:   { value: null, confidence: "low" },
    price:         { value: null, confidence: "low" },
    customerName:  { value: null, confidence: "low" },
    status:        { value: "active", confidence: "low" },
    purchaseDate:  { value: null, confidence: "low" },
    paymentMethod: { value: null, confidence: "low" },
    warrantyDays:  { value: null, confidence: "low" },
  };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Email / Tài khoản ───────────────────────────────────────────────────
    // Patterns: "Email/tài khoản:", "Email:", "Tài khoản đã giao:"
    if (/email\s*[\/|]?\s*t[àa]i\s*kho[ảa]n\s*:/i.test(line) || /^email\s*:/i.test(line)) {
      const val = extractAfterColon(line) || lines[i + 1]?.trim() || "";
      if (val.includes("@") && val.includes(".")) {
        result.email = { value: val.toLowerCase(), confidence: "high" };
      } else if (val && val !== "-") {
        result.email = { value: val, confidence: "medium" };
      }
    }

    // ── Mật khẩu ────────────────────────────────────────────────────────────
    if (/m[aậ]t\s*kh[aẩ]u\s*:/i.test(line)) {
      const val = extractAfterColon(line) || lines[i + 1]?.trim() || "";
      if (val && val !== "-") {
        result.password = { value: val, confidence: "high" };
      }
    }

    // ── Mã 2FA ──────────────────────────────────────────────────────────────
    if (/(?:2fa|m[aã]\s*2fa|x[aá]c\s*th[uự]c)\s*:/i.test(line)) {
      const val = extractAfterColon(line) || "";
      if (val && val !== "-") {
        result.twoFA = { value: val, confidence: "high" };
      }
    }

    // ── Sản phẩm ────────────────────────────────────────────────────────────
    if (/s[aả]n\s*ph[aẩ]m\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") {
        const matched = fuzzyMatchProduct(val, existingProducts);
        result.productName = {
          value:      matched ?? val,
          confidence: matched ? "high" : "medium",
        };
      }
    }

    // ── Số tiền / Giá ────────────────────────────────────────────────────────
    if (/s[oố]\s*ti[eề]n\s*:/i.test(line) || /gi[aá]\s*(?:ti[eề]n)?\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      const num = parsePrice(val);
      if (num !== null) {
        result.price = { value: num, confidence: "high" };
      }
    }

    // ── Khách hàng ───────────────────────────────────────────────────────────
    if (/kh[aá]ch\s*h[aà]ng\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") {
        result.customerName = { value: val, confidence: "high" };
      }
    }

    // ── Trạng thái ───────────────────────────────────────────────────────────
    if (/tr[aạ]ng\s*th[aá]i\s*:/i.test(line)) {
      const val = extractAfterColon(line).toLowerCase();
      if (/[đd][aã]\s*giao|active|ho[aạ]t\s*[đd][oộ]ng/i.test(val)) {
        result.status = { value: "active", confidence: "high" };
      } else if (/ho[aà]n\s*ti[eề]n|refund/i.test(val)) {
        result.status = { value: "refunded", confidence: "high" };
      } else if (/h[eế]t\s*h[aạ]n|expired/i.test(val)) {
        result.status = { value: "expired", confidence: "high" };
      } else if (val && val !== "-") {
        result.status = { value: "active", confidence: "medium" };
      }
    }

    // ── Ngày thanh toán (ưu tiên cao nhất) ───────────────────────────────────
    if (/thanh\s*to[aá]n\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      const dt  = parseDate(val);
      if (dt) result.purchaseDate = { value: dt, confidence: "high" };
    }

    // ── Giao lúc (ưu tiên thứ 2) ─────────────────────────────────────────────
    if (/giao\s*l[uú]c\s*:/i.test(line) && result.purchaseDate.confidence !== "high") {
      const val = extractAfterColon(line);
      const dt  = parseDate(val);
      if (dt) result.purchaseDate = { value: dt, confidence: "medium" };
    }

    // ── Tạo lúc (fallback) ────────────────────────────────────────────────────
    if (/t[aạ]o\s*l[uú]c\s*:/i.test(line) && result.purchaseDate.value === null) {
      const val = extractAfterColon(line);
      const dt  = parseDate(val);
      if (dt) result.purchaseDate = { value: dt, confidence: "medium" };
    }

    // ── Phương thức thanh toán ────────────────────────────────────────────────
    if (/ph[uư][oơ]ng\s*th[uứ]c\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") {
        result.paymentMethod = { value: val, confidence: "high" };
      }
    }
  }

  // ── Suy ra warrantyDays từ tên sản phẩm ─────────────────────────────────────
  if (result.productName.value) {
    const wd = inferWarrantyDays(String(result.productName.value));
    if (wd !== null) {
      result.warrantyDays = { value: wd, confidence: "high" };
    }
  }

  return result;
}

// ── Tính overall confidence ───────────────────────────────────────────────────
function calcOverallConfidence(parsed: ParsedOrder): number {
  const fields = Object.values(parsed);
  const weights: Record<Conf, number> = { high: 1, medium: 0.6, low: 0.2 };
  // Fields mà nếu null thì không tính
  const meaningful = fields.filter(f => f.value !== null);
  if (!meaningful.length) return 0;
  const score = meaningful.reduce((s, f) => s + weights[f.confidence], 0);
  return Math.round((score / meaningful.length) * 100) / 100;
}

// ── Load danh sách sản phẩm từ orders.json ────────────────────────────────────
async function loadExistingProducts(): Promise<string[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { join }     = await import("node:path");
    const raw  = await readFile(join(process.cwd(), "../../data/orders.json"), "utf8");
    const orders: any[] = JSON.parse(raw);
    const names = new Set<string>();
    orders.forEach(o => { if (o.productName) names.add(o.productName); });
    return Array.from(names);
  } catch {
    return [];
  }
}

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

function multerMiddleware(req: any, res: any, next: any) {
  upload.array("images", 20)(req, res, (err: any) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE")  return res.status(400).json({ error: "File quá lớn (tối đa 15MB)" });
      if (err.code === "LIMIT_FILE_COUNT") return res.status(400).json({ error: "Quá nhiều ảnh (tối đa 20)" });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

async function runOCR(req: any, res: any) {
  const files: Express.Multer.File[] = req.files ?? [];
  if (!files.length) return res.status(400).json({ error: "Không nhận được ảnh" });

  let worker: any;
  try {
    worker = await getWorker();
  } catch (err: any) {
    console.error("OCR worker init failed:", err.message);
    return res.status(503).json({
      error: "Tesseract OCR không khởi động được. Kiểm tra cài đặt server.",
      detail: err.message,
    });
  }

  const existingProducts = await loadExistingProducts();
  const results: any[]   = [];

  for (const file of files) {
    const filename = file.originalname || "image";
    console.info(`OCR: ${filename} ${file.size}B ${file.mimetype}`);
    try {
      const { data } = await worker.recognize(file.buffer);
      const rawText  = data.text ?? "";

      if (!rawText.trim()) {
        results.push({ filename, success: false, error: "Không đọc được chữ từ ảnh" });
        continue;
      }

      const normalized = normalizeOCR(rawText);
      const fields     = parseRules(normalized, existingProducts);
      const confidence = calcOverallConfidence(fields);

      if (!fields.email.value) {
        results.push({
          filename,
          success: false,
          error:   "Không tìm thấy email/tài khoản trong ảnh",
          rawText: normalized,
        });
        continue;
      }

      results.push({ filename, success: true, extracted: fields, confidence });
    } catch (err: any) {
      console.error(`OCR error ${filename}:`, err.message);
      results.push({ filename, success: false, error: `Lỗi xử lý ảnh: ${err.message}` });
    }
  }

  return res.json({ results });
}

// Endpoint mới (theo spec)
router.post("/orders/ocr",            requireAuth, multerMiddleware, runOCR);

// Endpoint cũ — giữ backward compat
router.post("/bot/orders/ocr-extract", requireAuth, multerMiddleware, runOCR);

export default router;
