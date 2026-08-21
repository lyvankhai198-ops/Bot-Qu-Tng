import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../lib/auth";
import { readJson, writeJson, addLog, now } from "../lib/dataUtils";
import {
  TG_TOKEN,
  sendTelegramMessage,
  buildReplacementMessage,
} from "../lib/telegram";

const router = Router();

// ── Warranty group status helper ──────────────────────────────────────────────
const TERMINAL_STATUSES = ["resolved", "rejected", "done"];
function _recomputeGroupStatus(req: any): void {
  const accs: any[] = req.accounts ?? [];
  const statuses = accs.map((a: any) => a.status ?? "pending");
  if (statuses.length > 0 && statuses.every((s: string) => TERMINAL_STATUSES.includes(s))) {
    req.status = "resolved";
    if (!req.resolvedAt) req.resolvedAt = now();
    req.reminderEnabled = false; req.nextReminderAt = null; req.reminderProcessing = false;
  } else if (req.acknowledgedAt || statuses.some((s: string) => s === "processing")) {
    if (req.status !== "resolved") req.status = "processing";
  }
}

// ── GET /bot/warranty ─────────────────────────────────────────────────────────
router.get("/bot/warranty", requireAuth, (_req: any, res: any) => {
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  res.json(requests.sort((a: any, b: any) => b.submittedAt?.localeCompare(a.submittedAt ?? "") ?? 0));
});

// ── POST /bot/warranty/:id/replacement ───────────────────────────────────────
router.post("/bot/warranty/:id/replacement", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { email, password, twoFA, note } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ ok: false, message: "Email và mật khẩu là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const replacementData = { replacementEmail: email, replacementPassword: password, replacementTwoFA: twoFA || null, replacementNote: note || null, resolvedAt: now(), resolvedBy: "web-admin" };
  const message = buildReplacementMessage(req_, email, password, twoFA, note);
  const result = await sendTelegramMessage(req_.userId, message);
  const orders: any = readJson("orders", {}) ?? {};
  if (req_.orderId && orders[req_.orderId]) { orders[req_.orderId].status = "warranted"; await writeJson("orders", orders); }

  // Write replacement chain record
  if (req_.orderId) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[req_.orderId] ?? [];
    const prevEmailLower = (req_.email || "").toLowerCase();
    const itemIdx = prevEmailLower
      ? itemList.findIndex((it: any) =>
          (it.original_account || it.email || "").toLowerCase() === prevEmailLower ||
          (it.current_account  || it.email || "").toLowerCase() === prevEmailLower)
      : -1;
    if (itemIdx !== -1) {
      const item = itemList[itemIdx];
      const repNumber = (item.current_replacement_number ?? 0) + 1;
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[item.itemId]) allReps[item.itemId] = [];
      allReps[item.itemId].push({ id: crypto.randomUUID().slice(0, 12), orderId: req_.orderId, orderItemId: item.itemId, previousAccount: item.current_account || item.email || "", newAccount: email, newPassword: password, newTwoFA: twoFA || null, replacementNumber: repNumber, deliveredAt: now(), reason: note || "", supportTicketId: id, createdBy: "web-admin", createdAt: now(), status: "delivered" });
      await writeJson("account_replacements", allReps);
      itemList[itemIdx] = { ...item, current_account: email, current_password: password, current_two_fa: twoFA || null, current_replacement_number: repNumber, item_status: "active", updatedAt: now() };
      orderItems[req_.orderId] = itemList;
      await writeJson("order_items", orderItems);
    } else {
      const newItemId = crypto.randomUUID().slice(0, 8).toUpperCase();
      const order = orders[req_.orderId] ?? {};
      const newItem: any = { itemId: newItemId, orderId: req_.orderId, email: req_.email || email, original_account: req_.email || "", current_account: email, current_password: password, current_two_fa: twoFA || null, current_replacement_number: 1, original_delivered_at: order.purchaseDate || order.paymentAt || now(), productName: order.productName || "", warranty_days: order.warrantyDays || 0, item_status: "active", createdAt: now(), updatedAt: now(), _from_warranty_replacement: true };
      itemList.push(newItem);
      orderItems[req_.orderId] = itemList;
      await writeJson("order_items", orderItems);
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[newItemId]) allReps[newItemId] = [];
      allReps[newItemId].push({ id: crypto.randomUUID().slice(0, 12), orderId: req_.orderId, orderItemId: newItemId, previousAccount: req_.email || "", newAccount: email, newPassword: password, newTwoFA: twoFA || null, replacementNumber: 1, deliveredAt: now(), reason: note || "", supportTicketId: id, createdBy: "web-admin", createdAt: now(), status: "delivered" });
      await writeJson("account_replacements", allReps);
    }
  }
  const reminderOff = { reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  if (result.ok) {
    requests[idx] = { ...req_, ...replacementData, ...reminderOff, status: "resolved", resolution: `replacement:${email}`, sentStatus: "sent", sentAt: now(), sentError: null };
    await writeJson("warranty_requests", requests);
    addLog("WARRANTY_REPLACEMENT", `${id} → ${email} | sent OK`, "web-admin").catch(() => {});
    res.json({ ok: true, sentStatus: "sent", message: "Đã gửi tài khoản thay thế cho khách" });
  } else {
    requests[idx] = { ...req_, ...replacementData, ...reminderOff, status: "send_failed", resolution: `replacement:${email}`, sentStatus: "failed", sentError: result.error, sentAt: null };
    await writeJson("warranty_requests", requests);
    addLog("WARRANTY_REPLACEMENT_FAIL", `${id} → ${email} | ${result.error}`, "web-admin").catch(() => {});
    res.json({ ok: false, sentStatus: "failed", message: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/resend-ack ─────────────────────────────────────────
router.post("/bot/warranty/:id/resend-ack", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  if (!req_.acknowledgedAt) { res.status(400).json({ ok: false, message: "Yêu cầu chưa được tiếp nhận" }); return; }
  const orderId = req_.orderId || "N/A";
  const msg = `✅ <b>YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN</b>\n\nMã đơn: <code>${orderId}</code>\n\nShop đã nhận được yêu cầu bảo hành của bạn và đang tiến hành kiểm tra. Kết quả xử lý sẽ được bot thông báo ngay khi hoàn tất. Vui lòng chờ và không gửi lại yêu cầu trùng lặp.`;
  const result = await sendTelegramMessage(req_.userId, msg);
  if (result.ok) {
    requests[idx] = { ...req_, ackNotifSentStatus: "sent", ackNotifSentAt: now(), ackNotifError: null };
    await writeJson("warranty_requests", requests);
    addLog("WARRANTY_ACK_RESEND", `${id} → sent OK`, "web-admin").catch(() => {});
    res.json({ ok: true, message: "Đã gửi lại thông báo tiếp nhận cho khách" });
  } else {
    requests[idx] = { ...req_, ackNotifSentStatus: "failed", ackNotifError: result.error };
    await writeJson("warranty_requests", requests);
    res.json({ ok: false, message: `Gửi lại thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/accounts/:accId/replacement ───────────────────────
router.post("/bot/warranty/:id/accounts/:accId/replacement", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { email, password, twoFA, note } = req.body ?? {};
  if (!email || !password) { res.status(400).json({ ok: false, message: "Email và mật khẩu là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  const userLang = req_.userLang ?? "vi"; const isEN = userLang === "en";
  const msgLines: string[] = [];
  if (isEN) {
    msgLines.push(`✅ <b>WARRANTY RESOLVED</b>\n`); msgLines.push(`📧 Old account: <code>${acc.email}</code>`);
    msgLines.push(`🔑 <b>Replacement account:</b>`); msgLines.push(`📧 Email: <code>${email}</code>`);
    msgLines.push(`🔒 Password: <code>${password}</code>`);
    if (twoFA) msgLines.push(`🛡 2FA: <code>${twoFA}</code>`); if (note) msgLines.push(`📝 Note: ${note}`);
    msgLines.push(`\nPlease verify your account immediately after receiving.`);
  } else {
    msgLines.push(`✅ <b>ĐÃ GIẢI QUYẾT BẢO HÀNH</b>\n`); msgLines.push(`📧 Tài khoản cũ: <code>${acc.email}</code>`);
    msgLines.push(`🔑 <b>Tài khoản thay thế:</b>`); msgLines.push(`📧 Email: <code>${email}</code>`);
    msgLines.push(`🔒 Mật khẩu: <code>${password}</code>`);
    if (twoFA) msgLines.push(`🛡 2FA: <code>${twoFA}</code>`); if (note) msgLines.push(`📝 Ghi chú: ${note}`);
    msgLines.push(`\nVui lòng kiểm tra tài khoản ngay sau khi nhận.`);
  }
  const result = await sendTelegramMessage(req_.userId, msgLines.join("\n"));
  const accOrderId = acc.orderId || req_.orderId || "";
  const accEmail   = (acc.email || "").toLowerCase();
  if (accOrderId && accEmail) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[accOrderId] ?? [];
    const itemIdx = itemList.findIndex((it: any) => (it.original_account || it.email || "").toLowerCase() === accEmail || (it.current_account || it.email || "").toLowerCase() === accEmail);
    if (itemIdx !== -1) {
      const item = itemList[itemIdx]; const repNumber = (item.current_replacement_number ?? 0) + 1;
      const allReps: any = readJson("account_replacements", {}) ?? {};
      if (!allReps[item.itemId]) allReps[item.itemId] = [];
      allReps[item.itemId].push({ id: crypto.randomUUID().slice(0, 12), orderId: accOrderId, orderItemId: item.itemId, previousAccount: item.current_account || item.email || "", newAccount: email, newPassword: password, newTwoFA: twoFA || null, replacementNumber: repNumber, deliveredAt: now(), reason: note || "", supportTicketId: id, createdBy: "web-admin", createdAt: now(), status: "delivered" });
      await writeJson("account_replacements", allReps);
      itemList[itemIdx] = { ...item, current_account: email, current_password: password, current_two_fa: twoFA || null, current_replacement_number: repNumber, item_status: "active", updatedAt: now() };
      orderItems[accOrderId] = itemList;
      await writeJson("order_items", orderItems);
    }
  }
  const replacementData = { replacementEmail: email, replacementPassword: password, replacementTwoFA: twoFA || null, replacementNote: note || null, resolvedAt: now(), resolvedBy: "web-admin", status: "resolved", resolution: `replacement:${email}`, sentStatus: result.ok ? "sent" : "failed", sentAt: result.ok ? now() : null, sentError: result.ok ? null : result.error };
  requests[idx].accounts[accIdx] = { ...acc, ...replacementData };
  _recomputeGroupStatus(requests[idx]);
  await writeJson("warranty_requests", requests);
  addLog("GROUP_REPLACEMENT", `${id}/${accId} → ${email}`, "web-admin").catch(() => {});
  res.json({ ok: result.ok, sentStatus: result.ok ? "sent" : "failed", message: result.ok ? "Đã gửi tài khoản thay thế cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/accounts/:accId/refund ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/refund", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { amount, note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  if (acc.status === "resolved" && (acc.resolution || "").startsWith("refund:")) { res.status(400).json({ ok: false, code: "ORDER_ALREADY_REFUNDED", message: "Tài khoản này đã được hoàn tiền rồi." }); return; }
  const refundedAt = now();
  requests[idx].accounts[accIdx] = { ...acc, status: "resolved", resolution: `refund:${amount}`, resolvedAt: refundedAt, resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  await writeJson("warranty_requests", requests);
  const accOrderId = acc.orderId || req_.orderId || ""; const accEmailLower = (acc.email || "").toLowerCase();
  let foundItemId: string | null = null;
  if (accOrderId && accEmailLower) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    const itemList: any[] = orderItems[accOrderId] ?? [];
    for (let i = 0; i < itemList.length; i++) {
      const it = itemList[i];
      if ((it.original_account || it.email || "").toLowerCase() === accEmailLower || (it.current_account || it.email || "").toLowerCase() === accEmailLower) {
        foundItemId = it.itemId || null;
        itemList[i] = { ...it, item_status: "refunded", refunded_at: refundedAt, refund_amount: Number(amount), refund_admin_id: "web-admin", support_enabled: false }; break;
      }
    }
    orderItems[accOrderId] = itemList; await writeJson("order_items", orderItems);
    const allRefunded = itemList.every((it: any) => it.item_status === "refunded");
    if (allRefunded) { const orders: any = readJson("orders", {}) ?? {}; if (orders[accOrderId]) { orders[accOrderId].status = "refunded"; orders[accOrderId].refundedAt = refundedAt; orders[accOrderId].refundAmount = Number(amount); await writeJson("orders", orders); } }
  }
  const history: any[] = readJson("refund_history", []) ?? [];
  history.push({ id: crypto.randomUUID(), warrantyRequestId: id, orderId: accOrderId || null, orderItemId: foundItemId, orderCode: accOrderId || null, account: acc.email || "", email: acc.email || "", amount: Number(amount), note: note || "", refundedAt, refundedBy: "web-admin", reason: note || "", supportTicketId: id });
  await writeJson("refund_history", history);
  const msg = `💰 <b>Hoàn tiền tài khoản: <code>${acc.email}</code></b>\n\nSố tiền: <b>${Number(amount).toLocaleString("vi")}đ</b>${note ? `\nGhi chú: ${note}` : ""}`;
  await sendTelegramMessage(req_.userId, msg);
  addLog("GROUP_REFUND", `${id}/${accId} → ${amount}đ`, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── POST /bot/warranty/:id/accounts/:accId/reject ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/reject", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { reason } = req.body ?? {};
  if (!reason) { res.status(400).json({ ok: false, message: "Lý do là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  requests[idx].accounts[accIdx] = { ...acc, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now(), resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  await writeJson("warranty_requests", requests);
  await sendTelegramMessage(req_.userId, `❌ <b>Tài khoản <code>${acc.email}</code> không được bảo hành.</b>\n\nLý do: ${reason}`);
  addLog("GROUP_REJECT", `${id}/${accId}: ${reason}`, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã từ chối" });
});

// ── POST /bot/warranty/:id/accounts/:accId/respond ───────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/respond", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const { message } = req.body ?? {};
  if (!message || !String(message).trim()) { res.status(400).json({ ok: false, message: "Nội dung phản hồi không được rỗng" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  const sentAt = now();
  const responseEntry = { message: String(message).trim(), sentAt, adminId: "web-admin" };
  const newAccStatus = acc.status === "pending" ? "processing" : acc.status;
  requests[idx].accounts[accIdx] = { ...acc, status: newAccStatus, responses: [...(acc.responses ?? []), responseEntry] };
  if (!req_.acknowledgedAt) { requests[idx].acknowledgedAt = sentAt; requests[idx].acknowledgedBy = "web-admin"; }
  _recomputeGroupStatus(requests[idx]);
  await writeJson("warranty_requests", requests);
  const result = await sendTelegramMessage(req_.userId, `💬 <b>Phản hồi từ admin (tài khoản <code>${acc.email}</code>):</b>\n\n${String(message).trim()}`);
  addLog("GROUP_RESPOND", `${id}/${accId}: ${String(message).trim().slice(0, 60)}`, "web-admin").catch(() => {});
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi phản hồi cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/accounts/:accId/resend ────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/resend", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  if (!acc.replacementEmail || !acc.replacementPassword) { res.status(400).json({ ok: false, message: "Không có thông tin tài khoản thay thế" }); return; }
  const fakeReq = { ...req_, orderId: acc.orderId, productName: acc.productName };
  const message = buildReplacementMessage(fakeReq, acc.replacementEmail, acc.replacementPassword, acc.replacementTwoFA, acc.replacementNote);
  const result = await sendTelegramMessage(req_.userId, message);
  if (result.ok) {
    requests[idx].accounts[accIdx] = { ...acc, sentStatus: "sent", sentAt: now(), sentError: null };
  } else {
    requests[idx].accounts[accIdx] = { ...acc, sentStatus: "failed", sentError: result.error };
  }
  await writeJson("warranty_requests", requests);
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi lại thành công" : `Gửi lại thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/resend ─────────────────────────────────────────────
router.post("/bot/warranty/:id/resend", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  if (!req_.replacementEmail || !req_.replacementPassword) { res.status(400).json({ ok: false, message: "Không có thông tin tài khoản thay thế để gửi lại" }); return; }
  const message = buildReplacementMessage(req_, req_.replacementEmail, req_.replacementPassword, req_.replacementTwoFA, req_.replacementNote);
  const result = await sendTelegramMessage(req_.userId, message);
  if (result.ok) {
    requests[idx] = { ...req_, status: "resolved", sentStatus: "sent", sentAt: now(), sentError: null };
    await writeJson("warranty_requests", requests);
    addLog("WARRANTY_RESEND", `${id} → ${req_.replacementEmail} | OK`, "web-admin").catch(() => {});
    res.json({ ok: true, message: "Đã gửi lại thành công" });
  } else {
    requests[idx] = { ...req_, sentStatus: "failed", sentError: result.error };
    await writeJson("warranty_requests", requests);
    res.status(500).json({ ok: false, message: `Gửi lại thất bại: ${result.error}` });
  }
});

// ── POST /bot/warranty/:id/refund ─────────────────────────────────────────────
router.post("/bot/warranty/:id/refund", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { amount, note, adminName } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  if (req_.status === "resolved" && (req_.resolution || "").startsWith("refund:")) { res.status(400).json({ ok: false, code: "ORDER_ALREADY_REFUNDED", message: "Đơn hàng này đã được hoàn tiền rồi. Không thể hoàn tiền lần hai." }); return; }
  const resolvedBy = adminName || "web-admin"; const refundedAt = now();
  const email = req_.email || (req_.accounts && req_.accounts[0]?.originalEmail) || "";
  requests[idx] = { ...req_, status: "resolved", resolution: `refund:${amount}`, resolvedAt: refundedAt, resolvedBy, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  for (let i = 0; i < requests.length; i++) {
    if (i === idx) continue;
    const r = requests[i];
    if (r.orderId === req_.orderId && (r.email || "") === email && !["resolved", "rejected", "refunded"].includes(r.status)) {
      requests[i] = { ...r, status: "refunded", resolvedAt: refundedAt, resolvedBy, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
    }
  }
  await writeJson("warranty_requests", requests);
  const orderItems: any = readJson("order_items", {}) ?? {};
  const emailLower = email.toLowerCase(); let foundItemId: string | null = null;
  if (req_.orderId && emailLower) {
    const itemList: any[] = orderItems[req_.orderId] ?? [];
    for (let i = 0; i < itemList.length; i++) {
      const it = itemList[i];
      if ((it.original_account || it.email || "").toLowerCase() === emailLower || (it.current_account || it.email || "").toLowerCase() === emailLower) {
        foundItemId = it.itemId || null;
        itemList[i] = { ...it, item_status: "refunded", refunded_at: refundedAt, refund_amount: Number(amount), refund_admin_id: resolvedBy, support_enabled: false }; break;
      }
    }
    orderItems[req_.orderId] = itemList; await writeJson("order_items", orderItems);
    const orders: any = readJson("orders", {}) ?? {};
    if (orders[req_.orderId]) { orders[req_.orderId].status = "refunded"; orders[req_.orderId].refundedAt = refundedAt; orders[req_.orderId].refundAmount = Number(amount); await writeJson("orders", orders); }
  } else if (req_.orderId) {
    const orders: any = readJson("orders", {}) ?? {};
    if (orders[req_.orderId]) { orders[req_.orderId].status = "refunded"; orders[req_.orderId].refundedAt = refundedAt; orders[req_.orderId].refundAmount = Number(amount); await writeJson("orders", orders); }
  }
  const history: any[] = readJson("refund_history", []) ?? [];
  history.push({ id: crypto.randomUUID(), warrantyRequestId: id, orderId: req_.orderId || null, orderItemId: foundItemId, orderCode: req_.orderId || null, account: email, email, amount: Number(amount), note: note || "", refundedAt, refundedBy: resolvedBy, reason: note || "", supportTicketId: id });
  await writeJson("refund_history", history);
  const amountStr = Number(amount).toLocaleString("vi");
  await sendTelegramMessage(req_.userId, `💰 <b>Hoàn tiền thành công</b>\n\n📧 Tài khoản: <code>${email}</code>\n💵 Số tiền hoàn: <b>${amountStr}đ</b>${note ? `\n\n📝 Ghi chú: ${note}` : ""}\n\n📝 Lưu ý:\nTiền hoàn sẽ được cộng trực tiếp vào ví mua hàng của quý khách tại Kênh Mua Hàng và có thể sử dụng cho các đơn hàng tiếp theo.`);
  addLog("WARRANTY_REFUND", `${id} → ${amountStr}đ | ${email}`, resolvedBy).catch(() => {});
  res.json({ ok: true, message: "Đã xử lý hoàn tiền" });
});

// ── POST /bot/warranty/:id/reject ─────────────────────────────────────────────
router.post("/bot/warranty/:id/reject", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { reason } = req.body ?? {};
  if (!reason) { res.status(400).json({ ok: false, message: "Lý do là bắt buộc" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  requests[idx] = { ...req_, status: "rejected", resolution: `reject:${reason}`, resolvedAt: now(), resolvedBy: "web-admin", reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  await writeJson("warranty_requests", requests);
  await sendTelegramMessage(req_.userId, `❌ <b>Yêu cầu bảo hành không được chấp nhận.</b>\n\nLý do: ${reason}`);
  addLog("WARRANTY_REJECT", `${id}: ${reason}`, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã từ chối" });
});

// ── POST /bot/warranty/:id/done ───────────────────────────────────────────────
router.post("/bot/warranty/:id/done", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const { note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi"; const isEN = userLang === "en";
  requests[idx] = { ...req_, status: "done", resolution: `done:${note || ""}`, resolvedAt: now(), resolvedBy: "web-admin", reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  await writeJson("warranty_requests", requests);
  let msg = isEN ? `✅ <b>Your warranty request has been processed.</b>\n\nIf the issue persists, you can submit a new warranty request.` : `✅ <b>Yêu cầu bảo hành của bạn đã được xử lý xong.</b>\n\nNếu vấn đề vẫn còn tồn tại, bạn có thể gửi yêu cầu bảo hành mới.`;
  if (note) msg += isEN ? `\n\n📝 Note: ${note}` : `\n\n📝 Ghi chú: ${note}`;
  const result = await sendTelegramMessage(req_.userId, msg);
  addLog("WARRANTY_DONE", id, "web-admin").catch(() => {});
  res.json({ ok: result.ok, message: result.ok ? "Đã đánh dấu hoàn thành" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/accounts/:accId/done ───────────────────────────────
router.post("/bot/warranty/:id/accounts/:accId/done", requireAuth, async (req: any, res: any) => {
  const { id, accId } = req.params; const { note } = req.body ?? {};
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id && r.type === "group");
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx];
  const accIdx = (req_.accounts ?? []).findIndex((a: any) => a.id === accId);
  if (accIdx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản con" }); return; }
  const acc = req_.accounts[accIdx];
  requests[idx].accounts[accIdx] = { ...acc, status: "done", resolution: `done:${note || ""}`, resolvedAt: now(), resolvedBy: "web-admin" };
  _recomputeGroupStatus(requests[idx]);
  await writeJson("warranty_requests", requests);
  const userLang = req_.userLang ?? readJson("user_states", {} as any)?.[req_.userId]?.lang ?? "vi"; const isEN = userLang === "en";
  let msg = isEN ? `✅ <b>Account <code>${acc.email}</code> warranty request has been processed.</b>\n\nIf the issue persists, you can submit a new warranty request.` : `✅ <b>Yêu cầu bảo hành tài khoản <code>${acc.email}</code> đã được xử lý xong.</b>\n\nNếu vấn đề vẫn còn tồn tại, bạn có thể gửi yêu cầu bảo hành mới.`;
  if (note) msg += isEN ? `\n\n📝 Note: ${note}` : `\n\n📝 Ghi chú: ${note}`;
  const result = await sendTelegramMessage(req_.userId, msg);
  addLog("GROUP_DONE", `${id}/${accId}`, "web-admin").catch(() => {});
  res.json({ ok: result.ok, message: result.ok ? "Đã đánh dấu hoàn thành" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── POST /bot/warranty/:id/respond ────────────────────────────────────────────
router.post("/bot/warranty/:id/respond", requireAuth, async (req: any, res: any) => {
  const { id } = req.params; const { message } = req.body ?? {};
  if (!message || !String(message).trim()) { res.status(400).json({ ok: false, message: "Nội dung phản hồi không được rỗng" }); return; }
  const requests: any[] = readJson("warranty_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  const req_ = requests[idx]; const sentAt = now();
  const responseEntry = { message: String(message).trim(), sentAt, adminId: "web-admin" };
  const newStatus = req_.status === "pending" ? "processing" : req_.status;
  const ackPatch = req_.acknowledgedAt ? {} : { acknowledgedAt: sentAt, acknowledgedBy: "web-admin" };
  requests[idx] = { ...req_, ...ackPatch, status: newStatus, responses: [...(req_.responses ?? []), responseEntry] };
  await writeJson("warranty_requests", requests);
  const result = await sendTelegramMessage(req_.userId, `💬 <b>Phản hồi từ admin:</b>\n\n${String(message).trim()}`);
  addLog("WARRANTY_RESPOND", `${id}: ${String(message).trim().slice(0, 60)}`, "web-admin").catch(() => {});
  res.json({ ok: result.ok, message: result.ok ? "Đã gửi phản hồi cho khách" : `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` });
});

// ── GET /giveaway/membership-debug/:telegramUserId ────────────────────────────
router.get("/giveaway/membership-debug/:telegramUserId", requireAuth, async (req: any, res: any) => {
  const { telegramUserId } = req.params;
  if (!TG_TOKEN) { res.status(503).json({ error: "TELEGRAM_BOT_TOKEN not configured" }); return; }
  const channels: any[] = readJson("required_channels", []) ?? [];
  const enabled = channels.filter((c: any) => c.enabled !== false);
  const JOINED = new Set(["member", "administrator", "creator"]);
  const CACHE_TTL_HOURS = 6;
  const allMemberships: any = readJson("user_channel_memberships", {}) ?? {};
  const userCache: any = allMemberships[telegramUserId] ?? {};
  function channelCacheKey(ch: any): string { return (ch.chatId || ch.username || ch.id || "").trim().toLowerCase(); }
  function isCacheValid(entry: any): boolean { if (!entry?.is_verified || !entry?.verified_at) return false; return Date.now() < new Date(entry.verified_at).getTime() + CACHE_TTL_HOURS * 3600_000; }
  const results = await Promise.all(enabled.map(async (ch: any) => {
    const rawChatId = (ch.chatId || ch.username || "").trim(); const cacheKey = channelCacheKey(ch); const cached = userCache[cacheKey] ?? null;
    const entry: any = { title: ch.name, channelId: rawChatId || "(none — no chatId configured)", inviteUrl: ch.url || "", enabled: true, savedStatus: cached?.membership_status ?? null, isVerified: cached?.is_verified ?? false, verifiedAt: cached?.verified_at ?? null, lastCheckedAt: cached?.last_checked_at ?? null, cacheValid: cached ? isCacheValid(cached) : false };
    if (!rawChatId) { entry.botCanAccess = null; entry.telegramStatus = null; entry.configError = "No chatId configured — getChatMember cannot be called"; return entry; }
    const normalized = rawChatId.startsWith("-") || rawChatId.startsWith("+") || rawChatId.startsWith("@") ? rawChatId : `@${rawChatId}`;
    try {
      const chatResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChat?chat_id=${encodeURIComponent(normalized)}`);
      const chatData: any = await chatResp.json(); entry.botCanAccess = chatData.ok;
      if (!chatData.ok) { entry.telegramStatus = null; entry.apiError = chatData.description ?? "cannot access channel"; return entry; }
      const mResp = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getChatMember?chat_id=${encodeURIComponent(normalized)}&user_id=${telegramUserId}`);
      const mData: any = await mResp.json();
      if (mData.ok) { entry.telegramStatus = mData.result.status; if (mData.result.status === "restricted") entry.is_member = mData.result.is_member ?? false; }
      else { entry.telegramStatus = null; entry.apiError = mData.description ?? "getChatMember failed"; entry.botCanAccess = false; }
    } catch (e: any) { entry.botCanAccess = false; entry.telegramStatus = null; entry.apiError = e?.message ?? "network error"; }
    return entry;
  }));
  const JOINED_CHECK = (r: any) => { if (!r.channelId || r.channelId.includes("none")) return false; if (r.telegramStatus === "restricted") return r.is_member === true; return JOINED.has(r.telegramStatus); };
  res.json({ telegramUserId, channels: results, allJoined: results.every(JOINED_CHECK), missingCount: results.filter(r => !JOINED_CHECK(r)).length });
});

export default router;
