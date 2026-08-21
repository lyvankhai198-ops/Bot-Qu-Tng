import { Router } from "express";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson } from "../lib/dataUtils";

const router = Router();
const FILE = "support_auto_reply";

const DEFAULT: any = {
  enabled: false,
  greetingMessage: "Xin chào! 👋 Tôi là trợ lý tự động. Hãy mô tả vấn đề để tôi hỗ trợ bạn.",
  fallbackMessage: "Xin lỗi, tôi chưa hiểu câu hỏi này. Bạn nhấn nút bên dưới để gặp nhân viên nhé. 🙋",
  maxRepliesBeforeEscalate: 5,
  escalateKeywords: ["nhân viên", "người thật", "hỗ trợ trực tiếp", "gặp người"],
  workingHours: {
    enabled: false,
    start: "08:00",
    end: "22:00",
    timezone: "Asia/Ho_Chi_Minh",
    outsideHoursMessage: "Ngoài giờ làm việc (8:00-22:00). Bot hỗ trợ trước, nhân viên tiếp nhận trong giờ làm việc.",
  },
  aiLlmEnabled: false,
  aiLlmApiKey: "",
  aiLlmModel: "claude-3-5-haiku-20241022",
  aiLlmPrompt: "Bạn là trợ lý hỗ trợ khách hàng thân thiện. Trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Không bịa đặt thông tin. Nếu không biết, hướng dẫn khách liên hệ nhân viên.",
  faqs: [] as Array<{ id: string; keywords: string[]; reply: string; active: boolean }>,
};

function load() {
  const s = readJson(FILE, {}) ?? {};
  return { ...DEFAULT, ...s, workingHours: { ...DEFAULT.workingHours, ...(s.workingHours ?? {}) } };
}

// GET config
router.get("/bot/auto-reply/config", requireAuth, (_req: any, res: any) => {
  res.json(load());
});

// PUT config (không bao gồm faqs – quản lý riêng)
router.put("/bot/auto-reply/config", requireAuth, async (req: any, res: any) => {
  const cfg: any = load();
  const b = req.body ?? {};

  if (typeof b.enabled === "boolean") cfg.enabled = b.enabled;
  if (typeof b.greetingMessage === "string") cfg.greetingMessage = b.greetingMessage.slice(0, 500);
  if (typeof b.fallbackMessage === "string") cfg.fallbackMessage = b.fallbackMessage.slice(0, 500);
  if (typeof b.maxRepliesBeforeEscalate === "number" && b.maxRepliesBeforeEscalate >= 1 && b.maxRepliesBeforeEscalate <= 30)
    cfg.maxRepliesBeforeEscalate = b.maxRepliesBeforeEscalate;
  if (Array.isArray(b.escalateKeywords))
    cfg.escalateKeywords = b.escalateKeywords.map(String).filter(Boolean).slice(0, 30);
  if (b.workingHours && typeof b.workingHours === "object") {
    const wh = b.workingHours;
    if (typeof wh.enabled === "boolean") cfg.workingHours.enabled = wh.enabled;
    if (typeof wh.start === "string") cfg.workingHours.start = wh.start;
    if (typeof wh.end === "string") cfg.workingHours.end = wh.end;
    if (typeof wh.timezone === "string") cfg.workingHours.timezone = wh.timezone;
    if (typeof wh.outsideHoursMessage === "string") cfg.workingHours.outsideHoursMessage = wh.outsideHoursMessage.slice(0, 500);
  }
  if (typeof b.aiLlmEnabled === "boolean") cfg.aiLlmEnabled = b.aiLlmEnabled;
  if (typeof b.aiLlmApiKey === "string") cfg.aiLlmApiKey = b.aiLlmApiKey;
  if (typeof b.aiLlmModel === "string") cfg.aiLlmModel = b.aiLlmModel;
  if (typeof b.aiLlmPrompt === "string") cfg.aiLlmPrompt = b.aiLlmPrompt.slice(0, 2000);

  await writeJson(FILE, cfg);
  res.json(cfg);
});

// GET faqs
router.get("/bot/auto-reply/faqs", requireAuth, (_req: any, res: any) => {
  res.json(load().faqs ?? []);
});

// POST faq
router.post("/bot/auto-reply/faqs", requireAuth, async (req: any, res: any) => {
  const cfg: any = load();
  const b = req.body ?? {};
  if (!Array.isArray(b.keywords) || !b.keywords.length || typeof b.reply !== "string" || !b.reply.trim())
    return res.status(400).json({ error: "keywords[] and reply required" });
  const item = {
    id: crypto.randomUUID(),
    keywords: b.keywords.map(String).filter(Boolean).slice(0, 20),
    reply: b.reply.trim().slice(0, 1000),
    active: b.active !== false,
  };
  cfg.faqs = [...(cfg.faqs ?? []), item];
  await writeJson(FILE, cfg);
  res.status(201).json(item);
});

// PUT faq/:id
router.put("/bot/auto-reply/faqs/:id", requireAuth, async (req: any, res: any) => {
  const cfg: any = load();
  const idx = (cfg.faqs ?? []).findIndex((f: any) => f.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  const b = req.body ?? {};
  const item = { ...cfg.faqs[idx] };
  if (Array.isArray(b.keywords) && b.keywords.length) item.keywords = b.keywords.map(String).filter(Boolean);
  if (typeof b.reply === "string" && b.reply.trim()) item.reply = b.reply.trim().slice(0, 1000);
  if (typeof b.active === "boolean") item.active = b.active;
  cfg.faqs[idx] = item;
  await writeJson(FILE, cfg);
  res.json(item);
});

// DELETE faq/:id
router.delete("/bot/auto-reply/faqs/:id", requireAuth, async (req: any, res: any) => {
  const cfg: any = load();
  const before = (cfg.faqs ?? []).length;
  cfg.faqs = (cfg.faqs ?? []).filter((f: any) => f.id !== req.params.id);
  if (cfg.faqs.length === before) return res.status(404).json({ error: "Not found" });
  await writeJson(FILE, cfg);
  res.json({ deleted: true });
});

export default router;
