import { Router } from "express";
import multer from "multer";

// ── AI backend ────────────────────────────────────────────────────────────────
let _openai: any = null;

async function getOpenAI(): Promise<any> {
  if (!_openai) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL!;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY!;
    const { default: OpenAI } = await import("openai");
    _openai = new OpenAI({ apiKey, baseURL });
  }
  return _openai;
}

/** Call Gemini REST API directly */
async function callGemini(base64: string, mimeType: string): Promise<string> {
  const apiKey = process.env.GOOGLE_AI_API_KEY!;
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const body   = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [
      { text: "Trích xuất thông tin đơn hàng từ ảnh này." },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ]}],
    generationConfig: { maxOutputTokens: 1024 }
  };
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`Gemini ${resp.status}: ${t.slice(0, 300)}`); }
  const data: any = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** Proxy OCR to Replit api-server (has built-in AI Integration) */
async function proxyToReplit(files: Express.Multer.File[], authHeader: string): Promise<any> {
  const baseUrl = process.env.REPLIT_BASE_URL!;
  const fd = new (globalThis as any).FormData();
  for (const f of files) {
    fd.append("images", new Blob([f.buffer], { type: f.mimetype }), f.originalname);
  }
  const resp = await fetch(`${baseUrl}/api/bot/orders/ocr-extract`, {
    method:  "POST",
    headers: { Authorization: authHeader },
    body:    fd,
  });
  if (!resp.ok) { const t = await resp.text().catch(() => ""); throw new Error(`Replit proxy ${resp.status}: ${t.slice(0, 200)}`); }
  return resp.json();
}

// ── Multer — multipart/form-data, memory storage ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },   // 15 MB per file, max 20
  fileFilter: (_req: any, file: any, cb: any) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"];
    if (ok.includes(file.mimetype) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File không hỗ trợ: ${file.originalname} (${file.mimetype}). Chỉ chấp nhận JPG, PNG, WEBP, HEIC.`));
    }
  },
});

const router = Router();

// ── Auth middleware ──────────────────────────────────────────────────────────
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";
function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!ADMIN_SECRET || auth.slice(7) !== ADMIN_SECRET) { res.status(401).json({ error: "Invalid token" }); return; }
  next();
}

// ── OCR prompt ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Bạn là hệ thống trích xuất thông tin đơn hàng từ ảnh chụp màn hình.
Nhiệm vụ: đọc ảnh và trả về JSON với cấu trúc chính xác.

Quy tắc trích xuất:
- Đọc toàn bộ nội dung có trong ảnh, kể cả phần nhỏ
- purchaseDate: ưu tiên "thời gian thanh toán" → "giao lúc" → "tạo lúc". Chỉ lấy phần ngày, format YYYY-MM-DD
- price: trích số tiền (bỏ chữ "đ", "VNĐ", dấu chấm/phẩy ngăn cách ngàn). Ví dụ "90.000đ" → 90000
- warrantyDays: tự suy từ tên sản phẩm: "30D" hoặc "30 ngày" → 30, "3 THÁNG" → 90, "10D" → 10. Trả null nếu không suy được
- status: map về "active"/"expired"/"refunded". "Đã giao" → "active", "Hoàn tiền" → "refunded"
- twoFA: trả null nếu không có
- email: ưu tiên trường "Email/tài khoản" hoặc "Tài khoản đã giao"
- Chuẩn hóa ký tự tiếng Việt (Unicode NFC)
- confidence: "high" = rõ ràng chắc chắn, "medium" = đọc được nhưng không chắc, "low" = đoán/không tìm thấy

Trả về JSON EXACTLY theo cấu trúc sau, KHÔNG kèm markdown:
{
  "email": {"value": "...", "confidence": "high"},
  "password": {"value": "...", "confidence": "high"},
  "twoFA": {"value": null, "confidence": "high"},
  "productName": {"value": "...", "confidence": "high"},
  "price": {"value": 90000, "confidence": "high"},
  "customerName": {"value": "...", "confidence": "high"},
  "status": {"value": "active", "confidence": "high"},
  "purchaseDate": {"value": "2026-07-18", "confidence": "high"},
  "paymentMethod": {"value": "...", "confidence": "high"},
  "warrantyDays": {"value": 30, "confidence": "high"}
}`;

// ── POST /bot/orders/ocr-extract ─────────────────────────────────────────────
router.post(
  "/bot/orders/ocr-extract",
  requireAuth,
  (req: any, res: any, next: any) => {
    upload.array("images", 20)(req, res, (err: any) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE")
          return res.status(400).json({ error: "File quá lớn (tối đa 15MB mỗi ảnh)" });
        if (err.code === "LIMIT_FILE_COUNT")
          return res.status(400).json({ error: "Quá nhiều ảnh (tối đa 20)" });
        return res.status(400).json({ error: err.message });
      }
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req: any, res: any) => {
    const files: Express.Multer.File[] = req.files ?? [];
    if (!files.length) return res.status(400).json({ error: "Không nhận được ảnh. Vui lòng thử lại." });

    // ── Option A: proxy to Replit api-server (has built-in AI Integration) ──
    if (process.env.REPLIT_BASE_URL) {
      try {
        const data = await proxyToReplit(files, req.headers["authorization"] ?? "");
        return res.json(data);
      } catch (err: any) {
        return res.status(502).json({ error: `OCR proxy error: ${err.message}` });
      }
    }

    // ── Option B: Gemini native REST ─────────────────────────────────────────
    const results: Array<{ filename: string; success: boolean; extracted?: any; error?: string }> = [];

    for (const file of files) {
      const filename = file.originalname || "image";
      console.info(`OCR: ${filename} ${file.size}B ${file.mimetype}`);
      try {
        const base64   = file.buffer.toString("base64");
        const mimeType = file.mimetype.startsWith("image/") ? file.mimetype : "image/jpeg";
        let raw = "";

        if (process.env.GOOGLE_AI_API_KEY) {
          raw = await callGemini(base64, mimeType);
        } else if (process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
          const oai = await getOpenAI();
          const response = await oai.chat.completions.create({
            model: "gpt-5.6-luna",
            max_completion_tokens: 1024,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } },
                { type: "text", text: "Trích xuất thông tin đơn hàng từ ảnh này." },
              ]},
            ],
          });
          raw = response.choices[0]?.message?.content ?? "";
        } else {
          throw new Error("Chưa cấu hình AI. Set REPLIT_BASE_URL hoặc GOOGLE_AI_API_KEY.");
        }

        const cleaned   = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
        const extracted = JSON.parse(cleaned);
        if (!extracted.email?.value) throw new Error("Không tìm thấy email/tài khoản trong ảnh");
        results.push({ filename, success: true, extracted });
      } catch (err: any) {
        results.push({ filename, success: false, error: String(err?.message ?? "Lỗi không xác định") });
      }
    }
    res.json({ results });
  }
);

export default router;
