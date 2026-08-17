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
import random
import string
from datetime import datetime, timedelta, date, timezone

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)

def _parse_dt(s: str) -> datetime:
    """Parse ISO string → timezone-aware. Assumes UTC if no tz suffix."""
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
from threading import Thread

from flask import Flask, jsonify
from telegram import (
    Update, ReplyKeyboardMarkup, ReplyKeyboardRemove, InlineKeyboardMarkup, InlineKeyboardButton,
    BotCommand, BotCommandScopeAllPrivateChats,
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ChatMemberHandler, TypeHandler,
    ContextTypes, filters, ApplicationHandlerStop,
)
from telegram.constants import ParseMode

import data_manager as db
from translations import t
import rate_limiter as rl

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
        [t(L, "btn_chat_support"), t(L, "btn_intro")],
    ], resize_keyboard=True)

def back_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup([[t(L, "btn_home")]], resize_keyboard=True)

def support_menu_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup([
        [t(L, "btn_yeu_cau_giao")],
        [t(L, "btn_bao_loi")],
        [t(L, "btn_home")],
    ], resize_keyboard=True)

def lang_inline() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("🇻🇳 Tiếng Việt", callback_data="lang:vi"),
        InlineKeyboardButton("🇬🇧 English",    callback_data="lang:en"),
    ]])

def shop_inline(L: str, settings: dict) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(t(L, "btn_open_shop"), url=settings.get("shop_link", ""))
    ]])

def _load_active_channels_from(filename: str) -> list:
    """Generic: load enabled channels from a data/*.json file, sorted by order."""
    try:
        path = os.path.join(os.path.dirname(__file__), "data", filename)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                channels = _json.load(f)
            active = [ch for ch in channels if ch.get("enabled", True)]
            active.sort(key=lambda x: x.get("order", 999))
            return active
    except Exception:
        pass
    return []

def get_active_shop_channels() -> list:
    """Load enabled shop channels (button menu), sorted by order."""
    return _load_active_channels_from("shop_channels.json")

def get_active_gift_shop_channels() -> list:
    """Load enabled gift-delivery shop channels, sorted by order."""
    return _load_active_channels_from("gift_shop_channels.json")

def shop_channels_inline(L: str, channels: list) -> InlineKeyboardMarkup:
    """Inline keyboard with one button per active shop channel + back button."""
    rows = []
    for ch in channels:
        icon = ch.get("icon", "🛒")
        name = ch.get("name", "Shop")
        link = ch.get("link", "")
        if link:
            rows.append([InlineKeyboardButton(f"{icon} {name}", url=link)])
    rows.append([InlineKeyboardButton("⬅️ Quay lại", callback_data="back_main")])
    return InlineKeyboardMarkup(rows)

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
            # BHF inference: khi warrantyDays = 0, suy ra từ tên SP
            if not _wd:
                _pn2 = (order.get("productName") or "").upper()
                if re.search(r'\bBHF\b', _pn2):
                    _wd = db._infer_bhf_days(order.get("productName") or "")
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
        elif w_status == "no_warranty":
            # KBH — không bảo hành, chỉ hiển thị giá và trạng thái hoạt động
            lines.append(f"🚫 {'Trạng thái BH' if vi else 'Warranty status'}: <b>{'Không Bảo Hành (KBH)' if vi else 'No Warranty (KBH)'}</b>")
            lines.append(f"💰 {'Giá mua' if vi else 'Price'}: {price_str}")
            _item_ref = item.get("item_status") == "refunded" if item else False
            _ord_ref  = order.get("status") == "refunded"
            if _item_ref or _ord_ref:
                lines.append(f"📊 {'Trạng thái' if vi else 'Status'}: {'Đã hoàn tiền' if vi else 'Refunded'}")
            else:
                lines.append(f"📊 {'Trạng thái' if vi else 'Status'}: {'Đang hoạt động' if vi else 'Active'}")
        else:
            warranty_icon = "✅" if can_report else "❌"
            warranty_label = t(L, "warranty_valid") if can_report else t(L, "warranty_expired")
            lines.append(f"⌛ {'Còn lại' if vi else 'Remaining'}: {remaining_str}")
            lines.append(f"🛡 {'Bảo hành đến' if vi else 'Warranty until'}: {warranty_end}")
            lines.append(f"{warranty_icon} {'Trạng thái BH' if vi else 'Warranty status'}: {warranty_label}")
            lines.append(f"💰 {'Giá mua' if vi else 'Price'}: {price_str}")
            if can_report and refund_str:
                lines.append(f"💵 {'Hoàn dự kiến' if vi else 'Est. Refund'}: {refund_str}")
            item_refunded  = item.get("item_status") == "refunded" if item else False
            order_refunded = order.get("status") == "refunded"
            is_refunded    = item_refunded or order_refunded
            if is_refunded:
                status_label = "Đã hoàn tiền" if vi else "Refunded"
            else:
                status_label = (
                    ("Đang hoạt động" if vi else "Active") if can_report
                    else ("Hết bảo hành" if vi else "Warranty expired")
                )
            lines.append(f"📊 {'Trạng thái' if vi else 'Status'}: {status_label}")

            # Refund detail block
            if is_refunded:
                item_email = (item.get("original_account") or item.get("email") or "") if item else ""
                ref = (
                    db.get_refund_record_by_account(order.get("orderId", ""), item_email)
                    if item_refunded and not order_refunded
                    else db.get_refund_record(order.get("orderId", ""))
                )
                lines.append("")
                lines.append("━" * 28)
                lines.append(f"💰 <b>{'ĐÃ HOÀN TIỀN' if vi else 'REFUNDED'}</b>")
                if ref:
                    amt = ref.get("amount", 0)
                    lines.append(f"💵 {'Số tiền đã hoàn' if vi else 'Refund amount'}: <b>{_fmt_price(int(amt), L)}</b>")
                    lines.append(f"🕒 {'Thời gian hoàn' if vi else 'Refunded on'}: {(ref.get('refundedAt') or '')[:10]}")
                    if ref.get("note"):
                        lines.append(f"📝 {'Ghi chú' if vi else 'Note'}: {ref['note']}")
                lines.append(f"⚠️ <i>{'Đơn này đã được hoàn tiền và không thể gửi thêm yêu cầu bảo hành.' if vi else 'This order has been refunded. No further warranty requests allowed.'}</i>")

        # Replacement chain section (spec §5 / §12)
        if replacement_count > 0:
            lines.append("")
            lines.append(f"{'━'*30}")
            lines.append(f"🔁 <b>{'LỊCH SỬ BẢO HÀNH' if vi else 'WARRANTY HISTORY'}</b>")
            # Original account + original delivery date
            orig_date = (purchase_date or "")[:10] or "N/A"
            lines.append(f"📧 {'TK gốc' if vi else 'Original account'}: <code>{original_account}</code>")
            lines.append(f"   📅 {'Nhận lúc' if vi else 'Received'}: {orig_date}")
            # Replacement account(s) with dates from account_replacements
            item_id = item.get("itemId", "")
            rep_date = ""
            if item_id:
                _reps = db.load("account_replacements", {})
                _item_reps = _reps.get(item_id, [])
                if _item_reps:
                    last = _item_reps[-1]
                    rep_date = (last.get("deliveredAt") or last.get("createdAt") or "")[:10]
            rep_date_str = rep_date or "N/A"
            lines.append(f"🔄 {'TK bảo hành' if vi else 'Replacement account'}: <code>{current_account}</code>")
            lines.append(f"   📅 {'Thay lúc' if vi else 'Replaced on'}: {rep_date_str}")
            lines.append(f"🔢 {'Số lần BH' if vi else 'Times replaced'}: {replacement_count}")
            lines.append(f"⚠️ <i>{'Bảo hành & hoàn tiền tính từ ngày nhận TK gốc.' if vi else 'Warranty & refund calculated from original account date.'}</i>")

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
    is_kbh_leg = data.get("_is_kbh", False)
    warranty_icon = ""
    if is_kbh_leg:
        warranty_icon = "🚫 "
    elif warranty_ok is True:
        warranty_icon = "✅ "
    elif warranty_ok is False:
        warranty_icon = "❌ "
    warranty_display = ("Không Bảo Hành (KBH)" if vi else "No Warranty (KBH)") if is_kbh_leg else warranty_str
    lines_leg = [f"<b>📦 {'THÔNG TIN ĐƠN HÀNG' if vi else 'ORDER INFORMATION'}</b>\n"]
    lines_leg.append(f"🏷 {'Mã đơn' if vi else 'Order'}: <code>{order.get('orderId','')}</code>")
    lines_leg.append(f"📧 {'Email' if vi else 'Email'}: <code>{order.get('email','')}</code>")
    lines_leg.append(f"📦 {'Sản phẩm' if vi else 'Product'}: <b>{order.get('productName','')}</b>")
    lines_leg.append(f"📅 {'Ngày mua' if vi else 'Purchase date'}: {(order.get('purchaseDate') or '')[:10] or 'N/A'}")
    lines_leg.append(f"📅 {'Ngày hết hạn' if vi else 'Expiry date'}: {resolved_expiry or 'N/A'}")
    if not is_kbh_leg:
        lines_leg.append(f"⌛ {'Còn lại' if vi else 'Remaining'}: {remaining_str}")
        lines_leg.append(f"🛡 {'Bảo hành đến' if vi else 'Warranty until'}: {(order.get('warrantyExpiry') or order.get('warrantyDate') or '')[:10] or 'N/A'}")
    lines_leg.append(f"{warranty_icon}{'Trạng thái BH' if vi else 'Warranty status'}: <b>{warranty_display}</b>")
    lines_leg.append(f"💰 {'Giá mua' if vi else 'Price'}: {price_str}")
    if not is_kbh_leg:
        lines_leg.append(f"💵 {'Hoàn dự kiến' if vi else 'Est. Refund'}: {refund_str}")
    lines_leg.append(f"📊 {'Trạng thái' if vi else 'Status'}: <b>{status_str}</b>")

    # Refund detail block (legacy path)
    if order.get("status") == "refunded":
        ref = db.get_refund_record(order.get("orderId", ""))
        lines_leg.append("")
        lines_leg.append("━" * 28)
        lines_leg.append(f"💰 <b>{'ĐÃ HOÀN TIỀN' if vi else 'REFUNDED'}</b>")
        if ref:
            amt = ref.get("amount", 0)
            lines_leg.append(f"💵 {'Số tiền đã hoàn' if vi else 'Refund amount'}: <b>{_fmt_price(int(amt), L)}</b>")
            lines_leg.append(f"🕒 {'Thời gian hoàn' if vi else 'Refunded on'}: {(ref.get('refundedAt') or '')[:10]}")
            if ref.get("note"):
                lines_leg.append(f"📝 {'Ghi chú' if vi else 'Note'}: {ref['note']}")
        lines_leg.append(f"⚠️ <i>{'Đơn này đã được hoàn tiền. Không thể gửi thêm yêu cầu.' if vi else 'This order has been refunded. No further requests allowed.'}</i>")

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

    # Refund detail block (multi-order)
    if order.get("status") == "refunded":
        ref = db.get_refund_record(order.get("orderId", ""))
        lines.append("")
        lines.append("━" * 28)
        lines.append(f"💰 <b>{'ĐÃ HOÀN TIỀN' if vi else 'REFUNDED'}</b>")
        if ref:
            amt = ref.get("amount", 0)
            lines.append(f"💵 {'Số tiền đã hoàn' if vi else 'Refund amount'}: <b>{_fmt_price(int(amt), L)}</b>")
            lines.append(f"🕒 {'Thời gian hoàn' if vi else 'Refunded on'}: {(ref.get('refundedAt') or '')[:10]}")
            if ref.get("note"):
                lines.append(f"📝 {'Ghi chú' if vi else 'Note'}: {ref['note']}")
        lines.append(f"⚠️ <i>{'Đơn này đã được hoàn tiền. Không thể gửi thêm yêu cầu.' if vi else 'This order has been refunded. No further requests allowed.'}</i>")

    lines.append(f"📦 {'Số lượng' if vi else 'Quantity'}: <b>{len(items)}</b>")
    lines.append(f"\n<b>{'DANH SÁCH TÀI KHOẢN' if vi else 'ACCOUNT LIST'}</b>")

    n_eligible = 0
    for i, item in enumerate(items, 1):
        display_acc = item.get("original_account") or item.get("email") or ""
        rep_count   = item.get("current_replacement_number") or 0
        wdata = db.calc_item_warranty(item, order, settings)
        can   = wdata["canReport"]
        w_st  = wdata["warrantyStatus"]

        if w_st == "refunded" or item.get("item_status") == "refunded":
            label = "Đã hoàn tiền" if vi else "Refunded"
            icon  = "💰"
        elif w_st == "no_warranty":
            label = "KBH - Không BH" if vi else "No Warranty (KBH)"
            icon  = "🚫"
        elif w_st == "expired":
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
    vi = L == "vi"
    welcome = t(L, "welcome_admin", name=user.first_name or "Admin") if is_admin(user.id) else t(L, "welcome", name=user.first_name or "User")

    # ── Cổng kênh cộng đồng khi /start (bỏ qua admin) ────────────────────
    settings = db.get_settings()
    if not is_admin(user.id) and settings.get("require_start_channel_check", False):
        channels = db.get_required_channels()
        enabled_channels = [c for c in channels if c.get("enabled", True)]
        if enabled_channels:
            not_joined, no_chat_id, api_errors = await _check_channels_membership(
                context.bot, user.id, enabled_channels
            )
            logger.info(
                f"[start] community_gate telegram_user_id={user.id} "
                f"not_joined={len(not_joined)} no_chat_id={len(no_chat_id)} api_errors={len(api_errors)}"
            )
            # Chỉ hiện "Đã chọn ngôn ngữ" — không hiện welcome text
            await query.edit_message_text(t(L, "lang_chosen"), parse_mode=ParseMode.HTML)
            # Lưu message_id để xoá sau khi xác minh
            context.user_data["start_gate_lang_msg_id"] = query.message.message_id
            if no_chat_id or api_errors:
                await context.bot.send_message(
                    user.id,
                    "⚠️ Bot chưa được cấu hình đúng để xác minh kênh. Vui lòng liên hệ admin." if vi
                    else "⚠️ Bot is not configured correctly to verify channels. Please contact admin.",
                    parse_mode=ParseMode.HTML,
                )
                return
            if not_joined:
                join_msg = (
                    "🔐 <b>Để dùng bot, hãy tham gia kênh bên dưới:</b>"
                ) if vi else (
                    "🔐 <b>Please join the channel below to use this bot:</b>"
                )
                sent = await context.bot.send_message(
                    user.id, join_msg, parse_mode=ParseMode.HTML,
                    reply_markup=_build_community_join_markup(L, not_joined),
                )
                context.user_data["start_gate_join_msg_id"] = sent.message_id
                return
            # Đã join hết ngay từ đầu — hiện menu (không có tin nhắn cũ cần xoá)
            await _show_welcome_and_menu(context.bot, user, L)
            return

    # Gate tắt hoặc admin — hiện đầy đủ
    await query.edit_message_text(f"{t(L, 'lang_chosen')}\n\n{welcome}", parse_mode=ParseMode.HTML)
    await context.bot.send_message(user.id, welcome, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))


async def _show_welcome_and_menu(bot, user, L: str) -> None:
    """Gửi welcome + main keyboard → rồi mới hiện kênh bán hàng (nếu có)."""
    vi = L == "vi"
    welcome = (
        t(L, "welcome_admin", name=user.first_name or "Admin")
        if is_admin(user.id)
        else t(L, "welcome", name=user.first_name or "User")
    )
    await bot.send_message(
        user.id, welcome, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id)
    )
    shop_channels = get_active_shop_channels()
    if shop_channels:
        await bot.send_message(
            user.id,
            "🛍️ <b>Kênh bán hàng chính thức:</b>" if vi else "🛍️ <b>Official shop channels:</b>",
            parse_mode=ParseMode.HTML,
            reply_markup=shop_channels_inline(L, shop_channels),
        )


def _build_community_join_markup(L: str, not_joined: list) -> InlineKeyboardMarkup:
    """Inline keyboard cho cổng kênh cộng đồng ở /start."""
    vi = L == "vi"
    buttons = []
    for ch in not_joined:
        name = ch.get("name") or "Kênh cộng đồng"
        url  = ch.get("url") or ch.get("username") or ""
        if url and not url.startswith("http"):
            url = f"https://t.me/{url.lstrip('@')}"
        if url:
            buttons.append([InlineKeyboardButton(
                f"📢 Tham gia {name}" if vi else f"📢 Join {name}", url=url
            )])
    buttons.append([InlineKeyboardButton(
        "✅ Tôi đã tham gia" if vi else "✅ I Joined",
        callback_data="check_community_join",
    )])
    return InlineKeyboardMarkup(buttons)


async def callback_check_community_join(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Xác minh lại kênh cộng đồng khi user bấm '✅ Tôi đã tham gia' từ cổng /start.
    Nếu đã join đủ: đóng prompt → hiện kênh bán hàng → gửi menu chính.
    """
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L    = lang(user.id)
    vi   = L == "vi"

    channels         = db.get_required_channels()
    enabled_channels = [c for c in channels if c.get("enabled", True)]

    not_joined, no_chat_id, api_errors = await _check_channels_membership(
        context.bot, user.id, enabled_channels
    )
    logger.info(
        f"[start] check_community_join telegram_user_id={user.id} "
        f"not_joined={len(not_joined)} no_chat_id={len(no_chat_id)} api_errors={len(api_errors)}"
    )

    if no_chat_id or api_errors:
        await query.edit_message_text(
            "⚠️ Bot chưa được cấu hình đúng. Vui lòng liên hệ admin." if vi
            else "⚠️ Bot is misconfigured. Please contact admin.",
            parse_mode=ParseMode.HTML,
        )
        return

    if not_joined:
        names = ", ".join(f"<b>{c.get('name') or c.get('username') or 'kênh'}</b>" for c in not_joined)
        msg = (
            f"❌ <b>Chưa xác minh được.</b>\n\n"
            f"📢 Chưa tham gia: {names}\n\n"
            "Vui lòng tham gia kênh rồi thử lại sau vài giây."
        ) if vi else (
            f"❌ <b>Could not verify membership.</b>\n\n"
            f"📢 Not joined: {names}\n\n"
            "Please join the channel and try again in a few seconds."
        )
        await query.edit_message_text(
            msg, parse_mode=ParseMode.HTML,
            reply_markup=_build_community_join_markup(L, not_joined),
        )
        return

    # ── Tất cả kênh đã xác minh ──────────────────────────────────────────
    logger.info(f"[start] community_gate_passed telegram_user_id={user.id}")

    # Xoá các tin nhắn gate cũ (tin "Đã chọn ngôn ngữ" + tin join prompt)
    chat_id = query.message.chat_id
    for key in ("start_gate_lang_msg_id", "start_gate_join_msg_id"):
        msg_id = context.user_data.pop(key, None)
        if msg_id:
            try:
                await context.bot.delete_message(chat_id=chat_id, message_id=msg_id)
            except Exception:
                pass
    # Xoá luôn chính message inline hiện tại (nếu chưa bị xoá ở trên)
    try:
        await context.bot.delete_message(chat_id=chat_id, message_id=query.message.message_id)
    except Exception:
        pass

    # Hiện welcome → kênh bán hàng
    await _show_welcome_and_menu(context.bot, user, L)

async def cmd_clean(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Xoá tất cả tin nhắn bot trong chat, sau đó hiện lại welcome."""
    user = update.effective_user
    msg  = update.message
    chat_id    = user.id
    current_id = msg.message_id

    # Xoá lệnh /clean trước
    try:
        await msg.delete()
    except Exception:
        pass

    # Thử xoá 400 tin nhắn gần nhất (chỉ tin bot mới xoá được, tin khác sẽ báo lỗi — bỏ qua)
    import asyncio as _aio

    BATCH = 30  # max 30 request cùng lúc để tránh rate-limit
    ids_to_try = list(range(current_id - 1, max(0, current_id - 401), -1))
    for i in range(0, len(ids_to_try), BATCH):
        batch = ids_to_try[i : i + BATCH]
        await _aio.gather(
            *[context.bot.delete_message(chat_id=chat_id, message_id=mid) for mid in batch],
            return_exceptions=True,
        )

    # Hiện lại welcome
    L = lang(user.id)
    await _show_welcome_and_menu(context.bot, user, L)


async def cmd_myid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(f"🆔 Your ID: <code>{update.effective_user.id}</code>", parse_mode=ParseMode.HTML)

async def cmd_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await handle_support_menu(update, context)

async def cmd_gift(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await handle_gift(update, context)

async def cmd_orders(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await handle_check_order(update, context)

async def cmd_unknown(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Catch-all for unrecognised slash commands — show the command list."""
    user = update.effective_user
    L = lang(user.id)
    vi = L == "vi"
    if vi:
        msg = (
            "❓ <b>Lệnh không hợp lệ.</b>\n\n"
            "📋 Các lệnh có thể dùng:\n"
            "/start — Bắt đầu / chọn ngôn ngữ\n"
            "/support — Hỗ trợ & kiểm tra đơn hàng\n"
            "/gift — Nhận quà miễn phí\n"
            "/orders — Kiểm tra đơn hàng\n"
            "/myid — Xem ID Telegram của bạn\n\n"
            "Hoặc dùng menu bên dưới 👇"
        )
    else:
        msg = (
            "❓ <b>Unknown command.</b>\n\n"
            "📋 Available commands:\n"
            "/start — Start / choose language\n"
            "/support — Support & order lookup\n"
            "/gift — Claim free gift\n"
            "/orders — Check your order\n"
            "/myid — View your Telegram ID\n\n"
            "Or use the menu below 👇"
        )
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))

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

_JOINED_STATUSES = {"member", "administrator", "creator"}
MEMBERSHIP_CACHE_TTL_HOURS = db.MEMBERSHIP_CACHE_TTL_HOURS  # 6h default (gift gate)
GLOBAL_GATE_CACHE_TTL_HOURS = 1  # 1h cache cho global gate (phát hiện rời kênh nhanh hơn)

# Callbacks/commands được miễn global gate (không chặn user)
_GATE_EXEMPT_CALLBACKS = {"check_join", "check_community_join", "back_main", "warranty_noop"}
_GATE_EXEMPT_COMMANDS  = {"start", "myid", "clean"}

def _channel_cache_key(ch: dict) -> str:
    """Stable cache key for a channel — mirrors data_manager.channel_cache_key."""
    cid = (ch.get("chatId") or ch.get("username") or ch.get("id") or "").strip()
    return cid.lower() if cid else ""

async def _check_channels_membership(bot, user_id: int, channels: list) -> tuple[list, list, list]:
    """Call getChatMember for every channel in the list.

    Returns:
        (not_joined, no_chat_id, api_errors)
        - not_joined:  has chatId, getChatMember confirmed NOT a member → show join prompt
        - no_chat_id:  no chatId/username configured → cannot call getChatMember → block
        - api_errors:  has chatId but getChatMember threw (bot not admin, wrong chatId)

    Channels confirmed as members are saved to the membership cache automatically.
    """
    not_joined: list = []
    no_chat_id: list = []
    api_errors: list = []

    for ch in channels:
        chat_id = (ch.get("chatId") or ch.get("username") or "").strip()
        cache_key = _channel_cache_key(ch)

        if not chat_id:
            # No identifier → cannot call getChatMember → must block
            logger.info(f"[gift] required_channel_id=(none) channel='{ch.get('name')}' — no chatId, blocking")
            no_chat_id.append(ch)
            continue

        # Normalize: ensure @ prefix for plain usernames
        if not str(chat_id).startswith(("-", "@", "+")):
            chat_id = f"@{chat_id}"

        logger.info(f"[gift] required_channel_id={chat_id} getChatMember telegram_user_id={user_id}")
        try:
            member = await bot.get_chat_member(chat_id=chat_id, user_id=user_id)
            status = member.status
            logger.info(f"[gift] membership_status={status} channel={chat_id}")

            if status == "restricted":
                joined = getattr(member, "is_member", False)
            else:
                joined = status in _JOINED_STATUSES

            if joined:
                db.set_membership_verified(user_id, cache_key, status)
                logger.info(f"[gift] membership_verified_and_cached channel={chat_id} status={status}")
            else:
                db.set_membership_left(user_id, cache_key, status)
                not_joined.append(ch)

        except Exception as e:
            logger.warning(f"[gift] getChatMember error channel={chat_id}: {e}")
            api_errors.append(ch)

    return not_joined, no_chat_id, api_errors

def _build_join_markup(L: str, not_joined: list) -> InlineKeyboardMarkup:
    vi = L == "vi"
    buttons = []
    for ch in not_joined:
        name = ch.get("name") or "Kênh"
        url  = ch.get("url") or ch.get("username") or ""
        if url and not url.startswith("http"):
            url = f"https://t.me/{url.lstrip('@')}"
        if url:
            buttons.append([InlineKeyboardButton(
                f"📢 Tham gia {name}" if vi else f"📢 Join {name}", url=url
            )])
    buttons.append([InlineKeyboardButton(
        "✅ Tôi đã tham gia" if vi else "✅ I Joined", callback_data="check_join"
    )])
    buttons.append([InlineKeyboardButton(
        "⬅️ Quay lại" if vi else "⬅️ Back", callback_data="back_main"
    )])
    return InlineKeyboardMarkup(buttons)

async def _enforce_channel_gate(update: Update, context: ContextTypes.DEFAULT_TYPE, L: str) -> bool:
    """Kiểm tra user có đang ở trong các kênh bắt buộc không.
    Returns True nếu user bị chặn (caller nên return).
    Hoạt động với cả message và callback_query update.
    """
    user = update.effective_user
    settings = db.get_settings()
    if not settings.get("require_channel_check", False):
        return False

    channels = db.get_required_channels()
    enabled_channels = [c for c in channels if c.get("enabled", True)]
    if not enabled_channels:
        return False

    vi = L == "vi"

    # Kiểm tra cache (TTL ngắn 1h để phát hiện rời kênh nhanh)
    need_check = []
    for ch in enabled_channels:
        key = _channel_cache_key(ch)
        if key and db.is_membership_cache_valid(user.id, key, GLOBAL_GATE_CACHE_TTL_HOURS):
            pass  # Cache còn hạn → ok
        else:
            need_check.append(ch)

    if not need_check:
        return False  # Tất cả kênh đều hợp lệ trong cache

    # Gọi getChatMember live cho các kênh chưa cache
    not_joined, no_chat_id, api_errors = await _check_channels_membership(
        context.bot, user.id, need_check
    )

    # Lỗi cấu hình → không chặn để tránh lock-out toàn bộ user
    if no_chat_id or api_errors:
        logger.warning(
            f"[gate] config_error telegram_user_id={user.id} "
            f"no_chat_id={len(no_chat_id)} api_errors={len(api_errors)}"
        )
        return False

    if not not_joined:
        return False  # Tất cả đã xác minh OK

    # Gửi prompt tham gia kênh
    msg = (
        "🔐 <b>Bạn cần tham gia kênh để sử dụng bot.</b>\n\n"
        "Vui lòng tham gia kênh bên dưới, sau đó bấm ✅ để xác minh và tiếp tục."
    ) if vi else (
        "🔐 <b>You need to join the channel to use this bot.</b>\n\n"
        "Please join the channel below, then tap ✅ to verify and continue."
    )
    markup = _build_join_markup(L, not_joined)

    if update.callback_query:
        try:
            await update.callback_query.answer()
        except Exception:
            pass
        try:
            await update.callback_query.message.reply_text(
                msg, parse_mode=ParseMode.HTML, reply_markup=markup,
            )
        except Exception:
            await context.bot.send_message(
                user.id, msg, parse_mode=ParseMode.HTML, reply_markup=markup,
            )
    else:
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=markup)

    logger.info(
        f"[gate] user_blocked telegram_user_id={user.id} "
        f"missing_channels={len(not_joined)}"
    )
    return True


async def channel_gate_middleware(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Pre-handler chạy trước MỌI handler (group=-1).
    Chặn user đã rời kênh bắt buộc, raise ApplicationHandlerStop để dừng xử lý tiếp.
    Miễn trừ: admin, /start, /myid, callback tham gia kênh, chọn ngôn ngữ.
    """
    user = update.effective_user
    if not user or is_admin(user.id):
        return

    # Miễn trừ callback cụ thể (check_join, lang selector, v.v.)
    if update.callback_query:
        data = (update.callback_query.data or "")
        if data in _GATE_EXEMPT_CALLBACKS or data.startswith("lang:"):
            return

    # Miễn trừ /start và /myid
    if update.message and update.message.text:
        txt = update.message.text.strip()
        if txt.startswith("/"):
            cmd = txt.lstrip("/").split("@")[0].split()[0].lower()
            if cmd in _GATE_EXEMPT_COMMANDS:
                return

    L = lang(user.id)
    if await _enforce_channel_gate(update, context, L):
        raise ApplicationHandlerStop


async def handle_chat_member_update(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Nhận ChatMemberUpdated từ Telegram khi user thay đổi trạng thái trong kênh bắt buộc.
    Cập nhật cache ngay lập tức → user rời kênh sẽ bị gate chặn ở lần tương tác tiếp theo.
    Bot phải là admin của kênh để nhận update này.
    """
    cmu = update.chat_member
    if not cmu:
        return

    new_member = cmu.new_chat_member
    user = new_member.user
    new_status = new_member.status
    chat = cmu.chat

    channels = db.get_required_channels()
    chat_id_str = str(chat.id).lower()
    chat_username_lower = (f"@{chat.username}".lower()) if chat.username else ""

    for ch in channels:
        ch_id = (ch.get("chatId") or "").strip().lower()
        ch_user = (ch.get("username") or "").strip().lstrip("@").lower()
        ch_user_at = f"@{ch_user}" if ch_user else ""

        if ch_id and (ch_id == chat_id_str or ch_id == chat_username_lower or ch_user_at == chat_username_lower):
            key = _channel_cache_key(ch)
            if not key:
                break
            if new_status in ("left", "kicked", "banned", "restricted"):
                db.set_membership_left(user.id, key, new_status)
                logger.info(
                    f"[chat_member] user_left_required_channel "
                    f"user={user.id}(@{user.username}) channel={chat.id} status={new_status}"
                )
            elif new_status in _JOINED_STATUSES:
                db.set_membership_verified(user.id, key, new_status)
                logger.info(
                    f"[chat_member] user_joined_required_channel "
                    f"user={user.id}(@{user.username}) channel={chat.id} status={new_status}"
                )
            break


async def _claim_gift(user, context, L: str, settings: dict) -> None:
    """Core gift claim — sends via context.bot so it works from both message and callback."""
    round_id   = settings["round_id"]
    cooldown_h = settings["cooldown_hours"]
    claimed    = db.get_claimed(round_id)
    uid        = str(user.id)

    if uid in claimed:
        if cooldown_h == 0:
            await context.bot.send_message(user.id, t(L, "gift_already_round"))
            return
        claim_time  = _parse_dt(claimed[uid]["claim_time"])
        eligible_at = claim_time + timedelta(hours=cooldown_h)
        if _utcnow() < eligible_at:
            rem = eligible_at - _utcnow()
            h = int(rem.total_seconds() // 3600)
            m = int((rem.total_seconds() % 3600) // 60)
            await context.bot.send_message(user.id, t(L, "gift_already", h=h, m=m))
            return

    account = db.pop_account()
    if not account:
        await context.bot.send_message(user.id, t(L, "gift_empty"))
        return

    email        = account.get("email", "")
    password     = account.get("password", "")
    account_type = account.get("type", "")
    now_str      = datetime.now(timezone.utc).isoformat()

    db.add_claim(round_id, user.id, user.username, user.first_name, email, now_str)
    db.mark_account_distributed(email, user.id, user.username, user.first_name)
    db.add_log("CLAIM_GIFT", f"@{user.username} ({user.id})", "")

    # ── Build gift message ────────────────────────────────────────────────────
    vi = L == "vi"
    type_line = (f"Loại tài khoản: {account_type}\n" if vi else f"Account type: {account_type}\n") if account_type else ""

    if vi:
        msg = (
            "🎉 <b>Chúc mừng! Bạn đã nhận quà thành công.</b>\n\n"
            f"📧 <b>Tài khoản:</b>\n<code>{email}</code>\n\n"
            f"🔑 <b>Mật khẩu:</b>\n<code>{password}</code>\n\n"
            "📌 <b>Ghi chú:</b>\n"
            f"{type_line}"
            "• Đây là tài khoản quà tặng miễn phí.\n"
            "• Vui lòng đổi mật khẩu nếu tài khoản hỗ trợ đổi.\n"
            "• Shop không bảo hành tài khoản quà tặng.\n"
            "• Mỗi tài khoản chỉ được nhận một lần theo quy định của shop."
        )
    else:
        msg = (
            "🎉 <b>Congratulations! You have claimed your gift successfully.</b>\n\n"
            f"📧 <b>Account:</b>\n<code>{email}</code>\n\n"
            f"🔑 <b>Password:</b>\n<code>{password}</code>\n\n"
            "📌 <b>Note:</b>\n"
            f"{type_line}"
            "• This is a free gift account.\n"
            "• Please change the password if the account supports it.\n"
            "• The shop does not provide warranty for gift accounts.\n"
            "• Each account can only be claimed once per the shop's rules."
        )

    # ── Build gift shop channels keyboard ─────────────────────────────────────
    gift_channels = get_active_gift_shop_channels()
    if gift_channels:
        if vi:
            msg += "\n\n🛍️ <b>Nếu cần mua tài khoản Premium, vui lòng tham gia các kênh bán hàng bên dưới:</b>"
        else:
            msg += "\n\n🛍️ <b>For Premium accounts, please visit our sales channels below:</b>"

    rows = [
        [InlineKeyboardButton(f"{ch.get('icon','🛍️')} {ch.get('name','Shop')}", url=ch["link"])]
        for ch in gift_channels if ch.get("link")
    ]
    keyboard = InlineKeyboardMarkup(rows) if rows else None

    await context.bot.send_message(
        user.id,
        msg,
        parse_mode=ParseMode.HTML,
        reply_markup=keyboard,
    )

    # Lưu thông tin quà vào user_data để dùng khi nhường
    context.user_data["last_gift"] = {
        "email": email,
        "password": password,
        "claimed_at": now_str,
    }
    # Gửi nút nhường quà riêng (trong 24h)
    settings_current = db.get_settings()
    if settings_current.get("allow_gift_return", True):
        return_label = "↩️ Nhường lại quà (trong 24 giờ)" if vi else "↩️ Return Gift (within 24h)"
        await context.bot.send_message(
            user.id,
            "💡 <i>Không dùng tới? Bạn có thể nhường lại cho người khác trong vòng 24 giờ.</i>" if vi
            else "💡 <i>Don't need it? You can return this gift to the pool within 24 hours.</i>",
            parse_mode=ParseMode.HTML,
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton(return_label, callback_data="return_gift_init")
            ]]),
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

async def handle_gift(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L    = lang(user.id)
    vi   = L == "vi"
    settings = db.get_settings()

    logger.info(f"[gift] claim_gift_handler_started telegram_user_id={user.id}")

    if not settings.get("gift_enabled", True):
        await update.message.reply_text(t(L, "gift_disabled"))
        return
    if db.is_banned(user.id):
        await update.message.reply_text(t(L, "gift_banned"))
        return

    # ── Rate limit check ───────────────────────────────────────────────────
    rl_result = rl.check_and_record(user.id, "gift", user.username or "")
    if not rl_result.allowed:
        await update.message.reply_text(rl_result.message(L), parse_mode=ParseMode.HTML)
        return

    # ── Channel join-gate — TRƯỚC khi kiểm tra kho ────────────────────────
    if settings.get("require_channel_check", False):
        channels         = db.get_required_channels()
        enabled_channels = [c for c in channels if c.get("enabled", True)]
        logger.info(f"[gift] membership_check_started required_channels={len(enabled_channels)}")

        if enabled_channels:
            # Step 1: check cache per channel
            cached_ok  = []
            need_check = []
            for ch in enabled_channels:
                key = _channel_cache_key(ch)
                if key and db.is_membership_cache_valid(user.id, key, MEMBERSHIP_CACHE_TTL_HOURS):
                    cached_ok.append(ch)
                    logger.info(f"[gift] channel_cache_valid channel='{ch.get('name')}' key={key}")
                else:
                    need_check.append(ch)

            logger.info(
                f"[gift] cache_check telegram_user_id={user.id} "
                f"cached_ok={len(cached_ok)} need_fresh_check={len(need_check)}"
            )

            if need_check:
                # Step 2: call getChatMember for channels not in valid cache
                not_joined, no_chat_id, api_errors = await _check_channels_membership(
                    context.bot, user.id, need_check
                )
                logger.info(
                    f"[gift] fresh_check_result not_joined={len(not_joined)} "
                    f"no_chat_id={len(no_chat_id)} api_errors={len(api_errors)}"
                )

                if no_chat_id:
                    names = ", ".join(f"<b>{c.get('name', 'kênh')}</b>" for c in no_chat_id)
                    await update.message.reply_text(
                        f"⚠️ Kênh {names} chưa được cấu hình <b>Channel ID</b>.\n"
                        "Vui lòng liên hệ admin để thiết lập Channel ID trong trang cài đặt.",
                        parse_mode=ParseMode.HTML,
                    )
                    return

                if api_errors:
                    names = ", ".join(f"<b>{c.get('name', 'kênh')}</b>" for c in api_errors)
                    await update.message.reply_text(
                        f"⚠️ Không thể xác minh thành viên kênh {names}.\n"
                        "Vui lòng kiểm tra bot đã được thêm làm <b>quản trị viên</b> của kênh.",
                        parse_mode=ParseMode.HTML,
                    )
                    return

                if not_joined:
                    # Show join prompt ONLY for channels still missing
                    msg = (
                        "⚠️ <b>BẠN CHƯA THAM GIA KÊNH</b>\n\n"
                        "Để nhận quà miễn phí, bạn cần tham gia kênh chính thức của AI Center.\n\n"
                        'Sau khi tham gia, hãy bấm "<b>✅ Tôi đã tham gia</b>" để xác minh.'
                    ) if vi else (
                        "⚠️ <b>YOU HAVEN'T JOINED THE CHANNEL</b>\n\n"
                        "To receive a free gift, please join the official channel below.\n\n"
                        'After joining, tap "<b>✅ I Joined</b>" to verify.'
                    )
                    await update.message.reply_text(
                        msg, parse_mode=ParseMode.HTML,
                        reply_markup=_build_join_markup(L, not_joined),
                    )
                    return
            else:
                logger.info(f"[gift] all_channels_cache_valid telegram_user_id={user.id} — skip_join_screen")

    # ── Cooldown sau khi nhường quà ────────────────────────────────────────
    udata_check = db.get_user(user.id)
    if udata_check:
        cooldown_str = udata_check.get("gift_return_cooldown_until")
        if cooldown_str:
            try:
                cooldown_until = _parse_dt(cooldown_str)
                if _utcnow() < cooldown_until:
                    remaining = cooldown_until - _utcnow()
                    hours, rem = divmod(int(remaining.total_seconds()), 3600)
                    minutes = rem // 60
                    time_str = (f"{hours}h {minutes}p" if hours > 0 else f"{minutes} phút") if vi \
                               else (f"{hours}h {minutes}m" if hours > 0 else f"{minutes} min")
                    await update.message.reply_text(
                        f"⏳ <b>Bạn vừa nhường quà.</b>\n\n"
                        f"Để tránh lạm dụng, bạn cần chờ <b>{time_str}</b> nữa trước khi nhận quà tiếp theo.\n"
                        f"⏰ Mở lại lúc: <code>{cooldown_until.strftime('%H:%M ngày %d/%m/%Y')}</code>" if vi else
                        f"⏳ <b>You recently returned a gift.</b>\n\n"
                        f"To prevent abuse, please wait <b>{time_str}</b> before claiming again.\n"
                        f"⏰ Available at: <code>{cooldown_until.strftime('%H:%M on %d/%m/%Y')}</code>",
                        parse_mode=ParseMode.HTML,
                    )
                    return
            except Exception:
                pass

    # ── Kiểm tra kho và phát quà ───────────────────────────────────────────
    logger.info(f"[gift] stock_check_started telegram_user_id={user.id}")
    stock = db.stock_count()
    logger.info(f"[gift] gift_stock={stock}")
    if stock == 0:
        await update.message.reply_text(t(L, "gift_empty"))
        return

    await _claim_gift(user, context, L, settings)

async def callback_check_join(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """'✅ Tôi đã tham gia' callback — LUÔN gọi getChatMember thật, không dùng kết quả cũ.
    Nếu xác minh thành công: lưu cache → phát quà ngay (không cần bấm Nhận Quà lần nữa).
    """
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L    = lang(user.id)
    vi   = L == "vi"
    settings = db.get_settings()

    if not settings.get("gift_enabled", True):
        await query.edit_message_text(t(L, "gift_disabled"))
        return
    if db.is_banned(user.id):
        await query.edit_message_text(t(L, "gift_banned"))
        return

    # ── Rate limit check (shared bucket với handle_gift) ──────────────────
    rl_result = rl.check_and_record(user.id, "check_join", user.username or "")
    if not rl_result.allowed:
        try:
            await query.edit_message_text(rl_result.message(L), parse_mode=ParseMode.HTML)
        except Exception:
            await query.message.reply_text(rl_result.message(L), parse_mode=ParseMode.HTML)
        return

    channels         = db.get_required_channels()
    enabled_channels = [c for c in channels if c.get("enabled", True)]

    # Luôn gọi getChatMember fresh — không dùng cache ở bước này (spec §7)
    not_joined, no_chat_id, api_errors = await _check_channels_membership(
        context.bot, user.id, enabled_channels
    )
    logger.info(
        f"[gift] check_join_callback telegram_user_id={user.id} "
        f"not_joined={len(not_joined)} no_chat_id={len(no_chat_id)} api_errors={len(api_errors)}"
    )

    if no_chat_id:
        names = ", ".join(f"<b>{c.get('name', 'kênh')}</b>" for c in no_chat_id)
        await query.edit_message_text(
            f"⚠️ Kênh {names} chưa được cấu hình <b>Channel ID</b>.\n\n"
            "Admin cần bổ sung <b>Channel ID</b> (dạng -100xxxxxxxxx) vào trang cài đặt kênh để bot có thể xác minh.",
            parse_mode=ParseMode.HTML,
        )
        return

    if api_errors:
        names = ", ".join(f"<b>{c.get('name', 'kênh')}</b>" for c in api_errors)
        await query.edit_message_text(
            f"⚠️ Không thể xác minh thành viên kênh {names}.\n"
            "Vui lòng kiểm tra bot đã được thêm làm <b>quản trị viên</b> của kênh.",
            parse_mode=ParseMode.HTML,
        )
        return

    if not_joined:
        names = ", ".join(f"<b>{c.get('name') or c.get('username') or 'kênh'}</b>" for c in not_joined)
        msg = (
            f"❌ <b>Hệ thống chưa xác minh được bạn trong kênh.</b>\n\n"
            f"📢 Chưa tham gia: {names}\n\n"
            "Vui lòng tham gia kênh rồi thử lại sau vài giây."
        ) if vi else (
            f"❌ <b>System could not verify your membership.</b>\n\n"
            f"📢 Not joined: {names}\n\n"
            "Please join the channel and try again in a few seconds."
        )
        await query.edit_message_text(
            msg, parse_mode=ParseMode.HTML,
            reply_markup=query.message.reply_markup,
        )
        return

    # Tất cả kênh đã xác minh — cache đã được lưu trong _check_channels_membership
    logger.info(f"[gift] all_channels_verified telegram_user_id={user.id}")

    # Kiểm tra kho + phát quà ngay (không cần bấm Nhận Quà lần nữa — spec §7)
    stock = db.stock_count()
    logger.info(f"[gift] gift_stock={stock}")
    if stock == 0:
        msg = (
            "✅ <b>Xác minh thành công!</b>\n\n😔 Kho quà hiện đã hết. Hãy quay lại sau nhé!"
            if vi else
            "✅ <b>Verification successful!</b>\n\n😔 The gift stock is empty. Please come back later!"
        )
        await query.edit_message_text(msg, parse_mode=ParseMode.HTML)
        return

    await query.edit_message_text(
        "✅ <b>Xác minh thành công!</b> Đang gửi quà cho bạn..." if vi else
        "✅ <b>Verification successful!</b> Sending your gift...",
        parse_mode=ParseMode.HTML,
    )
    logger.info(f"[gift] gift_delivered telegram_user_id={user.id}")
    await _claim_gift(user, context, L, settings)

async def callback_return_gift_init(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Hiện xác nhận khi user bấm 'Nhường lại quà'."""
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L  = lang(user.id)
    vi = L == "vi"

    gift = context.user_data.get("last_gift")
    if not gift:
        # Thử lấy từ claimed_users
        settings = db.get_settings()
        claimed  = db.get_claimed(settings["round_id"])
        uid      = str(user.id)
        if uid in claimed:
            gift = {
                "email":      claimed[uid].get("account_email", ""),
                "password":   "",
                "claimed_at": claimed[uid].get("claim_time", ""),
            }
    if not gift or not gift.get("email"):
        await query.edit_message_text(
            "❌ Không tìm thấy thông tin quà để nhường." if vi
            else "❌ Could not find gift info to return.",
        )
        return

    # Kiểm tra 24h
    try:
        claimed_at = _parse_dt(gift["claimed_at"])
        if _utcnow() - claimed_at > timedelta(hours=24):
            await query.edit_message_text(
                "⏰ Đã quá 24 giờ kể từ khi nhận quà. Không thể nhường lại nữa." if vi
                else "⏰ It's been more than 24 hours since you claimed. Cannot return anymore.",
            )
            return
    except Exception:
        pass

    email_preview = gift["email"][:30] + "..." if len(gift["email"]) > 30 else gift["email"]
    confirm_text = (
        f"↩️ <b>Xác nhận nhường lại quà?</b>\n\n"
        f"📦 Tài khoản: <code>{email_preview}</code>\n\n"
        "• Tài khoản sẽ được trả về kho để người khác nhận.\n"
        "• Bạn sẽ được reset và có thể nhận quà lại.\n"
        "• Hành động này <b>không thể hoàn tác</b>."
    ) if vi else (
        f"↩️ <b>Confirm returning the gift?</b>\n\n"
        f"📦 Account: <code>{email_preview}</code>\n\n"
        "• The account will be returned to the pool for others.\n"
        "• Your gift status will be reset so you can claim again.\n"
        "• This action <b>cannot be undone</b>."
    )
    await query.edit_message_text(
        confirm_text, parse_mode=ParseMode.HTML,
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton("✅ Xác nhận nhường" if vi else "✅ Confirm Return", callback_data="return_gift_confirm"),
            InlineKeyboardButton("❌ Huỷ" if vi else "❌ Cancel", callback_data="return_gift_cancel"),
        ]]),
    )


async def callback_return_gift_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Xử lý nhường quà — trả tài khoản về kho, reset user, ghi queue để admin duyệt."""
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L  = lang(user.id)
    vi = L == "vi"

    gift = context.user_data.get("last_gift")
    if not gift:
        settings = db.get_settings()
        claimed  = db.get_claimed(settings["round_id"])
        uid      = str(user.id)
        if uid in claimed:
            gift = {
                "email":      claimed[uid].get("account_email", ""),
                "password":   "",
                "claimed_at": claimed[uid].get("claim_time", ""),
            }
    if not gift or not gift.get("email"):
        await query.edit_message_text("❌ Không tìm thấy thông tin quà." if vi else "❌ Gift info not found.")
        return

    # Kiểm tra lại 24h
    try:
        claimed_at = _parse_dt(gift["claimed_at"])
        if _utcnow() - claimed_at > timedelta(hours=24):
            await query.edit_message_text(
                "⏰ Đã quá 24 giờ, không thể nhường lại." if vi else "⏰ Time limit exceeded. Cannot return."
            )
            return
    except Exception:
        pass

    email = gift["email"]

    # 1. Trả tài khoản về kho
    db.return_account_to_pool(email)
    # 2. Reset claimed_users cho round này
    settings = db.get_settings()
    round_id = settings["round_id"]
    claimed_all = db.load("claimed_users", {})
    if round_id in claimed_all and str(user.id) in claimed_all[round_id]:
        del claimed_all[round_id][str(user.id)]
        db.save("claimed_users", claimed_all)
    # 3. Reset user gift status
    db.reset_user_gift_status(user.id)
    # 4. Ghi vào return_queue để admin duyệt thông báo
    db.add_return_entry(
        user_id=user.id,
        username=user.username or "",
        first_name=user.first_name or "",
        account_email=email,
        account_password=gift.get("password", ""),
        claim_time=gift.get("claimed_at", ""),
    )
    db.add_log("RETURN_GIFT", f"@{user.username or user.id} ({user.id}) returned {email}", "")
    # Xoá thông tin quà khỏi user_data
    context.user_data.pop("last_gift", None)

    cooldown_until = _utcnow() + timedelta(hours=1)
    await query.edit_message_text(
        f"✅ <b>Đã nhường quà thành công!</b>\n\n"
        f"Cảm ơn bạn đã nhường lại để tránh lãng phí 💚\n\n"
        f"⏰ Để tránh lạm dụng, bạn có thể nhận quà lại sau <b>1 giờ</b>.\n"
        f"Mở lại lúc: <code>{cooldown_until.strftime('%H:%M ngày %d/%m/%Y')}</code>" if vi
        else
        f"✅ <b>Gift returned successfully!</b>\n\n"
        f"Thank you for giving it back 💚\n\n"
        f"⏰ To prevent abuse, you may claim again after <b>1 hour</b>.\n"
        f"Available at: <code>{cooldown_until.strftime('%H:%M on %d/%m/%Y')}</code>",
        parse_mode=ParseMode.HTML,
    )
    logger.info(f"[return_gift] user={user.id} returned account={email}")


async def callback_return_gift_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Huỷ nhường quà."""
    query = update.callback_query
    await query.answer()
    L  = lang(query.from_user.id)
    vi = L == "vi"
    await query.edit_message_text(
        "👌 Đã huỷ. Tài khoản vẫn là của bạn." if vi else "👌 Cancelled. The account is still yours.",
    )


async def callback_back_main(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Called when user taps '⬅️ Quay lại' from channel join screen."""
    query = update.callback_query
    await query.answer()
    user  = query.from_user
    L     = lang(user.id)
    await query.delete_message()

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
        is_kbh      = wdata.get("isKBH", False)
    else:
        data = db.calc_order_display(order, settings)
        warranty_ok = data.get("_warranty_ok")
        days_left   = data.get("_remaining_days")
        can_report  = bool(warranty_ok)
        is_kbh      = data.get("_is_kbh", False)
        # Block if order has any refund record (covers order-id lookups where item=None)
        if can_report and db.get_refund_record(order.get("orderId", "")):
            can_report  = False
            warranty_ok = False
    return {
        "orderId":     order.get("orderId", ""),
        "email":       order.get("email", ""),
        "productName": order.get("productName") or order.get("type") or "?",
        "warrantyOk":  warranty_ok,
        "daysLeft":    days_left,
        "canReport":   can_report,
        "isKBH":       is_kbh,
    }

def _mw_summary_text(L: str, found: list, not_found: list, blocked: list, expired: list = None, kbh: list = None) -> str:
    vi = L == "vi"
    expired = expired or []
    kbh     = kbh     or []
    total = len(found) + len(not_found) + len(blocked) + len(expired) + len(kbh)
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
    if kbh:
        lines.append(f"\n🚫 <b>{'Không Bảo Hành (KBH) — không thể báo lỗi' if vi else 'No Warranty (KBH) — cannot report'} ({len(kbh)})</b>:")
        for a in kbh:
            lines.append(f"  • <code>{a['email']}</code> — {a.get('productName','?')} | 🚫 KBH")
    if expired:
        lines.append(f"\n❌ <b>{'Hết bảo hành — không thể báo lỗi' if vi else 'Warranty expired — cannot report'} ({len(expired)})</b>:")
        for a in expired:
            _e = a.get('email') or ""
            _o = a.get('orderId') or ""
            _ref_label = f"<code>{_e}</code>" if _e else (f"Đơn <code>{_o}</code>" if _o else "")
            lines.append(f"  • {_ref_label + ' — ' if _ref_label else ''}{a.get('productName','?')}")
    if not_found:
        lines.append(f"\n🔍 <b>{'Không tìm thấy' if vi else 'Not found'} ({len(not_found)})</b>:")
        for e in not_found:
            lines.append(f"  • <code>{e}</code>")
        lines.append(
            f"\n💡 <i>{'Không tìm thấy tài khoản? Bạn có thể thử lại bằng <b>mã đơn hàng</b>.' if vi else 'Account not found? Try searching by <b>order code</b> instead.'}</i>"
        )
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

async def handle_support_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Hiển thị sub-menu hỗ trợ: Yêu cầu giao hàng | Báo lỗi | Quay lại."""
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", None)
    await update.message.reply_text(
        t(L, "support_submenu_title"),
        parse_mode=ParseMode.HTML,
        reply_markup=support_menu_keyboard(user.id),
    )

async def handle_yeu_cau_giao_hang(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Bước 1: Hỏi mã đơn hàng, đặt state delivery_input."""
    user = update.effective_user
    L = lang(user.id)
    vi = L == "vi"
    db.set_user_state(user.id, "conv_state", "delivery_input")
    msg = (
        "📦 <b>Yêu cầu giao hàng</b>\n\n"
        "Vui lòng nhập <b>mã đơn hàng</b> của bạn:"
        if vi else
        "📦 <b>Delivery Request</b>\n\n"
        "Please enter your <b>order ID</b>:"
    )
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML,
                                    reply_markup=back_keyboard(user.id))


async def handle_delivery_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Bước 2: Nhận mã đơn, kiểm tra tồn tại, tạo yêu cầu, thông báo admin."""
    user = update.effective_user
    L = lang(user.id)
    vi = L == "vi"
    order_id = update.message.text.strip()
    if not order_id:
        await update.message.reply_text(
            "⚠️ Mã đơn hàng không được để trống. Vui lòng nhập lại." if vi else
            "⚠️ Order ID cannot be empty. Please try again.",
            reply_markup=back_keyboard(user.id)
        )
        return

    # ── Kiểm tra cooldown 10 phút sau lần nhập sai ───────────────────────────
    ustate = db.get_user_state(user.id)
    fail_until_str = ustate.get("_delivery_fail_until")
    if fail_until_str:
        try:
            fail_until = _parse_dt(fail_until_str)
            if _utcnow() < fail_until:
                remaining = fail_until - _utcnow()
                mins = int(remaining.total_seconds() // 60) + 1
                msg = (
                    f"⏰ Bạn đã nhập sai mã đơn. Vui lòng thử lại sau <b>{mins} phút</b>."
                    if vi else
                    f"⏰ Invalid order code entered. Please try again in <b>{mins} minute(s)</b>."
                )
                await update.message.reply_text(msg, parse_mode=ParseMode.HTML,
                                                reply_markup=back_keyboard(user.id))
                return
        except Exception:
            pass
        # Cooldown hết — xóa khỏi state
        db.clear_user_state(user.id, "_delivery_fail_until")

    # ── Kiểm tra mã đơn có tồn tại trong hệ thống không ─────────────────────
    order = db.get_order(order_id)
    if not order:
        # Fuzzy fallback: O↔0, I↔1 ... (giống warranty flow)
        fw = db.find_order_with_items(order_id)
        if fw and fw.get("order"):
            order = fw["order"]
            order_id = order.get("orderId", order_id)  # dùng canonical ID
        else:
            order = db.get_market_order(order_id)
            if order:
                order_id = order.get("orderId", order_id)
    if not order:
        # Đặt cooldown 10 phút
        cooldown_until = (_utcnow() + timedelta(minutes=10)).isoformat()
        db.set_user_state(user.id, "_delivery_fail_until", cooldown_until)
        msg = (
            f"❌ Không tìm thấy mã đơn <code>{order_id}</code>.\n\n"
            f"Vui lòng kiểm tra lại mã đơn hoặc thử lại sau <b>10 phút</b>."
            if vi else
            f"❌ Order code <code>{order_id}</code> not found.\n\n"
            f"Please check your order code or try again in <b>10 minutes</b>."
        )
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML,
                                        reply_markup=back_keyboard(user.id))
        return

    # ── Xóa cooldown nếu nhập đúng ───────────────────────────────────────────
    db.clear_user_state(user.id, "_delivery_fail_until")

    # Chặn yêu cầu trùng lặp — mỗi mã đơn chỉ được giao 1 lần
    existing = db.get_delivery_request_by_order(order_id)
    if existing:
        status = existing.get("status", "pending")
        if status == "sent":
            note = (
                f"✅ Mã đơn <code>{order_id}</code> đã được giao tài khoản rồi.\n"
                f"Nếu bạn chưa nhận được, vui lòng liên hệ hỗ trợ."
                if vi else
                f"✅ Order <code>{order_id}</code> has already been fulfilled.\n"
                f"If you haven't received it, please contact support."
            )
        else:
            note = (
                f"⏳ Yêu cầu giao tài khoản cho mã đơn <code>{order_id}</code> "
                f"đã được gửi trước đó và đang chờ xử lý.\n"
                f"Vui lòng chờ admin giao tài khoản cho bạn."
                if vi else
                f"⏳ A delivery request for order <code>{order_id}</code> "
                f"has already been submitted and is pending.\n"
                f"Please wait for admin to process it."
            )
        db.set_user_state(user.id, "conv_state", None)
        await update.message.reply_text(note, parse_mode=ParseMode.HTML,
                                        reply_markup=support_menu_keyboard(user.id))
        return

    # Calculate first reminder time from settings
    reminder_cfg = db.get_delivery_reminder_settings()
    first_reminder_at: str | None = None
    if reminder_cfg.get("enabled") and reminder_cfg.get("reminderMinutes"):
        first_min = reminder_cfg["reminderMinutes"][0]
        first_reminder_at = (_utcnow() + timedelta(minutes=first_min)).isoformat()

    req_id = db.add_delivery_request(
        user_id=user.id,
        username=user.username or "",
        first_name=user.first_name or "",
        order_id=order_id,
        user_lang=L,
        first_reminder_at=first_reminder_at,
    )
    db.set_user_state(user.id, "conv_state", None)

    confirm = (
        f"✅ <b>Yêu cầu giao hàng đã được gửi!</b>\n\n"
        f"📦 Mã đơn: <code>{order_id}</code>\n\n"
        f"Admin sẽ xử lý và gửi tài khoản cho bạn sớm nhất có thể."
        if vi else
        f"✅ <b>Delivery request submitted!</b>\n\n"
        f"📦 Order: <code>{order_id}</code>\n\n"
        f"Admin will process and send your account as soon as possible."
    )
    await update.message.reply_text(confirm, parse_mode=ParseMode.HTML,
                                    reply_markup=support_menu_keyboard(user.id))

    # Notify admin in background
    from threading import Thread
    Thread(target=_notify_admin_delivery, args=(req_id, user, order_id), daemon=True).start()


def _notify_admin_delivery(req_id: str, user, order_id: str) -> None:
    """Gửi thông báo cho admin khi có yêu cầu giao hàng mới."""
    try:
        if not ADMIN_ID:
            return
        uname = f"@{user.username}" if user.username else user.first_name or str(user.id)
        msg = (
            f"📦 <b>YÊU CẦU GIAO HÀNG MỚI</b>\n\n"
            f"👤 Người dùng: {uname} (<code>{user.id}</code>)\n"
            f"📋 Mã đơn: <code>{order_id}</code>\n"
            f"🆔 Request ID: <code>{req_id}</code>\n\n"
            f"➡️ Vào <b>Admin Panel → Giao tài khoản</b> để xử lý."
        )
        mid = _tg_send(TOKEN, ADMIN_ID, msg)
        # Lưu message_id để reminder sau xóa được tin cũ
        if mid:
            db.update_delivery_request(req_id, {"adminMsgIds": {str(ADMIN_ID): mid}})
    except Exception as e:
        logger.error(f"_notify_admin_delivery error: {e}")

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
    kbh_full: list = []       # (order, item) — KBH products (no warranty)
    kbh: list = []            # summary records for KBH

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
        # Đơn đã hoàn tiền — không cho báo lỗi, xếp vào expired để hiện card nhưng không có nút
        _item_ref   = matched_item.get("item_status") == "refunded" if matched_item else False
        _order_ref  = order.get("status") == "refunded"
        _hist_ref   = db.get_refund_record(order.get("orderId", "")) is not None
        if _item_ref or _order_ref or _hist_ref:
            acc = _mw_compute_account(order, settings, item=matched_item)
            acc["canReport"] = False
            expired.append(acc)
            expired_full.append((order, matched_item))
            continue
        acc = _mw_compute_account(order, settings, item=matched_item)
        if not acc["canReport"]:
            if acc.get("isKBH"):
                # KBH — no warranty, bucket separately so UI shows different label
                kbh.append(acc)
                kbh_full.append((order, matched_item))
            else:
                # Warranty expired — cannot report
                expired.append(acc)
                expired_full.append((order, matched_item))
        else:
            found.append(acc)
            found_full.append((order, matched_item))

    # Always send full order card(s) for every account (found OR expired OR kbh), up to 3 total
    _CARD_THRESHOLD = 3
    all_full = found_full + expired_full + kbh_full
    if len(all_full) <= _CARD_THRESHOLD:
        for (ord_, mit_) in all_full:
            card_text = _fmt_order(L, ord_, settings, item=mit_)
            await update.message.reply_text(card_text, parse_mode=ParseMode.HTML)

    # No reportable accounts at all → show summary + back only
    if not found:
        summary = _mw_summary_text(L, found, not_found, blocked, expired=expired, kbh=kbh)
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
        _mw_summary_text(L, found, not_found, blocked, expired=expired, kbh=kbh),
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

    # ── Rate limit check ───────────────────────────────────────────────────
    rl_result = rl.check_and_record(user.id, "support", user.username or "")
    if not rl_result.allowed:
        await update.message.reply_text(rl_result.message(L), parse_mode=ParseMode.HTML,
                                        reply_markup=main_keyboard(user.id))
        for key in ("conv_state", "_mw_found", "_mw_not_found", "_mw_sel"):
            db.clear_user_state(user.id, key)
        return

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

    # Chặn gửi trùng: nếu đã có yêu cầu bảo hành đang chờ/xử lý, báo và không tạo mới
    vi = L == "vi"
    existing_active = db.get_active_warranty_requests_by_user(user.id)
    if existing_active:
        ex = existing_active[-1]
        ex_time = (ex.get("submittedAt") or "")[:16].replace("T", " ")
        msg_dup = (
            f"⏳ <b>Bạn đã có yêu cầu bảo hành đang chờ xử lý.</b>\n\n"
            f"Yêu cầu gửi lúc <b>{ex_time}</b> đang ở trạng thái <b>chờ/đang xử lý</b>.\n"
            f"Vui lòng chờ admin xử lý yêu cầu trước đó. Không cần gửi lại."
            if vi else
            f"⏳ <b>You already have a warranty request pending.</b>\n\n"
            f"Request submitted at <b>{ex_time}</b> is still pending/processing.\n"
            f"Please wait for admin to handle the previous request."
        )
        for key in ("conv_state", "_mw_accounts", "_mw_desc", "_mw_found", "_mw_sel", "_mw_state"):
            db.clear_user_state(user.id, key)
        await update.message.reply_text(msg_dup, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
        return

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

# Rate limit on the actual lookup (when user sends the order code/email)

# ─── Order lookup (shared for support + check_order states) ───────────────────

async def handle_order_lookup(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)

    # ── Rate limit check ───────────────────────────────────────────────────
    rl_result = rl.check_and_record(user.id, "lookup", user.username or "")
    if not rl_result.allowed:
        await update.message.reply_text(rl_result.message(L), parse_mode=ParseMode.HTML,
                                        reply_markup=main_keyboard(user.id))
        db.clear_user_state(user.id, "conv_state")
        return

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

    # ── Market order: hiển thị riêng (đơn chợ canboso) ──────────────────────
    if result.get("lookupType") == "market_order":
        mo = result["order"]
        oid  = mo.get("order_id", "")
        name = mo.get("product_name", "")
        qty  = mo.get("quantity", "1")
        price = mo.get("sell_price") or mo.get("price", "")
        status = mo.get("status", "")
        content = mo.get("content", "")
        created = mo.get("created_at_raw", "") or mo.get("created_at", "")[:16]
        seller  = mo.get("seller", "")
        vi = L == "vi"
        status_emoji = "✅" if status in ("completed", "done") else "⏳"
        lines = [
            f"🛒 <b>{'Đơn hàng chợ' if vi else 'Market Order'}</b>",
            f"🏷 {'Mã đơn' if vi else 'Order'}: <code>{oid}</code>",
            f"📦 {'Sản phẩm' if vi else 'Product'}: {name}",
            f"🔢 {'Số lượng' if vi else 'Qty'}: {qty}",
            f"💰 {'Giá' if vi else 'Price'}: {price}",
            f"{status_emoji} {'Trạng thái' if vi else 'Status'}: {status}",
        ]
        if seller:
            lines.append(f"🏪 {'Người bán' if vi else 'Seller'}: {seller}")
        if created:
            lines.append(f"📅 {'Ngày mua' if vi else 'Date'}: {created}")
        if content:
            lines.append(f"\n📋 {'Nội dung giao' if vi else 'Delivery'}:\n<code>{content}</code>")
        await update.message.reply_text(
            "\n".join(lines), parse_mode=ParseMode.HTML,
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
    else:
        # Legacy path (no item record): still must block KBH and refunded orders
        data_chk = db.calc_order_display(order, settings)
        if data_chk.get("_is_kbh", False) or order.get("status") == "refunded":
            can_report = False
    # Final gate: block if order has any refund record (catches all lookup paths)
    if can_report and db.get_refund_record(order.get("orderId", "")):
        can_report = False

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

    # ── Rate limit check ───────────────────────────────────────────────────
    rl_result = rl.check_and_record(user.id, "support", user.username or "")
    if not rl_result.allowed:
        await update.message.reply_text(rl_result.message(L), parse_mode=ParseMode.HTML,
                                        reply_markup=main_keyboard(user.id))
        for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
            db.clear_user_state(user.id, key)
        return

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
            w_st = wdata.get("warrantyStatus", "")
            item_refunded  = found_item.get("item_status") == "refunded"
            order_refunded = order.get("status") == "refunded"
            if item_refunded or order_refunded or w_st == "refunded":
                msg = (
                    "💰 <b>Đơn hàng đã được hoàn tiền.</b>\n\n"
                    "⚠️ Đơn hàng này đã được hoàn tiền và không thể tiếp tục gửi yêu cầu báo lỗi hoặc bảo hành."
                ) if vi else (
                    "💰 <b>This order has been refunded.</b>\n\n"
                    "⚠️ This order has been refunded and no further error reports or warranty requests are allowed."
                )
                db.add_log("WARRANTY_BLOCKED_REFUNDED", f"@{user.username} ({user.id}) | Order: {order_id}", "")
            else:
                msg = (
                    "❌ <b>Đơn hàng đã hết thời hạn bảo hành.</b>\n\n"
                    "Không thể tạo yêu cầu hỗ trợ cho đơn này."
                ) if vi else (
                    "❌ <b>This order's warranty has expired.</b>\n\n"
                    "Cannot create a support request for this order."
                )
                db.add_log("WARRANTY_BLOCKED_EXPIRED", f"@{user.username} ({user.id}) | Order: {order_id}", "")
            for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
                db.clear_user_state(user.id, key)
            await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
            return

    # Chặn gửi trùng: nếu đã có yêu cầu bảo hành đang chờ/xử lý, báo và không tạo mới
    existing_active = db.get_active_warranty_requests_by_user(user.id)
    if existing_active:
        ex = existing_active[-1]
        ex_time = (ex.get("submittedAt") or "")[:16].replace("T", " ")
        msg_dup = (
            f"⏳ <b>Bạn đã có yêu cầu bảo hành đang chờ xử lý.</b>\n\n"
            f"Yêu cầu gửi lúc <b>{ex_time}</b> đang ở trạng thái <b>chờ/đang xử lý</b>.\n"
            f"Vui lòng chờ admin xử lý yêu cầu trước đó. Không cần gửi lại."
            if vi else
            f"⏳ <b>You already have a warranty request pending.</b>\n\n"
            f"Request submitted at <b>{ex_time}</b> is still pending/processing.\n"
            f"Please wait for admin to handle the previous request."
        )
        for key in ("conv_state", "_report_order_id", "_report_email", "_report_item_id"):
            db.clear_user_state(user.id, key)
        await update.message.reply_text(msg_dup, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
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
        vi = L == "vi"
        # Backend refund gate — blocks even when button was already shown
        order = db.get_order(order_id)
        if order and order.get("status") == "refunded":
            await query.answer(
                "💰 Đơn hàng này đã được hoàn tiền. Không thể báo lỗi." if vi
                else "💰 This order has been refunded. Cannot report errors.",
                show_alert=True,
            )
            return
        # Backend KBH gate — always block even if button slipped through
        import re as _re
        _pname_gate = (order.get("productName") or "").upper()
        if _re.search(r'\bKBH\b', _pname_gate):
            await query.answer(
                "🚫 Sản phẩm này không có bảo hành (KBH). Không thể báo lỗi." if vi
                else "🚫 This product has no warranty (KBH). Cannot report errors.",
                show_alert=True,
            )
            return

        # Also check per-item refund using stored item_id
        stored_item_id = db.get_user_state(user.id).get("_report_item_id", "")
        if stored_item_id and order_id:
            settings_ = db.get_settings()
            for it in db.get_order_items(order_id):
                if it.get("itemId") == stored_item_id:
                    if it.get("item_status") == "refunded":
                        await query.answer(
                            "💰 Tài khoản này đã được hoàn tiền. Không thể báo lỗi." if vi
                            else "💰 This account has been refunded. Cannot report errors.",
                            show_alert=True,
                        )
                        return
                    wdata_ = db.calc_item_warranty(it, order or {}, settings_)
                    if not wdata_["canReport"]:
                        label = ("💰 Đã hoàn tiền." if wdata_.get("warrantyStatus") == "refunded"
                                 else ("❌ Đơn hàng đã hết thời hạn bảo hành." if vi
                                       else "❌ Warranty has expired."))
                        await query.answer(label, show_alert=True)
                        return
                    break
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
        # Filter: only items still under warranty AND not refunded
        settings = db.get_settings()
        product_name = order.get("productName", "") if order else ""
        _ord_refunded = (order or {}).get("status") == "refunded"
        found = []
        for it in all_items:
            if _ord_refunded or it.get("item_status") == "refunded":
                continue
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
        # Filter: only items still under warranty AND not refunded
        settings = db.get_settings()
        product_name = order.get("productName", "") if order else ""
        _ord_refunded2 = (order or {}).get("status") == "refunded"
        found = []
        for it in all_items:
            if _ord_refunded2 or it.get("item_status") == "refunded":
                continue
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

    channels = get_active_shop_channels()

    if len(channels) == 0:
        # No shop_channels.json or all disabled → fallback to legacy single-link
        url = settings.get("shop_link", "")
        if not url:
            await update.message.reply_text("🛍 Kênh bán hàng chưa được cấu hình.")
            return
        await update.message.reply_text(
            f"🛍 {settings.get('shop_username', '')}",
            reply_markup=shop_inline(L, settings),
        )
    elif len(channels) == 1:
        # Single channel → mở trực tiếp (không hiện menu chọn)
        ch = channels[0]
        icon = ch.get("icon", "🛒")
        disp = ch.get("username") or ch.get("name", "")
        await update.message.reply_text(
            f"🛍 {icon} {disp}",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton(t(L, "btn_open_shop"), url=ch["link"])
            ]]),
        )
    else:
        # Nhiều kênh → hiện danh sách chọn
        await update.message.reply_text(
            "🛍️ Chọn kênh muốn truy cập:",
            reply_markup=shop_channels_inline(L, channels),
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
    if L == "en":
        title   = intro.get("titleEn") or intro.get("title", "")
        content = intro.get("contentEn") or intro.get("content", "")
    else:
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
_MENU_KEYS = ["btn_home", "btn_support", "btn_gift", "btn_check_order", "btn_shop", "btn_intro", "btn_gift_box",
              "btn_bao_loi", "btn_yeu_cau_giao", "btn_chat_support", "btn_end_chat"]

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

    # Admin B có phiên được assign → bất kỳ tin nào đều route về khách (không cần reply-to)
    if await _route_assigned_admin_direct(update, context):
        return

    # Admin chat reply detection (reply-to message)
    if update.message.reply_to_message and await _route_admin_chat_reply(update, context):
        return

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
        await handle_support_menu(update, context)
    elif text in (t("vi", "btn_bao_loi"), t("en", "btn_bao_loi")):
        await handle_support(update, context)
    elif text in (t("vi", "btn_yeu_cau_giao"), t("en", "btn_yeu_cau_giao")):
        await handle_yeu_cau_giao_hang(update, context)
    elif text in (t("vi", "btn_gift"), t("en", "btn_gift")):
        await handle_gift(update, context)
    elif text in (t("vi", "btn_check_order"), t("en", "btn_check_order")):
        await handle_check_order(update, context)
    elif text in (t("vi", "btn_shop"), t("en", "btn_shop")):
        await handle_shop(update, context)
    elif text in (t("vi", "btn_intro"), t("en", "btn_intro")):
        await handle_intro(update, context)
    elif text in (t("vi", "btn_gift_box"), t("en", "btn_gift_box")):
        await handle_gift_box(update, context)
    elif text in (t("vi", "btn_chat_support"), t("en", "btn_chat_support")):
        await handle_chat_support_start(update, context)
    elif text in (t("vi", "btn_end_chat"), t("en", "btn_end_chat")):
        await handle_end_chat(update, context)
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
        elif state == "delivery_input":
            await handle_delivery_input(update, context)
        elif state == "live_chat":
            await handle_live_chat_message(update, context)
        else:
            # Check secret code before falling back to unknown-command reply
            if await _process_secret_code(update, context, text):
                return
            vi = L == "vi"
            if vi:
                cmd_hint = (
                    "❓ Không hiểu lệnh này.\n\n"
                    "📋 Các lệnh có thể dùng:\n"
                    "/start — Bắt đầu\n"
                    "/support — Hỗ trợ\n"
                    "/gift — Nhận quà\n"
                    "/orders — Kiểm tra đơn\n"
                    "/myid — ID của bạn\n\n"
                    "Hoặc dùng menu bên dưới 👇"
                )
            else:
                cmd_hint = (
                    "❓ Command not recognized.\n\n"
                    "📋 Available commands:\n"
                    "/start — Start\n"
                    "/support — Support\n"
                    "/gift — Claim gift\n"
                    "/orders — Check order\n"
                    "/myid — Your Telegram ID\n\n"
                    "Or use the menu below 👇"
                )
            await update.message.reply_text(cmd_hint, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))

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

def _tg_send_markup(token: str, chat_id: int, text: str, markup: dict | None = None, max_retries: int = 3) -> int | None:
    """Send message with optional inline keyboard; returns message_id on success, None on failure."""
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
                    body = _json.loads(resp.read())
                    return body.get("result", {}).get("message_id")
        except Exception as e:
            logger.warning(f"TG send markup attempt {attempt+1} failed for chat {chat_id}: {e}")
            if attempt < max_retries - 1:
                time.sleep(1)
    db.add_log("NOTIF_SEND_FAIL", f"chat_id={chat_id}", "bot")
    return None

def _tg_delete_message(token: str, chat_id: int, message_id: int) -> bool:
    """Delete a previously sent message. Silently ignores 'message not found' errors."""
    try:
        url = f"https://api.telegram.org/bot{token}/deleteMessage"
        data = _json.dumps({"chat_id": chat_id, "message_id": message_id}).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception as e:
        logger.debug(f"TG delete message {message_id} in {chat_id}: {e}")
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
        # Lưu message_id của từng admin để xóa khi nhắc lại
        admin_msg_ids: dict[str, int] = {}
        for aid in admin_ids:
            mid = _tg_send_markup(TOKEN, aid, msg, markup)
            if mid:
                admin_msg_ids[str(aid)] = mid

        # Persist notification state and schedule first reminder
        now_dt = datetime.now()
        r1_min = int(ns.get("reminder1Minutes", 5))
        next_reminder = (now_dt + timedelta(minutes=r1_min)).isoformat()
        db.update_warranty_request(req_id, {
            "adminNotifiedAt": now_dt.isoformat(),
            "adminMsgIds":     admin_msg_ids,   # {chat_id: message_id}
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

                    # Xóa tin nhắn cũ của từng admin trước khi gửi tin nhắc mới
                    prev_msg_ids: dict = req.get("adminMsgIds") or {}
                    for aid in admin_ids:
                        old_mid = prev_msg_ids.get(str(aid))
                        if old_mid:
                            _tg_delete_message(TOKEN, aid, int(old_mid))

                    # Gửi tin nhắc mới và lưu message_id mới
                    msg = _build_warranty_notif_msg(req, order, tag, suffix)
                    new_msg_ids: dict[str, int] = {}
                    for aid in admin_ids:
                        mid = _tg_send_markup(TOKEN, aid, msg, _warranty_admin_markup(req_id))
                        if mid:
                            new_msg_ids[str(aid)] = mid

                    new_count = reminder_count + 1
                    update = {
                        "reminderCount":    new_count,
                        "lastReminderAt":   now_dt.isoformat(),
                        "adminMsgIds":      new_msg_ids,   # cập nhật msg_id mới nhất
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

def delivery_reminder_worker() -> None:
    """Background thread: nhắc admin các yêu cầu giao hàng chưa xử lý theo mốc thời gian cấu hình."""
    while True:
        time.sleep(60)
        try:
            cfg = db.get_delivery_reminder_settings()
            if not cfg.get("enabled"):
                continue

            minutes_marks: list[int] = cfg.get("reminderMinutes", [10, 30, 60])
            if not minutes_marks:
                continue

            admin_ids = _get_all_admin_ids()
            if not admin_ids:
                continue

            now_dt = datetime.now()

            for req in db.get_delivery_requests():
                # Only care about pending requests with reminders still active
                if req.get("status") != "pending":
                    continue
                if not req.get("reminderEnabled", True):
                    continue
                if req.get("reminderProcessing"):
                    continue

                next_at_str = req.get("nextReminderAt")
                if not next_at_str:
                    continue
                try:
                    next_at = datetime.fromisoformat(next_at_str)
                except Exception:
                    continue
                if now_dt < next_at:
                    continue

                req_id        = req["id"]
                reminder_count = int(req.get("reminderCount", 0))

                if reminder_count >= len(minutes_marks):
                    # All reminder marks exhausted — stop
                    db.update_delivery_request(req_id, {"reminderEnabled": False, "nextReminderAt": None})
                    continue

                # Acquire processing lock
                if not db.update_delivery_request(req_id, {"reminderProcessing": True}):
                    continue

                try:
                    elapsed_min = int((now_dt - datetime.fromisoformat(req["submittedAt"])).total_seconds() / 60)
                    uname = f"@{req['username']}" if req.get("username") else req.get("firstName") or req["userId"]

                    # Xóa tin nhắn cũ trước khi gửi nhắc mới
                    prev_msg_ids: dict = req.get("adminMsgIds") or {}
                    for aid in admin_ids:
                        old_mid = prev_msg_ids.get(str(aid))
                        if old_mid:
                            _tg_delete_message(TOKEN, aid, int(old_mid))

                    msg = (
                        f"🔔 <b>Nhắc giao tài khoản (lần {reminder_count + 1})</b>\n\n"
                        f"Bạn còn một yêu cầu giao tài khoản chưa xử lý.\n\n"
                        f"📦 Mã đơn: <code>{req['orderId']}</code>\n"
                        f"👤 Người dùng: {uname}\n"
                        f"⏱ Thời gian chờ: {elapsed_min} phút\n\n"
                        f"➡️ Vào <b>Admin Panel → 📦 Giao tài khoản</b> để xử lý."
                    )
                    new_msg_ids: dict[str, int] = {}
                    for aid in admin_ids:
                        mid = _tg_send(TOKEN, aid, msg)
                        if mid:
                            new_msg_ids[str(aid)] = mid

                    new_count = reminder_count + 1
                    update_fields: dict = {
                        "reminderCount":    new_count,
                        "lastReminderAt":   now_dt.isoformat(),
                        "adminMsgIds":      new_msg_ids,
                        "reminderProcessing": False,
                    }
                    if new_count < len(minutes_marks):
                        # Delta until next mark from submittedAt
                        next_mark_min = minutes_marks[new_count]
                        submitted_dt  = datetime.fromisoformat(req["submittedAt"])
                        next_reminder_dt = submitted_dt + timedelta(minutes=next_mark_min)
                        update_fields["nextReminderAt"] = next_reminder_dt.isoformat()
                    else:
                        # All marks sent — disable
                        update_fields["reminderEnabled"] = False
                        update_fields["nextReminderAt"]  = None

                    db.update_delivery_request(req_id, update_fields)
                    logger.info(f"Delivery reminder #{new_count} sent for {req_id} (waited {elapsed_min} min)")

                except Exception as send_err:
                    logger.error(f"delivery_reminder_worker send error for {req_id}: {send_err}")
                    db.update_delivery_request(req_id, {"reminderProcessing": False})

        except Exception as e:
            logger.error(f"delivery_reminder_worker error: {e}")


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
    # Auto-ack any duplicate pending requests from the same user (merge into 1 on web)
    auto_closed = db.ack_duplicate_warranty_requests(req.get("userId", ""), req_id, str(user.id))
    db.add_log("WARRANTY_ACK", f"{req_id} by @{user.username or user.id}" + (f" (+{auto_closed} dup auto-acked)" if auto_closed else ""), "bot")

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



def _get_chat_settings() -> dict:
    """Đọc cài đặt chat support từ file (fallback về mặc định)."""
    defaults = {
        "timeout_minutes":      10,
        "delete_delay_seconds": 300,
        "spam_max_msgs":        10,
        "spam_window_sec":      60,
        "spam_warn_at":          8,
        "session_cooldown_sec": 120,
    }
    try:
        p = os.path.join(os.path.dirname(__file__), "data", "support_chat_settings.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                s = _json.load(f)
            return {
                "timeout_minutes":      int(s.get("timeoutMinutes",       10)),
                "delete_delay_seconds": int(s.get("deleteDelayMinutes",    5)) * 60,
                "spam_max_msgs":        int(s.get("spamMaxMsgs",          10)),
                "spam_window_sec":      int(s.get("spamWindowSec",        60)),
                "spam_warn_at":         int(s.get("spamWarnAt",            8)),
                "session_cooldown_sec": int(s.get("sessionCooldownSec",  120)),
            }
    except Exception:
        pass
    return defaults


def _append_chat_history(session: dict, uid_str: str, end_reason: str) -> None:
    """Ghi thêm 1 phiên vào lịch sử (support_chat_history.json), giữ tối đa 500 mục."""
    try:
        p = os.path.join(os.path.dirname(__file__), "data", "support_chat_history.json")
        history: list = []
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    history = _json.load(f)
                if not isinstance(history, list):
                    history = []
            except Exception:
                history = []

        entry = {
            "uid":       uid_str,
            "userId":    int(uid_str),
            "username":  session.get("username", ""),
            "firstName": session.get("first_name", ""),
            "startedAt": session.get("started_at", ""),
            "endedAt":   datetime.utcnow().isoformat(),
            "endReason": end_reason,
            "msgCount":  session.get("msg_count", 0),
            "messages":  session.get("messages", []),
        }
        history.append(entry)
        # Giữ tối đa 500 mục (cũ nhất bị xoá trước)
        if len(history) > 500:
            history = history[-500:]

        with open(p, "w", encoding="utf-8") as f:
            _json.dump(history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"_append_chat_history error: {e}")


# ─── 💬 Chat với Support — Anti-spam ─────────────────────────────────────────
# In-memory: {uid_str: [timestamp, ...]}  — timestamps của tin nhắn gần đây
_chat_msg_timestamps: dict[str, list] = {}
# In-memory: {uid_str: float}  — thời điểm phiên trước kết thúc (epoch)
_chat_session_ended_at: dict[str, float] = {}

# Spam settings đọc động từ _get_chat_settings() — không hardcode
def _spam_cfg():
    s = _get_chat_settings()
    return s["spam_max_msgs"], s["spam_window_sec"], s["spam_warn_at"], s["session_cooldown_sec"]


# ─── 💬 Chat với Support ──────────────────────────────────────────────────────

_CHAT_SESSIONS_FILE = os.path.join(os.path.dirname(__file__), "data", "support_chat_sessions.json")
_CHAT_TIMEOUT_MINUTES = 10


def _load_chat_sessions() -> dict:
    try:
        if os.path.exists(_CHAT_SESSIONS_FILE):
            with open(_CHAT_SESSIONS_FILE, encoding="utf-8") as f:
                return _json.load(f)
    except Exception:
        pass
    return {"sessions": {}, "msg_map": {}}


def _save_chat_sessions(data: dict) -> None:
    try:
        with open(_CHAT_SESSIONS_FILE, "w", encoding="utf-8") as f:
            _json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"_save_chat_sessions error: {e}")


# ─── Chat Support Helpers ─────────────────────────────────────────────────────

def _get_support_admins(enabled_only: bool = False) -> list:
    """Đọc danh sách admin phụ từ support_chat_admins.json."""
    try:
        p = os.path.join(os.path.dirname(__file__), "data", "support_chat_admins.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                admins = _json.load(f)
            if enabled_only:
                return [a for a in admins if a.get("enabled", True)]
            return admins
    except Exception as e:
        logger.error(f"_get_support_admins error: {e}")
    return []


def _get_chat_ban(uid_str: str) -> dict | None:
    """Kiểm tra user có bị cấm chat không. Xoá tự động nếu đã hết hạn."""
    try:
        p = os.path.join(os.path.dirname(__file__), "data", "support_chat_banned.json")
        if not os.path.exists(p):
            return None
        with open(p, encoding="utf-8") as f:
            ban_list = _json.load(f)
        entry = next((b for b in ban_list if str(b.get("userId")) == uid_str), None)
        if not entry:
            return None
        expires_at = entry.get("expiresAt")
        if expires_at is None:
            return entry  # vĩnh viễn
        if datetime.utcnow() < datetime.fromisoformat(expires_at):
            return entry  # còn hiệu lực
        # Hết hạn → tự xoá
        new_list = [b for b in ban_list if str(b.get("userId")) != uid_str]
        with open(p, "w", encoding="utf-8") as f:
            _json.dump(new_list, f, ensure_ascii=False, indent=2)
        return None
    except Exception as e:
        logger.error(f"_get_chat_ban error: {e}")
    return None


_DEFAULT_AI_SYSTEM_PROMPT = """Bạn là AI trợ lý hỗ trợ khách hàng thân thiện và chuyên nghiệp của nền tảng Giveaway & Support.

=== VỀ NỀN TẢNG ===
Đây là nền tảng tặng quà, bán hàng và hỗ trợ khách hàng qua Telegram bot.

Các tính năng chính:
• Kiểm tra đơn hàng: dùng lệnh /orders hoặc nút "Kiểm Tra Đơn Hàng"
• Nhận quà miễn phí: dùng lệnh /gift hoặc nút "Nhận Quà"
• Bảo hành sản phẩm: kiểm tra và đăng ký bảo hành qua bot
• Chat với nhân viên hỗ trợ: tính năng hiện tại đang dùng
• Kênh bán hàng: thông tin về các kênh mua sắm chính thức

=== CÁCH XỬ LÝ VẤN ĐỀ ===
• Đơn hàng chưa nhận / bị lỗi → KIỂM TRA NGAY trong [DỮ LIỆU ĐƠN HÀNG] bên dưới nếu có, hoặc hỏi mã đơn
• Muốn nhận quà → hướng dẫn dùng /gift hoặc nút "Nhận Quà"
• Bảo hành còn hạn (BH còn) → khách có thể báo lỗi trong bot, hoặc gửi /orders và bấm nút báo lỗi
• Bảo hành hết hạn (BH hết) → giải thích lịch sự rằng đơn đã hết bảo hành, không thể đổi/trả
• Sản phẩm KBH (Không Bảo Hành) → giải thích rằng sản phẩm này không có chính sách bảo hành
• Vấn đề thanh toán → hướng dẫn cung cấp thông tin đơn hàng để admin kiểm tra
• Câu hỏi phức tạp / khiếu nại → thông báo sẽ chuyển cho nhân viên hỗ trợ

=== HƯỚNG DẪN ĐỌC DỮ LIỆU ĐƠN HÀNG (khi có trong context) ===
Khi có block [DỮ LIỆU ĐƠN HÀNG] được cung cấp, hãy dùng dữ liệu THẬT này để trả lời:
- productName: tên sản phẩm
- status: trạng thái đơn (active=đang hoạt động, expired=hết hạn, refunded=đã hoàn tiền)
- purchaseDate: ngày mua
- expiryDate: ngày hết hạn sử dụng
- warrantyExpiry / warrantyEndDate: ngày hết hạn BẢO HÀNH
- warrantyDays: số ngày bảo hành (0 hoặc "KBH"/"BHF" trong tên = không bảo hành toàn bộ thời gian)
- BH_STATUS: "active"=còn BH, "expired"=hết BH, "no_warranty"=không BH, "no_data"=chưa có thông tin
- items: danh sách tài khoản trong đơn (email/credential)
- warranty_requests: các yêu cầu bảo hành đã gửi trước đó

Khi khách cung cấp mã đơn và mã đó có trong dữ liệu → trả lời ngay với thông tin thật, KHÔNG yêu cầu dùng /orders nữa.
Khi mã đơn KHÔNG có trong dữ liệu → nói không tìm thấy và hướng dẫn dùng /orders để xem chi tiết.

=== QUY TẮC BẢO HÀNH ===
• BH còn hạn: khách có thể báo lỗi → hướng dẫn bấm /orders rồi bấm nút "Báo Lỗi"
• BH hết hạn: giải thích lịch sự, không thể bảo hành, nhưng có thể hỏi admin nếu cần
• Sản phẩm KBH (warrantyDays=0, hoặc "KBH" trong tên): không có bảo hành từ đầu
• Sản phẩm BHF (trong tên sản phẩm): bảo hành toàn bộ thời gian sử dụng

=== QUY TẮC QUAN TRỌNG ===
1. Luôn trả lời bằng ngôn ngữ của khách (tiếng Việt hoặc tiếng Anh)
2. Câu trả lời ngắn gọn, thân thiện, có emoji phù hợp
3. KHÔNG tiết lộ password / twoFA / thông tin đăng nhập cho khách qua chat này
4. KHÔNG hứa hẹn điều không chắc chắn
5. Nếu không biết câu trả lời → thành thật nói và đề nghị chờ admin hỗ trợ
6. Nếu khách tức giận → bình tĩnh, đồng cảm, hứa chuyển cho admin xử lý ngay
7. Khi cần chuyển admin hãy nói: "Tôi sẽ chuyển vấn đề này cho nhân viên hỗ trợ. Vui lòng chờ trong giây lát! 🙏"
"""


def _load_ai_settings() -> dict:
    """Đọc cài đặt AI từ file data/chat_ai_settings.json."""
    p = os.path.join(os.path.dirname(__file__), "data", "chat_ai_settings.json")
    try:
        with open(p, "r", encoding="utf-8") as f:
            return _json.load(f)
    except Exception:
        return {}


def _build_ai_order_context(uid_str: str, session_messages: list) -> str:
    """
    Tra cứu đơn hàng thực tế từ orders.json + order_items.json + warranty_requests.json.
    Quét toàn bộ tin nhắn trong session để tìm mã đơn hàng (ORDER...).
    Trả về chuỗi context để inject vào system prompt của AI.
    """
    import re as _re
    from datetime import datetime as _dt

    context_parts: list[str] = []

    # ── 1. Tìm tất cả mã đơn đã đề cập trong cuộc trò chuyện ──────────────
    order_id_pattern = _re.compile(r'\b(ORDER[A-Z0-9]{6,})\b', _re.IGNORECASE)
    mentioned_ids: set[str] = set()
    for m in session_messages:
        text = m.get("text", "")
        for match in order_id_pattern.findall(text):
            mentioned_ids.add(match.upper())

    # ── 2. Tra cứu từng mã đơn trong orders.json + order_items.json ────────
    if mentioned_ids:
        orders_data  = db.load("orders", {})
        items_data   = db.load("order_items", {})
        today        = _dt.utcnow().date()

        for oid in list(mentioned_ids)[:5]:  # tối đa 5 đơn để tránh prompt quá dài
            order = orders_data.get(oid)
            if not order:
                # thử fuzzy: O↔0
                oid_canon = oid.replace("O", "0")
                for k, v in orders_data.items():
                    if k.replace("O", "0") == oid_canon:
                        order = v
                        oid   = k
                        break
            if not order:
                context_parts.append(f"[DỮ LIỆU ĐƠN HÀNG]\nMã đơn {oid}: KHÔNG TÌM THẤY trong hệ thống.")
                continue

            items = items_data.get(oid, [])

            # Tính trạng thái bảo hành
            warranty_days = int(order.get("warrantyDays") or 0)
            product_name  = order.get("productName", "")
            pname_up      = product_name.upper()
            is_bhf = "BHF" in pname_up
            is_kbh = "KBH" in pname_up or warranty_days == 0

            # Ngày hết hạn SỬ DỤNG (luôn có)
            usage_expiry = (order.get("expiryDate") or "")[:10]

            # Ngày hết hạn BẢO HÀNH — chỉ dùng khi không phải KBH/BHF
            # Lưu ý: với KBH, warrantyExpiry thường = expiryDate (ngày dùng), KHÔNG phải ngày BH
            if is_kbh:
                bh_expiry_str = ""  # Không có BH → không hiện ngày để tránh AI nhầm
                bh_status     = "KBH (Không Bảo Hành) - sản phẩm này KHÔNG có bảo hành từ đầu"
            elif is_bhf:
                # BHF: bảo hành toàn bộ thời gian dùng → ngày BH = ngày hết hạn sử dụng
                bh_expiry_str = usage_expiry
                bh_status     = f"BHF - Bảo hành đến hết hạn sử dụng ({usage_expiry})"
            else:
                # Bảo hành thông thường: đọc warrantyExpiry
                raw_w = (order.get("warrantyExpiry") or order.get("warrantyDate") or "")[:10]
                bh_expiry_str = raw_w
                if raw_w:
                    try:
                        w_date    = _dt.strptime(raw_w, "%Y-%m-%d").date()
                        bh_status = f"CÒN BH đến {raw_w}" if w_date >= today else f"HẾT BH từ {raw_w}"
                    except Exception:
                        bh_status = "no_data"
                else:
                    bh_status = "no_data"

            # Định dạng danh sách item (email, không lộ password/2FA)
            item_lines = []
            for idx, it in enumerate(items[:5], 1):
                i_email  = it.get("email") or it.get("credential") or ""
                i_status = it.get("item_status") or it.get("status") or "unknown"
                # Chỉ hiện ngày BH item khi không phải KBH
                i_wend   = "" if is_kbh else (it.get("warranty_end_date") or "")[:10]
                item_lines.append(
                    f"  Item {idx}: {i_email} | status={i_status}"
                    + (f" | BH đến {i_wend}" if i_wend else "")
                )

            lines = [
                f"[DỮ LIỆU ĐƠN HÀNG] Mã: {oid}",
                f"  Sản phẩm: {product_name}",
                f"  Khách hàng: {order.get('customerName', '')}",
                f"  Ngày mua: {order.get('purchaseDate', '')[:10]}",
                f"  Hết hạn SỬ DỤNG: {usage_expiry or 'N/A'}",
                f"  Bảo hành: {bh_status}",
                f"  Trạng thái đơn: {order.get('status', '')}",
                f"  Số lượng: {order.get('quantity', 1)}",
                f"  Giá: {order.get('totalPrice', order.get('price', ''))} VNĐ",
            ]
            if bh_expiry_str and not is_kbh and not is_bhf:
                lines.append(f"  Ngày hết hạn BH: {bh_expiry_str}")
            if item_lines:
                lines.append("  Tài khoản trong đơn:")
                lines.extend(item_lines)

            context_parts.append("\n".join(lines))

    # ── 3. Lấy lịch sử warranty_requests của user này ──────────────────────
    try:
        all_wrs = db.load("warranty_requests", [])
        user_wrs = [r for r in all_wrs if str(r.get("userId", "")) == uid_str]
        if user_wrs:
            wr_lines = ["[YÊU CẦU BẢO HÀNH CỦA KHÁCH]"]
            for wr in user_wrs[-5:]:  # 5 cái gần nhất
                wr_lines.append(
                    f"  Đơn {wr.get('orderId','')} | "
                    f"Ngày gửi: {(wr.get('submittedAt') or '')[:10]} | "
                    f"Trạng thái: {wr.get('status','')} | "
                    f"Kết quả: {wr.get('resolution','chưa xử lý')}"
                )
            context_parts.append("\n".join(wr_lines))
    except Exception:
        pass

    return "\n\n".join(context_parts)


async def _ai_chat_reply(session_messages: list, uid_str: str | None = None) -> str | None:
    """
    Gọi OpenAI API để sinh câu trả lời tự động.
    uid_str: Telegram user ID dạng string, dùng để tra cứu đơn hàng thực tế.
    Trả về chuỗi text hoặc None nếu AI tắt / lỗi.
    """
    import httpx as _httpx

    cfg = _load_ai_settings()
    if not cfg.get("enabled"):
        return None

    api_key = cfg.get("apiKey") or os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.warning("AI reply: no API key configured")
        return None

    model         = cfg.get("model", "gpt-4o-mini")
    system_prompt = cfg.get("systemPrompt") or _DEFAULT_AI_SYSTEM_PROMPT

    # ── Inject dữ liệu đơn hàng thực tế vào system prompt ─────────────────
    if uid_str:
        try:
            order_ctx = _build_ai_order_context(uid_str, session_messages)
            if order_ctx:
                system_prompt = system_prompt + "\n\n" + order_ctx
        except Exception as e:
            logger.warning(f"AI order context error: {e}")

    messages = [{"role": "system", "content": system_prompt}]
    for m in session_messages[-20:]:
        role = "user" if m.get("role") == "user" else "assistant"
        content = m.get("text", "")
        if content and content != "[Ảnh]":
            messages.append({"role": role, "content": content})

    try:
        async with _httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type":  "application/json",
                },
                json={
                    "model":       model,
                    "messages":    messages,
                    "max_tokens":  800,
                    "temperature": 0.7,
                },
            )
            data = resp.json()
            return data["choices"][0]["message"]["content"].strip()
    except Exception as e:
        logger.error(f"AI chat reply error: {e}")
        return None


def _build_transfer_markup(uid_str: str) -> InlineKeyboardMarkup | None:
    """Nút đơn 'Chuyển phiên' — click sẽ hiện danh sách admin phụ."""
    if not _get_support_admins(enabled_only=True):
        return None
    return InlineKeyboardMarkup([[
        InlineKeyboardButton("↗️ Chuyển phiên", callback_data=f"spt_menu:{uid_str}")
    ]])


def _build_transfer_select_markup(uid_str: str) -> InlineKeyboardMarkup:
    """Danh sách admin phụ để chọn + nút Huỷ."""
    sub_admins = _get_support_admins(enabled_only=True)
    rows = []
    for admin in sub_admins:
        name = admin.get("name") or f"Admin {admin.get('id', '?')}"
        rows.append([InlineKeyboardButton(
            f"👤 {name}",
            callback_data=f"spt:{uid_str}:{admin['id']}"
        )])
    rows.append([InlineKeyboardButton("❌ Huỷ", callback_data=f"spt_cancel:{uid_str}")])
    return InlineKeyboardMarkup(rows)


def _chat_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup([[t(L, "btn_end_chat")]], resize_keyboard=True)


async def handle_chat_support_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """User nhấn Chat với Support — tạo/tiếp tục phiên chat."""
    user = update.effective_user
    L = lang(user.id)
    data = _load_chat_sessions()
    uid_str = str(user.id)

    # ── Kiểm tra bị cấm chat ────────────────────────────────────────────────
    ban_entry = _get_chat_ban(uid_str)
    if ban_entry:
        expires_at = ban_entry.get("expiresAt")
        if expires_at:
            exp_str = datetime.fromisoformat(expires_at).strftime("%d/%m/%Y %H:%M")
            msg = f"🚫 Bạn bị cấm sử dụng chat hỗ trợ đến <b>{exp_str}</b>."
        else:
            msg = "🚫 Bạn đã bị cấm vĩnh viễn khỏi chat hỗ trợ."
        if ban_entry.get("note"):
            msg += f"\nLý do: {ban_entry['note']}"
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
        return
    # ────────────────────────────────────────────────────────────────────────

    # Đã có phiên mở
    if uid_str in data["sessions"] and data["sessions"][uid_str].get("status") == "active":
        db.set_user_state(user.id, "conv_state", "live_chat")
        await update.message.reply_text(
            "🟢 Bạn đang có phiên chat đang mở. Tiếp tục gõ tin nhắn.",
            reply_markup=_chat_keyboard(user.id)
        )
        return

    # Tạo phiên mới
    # ── Anti-spam: cooldown giữa các phiên ─────────────────────────────
    _, _, _, _sess_cd = _spam_cfg()
    _ended = _chat_session_ended_at.get(uid_str, 0)
    _elapsed = time.time() - _ended
    if _sess_cd > 0 and _elapsed < _sess_cd:
        _wait = int(_sess_cd - _elapsed) + 1
        await update.message.reply_text(
            "Vi vui lòng chờ " + str(_wait) + "s trước khi bắt đầu phiên mới.",
            reply_markup=main_keyboard(user.id)
        )
        return
    # ───────────────────────────────────────────────────────────
    # ── Anti-spam: cooldown giữa các phiên ─────────────────────────────
    _, _, _, _sess_cd = _spam_cfg()
    _ended_at = _chat_session_ended_at.get(uid_str, 0)
    _elapsed  = time.time() - _ended_at
    if _sess_cd > 0 and _elapsed < _sess_cd:
        _wait = int(_sess_cd - _elapsed) + 1
        await update.message.reply_text(
            "⏱ Vui lòng chờ " + str(_wait) + "s trước khi bắt đầu phiên mới.",
            reply_markup=main_keyboard(user.id)
        )
        return
    # ─────────────────────────────────────────────────────────────────
    now_ts = datetime.utcnow().isoformat()
    data["sessions"][uid_str] = {
        "started_at": now_ts,
        "last_active": now_ts,
        "status": "active",
        "username": user.username or "",
        "first_name": user.first_name or "",
        "admin_msg_ids": [],
        "user_bot_msg_ids": [],
    }
    _save_chat_sessions(data)
    db.set_user_state(user.id, "conv_state", "live_chat")

    sent_start = await update.message.reply_text(
        t(L, "chat_support_start"),
        parse_mode=ParseMode.HTML,
        reply_markup=_chat_keyboard(user.id)
    )
    data["sessions"][uid_str]["user_bot_msg_ids"].append(sent_start.message_id)
    _save_chat_sessions(data)

    # KHÔNG thông báo admin khi mới bắt đầu — chờ tin nhắn đầu tiên
    _save_chat_sessions(data)


async def handle_live_chat_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Forward tin nhắn của user đến admin khi đang trong phiên live_chat."""
    user = update.effective_user
    L = lang(user.id)
    text = update.message.text.strip()
    if not text:
        return

    data = _load_chat_sessions()
    uid_str = str(user.id)
    session = data["sessions"].get(uid_str)

    if not session or session.get("status") != "active":
        db.set_user_state(user.id, "conv_state", None)
        await update.message.reply_text(
            "⚠️ Phiên chat đã hết hạn. Nhấn Chat với Support để bắt đầu lại.",
            reply_markup=main_keyboard(user.id)
        )
        return

    # ── Anti-spam: rate limit tin nhắn ─────────────────────────────
    _spam_max, _spam_win, _spam_warn, _ = _spam_cfg()
    _now_ts = time.time()
    _tss = _chat_msg_timestamps.setdefault(uid_str, [])
    _tss[:] = [_t for _t in _tss if _now_ts - _t < _spam_win]
    if len(_tss) >= _spam_max:
        _wait = int(_spam_win - (_now_ts - _tss[0])) + 1
        await update.message.reply_text(
            "🚫 Bạn gử i quá nhiều tin. Vui lòng chờ " + str(_wait) + "s trước khi tiếp tục.",
            reply_markup=_chat_keyboard(user.id)
        )
        return
    _tss.append(_now_ts)
    if len(_tss) >= _spam_warn:
        _rem = _spam_max - len(_tss)
        await update.message.reply_text(
            "⚠️ Còn " + str(_rem) + " tin trước khi bị tạm dừng.",
            reply_markup=_chat_keyboard(user.id)
        )
    # ───────────────────────────────────────────────────────────
    session["last_active"] = datetime.utcnow().isoformat()
    session["msg_count"] = session.get("msg_count", 0) + 1

    # Lưu nội dung tin vào session để ghi lịch sử
    session.setdefault("messages", []).append({
        "role": "user",
        "text": text,
        "time": datetime.utcnow().isoformat(),
    })

    # ── AI tự động trả lời (nếu bật, chưa có admin tiếp nhận VÀ admin chưa reply) ──
    assigned = session.get("assigned_admin_id")
    if not assigned and not session.get("admin_engaged"):
        try:
            ai_reply = await _ai_chat_reply(session.get("messages", []), uid_str=uid_str)
            if ai_reply:
                await context.bot.send_chat_action(chat_id=user.id, action="typing")
                ai_sent = await update.message.reply_text(
                    ai_reply, reply_markup=_chat_keyboard(user.id)
                )
                session.setdefault("messages", []).append({
                    "role": "assistant",
                    "text": ai_reply,
                    "time": datetime.utcnow().isoformat(),
                })
                session.setdefault("user_bot_msg_ids", []).append(ai_sent.message_id)

                # ── Phát hiện AI muốn chuyển sang nhân viên ───────────────
                if _ai_wants_transfer(ai_reply) and not session.get("admin_notified"):
                    session["admin_notified"] = True
                    # Báo khách đang kết nối
                    conn_msg = await context.bot.send_message(
                        chat_id=user.id,
                        text="🔗 <i>Đang kết nối với nhân viên hỗ trợ, vui lòng chờ...</i>",
                        parse_mode=ParseMode.HTML,
                        reply_markup=_chat_keyboard(user.id),
                    )
                    session.setdefault("user_bot_msg_ids", []).append(conn_msg.message_id)
                    # Gửi toàn bộ lịch sử chat lên admin
                    await _notify_admin_with_history(context, session, uid_str, user)
        except Exception as e:
            logger.error(f"AI auto-reply error: {e}")

    # ── Forward tin nhắn đến admin (chỉ khi admin đã được thông báo) ──────────
    assigned = session.get("assigned_admin_id")
    name = f"@{user.username}" if user.username else (user.first_name or str(user.id))

    if assigned:
        # ── Đã chuyển phiên: forward ẩn danh cho admin phụ ──────────────────
        msg_anon = (
            f"💬 <b>Khách</b>:\n{text}\n"
            f"──────────────\n"
            f"<i>↩️ Reply tin này để trả lời</i>"
        )
        try:
            sent = await context.bot.send_message(
                chat_id=assigned, text=msg_anon, parse_mode=ParseMode.HTML
            )
            session.setdefault("admin_msg_ids", []).append(sent.message_id)
            data["msg_map"][str(sent.message_id)] = uid_str
        except Exception as e:
            logger.error(f"handle_live_chat_message (assigned) send error: {e}")

    elif session.get("admin_engaged") or session.get("admin_notified"):
        # ── Admin đã biết / đã reply → forward tin tiếp theo lên ADMIN_ID ───
        if not ADMIN_ID:
            await update.message.reply_text(t(L, "chat_support_no_admin"), reply_markup=_chat_keyboard(user.id))
            _save_chat_sessions(data)
            return
        msg_to_admin = (
            f"💬 <b>{name}</b>:\n{text}\n"
            f"──────────────\n"
            f"<i>↩️ Reply tin này để trả lời</i>"
        )
        try:
            sent = await context.bot.send_message(
                chat_id=ADMIN_ID, text=msg_to_admin,
                parse_mode=ParseMode.HTML,
            )
            session.setdefault("admin_msg_ids", []).append(sent.message_id)
            data["msg_map"][str(sent.message_id)] = uid_str
        except Exception as e:
            logger.error(f"handle_live_chat_message (main admin) send error: {e}")
    # else: AI đang xử lý, chưa cần thông báo admin

    _save_chat_sessions(data)




async def handle_live_chat_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    Xử lý ảnh trong phiên live_chat:
    - Nếu là admin reply ảnh → forward về user
    - Nếu là user trong live_chat → forward ảnh lên admin
    """
    user = update.effective_user
    msg  = update.message

    # Admin gửi ảnh là reply → route về user
    if msg.reply_to_message:
        admin_ids = _get_all_admin_ids()
        if user.id in admin_ids:
            if await _route_admin_chat_reply(update, context):
                return

    # User gửi ảnh
    state = db.get_user_state(user.id).get("conv_state")
    if state != "live_chat":
        return  # ảnh ngoài phiên chat → bỏ qua

    data    = _load_chat_sessions()
    uid_str = str(user.id)
    session = data["sessions"].get(uid_str)

    if not session or session.get("status") != "active":
        db.set_user_state(user.id, "conv_state", None)
        await msg.reply_text(
            "⚠️ Phiên chat đã hết hạn. Nhấn Chat với Support để bắt đầu lại.",
            reply_markup=main_keyboard(user.id)
        )
        return

    session["last_active"] = datetime.utcnow().isoformat()
    session["msg_count"] = session.get("msg_count", 0) + 1

    name   = f"@{user.username}" if user.username else (user.first_name or str(user.id))
    photo  = msg.photo[-1]
    u_cap  = msg.caption or ""

    # Lưu ảnh vào messages
    session.setdefault("messages", []).append({
        "role": "user",
        "text": "[Ảnh]",
        "time": datetime.utcnow().isoformat(),
    })

    assigned = session.get("assigned_admin_id")
    if assigned:
        # ── Đã chuyển phiên: gửi ảnh ẩn danh cho admin phụ ─────────────────
        anon_header = (
            f"📷 <b>Khách</b>:\n"
            + (u_cap + "\n" if u_cap else "")
            + f"──────────────\n<i>↩️ Reply tin này để trả lời</i>"
        )
        try:
            sent = await context.bot.send_photo(
                chat_id=assigned, photo=photo.file_id,
                caption=anon_header, parse_mode=ParseMode.HTML,
            )
            session.setdefault("admin_msg_ids", []).append(sent.message_id)
            data["msg_map"][str(sent.message_id)] = uid_str
        except Exception as e:
            logger.error(f"handle_live_chat_media (assigned) send error: {e}")

    elif session.get("admin_engaged") or session.get("admin_notified"):
        # ── Admin đã biết / đã reply → forward ảnh tiếp theo lên ADMIN_ID ───
        if not ADMIN_ID:
            L = lang(user.id)
            await msg.reply_text(t(L, "chat_support_no_admin"), reply_markup=_chat_keyboard(user.id))
            _save_chat_sessions(data)
            return
        header = (
            f"📷 <b>{name}</b>:\n"
            + (u_cap + "\n" if u_cap else "")
            + f"──────────────\n<i>↩️ Reply tin này để trả lời</i>"
        )
        try:
            sent = await context.bot.send_photo(
                chat_id=ADMIN_ID, photo=photo.file_id,
                caption=header, parse_mode=ParseMode.HTML,
            )
            session.setdefault("admin_msg_ids", []).append(sent.message_id)
            data["msg_map"][str(sent.message_id)] = uid_str
        except Exception as e:
            logger.error(f"handle_live_chat_media (main admin) send error: {e}")
    # else: AI đang xử lý → không forward ảnh lên admin

    _save_chat_sessions(data)

async def handle_end_chat(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """User nhấn Kết thúc chat — thông báo trước, 5 phút sau tự xoá tin."""
    user = update.effective_user
    L = lang(user.id)

    data = _load_chat_sessions()
    uid_str = str(user.id)
    session = data["sessions"].pop(uid_str, None)
    if session:
        for mid in session.get("admin_msg_ids", []):
            data["msg_map"].pop(str(mid), None)
    db.set_user_state(user.id, "conv_state", None)
    _chat_session_ended_at[uid_str] = time.time()  # anti-spam
    _chat_msg_timestamps.pop(uid_str, None)

    # Lên lịch xoá tin sau 5 phút
    if session:
        data.setdefault("pending_deletions", {})[uid_str] = {
            "scheduled_at":   datetime.utcnow().isoformat(),
            "user_id":        user.id,
            "first_name":     session.get("first_name", user.first_name or ""),
            "admin_chat_ids": _get_all_admin_ids(),
            "user_bot_msg_ids": session.get("user_bot_msg_ids", []),
            "admin_msg_ids":  session.get("admin_msg_ids", []),
        }
    _save_chat_sessions(data)

    # Ghi vào lịch sử
    if session:
        _append_chat_history(session, uid_str, "user_ended")

    # Thông báo kết thúc + cảnh báo sắp xoá
    warn_suffix = "\n\n🗑 Tin nhắn trong phiên chat sẽ tự xoá sau 5 phút."
    end_msg = await update.message.reply_text(
        t(L, "chat_support_user_end") + warn_suffix,
        reply_markup=main_keyboard(user.id)
    )
    # Track message kết thúc vào pending_deletions để xoá cùng lúc
    if session and uid_str in data.get("pending_deletions", {}):
        data["pending_deletions"][uid_str].setdefault("user_bot_msg_ids", []).append(end_msg.message_id)
        _save_chat_sessions(data)

    if session:
        name = f"@{user.username}" if user.username else (user.first_name or str(user.id))
        notif = (
            f"⧹ <b>{name}</b> (<code>{user.id}</code>) đã kết thúc phiên chat hỗ trợ.\n"
            f"🗑 Tin nhắn sẽ tự xoá sau 5 phút."
        )
        # Thông báo admin chính + admin phụ (nếu có)
        notify_ids = set(_get_all_admin_ids())
        assigned = session.get("assigned_admin_id")
        if assigned:
            notify_ids.add(int(assigned))
        for aid in notify_ids:
            try:
                mid = _tg_send(TOKEN, aid, notif)
                if mid and uid_str in data.get("pending_deletions", {}):
                    data["pending_deletions"][uid_str].setdefault("admin_msg_ids", []).append(mid)
            except Exception:
                pass
        _save_chat_sessions(data)


def _ai_wants_transfer(ai_reply: str) -> bool:
    """Phát hiện AI đang nói chuyển sang nhân viên hỗ trợ."""
    import re as _re
    patterns = [
        r"chuyển.*nhân viên", r"nhân viên.*hỗ trợ", r"chờ trong giây lát",
        r"chuyển.*vấn đề", r"kết nối.*nhân viên", r"nhân viên.*tiếp nhận",
        r"transfer.*support", r"connect.*support", r"support.*staff",
        r"chuyển.*admin", r"admin.*hỗ trợ",
    ]
    text = ai_reply.lower()
    return any(_re.search(p, text) for p in patterns)


async def _notify_admin_with_history(context, session: dict, uid_str: str, user) -> None:
    """
    Gửi toàn bộ lịch sử chat lên ADMIN_ID kèm nút Chuyển phiên.
    Gọi khi AI quyết định chuyển sang nhân viên hỗ trợ.
    """
    if not ADMIN_ID:
        return

    name = f"@{user.username}" if user.username else (user.first_name or str(user.id))
    messages = session.get("messages", [])

    # Dựng chuỗi lịch sử chat
    history_lines = []
    for m in messages:
        role = m.get("role", "user")
        txt  = m.get("text", "")
        ts   = (m.get("time", "") or "")[:16].replace("T", " ")
        if role == "user":
            history_lines.append(f"👤 <b>Khách</b> [{ts}]: {txt}")
        elif role == "assistant":
            history_lines.append(f"🤖 <b>AI</b> [{ts}]: {txt}")
        # bỏ qua role "support" — chưa có ở giai đoạn này

    history_str = "\n".join(history_lines) if history_lines else "(chưa có tin nhắn)"

    header = (
        f"🔔 <b>Khách cần hỗ trợ — {name}</b> (<code>{user.id}</code>)\n"
        f"──────────────\n"
        f"📋 <b>Lịch sử chat với AI:</b>\n"
        f"{history_str}\n"
        f"──────────────\n"
        f"<i>↩️ Reply tin này để trả lời khách</i>"
    )

    # Cắt nếu quá dài (Telegram limit 4096)
    if len(header) > 4000:
        header = header[:3900] + "\n...(cắt bớt)\n──────────────\n<i>↩️ Reply tin này để trả lời khách</i>"

    transfer_markup = _build_transfer_markup(uid_str)
    try:
        from data_manager import load as _dm_load
        data = _load_chat_sessions()
        sent = await context.bot.send_message(
            chat_id=ADMIN_ID, text=header,
            parse_mode=ParseMode.HTML, reply_markup=transfer_markup,
        )
        session.setdefault("admin_msg_ids", []).append(sent.message_id)
        data["msg_map"][str(sent.message_id)] = uid_str
        session["session_notif_mid"] = sent.message_id
        _save_chat_sessions(data)
    except Exception as e:
        logger.error(f"_notify_admin_with_history error: {e}")


async def _route_assigned_admin_direct(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Admin B đang được assign một phiên → bất kỳ tin nhắn nào (không cần reply-to)
    đều được forward thẳng về khách đó.
    Trả về True nếu đã xử lý.
    """
    msg = update.message
    if not msg or (not msg.text and not msg.photo):
        return False

    sender = update.effective_user
    sub_admin_ids = {int(a.get("id", 0)) for a in _get_support_admins()}
    if sender.id not in sub_admin_ids:
        return False

    # Tìm session mà assigned_admin_id == sender.id
    data    = _load_chat_sessions()
    aid_str = str(sender.id)
    uid_str = None
    session = None
    for u, s in data["sessions"].items():
        if str(s.get("assigned_admin_id", "")) == aid_str and s.get("status") == "active":
            uid_str = u
            session = s
            break

    if not uid_str or not session:
        return False

    user_id = int(uid_str)
    try:
        if msg.photo:
            caption_header = "💬 <b>Support:</b>"
            if msg.caption:
                caption_header += "\n" + msg.caption
            sent_photo = await context.bot.send_photo(
                chat_id=user_id,
                photo=msg.photo[-1].file_id,
                caption=caption_header,
                parse_mode=ParseMode.HTML,
                reply_markup=_chat_keyboard(user_id),
            )
            session.setdefault("user_bot_msg_ids", []).append(sent_photo.message_id)
        else:
            kb = _chat_keyboard(user_id).to_dict()
            sent_mid = _tg_send_markup(TOKEN, user_id, "💬 <b>Support:</b>\n" + msg.text, markup=kb)
            if sent_mid:
                session.setdefault("user_bot_msg_ids", []).append(sent_mid)
    except Exception as e:
        logger.error(f"_route_assigned_admin_direct error: {e}")
        return True

    session["last_active"]   = datetime.utcnow().isoformat()
    session["admin_engaged"] = True
    session.setdefault("messages", []).append({
        "role": "support",
        "text": msg.text if msg.text else "[Ảnh]",
        "time": datetime.utcnow().isoformat(),
    })
    _save_chat_sessions(data)
    return True


async def _route_admin_chat_reply(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """
    Nếu admin reply một tin nhắn được forward từ user → forward reply về user.
    Trả về True nếu đã xử lý.
    """
    msg = update.message
    if not msg or not msg.reply_to_message or (not msg.text and not msg.photo):
        return False

    sender = update.effective_user
    admin_ids = _get_all_admin_ids()
    sub_admin_ids = [int(a.get("id", 0)) for a in _get_support_admins()]
    all_allowed = set(admin_ids) | set(sub_admin_ids)
    if sender.id not in all_allowed:
        return False

    replied_mid = str(msg.reply_to_message.message_id)
    data = _load_chat_sessions()
    uid_str = data["msg_map"].get(replied_mid)
    if not uid_str:
        return False

    session = data["sessions"].get(uid_str)
    if not session or session.get("status") != "active":
        return False

    # Forward reply về user (text hoặc ảnh)
    user_id = int(uid_str)
    try:
        if msg.photo:
            caption_parts = []
            if msg.caption:
                caption_parts.append(msg.caption)
            caption_header = "💬 <b>Support:</b>"
            if caption_parts:
                caption_header += "\n" + caption_parts[0]
            sent_photo = await context.bot.send_photo(
                chat_id=user_id,
                photo=msg.photo[-1].file_id,
                caption=caption_header,
                parse_mode=ParseMode.HTML,
                reply_markup=_chat_keyboard(user_id),
            )
            session.setdefault("user_bot_msg_ids", []).append(sent_photo.message_id)
        else:
            kb = _chat_keyboard(user_id).to_dict()
            sent_mid = _tg_send_markup(TOKEN, user_id, "💬 <b>Support:</b>\n" + msg.text, markup=kb)
            if sent_mid:
                session.setdefault("user_bot_msg_ids", []).append(sent_mid)
    except Exception as e:
        logger.error(f"_route_admin_chat_reply error: {e}")
        return True

    session["last_active"]   = datetime.utcnow().isoformat()
    session["admin_engaged"] = True   # Admin đã reply → tắt AI cho phiên này
    # Lưu reply support vào messages
    if uid_str:
        session.setdefault("messages", []).append({
            "role": "support",
            "text": msg.text if msg.text else "[Ảnh]",
            "time": datetime.utcnow().isoformat(),
        })
    _save_chat_sessions(data)
    return True


def _chat_timeout_worker() -> None:
    """Background thread: đóng phiên chat sau 30 phút không hoạt động."""
    while True:
        time.sleep(60)  # check mỗi 1 phút
        try:
            data = _load_chat_sessions()
            now = datetime.utcnow()
            to_close = []
            for uid_str, session in data["sessions"].items():
                if session.get("status") != "active":
                    continue
                last = session.get("last_active", "")
                if not last:
                    continue
                try:
                    last_dt = datetime.fromisoformat(last)
                    if (now - last_dt).total_seconds() > _get_chat_settings()["timeout_minutes"] * 60:
                        to_close.append(uid_str)
                except Exception:
                    pass

            for uid_str in to_close:
                session = data["sessions"].pop(uid_str, {})
                for mid in session.get("admin_msg_ids", []):
                    data["msg_map"].pop(str(mid), None)

                user_id = int(uid_str)

                # Ghi vào lịch sử
                _append_chat_history(session, uid_str, "timeout")

                # Lên lịch xoá tin sau 5 phút
                data.setdefault("pending_deletions", {})[uid_str] = {
                    "scheduled_at":   datetime.utcnow().isoformat(),
                    "user_id":        user_id,
                    "first_name":     session.get("first_name", ""),
                    "admin_chat_ids": _get_all_admin_ids(),
                    "user_bot_msg_ids": session.get("user_bot_msg_ids", []),
                    "admin_msg_ids":  session.get("admin_msg_ids", []),
                }

                try:
                    timeout_notif_id = _tg_send(TOKEN, user_id,
                             "⏱ Phiên chat hỗ trợ đã tự đóng do không có hoạt động sau 10 phút.\n"
                             "Nhấn <b>Chat với Support</b> nếu bạn cần hỗ trợ thêm.\n\n"
                             "🗑 Tin nhắn trong phiên chat sẽ tự xoá sau 5 phút.",
                             )
                    if timeout_notif_id:
                        data["pending_deletions"][uid_str].setdefault("user_bot_msg_ids", []).append(timeout_notif_id)
                except Exception:
                    pass
                db.set_user_state(user_id, "conv_state", None)
                _chat_session_ended_at[uid_str] = time.time()  # anti-spam
                _chat_msg_timestamps.pop(uid_str, None)

                admin_ids = _get_all_admin_ids()
                sname = session.get("username") or session.get("first_name") or uid_str
                name_str = f"@{sname}" if session.get("username") else sname
                notif = (
                    f"⏱ Phiên chat với <b>{name_str}</b> (<code>{uid_str}</code>) "
                    f"đã tự đóng (timeout {_CHAT_TIMEOUT_MINUTES} phút)."
                )
                for aid in admin_ids:
                    try:
                        mid = _tg_send(TOKEN, aid, notif)
                        if mid and uid_str in data.get("pending_deletions", {}):
                            data["pending_deletions"][uid_str].setdefault("admin_msg_ids", []).append(mid)
                    except Exception:
                        pass
                logger.info(f"[CHAT] Timeout session uid={uid_str}")

            if to_close:
                _save_chat_sessions(data)

            # ── Xử lý hàng đợi xoá tin (pending_deletions) ──────────────────────────
            data = _load_chat_sessions()  # reload sau khi to_close
            pend = data.get("pending_deletions", {})
            pend_done = []
            for puid, pitem in list(pend.items()):
                try:
                    sched = datetime.fromisoformat(pitem["scheduled_at"])
                    if (now - sched).total_seconds() < _get_chat_settings()["delete_delay_seconds"]:
                        continue
                    puid_int = int(pitem.get("user_id", puid))
                    for mid in pitem.get("user_bot_msg_ids", []):
                        _tg_delete_message(TOKEN, puid_int, mid)
                    # Xoá phía admin — dùng chat IDs đã lưu lúc tạo phiên
                    _adm_chats = pitem.get("admin_chat_ids") or _get_all_admin_ids()
                    _adm_msgs  = pitem.get("admin_msg_ids", [])
                    _del_ok = 0
                    for aid in _adm_chats:
                        for mid in _adm_msgs:
                            if _tg_delete_message(TOKEN, aid, mid):
                                _del_ok += 1
                    if _adm_msgs:
                        logger.info(f"[CHAT] Admin-side deleted {_del_ok}/{len(_adm_chats)*len(_adm_msgs)} msgs uid={puid}")
                    # Sau khi xoá: gửi thông báo + hiện lại main menu
                    try:
                        _tg_send(TOKEN, puid_int,
                                 "🗑 <b>Tin nhắn chat đã được xoá.</b>\n"
                                 "Bạn có thể bắt đầu phiên hỗ trợ mới bất cứ lúc nào.")
                        kb_dict = main_keyboard(puid_int).to_dict()
                        sname = pitem.get("first_name", "") or str(puid)
                        L_user = lang(puid_int)
                        welcome_text = t(L_user, "welcome_admin", name=sname) if is_admin(puid_int) else t(L_user, "welcome", name=sname)
                        _tg_send_markup(TOKEN, puid_int, welcome_text, markup=kb_dict)
                    except Exception as wex:
                        logger.warning(f"post-deletion welcome error uid={puid}: {wex}")
                    # Thông báo admin: tin đã xoá
                    try:
                        _sname = pitem.get("first_name", "") or str(puid)
                        for _aid in _adm_chats:
                            _tg_send(TOKEN, _aid,
                                     f"🗑️ Tin nhắn phiên chat với <b>{_sname}</b> (<code>{puid}</code>) đã được xoá tự động.")
                    except Exception:
                        pass
                    pend_done.append(puid)
                    logger.info(f"[CHAT] Deleted queued messages uid={puid}")
                except Exception as ex:
                    logger.error(f"pending_deletions uid={puid}: {ex}")
                    pend_done.append(puid)
            if pend_done:
                for puid in pend_done:
                    pend.pop(puid, None)
                data["pending_deletions"] = pend
                _save_chat_sessions(data)
        except Exception as e:
            logger.error(f"_chat_timeout_worker error: {e}")

# ─── Ô Quà Bí Mật ─────────────────────────────────────────────────────────────

def _gbox_cols(total: int) -> int:
    """Return column count for a square grid."""
    import math
    return max(1, int(math.isqrt(total)))

def _gift_box_grid_keyboard(event: dict, user_id: int) -> InlineKeyboardMarkup:
    boxes  = event.get("boxes", [])
    total  = len(boxes)
    cols   = _gbox_cols(total)
    eid    = event["id"]
    prizes = event.get("prizes", [])
    prize_map = {p["id"]: p for p in prizes}

    rows = []
    for r in range(0, total, cols):
        row = []
        for i in range(r, min(r + cols, total)):
            box = boxes[i]
            if box.get("opened"):
                p = prize_map.get(box.get("prizeId"))
                is_lucky = not p or p.get("type") == "lucky"
                if box.get("openedBy") == user_id:
                    emoji = "🟨"
                elif is_lucky:
                    emoji = "✨"
                else:
                    emoji = "🎁"
                row.append(InlineKeyboardButton(emoji, callback_data=f"gbox_view:{eid}:{i}"))
            else:
                row.append(InlineKeyboardButton("⬜", callback_data=f"gbox:{eid}:{i}"))
        rows.append(row)
    return InlineKeyboardMarkup(rows)

def _gift_box_header(event: dict, user_id: int, extra: str = "") -> str:
    boxes   = event.get("boxes", [])
    total   = len(boxes)
    opened  = sum(1 for b in boxes if b.get("opened"))
    max_p   = int(event.get("maxPicksPerUser", 1))
    u_picks = sum(1 for b in boxes if b.get("openedBy") == user_id)
    name    = event.get("name", "Ô Quà Bí Mật")
    msg = (
        f"🎁 <b>{name}</b>\n\n"
        f"📦 Tổng: <b>{total}</b>  ✅ Đã mở: <b>{opened}</b>  ⬜ Còn: <b>{total - opened}</b>\n"
    )
    if max_p > 1:
        msg += f"🎯 Bạn đã chọn: <b>{u_picks}/{max_p}</b> ô\n"
    if extra:
        msg += f"\n{extra}"
    else:
        msg += "\nChọn một ô để mở:"
    return msg

async def _apply_gift_box_reward(user, prize: dict | None) -> str:
    """Apply the prize and return a short confirmation string."""
    if not prize or prize.get("type") == "lucky":
        return ""
    ptype = prize.get("type", "custom")
    label = prize.get("label", "")
    value = prize.get("value", "")

    if ptype == "points":
        try:
            pts = int(value)
            db.add_gift_box_reward(user.id, "points", pts)
            return f"✅ Đã cộng <b>{pts} điểm</b> vào tài khoản."
        except Exception:
            return ""
    elif ptype == "balance":
        try:
            amt = float(value)
            db.add_gift_box_reward(user.id, "balance", amt)
            return f"✅ Đã cộng <b>{label or value}</b> vào ví."
        except Exception:
            return ""
    elif ptype == "voucher":
        code = "VCH" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8))
        db.add_voucher(user.id, code, label, value)
        return f"🎟 Mã voucher: <code>{code}</code>\n(Lưu lại để dùng khi thanh toán)"
    elif ptype == "warranty":
        try:
            days = int(value)
            return f"🛡 Bạn nhận <b>gia hạn bảo hành {days} ngày</b>.\nLiên hệ hỗ trợ để áp dụng."
        except Exception:
            return ""
    elif ptype == "account":
        acc = db.pop_account()
        if acc:
            db.mark_account_distributed(acc.get("email", ""), user.id)
            info = f"📧 <code>{acc.get('email','')}</code> / 🔑 <code>{acc.get('password','')}</code>"
            if acc.get("note"):
                info += f"\n📝 {acc.get('note')}"
            return f"🎉 Tài khoản của bạn:\n{info}"
        return "⚠️ Kho tài khoản tạm hết. Vui lòng nhắn hỗ trợ để nhận thưởng."
    elif ptype == "spin":
        try:
            n = int(value)
            return f"🎰 Bạn nhận <b>{n} lượt quay</b>. Sẽ được cập nhật sớm!"
        except Exception:
            return ""
    return ""

def _parse_event_dt(s: str) -> datetime:
    """Parse ISO-8601 string (with or without Z / offset) as a naive UTC datetime."""
    s = s.strip()
    # Remove trailing Z or +00:00 offset so fromisoformat works on Python 3.8–3.10
    if s.endswith("Z"):
        s = s[:-1]
    elif s.endswith("+00:00"):
        s = s[:-6]
    # Trim milliseconds to 6 digits max (fromisoformat limit)
    if "." in s:
        head, frac = s.rsplit(".", 1)
        s = f"{head}.{frac[:6]}"
    return datetime.fromisoformat(s)

def _get_active_gift_box_event() -> dict | None:
    """Return the first enabled gift box event whose time window is currently active."""
    now_utc = datetime.utcnow()          # naive UTC — matches stored ISO strings
    for ev in db.get_gift_boxes():
        if not ev.get("enabled"):
            continue
        s = (ev.get("startTime") or "").strip()
        e = (ev.get("endTime")   or "").strip()
        if s:
            try:
                if now_utc < _parse_event_dt(s):
                    continue             # chưa đến giờ bắt đầu
            except Exception:
                continue                 # thời gian không hợp lệ → bỏ qua event
        if e:
            try:
                if now_utc > _parse_event_dt(e):
                    continue             # đã hết hạn
            except Exception:
                continue
        return ev
    return None

async def handle_gift_box(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user   = update.effective_user
    active = _get_active_gift_box_event()

    if not active:
        await update.message.reply_text(
            "⏰ Hiện tại không có sự kiện Ô Quà Bí Mật nào.\n\nHãy theo dõi bot để không bỏ lỡ! 🍀",
            reply_markup=main_keyboard(user.id),
        )
        return

    if active.get("membersOnly"):
        ud = db.get_user(user.id)
        if not (ud and ud.get("has_received_gift")):
            await update.message.reply_text(
                "❌ Sự kiện này chỉ dành cho thành viên đã nhận quà.",
                reply_markup=main_keyboard(user.id),
            )
            return

    if active.get("buyersOnly"):
        orders  = db.get_orders()
        uid_str = str(user.id)
        has_order = any(
            str(o.get("userId") or o.get("user_id") or "") == uid_str
            for o in orders.values()
        )
        if not has_order:
            await update.message.reply_text(
                "❌ Sự kiện này chỉ dành cho khách hàng đã mua hàng.",
                reply_markup=main_keyboard(user.id),
            )
            return

    eid = active["id"]

    # ── Already played? ───────────────────────────────────────────────────
    boxes     = active.get("boxes", [])
    max_picks = int(active.get("maxPicksPerUser", 1))
    u_picks   = sum(1 for b in boxes if b.get("openedBy") == user.id)
    if u_picks >= max_picks:
        msg = _gift_box_header(active, user.id, extra="✅ Bạn đã tham gia sự kiện này.")
        kb  = _gift_box_grid_keyboard(active, user.id)
        await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=kb)
        return

    # ── Unlocked — show "Nhận quà ngay" CTA ──────────────────────────────
    ev_name = active.get("name", "Ô Quà Bí Mật")
    total   = len(boxes)
    msg = (
        f"🎁 <b>{ev_name}</b>\n\n"
        f"🎉 Ô Quà Bí Mật đã được mở khóa!\n\n"
        f"📦 Tổng: <b>{total}</b> ô — Bạn được chọn <b>1</b> ô.\n"
        f"Bấm nút bên dưới để bắt đầu! 👇"
    )
    kb = InlineKeyboardMarkup([[
        InlineKeyboardButton("🎁 Nhận quà ngay", callback_data=f"gbox_open:{eid}")
    ]])
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML, reply_markup=kb)

async def callback_gift_box(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query  = update.callback_query
    user   = query.from_user
    data   = query.data  # e.g. "gbox_open:eid", "gbox_check:eid", "gbox_view:eid:idx", "gbox:eid:idx"
    parts  = data.split(":")
    action = parts[0]  # gbox_open | gbox_check | gbox_view | gbox
    eid    = parts[1] if len(parts) > 1 else ""

    # ── gbox_open — show the grid ─────────────────────────────────────────
    if action == "gbox_open":
        await query.answer()
        active = _get_active_gift_box_event()
        if not active or active["id"] != eid:
            try:
                await query.edit_message_text("❌ Sự kiện đã kết thúc.", parse_mode=ParseMode.HTML)
            except Exception:
                pass
            return
        msg = _gift_box_header(active, user.id)
        kb  = _gift_box_grid_keyboard(active, user.id)
        try:
            await query.edit_message_text(msg, parse_mode=ParseMode.HTML, reply_markup=kb)
        except Exception:
            pass
        return

    # ── gbox_view — peek at an already-opened box ─────────────────────────
    if action == "gbox_view":
        idx    = int(parts[2]) if len(parts) > 2 else 0
        events = db.get_gift_boxes()
        ev     = next((e for e in events if e["id"] == eid), None)
        if not ev:
            await query.answer("Sự kiện không tồn tại!", show_alert=True)
            return
        boxes  = ev.get("boxes", [])
        if idx >= len(boxes):
            await query.answer("Ô không tồn tại!", show_alert=True)
            return
        box    = boxes[idx]
        prizes = {p["id"]: p for p in ev.get("prizes", [])}
        p      = prizes.get(box.get("prizeId"))
        opener = box.get("openedByName", "Ai đó")
        plabel = p.get("label", "Chúc may mắn") if p else "Chúc may mắn"
        await query.answer(f"Ô {idx+1}: {opener} — {plabel}", show_alert=True)
        return

    # ── gbox — open a box ─────────────────────────────────────────────────
    idx = int(parts[2]) if len(parts) > 2 else 0
    await query.answer()

    result = db.open_gift_box(eid, idx, user.id, user.username or "", user.first_name or "")
    status = result["status"]

    if status == "already_opened":
        await query.answer("❌ Ô này đã được mở rồi! Hãy chọn ô khác.", show_alert=True)
        ev = next((e for e in db.get_gift_boxes() if e["id"] == eid), None)
        if ev:
            try:
                await query.edit_message_reply_markup(_gift_box_grid_keyboard(ev, user.id))
            except Exception:
                pass
        return

    if status == "max_picks_reached":
        max_p = result.get("max", 1)
        await query.answer(f"⚠️ Bạn đã chọn đủ {max_p} ô rồi!", show_alert=True)
        return

    if status in ("event_ended", "not_found"):
        await query.answer("❌ Sự kiện đã kết thúc.", show_alert=True)
        return

    if status != "ok":
        await query.answer("❌ Có lỗi xảy ra. Vui lòng thử lại.", show_alert=True)
        return

    prize    = result.get("prize")
    event    = result["event"]
    is_lucky = not prize or prize.get("type") == "lucky"
    extra    = await _apply_gift_box_reward(user, prize)

    if is_lucky:
        result_txt = f"😄 <b>Ô {idx+1}</b>: Chúc may mắn!\n\nHẹn gặp lại sự kiện sau. 🍀"
    else:
        plabel     = prize.get("label", "Phần thưởng bí mật")
        result_txt = (
            f"🎉 <b>Ô {idx+1}</b>: Chúc mừng!\n"
            f"Bạn nhận được: <b>🎁 {plabel}</b>"
            + (f"\n\n{extra}" if extra else "")
        )

    msg = _gift_box_header(event, user.id, extra=result_txt)
    kb  = _gift_box_grid_keyboard(event, user.id)
    try:
        await query.edit_message_text(msg, parse_mode=ParseMode.HTML, reply_markup=kb)
    except Exception:
        pass

    plabel_log = prize.get("label", "lucky") if prize else "lucky"
    db.add_log("GIFT_BOX_OPEN", f"user={user.id} event={eid} box={idx} prize={plabel_log}", str(user.id))

# ─── Secret code handler ──────────────────────────────────────────────────────

async def _process_secret_code(update: Update, context: ContextTypes.DEFAULT_TYPE, code_str: str) -> bool:
    """Try to redeem a secret code. Returns True if the text was a known code (good or bad result).
    Returns False if the text doesn't match any code at all (let caller handle it)."""
    user = update.effective_user
    # Only check if there are enabled codes to avoid file hit for every message
    codes = db.get_secret_codes()
    active = [c for c in codes if c.get("enabled")]
    if not active:
        return False

    code_upper = code_str.strip().upper()
    matched_cfg = next((c for c in active if c.get("code", "").strip().upper() == code_upper), None)
    if not matched_cfg:
        return False  # Not a known code — let menu_router handle normally

    # Members-only gate
    if matched_cfg.get("membersOnly", False):
        udata = db.get_user(str(user.id)) or db.get_user(user.id)
        if not (udata and udata.get("has_received_gift")):
            msg = matched_cfg.get("invalidMessage") or "❌ Mã không hợp lệ. Vui lòng kiểm tra lại."
            await update.message.reply_text(msg)
            return True

    result = db.validate_secret_code(code_str, user.id, user.username or "", user.first_name or "")
    status = result["status"]
    code = result.get("code", matched_cfg)

    if status == "ok":
        reward = code.get("reward", {})
        reward_label = (reward.get("label") or reward.get("value") or "Phần thưởng đặc biệt").strip()
        win_msg = (code.get("winMessage") or "🎉 Chúc mừng! Bạn nhận được:\n🎁 {reward}")
        await update.message.reply_text(win_msg.replace("{reward}", reward_label))
        db.add_log("SECRET_CODE_WIN", f"user={user.id} username={user.username} code={code_str.upper()}", str(user.id))
        logger.info(f"Secret code redeemed: user={user.id} code={code_str.upper()}")
    elif status == "exhausted":
        msg = code.get("exhaustedMessage") or "😔 Mã đã hết lượt nhận."
        await update.message.reply_text(msg)
    elif status == "already_claimed":
        await update.message.reply_text("⚠️ Bạn đã nhận phần thưởng từ mã này rồi!")
    elif status in ("expired", "not_started", "disabled"):
        msg = code.get("invalidMessage") or "❌ Mã không hợp lệ. Vui lòng kiểm tra lại."
        await update.message.reply_text(msg)
    # "not_found" won't reach here (we checked matched_cfg above)

    return True

async def cmd_code(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /code ABC123 command."""
    args = context.args
    if not args:
        await update.message.reply_text(
            "Vui lòng nhập mã sau lệnh <code>/code</code>\nVí dụ: <code>/code ABC123</code>",
            parse_mode=ParseMode.HTML,
        )
        return
    code_str = args[0].strip()
    handled = await _process_secret_code(update, context, code_str)
    if not handled:
        await update.message.reply_text("❌ Mã không hợp lệ. Vui lòng kiểm tra lại.")

# ─── Broadcast worker ─────────────────────────────────────────────────────────

def _tg_send(token: str, chat_id: int, text: str) -> int | None:
    """Send plain-text message; returns message_id on success, None on failure."""
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                body = _json.loads(resp.read())
                return body.get("result", {}).get("message_id")
    except Exception:
        pass
    return None

def _tg_send_checkin(token: str, chat_id: int, text: str, btn_label: str) -> bool:
    """Send a message with a single inline [Điểm danh] button."""
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": [[{"text": btn_label, "callback_data": "checkin"}]]},
        }).encode()
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

                # ── Điểm danh hằng ngày ──────────────────────────────────────
                if target == "checkin_notify":
                    ci_settings = db.get_checkin_settings()
                    pts = int(ci_settings.get("points_per_day", 10))
                    today_str = datetime.now().strftime("%d/%m/%Y")
                    today_key = datetime.now().strftime("%Y-%m-%d")
                    sent = 0; failed = 0
                    for uid_str, udata in users.items():
                        ul = udata.get("lang") or "vi"
                        rec = db.get_checkin_record(int(uid_str))
                        streak = rec.get("streak", 0)
                        if ul == "vi":
                            streak_line = f"\n🔥 Chuỗi hiện tại: <b>{streak} ngày</b>" if streak > 0 else ""
                            msg = (
                                f"🎯 <b>Điểm danh hôm nay!</b>\n\n"
                                f"📅 {today_str}"
                                f"{streak_line}\n"
                                f"💎 Nhận <b>+{pts} điểm</b> mỗi ngày điểm danh\n\n"
                                f"👇 Bấm nút bên dưới để điểm danh:"
                            )
                            btn = "✅ Điểm danh ngay"
                        else:
                            streak_line = f"\n🔥 Current streak: <b>{streak} days</b>" if streak > 0 else ""
                            msg = (
                                f"🎯 <b>Daily check-in!</b>\n\n"
                                f"📅 {today_str}"
                                f"{streak_line}\n"
                                f"💎 Earn <b>+{pts} points</b> per day\n\n"
                                f"👇 Tap the button below to check in:"
                            )
                            btn = "✅ Check in now"
                        if _tg_send_checkin(TOKEN, int(uid_str), msg, btn):
                            sent += 1
                        else:
                            failed += 1
                    db.update_checkin_log_sent(today_key, sent, failed)
                    db.add_log("CHECKIN_BROADCAST", f"sent={sent} failed={failed}", "scheduler")
                    logger.info(f"[checkin] Notification sent={sent} failed={failed}")
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

# ─── Market order daily scheduler ────────────────────────────────────────────

def market_order_scheduler_worker():
    """
    Chạy đồng bộ "Đơn hàng chợ" một lần mỗi ngày.
    Giờ chạy mặc định: 03:00 (Asia/Ho_Chi_Minh).
    Có thể ghi đè qua data/sync_robot_config.json:
      "market_sync_hour": 3, "market_sync_minute": 0
    Hoàn toàn độc lập — lỗi không ảnh hưởng các worker khác.
    """
    import time as _time
    _last_run_date = None

    while True:
        _time.sleep(60)
        try:
            from pathlib import Path as _Path
            import json as _json

            data_dir = _Path(os.environ.get("DATA_DIR",
                             _Path(__file__).parent / "data"))
            cfg_file = data_dir / "sync_robot_config.json"
            cfg: dict = {}
            if cfg_file.exists():
                try:
                    cfg = _json.loads(cfg_file.read_text("utf-8"))
                except Exception:
                    pass

            if not cfg:
                continue   # chưa cấu hình → bỏ qua

            target_hour   = int(cfg.get("market_sync_hour",   3))
            target_minute = int(cfg.get("market_sync_minute", 0))

            try:
                from zoneinfo import ZoneInfo
                now_tz = datetime.now(tz=ZoneInfo("Asia/Ho_Chi_Minh"))
            except Exception:
                from datetime import timezone, timedelta
                now_tz = datetime.now(timezone.utc) + timedelta(hours=7)
                now_tz = now_tz.replace(tzinfo=None)

            today = now_tz.date()

            if (now_tz.hour == target_hour
                    and now_tz.minute == target_minute
                    and _last_run_date != today):
                _last_run_date = today
                logger.info("[market-scheduler] Bắt đầu đồng bộ Đơn hàng chợ định kỳ")
                try:
                    from market_order_sync import sync_market_orders
                    res = sync_market_orders(config=cfg)
                    logger.info(f"[market-scheduler] Kết quả: {res.get('message','')}")
                except Exception as ex:
                    logger.error(f"[market-scheduler] Lỗi sync: {ex}")

        except Exception as e:
            logger.error(f"[market-scheduler] Vòng lặp lỗi: {e}")


# ─── Check-in scheduler ───────────────────────────────────────────────────────

def checkin_scheduler_worker():
    """
    Runs every 60 s. At the configured hour:minute (in the configured timezone),
    automatically queues the daily check-in notification if not already sent today.
    """
    while True:
        time.sleep(60)
        try:
            settings = db.get_checkin_settings()
            if not settings.get("enabled", True):
                continue
            tz_name     = settings.get("timezone", "Asia/Ho_Chi_Minh")
            target_hour = int(settings.get("hour",   7))
            target_min  = int(settings.get("minute", 0))

            try:
                from zoneinfo import ZoneInfo
                now_tz = datetime.now(tz=ZoneInfo(tz_name))
            except Exception:
                # Fallback: UTC+7 for Asia/Ho_Chi_Minh
                now_tz = datetime.utcnow() + timedelta(hours=7)

            if now_tz.hour == target_hour and now_tz.minute == target_min:
                if not db.was_checkin_notif_sent_today(tz_name):
                    db.mark_checkin_triggered(tz_name)   # prevent double-fire
                    db.queue_broadcast("__CHECKIN_NOTIFICATION__", "checkin_notify")
                    logger.info(f"[checkin] Scheduled notification queued at {now_tz.strftime('%H:%M')} {tz_name}")
        except Exception as e:
            logger.error(f"Checkin scheduler error: {e}")

# ─── Check-in callback ────────────────────────────────────────────────────────

async def callback_checkin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """User taps [Điểm danh ngay] button in the daily notification."""
    query = update.callback_query
    await query.answer()
    user = query.from_user
    L    = lang(user.id)
    vi   = L == "vi"

    result = db.do_checkin(user.id)

    if result.get("already"):
        streak = result.get("streak", 0)
        total  = result.get("total_points", 0)
        msg = (
            f"⚠️ <b>Bạn đã điểm danh hôm nay rồi!</b>\n\n"
            f"🔥 Chuỗi: {streak} ngày\n"
            f"💰 Tổng điểm: {total}"
        ) if vi else (
            f"⚠️ <b>You've already checked in today!</b>\n\n"
            f"🔥 Streak: {streak} days\n"
            f"💰 Total points: {total}"
        )
    else:
        pts    = result.get("points", 0)
        bonus  = result.get("bonus",  0)
        streak = result.get("streak", 0)
        total  = result.get("total_points", 0)
        if vi:
            bonus_line = f"\n🎉 Bonus chuỗi {streak} ngày: <b>+{bonus} điểm</b>!" if bonus else ""
            msg = (
                f"✅ <b>Điểm danh thành công!</b>\n\n"
                f"💎 +{pts} điểm{bonus_line}\n"
                f"🔥 Chuỗi: {streak} ngày\n"
                f"💰 Tổng điểm: {total}"
            )
        else:
            bonus_line = f"\n🎉 {streak}-day streak bonus: <b>+{bonus} points</b>!" if bonus else ""
            msg = (
                f"✅ <b>Check-in successful!</b>\n\n"
                f"💎 +{pts} points{bonus_line}\n"
                f"🔥 Streak: {streak} days\n"
                f"💰 Total points: {total}"
            )

    try:
        await query.edit_message_text(msg, parse_mode=ParseMode.HTML)
    except Exception:
        await context.bot.send_message(user.id, msg, parse_mode=ParseMode.HTML)

# ─── Flask keep-alive ─────────────────────────────────────────────────────────

flask_app = Flask(__name__)

@flask_app.route("/")
def home():
    return "Bot Quà Tặng AI is running ✅"

@flask_app.route("/health")
def health():
    return jsonify({"status": "ok", "stock": db.stock_count()})

# ─── 🔓 Unlock Delivery — khách bấm nút mở khoá tài khoản ────────────────────

async def callback_unlock_delivery(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Khách bấm nút '🔓 Mở khoá' để nhận thông tin tài khoản."""
    query = update.callback_query
    user  = query.from_user
    L     = lang(user.id)
    vi    = L == "vi"

    order_id = query.data[len("unlock_del:"):]

    # Bảo mật: chỉ đúng khách hàng mới mở được
    dr = db.get_delivery_request_by_order(order_id)
    if not dr or str(dr.get("userId")) != str(user.id):
        await query.answer(
            "⚠️ Không tìm thấy đơn hàng hoặc bạn không có quyền mở khoá." if vi
            else "⚠️ Order not found or you don't have permission to unlock.",
            show_alert=True,
        )
        return

    # Lấy tất cả manual_delivery items
    all_items = db.get_order_items(order_id)
    manual_items = [it for it in all_items if it.get("source") == "manual_delivery" or it.get("email")]

    # Nếu đã unlock hết rồi → hiện lại thông tin (không cần unlock lại)
    if manual_items and all(it.get("unlocked") for it in manual_items):
        unlocked_items = manual_items
    else:
        unlocked_items = db.unlock_delivery_order(order_id)
        if not unlocked_items:
            await query.answer(
                "❌ Không tìm thấy tài khoản cho đơn hàng này." if vi
                else "❌ No account found for this order.",
                show_alert=True,
            )
            return

    await query.answer()

    product = (unlocked_items[0].get("productName") if unlocked_items else None) or dr.get("productName") or ""
    w_end   = (unlocked_items[0].get("warranty_end_date") if unlocked_items else None) or ""

    def _format_item(item: dict, idx: int, total: int, vi: bool) -> list[str]:
        """Render one delivered item dựa vào delivery_type."""
        val      = item.get("email") or item.get("original_account") or ""
        password = item.get("password") or ""
        twofa    = item.get("twoFA") or ""
        dtype    = item.get("delivery_type", "account")
        out: list[str] = []
        if total > 1:
            out.append(f"\n<b>{'Tài khoản' if vi else 'Account'} {idx}:</b>")
        else:
            out.append("")
        if dtype == "key":
            out.append(f"🔑 {'Key' if vi else 'License Key'}: <code>{val}</code>")
        elif dtype == "link":
            out.append(f"🔗 Link: {val}")
        else:
            out.append(f"📧 {'Tài khoản' if vi else 'Account'}: <code>{val}</code>")
            out.append(f"🔒 {'Mật khẩu' if vi else 'Password'}: <code>{password}</code>")
            if twofa:
                out.append(f"🛡 2FA: <code>{twofa}</code>")
        return out

    if vi:
        lines = [
            f"✅ <b>Tài khoản của bạn</b>",
            f"📦 Mã đơn: <code>{order_id}</code>",
        ]
        if product:
            lines.append(f"🛍 Sản phẩm: <b>{product}</b>")
        if w_end:
            lines.append(f"🛡 Bảo hành đến: <b>{w_end}</b>")
        for idx, item in enumerate(unlocked_items, 1):
            lines.extend(_format_item(item, idx, len(unlocked_items), True))
    else:
        lines = [
            f"✅ <b>Your Account{'s' if len(unlocked_items) > 1 else ''}</b>",
            f"📦 Order: <code>{order_id}</code>",
        ]
        if product:
            lines.append(f"🛍 Product: <b>{product}</b>")
        if w_end:
            lines.append(f"🛡 Warranty until: <b>{w_end}</b>")
        for idx, item in enumerate(unlocked_items, 1):
            lines.extend(_format_item(item, idx, len(unlocked_items), False))

    try:
        await query.edit_message_text(
            "\n".join(lines),
            parse_mode=ParseMode.HTML,
        )
    except Exception:
        # Nếu edit thất bại (message quá cũ) thì gửi message mới
        await query.message.reply_text(
            "\n".join(lines),
            parse_mode=ParseMode.HTML,
        )

def run_flask():
    flask_app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)

# ─── Main ─────────────────────────────────────────────────────────────────────

async def callback_support_transfer_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin bấm nút 'Chuyển phiên' → hiện danh sách admin phụ để chọn (2-step)."""
    query = update.callback_query
    await query.answer()

    try:
        _, uid_str = query.data.split(":", 1)
    except Exception:
        return

    data = _load_chat_sessions()
    if uid_str not in data.get("sessions", {}):
        await query.answer("❌ Phiên đã kết thúc", show_alert=True)
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except Exception:
            pass
        return

    select_markup = _build_transfer_select_markup(uid_str)
    try:
        await query.edit_message_reply_markup(reply_markup=select_markup)
    except Exception:
        pass


async def callback_support_transfer_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin bấm Huỷ trong menu chọn admin → quay lại nút đơn."""
    query = update.callback_query
    await query.answer()

    try:
        _, uid_str = query.data.split(":", 1)
    except Exception:
        return

    restore_markup = _build_transfer_markup(uid_str)
    try:
        await query.edit_message_reply_markup(reply_markup=restore_markup)
    except Exception:
        pass


async def callback_support_transfer(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin A chọn admin B → gửi yêu cầu Chấp nhận/Từ chối đến admin B."""
    query = update.callback_query
    await query.answer()

    try:
        _, uid_str, admin_id_str = query.data.split(":", 2)
        admin_id = int(admin_id_str)
    except Exception:
        return

    data = _load_chat_sessions()
    session = data["sessions"].get(uid_str)
    if not session or session.get("status") != "active":
        await query.answer("❌ Phiên đã kết thúc", show_alert=True)
        try:
            await query.edit_message_reply_markup(reply_markup=None)
        except Exception:
            pass
        return

    if session.get("assigned_admin_id") == admin_id:
        await query.answer("Admin này đang xử lý phiên rồi", show_alert=True)
        return

    if session.get("transfer_pending"):
        await query.answer("⏳ Đang chờ xác nhận từ admin khác", show_alert=True)
        return

    # Thông tin admin B
    sub_admins = _get_support_admins()
    admin_info = next((a for a in sub_admins if int(a.get("id", 0)) == admin_id), {})
    admin_name = admin_info.get("name") or f"Admin {admin_id}"

    # Lịch sử ẩn danh gửi kèm yêu cầu
    messages = session.get("messages", [])
    history_lines = []
    for m in messages[-10:]:
        prefix = "👤 Khách" if m.get("role") == "user" else "🎧 Support"
        history_lines.append(f"{prefix}: {m.get('text', '')}")
    history_text = "\n".join(history_lines) if history_lines else "(Chưa có tin nhắn)"

    req_msg = (
        f"📨 <b>Yêu cầu chuyển phiên chat</b>\n"
        f"──────────────\n"
        f"<b>Lịch sử ({len(messages)} tin):</b>\n{history_text}\n"
        f"──────────────\n"
        f"Bạn có muốn tiếp nhận phiên này không?"
    )
    accept_markup = InlineKeyboardMarkup([[
        InlineKeyboardButton("✅ Chấp nhận", callback_data=f"spt_ok:{uid_str}"),
        InlineKeyboardButton("❌ Từ chối",   callback_data=f"spt_no:{uid_str}"),
    ]])
    req_mid = _tg_send_markup(TOKEN, admin_id, req_msg, markup=accept_markup.to_dict())

    # Lưu pending transfer
    session["transfer_pending"] = {
        "to_admin_id":        admin_id,
        "to_admin_name":      admin_name,
        "admin_a_id":         query.from_user.id,
        "admin_a_chat_id":    query.message.chat_id,
        "admin_a_msg_id":     query.message.message_id,
        "request_msg_id":     req_mid,
    }
    _save_chat_sessions(data)

    # Cập nhật message admin A → đang chờ (nút mờ)
    try:
        await query.edit_message_reply_markup(reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton(f"⏳ Đang chờ {admin_name}...", callback_data="noop")
        ]]))
    except Exception:
        pass


async def callback_spt_ok(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin B chấp nhận tiếp nhận phiên chat."""
    query = update.callback_query
    await query.answer("✅ Bạn đã chấp nhận!")

    try:
        _, uid_str = query.data.split(":", 1)
    except Exception:
        return

    data = _load_chat_sessions()
    session = data["sessions"].get(uid_str)
    if not session:
        await query.answer("❌ Phiên đã kết thúc", show_alert=True)
        return

    pending = session.pop("transfer_pending", None)
    if not pending:
        await query.answer("⚠️ Không tìm thấy yêu cầu chuyển phiên", show_alert=True)
        return

    admin_id   = pending["to_admin_id"]
    admin_name = pending.get("to_admin_name", f"Admin {admin_id}")

    # Gán session
    session["assigned_admin_id"] = admin_id

    # Lịch sử đầy đủ cho admin B
    messages = session.get("messages", [])
    history_lines = []
    for m in messages[-20:]:
        prefix = "👤 Khách" if m.get("role") == "user" else "🎧 Support"
        history_lines.append(f"{prefix}: {m.get('text', '')}")
    history_text = "\n".join(history_lines) if history_lines else "(Chưa có tin nhắn)"

    # Cập nhật tin nhắn admin B → lịch sử + hướng dẫn
    history_notif = (
        f"✅ <b>Bạn đã tiếp nhận phiên chat này</b>\n"
        f"──────────────\n"
        f"<b>Lịch sử ({len(messages)} tin):</b>\n{history_text}\n"
        f"──────────────\n"
        f"<i>↩️ Reply bất kỳ tin từ khách bên dưới để trả lời họ.</i>"
    )
    try:
        await query.edit_message_text(history_notif, parse_mode=ParseMode.HTML, reply_markup=None)
    except Exception:
        pass

    # Cập nhật message admin A → ✅ xanh lá
    try:
        await context.bot.edit_message_reply_markup(
            chat_id=pending["admin_a_chat_id"],
            message_id=pending["admin_a_msg_id"],
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton(f"✅ {admin_name} Đã chấp nhận", callback_data="noop")
            ]])
        )
    except Exception:
        pass

    _save_chat_sessions(data)


async def callback_spt_no(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Admin B từ chối tiếp nhận phiên chat."""
    query = update.callback_query
    await query.answer("❌ Bạn đã từ chối.")

    try:
        _, uid_str = query.data.split(":", 1)
    except Exception:
        return

    data = _load_chat_sessions()
    session = data["sessions"].get(uid_str)
    if not session:
        return

    pending = session.pop("transfer_pending", None)
    if not pending:
        return

    admin_name = pending.get("to_admin_name", "Admin")

    # Cập nhật tin admin B → từ chối
    try:
        await query.edit_message_text("❌ Bạn đã từ chối phiên chat này.", reply_markup=None)
    except Exception:
        pass

    # Khôi phục danh sách chọn admin cho admin A
    restore_markup = _build_transfer_select_markup(uid_str)
    try:
        await context.bot.edit_message_reply_markup(
            chat_id=pending["admin_a_chat_id"],
            message_id=pending["admin_a_msg_id"],
            reply_markup=restore_markup,
        )
    except Exception:
        pass

    # Gửi thông báo riêng cho admin A
    if ADMIN_ID:
        _tg_send(TOKEN, ADMIN_ID, f"❌ <b>{admin_name}</b> đã từ chối. Chọn admin khác.")

    _save_chat_sessions(data)


def main():
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set. Exiting.")
        return

    Thread(target=run_flask, daemon=True).start()
    logger.info("Flask keep-alive started on port 5000.")

    Thread(target=broadcast_worker, daemon=True).start()
    logger.info("Broadcast worker started.")

    Thread(target=checkin_scheduler_worker, daemon=True).start()
    logger.info("Check-in scheduler started.")

    Thread(target=market_order_scheduler_worker, daemon=True).start()
    logger.info("Market order daily scheduler started.")

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

    Thread(target=delivery_reminder_worker, daemon=True).start()
    logger.info("Delivery reminder worker started.")

    # ── Set bot command menu via post_init (runs inside the async event loop) ──
    async def _set_commands(application) -> None:
        vi_cmds = [
            BotCommand("start",   "🚀 Bắt đầu / chọn ngôn ngữ"),
            BotCommand("support", "💬 Hỗ trợ & kiểm tra đơn hàng"),
            BotCommand("gift",    "🎁 Nhận quà miễn phí"),
            BotCommand("orders",  "📦 Kiểm tra đơn hàng"),
            BotCommand("myid",    "🆔 ID Telegram của bạn"),
            BotCommand("clean",   "🧹 Xoá tin nhắn rác & về trang chủ"),
        ]
        en_cmds = [
            BotCommand("start",   "🚀 Start / choose language"),
            BotCommand("support", "💬 Support & order lookup"),
            BotCommand("gift",    "🎁 Claim free gift"),
            BotCommand("orders",  "📦 Check your order"),
            BotCommand("myid",    "🆔 Your Telegram ID"),
            BotCommand("clean",   "🧹 Clear chat & go to home"),
        ]
        scope = BotCommandScopeAllPrivateChats()
        await application.bot.set_my_commands(vi_cmds, scope=scope)
        await application.bot.set_my_commands(en_cmds, scope=scope, language_code="en")

    app = Application.builder().token(TOKEN).post_init(_set_commands).build()

    # ── Global channel gate — chạy trước MỌI handler ─────────────────────────
    app.add_handler(TypeHandler(Update, channel_gate_middleware), group=-1)

    # ── Real-time: nhận update khi user rời/vào kênh bắt buộc ─────────────────
    app.add_handler(ChatMemberHandler(handle_chat_member_update, ChatMemberHandler.CHAT_MEMBER))

    # ── Register handlers ─────────────────────────────────────────────────────
    app.add_handler(CommandHandler("start",   cmd_start))
    app.add_handler(CommandHandler("clean",   cmd_clean))
    app.add_handler(CommandHandler("myid",    cmd_myid))
    app.add_handler(CommandHandler("support", cmd_support))
    app.add_handler(CommandHandler("gift",    cmd_gift))
    app.add_handler(CommandHandler("orders",  cmd_orders))
    app.add_handler(CommandHandler("order",   cmd_orders))   # alias
    app.add_handler(CommandHandler("code",    cmd_code))
    app.add_handler(CallbackQueryHandler(callback_lang,          pattern=r"^lang:"))
    app.add_handler(CallbackQueryHandler(callback_order,         pattern=r"^order:"))
    app.add_handler(CallbackQueryHandler(callback_warranty_ack,  pattern=r"^warranty_ack:"))
    app.add_handler(CallbackQueryHandler(callback_warranty_noop, pattern=r"^warranty_noop$"))
    app.add_handler(CallbackQueryHandler(callback_multi_warranty,  pattern=r"^mw:"))
    app.add_handler(CallbackQueryHandler(callback_check_join,          pattern=r"^check_join$"))
    app.add_handler(CallbackQueryHandler(callback_check_community_join, pattern=r"^check_community_join$"))
    app.add_handler(CallbackQueryHandler(callback_back_main,           pattern=r"^back_main$"))
    app.add_handler(CallbackQueryHandler(callback_gift_box,      pattern=r"^gbox[_:]"))
    app.add_handler(CallbackQueryHandler(callback_checkin,          pattern=r"^checkin$"))
    app.add_handler(CallbackQueryHandler(callback_unlock_delivery,  pattern=r"^unlock_del:"))
    app.add_handler(CallbackQueryHandler(callback_return_gift_init,    pattern=r"^return_gift_init$"))
    app.add_handler(CallbackQueryHandler(callback_return_gift_confirm, pattern=r"^return_gift_confirm$"))
    app.add_handler(CallbackQueryHandler(callback_return_gift_cancel,  pattern=r"^return_gift_cancel$"))
    app.add_handler(CallbackQueryHandler(callback_support_transfer_menu,   pattern=r"^spt_menu:"))
    app.add_handler(CallbackQueryHandler(callback_support_transfer_cancel, pattern=r"^spt_cancel:"))
    app.add_handler(CallbackQueryHandler(callback_spt_ok,                  pattern=r"^spt_ok:"))
    app.add_handler(CallbackQueryHandler(callback_spt_no,                  pattern=r"^spt_no:"))
    app.add_handler(CallbackQueryHandler(callback_support_transfer,        pattern=r"^spt:"))
    app.add_handler(MessageHandler(filters.PHOTO, handle_live_chat_media))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))
    app.add_handler(MessageHandler(filters.COMMAND, cmd_unknown))   # catch-all for unknown /commands

    Thread(target=_chat_timeout_worker, daemon=True).start()
    logger.info("Bot is polling...")
    app.run_polling(
        drop_pending_updates=True,
        allowed_updates=["message", "callback_query", "chat_member", "my_chat_member"],
    )

if __name__ == "__main__":
    main()
