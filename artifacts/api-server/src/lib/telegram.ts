/**
 * telegram.ts — Shared Telegram messaging helpers
 * Used by warranty routes and delivery routes.
 */
import { readJson } from "./dataUtils";

export const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

export async function sendTelegramMessage(
  userId: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: userId, text: message, parse_mode: "HTML" }),
    });
    const data: any = await resp.json();
    if (data.ok) return { ok: true };
    return { ok: false, error: data.description ?? "Telegram error" };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network error" };
  }
}

export async function sendTelegramWithCallbackButton(
  userId: string,
  message: string,
  buttonText: string,
  callbackData: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!TG_TOKEN) return { ok: false, error: "TELEGRAM_BOT_TOKEN not set" };
  try {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: userId,
        text: message,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
        },
      }),
    });
    const data: any = await resp.json();
    if (data.ok) return { ok: true };
    return { ok: false, error: data.description ?? "Telegram error" };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network error" };
  }
}

export function buildReplacementMessage(
  req_: any,
  email: string,
  password: string,
  twoFA?: string,
  note?: string,
): string {
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi";
  const isEN = userLang === "en";
  const lines: string[] = [];
  if (isEN) {
    lines.push(`✅ <b>WARRANTY REQUEST RESOLVED</b>\n`);
    lines.push(`📦 Order: <code>${req_.orderId}</code>`);
    if (req_.productName) lines.push(`🛍 Product: <b>${req_.productName}</b>`);
    lines.push(`\n🔑 <b>Replacement Account:</b>`);
    lines.push(`📧 Email/Account: <code>${email}</code>`);
    lines.push(`🔒 Password: <code>${password}</code>`);
    if (twoFA) lines.push(`🛡 2FA / Extra info: <code>${twoFA}</code>`);
    if (note) lines.push(`📝 Note: ${note}`);
    lines.push(`\nPlease verify your account immediately after receiving.`);
  } else {
    lines.push(`✅ <b>YÊU CẦU BẢO HÀNH ĐÃ ĐƯỢC GIẢI QUYẾT</b>\n`);
    lines.push(`📦 Mã đơn: <code>${req_.orderId}</code>`);
    if (req_.productName) lines.push(`🛍 Sản phẩm: <b>${req_.productName}</b>`);
    lines.push(`\n🔑 <b>Tài khoản thay thế:</b>`);
    lines.push(`📧 Email/Tài khoản: <code>${email}</code>`);
    lines.push(`🔒 Mật khẩu: <code>${password}</code>`);
    if (twoFA) lines.push(`🛡 2FA/Thông tin bổ sung: <code>${twoFA}</code>`);
    if (note) lines.push(`📝 Ghi chú: ${note}`);
    lines.push(`\nVui lòng kiểm tra tài khoản ngay sau khi nhận.`);
  }
  return lines.join("\n");
}
