
# bot.py — Bot Quà Tặng AI / AI Gift Bot
# Run with: python bot.py

import os
import re
import ast
import operator
import logging
import zipfile
import io
from datetime import datetime, timedelta
from threading import Thread

from flask import Flask
from telegram import (
    Update, ReplyKeyboardMarkup, InlineKeyboardMarkup, InlineKeyboardButton,
    ReplyKeyboardRemove,
)
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, ConversationHandler, filters,
)
from telegram.constants import ParseMode

import data_manager as db
from translations import t

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s — %(levelname)s — %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID = int(os.environ.get("ADMIN_ID", "0"))

# ─────────────────────────────────────────────────────────────────────────────
# Conversation states
# ─────────────────────────────────────────────────────────────────────────────
(
    STATE_ADD_ACCOUNTS,
    STATE_DEL_ACCOUNT,
    STATE_BROADCAST,
    STATE_NEW_ROUND,
    STATE_BAN,
    STATE_UNBAN,
    STATE_REFUND_PRICE,
    STATE_REFUND_TOTAL_DAYS,
    STATE_REFUND_USED_DAYS,
    STATE_EXPIRY_START,
    STATE_EXPIRY_DAYS,
    STATE_WARRANTY_CHECK,
    STATE_CALCULATOR,
) = range(13)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def lang(user_id: int) -> str:
    return db.get_user_lang(user_id) or "vi"


def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID


def main_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    if is_admin(user_id):
        rows = [
            [t(L, "btn_gift"), t(L, "btn_inventory")],
            [t(L, "btn_refund"), t(L, "btn_warranty")],
            [t(L, "btn_expiry"), t(L, "btn_check_warranty")],
            [t(L, "btn_calculator"), t(L, "btn_faq")],
            [t(L, "btn_notify"), t(L, "btn_shop")],
            [t(L, "btn_support"), t(L, "btn_admin")],
        ]
    else:
        rows = [
            [t(L, "btn_gift"), t(L, "btn_inventory")],
            [t(L, "btn_refund"), t(L, "btn_warranty")],
            [t(L, "btn_expiry"), t(L, "btn_check_warranty")],
            [t(L, "btn_calculator"), t(L, "btn_faq")],
            [t(L, "btn_notify"), t(L, "btn_shop")],
            [t(L, "btn_support")],
        ]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def admin_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    rows = [
        [t(L, "btn_add_account"), t(L, "btn_del_account")],
        [t(L, "btn_broadcast"), t(L, "btn_new_round")],
        [t(L, "btn_receivers"), t(L, "btn_stats")],
        [t(L, "btn_ban"), t(L, "btn_unban")],
        [t(L, "btn_settings"), t(L, "btn_backup")],
        [t(L, "btn_logs"), t(L, "btn_back")],
    ]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


def back_home_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup(
        [[t(L, "btn_back"), t(L, "btn_home")]],
        resize_keyboard=True,
    )


def lang_inline_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("🇻🇳 Tiếng Việt", callback_data="lang:vi"),
            InlineKeyboardButton("🇬🇧 English", callback_data="lang:en"),
        ]
    ])


def shop_inline_button(L: str, settings: dict) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[
        InlineKeyboardButton(t(L, "btn_open_shop"), url=settings["shop_link"])
    ]])


def safe_eval(expr: str) -> str:
    """Safely evaluate a math expression."""
    allowed_ops = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
    }

    def _eval(node):
        if isinstance(node, ast.Constant):
            return node.n
        elif isinstance(node, ast.BinOp):
            op_type = type(node.op)
            if op_type not in allowed_ops:
                raise ValueError("Unsupported operator")
            left = _eval(node.left)
            right = _eval(node.right)
            if op_type == ast.Div and right == 0:
                raise ZeroDivisionError
            return allowed_ops[op_type](left, right)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -_eval(node.operand)
        else:
            raise ValueError("Invalid expression")

    tree = ast.parse(expr.strip(), mode="eval")
    result = _eval(tree.body)
    if isinstance(result, float) and result == int(result):
        return str(int(result))
    if isinstance(result, float):
        return f"{result:.6g}"
    return str(result)


# ─────────────────────────────────────────────────────────────────────────────
# /start — Language selection
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    db.save_user(user.id, user.username, user.first_name)
    # Always show language picker on /start
    await update.message.reply_text(
        "🌐 <b>Chọn ngôn ngữ / Choose language</b>",
        parse_mode=ParseMode.HTML,
        reply_markup=lang_inline_keyboard(),
    )


async def callback_lang(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    user = query.from_user
    _, chosen = query.data.split(":")
    db.set_user_lang(user.id, chosen)

    L = chosen
    db.save_user(user.id, user.username, user.first_name)

    if is_admin(user.id):
        welcome = t(L, "welcome_admin", name=user.first_name or user.username or "Admin")
    else:
        welcome = t(L, "welcome", name=user.first_name or user.username or "User")

    await query.edit_message_text(
        f"{t(L, 'lang_chosen')}\n\n{welcome}",
        parse_mode=ParseMode.HTML,
    )
    await context.bot.send_message(
        chat_id=user.id,
        text=welcome,
        parse_mode=ParseMode.HTML,
        reply_markup=main_keyboard(user.id),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Menu routing (ReplyKeyboard text handler)
# ─────────────────────────────────────────────────────────────────────────────

async def menu_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    text = update.message.text.strip()
    L = lang(user.id)

    # --- Home / Back ---
    if text in (t("vi", "btn_home"), t("en", "btn_home")):
        await show_main_menu(update, context)
        return

    # --- Main menu ---
    if text in (t("vi", "btn_gift"), t("en", "btn_gift")):
        await handle_gift(update, context)
    elif text in (t("vi", "btn_inventory"), t("en", "btn_inventory")):
        await handle_inventory(update, context)
    elif text in (t("vi", "btn_rules"), t("en", "btn_rules")):
        await handle_rules(update, context)
    elif text in (t("vi", "btn_support"), t("en", "btn_support")):
        await handle_support(update, context)
    elif text in (t("vi", "btn_shop"), t("en", "btn_shop")):
        await handle_shop(update, context)
    elif text in (t("vi", "btn_refund"), t("en", "btn_refund")):
        await handle_refund_start(update, context)
    elif text in (t("vi", "btn_warranty"), t("en", "btn_warranty")):
        await handle_warranty(update, context)
    elif text in (t("vi", "btn_expiry"), t("en", "btn_expiry")):
        await handle_expiry_start(update, context)
    elif text in (t("vi", "btn_check_warranty"), t("en", "btn_check_warranty")):
        await handle_warranty_check_start(update, context)
    elif text in (t("vi", "btn_calculator"), t("en", "btn_calculator")):
        await handle_calc_start(update, context)
    elif text in (t("vi", "btn_faq"), t("en", "btn_faq")):
        await handle_faq(update, context)
    elif text in (t("vi", "btn_notify"), t("en", "btn_notify")):
        await handle_notifications(update, context)
    elif text in (t("vi", "btn_admin"), t("en", "btn_admin")):
        await handle_admin_menu(update, context)
    # --- Admin menu ---
    elif text in (t("vi", "btn_add_account"), t("en", "btn_add_account")):
        await admin_add_start(update, context)
    elif text in (t("vi", "btn_del_account"), t("en", "btn_del_account")):
        await admin_del_start(update, context)
    elif text in (t("vi", "btn_broadcast"), t("en", "btn_broadcast")):
        await admin_broadcast_start(update, context)
    elif text in (t("vi", "btn_new_round"), t("en", "btn_new_round")):
        await admin_new_round_start(update, context)
    elif text in (t("vi", "btn_receivers"), t("en", "btn_receivers")):
        await admin_receivers(update, context)
    elif text in (t("vi", "btn_stats"), t("en", "btn_stats")):
        await admin_stats(update, context)
    elif text in (t("vi", "btn_ban"), t("en", "btn_ban")):
        await admin_ban_start(update, context)
    elif text in (t("vi", "btn_unban"), t("en", "btn_unban")):
        await admin_unban_start(update, context)
    elif text in (t("vi", "btn_settings"), t("en", "btn_settings")):
        await admin_settings(update, context)
    elif text in (t("vi", "btn_backup"), t("en", "btn_backup")):
        await admin_backup(update, context)
    elif text in (t("vi", "btn_logs"), t("en", "btn_logs")):
        await admin_logs(update, context)
    elif text in (t("vi", "btn_back"), t("en", "btn_back")):
        # Back from admin panel → main menu
        await show_main_menu(update, context)
    else:
        # Check if in a conversation state
        state = db.get_user_state(user.id)
        cstate = state.get("conv_state")
        if cstate:
            await handle_conv_input(update, context, cstate)
        else:
            await update.message.reply_text(
                t(L, "unknown_cmd"),
                reply_markup=main_keyboard(user.id),
            )


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state", "refund_price", "refund_total_days",
                        "expiry_start", "calc_mode")
    if is_admin(user.id):
        msg = t(L, "welcome_admin", name=user.first_name or "Admin")
    else:
        msg = t(L, "welcome", name=user.first_name or "User")
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML,
                                    reply_markup=main_keyboard(user.id))


# ─────────────────────────────────────────────────────────────────────────────
# Gift / Claim
# ─────────────────────────────────────────────────────────────────────────────

async def handle_gift(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    round_id = settings["round_id"]
    cooldown_hours = settings["cooldown_hours"]

    if db.is_banned(user.id):
        await update.message.reply_text(t(L, "gift_banned"))
        return

    if db.stock_count() == 0:
        await update.message.reply_text(t(L, "gift_empty"))
        return

    claimed = db.get_claimed(round_id)
    uid = str(user.id)

    if uid in claimed:
        if cooldown_hours == 0:
            await update.message.reply_text(t(L, "gift_already_round"))
            return
        else:
            claim_time = datetime.fromisoformat(claimed[uid]["claim_time"])
            eligible_at = claim_time + timedelta(hours=cooldown_hours)
            now = datetime.now()
            if now < eligible_at:
                remaining = eligible_at - now
                h = int(remaining.total_seconds() // 3600)
                m = int((remaining.total_seconds() % 3600) // 60)
                await update.message.reply_text(t(L, "gift_already", h=h, m=m))
                return

    account = db.pop_account()
    if not account:
        await update.message.reply_text(t(L, "gift_empty"))
        return

    email = account.get("email", "")
    password = account.get("password", "")
    now_str = datetime.now().isoformat()

    db.add_claim(round_id, user.id, user.username, user.first_name, email, now_str)
    db.add_log("CLAIM_GIFT", f"@{user.username} ({user.id})", "")

    await update.message.reply_text(
        t(L, "gift_success", email=email, password=password),
        parse_mode=ParseMode.HTML,
        reply_markup=shop_inline_button(L, settings),
    )

    # Notify admin
    if ADMIN_ID:
        try:
            await context.bot.send_message(
                chat_id=ADMIN_ID,
                text=t(L, "gift_admin_notify",
                       username=user.username or user.first_name,
                       user_id=user.id,
                       email=email),
                parse_mode=ParseMode.HTML,
            )
        except Exception:
            pass


# ─────────────────────────────────────────────────────────────────────────────
# Inventory / Rules / Support / Shop
# ─────────────────────────────────────────────────────────────────────────────

async def handle_inventory(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    count = db.stock_count()
    if count == 0:
        msg = f"{t(L, 'inventory_title')}\n\n{t(L, 'inventory_empty')}"
    else:
        msg = f"{t(L, 'inventory_title')}\n\n{t(L, 'inventory_count', count=count)}"
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML)


async def handle_rules(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    L = lang(update.effective_user.id)
    await update.message.reply_text(t(L, "rules_text"), parse_mode=ParseMode.HTML)


async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    await update.message.reply_text(
        t(L, "support_text", support_username=settings["support_username"]),
        parse_mode=ParseMode.HTML,
    )


async def handle_shop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    await update.message.reply_text(
        f"🛍 {settings['shop_username']}",
        reply_markup=shop_inline_button(L, settings),
    )


async def handle_warranty(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    L = lang(update.effective_user.id)
    await update.message.reply_text(t(L, "warranty_text"), parse_mode=ParseMode.HTML)


async def handle_faq(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    L = lang(update.effective_user.id)
    await update.message.reply_text(t(L, "faq_text"), parse_mode=ParseMode.HTML)


async def handle_notifications(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    announcements = db.get_announcements()
    if not announcements:
        await update.message.reply_text(
            f"{t(L, 'notify_title')}\n\n{t(L, 'notify_none')}",
            parse_mode=ParseMode.HTML,
        )
        return
    lines = [t(L, "notify_title")]
    for ann in reversed(announcements[-10:]):
        lines.append(f"\n📌 <i>{ann['time']}</i>\n{ann['msg']}")
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


# ─────────────────────────────────────────────────────────────────────────────
# Refund Calculator  (multi-step via user_states)
# ─────────────────────────────────────────────────────────────────────────────

async def handle_refund_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "refund_price")
    await update.message.reply_text(
        t(L, "refund_ask_price"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_home_keyboard(user.id),
    )


async def handle_expiry_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "expiry_start")
    await update.message.reply_text(
        t(L, "expiry_ask_start"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_home_keyboard(user.id),
    )


async def handle_warranty_check_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "warranty_check")
    await update.message.reply_text(
        t(L, "warranty_check_ask"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_home_keyboard(user.id),
    )


async def handle_calc_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "calculator")
    await update.message.reply_text(
        t(L, "calc_prompt"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_home_keyboard(user.id),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Conversation input dispatcher
# ─────────────────────────────────────────────────────────────────────────────

async def handle_conv_input(update: Update, context: ContextTypes.DEFAULT_TYPE, cstate: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    text = update.message.text.strip()

    # Back / Home short-circuit
    if text in (t("vi", "btn_back"), t("en", "btn_back"),
                t("vi", "btn_home"), t("en", "btn_home")):
        db.clear_user_state(user.id, "conv_state", "refund_price", "refund_total_days",
                            "expiry_start")
        await show_main_menu(update, context)
        return

    if cstate == "refund_price":
        try:
            price = float(text.replace(",", "").replace(".", "").replace(" ", ""))
            db.set_user_state(user.id, "refund_price", price)
            db.set_user_state(user.id, "conv_state", "refund_total_days")
            await update.message.reply_text(t(L, "refund_ask_total_days"),
                                            parse_mode=ParseMode.HTML)
        except ValueError:
            await update.message.reply_text(t(L, "refund_invalid"))

    elif cstate == "refund_total_days":
        try:
            total_days = int(text.strip())
            db.set_user_state(user.id, "refund_total_days", total_days)
            db.set_user_state(user.id, "conv_state", "refund_used_days")
            await update.message.reply_text(t(L, "refund_ask_used_days"),
                                            parse_mode=ParseMode.HTML)
        except ValueError:
            await update.message.reply_text(t(L, "refund_invalid"))

    elif cstate == "refund_used_days":
        try:
            used_days = int(text.strip())
            state = db.get_user_state(user.id)
            price = state.get("refund_price", 0)
            total_days = state.get("refund_total_days", 1)
            if used_days > total_days:
                await update.message.reply_text(t(L, "refund_used_exceed"))
                return
            remaining = total_days - used_days
            refund = (price / total_days) * remaining if total_days > 0 else 0
            db.clear_user_state(user.id, "conv_state", "refund_price", "refund_total_days")
            recalc_kb = ReplyKeyboardMarkup(
                [[t(L, "btn_recalc"), t(L, "btn_home")]],
                resize_keyboard=True,
            )
            await update.message.reply_text(
                t(L, "refund_result", price=price, used_days=used_days,
                  remaining_days=remaining, refund=refund),
                parse_mode=ParseMode.HTML,
                reply_markup=recalc_kb,
            )
        except ValueError:
            await update.message.reply_text(t(L, "refund_invalid"))

    elif cstate == "expiry_start":
        try:
            start_date = datetime.strptime(text.strip(), "%d/%m/%Y")
            db.set_user_state(user.id, "expiry_start", text.strip())
            db.set_user_state(user.id, "conv_state", "expiry_days")
            await update.message.reply_text(t(L, "expiry_ask_days"),
                                            parse_mode=ParseMode.HTML)
        except ValueError:
            await update.message.reply_text(t(L, "expiry_invalid_date"))

    elif cstate == "expiry_days":
        try:
            days = int(text.strip())
            state = db.get_user_state(user.id)
            start_str = state.get("expiry_start", "")
            start_date = datetime.strptime(start_str, "%d/%m/%Y")
            end_date = start_date + timedelta(days=days)
            db.clear_user_state(user.id, "conv_state", "expiry_start")
            await update.message.reply_text(
                t(L, "expiry_result",
                  start=start_str,
                  days=days,
                  end=end_date.strftime("%d/%m/%Y")),
                parse_mode=ParseMode.HTML,
                reply_markup=back_home_keyboard(user.id),
            )
        except (ValueError, KeyError):
            await update.message.reply_text(t(L, "expiry_invalid_days"))

    elif cstate == "warranty_check":
        email = text.strip()
        record = db.find_claim_by_email(email)
        db.clear_user_state(user.id, "conv_state")
        if record:
            await update.message.reply_text(
                t(L, "warranty_check_found",
                  email=record["account_email"],
                  name=record.get("first_name", "N/A"),
                  claim_time=record.get("claim_time", "N/A")[:10],
                  round_id=record.get("round_id", "N/A")),
                parse_mode=ParseMode.HTML,
                reply_markup=main_keyboard(user.id),
            )
        else:
            await update.message.reply_text(
                t(L, "warranty_check_not_found"),
                reply_markup=main_keyboard(user.id),
            )

    elif cstate == "calculator":
        # Recalculate button
        if text in (t("vi", "btn_recalc"), t("en", "btn_recalc")):
            await update.message.reply_text(t(L, "calc_prompt"),
                                            parse_mode=ParseMode.HTML)
            return
        try:
            result = safe_eval(text)
            await update.message.reply_text(
                t(L, "calc_result", expr=text, result=result),
                parse_mode=ParseMode.HTML,
                reply_markup=ReplyKeyboardMarkup(
                    [[t(L, "btn_recalc"), t(L, "btn_home")]],
                    resize_keyboard=True,
                ),
            )
        except Exception:
            await update.message.reply_text(t(L, "calc_error"))

    # Admin conversation states
    elif cstate == "admin_add_accounts":
        await _admin_add_process(update, context, text)
    elif cstate == "admin_del_account":
        await _admin_del_process(update, context, text)
    elif cstate == "admin_broadcast":
        await _admin_broadcast_process(update, context, text)
    elif cstate == "admin_new_round":
        await _admin_new_round_process(update, context, text)
    elif cstate == "admin_ban":
        await _admin_ban_process(update, context, text)
    elif cstate == "admin_unban":
        await _admin_unban_process(update, context, text)


# ─────────────────────────────────────────────────────────────────────────────
# Admin menu
# ─────────────────────────────────────────────────────────────────────────────

def require_admin(func):
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE, *args, **kwargs):
        user = update.effective_user
        L = lang(user.id)
        if not is_admin(user.id):
            await update.message.reply_text(t(L, "admin_only"))
            return
        return await func(update, context, *args, **kwargs)
    wrapper.__name__ = func.__name__
    return wrapper


@require_admin
async def handle_admin_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    await update.message.reply_text(
        t(L, "admin_title"),
        parse_mode=ParseMode.HTML,
        reply_markup=admin_keyboard(user.id),
    )


@require_admin
async def admin_add_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_add_accounts")
    await update.message.reply_text(t(L, "admin_ask_add"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_add_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    lines = text.strip().splitlines()
    new_accounts = []
    invalid = 0
    for line in lines:
        line = line.strip()
        if ":" in line:
            parts = line.split(":", 1)
            if len(parts) == 2 and parts[0].strip() and parts[1].strip():
                new_accounts.append({"email": parts[0].strip(), "password": parts[1].strip()})
                continue
        invalid += 1

    added = db.add_accounts(new_accounts)
    db.add_log("ADD_ACCOUNTS", f"Added {added} accounts", f"Admin {user.id}")
    db.clear_user_state(user.id, "conv_state")

    msg = t(L, "admin_add_success", count=added)
    if invalid:
        msg += f"\n{t(L, 'admin_add_invalid', count=invalid)}"
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML,
                                    reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_del_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_del_account")
    await update.message.reply_text(t(L, "admin_ask_del"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_del_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    email = text.strip()
    db.clear_user_state(user.id, "conv_state")
    if db.delete_account(email):
        db.add_log("DEL_ACCOUNT", email, f"Admin {user.id}")
        await update.message.reply_text(t(L, "admin_del_success", email=email),
                                        parse_mode=ParseMode.HTML,
                                        reply_markup=admin_keyboard(user.id))
    else:
        await update.message.reply_text(t(L, "admin_del_not_found", email=email),
                                        parse_mode=ParseMode.HTML,
                                        reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_broadcast_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_broadcast")
    await update.message.reply_text(t(L, "admin_ask_broadcast"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_broadcast_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state")
    db.add_announcement(text)
    users = db.get_all_users()
    sent = 0
    for uid_str, udata in users.items():
        try:
            ul = db.get_user_lang(int(uid_str)) or "vi"
            await context.bot.send_message(
                chat_id=int(uid_str),
                text=t(ul, "admin_broadcast_msg", msg=text),
                parse_mode=ParseMode.HTML,
            )
            sent += 1
        except Exception:
            pass
    db.add_log("BROADCAST", f"Msg: {text[:50]}", f"Admin {user.id}")
    await update.message.reply_text(t(L, "admin_broadcast_sent", count=sent),
                                    parse_mode=ParseMode.HTML,
                                    reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_new_round_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_new_round")
    await update.message.reply_text(t(L, "admin_ask_new_round"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_new_round_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    new_round = text.strip()
    old_settings = db.get_settings()
    old_round = old_settings.get("round_id", "dot1")
    db.update_setting("round_id", new_round)
    db.reset_round_claims(old_round)
    db.clear_user_state(user.id, "conv_state")
    db.add_log("NEW_ROUND", new_round, f"Admin {user.id}")
    await update.message.reply_text(t(L, "admin_new_round_success", round_id=new_round),
                                    parse_mode=ParseMode.HTML,
                                    reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_receivers(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    claimed = db.get_claimed(settings["round_id"])
    title = t(L, "admin_receivers_title")
    if not claimed:
        await update.message.reply_text(
            f"{title}\n\n{t(L, 'admin_receivers_empty')}", parse_mode=ParseMode.HTML)
        return
    lines = [title, ""]
    for record in claimed.values():
        lines.append(t(L, "admin_receivers_row",
                       name=record.get("first_name", "N/A"),
                       username=record.get("username", "N/A"),
                       email=record.get("account_email", "N/A")))
    # Split into chunks if too long
    msg = "\n".join(lines)
    if len(msg) > 4000:
        msg = msg[:4000] + "\n..."
    await update.message.reply_text(msg, parse_mode=ParseMode.HTML)


@require_admin
async def admin_stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    claimed = db.get_claimed(settings["round_id"])
    await update.message.reply_text(
        t(L, "admin_stats_title",
          total_users=len(db.get_all_users()),
          claimed=len(claimed),
          stock=db.stock_count(),
          banned=db.banned_count(),
          round_id=settings["round_id"]),
        parse_mode=ParseMode.HTML,
    )


@require_admin
async def admin_ban_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_ban")
    await update.message.reply_text(t(L, "admin_ask_ban"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_ban_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state")
    try:
        target_id = int(text.strip())
        if db.ban_user(target_id):
            db.add_log("BAN", str(target_id), f"Admin {user.id}")
            await update.message.reply_text(t(L, "admin_ban_success", user_id=target_id),
                                            parse_mode=ParseMode.HTML,
                                            reply_markup=admin_keyboard(user.id))
        else:
            await update.message.reply_text(t(L, "admin_ban_already", user_id=target_id),
                                            parse_mode=ParseMode.HTML,
                                            reply_markup=admin_keyboard(user.id))
    except ValueError:
        await update.message.reply_text(t(L, "refund_invalid"), reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_unban_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "admin_unban")
    await update.message.reply_text(t(L, "admin_ask_unban"), parse_mode=ParseMode.HTML,
                                    reply_markup=back_home_keyboard(user.id))


async def _admin_unban_process(update: Update, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state")
    try:
        target_id = int(text.strip())
        if db.unban_user(target_id):
            db.add_log("UNBAN", str(target_id), f"Admin {user.id}")
            await update.message.reply_text(t(L, "admin_unban_success", user_id=target_id),
                                            parse_mode=ParseMode.HTML,
                                            reply_markup=admin_keyboard(user.id))
        else:
            await update.message.reply_text(t(L, "admin_unban_not_found", user_id=target_id),
                                            parse_mode=ParseMode.HTML,
                                            reply_markup=admin_keyboard(user.id))
    except ValueError:
        await update.message.reply_text(t(L, "refund_invalid"), reply_markup=admin_keyboard(user.id))


@require_admin
async def admin_settings(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    s = db.get_settings()
    await update.message.reply_text(
        t(L, "admin_settings_title", **s),
        parse_mode=ParseMode.HTML,
    )


@require_admin
async def admin_backup(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    await update.message.reply_text(t(L, "admin_backup_done"), parse_mode=ParseMode.HTML)
    # Create in-memory zip
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, path in db.FILES.items():
            if os.path.exists(path):
                zf.write(path, os.path.basename(path))
    buf.seek(0)
    filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    await context.bot.send_document(
        chat_id=user.id,
        document=buf,
        filename=filename,
        caption="💾 Backup data files",
    )


@require_admin
async def admin_logs(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    logs = db.get_logs(20)
    if not logs:
        await update.message.reply_text(
            f"{t(L, 'admin_logs_title')}\n\n{t(L, 'admin_logs_empty')}",
            parse_mode=ParseMode.HTML,
        )
        return
    lines = [t(L, "admin_logs_title"), ""]
    for log in reversed(logs):
        lines.append(t(L, "admin_logs_row",
                       time=log["time"][11:16],
                       action=log["action"],
                       user=log["user"]))
    await update.message.reply_text("\n".join(lines), parse_mode=ParseMode.HTML)


# ─────────────────────────────────────────────────────────────────────────────
# Admin commands (/setshop, /setsupport, /setcooldown, /myid)
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_setshop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    if not is_admin(user.id):
        await update.message.reply_text(t(L, "admin_only"))
        return
    if not context.args:
        await update.message.reply_text(t(L, "setting_invalid"))
        return
    value = context.args[0]
    db.update_setting("shop_link", value)
    await update.message.reply_text(t(L, "setting_updated", key="shop_link", value=value),
                                    parse_mode=ParseMode.HTML)


async def cmd_setsupport(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    if not is_admin(user.id):
        await update.message.reply_text(t(L, "admin_only"))
        return
    if not context.args:
        await update.message.reply_text(t(L, "setting_invalid"))
        return
    value = context.args[0]
    db.update_setting("support_username", value)
    await update.message.reply_text(t(L, "setting_updated", key="support_username", value=value),
                                    parse_mode=ParseMode.HTML)


async def cmd_setcooldown(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    if not is_admin(user.id):
        await update.message.reply_text(t(L, "admin_only"))
        return
    if not context.args:
        await update.message.reply_text(t(L, "setting_invalid"))
        return
    try:
        hours = int(context.args[0])
        db.update_setting("cooldown_hours", hours)
        await update.message.reply_text(t(L, "setting_updated", key="cooldown_hours", value=hours),
                                        parse_mode=ParseMode.HTML)
    except ValueError:
        await update.message.reply_text(t(L, "setting_invalid"))


async def cmd_myid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    await update.message.reply_text(f"🆔 Your ID: <code>{user.id}</code>",
                                    parse_mode=ParseMode.HTML)


# ─────────────────────────────────────────────────────────────────────────────
# Recalculate shortcut
# ─────────────────────────────────────────────────────────────────────────────

async def handle_recalc(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    state = db.get_user_state(user.id)
    cstate = state.get("conv_state", "")
    if cstate == "calculator":
        await update.message.reply_text(t(L, "calc_prompt"), parse_mode=ParseMode.HTML)
    else:
        # Restart refund calculator
        await handle_refund_start(update, context)


# ─────────────────────────────────────────────────────────────────────────────
# Flask keep-alive
# ─────────────────────────────────────────────────────────────────────────────

flask_app = Flask(__name__)

@flask_app.route("/")
def home():
    return "Bot Quà Tặng AI / AI Gift Bot is running ✅"

@flask_app.route("/health")
def health():
    return {"status": "ok", "stock": db.stock_count()}


def run_flask():
    flask_app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set. Exiting.")
        return

    # Start Flask in background
    flask_thread = Thread(target=run_flask, daemon=True)
    flask_thread.start()
    logger.info("Flask keep-alive started on port 8080.")

    app = Application.builder().token(TOKEN).build()

    # Commands
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("myid", cmd_myid))
    app.add_handler(CommandHandler("setshop", cmd_setshop))
    app.add_handler(CommandHandler("setsupport", cmd_setsupport))
    app.add_handler(CommandHandler("setcooldown", cmd_setcooldown))

    # Language callback
    app.add_handler(CallbackQueryHandler(callback_lang, pattern=r"^lang:"))

    # Recalculate button
    for lang_code in ("vi", "en"):
        app.add_handler(MessageHandler(
            filters.TEXT & filters.Regex(f"^{re.escape(t(lang_code, 'btn_recalc'))}$"),
            handle_recalc,
        ))

    # All text → router
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    logger.info("Bot is polling...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
