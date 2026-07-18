import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// ── GET /health/gemini — đã chuyển sang ocr.ts (Tesseract) ──────────────────
router.get("/health/gemini-OLD-REMOVED", async (_req, res) => {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  const model  = "gemini-2.0-flash";

  // 1. Kiểm tra key tồn tại
  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      step: "config",
      error: "GOOGLE_AI_API_KEY chưa được cấu hình",
    });
  }

  // 2. Lấy thông tin project từ API key (qua list models, trả về project trong URL)
  const keyPrefix = `${apiKey.slice(0, 12)}...`;

  // 3. List models — kiểm tra key hợp lệ
  let modelAccessible = false;
  let projectError: string | null = null;
  try {
    const listResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${apiKey}`
    );
    if (listResp.ok) {
      modelAccessible = true;
    } else {
      const d: any = await listResp.json();
      projectError = d?.error?.message ?? `HTTP ${listResp.status}`;
    }
  } catch (e: any) {
    projectError = e.message;
  }

  // 4. Gọi text request đơn giản để kiểm tra quota
  const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const testBody = {
    contents: [{ parts: [{ text: "Hello" }] }],
    generationConfig: { maxOutputTokens: 5 },
  };

  let quotaOk = false;
  let quotaError: any = null;
  let rawResponse: any = null;
  let responseText = "";

  try {
    const resp = await fetch(testUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testBody),
    });

    rawResponse = await resp.json();

    if (resp.ok) {
      quotaOk = true;
      responseText = rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else {
      quotaError = rawResponse?.error ?? rawResponse;

      // Phân tích lý do lỗi
      const msg: string = quotaError?.message ?? "";
      const violations = rawResponse?.error?.details
        ?.find((d: any) => d.violations)?.violations ?? [];

      const hasZeroLimit = violations.some((v: any) =>
        typeof v.quotaId === "string" && v.quotaId.includes("FreeTier")
      );

      if (resp.status === 429 && hasZeroLimit) {
        quotaError._diagnosis =
          "Project chưa bật billing trên Google Cloud Console. " +
          "Free tier limit = 0 (không phải quota hết). " +
          "Fix: https://console.cloud.google.com → Billing → Link billing account.";
      } else if (resp.status === 429) {
        quotaError._diagnosis = "Quota thực sự bị vượt — thử lại sau.";
      } else if (resp.status === 403) {
        quotaError._diagnosis = "API key không có quyền truy cập model này.";
      } else if (resp.status === 400) {
        quotaError._diagnosis = "Request không hợp lệ — kiểm tra cấu hình.";
      }
    }
  } catch (e: any) {
    quotaError = { message: e.message, _diagnosis: "Network error khi gọi Gemini API." };
  }

  // 5. Kết luận
  const ok = quotaOk && modelAccessible;
  return res.status(ok ? 200 : 503).json({
    ok,
    model,
    keyPrefix,
    modelAccessible: projectError ? false : modelAccessible,
    modelError: projectError,
    quota: quotaOk ? "OK" : "FAILED",
    quotaTextTestResponse: quotaOk ? responseText : undefined,
    quotaError: quotaOk ? undefined : quotaError,
    rawGeminiResponse: quotaOk ? undefined : rawResponse,
    conclusion: ok
      ? `✅ Gemini API hoạt động bình thường (model: ${model})`
      : quotaError?._diagnosis ?? "❌ Gemini API không khả dụng",
  });
});

export default router;
