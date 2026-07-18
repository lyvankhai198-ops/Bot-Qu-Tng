# bot.py — Bot Quà Tặng AI
# 5-button menu. All admin features managed via web panel.
# Support = order lookup + báo lỗi. No admin contact info exposed.

import os
import re
import logging
import time
import json as _json
import urllib.request
import urllib.error
from datetime import datetime, timedelta, date
from threading import Thread

from flask import Flask, jsonify
from telegram import (
    Update, ReplyKeyboardMarkup, InlineKeyboardMarkup, InlineKeyboardButton,
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters,
)
from telegram.constants import ParseMode

import data_manager as db
from translations import t

# ─── Config ───────────────────────────────────────────────────────────────────
logging.basicConfig(format="%(asctime)s — %(levelname)s — %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

TOKEN   = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0"))

# ─── Helpers ──────────────────────────────────────────────────────────────────

def lang(user_id: int) -> str:
    return db.get_user_lang(user_id) or "vi"

def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID

def main_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup([
        [t(L, "btn_support"), t(L, "btn_gift")],
        [t(L, "btn_check_order"), t(L, "btn_shop")],
        [t(L, "btn_intro")],
    ], resize_keyboard=True)

def back_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup([[t(L, "btn_home")]], resize_keyboard=True)

def lang_inline() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🇻🇳 Tiếng Việt", callback_data="lang:vi"),
        InlineKeyboardButton("🇬🇧 English",    callback_data="lang:en"),
    ]])

def shop_inline(L: str, settings: dict) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(t(L, "btn_open_shop"), url=settings["shop_link"])
    ]])

def order_inline(L: str, order_id: str, can_report: bool = True) -> InlineKeyboardMarkup:
    """Single-account order keyboard. Hides report button when warranty expired."""
    back_btn = InlineKeyboardButton(t(L, "btn_back_menu"), callback_data="order:back")
    if can_report:
        return InlineKeyboardMarkup([[
            InlineKeyboardButton(t(L, "btn_report_issue"), callback_data=f"order:report:{order_id}"),
            back_btn,
        ]])
    return InlineKeyboardMarkup([[back_btn]])

def order_inline_single_in_multi(L: str, order_id: str, can_report: bool = True) -> InlineKeyboardMarkup:
    """
    Keyboard for email lookup that hit a multi-account order.
    Only shows 'Report this account' (no 'Report all') + Back.
    """
    vi = L == "vi"
    back_btn = InlineKeyboardButton(
        f"🔙 {'Quay lại' if vi else 'Back'}",
        callback_data="order:back",
    )
    if can_report:
        return InlineKeyboardMarkup([[
            InlineKeyboardButton(
                f"🚨 {'Báo lỗi tài khoản này' if vi else 'Report this account'}",
                callback_data=f"order:report:{order_id}",
            ),
            back_btn,
        ]])
    return InlineKeyboardMarkup([[back_btn]])

def order_inline_multi(L: str, order_id: str, n_eligible: int, n_total: int) -> InlineKeyboardMarkup:
    """Multi-account order keyboard. Shows report buttons only when there are eligible accounts."""
    vi = L == "vi"
    rows = []
    if n_eligible > 0:
        rows.append([
            InlineKeyboardButton(
                f"📋 {'Báo lỗi tất cả' if vi else 'Report all'} ({n_eligible})",
                callback_data=f"order:report_all:{order_id}",
            ),
            InlineKeyboardButton(
                f"🔘 {'Chọn tài khoản' if vi else 'Pick accounts'}",
                callback_data=f"order:pick_items:{order_id}",
            ),
        ])
    rows.append([
        InlineKeyboardButton(
            f"🔙 {'Quay lại' if vi else 'Back'}",
            callback_data="order:back",
        ),
    ])
    return InlineKeyboardMarkup(rows)

# ─── Order display helper ─────────────────────────────────────────────────────

_VND_PER_USDT = 10_000 / 0.38  # ≈ 26,315.79 VND per USDT

def _fmt_price(vnd: float, L: str = "vi") -> str:
    """Format price: VND for vi, USDT for en."""
    if L == "en":
        usdt = vnd / _VND_PER_USDT
        if usdt < 0.01:
            return f"{usdt:.4f} USDT"
        return f"{usdt:.2f} USDT"
    return f"{int(vnd):,}đ"

def _fmt_order(L: str, order: dict, settings: dict,
               item: dict = None, is_in_multi_order: bool = False) -> str:
    """
    Format a single-account order display per spec §5 / §3.
    item        — if supplied: use chain/per-item warranty calc; else use order-level legacy calc.
    is_in_multi_order — True when email lookup hit a multi-account order (adds advisory note §3).
    """
    vi = L == "vi"
    header = "📦 THÔNG TIN ĐƠN HÀNG" if vi else "📦 ORDER INFORMATION"
    lines = [f"<b>{header}</b>\n"]

    if item:
        wdata = db.calc_item_warranty(item, order, settings)
        w_status       = wdata["warrantyStatus"]          # "active" | "expired" | "no_data" | "unknown"
        original_account  = item.get("original_account") or item.get("email") or ""
        current_account   = item.get("current_account")  or item.get("email") or ""
        replacement_count = item.get("current_replacement_number") or 0
        # Dates per spec §7 / §8
        purchase_date  = (
            item.get("original_delivered_at") or
            order.get("paymentAt") or
            order.get("purchaseDate") or ""
        )
        # Expiry: explicit field first, then compute from purchaseDate + warrantyDays
        _expiry_raw = (order.get("expiryDate") or "")[:10]
        if not _expiry_raw:
            _pd = (order.get("purchaseDate") or "")[:10]
            _wd = int(order.get("warrantyDays") or 0)
            if _pd and _wd:
                try:
                    from datetime import timedelta as _td2
                    _expiry_raw = (__import__("datetime").date.fromisoformat(_pd) + _td2(days=_wd)).isoformat()
                except Exception:
                    pass
        expiry_date    = _expiry_raw or "N/A"
        warranty_end   = (wdata["warrantyEndDate"] or "")[:10] or "N/A"
        remaining      = wdata["remainingDays"]
        can_report     = wdata["canReport"]
        refund_amt     = wdata["refundAmount"]

        # "Email/tài khoản" line: show current_account (= effective account to use)
        display_account = current_account or original_account

        remaining_str = (
            "N/A" if remaining is None
            else (t(L, "expired") if remaining == 0 else t(L, "days_left", n=remaining))
        )

        price = order.get("price", 0) or 0
        price_str = _fmt_price(int(price), L) if price else "N/A"

        if not can_report or w_status in ("no_data", "unknown"):
            refund_str = None
        elif isinstance(refund_amt, str):
            refund_str = refund_amt
        else:
            refund_str = f"~{_fmt_price(refund_amt, L)}" if refund_amt else "N/A"

        lines.append(f"🏷 {'Mã đơn' if vi else 'Order'}: <code>{order.get('orderId','')}</code>")
        lines.append(f"📧 {'Email/tài khoản' if vi else 'Account'}: <code>{display_account}</code>")
        lines.append(f"📦 {'Sản phẩm' if vi else 'Product'}: <b>{order.get('productName','')}</b>")
        lines.append(f"📅 {'Ngày mua' if vi else 'Purchase date'}: {purchase_date[:10] if purchase_date else 'N/A'}")
        lines.append(f"📅 {'Ngày hết hạn' if vi else 'Expiry date'}: {expiry_date}")

        if w_status == "no_data":
            # §14 validation — missing date data
            warn = (
                "⚠️ <i>Đơn hàng chưa đủ dữ liệu để tính bảo hành. "
                "Vui lòng liên hệ hỗ trợ.</i>"
            ) if vi else (
                "⚠️ <i>Order is missing warranty data. Please contact support.</i>"
            )
            lines.append(warn)
        else:
            warranty_icon = "✅" if can_report else "❌"
            warranty_label = t(L, "warranty_valid") if can_report else t(L, "warranty_expired")
            lines.append(f"⌛ {'Còn lại' if vi else 'Remaining'}: {remaining_str}")
            lines.append(f"🛡 {'Bảo hành đến' if vi else 'Warranty until'}: {warranty_end}")
            lines.append(f"{warranty_icon} {'Trạng thái BH' if vi else 'Warranty status'}: {warranty_label}")
            lines.append(f"💰 {'Giá mua' if vi else 'Price'}: {price_str}")
            if can_report and refund_str:
                lines.append(f"💵 {'Hoàn dự kiến' if vi else 'Est. Refund'}: {refund_str}")
            status_label = (
                ("Đang hoạt động" if vi else "Active") if can_report
                else ("Hết bảo hành" if vi else "Warranty expired")
            )
            lines.append(f"📊 {'Trạng thái' if vi else 'Status'}: {status_label}")

        # Replacement chain section (spec §5 / §12)
        if replacement_count > 0:
            lines.append("")
            lines.append(f"📧 {'Tài khoản gốc' if vi else 'Original account'}: <code>{original_account}</code>")
            lines.append(f"🔄 {'Tài khoản hiện tại' if vi else 'Current account'}: <code>{current_account}</code>")
            lines.append(f"🔢 {'Số lần bảo hành' if vi else 'Times replaced'}: {replacement_count}")

        # Multi-account advisory (spec §3)
        if is_in_multi_order:
            note = (
                "\n💡 <i>Đây là một tài khoản thuộc đơn có nhiều tài khoản. "
                "Vui lòng dùng mã đơn để xem hoặc báo lỗi toàn bộ đơn.</i>"
            ) if vi else (
                "\n💡 <i>This account belongs to a multi-account order. "
                "Use the order code to view or report all accounts.</i>"
            )
            lines.append(note)

        return "\n".join(lines)

    # ── Legacy path: no item record ──────────────────────────────────────────
    data = db.calc_order_display(order, settings)
    remaining  = data.get("_remaining_days")
    warranty_ok = data.get("_warranty_ok")
    refund_amt  = data.get("_refund_amount")

    remaining_str = (
        "N/A" if remaining is None
        else (t(L, "expired") if remaining == 0 else t(L, "days_left", n=remaining))
    )
    warranty_str = (
        "N/A" if warranty_ok is None
        else (t(L, "warranty_valid") if warranty_ok else t(L, "warranty_expired"))
    )
    if refund_amt is None:
        refund_str = "N/A"
    elif isinstance(refund_amt, str):
        refund_str = refund_amt
    else:
        refund_str = f"~{_fmt_price(refund_amt, L)}"

    price = order.get("price", 0) or 0
    price_str = _fmt_price(int(price), L) if price else "N/A"

    status_map = {
        "active":    t(L, "status_active"),
        "warranted": t(L, "status_warranted"),
        "refunded":  t(L, "status_refunded"),
        "expired":   t(L, "status_expired"),
    }
    status_str = status_map.get(order.get("status", "active"), order.get("status", ""))

    vi = L == "vi"
    resolved_expiry = data.get("_resolved_expiry_date") or (order.get("expiryDate") or "")[:10]
    warranty_icon = ""
    if warranty_ok is True:
        warranty_icon = "✅ "
    elif warranty_ok is False:
        warranty_icon = "❌ "
    lines_leg = [f"<b>📦 {'THÔNG TIN ĐƠN HÀNG' if vi else 'ORDER INFORMATION'}</b>\n"]
    lines_leg.append(f"🏷 {'Mã đơn' if vi else 'Order'}: <code>{order.get('orderId','')}</code>")
    lines_leg.append(f"📧 {'Email' if vi else 'Email'}: <code>{order.get('email','')}</code>")
    lines_leg.append(f"📦 {'Sản phẩm' if vi else 'Product'}: <b>{order.get('productName','')}</b>")
    lines_leg.append(f"📅 {'Ngày mua' if vi else 'Purchase date'}: {(order.get('purchaseDate') or '')[:10] or 'N/A'}")
    lines_leg.append(f"📅 {'Ngày hết hạn' if vi else 'Expiry date'}: {resolved_expiry or 'N/A'}")
    lines_leg.append(f"⌛ {'Còn lại' if vi else 'Remaining'}: {remaining_str}")
    lines_leg.append(f"🛡 {'Bảo hành đến' if vi else 'Warranty until'}: {(order.get('warrantyExpiry') or order.get('warrantyDate') or '')[:10] or 'N/A'}")
    lines_leg.append(f"{warranty_icon}{'Trạng thái BH' if vi else 'Warranty status'}: {warranty_str}")
    lines_leg.append(f"💰 {'Giá mua' if vi else 'Price'}: {price_str}")
    lines_leg.append(f"💵 {'Hoàn dự kiến' if vi else 'Est. Refund'}: {refund_str}")
    lines_leg.append(f"📊 {'Trạng thái' if vi else 'Status'}: <b>{status_str}</b>")
    return "\n".join(lines_leg)

def _fmt_order_multi(L: str, order: dict, items: list, settings: dict) -> str:
    """
    Format a multi-account order per spec §4.
    Order-level warranty info at top; per-item status labels in list.
    Per-item labels: Đang hoạt động | Đã thay thế | Hết bảo hành.
    """
    vi = L == "vi"
    # Order-level warranty computation (uses order header dates)
    data = db.calc_order_display(order, settings)
    remaining_days = data.get("_remaining_days")
    warranty_ok    = data.get("_warranty_ok")
    # Warranty end date: prefer warrantyExpiry/warrantyDate field
    warranty_end_str = (
        order.get("warrantyExpiry") or order.get("warrantyDate") or
        (order.get("purchaseDate") and
         f"(calc from {order.get('purchaseDate','')[:10]})")
        or "N/A"
    )
    if warranty_end_str and warranty_end_str != "N/A":
        warranty_end_str = warranty_end_str[:10]

    price = order.get("price", 0) or 0
    price_str = _fmt_price(int(price), L) if price else "N/A"

    remaining_str = (
        "N/A" if remaining_days is None
        else (t(L, "expired") if remaining_days == 0 else t(L, "days_left", n=remaining_days))
    )
    if warranty_ok is None:
        warranty_label = "N/A"
        warranty_icon  = "⚪"
    elif warranty_ok:
        warranty_label = t(L, "warranty_valid")
        warranty_icon  = "✅"
    else:
        warranty_label = t(L, "warranty_expired")
        warranty_icon  = "❌"

    status_map = {
        "active":    t(L, "status_active"),
        "warranted": t(L, "status_warranted"),
        "refunded":  t(L, "status_refunded"),
        "expired":   t(L, "status_expired"),
    }
    status_str = status_map.get(order.get("status", "active"), order.get("status", ""))

    header = "📦 THÔNG TIN ĐƠN HÀNG" if vi else "📦 ORDER INFORMATION"
    lines = [f"<b>{header}</b>\n"]
    lines.append(f"🏷 {'Mã đơn' if vi else 'Order'}: <code>{order.get('orderId','')}</code>")
    lines.append(f"📦 {'Sản phẩm' if vi else 'Product'}: <b>{order.get('productName','')}</b>")
    if order.get("customerName"):
        lines.append(f"👤 {'Khách hàng' if vi else 'Customer'}: {order.get('customerName','')}")
    lines.append(f"📅 {'Ngày mua' if vi else 'Purchase date'}: {(order.get('purchaseDate','') or '')[:10] or 'N/A'}")
    lines.append(f"📅 {'Ngày hết hạn' if vi else 'Expiry date'}: {(order.get('expiryDate','') or '')[:10] or 'N/A'}")
    lines.append(f"🛡 {'Bảo hành đến' if vi else 'Warranty until'}: {warranty_end_str}")
    lines.append(f"⌛ {'Còn lại' if vi else 'Remaining'}: {remaining_str}")
    lines.append(f"{warranty_icon} {'Trạng thái bảo hành' if vi else 'Warranty status'}: {warranty_label}")
    lines.append(f"💰 {'Tổng giá trị đơn' if vi else 'Total order value'}: {price_str}")
    lines.append(f"📊 {'Trạng thái' if vi else 'Status'}: {status_str}")
    lines.append(f"📦 {'Số lượng' if vi else 'Quantity'}: <b>{len(items)}</b>")
    lines.append(f"\n<b>{'DANH SÁCH TÀI KHOẢN' if vi else 'ACCOUNT LIST'}</b>")

    n_eligible = 0
    for i, item in enumerate(items, 1):
        display_acc = item.get("original_account") or item.get("email") or ""
        rep_count   = item.get("current_replacement_number") or 0
        wdata = db.calc_item_warranty(item, order, settings)
        can   = wdata["canReport"]
        w_st  = wdata["warrantyStatus"]

        if w_st == "expired":
            label = "Hết bảo hành" if vi else "Warranty expired"
            icon  = "❌"
        elif rep_count > 0:
            label = "Đã thay thế" if vi else "Replaced"
            icon  = "🔄"
            if can:
                n_eligible += 1
        else:
            label = "Đang hoạt động" if vi else "Active"
            icon  = "✅"
            if can:
                n_eligible += 1

        lines.append(f"  {i}. {icon} <code>{display_acc}</code> — {label}")

    if n_eligible == 0:
        expired_note = "\n⚠️ <i>Không còn tài khoản nào đủ điều kiện bảo hành.</i>" if vi else \
                       "\n⚠️ <i>No accounts in this order are eligible for warranty.</i>"
        lines.append(expired_note)

    return "\n".join(lines)

# ─── /start ───────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    db.save_user(user.id, user.username, user.first_name)
    await update.message.reply_text(
        "🌐 <b>Chọn ngôn ngữ / Choose language</b>",
        parse_mode=ParseMode.HTML,
        reply_markup=lang_inline(),
    )

async def callback_lang(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    user = query.from_user
    chosen = query.data.split(":")[1]
    db.set_user_lang(user.id, chosen)
    db.save_user(user.id, user.username, user.first_name)
    L = chosen
    welcome = t(L, "welcome_admin", name=user.first_name or "Admin") if is_admin(user.id) else t(L, "welcome", name=user.first_name or "User")
    await query.edit_message_text(f"{t(L, 'lang_chosen')}\n\n{welcome}", parse_mode=ParseMode.HTML)
    await context.bot.send_message(user.id, welcome, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))

async def cmd_myid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(f"🆔 Your ID: <code>{update.effective_user.id}</code>", parse_mode=ParseMode.HTML)

# ─── Show main menu ───────────────────────────────────────────────────────────

async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state")
    db.clear_user_state(user.id, "_report_order_id")
    msg = t(L, "welcome_admin", name=user.first_name or "Admin") if is_admin(user.id) else t(L, "welcome", name=user.first_name or "User")
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))

# ─── Maintenance check ────────────────────────────────────────────────────────

async def maintenance_reply(update: Update, L: str) -> bool:
    settings = db.get_settings()
    if settings.get("maintenance_mode"):
        await update.message.reply_text(t(L, "maintenance"))
        return True
    return False

# ─── 🎁 Nhận Quà ─────────────────────────────────────────────────────────────

async def handle_gift(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()

    if not settings.get("gift_enabled", True):
        await update.message.reply_text(t(L, "gift_disabled"))
        return

    if db.is_banned(user.id):
        await update.message.reply_text(t(L, "gift_banned"))
        return

    if db.stock_count() == 0:
        await update.message.reply_text(t(L, "gift_empty"))
        return

    round_id = settings["round_id"]
    cooldown_h = settings["cooldown_hours"]
    claimed = db.get_claimed(round_id)
    uid = str(user.id)

    if uid in claimed:
        if cooldown_h == 0:
            await update.message.reply_text(t(L, "gift_already_round"))
            return
        claim_time = datetime.fromisoformat(claimed[uid]["claim_time"])
        eligible_at = claim_time + timedelta(hours=cooldown_h)
        if datetime.now() < eligible_at:
            rem = eligible_at - datetime.now()
            h = int(rem.total_seconds() // 3600)
            m = int((rem.total_seconds() % 3600) // 60)
            await update.message.reply_text(t(L, "gift_already", h=h, m=m))
            return

    account = db.pop_account()
    if not account:
        await update.message.reply_text(t(L, "gift_empty"))
        return

    email    = account.get("email", "")
    password = account.get("password", "")
    now_str  = datetime.now().isoformat()

    db.add_claim(round_id, user.id, user.username, user.first_name, email, now_str)
    db.add_log("CLAIM_GIFT", f"@{user.username} ({user.id})", "")

    await update.message.reply_text(
        t(L, "gift_success", email=email, password=password),
        parse_mode=ParseMode.HTML,
        reply_markup=shop_inline(L, settings),
    )

    if ADMIN_ID:
        try:
            await context.bot.send_message(
                ADMIN_ID,
                t("vi", "gift_admin_notify", username=user.username or user.first_name, user_id=user.id, email=email),
                parse_mode=ParseMode.HTML,
            )
        except Exception:
            pass

# ─── 💬 Hỗ Trợ — order lookup entry ─────────────────────────────────────────

# ─── 💬 Multi-Account Support ─────────────────────────────────────────────────

_MW_MAX_DEFAULT = 20

def _mw_compute_account(order: dict, settings: dict, item: dict = None) -> dict:
    """Build the minimal account record used for summary display and state storage."""
    if item:
        wdata = db.calc_item_warranty(item, order, settings)
        can_report  = wdata["canReport"]
        days_left   = wdata["remainingDays"]
        warranty_ok = can_report  # True / False (never None from calc_item_warranty)
    else:
        data = db.calc_order_display(order, settings)
        warranty_ok = data.get("_warranty_ok")
        days_left   = data.get("_remaining_days")
        can_report  = bool(warranty_ok)
    return {
        "orderId":     order.get("orderId", ""),
        "email":       order.get("email", ""),
        "productName": order.get("productName") or order.get("type") or "?",
        "warrantyOk":  warranty_ok,
        "daysLeft":    days_left,
        "canReport":   can_report,
    }

def _mw_summary_text(L: str, found: list, not_found: list, blocked: list, expired: list = None) -> str:
    vi = L == "vi"
    expired = expired or []
    total = len(found) + len(not_found) + len(blocked) + len(expired)
    lines = [
        f"📋 <b>{'KẾT QUẢ TRA CỨU' if vi else 'LOOKUP RESULTS'}</b>",
        f"{'Đã nhập' if vi else 'Entered'}: <b>{total}</b> {'tài khoản' if vi else 'account(s)'}",
    ]
    if found:
        lines.append(f"\n✅ <b>{'Còn bảo hành — có thể báo lỗi' if vi else 'In warranty — can report'} ({len(found)})</b>:")
        for i, a in enumerate(found, 1):
            days = a.get("daysLeft")
            w = f"✅ {'Còn BH' if vi else 'In warranty'} ({days} {'ngày' if vi else 'days'})" if days else f"✅ {'Còn BH' if vi else 'In warranty'}"
            lines.append(f"  {i}. <code>{a['email']}</code> — {a.get('productName','?')} | {w}")
    if expired:
        lines.append(f"\n❌ <b>{'Hết bảo hành — không thể báo lỗi' if vi else 'Warranty expired — cannot report'} ({len(expired)})</b>:")
        for a in expired:
            lines.append(f"  • <code>{a['email']}</code> — {a.get('productName','?')}")
    if not_found:
        lines.append(f"\n🔍 <b>{'Không tìm thấy' if vi else 'Not found'} ({len(not_found)})</b>:")
        for e in not_found:
            lines.append(f"  • <code>{e}</code>")
    if blocked:
        lines.append(f"\n⚠️ <b>{'Đang có yêu cầu xử lý' if vi else 'Open request exists'} ({len(blocked)})</b>:")
        for e in blocked:
            lines.append(f"  • <code>{e}</code>")
    return "\n".join(lines)

def _mw_select_text(L: str, found: list, selected: set) -> str:
    vi = L == "vi"
    lines = [f"🔘 <b>{'Chọn tài khoản cần báo lỗi' if vi else 'Select accounts to report'}</b> ({'bấm để chọn/bỏ' if vi else 'tap to toggle'}):\n"]
    for i, a in enumerate(found):
        icon = "✅" if i in selected else "☐"
        lines.append(f"{icon} {i+1}. <code>{a['email']}</code>")
    lines.append(f"\n{'Đã chọn' if vi else 'Selected'}: <b>{len(selected)}</b>")
    return "\n".join(lines)

def _mw_initial_kb(L: str, n: int) -> InlineKeyboardMarkup:
    """n = number of warranty-valid (reportable) accounts."""
    vi = L == "vi"
    rows = []
    if n > 0:
        rows.append([
            InlineKeyboardButton(f"📋 {'Báo lỗi tất cả' if vi else 'Report all'} ({n})", callback_data="mw:all"),
            InlineKeyboardButton(f"🔘 {'Chọn cụ thể' if vi else 'Pick accounts'}", callback_data="mw:pick"),
        ])
    rows.append([InlineKeyboardButton(f"🔙 {'Quay lại' if vi else 'Back'}", callback_data="mw:back")])
    return InlineKeyboardMarkup(rows)

def _mw_select_kb(L: str, found: list, selected: set) -> InlineKeyboardMarkup:
    vi = L == "vi"
    rows = []
    for i, a in enumerate(found):
        icon = "✅" if i in selected else "☐"
        short = a["email"][:22] + "…" if len(a["email"]) > 22 else a["email"]
        rows.append([InlineKeyboardButton(f"{icon} {i+1}. {short}", callback_data=f"mw:t:{i}")])
    n = len(selected)
    confirm_lbl = f"✅ {'Xác nhận' if vi else 'Confirm'} ({n})" if n else (f"{'Chọn ít nhất 1' if vi else 'Pick at least 1'}")
    rows.append([
        InlineKeyboardButton(confirm_lbl, callback_data="mw:ok" if n else "mw:noop"),
        InlineKeyboardButton(f"🔙 {'Quay lại' if vi else 'Back'}", callback_data="mw:back"),
    ])
    return InlineKeyboardMarkup(rows)

async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    if not db.get_settings().get("support_enabled", True):
        await update.message.reply_text(t(L, "support_disabled"))
        return
    max_acc = int(db.get_settings().get("maxAccountsPerRequest", _MW_MAX_DEFAULT))
    db.set_user_state(user.id, "conv_state", "support_multi_input")
    await update.message.reply_text(
        t(L, "support_multi_ask").format(max=max_acc),
        parse_mode=ParseMode.HTML,
        reply_markup=back_keyboard(user.id),
    )

async def handle_multi_account_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Parse multi-line email input, look up orders, show summary with action buttons."""
    user = update.effective_user
    L = lang(user.id)
    text = update.message.text.strip()
    settings = db.get_settings()
    max_acc = int(settings.get("maxAccountsPerRequest", _MW_MAX_DEFAULT))

    # Parse + dedup
    seen: set = set()
    emails: list = []
    for line in text.splitlines():
        e = line.strip()
        if e and e.lower() not in seen:
            seen.add(e.lower())
            emails.append(e)

    if not emails:
        await update.message.reply_text(t(L, "support_multi_empty"), parse_mode=ParseMode.HTML)
        return
    if len(emails) > max_acc:
        await update.message.reply_text(t(L, "support_multi_too_many").format(max=max_acc), parse_mode=ParseMode.HTML)
        return

    open_emails = db.get_open_warranty_emails(user.id)
    found: list = []
    not_found: list = []
    blocked: list = []

    # Keep full order+item for card rendering
    found_full:   list = []   # (order, item) — reportable (in warranty)
    expired_full: list = []   # (order, item) — found but warranty expired
    expired: list = []        # summary records for expired

    for e in emails:
        result = db.find_order_with_items(e)
        order = result.get("order")
        if not order:
            not_found.append(e)
            continue
        matched_item = result.get("matchedItem")
        canonical_email = (matched_item.get("email", "") if matched_item else "") or order.get("email", e) or e
        if canonical_email.lower() in open_emails:
            blocked.append(e)
            continue
        if matched_item and not order.get("email"):
            order = {**order, "email": canonical_email}
        acc = _mw_compute_account(order, settings, item=matched_item)
        if not acc["canReport"]:
            # Warranty expired — cannot report, show card but do NOT add to reportable list
            expired.append(acc)
            expired_full.append((order, matched_item))
        else:
            found.append(acc)
            found_full.append((order, matched_item))

    # Always send full order card(s) for every account (found OR expired), up to 3 total
    _CARD_THRESHOLD = 3
    all_full = found_full + expired_full
    if len(all_full) <= _CARD_THRESHOLD:
        for (ord_, mit_) in all_full:
            card_text = _fmt_order(L, ord_, settings, item=mit_)
            await update.message.reply_text(card_text, parse_mode=ParseMode.HTML)

    # No reportable accounts at all → show summary + back only
    if not found:
        summary = _mw_summary_text(L, found, not_found, blocked, expired=expired)
        await update.message.reply_text(
            summary,
            parse_mode=ParseMode.HTML,
            reply_markup=_mw_initial_kb(L, 0),   # only "Quay lại"
        )
        db.clear_user_state(user.id, "conv_state")
        return

    db.set_user_state(user.id, "_mw_found", _json.dumps(found, ensure_ascii=False))
    db.set_user_state(user.id, "_mw_not_found", _json.dumps(not_found, ensure_ascii=False))
    db.set_user_state(user.id, "_mw_sel", ",".join(str(i) for i in range(len(found))))
    db.clear_user_state(user.id, "conv_state")

    await update.message.reply_text(
        _mw_summary_text(L, found, not_found, blocked, expired=expired),
        parse_mode=ParseMode.HTML,
        reply_markup=_mw_initial_kb(L, len(found)),
    )

async def callback_multi_warranty(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle mw:* inline keyboard callbacks for multi-account warranty flow."""
    query = update.callback_query
    user  = query.from_user
    L     = lang(user.id)
    data  = query.data  # mw:all | mw:pick | mw:t:N | mw:ok | mw:back | mw:noop

    if data == "mw:noop":
        vi = L == "vi"
        await query.answer("Vui lòng chọn ít nhất 1 tài khoản." if vi else "Select at least 1 account.", show_alert=True)
        return

    if data == "mw:back":
        await query.answer()
        for key in ("_mw_found", "_mw_not_found", "_mw_sel", "conv_state"):
            db.clear_user_state(user.id, key)
        await query.message.reply_text(
            t(L, "welcome", name=user.first_name or "User"),
            parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id),
        )
        return

    state = db.get_user_state(user.id)
    found_json = state.get("_mw_found", "[]")
    try:
        found = _json.loads(found_json)
    except Exception:
        found = []
    if not found:
        await query.answer("Phiên đã hết hạn. Vui lòng nhập lại." if L == "vi" else "Session expired.", show_alert=True)
        return

    sel_str = state.get("_mw_sel", ",".join(str(i) for i in range(len(found))))
    selected = set(int(x) for x in sel_str.split(",") if x.strip().isdigit())

    if data == "mw:all":
        await query.answer()
        db.set_user_state(user.id, "_mw_sel", ",".join(str(i) for i in range(len(found))))
        db.set_user_state(user.id, "conv_state", "support_multi_desc")
        await query.message.reply_text(t(L, "support_multi_desc_ask"), parse_mode=ParseMode.HTML, reply_markup=back_keyboard(user.id))
        return

    if data == "mw:pick":
        await query.answer()
        try:
            await query.edit_message_text(
                _mw_select_text(L, found, selected), parse_mode=ParseMode.HTML,
                reply_markup=_mw_select_kb(L, found, selected),
            )
        except Exception:
            pass
        return

    if data.startswith("mw:t:"):
        try:
            idx = int(data[5:])
        except ValueError:
            await query.answer(); return
        if idx in selected: selected.discard(idx)
        else: selected.add(idx)
        db.set_user_state(user.id, "_mw_sel", ",".join(str(i) for i in sorted(selected)))
        await query.answer()
        try:
            await query.edit_message_text(
                _mw_select_text(L, found, selected), parse_mode=ParseMode.HTML,
                reply_markup=_mw_select_kb(L, found, selected),
            )
        except Exception:
            pass
        return

    if data == "mw:ok":
        if not selected:
            await query.answer("Vui lòng chọn ít nhất 1 tài khoản." if L == "vi" else "Select at least 1.", show_alert=True)
            return
        await query.answer()
        db.set_user_state(user.id, "conv_state", "support_multi_desc")
        await query.message.reply_text(t(L, "support_multi_desc_ask"), parse_mode=ParseMode.HTML, reply_markup=back_keyboard(user.id))
        return

    await query.answer()

async def handle_multi_warranty_desc(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Receive description and create the group warranty request."""
    user = update.effective_user
    L    = lang(user.id)
    description = update.message.text.strip()

    state = db.get_user_state(user.id)
    try:
        found = _json.loads(state.get("_mw_found", "[]"))
    except Exception:
        found = []
    sel_str = state.get("_mw_sel", ",".join(str(i) for i in range(len(found))))
    selected_indices = sorted(int(x) for x in sel_str.split(",") if x.strip().isdigit() and int(x) < len(found))
    selected_accounts = [found[i] for i in selected_indices]

    for key in ("conv_state", "_mw_found", "_mw_not_found", "_mw_sel"):
        db.clear_user_state(user.id, key)

    if not selected_accounts:
        await update.message.reply_text(t(L, "support_multi_empty"), parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
        return

    # ── Server-side warranty expiry gate (covers ALL entry paths) ─────────────
    # Filter selected_accounts to only those whose item is still under warranty.
    # This is the final check before any group request is persisted, ensuring
    # no expired account can slip through regardless of how it entered the flow.
    settings = db.get_settings()
    eligible_accounts = []
    for acc in selected_accounts:
        acc_order_id = acc.get("orderId", "")
        acc_email    = (acc.get("email") or "").lower()
        if acc_order_id and acc_email:
            acc_order = db.get_order(acc_order_id)
            if acc_order:
                item_found = None
                for it in db.get_order_items(acc_order_id):
                    it_orig = (it.get("original_account") or it.get("email") or "").lower()
                    it_curr = (it.get("current_account")  or it.get("email") or "").lower()
                    if acc_email in (it_orig, it_curr):
                        item_found = it
                        break
                if item_found:
                    wdata = db.calc_item_warranty(item_found, acc_order, settings)
                    if wdata["canReport"]:
                        eligible_accounts.append(acc)
                    # Skip expired items silently (UI already filtered, but be safe)
                    continue
                # No item record → legacy order, allow through
            eligible_accounts.append(acc)
        else:
            # No orderId (e.g. typed-in email without order context) → allow through
            eligible_accounts.append(acc)

    if not eligible_accounts:
        vi = L == "vi"
        msg = (
            "❌ Không có tài khoản nào trong danh sách còn trong thời hạn bảo hành.\n"
            "Vui lòng kiểm tra lại hoặc liên hệ shop."
        ) if vi else (
            "❌ None of the selected accounts are within their warranty period.\n"
            "Please verify or contact support."
        )
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
        return
    selected_accounts = eligible_accounts

    req_id = db.add_group_warranty_request(user.id, user.username, user.first_name, selected_accounts, description, L)
    db.add_log("GROUP_WARRANTY", f"@{user.username} ({user.id}) | {len(selected_accounts)} accounts", "")

    await update.message.reply_text(
        t(L, "support_multi_sent").format(n=len(selected_accounts)),
        parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id),
    )

    req = db.get_warranty_request(req_id)
    if req:
        Thread(target=_notify_admins_warranty, args=(req, None), daemon=True).start()

# ─── 📦 Kiểm Tra Đơn Hàng — order lookup entry ───────────────────────────────

async def handle_check_order(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "check_lookup")
    await update.message.reply_text(
        t(L, "check_order_ask"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_keyboard(user.id),
    )

# ─── Order lookup (shared for support + check_order states) ───────────────────

async def handle_order_lookup(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    # Normalize: strip "email/tài khoản: " prefix if user copies it from a message
    query_text = re.sub(
        r'^(?:email\s*/\s*t[àa]i\s*kho[ảa]n|email|t[àa]i\s*kho[ảa]n)\s*:\s*',
        '', update.message.text.strip(), flags=re.IGNORECASE,
    ).strip()

    result = db.find_order_with_items(query_text)
    db.clear_user_state(user.id, "conv_state")

    if not result["order"]:
        await update.message.reply_text(
            t(L, "order_not_found"),
            parse_mode=ParseMode.HTML,
            reply_markup=main_keyboard(user.id),
        )
        return

    order    = result["order"]
    items    = result["items"]
    settings = db.get_settings()
    order_id = order["orderId"]
    matched_item = result.get("matchedItem")

    db.set_user_state(user.id, "_report_order_id", order_id)

    # Store canonical email for warranty reporting
    report_email = (
        (matched_item.get("original_account") or matched_item.get("email") or "" if matched_item else "") or
        order.get("email", "")
    )
    if items and not report_email:
        report_email = items[0].get("original_account") or items[0].get("email", "")
    db.set_user_state(user.id, "_report_email", report_email)

    # Store item_id so the report flow can re-check warranty server-side
    single_item = matched_item or (items[0] if items else None)
    if single_item:
        db.set_user_state(user.id, "_report_item_id", single_item.get("itemId", ""))

    is_multi = result.get("isMultiAccountOrder", False)

    # Case 1: order-ID lookup with multiple items → full multi-account view (spec §4)
    if result["lookupType"] == "order_id" and len(items) > 1:
        msg = _fmt_order_multi(L, order, items, settings)
        n_eligible = sum(
            1 for it in items
            if db.calc_item_warranty(it, order, settings)["canReport"]
        )
        await update.message.reply_text(
            msg,
            parse_mode=ParseMode.HTML,
            reply_markup=order_inline_multi(L, order_id, n_eligible, len(items)),
        )
        return

    # Case 2: single-item display (email OR single-account order-ID lookup)
    if single_item and not order.get("email"):
        order = {**order, "email": single_item.get("original_account") or single_item.get("email", "")}

    can_report = True
    if single_item:
        wdata = db.calc_item_warranty(single_item, order, settings)
        can_report = wdata["canReport"]

    msg = _fmt_order(L, order, settings, item=single_item, is_in_multi_order=is_multi)

    # Keyboard: email lookup of multi-account order → restricted buttons (spec §3)
    if is_multi and result["lookupType"] == "email":
        kb = order_inline_single_in_multi(L, order_id, can_report=can_report)
    else:
        kb = order_inline(L, order_id, can_report=can_report)

    await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=kb)

# ─── Báo lỗi input ────────────────────────────────────────────────────────────

async def handle_report_issue_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    vi = L == "vi"
    description = update.message.text.strip()
    state    = db.get_user_state(user.id)
    order_id = state.get("_report_order_id", "")
    item_id  = state.get("_report_item_id", "")

    order = db.get_order(order_id) if order_id else None

    # Use stored email; fall back through item / order header
    email = state.get("_report_email", "")
    if not email and order_id:
        email = (order or {}).get("email", "")
        if not email:
            for it in db.get_order_items(order_id):
                email = it.get("original_account") or it.get("email") or ""
                if email:
                    break

    # ── Backend warranty gate — blocks even if UI was bypassed ───────────────
    settings = db.get_settings()
    found_item = None
    if item_id and order_id:
        for it in db.get_order_items(order_id):
            if it.get("itemId") == item_id:
                found_item = it
                break
    if found_item and order:
        wdata = db.calc_item_warranty(found_item, order, settings)
        if not wdata["canReport"]:
            msg = (
                "❌ <b>Đơn hàng đã hết thời hạn bảo hành.</b>\n\n"
                "Không thể tạo yêu cầu hỗ trợ cho đơn này."
            ) if vi else (
                "❌ <b>This order's warranty has expired.</b>\n\n"
                "Cannot create a support request for this order."
            )
            for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
                db.clear_user_state(user.id, key)
            db.add_log("WARRANTY_BLOCKED_EXPIRED", f"@{user.username} ({user.id}) | Order: {order_id}", "")
            await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
            return

    req_id = db.add_warranty_request(user.id, user.username, user.first_name, order_id, email, description, L)
    db.add_log("WARRANTY_REQUEST", f"@{user.username} ({user.id}) | Order: {order_id}", "")
    for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
        db.clear_user_state(user.id, key)

    await update.message.reply_text(
        t(L, "report_sent"),
        parse_mode=ParseMode.HTML,
        reply_markup=main_keyboard(user.id),
    )

    # Notify admins in background (non-blocking)
    req = db.get_warranty_request(req_id)
    if req:
        Thread(target=_notify_admins_warranty, args=(req, order), daemon=True).start()

# ─── Inline callbacks ─────────────────────────────────────────────────────────

async def callback_order(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L = lang(user.id)
    data = query.data  # "order:report:<id>" or "order:back"

    if data == "order:back":
        for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
            db.clear_user_state(user.id, key)
        await query.message.reply_text(
            t(L, "welcome", name=user.first_name or "User"),
            parse_mode=ParseMode.HTML,
            reply_markup=main_keyboard(user.id),
        )
        return

    if data.startswith("order:report:"):
        order_id = data[len("order:report:"):]
        db.set_user_state(user.id, "conv_state", "report_issue")
        db.set_user_state(user.id, "_report_order_id", order_id)
        await query.message.reply_text(
            t(L, "report_ask"),
            parse_mode=ParseMode.HTML,
            reply_markup=back_keyboard(user.id),
        )
        return

    if data.startswith("order:report_all:"):
        order_id = data[len("order:report_all:"):]
        all_items = db.get_order_items(order_id)
        order = db.get_order(order_id)
        if not all_items and order and order.get("email"):
            all_items = [{"email": order["email"]}]
        if not all_items:
            await query.answer(
                "Không tìm thấy tài khoản." if L == "vi" else "No accounts found.",
                show_alert=True,
            )
            return
        # Filter: only items still under warranty
        settings = db.get_settings()
        product_name = order.get("productName", "") if order else ""
        found = []
        for it in all_items:
            wdata = db.calc_item_warranty(it, order or {}, settings)
            if wdata["canReport"]:
                email = it.get("original_account") or it.get("email") or ""
                found.append({"email": email, "orderId": order_id, "productName": product_name})
        if not found:
            vi = L == "vi"
            await query.answer(
                "Không còn tài khoản nào trong đơn đủ điều kiện bảo hành." if vi
                else "No accounts in this order are eligible for warranty.",
                show_alert=True,
            )
            return
        db.set_user_state(user.id, "_mw_found", _json.dumps(found, ensure_ascii=False))
        db.set_user_state(user.id, "_mw_sel", ",".join(str(i) for i in range(len(found))))
        db.set_user_state(user.id, "conv_state", "support_multi_desc")
        await query.message.reply_text(
            t(L, "support_multi_desc_ask"),
            parse_mode=ParseMode.HTML,
            reply_markup=back_keyboard(user.id),
        )
        return

    if data.startswith("order:pick_items:"):
        order_id = data[len("order:pick_items:"):]
        all_items = db.get_order_items(order_id)
        order = db.get_order(order_id)
        if not all_items and order and order.get("email"):
            all_items = [{"email": order["email"]}]
        if not all_items:
            await query.answer(
                "Không tìm thấy tài khoản." if L == "vi" else "No accounts found.",
                show_alert=True,
            )
            return
        # Filter: only items still under warranty
        settings = db.get_settings()
        product_name = order.get("productName", "") if order else ""
        found = []
        for it in all_items:
            wdata = db.calc_item_warranty(it, order or {}, settings)
            if wdata["canReport"]:
                email = it.get("original_account") or it.get("email") or ""
                found.append({"email": email, "orderId": order_id, "productName": product_name})
        if not found:
            vi = L == "vi"
            await query.answer(
                "Không còn tài khoản nào trong đơn đủ điều kiện bảo hành." if vi
                else "No accounts in this order are eligible for warranty.",
                show_alert=True,
            )
            return
        db.set_user_state(user.id, "_mw_found", _json.dumps(found, ensure_ascii=False))
        db.set_user_state(user.id, "_mw_sel", "")
        try:
            await query.edit_message_text(
                _mw_select_text(L, found, set()),
                parse_mode=ParseMode.HTML,
                reply_markup=_mw_select_kb(L, found, set()),
            )
        except Exception:
            await query.message.reply_text(
                _mw_select_text(L, found, set()),
                parse_mode=ParseMode.HTML,
                reply_markup=_mw_select_kb(L, found, set()),
            )
        return

# ─── 🛍 Kênh Bán Hàng ────────────────────────────────────────────────────────

async def handle_shop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    await update.message.reply_text(
        f"🛍 {settings['shop_username']}",
        reply_markup=shop_inline(L, settings),
    )

# ─── 📋 Giới Thiệu ───────────────────────────────────────────────────────────

async def handle_intro(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()

    if not settings.get("intro_enabled", True):
        await update.message.reply_text(t(L, "feature_disabled"))
        return

    intro = db.get_intro()
    title   = intro.get("title", "")
    content = intro.get("content", "")
    photo   = intro.get("photoUrl", "")
    video   = intro.get("videoUrl", "")
    buttons = intro.get("buttons", [])

    # Build inline keyboard from buttons list
    markup = None
    if buttons:
        rows = [[InlineKeyboardButton(b.get("text", ""), url=b.get("url", "#"))] for b in buttons if b.get("text") and b.get("url")]
        if rows:
            markup = InlineKeyboardMarkup(rows)

    msg_text = f"<b>{title}</b>\n\n{content}" if title else content

    if photo:
        try:
            await update.message.reply_photo(photo=photo, caption=msg_text, parse_mode=ParseMode.HTML, reply_markup=markup)
            return
        except Exception:
            pass
    if video:
        try:
            await update.message.reply_video(video=video, caption=msg_text, parse_mode=ParseMode.HTML, reply_markup=markup)
            return
        except Exception:
            pass

    await update.message.reply_text(msg_text, parse_mode=ParseMode.HTML, reply_markup=markup or main_keyboard(user.id))

# ─── Menu router ─────────────────────────────────────────────────────────────

# All button keys used in menus — used to auto-detect language from button press
_MENU_KEYS = ["btn_home", "btn_support", "btn_gift", "btn_check_order", "btn_shop", "btn_intro"]

def detect_lang_from_text(text: str) -> str | None:
    """Return 'vi' or 'en' if text matches a known menu button, else None."""
    for key in _MENU_KEYS:
        if text == t("en", key):
            return "en"
        if text == t("vi", key):
            return "vi"
    return None

async def menu_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    text = update.message.text.strip()

    # Auto-detect and save language from which button the user pressed
    detected = detect_lang_from_text(text)
    if detected:
        current = db.get_user_lang(user.id)
        if current != detected:
            db.set_user_lang(user.id, detected)

    L = lang(user.id)

    # Home button (always works even in maintenance)
    if text in (t("vi", "btn_home"), t("en", "btn_home")):
        await show_main_menu(update, context)
        return

    # Maintenance check (after home button)
    if await maintenance_reply(update, L):
        return

    # Main menu buttons
    if text in (t("vi", "btn_support"), t("en", "btn_support")):
        await handle_support(update, context)
    elif text in (t("vi", "btn_gift"), t("en", "btn_gift")):
        await handle_gift(update, context)
    elif text in (t("vi", "btn_check_order"), t("en", "btn_check_order")):
        await handle_check_order(update, context)
    elif text in (t("vi", "btn_shop"), t("en", "btn_shop")):
        await handle_shop(update, context)
    elif text in (t("vi", "btn_intro"), t("en", "btn_intro")):
        await handle_intro(update, context)
    else:
        # Check conversation state
        state = db.get_user_state(user.id).get("conv_state")
        if state in ("support_lookup", "check_lookup"):
            await handle_order_lookup(update, context)
        elif state == "support_multi_input":
            await handle_multi_account_input(update, context)
        elif state == "support_multi_desc":
            await handle_multi_warranty_desc(update, context)
        elif state == "report_issue":
            await handle_report_issue_input(update, context)
        else:
            await update.message.reply_text(t(L, "unknown_cmd"), reply_markup=main_keyboard(user.id))

# ─── Admin warranty notification system ──────────────────────────────────────

ADMIN_PANEL_URL = os.environ.get("ADMIN_PANEL_URL", "http://103.180.138.203/admin-panel/#/warranty")

def _get_all_admin_ids(ns: dict | None = None) -> list:
    if ns is None:
        ns = db.get_notification_settings()
    ids: set = set()
    if ADMIN_ID:
        ids.add(ADMIN_ID)
    for aid in ns.get("adminIds", []):
        try:
            ids.add(int(str(aid).strip()))
        except Exception:
            pass
    return list(ids)

def _warranty_admin_markup(req_id: str) -> dict:
    url = f"{ADMIN_PANEL_URL}?id={req_id}" if req_id else ADMIN_PANEL_URL
    return {
        "inline_keyboard": [[
            {"text": "📋 Mở trang bảo hành", "url": url},
            {"text": "✅ Tiếp nhận xử lý", "callback_data": f"warranty_ack:{req_id}"},
        ]]
    }

def _warranty_acked_markup(req_id: str) -> InlineKeyboardMarkup:
    """Markup after admin acks — callback button replaced with a disabled-style label."""
    url = f"{ADMIN_PANEL_URL}?id={req_id}" if req_id else ADMIN_PANEL_URL
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("📋 Mở trang bảo hành", url=url),
        InlineKeyboardButton("✅ Đã tiếp nhận", callback_data="warranty_noop"),
    ]])

def _tg_send_markup(token: str, chat_id: int, text: str, markup: dict | None = None, max_retries: int = 3) -> bool:
    """Send message with optional inline keyboard; retries up to max_retries times."""
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if markup:
        payload["reply_markup"] = markup
    for attempt in range(max_retries):
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            data = _json.dumps(payload).encode()
            req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    return True
        except Exception as e:
            logger.warning(f"TG send markup attempt {attempt+1} failed for chat {chat_id}: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
    db.add_log("NOTIF_SEND_FAIL", f"chat_id={chat_id}", "bot")
    return False

def _build_group_notif_msg(req: dict, tag: str = "🔔", urgency: str = "") -> str:
    accounts = req.get("accounts", [])
    n = len(accounts)
    description = req.get("description", "")
    username = req.get("username", "")
    user_id = req.get("userId", "")
    submitted = req.get("submittedAt", "")
    try:
        ts = datetime.fromisoformat(submitted).strftime("%d/%m/%Y %H:%M")
    except Exception:
        ts = submitted
    lines = [f"{tag} <b>YÊU CẦU BẢO HÀNH MỚI{urgency} — {n} TÀI KHOẢN</b>\n"]
    lines.append(f"👤 Khách: @{username} (<code>{user_id}</code>)")
    lines.append(f"📦 Số tài khoản: <b>{n}</b>")
    lines.append(f"📝 Lỗi: <i>{description}</i>")
    lines.append("\nDanh sách tài khoản:")
    for i, acc in enumerate(accounts, 1):
        lines.append(f"  {i}. <code>{acc.get('email','')}</code> — {acc.get('productName','?')}")
    lines.append(f"\n🕐 Thời gian: {ts}")
    return "\n".join(lines)

def _build_warranty_notif_msg(req: dict, order: dict | None, tag: str = "🔔", urgency: str = "") -> str:
    if req.get("type") == "group":
        return _build_group_notif_msg(req, tag, urgency)
    order_id    = req.get("orderId", "N/A")
    email       = req.get("email", "N/A")
    description = req.get("description", "")
    username    = req.get("username", "")
    user_id     = req.get("userId", "")
    submitted   = req.get("submittedAt", "")
    try:
        ts = datetime.fromisoformat(submitted).strftime("%d/%m/%Y %H:%M")
    except Exception:
        ts = submitted

    product_name  = ""
    purchase_date = ""
    if order:
        product_name  = order.get("productName") or order.get("type") or ""
        pd            = order.get("purchasedAt", "")
        purchase_date = pd[:10] if pd else ""

    lines = [f"{tag} <b>YÊU CẦU BẢO HÀNH MỚI{urgency}</b>\n"]
    lines.append(f"📦 Mã đơn: <code>{order_id}</code>")
    lines.append(f"📧 Email: <code>{email}</code>")
    if product_name:
        lines.append(f"🛍 Sản phẩm: <b>{product_name}</b>")
    if purchase_date:
        lines.append(f"📅 Ngày mua: {purchase_date}")
    if username:
        lines.append(f"👤 Khách: @{username} ({user_id})")
    lines.append(f"\n📝 Nội dung lỗi:\n<i>{description}</i>")
    lines.append(f"\n🕐 Thời gian: {ts}")
    return "\n".join(lines)

def _notify_admins_warranty(req: dict, order: dict | None = None) -> None:
    """Background thread: notify all admins of a new warranty request (idempotent)."""
    try:
        req_id = req.get("id", "")
        # Idempotency guard: reload from DB and check adminNotifiedAt
        fresh = db.get_warranty_request(req_id)
        if fresh and fresh.get("adminNotifiedAt"):
            logger.info(f"WARRANTY NOTIFY: {req_id} already notified, skipping")
            return

        ns = db.get_notification_settings()
        if not ns.get("enabled"):
            return
        admin_ids = _get_all_admin_ids(ns)
        if not admin_ids:
            logger.warning("WARRANTY NOTIFY: no admin IDs configured")
            return

        msg    = _build_warranty_notif_msg(req, order)
        markup = _warranty_admin_markup(req_id)
        for aid in admin_ids:
            _tg_send_markup(TOKEN, aid, msg, markup)

        # Persist notification state and schedule first reminder
        now_dt = datetime.now()
        r1_min = int(ns.get("reminder1Minutes", 5))
        next_reminder = (now_dt + timedelta(minutes=r1_min)).isoformat()
        db.update_warranty_request(req_id, {
            "adminNotifiedAt": now_dt.isoformat(),
            "reminderEnabled": True,
            "reminderCount": 0,
            "nextReminderAt": next_reminder,
            "reminderProcessing": False,
        })
        db.add_notification_log(req_id, "new_warranty", 0, now_dt.isoformat())
        logger.info(f"Warranty notification sent for {req_id}, next reminder at {next_reminder}")
    except Exception as e:
        logger.error(f"_notify_admins_warranty error: {e}")
        db.add_log("WARRANTY_NOTIFY_ERROR", str(e), "bot")

def warranty_reminder_worker() -> None:
    """Background thread: sends reminders using persistent nextReminderAt — safe across restarts."""
    while True:
        time.sleep(60)
        try:
            ns = db.get_notification_settings()
            if not ns.get("enabled") or not ns.get("reminderEnabled"):
                continue
            admin_ids = _get_all_admin_ids(ns)
            if not admin_ids:
                continue

            r2_delta  = int(ns.get("reminder2Minutes", 15)) - int(ns.get("reminder1Minutes", 5))
            urg_delta = int(ns.get("urgentMinutes", 30))    - int(ns.get("reminder2Minutes", 15))
            now_dt    = datetime.now()

            _REMINDER_STAGES = [
                ("⏰", " — NHẮC LẦN 1", "WARRANTY_REMINDER1", r2_delta),
                ("⚠️", " — NHẮC LẦN 2", "WARRANTY_REMINDER2", urg_delta),
                ("🚨", " — KHẨN CẤP!",  "WARRANTY_URGENT",    None),  # last — disable after
            ]

            for req in db.get_warranty_requests():
                # Only remind open tickets with reminder enabled and due time reached
                if req.get("status") not in ("pending", "processing"):
                    continue
                if not req.get("reminderEnabled"):
                    continue
                if req.get("reminderProcessing"):
                    continue  # another process is handling this ticket
                next_at_str = req.get("nextReminderAt")
                if not next_at_str:
                    continue
                try:
                    next_at = datetime.fromisoformat(next_at_str)
                except Exception:
                    continue
                if now_dt < next_at:
                    continue

                req_id        = req.get("id", "")
                reminder_count = int(req.get("reminderCount", 0))
                if reminder_count >= len(_REMINDER_STAGES):
                    # All reminders exhausted — disable
                    db.update_warranty_request(req_id, {"reminderEnabled": False, "nextReminderAt": None})
                    continue

                # Acquire processing lock to prevent duplicates
                if not db.update_warranty_request(req_id, {"reminderProcessing": True}):
                    continue

                try:
                    order = db.get_order(req.get("orderId", ""))
                    tag, suffix, log_action, next_delta = _REMINDER_STAGES[reminder_count]

                    msg = _build_warranty_notif_msg(req, order, tag, suffix)
                    for aid in admin_ids:
                        _tg_send_markup(TOKEN, aid, msg, _warranty_admin_markup(req_id))

                    new_count = reminder_count + 1
                    update = {
                        "reminderCount": new_count,
                        "lastReminderAt": now_dt.isoformat(),
                        "reminderProcessing": False,
                    }
                    if next_delta is not None:
                        update["nextReminderAt"] = (now_dt + timedelta(minutes=next_delta)).isoformat()
                    else:
                        update["reminderEnabled"] = False
                        update["nextReminderAt"]   = None

                    db.update_warranty_request(req_id, update)
                    db.add_notification_log(req_id, "reminder", new_count, now_dt.isoformat())
                    db.add_log(log_action, req_id, "bot")
                    logger.info(f"Reminder #{new_count} sent for warranty {req_id}")

                except Exception as send_err:
                    logger.error(f"warranty_reminder_worker send error for {req_id}: {send_err}")
                    db.update_warranty_request(req_id, {"reminderProcessing": False})

        except Exception as e:
            logger.error(f"warranty_reminder_worker error: {e}")

async def callback_warranty_ack(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin taps '✅ Tiếp nhận xử lý' button in notification message."""
    query = update.callback_query
    user  = update.effective_user

    # Validate admin
    ns        = db.get_notification_settings()
    admin_ids = _get_all_admin_ids(ns)
    if user.id not in admin_ids:
        await query.answer("⛔ Bạn không có quyền thực hiện thao tác này.", show_alert=True)
        return

    req_id = query.data.split(":", 1)[1] if ":" in query.data else ""
    req    = db.get_warranty_request(req_id)
    if not req:
        await query.answer("❌ Không tìm thấy yêu cầu bảo hành này.", show_alert=True)
        return
    if req.get("acknowledgedAt"):
        await query.answer("ℹ️ Yêu cầu này đã được tiếp nhận rồi.", show_alert=True)
        return

    # Mark as processing and disable reminders (admin is now aware)
    now_dt = datetime.now()
    db.update_warranty_request(req_id, {
        "status": "processing",
        "acknowledgedAt": now_dt.isoformat(),
        "acknowledgedBy": str(user.id),
        "reminderEnabled": False,
        "nextReminderAt": None,
        "reminderProcessing": False,
    })
    db.add_log("WARRANTY_ACK", f"{req_id} by @{user.username or user.id}", "bot")

    # Send confirmation to customer
    if req.get("type") == "group":
        n = len(req.get("accounts", []))
        cust_msg = (
            f"✅ <b>YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN</b>\n\n"
            f"Shop đã tiếp nhận yêu cầu hỗ trợ gồm <b>{n}</b> tài khoản và đang tiến hành kiểm tra. "
            f"Kết quả xử lý sẽ được bot thông báo ngay khi hoàn tất. "
            f"Vui lòng chờ và không gửi lại yêu cầu trùng lặp."
        )
    else:
        order_id = req.get("orderId", "N/A")
        cust_msg = (
            f"✅ <b>YÊU CẦU ĐÃ ĐƯỢC TIẾP NHẬN</b>\n\n"
            f"Mã đơn: <code>{order_id}</code>\n\n"
            f"Shop đã nhận được yêu cầu bảo hành của bạn và đang tiến hành kiểm tra. "
            f"Kết quả xử lý sẽ được bot thông báo ngay khi hoàn tất. "
            f"Vui lòng chờ và không gửi lại yêu cầu trùng lặp."
        )
    try:
        sent_ok = _tg_send(TOKEN, int(req["userId"]), cust_msg)
    except Exception as e:
        logger.warning(f"WARRANTY_ACK: send to customer failed: {e}")
        sent_ok = False

    db.update_warranty_request(req_id, {
        "ackNotifSentStatus": "sent" if sent_ok else "failed",
        "ackNotifSentAt":     now_dt.isoformat() if sent_ok else None,
        "ackNotifError":      None if sent_ok else "Gửi Telegram cho khách thất bại",
    })

    # Edit admin message: replace callback button with "✅ Đã tiếp nhận" (non-clickable)
    admin_name = f"@{user.username}" if user.username else user.first_name
    acked_markup = _warranty_acked_markup(req_id)
    try:
        original = query.message.text or ""
        await query.edit_message_text(
            original + f"\n\n✅ <b>Đã tiếp nhận bởi {admin_name}</b>",
            parse_mode=ParseMode.HTML,
            reply_markup=acked_markup,
        )
    except Exception:
        pass

    if sent_ok:
        await query.answer("✅ Đã tiếp nhận! Khách hàng đã được thông báo.", show_alert=True)
    else:
        await query.answer("✅ Đã tiếp nhận! Nhưng gửi thông báo cho khách thất bại — vào web để gửi lại.", show_alert=True)


async def callback_warranty_noop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """No-op handler for disabled inline buttons (e.g. '✅ Đã tiếp nhận')."""
    await update.callback_query.answer()

# ─── Broadcast worker ─────────────────────────────────────────────────────────

def _tg_send(token: str, chat_id: int, text: str) -> bool:
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False

def broadcast_worker():
    while True:
        time.sleep(30)
        try:
            pending = db.get_pending_broadcasts()
            if not pending:
                continue
            db.clear_pending_broadcasts()
            users = db.get_all_users()

            for item in pending:
                message = item.get("message", "")
                target  = item.get("target", "all")
                if not message:
                    continue

                # Direct to specific user (e.g. warranty resolution)
                if target.startswith("user:"):
                    uid_str = target[5:]
                    try:
                        _tg_send(TOKEN, int(uid_str), message)
                    except Exception:
                        pass
                    continue

                sent = 0
                for uid_str, udata in users.items():
                    if target == "has_received" and not udata.get("has_received_gift"):
                        continue
                    if target == "no_received" and udata.get("has_received_gift"):
                        continue
                    ul = udata.get("lang") or "vi"
                    full_msg = t(ul, "admin_broadcast_msg", msg=message)
                    if _tg_send(TOKEN, int(uid_str), full_msg):
                        sent += 1
                db.add_log("BROADCAST", f"target={target} | sent={sent} | {message[:40]}", "web-admin")
                logger.info(f"Broadcast sent to {sent} users (target={target})")
        except Exception as e:
            logger.error(f"Broadcast worker error: {e}")

# ─── Flask keep-alive ─────────────────────────────────────────────────────────

flask_app = Flask(__name__)

@flask_app.route("/")
def home():
    return "Bot Quà Tặng AI is running ✅"

@flask_app.route("/health")
def health():
    return jsonify({"status": "ok", "stock": db.stock_count()})

def run_flask():
    flask_app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set. Exiting.")
        return

    Thread(target=run_flask, daemon=True).start()
    logger.info("Flask keep-alive started on port 5000.")

    Thread(target=broadcast_worker, daemon=True).start()
    logger.info("Broadcast worker started.")

    # Startup: clear stale locks from crashed mid-send, migrate old ticket fields
    locked = db.reset_stale_reminder_locks()
    migrated = db.migrate_warranty_reminder_fields()
    migrated_items = db.migrate_to_order_items()
    if locked:
        logger.info(f"Cleared {locked} stale reminderProcessing lock(s) on startup")
    if migrated:
        logger.info(f"Migrated {migrated} old warranty ticket(s) to new reminder schema (reminderEnabled=False)")
    if migrated_items:
        logger.info(f"Migrated {migrated_items} order(s) to order_items schema")
    enriched_items = db.migrate_order_items_to_chain()
    if enriched_items:
        logger.info(f"Enriched {enriched_items} order_item(s) with replacement-chain fields")

    Thread(target=warranty_reminder_worker, daemon=True).start()
    logger.info("Warranty reminder worker started.")

    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("myid", cmd_myid))
    app.add_handler(CallbackQueryHandler(callback_lang,          pattern=r"^lang:"))
    app.add_handler(CallbackQueryHandler(callback_order,         pattern=r"^order:"))
    app.add_handler(CallbackQueryHandler(callback_warranty_ack,  pattern=r"^warranty_ack:"))
    app.add_handler(CallbackQueryHandler(callback_warranty_noop, pattern=r"^warranty_noop$"))
    app.add_handler(CallbackQueryHandler(callback_multi_warranty,  pattern=r"^mw:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    logger.info("Bot is polling...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
