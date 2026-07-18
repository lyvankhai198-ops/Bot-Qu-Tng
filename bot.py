# bot.py — Bot Quà Tặng AI
# 5-button menu. All admin features managed via web panel.
# Support = order lookup + báo lỗi. No admin contact info exposed.

import os
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

def order_inline(L: str, order_id: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(t(L, "btn_report_issue"), callback_data=f"order:report:{order_id}"),
        InlineKeyboardButton(t(L, "btn_back_menu"),    callback_data="order:back"),
    ]])

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

def _fmt_order(L: str, order: dict, settings: dict) -> str:
    data = db.calc_order_display(order, settings)

    remaining = data.get("_remaining_days")
    warranty_ok = data.get("_warranty_ok")
    refund_amt = data.get("_refund_amount")

    if remaining is None:
        remaining_str = "N/A"
    elif remaining == 0:
        remaining_str = t(L, "expired")
    else:
        remaining_str = t(L, "days_left", n=remaining)

    if warranty_ok is None:
        warranty_str = "N/A"
    elif warranty_ok:
        warranty_str = t(L, "warranty_valid")
    else:
        warranty_str = t(L, "warranty_expired")

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

    return t(L, "order_display",
        order_id    = order.get("orderId", ""),
        email       = order.get("email", ""),
        product     = order.get("productName", ""),
        purchase    = (order.get("purchaseDate", "") or "")[:10],
        expiry      = (order.get("expiryDate", "") or "")[:10],
        remaining   = remaining_str,
        warranty_exp= (order.get("warrantyExpiry") or order.get("warrantyDate") or "")[:10] or "N/A",
        warranty    = warranty_str,
        price       = price_str,
        refund      = refund_str,
        status      = status_str,
    )

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

def _mw_compute_account(order: dict, settings: dict) -> dict:
    data = db.calc_order_display(order, settings)
    return {
        "orderId":     order.get("orderId", ""),
        "email":       order.get("email", ""),
        "productName": order.get("productName") or order.get("type") or "?",
        "warrantyOk":  data.get("_warranty_ok"),
        "daysLeft":    data.get("_remaining_days"),
    }

def _mw_summary_text(L: str, found: list, not_found: list, blocked: list) -> str:
    vi = L == "vi"
    total = len(found) + len(not_found) + len(blocked)
    lines = [
        f"📋 <b>{'KẾT QUẢ TRA CỨU' if vi else 'LOOKUP RESULTS'}</b>",
        f"{'Đã nhập' if vi else 'Entered'}: <b>{total}</b> {'tài khoản' if vi else 'account(s)'}",
    ]
    if found:
        lines.append(f"\n✅ <b>{'Tìm thấy' if vi else 'Found'} ({len(found)})</b>:")
        for i, a in enumerate(found, 1):
            wok = a.get("warrantyOk")
            days = a.get("daysLeft")
            if wok is True:
                w = f"✅ {'Còn BH' if vi else 'In warranty'} ({days} {'ngày' if vi else 'days'})" if days else f"✅ {'Còn BH' if vi else 'In warranty'}"
            elif wok is False:
                w = f"❌ {'Hết BH' if vi else 'Expired'}"
            else:
                w = "N/A"
            lines.append(f"  {i}. <code>{a['email']}</code> — {a.get('productName','?')} | {w}")
    if not_found:
        lines.append(f"\n❌ <b>{'Không tìm thấy' if vi else 'Not found'} ({len(not_found)})</b>:")
        for e in not_found:
            lines.append(f"  • <code>{e}</code>")
    if blocked:
        lines.append(f"\n⚠️ <b>{'Bỏ qua — đang có yêu cầu xử lý' if vi else 'Skipped — open request exists'} ({len(blocked)})</b>:")
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
    vi = L == "vi"
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(f"📋 {'Báo lỗi tất cả' if vi else 'Report all'} ({n})", callback_data="mw:all"),
        InlineKeyboardButton(f"🔘 {'Chọn cụ thể' if vi else 'Pick accounts'}", callback_data="mw:pick"),
    ], [
        InlineKeyboardButton(f"🔙 {'Quay lại' if vi else 'Back'}", callback_data="mw:back"),
    ]])

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

    for e in emails:
        order = db.find_order(e)
        if not order:
            not_found.append(e)
            continue
        em = order.get("email", e).lower()
        if em in open_emails:
            blocked.append(e)
            continue
        found.append(_mw_compute_account(order, settings))

    if not found:
        summary = _mw_summary_text(L, found, not_found, blocked)
        no_valid = "Không có tài khoản hợp lệ nào để báo lỗi." if L == "vi" else "No valid accounts to report."
        await update.message.reply_text(summary + "\n\n" + no_valid, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id))
        db.clear_user_state(user.id, "conv_state")
        return

    db.set_user_state(user.id, "_mw_found", _json.dumps(found, ensure_ascii=False))
    db.set_user_state(user.id, "_mw_not_found", _json.dumps(not_found, ensure_ascii=False))
    db.set_user_state(user.id, "_mw_sel", ",".join(str(i) for i in range(len(found))))
    db.clear_user_state(user.id, "conv_state")

    await update.message.reply_text(
        _mw_summary_text(L, found, not_found, blocked),
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
    query_text = update.message.text.strip()

    order = db.find_order(query_text)
    db.clear_user_state(user.id, "conv_state")

    if not order:
        await update.message.reply_text(
            t(L, "order_not_found"),
            parse_mode=ParseMode.HTML,
            reply_markup=main_keyboard(user.id),
        )
        return

    settings = db.get_settings()
    msg = _fmt_order(L, order, settings)
    db.set_user_state(user.id, "_report_order_id", order["orderId"])

    await update.message.reply_text(
        msg,
        parse_mode=ParseMode.HTML,
        reply_markup=order_inline(L, order["orderId"]),
    )

# ─── Báo lỗi input ────────────────────────────────────────────────────────────

async def handle_report_issue_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    description = update.message.text.strip()
    order_id = db.get_user_state(user.id).get("_report_order_id", "")

    order = db.get_order(order_id) if order_id else None
    email = order.get("email", "") if order else ""

    req_id = db.add_warranty_request(user.id, user.username, user.first_name, order_id, email, description, L)
    db.add_log("WARRANTY_REQUEST", f"@{user.username} ({user.id}) | Order: {order_id}", "")
    db.clear_user_state(user.id, "conv_state")
    db.clear_user_state(user.id, "_report_order_id")

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
        db.clear_user_state(user.id, "conv_state")
        db.clear_user_state(user.id, "_report_order_id")
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
    if locked:
        logger.info(f"Cleared {locked} stale reminderProcessing lock(s) on startup")
    if migrated:
        logger.info(f"Migrated {migrated} old warranty ticket(s) to new reminder schema (reminderEnabled=False)")

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
