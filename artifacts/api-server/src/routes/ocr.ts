import { Router } from "express";

// Lazy dynamic import — prevents crash at startup when AI env vars are absent (e.g. VPS)
let _openai: any = null;
async function getOpenAI(): Promise<any> {
  if (!_openai) {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!baseURL || !apiKey) throw new Error("AI env vars not configured on this server. OCR requires AI_INTEGRATIONS_OPENAI_BASE_URL and AI_INTEGRATIONS_OPENAI_API_KEY.");
    const { default: OpenAI } = await import("openai");
    _openai = new OpenAI({ apiKey, baseURL });
  }
  return _openai;
}

const router = Router();

// ── Auth middleware (reuse same pattern as botAdmin) ────────────────────────
const ADMIN_SECRET = process.env.SESSION_SECRET ?? "";

function requireAuth(req: any, res: any, next: any) {
  const auth = req.headers["authorization"] ?? "";
  if (!auth.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  const token = auth.slice(7);
  if (!ADMIN_SECRET || token !== ADMIN_SECRET) { res.status(401).json({ error: "Invalid token" }); return; }
  next();
}

// ── Types ───────────────────────────────────────────────────────────────────
interface ImageInput {
  data: string;       // base64 encoded image
  mimeType: string;   // e.g. "image/jpeg"
  filename?: string;
}

type Confidence = "high" | "medium" | "low";

interface ExtractedField<T = string | null> {
  value: T;
  confidence: Confidence;
}

interface OcrExtractedOrder {
  email: ExtractedField;
  password: ExtractedField;
  twoFA: ExtractedField;
  productName: ExtractedField;
  price: ExtractedField<number | null>;
  customerName: ExtractedField;
  status: ExtractedField;
  purchaseDate: ExtractedField;   // ISO date string YYYY-MM-DD
  paymentMethod: ExtractedField;
  warrantyDays: ExtractedField<number | null>;
}

interface OcrImageResult {
  filename: string;
  success: boolean;
  error?: string;
  extracted?: OcrExtractedOrder;
}

// ── OCR prompt ───────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Bạn là hệ thống trích xuất thông tin đơn hàng từ ảnh chụp màn hình.
Nhiệm vụ: đọc ảnh và trả về JSON với cấu trúc chính xác.

Quy tắc trích xuất:
- Đọc toàn bộ nội dung có trong ảnh, kể cả phần nhỏ
- purchaseDate: ưu tiên "thời gian thanh toán" → "giao lúc" → "tạo lúc". Chỉ lấy phần ngày (YYYY-MM-DD)
- price: trích số tiền (bỏ chữ "đ", "VNĐ", dấu chấm/phẩy ngăn cách ngàn). Ví dụ "90.000đ" → 90000
- warrantyDays: tự suy từ tên sản phẩm: "30D" hoặc "30 ngày" → 30, "3 THÁNG" → 90, "10D" → 10. Trả null nếu không suy được
- status: map về "active"/"expired"/"refunded". "Đã giao" → "active", "Hoàn tiền" → "refunded"
- twoFA: trả null nếu không có
- Chuẩn hóa ký tự tiếng Việt (Unicode NFC)
- confidence: "high" = rõ ràng chắc chắn, "medium" = đọc được nhưng không chắc, "low" = đoán/không tìm thấy

Trả về JSON EXACTLY theo cấu trúc sau, KHÔNG kèm markdown:
{
  "email": {"value": "...", "confidence": "high|medium|low"},
  "password": {"value": "...", "confidence": "high|medium|low"},
  "twoFA": {"value": null, "confidence": "high"},
  "productName": {"value": "...", "confidence": "high|medium|low"},
  "price": {"value": 90000, "confidence": "high|medium|low"},
  "customerName": {"value": "...", "confidence": "high|medium|low"},
  "status": {"value": "active", "confidence": "high|medium|low"},
  "purchaseDate": {"value": "2026-07-18", "confidence": "high|medium|low"},
  "paymentMethod": {"value": "...", "confidence": "high|medium|low"},
  "warrantyDays": {"value": 30, "confidence": "high|medium|low"}
}`;

// ── POST /bot/orders/ocr-extract ─────────────────────────────────────────────
router.post("/bot/orders/ocr-extract", requireAuth, async (req: any, res: any) => {
  const { images } = req.body as { images: ImageInput[] };

  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: "images array required" });
  }
  if (images.length > 20) {
    return res.status(400).json({ error: "Too many images (max 20)" });
  }

  const results: OcrImageResult[] = [];

  for (const img of images) {
    const filename = img.filename || "image";
    try {
      if (!img.data || !img.mimeType) throw new Error("Missing data or mimeType");

      const supported = ["image/jpeg", "image/png", "image/gif", "image/webp"];
      if (!supported.includes(img.mimeType)) throw new Error(`Unsupported type: ${img.mimeType}`);

      const oai = await getOpenAI();
      const response = await oai.chat.completions.create({
        model: "gpt-5.6-luna",
        max_completion_tokens: 1024,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${img.mimeType};base64,${img.data}`,
                  detail: "high",
                },
              },
              { type: "text", text: "Trích xuất thông tin đơn hàng từ ảnh này." },
            ],
          },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? "";
      // Strip any markdown code fences just in case
      const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim();
      const extracted: OcrExtractedOrder = JSON.parse(cleaned);

      results.push({ filename, success: true, extracted });
    } catch (err: any) {
      // Don't log actual passwords or base64 data
      results.push({ filename, success: false, error: String(err?.message ?? "Unknown error") });
    }
  }

  res.json({ results });
});

export default router;
