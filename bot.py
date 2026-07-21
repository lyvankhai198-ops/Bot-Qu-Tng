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
from datetime import datetime, timedelta, date
from threading import Thread

from flask import Flask, jsonify
from telegram import (
    Update, ReplyKeyboardMarkup, InlineKeyboardMarkup, InlineKeyboardButton,
    BotCommand, BotCommandScopeAllPrivateChats,
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters,
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
        [t(L, "btn_gift_box"), t(L, "btn_intro")],
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
    welcome = t(L, "welcome_admin", name=user.first_name or "Admin") if is_admin(user.id) else t(L, "welcome", name=user.first_name or "User")
    await query.edit_message_text(f"{t(L, 'lang_chosen')}\n\n{welcome}", parse_mode=ParseMode.HTML)
    await context.bot.send_message(user.id, welcome, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))

async def cmd_myid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.message.reply_text(f"🆔 Your ID: <code>{update.effective_user.id}</code>", parse_mode=ParseMode.HTML)

async def cmd_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await handle_support(update, context)

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
MEMBERSHIP_CACHE_TTL_HOURS = db.MEMBERSHIP_CACHE_TTL_HOURS  # 6h default

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
        claim_time  = datetime.fromisoformat(claimed[uid]["claim_time"])
        eligible_at = claim_time + timedelta(hours=cooldown_h)
        if datetime.now() < eligible_at:
            rem = eligible_at - datetime.now()
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
    now_str      = datetime.now().isoformat()

    db.add_claim(round_id, user.id, user.username, user.first_name, email, now_str)
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
    """Bước 2: Nhận mã đơn, tạo yêu cầu, thông báo admin."""
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

    # Calculate first reminder time from settings
    reminder_cfg = db.get_delivery_reminder_settings()
    first_reminder_at: str | None = None
    if reminder_cfg.get("enabled") and reminder_cfg.get("reminderMinutes"):
        first_min = reminder_cfg["reminderMinutes"][0]
        first_reminder_at = (datetime.now() + timedelta(minutes=first_min)).isoformat()

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
        _tg_send(TOKEN, ADMIN_ID, msg)
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
        _item_ref  = matched_item.get("item_status") == "refunded" if matched_item else False
        _order_ref = order.get("status") == "refunded"
        if _item_ref or _order_ref:
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
              "btn_bao_loi", "btn_yeu_cau_giao"]

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

                    msg = (
                        f"🔔 <b>Nhắc giao tài khoản</b>\n\n"
                        f"Bạn còn một yêu cầu giao tài khoản chưa xử lý.\n\n"
                        f"📦 Mã đơn: <code>{req['orderId']}</code>\n"
                        f"👤 Người dùng: {uname}\n"
                        f"⏱ Thời gian chờ: {elapsed_min} phút\n\n"
                        f"➡️ Vào <b>Admin Panel → 📦 Giao tài khoản</b> để xử lý."
                    )
                    for aid in admin_ids:
                        _tg_send(TOKEN, aid, msg)

                    new_count = reminder_count + 1
                    update_fields: dict = {
                        "reminderCount": new_count,
                        "lastReminderAt": now_dt.isoformat(),
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

def _tg_send(token: str, chat_id: int, text: str) -> bool:
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({"chat_id": chat_id, "text": text, "parse_mode": "HTML"}).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False

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

    Thread(target=checkin_scheduler_worker, daemon=True).start()
    logger.info("Check-in scheduler started.")

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
        ]
        en_cmds = [
            BotCommand("start",   "🚀 Start / choose language"),
            BotCommand("support", "💬 Support & order lookup"),
            BotCommand("gift",    "🎁 Claim free gift"),
            BotCommand("orders",  "📦 Check your order"),
            BotCommand("myid",    "🆔 Your Telegram ID"),
        ]
        scope = BotCommandScopeAllPrivateChats()
        await application.bot.set_my_commands(vi_cmds, scope=scope)
        await application.bot.set_my_commands(en_cmds, scope=scope, language_code="en")

    app = Application.builder().token(TOKEN).post_init(_set_commands).build()

    # ── Register handlers ─────────────────────────────────────────────────────
    app.add_handler(CommandHandler("start",   cmd_start))
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
    app.add_handler(CallbackQueryHandler(callback_check_join,    pattern=r"^check_join$"))
    app.add_handler(CallbackQueryHandler(callback_back_main,     pattern=r"^back_main$"))
    app.add_handler(CallbackQueryHandler(callback_gift_box,      pattern=r"^gbox[_:]"))
    app.add_handler(CallbackQueryHandler(callback_checkin,       pattern=r"^checkin$"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))
    app.add_handler(MessageHandler(filters.COMMAND, cmd_unknown))   # catch-all for unknown /commands

    logger.info("Bot is polling...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
