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

/**
 * Stitch email fragments that OCR splits across lines or adds spaces around:
 *   "robertyteoG @\noutlook.com"  → "robertyteoG@outlook.com"
 *   "robertyteoG @ outlook . com" → "robertyteoG@outlook.com"
 *   "robertyteoG@\noutlook.com"   → "robertyteoG@outlook.com"
 * Returns a single-pass normalized string with emails reassembled.
 * Does NOT substitute characters (O→0 etc) inside email tokens.
 */
function stitchEmails(text: string): string {
  // 1. Join lines where one line ends with the local-part@ and next is domain
  let t = text.replace(/([A-Za-z0-9._%+\-]+@)\s*\n\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, "$1$2");
  // 2. Join lines where local-part ends the line and next line starts with @domain
  t = t.replace(/([A-Za-z0-9._%+\-]+)\s*\n\s*@\s*([A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, "$1@$2");
  // 3. Remove spaces around @ (spaces were added by OCR)
  t = t.replace(/([A-Za-z0-9._%+\-])\s+@\s+([A-Za-z0-9.\-])/g, "$1@$2");
  // 4. Remove spaces around dots inside email contexts (between two word chars)
  t = t.replace(/([A-Za-z0-9])\s+\.\s+([A-Za-z0-9])/g, "$1.$2");
  return t;
}

/**
 * Scan the entire text for anything that looks like an email address.
 * Returns unique candidates ordered by proximity to email-related labels.
 */
function scanForEmails(text: string): string[] {
  const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
  const candidates: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    const e = m[0].toLowerCase();
    if (!seen.has(e)) { seen.add(e); candidates.push(m[0]); }
  }
  return candidates;
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
  // No warranty
  if (/\bKBH\b|NO[\s_-]*WARRANTY/.test(p)) return 0;
  // Days: 30D, 30 DAY, 30 DAYS
  const mD = p.match(/(\d+)\s*D(?:AY|AYS)?(?:\b|_|$)/);  if (mD) return parseInt(mD[1], 10);
  // Ngày (Vietnamese)
  const mN = p.match(/(\d+)\s*NG[ÀA]Y/);                  if (mN) return parseInt(mN[1], 10);
  // Months: 1M, 3M, 1 MONTH, 3 MONTHS, 1 THANG
  const mM = p.match(/(\d+)\s*(?:TH[ÁA]NG|MONTHS?|MO\b|M\b)/); if (mM) return parseInt(mM[1], 10) * 30;
  // Years: 1Y, 1YR, 1 YEAR, 1 NAM
  const mY = p.match(/(\d+)\s*(?:N[ĂA]M|YEARS?|YR\b|Y\b)/); if (mY) return parseInt(mY[1], 10) * 365;
  return null;
}

/**
 * Strict product matching: only exact or near-exact.
 * Avoids false positives like matching "Grok" inside "GROK SUPER 30D BHF".
 */
function fuzzyMatchProduct(query: string, names: string[]): string | null {
  if (!query || !names.length) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, "");
  const q = norm(query);
  // 1. Exact match
  const exact = names.find(n => norm(n) === q);
  if (exact) return exact;
  // 2. Query starts with the product name (e.g. OCR has extra suffix)
  const startsWith = names.find(n => q.startsWith(norm(n)) && norm(n).length >= 4);
  if (startsWith) return startsWith;
  // 3. Product name starts with query (OCR truncated)
  const nameStartsWithQ = names.find(n => norm(n).startsWith(q) && q.length >= 4);
  if (nameStartsWithQ) return nameStartsWithQ;
  return null;
}

/**
 * Core helper: find a label in lines (ignoring case, colons, bullet points, extra spaces)
 * and return the value — either inline (after ":") or on the very next non-empty line.
 * Skips up to 1 blank line between label and value.
 */
function getValueAfterLabel(lines: string[], labels: string[]): string | null {
  const normLabel = (s: string) =>
    s.toLowerCase()
      .replace(/^[•·●\-\*\s]+/, "")  // strip leading bullets/dashes
      .replace(/:\s*$/, "")           // strip trailing colon
      .replace(/\s+/g, " ")
      .trim();

  const normLabels = labels.map(normLabel);

  for (let i = 0; i < lines.length; i++) {
    const rawLine  = lines[i];
    const lineNorm = normLabel(rawLine);

    // Case A: whole line is the label (value on next line, or after colon)
    const isPureLabel = normLabels.some(lbl => lineNorm === lbl);

    // Case B: line is "Label: value" on the same line
    const inlineLabel = normLabels.find(lbl =>
      lineNorm.startsWith(lbl + ":") || lineNorm.startsWith(lbl + " :")
    );

    if (!isPureLabel && !inlineLabel) continue;

    // Try inline value first (works for both A with trailing colon, and B)
    const colonIdx = rawLine.indexOf(":");
    if (colonIdx >= 0) {
      const inline = rawLine.slice(colonIdx + 1).trim();
      if (inline && inline !== "-") return inline;
    }

    // Fallback: take next non-empty line (skip up to 1 blank)
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = lines[j]?.trim().replace(/^[•·●]\s*/, ""); // strip bullet
      if (next && next !== "-") return next;
    }
  }
  return null;
}

// ── Rule-based parser ─────────────────────────────────────────────────────────
type Conf = "high" | "medium" | "low";
interface OcrField<T = string | number | null> { value: T; confidence: Conf; }

interface ParsedOrder {
  email:         OcrField<string | null>;
  password:      OcrField<string | null>;
  twoFA:         OcrField<string | null>;
  productName:   OcrField<string | null>;  // fuzzy-matched name (or raw if no match)
  productRaw:    OcrField<string | null>;  // full OCR text, unmodified
  price:         OcrField<number | null>;
  customerName:  OcrField<string | null>;
  status:        OcrField<string>;
  purchaseDate:  OcrField<string | null>;
  paymentMethod: OcrField<string | null>;
  warrantyDays:  OcrField<number | null>;
}

function parseRules(text: string, existingProducts: string[] = []): ParsedOrder {
  const result: ParsedOrder = {
    email:         { value: null,        confidence: "low" },
    password:      { value: null,        confidence: "low" },
    twoFA:         { value: null,        confidence: "high" }, // null is normal
    productName:   { value: null,        confidence: "low" },
    productRaw:    { value: null,        confidence: "low" },
    price:         { value: null,        confidence: "low" },
    customerName:  { value: null,        confidence: "low" },
    status:        { value: "active",    confidence: "low" },
    purchaseDate:  { value: null,        confidence: "low" },
    paymentMethod: { value: null,        confidence: "low" },
    warrantyDays:  { value: null,        confidence: "low" },
  };

  // Pre-stitch email fragments before splitting into lines
  const stitched = stitchEmails(text);
  const lines = stitched.split("\n").map(l => l.trim()).filter(Boolean);

  // ── Email / Tài khoản ──────────────────────────────────────────────────────
  // Priority 1: label-based extraction
  const emailRaw = getValueAfterLabel(lines, [
    "email/tài khoản", "email / tài khoản", "email/tai khoan",
    "tài khoản đã giao", "tai khoan da giao",
    "email", "tài khoản", "tai khoan", "account",
  ]);
  if (emailRaw && emailRaw !== "-") {
    result.email = {
      value:      emailRaw.toLowerCase(),
      confidence: emailRaw.includes("@") ? "high" : "medium",
    };
  }

  // Priority 2: regex fallback — scan entire stitched text for any email
  if (!result.email.value) {
    const candidates = scanForEmails(stitched);
    if (candidates.length) {
      result.email = { value: candidates[0].toLowerCase(), confidence: "medium" };
    }
  }

  // ── Mật khẩu ──────────────────────────────────────────────────────────────
  const passRaw = getValueAfterLabel(lines, ["mật khẩu", "mat khau", "password"]);
  if (passRaw && passRaw !== "-") result.password = { value: passRaw, confidence: "high" };

  // ── Mã 2FA ─────────────────────────────────────────────────────────────────
  const tfaRaw = getValueAfterLabel(lines, ["2fa", "mã 2fa", "ma 2fa", "xác thực", "xac thuc"]);
  if (tfaRaw && tfaRaw !== "-") result.twoFA = { value: tfaRaw, confidence: "high" };

  // ── Sản phẩm ───────────────────────────────────────────────────────────────
  const prodRaw = getValueAfterLabel(lines, ["sản phẩm", "san pham", "product", "tên sản phẩm"]);
  if (prodRaw && prodRaw !== "-") {
    result.productRaw = { value: prodRaw, confidence: "high" };
    // Strict fuzzy match — keep full raw name if no confident match found
    const matched = fuzzyMatchProduct(prodRaw, existingProducts);
    result.productName = matched
      ? { value: matched, confidence: "high" }
      : { value: prodRaw, confidence: "medium" }; // show full raw to admin
  }

  // ── Số tiền / Giá ──────────────────────────────────────────────────────────
  const priceRaw = getValueAfterLabel(lines, [
    "số tiền", "so tien", "tổng tiền", "tong tien",
    "giá", "gia", "giá tiền", "gia tien", "thanh toán", "thanh toan",
  ]);
  if (priceRaw) {
    const num = parsePrice(priceRaw);
    if (num !== null) result.price = { value: num, confidence: "high" };
  }

  // ── Khách hàng ─────────────────────────────────────────────────────────────
  const custRaw = getValueAfterLabel(lines, [
    "khách hàng", "khach hang", "người mua", "nguoi mua", "tên khách", "ten khach",
  ]);
  if (custRaw && custRaw !== "-") result.customerName = { value: custRaw, confidence: "high" };

  // ── Trạng thái ─────────────────────────────────────────────────────────────
  const statusRaw = getValueAfterLabel(lines, ["trạng thái", "trang thai", "status"]);
  if (statusRaw && statusRaw !== "-") {
    const v = statusRaw.toLowerCase();
    if      (/[đd][aã]\s*giao|delivered/i.test(v))              result.status = { value: "delivered", confidence: "high" };
    else if (/ho[aạ]t\s*[đd][oộ]ng|active/i.test(v))           result.status = { value: "active",    confidence: "high" };
    else if (/ho[aà]n\s*ti[eề]n|refund/i.test(v))              result.status = { value: "refunded",  confidence: "high" };
    else if (/h[eế]t\s*h[aạ]n|expired/i.test(v))               result.status = { value: "expired",   confidence: "high" };
    else if (/[đd]ang\s*x[uử]\s*l[yý]|processing/i.test(v))    result.status = { value: "processing",confidence: "high" };
    else                                                         result.status = { value: "active",    confidence: "medium" };
  }

  // ── Ngày mua: ưu tiên Thanh toán > Giao lúc > Tạo lúc ────────────────────
  const thanhToanRaw = getValueAfterLabel(lines, ["thanh toán", "thanh toan", "payment"]);
  if (thanhToanRaw) {
    const dt = parseDate(thanhToanRaw);
    if (dt) result.purchaseDate = { value: dt, confidence: "high" };
  }
  if (!result.purchaseDate.value) {
    const giaoLucRaw = getValueAfterLabel(lines, ["giao lúc", "giao luc", "delivered at"]);
    if (giaoLucRaw) {
      const dt = parseDate(giaoLucRaw);
      if (dt) result.purchaseDate = { value: dt, confidence: "medium" };
    }
  }
  if (!result.purchaseDate.value) {
    const taoLucRaw = getValueAfterLabel(lines, ["tạo lúc", "tao luc", "created at", "tạo"]);
    if (taoLucRaw) {
      const dt = parseDate(taoLucRaw);
      if (dt) result.purchaseDate = { value: dt, confidence: "low" };
    }
  }

  // ── Phương thức thanh toán ─────────────────────────────────────────────────
  const pmRaw = getValueAfterLabel(lines, [
    "phương thức", "phuong thuc", "phương thức thanh toán",
    "payment method", "thanh toán bằng",
  ]);
  if (pmRaw && pmRaw !== "-") result.paymentMethod = { value: pmRaw, confidence: "high" };

  // ── Suy ra warrantyDays từ tên sản phẩm ───────────────────────────────────
  const prodForWarranty = result.productRaw.value ?? result.productName.value;
  if (prodForWarranty) {
    const wd = inferWarrantyDays(String(prodForWarranty));
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

      const rawLines      = normalized.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const emailCandidates = scanForEmails(stitchEmails(rawText));

      // Never log passwords/2FA in production
      const safeLog = { email: fields.email.value ?? "—", product: fields.productRaw.value ?? fields.productName.value ?? "—", price: fields.price.value ?? "—", purchaseDate: fields.purchaseDate.value ?? "—" };
      console.info(`OCR done: ${filename} | conf=${confidence} |`, safeLog);

      // Always return success:true with whatever was parsed.
      // emailWarning signals the frontend to show a manual-entry prompt for email.
      const emailWarning = !fields.email.value
        ? "Chưa nhận diện được email. Vui lòng kiểm tra ảnh hoặc nhập thủ công."
        : undefined;

      results.push({
        filename,
        success: true,
        extracted: fields,
        confidence,
        emailWarning,
        emailCandidates,
        rawLines,
      });
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
