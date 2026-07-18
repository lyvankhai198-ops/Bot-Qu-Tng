"""
data_manager.py — Centralized data layer for Bot Quà Tặng AI
All JSON files live in DATA_DIR (default: ./data/)
"""
import json
import os
import re
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

def find_item_by_any_account(email: str):
    """
    Search for an order_item by any account in its replacement chain:
    - item.original_account / item.email (backward compat)
    - item.current_account
    - account_replacements[itemId].previousAccount or .newAccount
    Returns (order_id, item) or (None, None).
    """
    email_lower = email.strip().lower()
    orders   = load("orders", {})
    all_items = load("order_items", {})
    reps     = load("account_replacements", {})

    # Pass 1: original_account / current_account / email fields
    for order_id, item_list in all_items.items():
        if order_id not in orders:
            continue  # skip orphan items whose order record is missing
        for item in item_list:
            orig = (item.get("original_account") or item.get("email") or "").lower()
            curr = (item.get("current_account") or item.get("email") or "").lower()
            if email_lower in (orig, curr):
                return order_id, item

    # Pass 2: search historical replacement records
    for order_id, item_list in all_items.items():
        if order_id not in orders:
            continue  # skip orphan items
        for item in item_list:
            item_id = item.get("itemId", "")
            for rep in reps.get(item_id, []):
                if (rep.get("previousAccount") or "").lower() == email_lower:
                    return order_id, item
                if (rep.get("newAccount") or "").lower() == email_lower:
                    return order_id, item

    return None, None


def find_order_with_items(query: str) -> dict:
    """
    Unified lookup by order ID (or "mã đơn: XYZ"), original email, current email,
    or any historical account in the replacement chain.
    Returns:
      { order, items, lookupType: 'order_id'|'email'|None, matchedItem,
        isMultiAccountOrder: bool }
    Email-based lookups return only the single matched item (never siblings).
    isMultiAccountOrder is True when the order has >1 item and lookup was by email.
    """
    # Normalize: strip common label prefixes
    query = re.sub(
        r'^(?:m[aã]\s*[đd][oơ]n|order\s*(?:code|id)?|email|t[àa]i\s*kho[ảa]n)\s*[:：]\s*',
        '', query.strip(), flags=re.IGNORECASE,
    ).strip()

    orders    = load("orders", {})
    all_items = load("order_items", {})

    # 1. Order ID match — return all items for the order
    query_upper = query.upper()
    match_key = query_upper if query_upper in orders else (query if query in orders else None)
    if match_key:
        items = all_items.get(match_key, [])
        return {
            "order": orders[match_key],
            "items": items,
            "lookupType": "order_id",
            "matchedItem": None,
            "isMultiAccountOrder": len(items) > 1,
        }

    # 2. Full chain search (original, current, replacement history)
    order_id, matched_item = find_item_by_any_account(query)
    if order_id and matched_item:
        # Primary: exact key lookup
        found_order = orders.get(order_id)
        # Secondary: scan by orderId field (guards against case/format key mismatch)
        if not found_order:
            for o in orders.values():
                if o.get("orderId", "") == order_id:
                    found_order = o
                    break
        if found_order:
            order_item_count = len(all_items.get(order_id, []))
            return {
                "order": found_order,
                "items": [matched_item],
                "lookupType": "email",
                "matchedItem": matched_item,
                "isMultiAccountOrder": order_item_count > 1,
            }
        # If order still not resolved, fall through to email fallback below

    # 3. Fallback: email in orders.json header (legacy or unresolved above)
    email_lower = query.lower()
    for order in orders.values():
        if order.get("email", "").lower() == email_lower:
            return {
                "order": order, "items": [], "lookupType": "email",
                "matchedItem": None, "isMultiAccountOrder": False,
            }

    return {"order": None, "items": [], "lookupType": None, "matchedItem": None, "isMultiAccountOrder": False}

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

# ─── Account Replacements ─────────────────────────────────────────────────

def get_account_replacements(item_id: str) -> list:
    """Returns replacement history for an item, ordered by replacementNumber."""
    reps = load("account_replacements", {})
    return sorted(reps.get(item_id, []), key=lambda r: r.get("replacementNumber", 0))

def add_account_replacement(
    item_id: str,
    order_id: str,
    previous_account: str,
    new_account: str,
    new_password: str = None,
    new_two_fa: str = None,
    reason: str = "",
    support_ticket_id: str = None,
    created_by: str = "admin",
) -> dict:
    """Record a warranty replacement and update order_items current_account fields."""
    reps = load("account_replacements", {})
    if item_id not in reps:
        reps[item_id] = []
    replacement_number = len(reps[item_id]) + 1
    now_iso = datetime.now().isoformat()
    rec = {
        "id": str(uuid.uuid4())[:12],
        "orderId": order_id,
        "orderItemId": item_id,
        "previousAccount": previous_account,
        "newAccount": new_account,
        "newPassword": new_password,
        "newTwoFA": new_two_fa,
        "replacementNumber": replacement_number,
        "deliveredAt": now_iso,
        "reason": reason,
        "supportTicketId": support_ticket_id,
        "createdBy": created_by,
        "createdAt": now_iso,
        "status": "delivered",
    }
    reps[item_id].append(rec)
    save("account_replacements", reps)

    # Update item's current_account in order_items
    all_items = load("order_items", {})
    items = all_items.get(order_id, [])
    for i, item in enumerate(items):
        if item.get("itemId") == item_id:
            items[i]["current_account"] = new_account
            if new_password:
                items[i]["current_password"] = new_password
            if new_two_fa:
                items[i]["current_two_fa"] = new_two_fa
            items[i]["current_replacement_number"] = replacement_number
            items[i]["item_status"] = "active"
            items[i]["updatedAt"] = now_iso
            break
    all_items[order_id] = items
    save("order_items", all_items)
    return rec

def calc_item_warranty(item: dict, order: dict, settings: dict) -> dict:
    """
    Compute warranty status for a single order item.
    Always anchored to original_delivered_at — never extended by replacement deliveries.
    Returns: { warrantyStatus, remainingDays, canReport, refundAmount, warrantyEndDate,
               originalDeliveredAt, warrantyDays }
    """
    today = date.today()

    # Warranty start: prefer item-level fields, fall back to order
    start_str = (
        item.get("original_delivered_at") or
        item.get("deliveredAt") or
        order.get("purchaseDate") or
        order.get("paymentAt") or
        ""
    )

    # Warranty duration
    wd = item.get("warranty_days") or order.get("warrantyDays") or 0
    warranty_days = int(wd) if wd else 0

    # warranty_end_date: use stored value if present, else compute
    warranty_end = None
    stored_end = item.get("warranty_end_date") or ""
    if stored_end:
        try:
            warranty_end = date.fromisoformat(stored_end[:10])
        except Exception:
            pass
    if warranty_end is None and start_str and warranty_days:
        try:
            from datetime import timedelta
            start = date.fromisoformat(start_str[:10])
            warranty_end = start + timedelta(days=warranty_days)
        except Exception:
            pass
    # Fallback to order-level warranty expiry fields
    if warranty_end is None:
        we = order.get("warrantyExpiry") or order.get("warrantyDate") or order.get("warrantyExpiry") or ""
        if we:
            try:
                warranty_end = date.fromisoformat(we[:10])
            except Exception:
                pass

    remaining_days = None
    warranty_status = "unknown"
    can_report = False
    # If we have no date data at all, signal "no_data" so UI can show a helpful error
    if not start_str and not warranty_end:
        warranty_status = "no_data"
    elif warranty_end:
        remaining_days = max(0, (warranty_end - today).days)
        warranty_status = "active" if remaining_days > 0 else "expired"
        can_report = warranty_status == "active"

    # Block warranty reporting for orders that were already refunded
    if order.get("status") == "refunded":
        can_report = False

    # Pro-rated refund
    refund_amount = 0
    price = order.get("price", 0) or 0
    refund_formula = settings.get("refund_formula", "remaining_days")
    if remaining_days and remaining_days > 0 and price and warranty_days:
        if refund_formula == "remaining_days":
            refund_amount = round(price * remaining_days / warranty_days)
        elif refund_formula == "custom":
            refund_amount = settings.get("refund_custom_text", "")

    return {
        "warrantyStatus": warranty_status,
        "remainingDays": remaining_days,
        "canReport": can_report,
        "refundAmount": refund_amount,
        "warrantyEndDate": warranty_end.isoformat() if warranty_end else None,
        "originalDeliveredAt": start_str or None,
        "warrantyDays": warranty_days,
    }

def migrate_order_items_to_chain() -> int:
    """
    Enrich existing order_items with replacement-chain fields where missing.
    Safe to run on every startup — skips items that already have all fields.
    Returns number of items updated.
    """
    from datetime import timedelta
    orders    = load("orders", {})
    all_items = load("order_items", {})
    updated   = 0

    for order_id, item_list in all_items.items():
        order = orders.get(order_id, {})
        for i, item in enumerate(item_list):
            changed = False

            if not item.get("original_account") and item.get("email"):
                item["original_account"] = item["email"]
                changed = True
            if not item.get("current_account"):
                item["current_account"] = item.get("original_account") or item.get("email") or ""
                changed = True
            if item.get("current_replacement_number") is None:
                item["current_replacement_number"] = 0
                changed = True
            if not item.get("original_delivered_at"):
                od = (
                    item.get("deliveredAt") or
                    item.get("createdAt") or
                    order.get("purchaseDate") or
                    order.get("createdAt") or ""
                )
                if od:
                    item["original_delivered_at"] = od
                    changed = True
            if not item.get("warranty_days"):
                wd = order.get("warrantyDays") or 0
                if wd:
                    item["warranty_days"] = int(wd)
                    changed = True
            if not item.get("warranty_end_date"):
                start_str = item.get("original_delivered_at", "")
                wd = item.get("warranty_days") or 0
                if start_str and wd:
                    try:
                        start = date.fromisoformat(start_str[:10])
                        item["warranty_end_date"] = (start + timedelta(days=int(wd))).isoformat()
                        changed = True
                    except Exception:
                        pass
                if not item.get("warranty_end_date"):
                    we = order.get("warrantyExpiry") or order.get("warrantyDate") or ""
                    if we:
                        item["warranty_end_date"] = we[:10]
                        changed = True
            if not item.get("item_status"):
                item["item_status"] = item.get("status") or "active"
                changed = True

            if changed:
                all_items[order_id][i] = item
                updated += 1

    if updated:
        save("order_items", all_items)
    return updated

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

# ─── Refund history ──────────────────────────────────────────────────────────

def get_refund_record(order_id: str) -> dict | None:
    """Return the most recent refund record for an order, or None."""
    if not order_id:
        return None
    history = load("refund_history", [])
    matches = [r for r in history if r.get("orderId") == order_id]
    return matches[-1] if matches else None

# ─── Required channels (join-gate for gift) ──────────────────────────────────

def get_required_channels() -> list:
    return load("required_channels", [])

def save_required_channels(channels: list):
    save("required_channels", channels)

# ─── Channel Membership Cache ─────────────────────────────────────────────────
# Persisted in data/user_channel_memberships.json
# Schema per entry:
#   { id, telegram_user_id, channel_id, membership_status,
#     is_verified, verified_at, last_checked_at, created_at, updated_at }

MEMBERSHIP_CACHE_TTL_HOURS = 6

def channel_cache_key(ch: dict) -> str:
    """Stable cache key for a channel — uses chatId, then username, then id."""
    cid = (ch.get("chatId") or ch.get("username") or ch.get("id") or "").strip()
    return cid.lower() if cid else ""

def get_user_memberships(user_id: int) -> dict:
    """Returns {channel_key: record} for a user."""
    return load("user_channel_memberships", {}).get(str(user_id), {})

def get_all_memberships() -> dict:
    """Full user_channel_memberships data."""
    return load("user_channel_memberships", {})

def set_membership_verified(user_id: int, channel_key: str, status: str) -> None:
    """Record a successful getChatMember verification for user+channel."""
    memberships = load("user_channel_memberships", {})
    uid = str(user_id)
    if uid not in memberships:
        memberships[uid] = {}
    now = datetime.now().isoformat()
    existing = memberships[uid].get(channel_key, {})
    memberships[uid][channel_key] = {
        "id": existing.get("id") or str(uuid.uuid4())[:12],
        "telegram_user_id": str(user_id),
        "channel_id": channel_key,
        "membership_status": status,
        "is_verified": True,
        "verified_at": now,
        "last_checked_at": now,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
    }
    save("user_channel_memberships", memberships)

def set_membership_left(user_id: int, channel_key: str, status: str = "left") -> None:
    """Record that a user is NOT a member (left/kicked confirmed by getChatMember)."""
    memberships = load("user_channel_memberships", {})
    uid = str(user_id)
    if uid not in memberships:
        memberships[uid] = {}
    now = datetime.now().isoformat()
    existing = memberships[uid].get(channel_key, {})
    memberships[uid][channel_key] = {
        "id": existing.get("id") or str(uuid.uuid4())[:12],
        "telegram_user_id": str(user_id),
        "channel_id": channel_key,
        "membership_status": status,
        "is_verified": False,
        "verified_at": existing.get("verified_at"),   # preserve last good timestamp
        "last_checked_at": now,
        "created_at": existing.get("created_at", now),
        "updated_at": now,
    }
    save("user_channel_memberships", memberships)

def is_membership_cache_valid(user_id: int, channel_key: str,
                               ttl_hours: int = MEMBERSHIP_CACHE_TTL_HOURS) -> bool:
    """True if the user's cache entry for channel_key is verified and within TTL."""
    if not channel_key:
        return False
    memberships = load("user_channel_memberships", {})
    entry = memberships.get(str(user_id), {}).get(channel_key)
    if not entry or not entry.get("is_verified"):
        return False
    verified_at = entry.get("verified_at")
    if not verified_at:
        return False
    try:
        vt = datetime.fromisoformat(verified_at)
        return datetime.now() < vt + timedelta(hours=ttl_hours)
    except Exception:
        return False

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

    # Resolve expiry date: explicit field first, then compute from purchaseDate + warrantyDays
    expiry_str = (order.get("expiryDate") or "")[:10]
    if not expiry_str:
        purchase_str0 = (order.get("purchaseDate") or "")[:10]
        wd0 = int(order.get("warrantyDays") or 0)
        if purchase_str0 and wd0:
            try:
                from datetime import timedelta as _td
                expiry_str = (date.fromisoformat(purchase_str0) + _td(days=wd0)).isoformat()
            except Exception:
                pass

    remaining_days = None
    if expiry_str:
        try:
            expiry = date.fromisoformat(expiry_str)
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
        if purchase_str and expiry_str:
            try:
                purchase = date.fromisoformat(purchase_str[:10])
                expiry = date.fromisoformat(expiry_str)
                total_days = max(1, (expiry - purchase).days)
                if settings.get("refund_formula") == "remaining_days":
                    refund_amount = round(price * remaining_days / total_days)
            except Exception:
                pass
        custom_text = settings.get("refund_custom_text", "")
        if settings.get("refund_formula") == "custom" and custom_text:
            refund_amount = custom_text

    # Expose resolved expiry_str so callers can use it
    result["_resolved_expiry_date"] = expiry_str or ""

    result["_remaining_days"] = remaining_days
    result["_warranty_ok"] = warranty_ok
    result["_refund_amount"] = refund_amount
    return result
