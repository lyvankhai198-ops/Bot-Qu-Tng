"""
data_manager.py — Centralized data layer for Bot Quà Tặng AI
All JSON files live in DATA_DIR (default: ./data/)
"""
import json
import os
import shutil
import uuid
from datetime import datetime, date
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# ─── Low-level I/O ─────────────────────────────────────────────────────────

def _path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"

def load(name: str, default=None):
    if default is None:
        default = {}
    p = _path(name)
    try:
        if p.exists():
            text = p.read_text(encoding="utf-8").strip()
            if text:
                return json.loads(text)
    except Exception:
        backup = DATA_DIR / f"{name}.bak.json"
        try:
            if backup.exists():
                return json.loads(backup.read_text(encoding="utf-8"))
        except Exception:
            pass
    return default

def save(name: str, data):
    p = _path(name)
    backup = DATA_DIR / f"{name}.bak.json"
    try:
        if p.exists():
            shutil.copy2(p, backup)
    except Exception:
        pass
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# ─── Users ─────────────────────────────────────────────────────────────────

def save_user(user_id: int, username: str, first_name: str):
    users = load("users", {})
    uid = str(user_id)
    now = datetime.now().isoformat()
    existing = users.get(uid, {})
    users[uid] = {
        "user_id": user_id,
        "username": username or "",
        "first_name": first_name or "",
        "started_at": existing.get("started_at", now),
        "last_active": now,
        "usage_count": existing.get("usage_count", 0) + 1,
        "has_received_gift": existing.get("has_received_gift", False),
        "gift_received": existing.get("gift_received", None),
        "lang": existing.get("lang", "vi"),
        "banned": existing.get("banned", False),
    }
    save("users", users)

def get_all_users() -> dict:
    return load("users", {})

def get_user(user_id: int):
    return load("users", {}).get(str(user_id))

def reset_user_gift(user_id: int):
    users = load("users", {})
    uid = str(user_id)
    if uid in users:
        users[uid]["has_received_gift"] = False
        users[uid]["gift_received"] = None
        save("users", users)

# ─── Lang / State ──────────────────────────────────────────────────────────

def get_user_lang(user_id: int) -> str:
    return load("user_states", {}).get(str(user_id), {}).get("lang")

def set_user_lang(user_id: int, lang: str):
    states = load("user_states", {})
    uid = str(user_id)
    if uid not in states:
        states[uid] = {}
    states[uid]["lang"] = lang
    save("user_states", states)
    # mirror into users
    users = load("users", {})
    if uid in users:
        users[uid]["lang"] = lang
        save("users", users)

def get_user_state(user_id: int) -> dict:
    return load("user_states", {}).get(str(user_id), {})

def set_user_state(user_id: int, key: str, value):
    states = load("user_states", {})
    uid = str(user_id)
    if uid not in states:
        states[uid] = {}
    states[uid][key] = value
    save("user_states", states)

def clear_user_state(user_id: int, key: str):
    states = load("user_states", {})
    uid = str(user_id)
    if uid in states and key in states[uid]:
        del states[uid][key]
        save("user_states", states)

# ─── Accounts ──────────────────────────────────────────────────────────────

def _normalize_account(acc) -> dict:
    if not isinstance(acc, dict):
        acc = {"email": str(acc), "password": ""}
    acc.setdefault("id", str(uuid.uuid4())[:8])
    acc.setdefault("type", "")
    acc.setdefault("note", "")
    acc.setdefault("addedAt", datetime.now().isoformat())
    acc.setdefault("status", "available")
    acc.setdefault("distributedTo", None)
    acc.setdefault("distributedAt", None)
    return acc

def get_accounts() -> list:
    return [_normalize_account(a) for a in load("accounts", [])]

def add_accounts(accounts_list: list):
    """accounts_list: list of dicts with at minimum {email, password}"""
    accounts = get_accounts()
    now = datetime.now().isoformat()
    for acc in accounts_list:
        accounts.append(_normalize_account({
            "id": str(uuid.uuid4())[:8],
            "type": acc.get("type", ""),
            "email": acc.get("email", ""),
            "password": acc.get("password", ""),
            "note": acc.get("note", ""),
            "addedAt": now,
            "status": "available",
            "distributedTo": None,
            "distributedAt": None,
        }))
    save("accounts", accounts)

def pop_account():
    """Get and mark-as-distributed the next available account."""
    accounts = [_normalize_account(a) for a in load("accounts", [])]
    for i, acc in enumerate(accounts):
        if acc.get("status", "available") == "available":
            accounts[i]["status"] = "distributed"
            accounts[i]["distributedAt"] = datetime.now().isoformat()
            save("accounts", accounts)
            return acc
    return None

def mark_account_distributed(email: str, user_id: int):
    accounts = [_normalize_account(a) for a in load("accounts", [])]
    for acc in accounts:
        if acc.get("email") == email:
            acc["status"] = "distributed"
            acc["distributedTo"] = str(user_id)
            acc["distributedAt"] = datetime.now().isoformat()
    save("accounts", accounts)

def delete_account(email: str):
    accounts = [a for a in load("accounts", []) if not (isinstance(a, dict) and a.get("email") == email)]
    save("accounts", accounts)

def update_account(email: str, fields: dict):
    accounts = [_normalize_account(a) for a in load("accounts", [])]
    for acc in accounts:
        if acc.get("email") == email:
            acc.update(fields)
    save("accounts", accounts)

def stock_count() -> int:
    return sum(1 for a in load("accounts", []) if isinstance(a, dict) and a.get("status", "available") == "available")

# ─── Claims ────────────────────────────────────────────────────────────────

def get_claimed(round_id: str) -> dict:
    return load("claimed_users", {}).get(round_id, {})

def add_claim(round_id: str, user_id: int, username: str, first_name: str, account_email: str, claim_time: str):
    claimed = load("claimed_users", {})
    claimed.setdefault(round_id, {})[str(user_id)] = {
        "user_id": user_id,
        "username": username or "",
        "first_name": first_name or "",
        "account_email": account_email,
        "claim_time": claim_time,
        "round_id": round_id,
    }
    save("claimed_users", claimed)
    # update user record
    users = load("users", {})
    uid = str(user_id)
    if uid in users:
        users[uid]["has_received_gift"] = True
        users[uid]["gift_received"] = account_email
        save("users", users)

def reset_round_claims(new_round_id: str):
    settings = load("settings", {})
    settings["round_id"] = new_round_id
    save("settings", settings)

def find_claim_by_email(email: str):
    for round_id, round_data in load("claimed_users", {}).items():
        for record in round_data.values():
            if record.get("account_email", "").lower() == email.lower():
                return record
    return None

def get_receivers() -> list:
    settings = get_settings()
    round_id = settings.get("round_id", "")
    claimed = load("claimed_users", {})
    return list(claimed.get(round_id, {}).values())

# ─── Ban ───────────────────────────────────────────────────────────────────

def is_banned(user_id: int) -> bool:
    return str(user_id) in [str(b) for b in load("banned_users", [])]

def ban_user(user_id: int):
    banned = load("banned_users", [])
    uid = str(user_id)
    if uid not in [str(b) for b in banned]:
        banned.append(uid)
        save("banned_users", banned)
    users = load("users", {})
    if uid in users:
        users[uid]["banned"] = True
        save("users", users)

def unban_user(user_id: int):
    save("banned_users", [b for b in load("banned_users", []) if str(b) != str(user_id)])
    users = load("users", {})
    uid = str(user_id)
    if uid in users:
        users[uid]["banned"] = False
        save("users", users)

# ─── Settings ──────────────────────────────────────────────────────────────

SETTINGS_DEFAULTS = {
    "shop_link": "https://t.me/shoptaikhoanaibot",
    "shop_username": "@shoptaikhoanaibot",
    "support_username": "@admin",
    "cooldown_hours": 0,
    "round_id": "dot1",
    "gift_enabled": True,
    "support_enabled": True,
    "intro_enabled": True,
    "maintenance_mode": False,
    "refund_formula": "remaining_days",
    "refund_custom_text": "",
}

def get_settings() -> dict:
    return {**SETTINGS_DEFAULTS, **load("settings", {})}

def update_setting(key: str, value):
    settings = load("settings", {})
    settings[key] = value
    save("settings", settings)

def update_settings(fields: dict):
    settings = load("settings", {})
    settings.update(fields)
    save("settings", settings)

# ─── Orders ────────────────────────────────────────────────────────────────

def get_orders() -> dict:
    return load("orders", {})

def get_order(order_id: str):
    return load("orders", {}).get(order_id)

def add_order(order: dict) -> str:
    orders = load("orders", {})
    order_id = "ORD" + str(uuid.uuid4())[:6].upper()
    order["orderId"] = order_id
    order.setdefault("createdAt", datetime.now().isoformat())
    order.setdefault("status", "active")
    orders[order_id] = order
    save("orders", orders)
    return order_id

def update_order(order_id: str, fields: dict) -> bool:
    orders = load("orders", {})
    if order_id not in orders:
        return False
    orders[order_id].update(fields)
    orders[order_id]["updatedAt"] = datetime.now().isoformat()
    save("orders", orders)
    return True

def delete_order(order_id: str) -> bool:
    orders = load("orders", {})
    if order_id not in orders:
        return False
    del orders[order_id]
    save("orders", orders)
    return True

def find_order_by_email(email: str):
    email_lower = email.lower()
    for order in load("orders", {}).values():
        if order.get("email", "").lower() == email_lower:
            return order
    return None

def find_order(query: str):
    """Find by order ID or email."""
    return get_order(query) or find_order_by_email(query)

# ─── Order Items ───────────────────────────────────────────────────────────

def get_all_order_items() -> dict:
    """Returns {orderId: [item, ...]}"""
    return load("order_items", {})

def get_order_items(order_id: str) -> list:
    """Returns list of items for an order."""
    return load("order_items", {}).get(order_id, [])

def add_order_item(order_id: str, item: dict) -> str:
    """Add an item to an order. Returns itemId."""
    all_items = load("order_items", {})
    if order_id not in all_items:
        all_items[order_id] = []
    item_id = str(uuid.uuid4())[:8].upper()
    item = {**item, "itemId": item_id}
    item.setdefault("createdAt", datetime.now().isoformat())
    item.setdefault("status", "active")
    all_items[order_id].append(item)
    save("order_items", all_items)
    return item_id

def update_order_item(order_id: str, item_id: str, fields: dict) -> bool:
    """Update fields on an existing item."""
    all_items = load("order_items", {})
    items = all_items.get(order_id, [])
    for i, item in enumerate(items):
        if item.get("itemId") == item_id:
            items[i] = {**item, **fields, "updatedAt": datetime.now().isoformat()}
            all_items[order_id] = items
            save("order_items", all_items)
            return True
    return False

def find_item_by_email(email: str):
    """Find the first (order, item) pair where item.email matches. Returns (order, item)."""
    email_lower = email.lower()
    orders = load("orders", {})
    all_items = load("order_items", {})
    for order_id, item_list in all_items.items():
        for item in item_list:
            if item.get("email", "").lower() == email_lower:
                return orders.get(order_id), item
    return None, None

def find_order_with_items(query: str) -> dict:
    """
    Unified lookup by order ID or email.
    Returns:
      { order: dict|None, items: list, lookupType: 'order_id'|'email'|None, matchedItem: dict|None }
    When found by email, returns ALL items for that order (not just the matched one).
    """
    query = query.strip()
    orders = load("orders", {})
    all_items = load("order_items", {})

    # 1. Order ID match
    if query in orders:
        items = all_items.get(query, [])
        return {"order": orders[query], "items": items, "lookupType": "order_id", "matchedItem": None}

    # 2. Email match in order_items
    email_lower = query.lower()
    for order_id, item_list in all_items.items():
        for item in item_list:
            if item.get("email", "").lower() == email_lower:
                # Return ALL items for this order
                return {"order": orders.get(order_id), "items": item_list, "lookupType": "email", "matchedItem": item}

    # 3. Fallback: email in orders.json (old single-account structure without items)
    for order in orders.values():
        if order.get("email", "").lower() == email_lower:
            return {"order": order, "items": [], "lookupType": "email", "matchedItem": None}

    return {"order": None, "items": [], "lookupType": None, "matchedItem": None}

def migrate_to_order_items() -> int:
    """
    One-time migration: for each order in orders.json without items yet,
    create an order_item from order.email/password/twoFA.
    Returns number of orders migrated.
    """
    orders = load("orders", {})
    all_items = load("order_items", {})
    migrated = 0
    for order_id, order in orders.items():
        if order_id in all_items:
            continue  # already has items
        email = order.get("email", "")
        if not email:
            continue  # skip orders without email
        item_id = str(uuid.uuid4())[:8].upper()
        all_items[order_id] = [{
            "itemId": item_id,
            "email": email,
            "password": order.get("password"),
            "twoFA": order.get("twoFA"),
            "status": order.get("status", "active"),
            "createdAt": order.get("createdAt", datetime.now().isoformat()),
        }]
        migrated += 1
    if migrated:
        save("order_items", all_items)
    return migrated

# ─── Warranty Requests ────────────────────────────────────────────────────

def get_warranty_requests() -> list:
    return load("warranty_requests", [])

def add_warranty_request(user_id: int, username: str, first_name: str,
                          order_id: str, email: str, description: str,
                          user_lang: str = "vi") -> str:
    requests = load("warranty_requests", [])
    req = {
        "id": str(uuid.uuid4())[:12],
        "userId": str(user_id),
        "username": username or "",
        "firstName": first_name or "",
        "orderId": order_id,
        "email": email,
        "description": description,
        "userLang": user_lang,
        "submittedAt": datetime.now().isoformat(),
        "status": "pending",
        "resolution": None,
        "resolvedAt": None,
        "resolvedBy": None,
        # ── Reminder state (persistent, restart-safe) ──────────────────────
        "adminNotifiedAt": None,      # set after first admin notification
        "reminderEnabled": False,     # enabled only after admin is notified
        "reminderCount": 0,           # how many reminders sent so far
        "lastReminderAt": None,
        "nextReminderAt": None,       # absolute ISO timestamp of next reminder
        "reminderProcessing": False,  # anti-duplicate lock
    }
    requests.append(req)
    save("warranty_requests", requests)
    return req["id"]

def update_warranty_request(req_id: str, fields: dict) -> bool:
    requests = load("warranty_requests", [])
    for req in requests:
        if req.get("id") == req_id:
            req.update(fields)
            save("warranty_requests", requests)
            return True
    return False

# ─── Notification settings ─────────────────────────────────────────────────

_NOTIF_DEFAULTS = {
    "enabled": True,
    "adminIds": [],
    "reminderEnabled": True,
    "reminder1Minutes": 5,
    "reminder2Minutes": 15,
    "urgentMinutes": 30,
}

def get_notification_settings() -> dict:
    stored = load("notification_settings", {})
    return {**_NOTIF_DEFAULTS, **stored}

def save_notification_settings(settings: dict) -> None:
    save("notification_settings", settings)

def get_warranty_request(req_id: str):
    for req in load("warranty_requests", []):
        if req.get("id") == req_id:
            return req
    return None

# ─── Group Warranty Requests ──────────────────────────────────────────────────

def add_group_warranty_request(user_id: int, username: str, first_name: str,
                                accounts: list, description: str, user_lang: str = "vi") -> str:
    """
    accounts: list of dicts with {orderId, email, productName}
    Returns the group request ID.
    """
    requests = load("warranty_requests", [])
    req_id = str(uuid.uuid4())[:12]
    account_items = []
    for i, acc in enumerate(accounts):
        account_items.append({
            "id": f"{req_id}-{i}",
            "orderId": acc.get("orderId", ""),
            "email": acc.get("email", ""),
            "productName": acc.get("productName", ""),
            "description": description,
            "status": "pending",
            "resolution": None,
            "replacementEmail": None,
            "replacementPassword": None,
            "replacementTwoFA": None,
            "replacementNote": None,
            "sentStatus": None,
            "sentError": None,
            "sentAt": None,
            "resolvedAt": None,
            "resolvedBy": None,
        })
    req = {
        "id": req_id,
        "type": "group",
        "userId": str(user_id),
        "username": username or "",
        "firstName": first_name or "",
        "description": description,
        "userLang": user_lang,
        "submittedAt": datetime.now().isoformat(),
        "status": "pending",
        "resolution": None,
        "resolvedAt": None,
        "resolvedBy": None,
        "accounts": account_items,
        "notFoundAccounts": [],
        "acknowledgedAt": None,
        "acknowledgedBy": None,
        "ackNotifSentStatus": None,
        "ackNotifSentAt": None,
        "ackNotifError": None,
        # ── Reminder state ─────────────────────────────────────────────
        "adminNotifiedAt": None,
        "reminderEnabled": False,
        "reminderCount": 0,
        "lastReminderAt": None,
        "nextReminderAt": None,
        "reminderProcessing": False,
    }
    requests.append(req)
    save("warranty_requests", requests)
    return req_id

def update_warranty_account(req_id: str, acc_id: str, fields: dict) -> bool:
    """Update a sub-account item within a group warranty request."""
    requests = load("warranty_requests", [])
    for req in requests:
        if req.get("id") != req_id or req.get("type") != "group":
            continue
        accs = req.get("accounts", [])
        for acc in accs:
            if acc.get("id") == acc_id:
                acc.update(fields)
                # Recompute overall status
                statuses = [a.get("status", "pending") for a in accs]
                if all(s in ("resolved", "rejected") for s in statuses):
                    req["status"] = "resolved"
                    if not req.get("resolvedAt"):
                        req["resolvedAt"] = datetime.now().isoformat()
                elif any(s == "processing" for s in statuses) or req.get("acknowledgedAt"):
                    if req.get("status") != "resolved":
                        req["status"] = "processing"
                save("warranty_requests", requests)
                return True
    return False

def get_open_warranty_emails(user_id: int) -> set:
    """Return set of lowercased emails that have an open (pending/processing) warranty for this user."""
    open_emails: set = set()
    uid = str(user_id)
    for req in load("warranty_requests", []):
        if req.get("userId") != uid:
            continue
        if req.get("status") not in ("pending", "processing"):
            continue
        if req.get("type") == "group":
            for acc in req.get("accounts", []):
                if acc.get("status") in ("pending", "processing"):
                    open_emails.add(acc.get("email", "").lower())
        else:
            em = req.get("email", "")
            if em:
                open_emails.add(em.lower())
    return open_emails

# ─── Notification Logs ────────────────────────────────────────────────────────

def add_notification_log(ticket_id: str, notification_type: str,
                          reminder_number: int, sent_at: str,
                          status: str = "sent", error_message: str | None = None) -> None:
    """Append a notification log entry (unique per ticket+type+reminder_number)."""
    logs = load("notification_logs", [])
    # Enforce uniqueness: skip if same (ticket_id, notification_type, reminder_number) exists
    for entry in logs:
        if (entry.get("ticketId") == ticket_id
                and entry.get("notificationType") == notification_type
                and entry.get("reminderNumber") == reminder_number):
            return
    logs.append({
        "id": str(uuid.uuid4())[:12],
        "ticketId": ticket_id,
        "notificationType": notification_type,
        "reminderNumber": reminder_number,
        "sentAt": sent_at,
        "status": status,
        "errorMessage": error_message,
    })
    save("notification_logs", logs)

def get_notification_logs(ticket_id: str | None = None) -> list:
    logs = load("notification_logs", [])
    if ticket_id:
        return [l for l in logs if l.get("ticketId") == ticket_id]
    return logs

# ─── Reminder maintenance helpers ─────────────────────────────────────────────

def reset_stale_reminder_locks() -> int:
    """On startup: clear any reminderProcessing=True flags left from a crash."""
    requests = load("warranty_requests", [])
    fixed = 0
    for req in requests:
        if req.get("reminderProcessing"):
            req["reminderProcessing"] = False
            fixed += 1
    if fixed:
        save("warranty_requests", requests)
    return fixed

def migrate_warranty_reminder_fields() -> int:
    """One-time migration: add reminder state fields to existing tickets that lack them.
    Old tickets default to reminderEnabled=False to prevent spam on first deploy."""
    requests = load("warranty_requests", [])
    changed = 0
    for req in requests:
        if "reminderEnabled" not in req:
            req.setdefault("adminNotifiedAt", req.get("notifiedAt"))  # keep old notifiedAt if exists
            req["reminderEnabled"] = False   # don't auto-remind old tickets
            req.setdefault("reminderCount", 0)
            req.setdefault("lastReminderAt", None)
            req.setdefault("nextReminderAt", None)
            req.setdefault("reminderProcessing", False)
            changed += 1
    if changed:
        save("warranty_requests", requests)
    return changed

# ─── Introduction ─────────────────────────────────────────────────────────

INTRO_DEFAULTS = {
    "title": "Giới thiệu Bot Quà Tặng AI",
    "content": "Bot nhận quà tặng tài khoản AI miễn phí từ AI Center.",
    "photoUrl": "",
    "videoUrl": "",
    "buttons": [],
}

def get_intro() -> dict:
    return {**INTRO_DEFAULTS, **load("intro", {})}

def save_intro(data: dict):
    save("intro", data)

# ─── Logs ──────────────────────────────────────────────────────────────────

def add_log(action: str, user: str = "", admin: str = ""):
    logs = load("logs", [])
    logs.append({
        "time": datetime.now().isoformat(),
        "action": action,
        "user": user,
        "admin": admin,
    })
    if len(logs) > 1000:
        logs = logs[-1000:]
    save("logs", logs)

def get_logs(limit: int = 100) -> list:
    return list(reversed(load("logs", [])[-limit:]))

# ─── Broadcast ────────────────────────────────────────────────────────────

def get_pending_broadcasts() -> list:
    return load("pending_broadcasts", [])

def queue_broadcast(message: str, target: str = "all"):
    pending = load("pending_broadcasts", [])
    pending.append({
        "message": message,
        "target": target,
        "queued_at": datetime.now().isoformat(),
    })
    save("pending_broadcasts", pending)

def clear_pending_broadcasts():
    save("pending_broadcasts", [])

# ─── Order display helper ─────────────────────────────────────────────────

def calc_order_display(order: dict, settings: dict) -> dict:
    """Calculate remaining days, warranty status, and refund estimate."""
    from datetime import datetime, date
    result = dict(order)
    today = date.today()

    expiry_str = order.get("expiryDate", "")
    remaining_days = None
    if expiry_str:
        try:
            expiry = date.fromisoformat(expiry_str[:10])
            remaining_days = max(0, (expiry - today).days)
        except Exception:
            pass

    warranty_str = order.get("warrantyExpiry", "") or order.get("warrantyDate", "")
    warranty_ok = None
    if warranty_str:
        try:
            warranty_date = date.fromisoformat(warranty_str[:10])
            warranty_ok = warranty_date >= today
        except Exception:
            pass

    # Refund calculation
    refund_amount = None
    price = order.get("price", 0) or 0
    if remaining_days is not None and price:
        purchase_str = order.get("purchaseDate", "")
        if purchase_str:
            try:
                purchase = date.fromisoformat(purchase_str[:10])
                expiry = date.fromisoformat(expiry_str[:10])
                total_days = max(1, (expiry - purchase).days)
                if settings.get("refund_formula") == "remaining_days":
                    refund_amount = round(price * remaining_days / total_days)
            except Exception:
                pass
        custom_text = settings.get("refund_custom_text", "")
        if settings.get("refund_formula") == "custom" and custom_text:
            refund_amount = custom_text

    result["_remaining_days"] = remaining_days
    result["_warranty_ok"] = warranty_ok
    result["_refund_amount"] = refund_amount
    return result
