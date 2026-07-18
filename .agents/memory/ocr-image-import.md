---
name: OCR image import
description: OpenAI vision-based order creation from screenshots — setup decisions and constraints
---

# OCR Image Import Feature

## Integration
- Provider: OpenAI via Replit AI Integrations proxy (no user API key)
- Model: gpt-5.6-luna (cost-effective, supports vision)
- Env vars auto-set: AI_INTEGRATIONS_OPENAI_BASE_URL, AI_INTEGRATIONS_OPENAI_API_KEY
- Server package: @workspace/integrations-openai-ai-server (lib/integrations-openai-ai-server/)

## Backend
- Endpoint: POST /api/bot/orders/ocr-extract
- Auth: same Bearer token as all botAdmin routes
- Input: JSON { images: [{ data: base64, mimeType: string, filename?: string }] }
- Output: { results: [{ filename, success, extracted?, error? }] }
- Body limit raised to 20mb in app.ts to accommodate base64 images
- Images never logged; no persistent storage of image data

## Confidence levels
- "high" = clear, "medium" = uncertain (yellow highlight), "low" = unknown (red highlight)
- purchaseDate priority: payment time → delivery time → creation time
- warrantyDays auto-derived from product name pattern (e.g. "30D" → 30, "3 THÁNG" → 90)

## Frontend (ImageImportDialog.tsx)
- Three stages: upload → review → done
- Per-image navigation with color-coded status buttons
- Duplicate handling: block save until admin picks "Bỏ qua" or "Cập nhật đơn cũ"
- Save calls existing POST /bot/orders or PUT /bot/orders/:id depending on dup action

**Why gpt-5.6-luna:** Cost-sensitive; multiple images per session. Luna handles Vietnamese OCR well enough and is cheapest in gpt-5.6 fleet.
