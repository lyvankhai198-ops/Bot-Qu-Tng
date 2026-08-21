import { Router } from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { requireAuth } from "../lib/auth";
import {
  readJson, writeJson, addLog, now, DATA_DIR, readSettings,
} from "../lib/dataUtils";
import { sendTelegramMessage, sendTelegramWithCallbackButton } from "../lib/telegram";

const router = Router();

// ── GET /bot/orders ───────────────────────────────────────────────────────────
router.get("/bot/orders", requireAuth, async (_req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const result: any[] = Object.values(orders).map((order: any) => {
    let status = order.status || "active";
    if (status !== "refunded") {
      const weStr = order.warrantyExpiry || order.warrantyDate || "";
      if (weStr) {
        try { const expiry = new Date(weStr.slice(0, 10)); status = expiry >= today ? "active" : "expired"; } catch {}
      }
    }
    return { ...order, status };
  });

  result.sort((a: any, b: any) => {
    const ta = a.createdAt || a.purchaseDate || "";
    const tb = b.createdAt || b.purchaseDate || "";
    return tb.localeCompare(ta);
  });

  // Auto-sync refunded orders → refund_history
  const refundHistory: any[] = readJson("refund_history", []) ?? [];
  const refundedInHistory = new Set(refundHistory.map((r: any) => r.orderId).filter(Boolean));
  let historyDirty = false;
  for (const order of result) {
    if (order.status === "refunded" && order.orderId && !refundedInHistory.has(order.orderId)) {
      refundHistory.push({ id: crypto.randomUUID(), warrantyRequestId: null, orderId: order.orderId, orderCode: order.orderId, account: order.email || "", email: order.email || "", amount: Number(order.refundAmount || 0), note: "Tự động đồng bộ từ đơn hàng", refundedAt: order.refundedAt || now(), refundedBy: order.refundedBy || "system", reason: "", source: "order" });
      refundedInHistory.add(order.orderId);
      historyDirty = true;
    }
  }
  if (historyDirty) await writeJson("refund_history", refundHistory);
  res.json(result);
});

// ── POST /bot/orders ──────────────────────────────────────────────────────────
router.post("/bot/orders", requireAuth, async (req: any, res: any) => {
  const body = req.body ?? {};
  const orders: any = readJson("orders", {}) ?? {};
  const orderId = body.orderCode ? String(body.orderCode).trim().toUpperCase() : "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
  const { orderCode: _oc, ...rest } = body;
  const order = { ...rest, orderId, createdAt: now() };
  orders[orderId] = order;
  await writeJson("orders", orders);
  if (order.email) {
    const orderItems: any = readJson("order_items", {}) ?? {};
    if (!orderItems[orderId]) orderItems[orderId] = [];
    const alreadyExists = (orderItems[orderId] as any[]).some((it: any) => it.email?.toLowerCase() === order.email.toLowerCase());
    if (!alreadyExists) {
      const itemWd = Number(order.warrantyDays || 0); let itemWarrantyEnd: string | null = null;
      if (order.purchaseDate && itemWd) { try { const d = new Date(order.purchaseDate.slice(0, 10)); d.setDate(d.getDate() + itemWd); itemWarrantyEnd = d.toISOString().slice(0, 10); } catch {} }
      if (!itemWarrantyEnd && (order.warrantyExpiry || order.warrantyDate)) itemWarrantyEnd = (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null;
      orderItems[orderId].push({ itemId: crypto.randomUUID().slice(0, 8).toUpperCase(), email: order.email, original_account: order.email, current_account: order.email, current_replacement_number: 0, original_delivered_at: order.purchaseDate || now(), warranty_days: itemWd || null, warranty_end_date: itemWarrantyEnd, item_status: order.status ?? "active", password: order.password ?? null, twoFA: order.twoFA ?? null, status: order.status ?? "active", createdAt: now() });
      await writeJson("order_items", orderItems);
    }
  }
  addLog("CREATE_ORDER", orderId, "web-admin").catch(() => {});
  res.json(order);
});

// ── POST /bot/orders/bulk ─────────────────────────────────────────────────────
router.post("/bot/orders/bulk", requireAuth, async (req: any, res: any) => {
  const body = req.body ?? {};
  const { productName, price, purchaseDate, expiryDate, warrantyExpiry, usagePeriod, warrantyPeriod, notes, accounts, orderCode, status, warrantyDays, customerName, paymentMethod } = body;
  if (!productName || !purchaseDate || !Array.isArray(accounts) || accounts.length === 0) { res.status(400).json({ ok: false, message: "productName, purchaseDate và accounts là bắt buộc" }); return; }
  const orders: any = readJson("orders", {}) ?? {}; const orderItems: any = readJson("order_items", {}) ?? {};
  const errors: { email: string; reason: string }[] = []; let added = 0, skipped = 0;
  if (orderCode) {
    const sharedId = String(orderCode).trim().toUpperCase();
    const existingItemEmails = new Set<string>();
    for (const itemList of Object.values(orderItems) as any[][]) for (const it of itemList) if (it.email) existingItemEmails.add(it.email.toLowerCase());
    if (!orders[sharedId]) orders[sharedId] = { orderId: sharedId, productName, price: price ?? null, purchaseDate: purchaseDate ?? null, expiryDate: expiryDate ?? null, warrantyExpiry: warrantyExpiry ?? null, warrantyDays: warrantyDays ?? null, usagePeriod: usagePeriod ?? null, warrantyPeriod: warrantyPeriod ?? null, customerName: customerName ?? null, paymentMethod: paymentMethod ?? null, notes: notes ?? null, status: status ?? "active", quantity: 0, createdAt: now() };
    if (!orderItems[sharedId]) orderItems[sharedId] = [];
    for (const acc of accounts) {
      const email: string = (acc.email ?? "").trim();
      if (!email) { errors.push({ email: "(trống)", reason: "Thiếu email" }); skipped++; continue; }
      if (existingItemEmails.has(email.toLowerCase())) { errors.push({ email, reason: "Email đã tồn tại trong hệ thống" }); skipped++; continue; }
      const bWd = Number(warrantyDays || 0); let bWarrantyEnd: string | null = null;
      if (purchaseDate && bWd) { try { const d = new Date((purchaseDate as string).slice(0, 10)); d.setDate(d.getDate() + bWd); bWarrantyEnd = d.toISOString().slice(0, 10); } catch {} }
      if (!bWarrantyEnd && warrantyExpiry) bWarrantyEnd = (warrantyExpiry as string).slice(0, 10) || null;
      orderItems[sharedId].push({ itemId: crypto.randomUUID().slice(0, 8).toUpperCase(), email, original_account: email, current_account: email, current_replacement_number: 0, original_delivered_at: purchaseDate || now(), warranty_days: bWd || null, warranty_end_date: bWarrantyEnd, item_status: "active", password: acc.password || null, twoFA: acc.twoFA || null, status: "active", createdAt: now() });
      existingItemEmails.add(email.toLowerCase()); added++;
    }
    orders[sharedId].quantity = orderItems[sharedId].length;
    await writeJson("orders", orders); await writeJson("order_items", orderItems);
    addLog("BULK_CREATE_ORDERS", `orderCode=${sharedId} added=${added} skipped=${skipped}`, "web-admin").catch(() => {});
    return res.json({ added, skipped, errors, orderId: sharedId });
  }
  const existingEmails = new Set(Object.values(orders).map((o: any) => (o.email ?? "").toLowerCase()));
  for (const acc of accounts) {
    const email: string = (acc.email ?? "").trim();
    if (!email) { errors.push({ email: "(trống)", reason: "Thiếu email" }); skipped++; continue; }
    if (existingEmails.has(email.toLowerCase())) { errors.push({ email, reason: "Email đã tồn tại trong hệ thống" }); skipped++; continue; }
    const orderId = "ORD" + crypto.randomUUID().slice(0, 6).toUpperCase();
    orders[orderId] = { orderId, email, password: acc.password || null, twoFA: acc.twoFA || null, productName, price: price ?? null, purchaseDate: purchaseDate ?? null, expiryDate: expiryDate ?? null, warrantyExpiry: warrantyExpiry ?? null, usagePeriod: usagePeriod ?? null, warrantyPeriod: warrantyPeriod ?? null, notes: notes ?? null, status: "active", createdAt: now() };
    if (!orderItems[orderId]) orderItems[orderId] = [];
    const lWd = Number(warrantyDays || 0); let lWarrantyEnd: string | null = null;
    if (purchaseDate && lWd) { try { const d = new Date((purchaseDate as string).slice(0, 10)); d.setDate(d.getDate() + lWd); lWarrantyEnd = d.toISOString().slice(0, 10); } catch {} }
    if (!lWarrantyEnd && warrantyExpiry) lWarrantyEnd = (warrantyExpiry as string).slice(0, 10) || null;
    orderItems[orderId].push({ itemId: crypto.randomUUID().slice(0, 8).toUpperCase(), email, original_account: email, current_account: email, current_replacement_number: 0, original_delivered_at: purchaseDate || now(), warranty_days: lWd || null, warranty_end_date: lWarrantyEnd, item_status: "active", password: acc.password || null, twoFA: acc.twoFA || null, status: "active", createdAt: now() });
    existingEmails.add(email.toLowerCase()); added++;
  }
  await writeJson("orders", orders); await writeJson("order_items", orderItems);
  addLog("BULK_CREATE_ORDERS", `added=${added} skipped=${skipped}`, "web-admin").catch(() => {});
  res.json({ added, skipped, errors });
});

// ── POST /bot/orders/xlsx-import ──────────────────────────────────────────────
router.post("/bot/orders/xlsx-import", requireAuth, async (req: any, res: any) => {
  const { rows, syncMode } = req.body ?? {};
  if (!Array.isArray(rows) || rows.length === 0) { res.status(400).json({ ok: false, message: "rows is required" }); return; }
  const orders: any = readJson("orders", {}) ?? {}; const orderItems: any = readJson("order_items", {}) ?? {};
  const existingItemEmails = new Set<string>();
  for (const itemList of Object.values(orderItems) as any[][]) for (const it of itemList) { const e = (it.email || it.original_account || "").toLowerCase().trim(); if (e) existingItemEmails.add(e); }
  const results: any[] = []; let newCount = 0, updatedCount = 0, unchangedCount = 0, failCount = 0, skippedCount = 0, accountsAdded = 0, dupOrders = 0, dupAccountsTotal = 0;
  for (const row of rows) {
    const { rowIndex, orderCode, productNameMapped, productNameRaw, quantity, totalPrice, unitPrice, status, customerName, customerEmail, purchaseDate, originalDeliveredAt, expiryDate, warrantyEndDate, warrantyDays, usageDays, accounts, conflictAction = "skip" } = row;
    try {
      const orderId = String(orderCode || "").trim().toUpperCase();
      if (!orderId) { failCount++; results.push({ rowIndex, status: "error", message: "Thiếu mã đơn" }); continue; }
      const existingOrder = orders[orderId];
      if (existingOrder) {
        dupOrders++;
        if (syncMode === "new_only" || conflictAction === "skip") { skippedCount++; results.push({ rowIndex, status: "skipped", message: syncMode === "new_only" ? "Chế độ đơn mới: bỏ qua đơn đã tồn tại" : "Mã đơn đã tồn tại, bỏ qua" }); continue; }
      }
      const firstAcc = Array.isArray(accounts) ? accounts[0] : null;
      const loginPassword: string = firstAcc?.password || ""; const loginTwoFA: string = firstAcc?.twoFA || "";
      const wd = Number(warrantyDays || 0); const ud = Number(usageDays || 0); const tp = Number(totalPrice || 0); const up = Number(unitPrice || 0) || (tp && quantity > 1 ? Math.round(tp / quantity) : tp);
      const resolvedName = productNameMapped || productNameRaw || "";
      const orderObj: any = { orderId, email: customerEmail || "", productName: resolvedName, price: up || null, totalPrice: tp || null, quantity: Number(quantity || 0) || 1, purchaseDate: purchaseDate || null, expiryDate: expiryDate || null, warrantyExpiry: warrantyEndDate || null, warrantyDays: wd || null, usageDays: ud || null, customerName: customerName || null, status: status || "active", password: loginPassword || null, twoFA: loginTwoFA || null, createdAt: existingOrder?.createdAt ?? now(), updatedAt: now() };
      if (!existingOrder) { orders[orderId] = orderObj; }
      else if (conflictAction === "update") { orders[orderId] = { ...existingOrder, ...orderObj }; }
      else if (conflictAction === "add_missing") {
        const ex = existingOrder;
        if (!ex.productName && resolvedName) ex.productName = resolvedName; if (!ex.warrantyDays && wd) ex.warrantyDays = wd; if (!ex.usageDays && ud) ex.usageDays = ud;
        if (!ex.expiryDate && orderObj.expiryDate) ex.expiryDate = orderObj.expiryDate; if (!ex.warrantyExpiry && orderObj.warrantyExpiry) ex.warrantyExpiry = orderObj.warrantyExpiry; if (!ex.purchaseDate && orderObj.purchaseDate) ex.purchaseDate = orderObj.purchaseDate;
        if (syncMode === "full" && loginPassword && !ex.password) ex.password = loginPassword; if (syncMode === "full" && loginTwoFA && !ex.twoFA) ex.twoFA = loginTwoFA;
        orders[orderId] = ex;
      }
      if (!orderItems[orderId]) orderItems[orderId] = [];
      let itemsAddedThisRow = 0, dupThisRow = 0;
      if (Array.isArray(accounts)) {
        const orderEmailSet = new Set((orderItems[orderId] as any[]).map((it: any) => (it.email || it.original_account || "").toLowerCase().trim()));
        for (const acc of accounts) {
          const email: string = (acc.email || "").trim(); if (!email) continue; const emailLower = email.toLowerCase();
          if (existingOrder && conflictAction === "add_missing" && orderEmailSet.has(emailLower)) { dupThisRow++; continue; }
          if (existingItemEmails.has(emailLower)) { dupThisRow++; dupAccountsTotal++; continue; }
          const delAt = (originalDeliveredAt || purchaseDate || "").slice(0, 10) || now().slice(0, 10);
          let warrantyEnd = (warrantyEndDate || "").slice(0, 10) || null;
          if (!warrantyEnd && delAt && wd) { try { const d = new Date(delAt); d.setDate(d.getDate() + wd); warrantyEnd = d.toISOString().slice(0, 10); } catch {} }
          orderItems[orderId].push({ itemId: crypto.randomUUID().slice(0, 8).toUpperCase(), email, original_account: email, current_account: email, current_replacement_number: 0, original_delivered_at: delAt, warranty_days: wd || null, warranty_end_date: warrantyEnd, item_status: "active", password: acc.password || null, twoFA: acc.twoFA || null, status: "active", createdAt: now() });
          existingItemEmails.add(emailLower); orderEmailSet.add(emailLower); itemsAddedThisRow++;
        }
      }
      orders[orderId].quantity = orderItems[orderId].length;
      await writeJson("orders", orders); await writeJson("order_items", orderItems);
      addLog("XLSX_IMPORT_ORDER", orderId, "web-admin").catch(() => {});
      if (!existingOrder) { newCount++; } else if (itemsAddedThisRow > 0) { updatedCount++; } else { unchangedCount++; }
      accountsAdded += itemsAddedThisRow;
      results.push({ rowIndex, status: "ok", orderId, isNew: !existingOrder, itemsAdded: itemsAddedThisRow, dupAccounts: dupThisRow });
    } catch (err: any) { failCount++; results.push({ rowIndex, status: "error", message: String(err?.message ?? "Lỗi không xác định") }); }
  }
  res.json({ ok: true, new: newCount, updated: updatedCount, unchanged: unchangedCount, success: newCount + updatedCount, failed: failCount, skipped: skippedCount, accountsAdded, dupOrders, dupAccounts: dupAccountsTotal, results });
});

// ── GET /bot/orders/:orderId ──────────────────────────────────────────────────
router.get("/bot/orders/:orderId", requireAuth, (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {};
  const order = orders[req.params.orderId];
  if (!order) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  res.json(order);
});

// ── PUT /bot/orders/:orderId ──────────────────────────────────────────────────
router.put("/bot/orders/:orderId", requireAuth, async (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {}; const id = req.params.orderId;
  if (!orders[id]) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  orders[id] = { ...orders[id], ...req.body, orderId: id, updatedAt: now() };
  await writeJson("orders", orders);
  addLog("UPDATE_ORDER", id, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã cập nhật" });
});

// ── DELETE /bot/orders/:orderId ───────────────────────────────────────────────
router.delete("/bot/orders/:orderId", requireAuth, async (req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {}; const id = req.params.orderId;
  if (!orders[id]) { res.status(404).json({ ok: false, message: "Không tìm thấy" }); return; }
  delete orders[id]; await writeJson("orders", orders);
  addLog("DELETE_ORDER", id, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã xoá" });
});

// ── GET /bot/orders/:orderId/items ────────────────────────────────────────────
router.get("/bot/orders/:orderId/items", requireAuth, (req: any, res: any) => {
  const orderItems: any = readJson("order_items", {}) ?? {};
  res.json(orderItems[req.params.orderId] ?? []);
});

// ── POST /bot/orders/:orderId/items ───────────────────────────────────────────
router.post("/bot/orders/:orderId/items", requireAuth, async (req: any, res: any) => {
  const { orderId } = req.params;
  const orders: any = readJson("orders", {}) ?? {};
  if (!orders[orderId]) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng" }); return; }
  const { email, password, twoFA } = req.body ?? {};
  if (!email) { res.status(400).json({ ok: false, message: "email là bắt buộc" }); return; }
  const orderItems: any = readJson("order_items", {}) ?? {};
  if (!orderItems[orderId]) orderItems[orderId] = [];
  const order = orders[orderId];
  const iWd = Number(order.warrantyDays || 0); let iWarrantyEnd: string | null = null;
  if (order.purchaseDate && iWd) { try { const d = new Date(order.purchaseDate.slice(0, 10)); d.setDate(d.getDate() + iWd); iWarrantyEnd = d.toISOString().slice(0, 10); } catch {} }
  if (!iWarrantyEnd && (order.warrantyExpiry || order.warrantyDate)) iWarrantyEnd = (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null;
  const itemId = crypto.randomUUID().slice(0, 8).toUpperCase();
  const item = { itemId, email, original_account: email, current_account: email, current_replacement_number: 0, original_delivered_at: order.purchaseDate || now(), warranty_days: iWd || null, warranty_end_date: iWarrantyEnd, item_status: "active", password: password ?? null, twoFA: twoFA ?? null, status: "active", createdAt: now() };
  orderItems[orderId].push(item);
  await writeJson("order_items", orderItems);
  addLog("CREATE_ORDER_ITEM", `${orderId}/${itemId}`, "web-admin").catch(() => {});
  res.json({ ok: true, item });
});

// ── PUT /bot/orders/:orderId/items/:itemId ────────────────────────────────────
router.put("/bot/orders/:orderId/items/:itemId", requireAuth, async (req: any, res: any) => {
  const { orderId, itemId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {};
  const items: any[] = orderItems[orderId] ?? [];
  const idx = items.findIndex((it: any) => it.itemId === itemId);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy item" }); return; }
  items[idx] = { ...items[idx], ...req.body, itemId, updatedAt: now() };
  orderItems[orderId] = items; await writeJson("order_items", orderItems);
  addLog("UPDATE_ORDER_ITEM", `${orderId}/${itemId}`, "web-admin").catch(() => {});
  res.json({ ok: true, item: items[idx] });
});

// ── GET /bot/orders/:orderId/items/:itemId/replacements ───────────────────────
router.get("/bot/orders/:orderId/items/:itemId/replacements", requireAuth, (req: any, res: any) => {
  const { itemId } = req.params;
  const allReps: any = readJson("account_replacements", {}) ?? {};
  const reps: any[] = (allReps[itemId] ?? []).sort((a: any, b: any) => (a.replacementNumber ?? 0) - (b.replacementNumber ?? 0));
  res.json(reps);
});

// ── GET /orders/lookup ────────────────────────────────────────────────────────
router.get("/orders/lookup", requireAuth, (req: any, res: any) => {
  const query = String(req.query.query ?? "").trim();
  if (!query) { res.status(400).json({ found: false, error: "query là bắt buộc" }); return; }
  const orders: any = readJson("orders", {}) ?? {};
  const orderItems: any = readJson("order_items", {}) ?? {};
  const allReps: any = readJson("account_replacements", {}) ?? {};
  const settings: any = readJson("settings", {}) ?? {};
  const normalized = query.replace(/^(?:m[aã]\s*[đd][oơ]n|order\s*(?:code|id)?|email\s*\/?\s*t[àa]i\s*kho[ảa]n|email|t[àa]i\s*kho[ảa]n)\s*[:：]\s*/i, "").trim();
  function inferBhfDays(productName: string): number {
    const norm = productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    let m: RegExpMatchArray | null;
    if ((m = norm.match(/(\d+)\s*NAM\b/)))   return parseInt(m[1]) * 365;
    if ((m = norm.match(/(\d+)\s*THANG\b/))) return parseInt(m[1]) * 30;
    if ((m = norm.match(/(\d+)\s*NGAY\b/)))  return parseInt(m[1]);
    return 0;
  }
  const refundHistorySet = new Set<string>((readJson("refund_history", []) as any[]).map((r: any) => r.orderId).filter(Boolean));
  function calcWarranty(item: any, order: any, orderId?: string) {
    if (item.item_status === "refunded") { const warrantyDaysR = Number(item.warranty_days || order?.warrantyDays || 0); return { warrantyStatus: "refunded", remainingDays: null, canReport: false, refundAmount: 0, warrantyEndDate: null, originalDeliveredAt: null, warrantyDays: warrantyDaysR }; }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startStr = item.original_delivered_at || item.deliveredAt || order?.paymentAt || order?.purchaseDate || "";
    const pnameRaw = item.productName || order?.productName || '';
    let warrantyDays = Number(item.warranty_days || order?.warrantyDays || 0);
    if (!warrantyDays && /\bBHF\b/i.test(pnameRaw)) warrantyDays = inferBhfDays(pnameRaw);
    let warrantyEnd: Date | null = null;
    if (item.warranty_end_date) { try { warrantyEnd = new Date(item.warranty_end_date.slice(0, 10)); } catch {} }
    if (!warrantyEnd && startStr && warrantyDays) { try { warrantyEnd = new Date(startStr.slice(0, 10)); warrantyEnd.setDate(warrantyEnd.getDate() + warrantyDays); } catch {} }
    if (!warrantyEnd) { const we = order?.warrantyExpiry || order?.warrantyDate || ""; if (we) { try { warrantyEnd = new Date(we.slice(0, 10)); } catch {} } }
    if (!startStr && !warrantyEnd) return { warrantyStatus: "no_data", remainingDays: null, canReport: false, refundAmount: 0, warrantyEndDate: null, originalDeliveredAt: null, warrantyDays };
    let remainingDays: number | null = null, warrantyStatus = "unknown", canReport = false;
    if (warrantyEnd) { remainingDays = Math.max(0, Math.floor((warrantyEnd.getTime() - today.getTime()) / 86400000)); warrantyStatus = remainingDays > 0 ? "active" : "expired"; canReport = warrantyStatus === "active"; }
    if (order?.status === "refunded") canReport = false;
    if (orderId && refundHistorySet.has(orderId)) canReport = false;
    const price = Number(order?.price || 0); let refundAmount: number | string = 0;
    if (remainingDays && remainingDays > 0 && price && warrantyDays) refundAmount = settings.refund_formula === "custom" && settings.refund_custom_text ? settings.refund_custom_text : Math.round(price * remainingDays / warrantyDays);
    return { warrantyStatus, remainingDays, canReport, refundAmount, warrantyEndDate: warrantyEnd ? warrantyEnd.toISOString().slice(0, 10) : null, originalDeliveredAt: startStr || null, warrantyDays };
  }
  function buildOrderObj(orderId: string, order: any, allItemList: any[]) {
    const w = calcWarranty({ warranty_days: order.warrantyDays, warranty_end_date: order.warrantyExpiry || order.warrantyDate }, order, orderId);
    return { orderCode: orderId, product: order.productName || "", customer: order.customerName || "", purchaseDate: (order.purchaseDate || order.paymentAt || "").slice(0, 10) || null, expiryDate: (order.expiryDate || "").slice(0, 10) || null, warrantyEndDate: w.warrantyEndDate || (order.warrantyExpiry || order.warrantyDate || "").slice(0, 10) || null, originalPrice: Number(order.price || 0), quantity: allItemList.length || (order.quantity ?? 0), status: order.status || "active" };
  }
  function buildItemObj(item: any, order: any, orderId?: string) {
    const reps: any[] = (allReps[item.itemId] ?? []).sort((a: any, b: any) => a.replacementNumber - b.replacementNumber);
    const wdata = calcWarranty(item, order, orderId);
    return { orderItemId: item.itemId, originalAccount: item.original_account || item.email || "", currentAccount: item.current_account || item.email || "", replacementCount: item.current_replacement_number ?? reps.length, itemStatus: item.item_status || item.status || "active", warrantyStatus: wdata.warrantyStatus, remainingDays: wdata.remainingDays, canReport: wdata.canReport, refundAmount: wdata.refundAmount, warrantyEndDate: wdata.warrantyEndDate, originalDeliveredAt: wdata.originalDeliveredAt, warrantyDays: wdata.warrantyDays, replacementHistory: reps.map((r: any) => ({ replacementNumber: r.replacementNumber, previousAccount: r.previousAccount, newAccount: r.newAccount, deliveredAt: r.deliveredAt, reason: r.reason || "" })) };
  }
  const normUpper = normalized.toUpperCase();
  const orderKey = normUpper in orders ? normUpper : (normalized in orders ? normalized : null);
  if (orderKey) {
    const itemList: any[] = orderItems[orderKey] ?? [];
    const orderObj = buildOrderObj(orderKey, orders[orderKey], itemList); const isMulti = itemList.length > 1;
    if (isMulti) return res.json({ found: true, lookupType: "order_code", isMultiAccountOrder: true, order: orderObj, items: itemList.map(it => buildItemObj(it, orders[orderKey], orderKey)) });
    const singleItem = itemList[0] ?? null; const itemObj = singleItem ? buildItemObj(singleItem, orders[orderKey], orderKey) : null; const wdata = singleItem ? calcWarranty(singleItem, orders[orderKey], orderKey) : null;
    return res.json({ found: true, lookupType: "order_code", isMultiAccountOrder: false, order: orderObj, ...(itemObj ? { item: itemObj } : {}), remainingDays: wdata?.remainingDays ?? null, warrantyStatus: wdata?.warrantyStatus ?? "unknown", refundAmount: wdata?.refundAmount ?? 0, canReport: wdata?.canReport ?? false });
  }
  const emailLower = normalized.toLowerCase();
  for (const [orderId, itemList] of Object.entries(orderItems) as [string, any[]][]) {
    for (const item of (itemList as any[])) {
      const orig = (item.original_account || item.email || "").toLowerCase(); const curr = (item.current_account || item.email || "").toLowerCase();
      const matchesDirect = emailLower === orig || emailLower === curr;
      const matchesHistory = !matchesDirect && (allReps[item.itemId] ?? []).some((r: any) => (r.previousAccount || "").toLowerCase() === emailLower || (r.newAccount || "").toLowerCase() === emailLower);
      if (!matchesDirect && !matchesHistory) continue;
      const order = orders[orderId] ?? {}; const allItemsForOrder: any[] = orderItems[orderId] ?? []; const isMulti = allItemsForOrder.length > 1;
      const itemObj = buildItemObj(item, order, orderId); const orderObj = buildOrderObj(orderId, order, allItemsForOrder);
      return res.json({ found: true, lookupType: "email", isMultiAccountOrder: isMulti, order: orderObj, item: itemObj, remainingDays: itemObj.remainingDays, warrantyStatus: itemObj.warrantyStatus, refundAmount: itemObj.refundAmount, canReport: itemObj.canReport });
    }
  }
  for (const [orderId, order] of Object.entries(orders) as [string, any][]) {
    if ((order.email || "").toLowerCase() === emailLower) {
      const allItemsForOrder: any[] = orderItems[orderId] ?? []; const orderObj = buildOrderObj(orderId, order, allItemsForOrder);
      return res.json({ found: true, lookupType: "email", isMultiAccountOrder: false, order: orderObj, item: null, remainingDays: null, warrantyStatus: "unknown", refundAmount: 0, canReport: false });
    }
  }
  return res.json({ found: false });
});

// ── GET /bot/rate-violations ──────────────────────────────────────────────────
router.get("/bot/rate-violations", requireAuth, (req: any, res: any) => {
  const violations: any[] = readJson("rate_violations", []) ?? [];
  const { user_id, action, from, to, is_locked } = req.query;
  let result = [...violations].reverse();
  if (user_id)   result = result.filter((r: any) => String(r.user_id) === String(user_id));
  if (action)    result = result.filter((r: any) => r.action === String(action));
  if (from)      result = result.filter((r: any) => r.timestamp >= String(from));
  if (to)        result = result.filter((r: any) => r.timestamp <= String(to) + "T23:59:59");
  if (is_locked === "true") result = result.filter((r: any) => r.is_locked === true);
  const summary = { total: result.length, by_action: {} as Record<string, number>, locked_count: result.filter((r: any) => r.is_locked).length, unique_users: new Set(result.map((r: any) => r.user_id)).size };
  for (const r of result) summary.by_action[r.action] = (summary.by_action[r.action] || 0) + 1;
  res.json({ summary, items: result.slice(0, 500) });
});

// ── GET /bot/rate-limits/user/:userId ─────────────────────────────────────────
router.get("/bot/rate-limits/user/:userId", requireAuth, (req: any, res: any) => {
  const { userId } = req.params;
  const data: any = readJson("rate_limits", {}) ?? {};
  const nowS = Date.now() / 1000;
  const userState = data[String(userId)] ?? {};
  const result: any = {};
  for (const [action, state] of Object.entries(userState) as [string, any][]) {
    const lockUntil = state.lock_until ?? null; const cooldownUntil = state.cooldown_until ?? null;
    result[action] = { violation_count: state.violation_count ?? 0, is_locked: !!(lockUntil && nowS < lockUntil), lock_remaining_s: lockUntil && nowS < lockUntil ? Math.max(0, Math.round(lockUntil - nowS)) : 0, is_on_cooldown: !!(cooldownUntil && nowS < cooldownUntil), cooldown_remaining_s: cooldownUntil && nowS < cooldownUntil ? Math.max(0, Math.round(cooldownUntil - nowS)) : 0, last_violation_at: state.last_violation_at ?? null };
  }
  res.json({ user_id: userId, status: result });
});

// ── DELETE /bot/rate-limits/user/:userId ──────────────────────────────────────
router.delete("/bot/rate-limits/user/:userId", requireAuth, async (req: any, res: any) => {
  const { userId } = req.params; const { action } = req.query;
  const data: any = readJson("rate_limits", {}) ?? {}; const uid = String(userId);
  if (!data[uid]) { res.json({ ok: true, message: "Không tìm thấy dữ liệu cho user này" }); return; }
  if (action) { delete data[uid][String(action)]; addLog("RATE_LIMIT_CLEARED", `user ${uid} action=${action}`, "web-admin").catch(() => {}); }
  else { delete data[uid]; addLog("RATE_LIMIT_CLEARED", `user ${uid} all actions`, "web-admin").catch(() => {}); }
  await writeJson("rate_limits", data);
  res.json({ ok: true, message: "Đã xóa rate limit" });
});

// ── GET /bot/refund-history ───────────────────────────────────────────────────
router.get("/bot/refund-history", requireAuth, (req: any, res: any) => {
  const history: any[] = readJson("refund_history", []) ?? [];
  const { orderId, email, from, to } = req.query;
  let result = [...history].reverse();
  if (orderId) result = result.filter((r: any) => (r.orderId || "").includes(String(orderId)));
  if (email)   result = result.filter((r: any) => (r.email || "").toLowerCase().includes(String(email).toLowerCase()));
  if (from)    result = result.filter((r: any) => r.refundedAt >= String(from));
  if (to)      result = result.filter((r: any) => r.refundedAt <= String(to) + "T23:59:59");
  res.json(result);
});

// ── POST /bot/refund-history/manual ───────────────────────────────────────────
router.post("/bot/refund-history/manual", requireAuth, async (req: any, res: any) => {
  const { orderId, amount, note, email } = req.body ?? {};
  if (!orderId || !String(orderId).trim()) { res.status(400).json({ ok: false, message: "orderId là bắt buộc" }); return; }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { res.status(400).json({ ok: false, message: "Số tiền hoàn không hợp lệ" }); return; }
  const history: any[] = readJson("refund_history", []) ?? [];
  const entry = { id: crypto.randomUUID(), warrantyRequestId: null, orderId: String(orderId).trim().toUpperCase(), orderCode: String(orderId).trim().toUpperCase(), account: email || "", email: email || "", amount: Number(amount), note: note || "", refundedAt: now(), refundedBy: "web-admin", reason: note || "", source: "manual" };
  history.push(entry); await writeJson("refund_history", history);
  const orders: any = readJson("orders", {}) ?? {}; const oKey = String(orderId).trim().toUpperCase();
  if (orders[oKey]) { orders[oKey].status = "refunded"; orders[oKey].refundedAt = entry.refundedAt; orders[oKey].refundAmount = Number(amount); await writeJson("orders", orders); }
  addLog("MANUAL_REFUND", `${entry.orderId} → ${Number(amount).toLocaleString("vi")}đ`, "web-admin").catch(() => {});
  res.json({ ok: true, record: entry });
});

// ── DELETE /bot/refund-history/:id ────────────────────────────────────────────
router.delete("/bot/refund-history/:id", requireAuth, async (req: any, res: any) => {
  const { id } = req.params;
  const history: any[] = readJson("refund_history", []) ?? [];
  const idx = history.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy bản ghi" }); return; }
  history.splice(idx, 1); await writeJson("refund_history", history);
  addLog("DELETE_REFUND_RECORD", id, "web-admin").catch(() => {});
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SYNC ROBOT
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/bot/sync-robot/config", requireAuth, (_req: any, res: any) => {
  const cfg: any = readJson("sync_robot_config", {}) ?? {};
  res.json({ enabled: cfg.enabled ?? false, site_url: cfg.site_url ?? "", login_url: cfg.login_url ?? "", orders_url: cfg.orders_url ?? "", email: cfg.email ?? "", password: cfg.password ? "***" : "", interval_s: cfg.interval_s ?? 300, sync_mode: cfg.sync_mode ?? "full" });
});

router.put("/bot/sync-robot/config", requireAuth, async (req: any, res: any) => {
  const body = req.body ?? {}; const current: any = readJson("sync_robot_config", {}) ?? {};
  const updated: any = { ...current, enabled: body.enabled !== undefined ? !!body.enabled : (current.enabled ?? false), site_url: body.site_url !== undefined ? String(body.site_url).trim() : (current.site_url ?? ""), login_url: body.login_url !== undefined ? String(body.login_url).trim() : (current.login_url ?? ""), orders_url: body.orders_url !== undefined ? String(body.orders_url).trim() : (current.orders_url ?? ""), email: body.email !== undefined ? String(body.email).trim() : (current.email ?? ""), interval_s: body.interval_s !== undefined ? Number(body.interval_s) : (current.interval_s ?? 300), sync_mode: (body.sync_mode === "new_only" ? "new_only" : (body.sync_mode === "full" ? "full" : (current.sync_mode ?? "full"))) };
  if (body.password && body.password !== "***") updated.password = String(body.password);
  await writeJson("sync_robot_config", updated);
  addLog("SYNC_ROBOT_CONFIG", `enabled=${updated.enabled} interval=${updated.interval_s}s mode=${updated.sync_mode}`, "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã lưu cấu hình robot" });
});

router.get("/bot/sync-robot/status", requireAuth, (_req: any, res: any) => {
  res.json(readJson("sync_robot_status", { running: false, last_run: null, next_run_at: null }) ?? {});
});

router.get("/bot/sync-robot/logs", requireAuth, (req: any, res: any) => {
  const logs: any[] = readJson("sync_robot_logs", []) ?? [];
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  res.json(logs.slice(-limit));
});

router.post("/bot/sync-robot/trigger", requireAuth, async (_req: any, res: any) => {
  await writeJson("sync_robot_trigger", { trigger: true, triggered_at: now(), triggered_by: "web-admin" });
  addLog("SYNC_ROBOT_TRIGGER", "manual trigger via admin panel", "web-admin").catch(() => {});
  res.json({ ok: true, message: "Đã kích hoạt đồng bộ ngay" });
});

router.post("/bot/sync-robot/test-login", requireAuth, async (req: any, res: any) => {
  const body = req.body ?? {}; const current: any = readJson("sync_robot_config", {}) ?? {};
  const cfg: any = { ...current, site_url: body.site_url ?? current.site_url ?? "", login_url: body.login_url ?? current.login_url ?? "", orders_url: body.orders_url ?? current.orders_url ?? "", email: body.email ?? current.email ?? "" };
  if (body.password && body.password !== "***") cfg.password = body.password;
  await writeJson("sync_robot_config", cfg);
  addLog("SYNC_ROBOT_TEST_LOGIN", `email=${cfg.email}`, "web-admin").catch(() => {});
  const robotScript = path.resolve(DATA_DIR, "..", "sync_robot.py");
  const env = { ...process.env, DATA_DIR, API_BASE_URL: process.env["API_BASE_URL"] ?? "http://localhost:8080" };
  execFile("python3", [robotScript, "--test-login"], { env, timeout: 120_000, maxBuffer: 20 * 1024 * 1024 }, async (err, stdout, _stderr) => {
    let result: any = { ok: false, message: "Không nhận được phản hồi từ robot", steps: [] };
    const raw = (stdout || "").trim();
    if (raw) {
      const lines = raw.split("\n").map((l: string) => l.trim()).filter(Boolean);
      let parsed = false;
      for (let i = lines.length - 1; i >= 0; i--) { const line = lines[i]; if (line.startsWith("{") || line.startsWith("[")) { try { result = JSON.parse(line); parsed = true; break; } catch {} } }
      if (!parsed) result = { ok: false, message: `Robot không trả JSON hợp lệ: ${raw.slice(0, 300)}`, steps: [] };
    } else if (err) { result = { ok: false, message: `Lỗi: ${(_stderr || err.message || "").slice(0, 500)}`, steps: [] }; }
    try {
      const logs: any[] = readJson("sync_robot_logs", []) ?? [];
      const summary: any = { type: "test_login", started_at: new Date().toISOString(), ended_at: new Date().toISOString(), duration_s: result.duration_s ?? 0, success: result.ok, login_ok: result.ok, download_ok: false, import_ok: false, new_orders: 0, updated_orders: 0, skipped_orders: 0, errors: result.ok ? 0 : 1, message: result.message ?? "", url: result.url ?? "", title: result.title ?? "", error_text: result.error_text ?? "", step_count: Array.isArray(result.steps) ? result.steps.length : 0, steps_summary: Array.isArray(result.steps) ? result.steps.map((s: any) => ({ step: s.step, ok: s.ok, note: s.note })) : [] };
      logs.push(summary); if (logs.length > 200) logs.splice(0, logs.length - 200);
      await writeJson("sync_robot_logs", logs);
    } catch {}
    res.json(result);
  });
});

router.get("/bot/sync-robot/screenshot/:filename", requireAuth, (req: any, res: any) => {
  const { filename } = req.params;
  if (!/^[\w\-\.]+\.jpg$/i.test(filename)) { res.status(400).json({ error: "Invalid filename" }); return; }
  const screenshotsDir = path.join(DATA_DIR, "screenshots"); const filePath = path.join(screenshotsDir, filename);
  if (!filePath.startsWith(screenshotsDir)) { res.status(400).json({ error: "Invalid path" }); return; }
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "Screenshot not found" }); return; }
  res.setHeader("Content-Type", "image/jpeg"); res.setHeader("Cache-Control", "private, max-age=86400");
  const stream = fs.createReadStream(filePath); stream.on("error", () => res.status(500).end()); stream.pipe(res);
});

router.get("/bot/sync-robot/existing-sets", requireAuth, (_req: any, res: any) => {
  const orders: any = readJson("orders", {}) ?? {}; const orderItems: any = readJson("order_items", {}) ?? {};
  const orderIds = Object.keys(orders); const itemEmails: string[] = [];
  for (const items of Object.values(orderItems) as any[][]) {
    if (!Array.isArray(items)) continue;
    for (const it of items) { const orig = (it.original_account || it.email || "").toLowerCase(); const curr = (it.current_account || "").toLowerCase(); if (orig) itemEmails.push(orig); if (curr && curr !== orig) itemEmails.push(curr); }
  }
  res.json({ orderIds, itemEmails: [...new Set(itemEmails)] });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER PAGE & PUBLIC ORDER
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/customer-page", (_req: any, res: any) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Nhận tài khoản</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f4f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.1);padding:28px 24px;width:100%;max-width:440px}
  h1{font-size:1.25rem;font-weight:700;margin-bottom:4px;color:#1a202c}
  .subtitle{font-size:.875rem;color:#718096;margin-bottom:24px}
  label{font-size:.8125rem;font-weight:600;color:#4a5568;display:block;margin-bottom:6px}
  input{width:100%;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:.9375rem;outline:none;transition:border .15s}
  input:focus{border-color:#4f46e5}
  .btn{display:block;width:100%;padding:12px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity .15s}
  .btn-primary{background:#4f46e5;color:#fff}.btn-primary:hover{opacity:.9}
  .btn-unlock{background:linear-gradient(135deg,#059669,#047857);color:#fff;margin-top:18px}.btn-unlock:hover{opacity:.9}.btn-unlock:disabled{opacity:.5;cursor:not-allowed}
  .section{margin-top:20px}
  .info-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f0f4f8;font-size:.875rem}.info-row:last-child{border-bottom:none}
  .info-label{color:#718096}.info-val{font-weight:600;color:#1a202c;text-align:right;max-width:200px;word-break:break-all}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:.75rem;font-weight:600}
  .badge-wait{background:#fef3c7;color:#92400e}.badge-ok{background:#d1fae5;color:#065f46}.badge-refunded{background:#ede9fe;color:#5b21b6}
  .lock-box{background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:12px;padding:20px;margin-top:18px;text-align:center}
  .lock-icon{font-size:2.5rem;margin-bottom:8px}.lock-text{font-size:.875rem;color:#718096;margin-bottom:4px}.lock-hint{font-size:.8125rem;color:#a0aec0}
  .cred-box{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:12px;padding:20px;margin-top:18px}
  .cred-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.cred-row:last-child{margin-bottom:0}
  .cred-label{font-size:.8125rem;color:#065f46;font-weight:600}.cred-val{font-family:monospace;font-size:.9375rem;font-weight:700;color:#1a202c;word-break:break-all;text-align:right}
  .copy-btn{background:#e0fce7;border:none;border-radius:6px;padding:4px 8px;font-size:.75rem;cursor:pointer;color:#047857;font-weight:600;flex-shrink:0;margin-left:8px}.copy-btn:active{background:#bbf7d0}
  .alert{border-radius:8px;padding:12px 14px;font-size:.875rem;margin-top:16px}
  .alert-err{background:#fff5f5;color:#c53030;border:1px solid #fed7d7}.alert-warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
  .mt-16{margin-top:16px}.spinner{border:3px solid #e2e8f0;border-top:3px solid #4f46e5;border-radius:50%;width:22px;height:22px;animation:spin .7s linear infinite;margin:0 auto 12px}
  @keyframes spin{to{transform:rotate(360deg)}}
  #lookup-section,#result-section{display:none}
</style>
</head>
<body>
<div class="card">
  <h1>📦 Nhận tài khoản của bạn</h1>
  <p class="subtitle">Nhập mã đơn hàng để xem và mở khoá tài khoản</p>
  <div id="lookup-section">
    <label for="order-input">Mã đơn hàng</label>
    <input id="order-input" placeholder="VD: ORD-XXXXXXXX" autocomplete="off" />
    <button class="btn btn-primary mt-16" onclick="lookupOrder()">🔍 Tra cứu</button>
    <div id="lookup-err" class="alert alert-err" style="display:none"></div>
  </div>
  <div id="loading" style="display:none;text-align:center;padding:24px 0"><div class="spinner"></div><p style="color:#718096;font-size:.875rem">Đang tải...</p></div>
  <div id="result-section">
    <div class="section">
      <div class="info-row"><span class="info-label">Mã đơn</span><span class="info-val" id="r-orderId"></span></div>
      <div class="info-row"><span class="info-label">Sản phẩm</span><span class="info-val" id="r-product"></span></div>
      <div class="info-row"><span class="info-label">Bảo hành đến</span><span class="info-val" id="r-warranty"></span></div>
      <div class="info-row"><span class="info-label">Trạng thái</span><span class="info-val" id="r-status"></span></div>
    </div>
    <div id="lock-box" class="lock-box"><div class="lock-icon">🔒</div><div class="lock-text">Tài khoản đang được bảo vệ</div><div class="lock-hint">Nhấn nút bên dưới để mở khoá và xem thông tin đăng nhập</div><button class="btn btn-unlock" id="unlock-btn" onclick="unlockAccount()">🔓 Mở khoá nhận tài khoản</button></div>
    <div id="cred-box" class="cred-box" style="display:none">
      <div style="font-weight:700;color:#065f46;margin-bottom:14px">✅ Thông tin tài khoản</div>
      <div class="cred-row"><span class="cred-label">📧 Tài khoản</span><div style="display:flex;align-items:center"><span class="cred-val" id="c-email"></span><button class="copy-btn" onclick="copy('c-email',this)">Sao chép</button></div></div>
      <div class="cred-row"><span class="cred-label">🔒 Mật khẩu</span><div style="display:flex;align-items:center"><span class="cred-val" id="c-pass"></span><button class="copy-btn" onclick="copy('c-pass',this)">Sao chép</button></div></div>
      <div class="cred-row" id="row-2fa" style="display:none"><span class="cred-label">🛡 2FA</span><div style="display:flex;align-items:center"><span class="cred-val" id="c-2fa"></span><button class="copy-btn" onclick="copy('c-2fa',this)">Sao chép</button></div></div>
      <div class="alert alert-warn" style="margin-top:14px;font-size:.8125rem">⚠️ Vui lòng lưu lại thông tin này. Hãy đổi mật khẩu ngay sau khi đăng nhập.</div>
    </div>
    <div id="result-err" class="alert alert-err" style="display:none;margin-top:12px"></div>
  </div>
</div>
<script>
const BASE='';let currentOrderId='';
function getParam(key){return new URLSearchParams(location.search).get(key)||'';}
function showLoading(v){document.getElementById('loading').style.display=v?'block':'none';}
function copy(id,btn){const el=document.getElementById(id);navigator.clipboard.writeText(el.textContent).then(()=>{const orig=btn.textContent;btn.textContent='✓';setTimeout(()=>btn.textContent=orig,1500);});}
function statusBadge(s){if(s==='pending_unlock')return'<span class="badge badge-wait">⏳ Chờ mở khoá</span>';if(s==='unlocked'||s==='sent')return'<span class="badge badge-ok">✅ Đã giao</span>';if(s==='refunded')return'<span class="badge badge-refunded">💰 Hoàn tiền</span>';return'<span class="badge badge-wait">'+s+'</span>';}
async function lookupOrder(){const input=document.getElementById('order-input').value.trim();if(!input)return;currentOrderId=input;doLookup(input);}
async function doLookup(orderId){showLoading(true);document.getElementById('lookup-section').style.display='none';document.getElementById('result-section').style.display='none';document.getElementById('lookup-err').style.display='none';try{const resp=await fetch(BASE+'/api/public/order/'+encodeURIComponent(orderId));const data=await resp.json();if(!resp.ok||!data.ok){showLoading(false);document.getElementById('lookup-section').style.display='block';const errEl=document.getElementById('lookup-err');errEl.textContent=data.message||'Không tìm thấy đơn hàng. Vui lòng kiểm tra lại mã đơn.';errEl.style.display='block';return;}showLoading(false);document.getElementById('result-section').style.display='block';document.getElementById('r-orderId').textContent=data.orderId;document.getElementById('r-product').textContent=data.productName||'—';document.getElementById('r-warranty').textContent=data.warrantyEnd||'—';document.getElementById('r-status').innerHTML=statusBadge(data.status);if(data.unlocked){showCredentials(data.account,data.password,data.twoFA);}else{document.getElementById('lock-box').style.display='block';document.getElementById('cred-box').style.display='none';}}catch(e){showLoading(false);document.getElementById('lookup-section').style.display='block';const errEl=document.getElementById('lookup-err');errEl.textContent='Lỗi kết nối. Vui lòng thử lại.';errEl.style.display='block';}}
function showCredentials(email,password,twoFA){document.getElementById('lock-box').style.display='none';document.getElementById('cred-box').style.display='block';document.getElementById('c-email').textContent=email||'';document.getElementById('c-pass').textContent=password||'';if(twoFA){document.getElementById('c-2fa').textContent=twoFA;document.getElementById('row-2fa').style.display='flex';}}
async function unlockAccount(){const btn=document.getElementById('unlock-btn');btn.disabled=true;btn.textContent='⏳ Đang xử lý...';document.getElementById('result-err').style.display='none';try{const resp=await fetch(BASE+'/api/public/order/'+encodeURIComponent(currentOrderId)+'/unlock',{method:'POST'});const data=await resp.json();if(!resp.ok||!data.ok){const errEl=document.getElementById('result-err');errEl.textContent=data.message||'Không thể mở khoá. Vui lòng thử lại.';errEl.style.display='block';btn.disabled=false;btn.textContent='🔓 Mở khoá nhận tài khoản';return;}showCredentials(data.account,data.password,data.twoFA);}catch(e){const errEl=document.getElementById('result-err');errEl.textContent='Lỗi kết nối. Vui lòng thử lại.';errEl.style.display='block';btn.disabled=false;btn.textContent='🔓 Mở khoá nhận tài khoản';}}
window.onload=function(){const id=getParam('id');if(id){currentOrderId=id;doLookup(id);}else{document.getElementById('lookup-section').style.display='block';}};
</script></body></html>`);
});

router.get("/public/order/:orderId", (req: any, res: any) => {
  const { orderId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {}; const orders: any = readJson("orders", {}) ?? {};
  const items: any[] = (orderItems[orderId] ?? []).filter((it: any) => it.source === "manual_delivery" || it.email);
  if (!items.length) { res.status(404).json({ ok: false, message: "Không tìm thấy đơn hàng. Vui lòng kiểm tra lại mã đơn." }); return; }
  const item = items[items.length - 1]; const order: any = orders[orderId] ?? {};
  const unlocked = item.unlocked === true;
  const result: any = { ok: true, orderId, productName: item.productName || order.productName || "", warrantyEnd: item.warranty_end_date || order.warrantyExpiry || null, status: unlocked ? "unlocked" : "pending_unlock", unlocked };
  if (unlocked) { result.account = item.email || item.original_account || ""; result.password = item.password || ""; result.twoFA = item.twoFA || null; }
  res.json(result);
});

router.post("/public/order/:orderId/unlock", async (req: any, res: any) => {
  const { orderId } = req.params;
  const orderItems: any = readJson("order_items", {}) ?? {};
  const items: any[] = orderItems[orderId] ?? [];
  let realIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].source === "manual_delivery" || items[i].email) { realIdx = i; break; }
  }
  if (realIdx < 0) { res.status(404).json({ ok: false, message: "Không tìm thấy tài khoản cho đơn hàng này" }); return; }
  const item = items[realIdx];
  items[realIdx] = { ...item, unlocked: true, unlockedAt: now() };
  orderItems[orderId] = items; await writeJson("order_items", orderItems);
  const deliveryRequests: any[] = readJson("delivery_requests", []) ?? [];
  const drIdx = deliveryRequests.findIndex((r: any) => r.orderId === orderId && r.status === "pending_unlock");
  if (drIdx >= 0) {
    deliveryRequests[drIdx] = { ...deliveryRequests[drIdx], status: "sent", sentAt: now(), deliveredViaWeb: true };
    await writeJson("delivery_requests", deliveryRequests);
    const orders: any = readJson("orders", {}) ?? {}; const order: any = orders[orderId] ?? {};
    if (order.status === "pending" || !order.status) { orders[orderId] = { ...order, status: "active", updatedAt: now() }; await writeJson("orders", orders); }
  }
  addLog("DELIVERY_UNLOCKED", orderId, "customer-web").catch(() => {});
  res.json({ ok: true, account: item.email || item.original_account || "", password: item.password || "", twoFA: item.twoFA || null });
});

// ── DELIVERY ──────────────────────────────────────────────────────────────────

router.get("/bot/delivery", requireAuth, (_req: any, res: any) => {
  const requests: any[] = readJson("delivery_requests", []) ?? [];
  res.json(requests.sort((a: any, b: any) => b.submittedAt?.localeCompare(a.submittedAt ?? "") ?? 0));
});

router.post("/bot/delivery/:id/send", requireAuth, async (req: any, res: any) => {
  const { id } = req.params; const body = req.body ?? {};
  let accountList: Array<{ account: string; password: string; twoFA?: string }> = [];
  if (Array.isArray(body.accounts) && body.accounts.length > 0) { accountList = body.accounts; }
  else if (body.account) { accountList = [{ account: body.account, password: body.password, twoFA: body.twoFA }]; }
  if (accountList.length === 0 || !accountList[0].account || !accountList[0].password) { res.status(400).json({ ok: false, message: "Cần ít nhất một tài khoản và mật khẩu" }); return; }
  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx]; const deliveredAt = now();
  const orders: any = readJson("orders", {}) ?? {}; const orderItems: any = readJson("order_items", {}) ?? {}; const order: any = orders[dr.orderId] ?? {};
  let warrantyEndDate: string | null = order.warrantyExpiry || order.warrantyDate || null;
  if (!warrantyEndDate) { const wDays = Number(order.warrantyDays || 0); const startStr = order.purchaseDate || order.paymentAt || deliveredAt; if (wDays > 0 && startStr) { try { const d = new Date(startStr.slice(0, 10)); d.setDate(d.getDate() + wDays); warrantyEndDate = d.toISOString().slice(0, 10); } catch {} } }
  const existingItems: any[] = orderItems[dr.orderId] ?? [];
  for (const acc of accountList) {
    const { account, password, twoFA } = acc;
    const existIdx = existingItems.findIndex((it: any) => (it.original_account || it.email || "").toLowerCase() === account.toLowerCase());
    const itemEntry: any = { itemId: existIdx >= 0 ? existingItems[existIdx].itemId : crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(), email: account, password: password || null, twoFA: twoFA || null, unlocked: false, status: "delivered", item_status: "active", productName: order.productName || dr.productName || "", createdAt: existIdx >= 0 ? existingItems[existIdx].createdAt : deliveredAt, original_account: account, current_account: account, current_replacement_number: 0, original_delivered_at: deliveredAt, warranty_days: Number(order.warrantyDays || 0) || null, warranty_end_date: warrantyEndDate, source: "manual_delivery" };
    if (existIdx >= 0) { existingItems[existIdx] = { ...existingItems[existIdx], ...itemEntry }; } else { existingItems.push(itemEntry); }
  }
  orderItems[dr.orderId] = existingItems; await writeJson("order_items", orderItems);
  const firstAcc = accountList[0];
  requests[idx] = { ...dr, status: "pending_unlock", sentAt: deliveredAt, sentBy: "web-admin", accountInfo: { account: firstAcc.account, password: firstAcc.password, twoFA: firstAcc.twoFA || null }, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  await writeJson("delivery_requests", requests);
  const userLang = dr.userLang ?? "vi"; const isEN = userLang === "en";
  const notifyLines: string[] = [];
  if (isEN) { notifyLines.push(`📦 <b>Your account is ready!</b>`); notifyLines.push(`Order: <code>${dr.orderId}</code>`); notifyLines.push(`\nTap the button below to unlock your account.`); notifyLines.push(`\n<i>Only you can unlock this account.</i>`); }
  else { notifyLines.push(`📦 <b>Tài khoản của bạn đã sẵn sàng!</b>`); notifyLines.push(`Mã đơn: <code>${dr.orderId}</code>`); notifyLines.push(`\nNhấn nút bên dưới để mở khoá và nhận thông tin tài khoản.`); notifyLines.push(`\n<i>Chỉ bạn mới có thể mở khoá tài khoản này.</i>`); }
  const btnText = isEN ? "🔓 Unlock Account" : "🔓 Mở khoá nhận tài khoản";
  const result = await sendTelegramWithCallbackButton(dr.userId, notifyLines.join("\n"), btnText, `unlock_del:${dr.orderId}`);
  addLog("DELIVERY_PENDING_UNLOCK", `${dr.username || dr.userId} → ${firstAcc.account}`, "web-admin").catch(() => {});
  if (!result.ok) { res.json({ ok: true, warned: `Đã lưu tài khoản nhưng gửi Telegram thất bại: ${result.error}` }); return; }
  res.json({ ok: true });
});

router.post("/bot/delivery/:id/done", requireAuth, async (req: any, res: any) => {
  const { id } = req.params; const { note, notify } = req.body ?? {};
  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx];
  requests[idx] = { ...dr, status: "done", doneAt: now(), doneBy: "web-admin", doneNote: note || null, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  await writeJson("delivery_requests", requests);
  addLog("DELIVERY_DONE", `${dr.username || dr.userId} | Order: ${dr.orderId}`, "web-admin").catch(() => {});
  if (notify) {
    const userLang = dr.userLang ?? "vi"; const isEN = userLang === "en"; const lines: string[] = [];
    if (isEN) { lines.push(`✅ <b>Your delivery request has been processed.</b>`); lines.push(`📦 Order: <code>${dr.orderId}</code>`); if (note) lines.push(`📝 Note: ${note}`); }
    else { lines.push(`✅ <b>Yêu cầu giao tài khoản của bạn đã được xử lý xong.</b>`); lines.push(`📦 Mã đơn: <code>${dr.orderId}</code>`); if (note) lines.push(`📝 Ghi chú: ${note}`); }
    const result = await sendTelegramMessage(dr.userId, lines.join("\n"));
    if (!result.ok) { res.json({ ok: true, warned: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` }); return; }
  }
  res.json({ ok: true });
});

router.post("/bot/delivery/:id/refund", requireAuth, async (req: any, res: any) => {
  const { id } = req.params; const { amount, note } = req.body ?? {};
  if (!amount && amount !== 0) { res.status(400).json({ ok: false, message: "Số tiền hoàn là bắt buộc" }); return; }
  const requests: any[] = readJson("delivery_requests", []) ?? [];
  const idx = requests.findIndex((r: any) => r.id === id);
  if (idx === -1) { res.status(404).json({ ok: false, message: "Không tìm thấy yêu cầu" }); return; }
  const dr = requests[idx]; const userLang = dr.userLang ?? "vi"; const isEN = userLang === "en"; const amtNum = Number(amount) || 0; const amtStr = amtNum.toLocaleString("vi-VN") + "đ";
  const lines: string[] = [];
  if (isEN) { lines.push(`💰 <b>Your delivery request has been refunded</b>\n`); lines.push(`📦 Order: <code>${dr.orderId}</code>`); lines.push(`💵 Refund amount: <b>${amtStr}</b>`); if (note) lines.push(`📝 Note: ${note}`); lines.push(`\nPlease contact support if you have any questions.`); }
  else { lines.push(`💰 <b>Yêu cầu giao tài khoản đã được hoàn tiền</b>\n`); lines.push(`📦 Mã đơn: <code>${dr.orderId}</code>`); lines.push(`💵 Số tiền hoàn: <b>${amtStr}</b>`); if (note) lines.push(`📝 Ghi chú: ${note}`); lines.push(`\nVui lòng liên hệ hỗ trợ nếu bạn có thắc mắc.`); }
  const result = await sendTelegramMessage(dr.userId, lines.join("\n"));
  const refundedAt = now();
  requests[idx] = { ...dr, status: "refunded", refundedAt, refundedBy: "web-admin", refundAmount: amtNum, refundNote: note || null, reminderEnabled: false, nextReminderAt: null, reminderProcessing: false };
  await writeJson("delivery_requests", requests);
  const orders: any = readJson("orders", {}) ?? {};
  if (dr.orderId && orders[dr.orderId]) { orders[dr.orderId].status = "refunded"; orders[dr.orderId].refundedAt = refundedAt; orders[dr.orderId].refundAmount = amtNum; await writeJson("orders", orders); }
  const orderItems: any = readJson("order_items", {}) ?? {}; const itemList: any[] = orderItems[dr.orderId] ?? [];
  if (itemList.length > 0) { orderItems[dr.orderId] = itemList.map((it: any) => ({ ...it, item_status: "refunded", refunded_at: refundedAt, refund_amount: amtNum, refund_admin_id: "web-admin", support_enabled: false })); await writeJson("order_items", orderItems); }
  const refundRecords: any = readJson("refund_records", {}) ?? {};
  refundRecords[dr.orderId] = { orderId: dr.orderId, amount: amtNum, note: note || null, refundedAt, refundedBy: "web-admin", source: "delivery" };
  await writeJson("refund_records", refundRecords);
  const deliveryRefundHistory: any[] = readJson("refund_history", []) ?? [];
  deliveryRefundHistory.push({ id: crypto.randomUUID(), warrantyRequestId: null, orderId: dr.orderId || null, orderCode: dr.orderId || null, account: dr.username || dr.userId || "", email: "", amount: amtNum, note: note || "", refundedAt, refundedBy: "web-admin", reason: note || "", source: "delivery" });
  await writeJson("refund_history", deliveryRefundHistory);
  addLog("DELIVERY_REFUNDED", `${dr.username || dr.userId} | ${amtStr}`, "web-admin").catch(() => {});
  if (!result.ok) { res.status(500).json({ ok: false, message: `Đã lưu nhưng gửi Telegram thất bại: ${result.error}` }); return; }
  res.json({ ok: true });
});

export default router;
