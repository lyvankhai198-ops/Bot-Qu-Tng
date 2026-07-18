import { Router } from "express";
import multer from "multer";

// ── OpenAI-compatible client (Groq preferred, fallback to Replit AI Integration) ─
let _openai: any = null;
let _model: string = "gpt-5.6-luna";

async function getOpenAI(): Promise<any> {
  if (!_openai) {
    // 1. Google Gemini (free tier, OpenAI-compatible, works on VPS)
    const googleKey = process.env.GOOGLE_AI_API_KEY;
    if (googleKey) {
      const { default: OpenAI } = await import("openai");
      _openai = new OpenAI({
        apiKey:  googleKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      });
      _model = "gemini-2.0-flash";
      return _openai;
    }
    // 2. Groq (free, works on VPS)
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      const { default: OpenAI } = await import("openai");
      _openai = new OpenAI({ apiKey: groqKey, baseURL: "https://api.groq.com/openai/v1" });
      _model  = "llama-4-scout-17b-16e-instruct";
      return _openai;
    }
    // 3. Replit AI Integration (only works inside Replit environment)
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (baseURL && apiKey) {
      const { default: OpenAI } = await import("openai");
      _openai = new OpenAI({ apiKey, baseURL });
      _model  = "gpt-5.6-luna";
      return _openai;
    }
    throw new Error("Chưa cấu hình AI: cần GROQ_API_KEY hoặc AI_INTEGRATIONS_OPENAI_BASE_URL");
  }
  return _openai;
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

    if (!files.length) {
      return res.status(400).json({ error: "Không nhận được ảnh. Vui lòng thử lại." });
    }

    const results: Array<{ filename: string; success: boolean; extracted?: any; error?: string }> = [];

    for (const file of files) {
      const filename = file.originalname || "image";
      // Log only technical metadata, never content
      console.info(`OCR: ${filename} ${file.size}B ${file.mimetype}`);
      try {
        const base64   = file.buffer.toString("base64");
        const mimeType = file.mimetype.startsWith("image/") ? file.mimetype : "image/jpeg";

        const oai      = await getOpenAI();
        const response = await oai.chat.completions.create({
          model: _model,
          max_completion_tokens: 1024,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } },
                { type: "text", text: "Trích xuất thông tin đơn hàng từ ảnh này." },
              ],
            },
          ],
        });

        const raw     = response.choices[0]?.message?.content ?? "";
        const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
        const extracted = JSON.parse(cleaned);

        // Validate required field
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
