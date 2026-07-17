
# data_manager.py — JSON file I/O with auto-create and corruption recovery

import json
import os
import shutil
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

DATA_DIR = "data"
FILES = {
    "accounts": os.path.join(DATA_DIR, "accounts.json"),
    "claimed_users": os.path.join(DATA_DIR, "claimed_users.json"),
    "users": os.path.join(DATA_DIR, "users.json"),
    "banned_users": os.path.join(DATA_DIR, "banned_users.json"),
    "settings": os.path.join(DATA_DIR, "settings.json"),
    "logs": os.path.join(DATA_DIR, "logs.json"),
    "user_states": os.path.join(DATA_DIR, "user_states.json"),
    "announcements": os.path.join(DATA_DIR, "announcements.json"),
}

DEFAULT_SETTINGS = {
    "shop_link": "https://t.me/shoptaikhoanaibot",
    "shop_username": "@shoptaikhoanaibot",
    "support_username": "@YOUR_USERNAME",
    "cooldown_hours": 0,
    "round_id": "dot1",
}

DEFAULTS = {
    "accounts": [],
    "claimed_users": {},
    "users": {},
    "banned_users": [],
    "settings": DEFAULT_SETTINGS,
    "logs": [],
    "user_states": {},
    "announcements": [],
}

os.makedirs(DATA_DIR, exist_ok=True)


def load(name: str):
    path = FILES[name]
    if not os.path.exists(path):
        save(name, DEFAULTS[name])
        return DEFAULTS[name]
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, Exception) as e:
        logger.error(f"Corrupted {path}: {e}. Backing up and resetting.")
        backup_path = path + f".bak_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(path, backup_path)
        save(name, DEFAULTS[name])
        return DEFAULTS[name]


def save(name: str, data) -> None:
    path = FILES[name]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ── Users ──────────────────────────────────────────────────────────────────────

def save_user(user_id: int, username: str, first_name: str) -> None:
    users = load("users")
    uid = str(user_id)
    if uid not in users:
        users[uid] = {
            "user_id": user_id,
            "username": username or "",
            "first_name": first_name or "",
            "started_at": datetime.now().isoformat(),
        }
    else:
        users[uid]["username"] = username or ""
        users[uid]["first_name"] = first_name or ""
    save("users", users)


def get_all_users() -> dict:
    return load("users")


# ── Language / State ───────────────────────────────────────────────────────────

def get_user_lang(user_id: int) -> str:
    states = load("user_states")
    return states.get(str(user_id), {}).get("lang", None)


def set_user_lang(user_id: int, lang: str) -> None:
    states = load("user_states")
    uid = str(user_id)
    if uid not in states:
        states[uid] = {}
    states[uid]["lang"] = lang
    save("user_states", states)


def get_user_state(user_id: int) -> dict:
    states = load("user_states")
    return states.get(str(user_id), {})


def set_user_state(user_id: int, key: str, value) -> None:
    states = load("user_states")
    uid = str(user_id)
    if uid not in states:
        states[uid] = {}
    states[uid][key] = value
    save("user_states", states)


def clear_user_state(user_id: int, *keys) -> None:
    states = load("user_states")
    uid = str(user_id)
    if uid in states:
        for k in keys:
            states[uid].pop(k, None)
    save("user_states", states)


# ── Accounts ──────────────────────────────────────────────────────────────────

def get_accounts() -> list:
    return load("accounts")


def add_accounts(new_accounts: list) -> None:
    accounts = load("accounts")
    existing_emails = {a["email"] for a in accounts}
    added = 0
    for acc in new_accounts:
        if acc["email"] not in existing_emails:
            accounts.append(acc)
            existing_emails.add(acc["email"])
            added += 1
    save("accounts", accounts)
    return added


def pop_account():
    accounts = load("accounts")
    if not accounts:
        return None
    account = accounts.pop(0)
    save("accounts", accounts)
    return account


def delete_account(email: str) -> bool:
    accounts = load("accounts")
    original = len(accounts)
    accounts = [a for a in accounts if a["email"] != email]
    if len(accounts) < original:
        save("accounts", accounts)
        return True
    return False


def stock_count() -> int:
    return len(load("accounts"))


# ── Claimed users ─────────────────────────────────────────────────────────────

def get_claimed(round_id: str) -> dict:
    claimed = load("claimed_users")
    return claimed.get(round_id, {})


def add_claim(round_id: str, user_id: int, username: str, first_name: str,
              email: str, claim_time: str) -> None:
    claimed = load("claimed_users")
    if round_id not in claimed:
        claimed[round_id] = {}
    claimed[round_id][str(user_id)] = {
        "user_id": user_id,
        "username": username or "",
        "first_name": first_name or "",
        "claim_time": claim_time,
        "account_email": email,
        "round_id": round_id,
    }
    save("claimed_users", claimed)


def reset_round_claims(round_id: str) -> None:
    claimed = load("claimed_users")
    claimed.pop(round_id, None)
    save("claimed_users", claimed)


def find_claim_by_email(email: str) -> dict | None:
    claimed = load("claimed_users")
    for round_data in claimed.values():
        for record in round_data.values():
            if record.get("account_email", "").lower() == email.lower():
                return record
    return None


# ── Banned users ──────────────────────────────────────────────────────────────

def is_banned(user_id: int) -> bool:
    return str(user_id) in load("banned_users")


def ban_user(user_id: int) -> bool:
    banned = load("banned_users")
    uid = str(user_id)
    if uid in banned:
        return False
    banned.append(uid)
    save("banned_users", banned)
    return True


def unban_user(user_id: int) -> bool:
    banned = load("banned_users")
    uid = str(user_id)
    if uid not in banned:
        return False
    banned.remove(uid)
    save("banned_users", banned)
    return True


def banned_count() -> int:
    return len(load("banned_users"))


# ── Settings ──────────────────────────────────────────────────────────────────

def get_settings() -> dict:
    s = load("settings")
    # Merge with defaults for missing keys
    for k, v in DEFAULT_SETTINGS.items():
        if k not in s:
            s[k] = v
    return s


def update_setting(key: str, value) -> None:
    s = load("settings")
    s[key] = value
    save("settings", s)


# ── Logs ──────────────────────────────────────────────────────────────────────

def add_log(action: str, user: str, admin: str = "") -> None:
    logs = load("logs")
    logs.append({
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "action": action,
        "user": user,
        "admin": admin,
    })
    # Keep last 500 logs
    if len(logs) > 500:
        logs = logs[-500:]
    save("logs", logs)


def get_logs(limit: int = 20) -> list:
    return load("logs")[-limit:]


# ── Announcements ─────────────────────────────────────────────────────────────

def get_announcements() -> list:
    return load("announcements")


def add_announcement(msg: str) -> None:
    ann = load("announcements")
    ann.append({
        "msg": msg,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })
    save("announcements", ann)
