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

async def handle_support(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    L = lang(user.id)
    settings = db.get_settings()

    if not settings.get("support_enabled", True):
        await update.message.reply_text(t(L, "support_disabled"))
        return

    db.set_user_state(user.id, "conv_state", "support_lookup")
    await update.message.reply_text(
        t(L, "support_ask"),
        parse_mode=ParseMode.HTML,
        reply_markup=back_keyboard(user.id),
    )

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

    db.add_warranty_request(user.id, user.username, user.first_name, order_id, email, description)
    db.add_log("WARRANTY_REQUEST", f"@{user.username} ({user.id}) | Order: {order_id}", "")
    db.clear_user_state(user.id, "conv_state")
    db.clear_user_state(user.id, "_report_order_id")

    await update.message.reply_text(
        t(L, "report_sent"),
        parse_mode=ParseMode.HTML,
        reply_markup=main_keyboard(user.id),
    )

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
        elif state == "report_issue":
            await handle_report_issue_input(update, context)
        else:
            await update.message.reply_text(t(L, "unknown_cmd"), reply_markup=main_keyboard(user.id))

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

    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("myid", cmd_myid))
    app.add_handler(CallbackQueryHandler(callback_lang,  pattern=r"^lang:"))
    app.add_handler(CallbackQueryHandler(callback_order, pattern=r"^order:"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, menu_router))

    logger.info("Bot is polling...")
    app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
