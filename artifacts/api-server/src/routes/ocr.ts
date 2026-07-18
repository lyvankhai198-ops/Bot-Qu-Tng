/**
 * OCR Route — System Tesseract (local, no API key, no quota)
 * Engine: tesseract-ocr + tesseract-ocr-vie (cài qua apt)
 * Parser: Rule-based regex cho layout "Chi tiết đơn hàng"
 */
import { Router }                      from "express";
import multer                          from "multer";
import { execFile }                    from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir }                      from "node:os";
import { join }                        from "node:path";

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
    const ok = ["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif"];
    if (ok.includes(file.mimetype) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.originalname))
      cb(null, true);
    else
      cb(new Error(`Không hỗ trợ: ${file.originalname} (${file.mimetype})`));
  },
});

// ── System Tesseract via child_process ────────────────────────────────────────
let _tesseractOk: boolean | null = null;

async function checkTesseract(): Promise<boolean> {
  if (_tesseractOk !== null) return _tesseractOk;
  return new Promise(resolve => {
    execFile("tesseract", ["--version"], {}, err => {
      _tesseractOk = !err;
      if (err) console.error("Tesseract not found:", err.message);
      else     console.info("OCR: Tesseract available");
      resolve(_tesseractOk!);
    });
  });
}

// Pre-check at startup
setTimeout(() => checkTesseract(), 1000);

async function runTesseract(buffer: Buffer, mimeType: string): Promise<string> {
  const ext     = mimeType.includes("png") ? "png" : "jpg";
  const ts      = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inFile  = join(tmpdir(), `ocr-${ts}.${ext}`);
  const outBase = join(tmpdir(), `ocr-${ts}-out`);

  try {
    await writeFile(inFile, buffer);

    await new Promise<void>((resolve, reject) => {
      // --psm 6 = assume uniform block of text (phù hợp với form có nhãn : giá trị)
      execFile(
        "tesseract",
        [inFile, outBase, "-l", "vie+eng", "--psm", "6", "--oem", "3"],
        { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`Tesseract: ${err.message}${stderr ? ` | ${stderr.slice(0, 200)}` : ""}`));
          else resolve();
        }
      );
    });

    return await readFile(`${outBase}.txt`, "utf8");
  } finally {
    for (const f of [inFile, `${outBase}.txt`]) {
      try { await unlink(f); } catch {}
    }
  }
}

// ── Normalize OCR output ──────────────────────────────────────────────────────
function normalizeOCR(raw: string): string {
  return raw
    // Ký tự OCR lỗi phổ biến
    .replace(/[|¦]/g, "I")
    .replace(/[`'']/g, "'")
    // O↔0 khi nằm giữa/cuối số
    .replace(/(\d)O(\d)/g, "$10$2")
    .replace(/^O(\d)/gm, "0$1")
    // Dấu hai chấm bị tách
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
  const digits = text.replace(/[^\d]/g, "");
  const n = parseInt(digits, 10);
  return isNaN(n) || n === 0 ? null : n;
}

function parseDate(text: string): string | null {
  if (!text) return null;
  // "HH:MM:SS DD/M/YYYY" hoặc "HH:MM DD/M/YYYY"
  const withTime = text.match(/\d+:\d+(?::\d+)?\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (withTime) {
    const [, d, m, y] = withTime;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  // "DD/MM/YYYY"
  const dmy = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  // ISO
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}

function inferWarrantyDays(productName: string): number | null {
  const p = productName.toUpperCase();
  const m1 = p.match(/(\d+)\s*D(?:AY|AYS)?(?:\b|$)/);   if (m1) return parseInt(m1[1], 10);
  const m2 = p.match(/(\d+)\s*NG[ÀA]Y/);                 if (m2) return parseInt(m2[1], 10);
  const m3 = p.match(/(\d+)\s*(?:TH[ÁA]NG|MONTHS?|MO\b)/); if (m3) return parseInt(m3[1], 10) * 30;
  const m4 = p.match(/(\d+)\s*(?:N[ĂA]M|YEARS?|YR)/);   if (m4) return parseInt(m4[1], 10) * 365;
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
interface OcrField<T = string | number | null> { value: T; confidence: Conf; }

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
    email:         { value: null,     confidence: "low" },
    password:      { value: null,     confidence: "low" },
    twoFA:         { value: null,     confidence: "high" },  // null là bình thường
    productName:   { value: null,     confidence: "low" },
    price:         { value: null,     confidence: "low" },
    customerName:  { value: null,     confidence: "low" },
    status:        { value: "active", confidence: "low" },
    purchaseDate:  { value: null,     confidence: "low" },
    paymentMethod: { value: null,     confidence: "low" },
    warrantyDays:  { value: null,     confidence: "low" },
  };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Email / Tài khoản ─────────────────────────────────────────────────────
    if (/email\s*[\/|]?\s*t[àa]i\s*kho[ảa]n\s*:/i.test(line) || /^email\s*:/i.test(line)) {
      const val = extractAfterColon(line) || lines[i + 1]?.trim() || "";
      if (val && val !== "-") {
        result.email = {
          value:      val.toLowerCase(),
          confidence: val.includes("@") ? "high" : "medium",
        };
      }
    }

    // ── Mật khẩu ─────────────────────────────────────────────────────────────
    if (/m[aậ]t\s*kh[aẩ]u\s*:/i.test(line)) {
      const val = extractAfterColon(line) || lines[i + 1]?.trim() || "";
      if (val && val !== "-") result.password = { value: val, confidence: "high" };
    }

    // ── Mã 2FA ────────────────────────────────────────────────────────────────
    if (/(?:2fa|m[aã]\s*2fa|x[aá]c\s*th[uự]c)\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") result.twoFA = { value: val, confidence: "high" };
    }

    // ── Sản phẩm ─────────────────────────────────────────────────────────────
    if (/s[aả]n\s*ph[aẩ]m\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") {
        const matched = fuzzyMatchProduct(val, existingProducts);
        result.productName = { value: matched ?? val, confidence: matched ? "high" : "medium" };
      }
    }

    // ── Số tiền / Giá ─────────────────────────────────────────────────────────
    if (/s[oố]\s*ti[eề]n\s*:/i.test(line) || /gi[aá]\s*(?:ti[eề]n)?\s*:/i.test(line)) {
      const num = parsePrice(extractAfterColon(line));
      if (num !== null) result.price = { value: num, confidence: "high" };
    }

    // ── Khách hàng ───────────────────────────────────────────────────────────
    if (/kh[aá]ch\s*h[aà]ng\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") result.customerName = { value: val, confidence: "high" };
    }

    // ── Trạng thái ───────────────────────────────────────────────────────────
    if (/tr[aạ]ng\s*th[aá]i\s*:/i.test(line)) {
      const val = extractAfterColon(line).toLowerCase();
      if      (/[đd][aã]\s*giao|active|ho[aạ]t\s*[đd][oộ]ng/i.test(val))  result.status = { value: "active",   confidence: "high" };
      else if (/ho[aà]n\s*ti[eề]n|refund/i.test(val))                      result.status = { value: "refunded", confidence: "high" };
      else if (/h[eế]t\s*h[aạ]n|expired/i.test(val))                       result.status = { value: "expired",  confidence: "high" };
      else if (val && val !== "-")                                           result.status = { value: "active",   confidence: "medium" };
    }

    // ── Thanh toán (ưu tiên cao nhất cho purchaseDate) ───────────────────────
    if (/thanh\s*to[aá]n\s*:/i.test(line)) {
      const dt = parseDate(extractAfterColon(line));
      if (dt) result.purchaseDate = { value: dt, confidence: "high" };
    }

    // ── Giao lúc (ưu tiên thứ 2) ─────────────────────────────────────────────
    if (/giao\s*l[uú]c\s*:/i.test(line) && result.purchaseDate.confidence !== "high") {
      const dt = parseDate(extractAfterColon(line));
      if (dt) result.purchaseDate = { value: dt, confidence: "medium" };
    }

    // ── Tạo lúc (fallback) ────────────────────────────────────────────────────
    if (/t[aạ]o\s*l[uú]c\s*:/i.test(line) && result.purchaseDate.value === null) {
      const dt = parseDate(extractAfterColon(line));
      if (dt) result.purchaseDate = { value: dt, confidence: "medium" };
    }

    // ── Phương thức thanh toán ────────────────────────────────────────────────
    if (/ph[uư][oơ]ng\s*th[uứ]c\s*:/i.test(line)) {
      const val = extractAfterColon(line);
      if (val && val !== "-") result.paymentMethod = { value: val, confidence: "high" };
    }
  }

  // ── Suy ra warrantyDays từ tên sản phẩm ─────────────────────────────────────
  if (result.productName.value) {
    const wd = inferWarrantyDays(String(result.productName.value));
    if (wd !== null) result.warrantyDays = { value: wd, confidence: "high" };
  }

  return result;
}

function calcOverallConfidence(parsed: ParsedOrder): number {
  const weights: Record<Conf, number> = { high: 1, medium: 0.6, low: 0.2 };
  const meaningful = Object.values(parsed).filter(f => f.value !== null);
  if (!meaningful.length) return 0;
  const score = meaningful.reduce((s, f) => s + weights[f.confidence], 0);
  return Math.round((score / meaningful.length) * 100) / 100;
}

async function loadExistingProducts(): Promise<string[]> {
  try {
    const { readFile: rf } = await import("node:fs/promises");
    const { join: j }      = await import("node:path");
    const raw  = await rf(j(process.cwd(), "../../data/orders.json"), "utf8");
    const orders: any[] = JSON.parse(raw);
    const names = new Set<string>();
    orders.forEach(o => { if (o.productName) names.add(o.productName); });
    return Array.from(names);
  } catch { return []; }
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

  // Kiểm tra tesseract
  const ok = await checkTesseract();
  if (!ok) {
    return res.status(503).json({
      error: "Tesseract OCR chưa được cài. Chạy: apt install tesseract-ocr tesseract-ocr-vie",
    });
  }

  const existingProducts = await loadExistingProducts();
  const results: any[]   = [];

  for (const file of files) {
    const filename = file.originalname || "image";
    console.info(`OCR: ${filename} ${file.size}B ${file.mimetype}`);
    try {
      const rawText    = await runTesseract(file.buffer, file.mimetype);

      if (!rawText.trim()) {
        results.push({ filename, success: false, error: "Không đọc được chữ từ ảnh" });
        continue;
      }

      const normalized = normalizeOCR(rawText);
      const fields     = parseRules(normalized, existingProducts);
      const confidence = calcOverallConfidence(fields);

      console.info(`OCR done: ${filename} | email=${fields.email.value ?? "—"} | conf=${confidence}`);

      if (!fields.email.value) {
        results.push({ filename, success: false, error: "Không tìm thấy email/tài khoản trong ảnh", rawText: normalized.slice(0, 500) });
        continue;
      }

      results.push({ filename, success: true, extracted: fields, confidence });
    } catch (err: any) {
      console.error(`OCR error ${filename}:`, err.message);
      results.push({ filename, success: false, error: err.message });
    }
  }

  return res.json({ results });
}

// ── GET /health/gemini — kept for backward compat, now returns Tesseract status ─
router.get("/health/gemini", async (_req, res) => {
  const ok = await checkTesseract();
  // Check langs
  const langs = await new Promise<string[]>(resolve => {
    execFile("tesseract", ["--list-langs"], {}, (_err, stdout, stderr) => {
      const out = (stdout || stderr || "").split("\n").map(l => l.trim()).filter(Boolean);
      resolve(out);
    });
  });
  res.status(ok ? 200 : 503).json({
    ok,
    engine:  "Tesseract OCR (local)",
    langs:   langs.filter(l => /^[a-z]{3}/.test(l)),
    hasVie:  langs.includes("vie"),
    hasEng:  langs.includes("eng"),
    conclusion: ok
      ? `✅ Tesseract OCR hoạt động (langs: ${langs.filter(l => /^[a-z]{3}/.test(l)).join(", ")})`
      : "❌ Tesseract chưa được cài. Chạy: apt install tesseract-ocr tesseract-ocr-vie",
  });
});

// Endpoint mới (theo spec)
router.post("/orders/ocr",            requireAuth, multerMiddleware, runOCR);
// Endpoint cũ — backward compat
router.post("/bot/orders/ocr-extract", requireAuth, multerMiddleware, runOCR);

export default router;
