
# bot.py — Bot Quà Tặng AI / AI Gift Bot
# Simplified: 4 main buttons. All admin features managed via web panel.

import os
import logging
import time
import json as _json
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from threading import Thread

from flask import Flask, request, jsonify
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
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def lang(user_id: int) -> str:
    return db.get_user_lang(user_id) or "vi"


def is_admin(user_id: int) -> bool:
    return user_id == ADMIN_ID


def main_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    rows = [
        [t(L, "btn_support"), t(L, "btn_gift")],
        [t(L, "btn_check_order"), t(L, "btn_shop")],
    ]
    return ReplyKeyboardMarkup(rows, resize_keyboard=True)


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


def back_home_keyboard(user_id: int) -> ReplyKeyboardMarkup:
    L = lang(user_id)
    return ReplyKeyboardMarkup(
        [[t(L, "btn_home")]],
        resize_keyboard=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# /start — Language selection
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    db.save_user(user.id, user.username, user.first_name)
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
    db.save_user(user.id, user.username, user.first_name)

    L = chosen
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
# /myid
# ─────────────────────────────────────────────────────────────────────────────

async def cmd_myid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    await update.message.reply_text(
        f"🆔 Your ID: <code>{user.id}</code>",
        parse_mode=ParseMode.HTML,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Show main menu
# ─────────────────────────────────────────────────────────────────────────────

async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.clear_user_state(user.id, "conv_state")
    if is_admin(user.id):
        msg = t(L, "welcome_admin", name=user.first_name or "Admin")
    else:
        msg = t(L, "welcome", name=user.first_name or "User")
    await update.message.reply_text(
        msg, parse_mode=ParseMode.HTML, reply_markup=main_keyboard(user.id)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Button: 🎁 Nhận Quà / Receive Gift
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
# Button: 💬 Hỗ Trợ / Support
# ─────────────────────────────────────────────────────────────────────────────

async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    await update.message.reply_text(
        t(L, "support_text", support_username=settings["support_username"]),
        parse_mode=ParseMode.HTML,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Button: 🛍 Kênh Bán Hàng / Sales Channel
# ─────────────────────────────────────────────────────────────────────────────

async def handle_shop(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()
    await update.message.reply_text(
        f"🛍 {settings['shop_username']}",
        reply_markup=shop_inline_button(L, settings),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Button: 📦 Kiểm Tra Đơn Hàng / Check Order
# ─────────────────────────────────────────────────────────────────────────────

async def handle_check_order_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    db.set_user_state(user.id, "conv_state", "check_order")
    await update.message.reply_text(
        t(L, "check_order_ask"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_home_keyboard(user.id),
    )


async def handle_check_order_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    email = update.message.text.strip()
    db.clear_user_state(user.id, "conv_state")
    record = db.find_claim_by_email(email)
    if record:
        await update.message.reply_text(
            t(L, "check_order_found",
              email=record["account_email"],
              name=record.get("first_name", "N/A"),
              claim_time=record.get("claim_time", "N/A")[:10],
              round_id=record.get("round_id", "N/A")),
            parse_mode=ParseMode.HTML,
            reply_markup=main_keyboard(user.id),
        )
    else:
        await update.message.reply_text(
            t(L, "check_order_not_found"),
            reply_markup=main_keyboard(user.id),
        )


# ─────────────────────────────────────────────────────────────────────────────
# Menu router
# ─────────────────────────────────────────────────────────────────────────────

async def menu_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    text = update.message.text.strip()
    L = lang(user.id)

    # Home button
    if text in (t("vi", "btn_home"), t("en", "btn_home")):
        await show_main_menu(update, context)
        return

    # Support
    if text in (t("vi", "btn_support"), t("en", "btn_support")):
        await handle_support(update, context)

    # Gift / Receive
    elif text in (t("vi", "btn_gift"), t("en", "btn_gift")):
        await handle_gift(update, context)

    # Check order
    elif text in (t("vi", "btn_check_order"), t("en", "btn_check_order")):
        await handle_check_order_start(update, context)

    # Sales channel / Shop
    elif text in (t("vi", "btn_shop"), t("en", "btn_shop")):
        await handle_shop(update, context)

    else:
        # Check conversation state
        state = db.get_user_state(user.id)
        cstate = state.get("conv_state")
        if cstate == "check_order":
            await handle_check_order_input(update, context)
        else:
            await update.message.reply_text(
                t(L, "unknown_cmd"),
                reply_markup=main_keyboard(user.id),
            )


# ─────────────────────────────────────────────────────────────────────────────
# Broadcast queue — background thread polling every 30 seconds
# Uses Telegram Bot API directly (no PTB job queue needed)
# ─────────────────────────────────────────────────────────────────────────────

def _send_telegram_message(token: str, chat_id: int, text: str) -> bool:
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = _json.dumps({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        }).encode("utf-8")
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except Exception:
        return False


def broadcast_worker() -> None:
    """Runs in a daemon thread; polls pending_broadcasts.json every 30s."""
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
                if not message:
                    continue
                sent = 0
                for uid_str in users:
                    try:
                        ul = db.get_user_lang(int(uid_str)) or "vi"
                        full_msg = t(ul, "admin_broadcast_msg", msg=message)
                        if _send_telegram_message(TOKEN, int(uid_str), full_msg):
                            sent += 1
                    except Exception:
                        pass
                db.add_log("BROADCAST", f"Msg: {message[:50]} | Sent: {sent}", "web-admin")
                logger.info(f"Broadcast sent to {sent} users: {message[:40]}")
        except Exception as e:
            logger.error(f"Broadcast worker error: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Flask keep-alive (minimal — admin API is in Node.js api-server)
# ─────────────────────────────────────────────────────────────────────────────

flask_app = Flask(__name__)


@flask_app.route("/")
def home():
    return "Bot Quà Tặng AI is running ✅"


@flask_app.route("/health")
def health():
    return jsonify({"status": "ok", "stock": db.stock_count()})


def run_flask():
    flask_app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    if not TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set. Exiting.")
        return

    flask_thread = Thread(target=run_flask, daemon=True)
    flask_thread.start()
    logger.info("Flask keep-alive started on port 5000.")

    app = Application.builder().token(TOKEN).build()

    # Commands
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("myid", cmd_myid))

    # Language callback
    app.add_handler(CallbackQueryHandler(callback_lang, pattern=r"^lang:"))

    # All text → router
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    # Broadcast queue worker — background thread
    broadcast_thread = Thread(target=broadcast_worker, daemon=True)
    broadcast_thread.start()
    logger.info("Broadcast worker started.")

    logger.info("Bot is polling...")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
