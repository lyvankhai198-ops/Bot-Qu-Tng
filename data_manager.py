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


_ZERO_WIDTH = {
    '\u200b', '\u200c', '\u200d', '\u200e', '\u200f',
    '\ufeff', '\u00ad', '\u2060', '\u2061', '\u2062', '\u2063',
    '\u180e', '\u00a0',
}

def normalize_search_query(q: str) -> str:
    """
    Chuẩn hóa query từ bàn phím font đặc biệt → ASCII tương đương:
    - Xóa zero-width / invisible characters
    - NFKC: fullwidth Ａ→A, math bold 𝐀→A, superscript, v.v.
    """
    q = ''.join(c for c in q if c not in _ZERO_WIDTH)
    import unicodedata as _ud
    q = _ud.normalize('NFKC', q)
    return q.strip()


def _canon_order_id(s: str) -> str:
    """
    Chuẩn hóa mã đơn để fuzzy-match tất cả ký tự dễ nhầm lẫn
    trong mã alphanumeric (ORDER...):
      0 ↔ O ↔ D
      1 ↔ I ↔ L
      2 ↔ Z
      5 ↔ S
      6 ↔ G ↔ B  (6 trông như G/b trong nhiều font)
      8 ↔ B      (8 trông như B)
      9 ↔ Q
    Dùng làm canonical key cho fuzzy fallback — không thay thế exact lookup.
    """
    s = s.upper()
    # Map tất cả về digit canonical
    for ch, canon in (
        ('O', '0'), ('D', '0'),           # O, D → 0
        ('I', '1'), ('L', '1'),           # I, L → 1
        ('Z', '2'),                        # Z → 2
        ('S', '5'),                        # S → 5
        ('G', '6'), ('B', '6'),           # G, B → 6
        ('Q', '9'),                        # Q → 9
    ):
        s = s.replace(ch, canon)
    return s


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
    # Normalize: Unicode font → ASCII (fullwidth, math bold/italic, zero-width...)
    query = normalize_search_query(query)

    # Normalize: strip common label prefixes
    query = re.sub(
        r'^(?:m[aã]\s*[đd][oơ]n|order\s*(?:code|id)?|email|t[àa]i\s*kho[ảa]n)\s*[:：]\s*',
        '', query.strip(), flags=re.IGNORECASE,
    ).strip()

    orders    = load("orders", {})
    all_items = load("order_items", {})

    def _return_order(match_key):
        items = all_items.get(match_key, [])
        return {
            "order": orders[match_key],
            "items": items,
            "lookupType": "order_id",
            "matchedItem": None,
            "isMultiAccountOrder": len(items) > 1,
        }

    # 1. Order ID match — exact then case-insensitive
    query_upper = query.upper()
    match_key = query_upper if query_upper in orders else (query if query in orders else None)
    if match_key:
        return _return_order(match_key)

    # 1b. Fuzzy order ID lookup — xử lý nhầm O↔0, I/l↔1
    # Ví dụ: user gõ ORDERNO8DUV5DLQ → tìm ra ORDERN08DUV5DLQ trong DB
    if not match_key:
        query_canon = _canon_order_id(query_upper)
        for key in orders:
            if _canon_order_id(key) == query_canon:
                return _return_order(key)

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

def _infer_bhf_days(product_name: str) -> int:
    """
    BHF = Bảo Hành Full (toàn chu kỳ) — suy ra số ngày BH từ tên sản phẩm.
    Ví dụ: "Grok 1 Năm BHF" → 365, "ChatGPT 6 Tháng BHF" → 180, "Tool 30 Ngày BHF" → 30.
    Trả về 0 nếu không suy ra được.
    """
    import unicodedata as _ud
    # Strip diacritics để khớp không phân biệt dấu tiếng Việt
    norm = _ud.normalize('NFD', product_name.upper()).encode('ascii', 'ignore').decode('ascii')
    m = re.search(r'(\d+)\s*NAM\b', norm)           # Năm / Nam
    if m: return int(m.group(1)) * 365
    m = re.search(r'(\d+)\s*YEAR[S]?\b', norm)      # Year / Years (English)
    if m: return int(m.group(1)) * 365
    m = re.search(r'(\d+)\s*THANG\b', norm)         # Tháng / Thang
    if m: return int(m.group(1)) * 30
    m = re.search(r'(\d+)\s*MONTH[S]?\b', norm)     # Month / Months (English)
    if m: return int(m.group(1)) * 30
    m = re.search(r'(\d+)\s*NGAY\b', norm)          # Ngày / Ngay
    if m: return int(m.group(1))
    m = re.search(r'(\d+)\s*DAY[S]?\b', norm)       # Day / Days (English, e.g. 30DAY)
    if m: return int(m.group(1))
    return 0

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

    # ── Warranty type detection from product name ──────────────────────────
    # KBH = Không Bảo Hành (no warranty at all)
    # XD  = X-day warranty override (e.g. "1D", "2D" in product name)
    _pname_upper = (item.get("productName") or order.get("productName") or "").upper()
    _is_kbh = bool(re.search(r'\bKBH\b', _pname_upper))
    # XD override applies only to non-KBH products
    if not _is_kbh:
        _day_m = re.search(r'(?<!\d)(\d{1,2})D\b', _pname_upper)
        if _day_m:
            warranty_days = int(_day_m.group(1))

    # BHF = Bảo Hành Full (toàn chu kỳ) — suy ra số ngày từ tên SP nếu warrantyDays = 0
    if not _is_kbh and warranty_days == 0 and re.search(r'\bBHF\b', _pname_upper):
        warranty_days = _infer_bhf_days(
            item.get("productName") or order.get("productName") or ""
        )

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

    # Block if this specific item was individually refunded
    if item.get("item_status") == "refunded":
        can_report = False
        warranty_status = "refunded"

    # Block warranty reporting for orders that were already refunded
    elif order.get("status") == "refunded":
        can_report = False

    # KBH = Không Bảo Hành — no warranty regardless of dates
    if _is_kbh:
        can_report      = False
        warranty_status = "no_warranty"
        remaining_days  = None

    # Pro-rated refund
    refund_amount = 0
    price = order.get("price", 0) or 0
    refund_formula = settings.get("refund_formula", "remaining_days")
    if not _is_kbh and remaining_days and remaining_days > 0 and price and warranty_days:
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
        "isKBH": _is_kbh,
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

def get_refund_record_by_account(order_id: str = None, account: str = None) -> dict | None:
    """Return the most recent refund record matching order_id and/or account email."""
    history = load("refund_history", [])
    matches = []
    if order_id and account:
        matches = [r for r in history if r.get("orderId") == order_id and
                   (r.get("account") or r.get("email") or "").lower() == (account or "").lower()]
    if not matches and order_id:
        matches = [r for r in history if r.get("orderId") == order_id]
    if not matches and account:
        matches = [r for r in history if (r.get("account") or r.get("email") or "").lower() == (account or "").lower()]
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

# ─── Check-in (Điểm danh hằng ngày) ──────────────────────────────────────────

def get_checkin_settings() -> dict:
    defaults = {
        "enabled": True,
        "hour": 7,
        "minute": 0,
        "timezone": "Asia/Ho_Chi_Minh",
        "points_per_day": 10,
        "streak_bonuses": [
            {"days": 7,  "bonus_points": 20},
            {"days": 30, "bonus_points": 100},
        ],
    }
    return {**defaults, **(load("checkin_settings", {}) or {})}

def get_checkin_record(user_id: int) -> dict:
    return load("checkin_records", {}).get(str(user_id), {})

def do_checkin(user_id: int) -> dict:
    """
    Perform a check-in for the user. Awards points and updates streak.
    Returns: { ok, already, points, bonus, streak, total_points }
    """
    from datetime import timedelta
    uid = str(user_id)
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()

    settings = get_checkin_settings()
    points_per_day  = int(settings.get("points_per_day", 10))
    streak_bonuses  = settings.get("streak_bonuses", [])

    records = load("checkin_records", {})
    rec = records.get(uid, {})

    if rec.get("last_checkin") == today:
        return {"ok": False, "already": True,
                "streak": rec.get("streak", 0),
                "total_points": rec.get("total_points", 0)}

    # Streak: continues only if user checked in yesterday
    last = rec.get("last_checkin", "")
    streak = (rec.get("streak", 0) + 1) if last == yesterday else 1

    # Milestone bonus
    bonus = 0
    for sb in streak_bonuses:
        if streak == int(sb.get("days", 0)):
            bonus = int(sb.get("bonus_points", 0))
            break

    earned       = points_per_day + bonus
    total_points = rec.get("total_points", 0) + earned
    total_ci     = rec.get("total_checkins", 0) + 1

    records[uid] = {
        "user_id":       user_id,
        "last_checkin":  today,
        "streak":        streak,
        "total_points":  total_points,
        "total_checkins": total_ci,
    }
    save("checkin_records", records)

    # Update daily log — total points distributed
    logs = load("checkin_logs", {})
    dl   = logs.get(today, {})
    logs[today] = {**dl, "total_points_distributed": dl.get("total_points_distributed", 0) + earned}
    save("checkin_logs", logs)

    return {"ok": True, "already": False,
            "points": points_per_day, "bonus": bonus,
            "streak": streak, "total_points": total_points}

def was_checkin_notif_sent_today(tz_name: str = "Asia/Ho_Chi_Minh") -> bool:
    """True if the check-in notification has already been triggered today (in tz_name)."""
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(tz=ZoneInfo(tz_name)).strftime("%Y-%m-%d")
    except Exception:
        today = datetime.utcnow().strftime("%Y-%m-%d")
    return bool(load("checkin_logs", {}).get(today, {}).get("triggered_at"))

def mark_checkin_triggered(tz_name: str = "Asia/Ho_Chi_Minh") -> str:
    """
    Mark that the scheduled notification was triggered (prevents double-fire).
    Returns today's date string in tz_name.
    """
    try:
        from zoneinfo import ZoneInfo
        now_tz = datetime.now(tz=ZoneInfo(tz_name))
    except Exception:
        now_tz = datetime.utcnow()
    today = now_tz.strftime("%Y-%m-%d")
    logs = load("checkin_logs", {})
    dl   = logs.get(today, {})
    logs[today] = {**dl, "triggered_at": now_tz.isoformat()}
    save("checkin_logs", logs)
    return today

def update_checkin_log_sent(today: str, sent: int, failed: int):
    logs = load("checkin_logs", {})
    dl   = logs.get(today, {})
    logs[today] = {
        **dl,
        "sent":   dl.get("sent",   0) + sent,
        "failed": dl.get("failed", 0) + failed,
    }
    save("checkin_logs", logs)

# ─── Order display helper ─────────────────────────────────────────────────

# ─── Gift boxes (Ô Quà Bí Mật) ───────────────────────────────────────────────

import threading as _threading
_gb_locks: dict = {}
_gb_locks_mutex = _threading.Lock()

def _get_gb_lock(event_id: str) -> _threading.Lock:
    with _gb_locks_mutex:
        if event_id not in _gb_locks:
            _gb_locks[event_id] = _threading.Lock()
        return _gb_locks[event_id]

def get_gift_boxes() -> list:
    return load("gift_boxes", [])

def save_gift_boxes(events: list) -> None:
    save("gift_boxes", events)

def open_gift_box(event_id: str, box_index: int, user_id: int,
                  username: str, first_name: str) -> dict:
    """Thread-safe box opening. Returns status dict."""
    lock = _get_gb_lock(event_id)
    with lock:
        events = get_gift_boxes()
        ev_idx = next((i for i, e in enumerate(events) if e.get("id") == event_id), -1)
        if ev_idx == -1:
            return {"status": "not_found"}

        event = events[ev_idx]
        now_dt = datetime.now()

        end_str = (event.get("endTime") or "").strip()
        if end_str:
            try:
                if now_dt > datetime.fromisoformat(end_str):
                    return {"status": "event_ended", "event": event}
            except Exception:
                pass

        boxes = event.get("boxes", [])
        if box_index < 0 or box_index >= len(boxes):
            return {"status": "not_found"}

        box = boxes[box_index]
        if box.get("opened"):
            return {"status": "already_opened"}

        max_picks = int(event.get("maxPicksPerUser", 1))
        user_picks = sum(1 for b in boxes if b.get("openedBy") == user_id)
        if user_picks >= max_picks:
            return {"status": "max_picks_reached", "max": max_picks}

        prize_id = box.get("prizeId")
        prizes = event.get("prizes", [])
        prize = next((p for p in prizes if p.get("id") == prize_id), None)

        boxes[box_index] = {
            **box,
            "opened": True,
            "openedBy": user_id,
            "openedByName": (first_name or username or str(user_id))[:20],
            "openedAt": now_dt.isoformat(),
        }
        events[ev_idx]["boxes"] = boxes
        save_gift_boxes(events)
        return {"status": "ok", "prize": prize, "event": events[ev_idx]}

def add_gift_box_reward(user_id: int, reward_type: str, amount: float) -> None:
    rewards = load("gift_box_rewards", {})
    uid = str(user_id)
    if uid not in rewards:
        rewards[uid] = {"points": 0, "balance": 0}
    if reward_type == "points":
        rewards[uid]["points"] = rewards[uid].get("points", 0) + amount
    elif reward_type == "balance":
        rewards[uid]["balance"] = rewards[uid].get("balance", 0) + amount
    save("gift_box_rewards", rewards)

def add_voucher(user_id: int, code: str, label: str, value: str) -> None:
    vouchers = load("vouchers", [])
    vouchers.append({
        "id": str(uuid.uuid4())[:8],
        "userId": user_id,
        "code": code,
        "label": label,
        "value": value,
        "createdAt": datetime.now().isoformat(),
        "used": False,
    })
    save("vouchers", vouchers)

# ─── Secret codes (Săn mã bí mật) ───────────────────────────────────────────

def get_secret_codes() -> list:
    return load("secret_codes", [])

def save_secret_codes(codes: list) -> None:
    save("secret_codes", codes)

def validate_secret_code(code_str: str, user_id: int, username: str, first_name: str, ip: str = "") -> dict:
    """
    Validate a secret code entry attempt.
    Returns dict with:
      status: "ok" | "not_found" | "disabled" | "not_started" | "expired"
              | "exhausted" | "already_claimed"
      code:   the matched code dict (present on all statuses except not_found)
    On "ok", winner is recorded in the code's winners list.
    """
    codes = get_secret_codes()
    now_dt = datetime.now()
    code_upper = code_str.strip().upper()

    matched = None
    matched_idx = -1
    for i, c in enumerate(codes):
        if c.get("code", "").strip().upper() == code_upper:
            matched = c
            matched_idx = i
            break

    if matched is None:
        return {"status": "not_found"}

    if not matched.get("enabled", False):
        return {"status": "disabled", "code": matched}

    start_str = (matched.get("startTime") or "").strip()
    if start_str:
        try:
            if now_dt < datetime.fromisoformat(start_str):
                return {"status": "not_started", "code": matched}
        except Exception:
            pass

    end_str = (matched.get("endTime") or "").strip()
    if end_str:
        try:
            if now_dt > datetime.fromisoformat(end_str):
                return {"status": "expired", "code": matched}
        except Exception:
            pass

    winners = matched.get("winners", [])
    max_w = matched.get("maxWinners", 0)
    if max_w and len(winners) >= int(max_w):
        return {"status": "exhausted", "code": matched}

    if matched.get("onePerUser", True):
        for w in winners:
            if int(w.get("userId", 0)) == user_id:
                return {"status": "already_claimed", "code": matched}

    # Record winner
    winners.append({
        "userId": user_id,
        "username": username or "",
        "firstName": first_name or "",
        "time": now_dt.isoformat(),
        "ip": ip or "",
    })
    codes[matched_idx]["winners"] = winners
    save_secret_codes(codes)
    return {"status": "ok", "code": codes[matched_idx]}

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
        # BHF inference: khi warrantyDays = 0, suy ra từ tên sản phẩm
        if not wd0:
            _pname_bhf = (order.get("productName") or "").upper()
            if re.search(r'\bBHF\b', _pname_bhf):
                wd0 = _infer_bhf_days(order.get("productName") or "")
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

    # KBH detection for legacy/order-level path
    _pname_kbh = (order.get("productName") or "").upper()
    _is_kbh_ord = bool(re.search(r'\bKBH\b', _pname_kbh))

    # warranty_ok: dùng warrantyExpiry nếu có, fallback về expiryDate
    warranty_str = (
        order.get("warrantyExpiry", "") or order.get("warrantyDate", "") or
        order.get("expiryDate", "") or expiry_str or ""
    )
    warranty_ok = None
    if warranty_str:
        try:
            warranty_date = date.fromisoformat(warranty_str[:10])
            warranty_ok = warranty_date >= today
        except Exception:
            pass

    # KBH overrides: no warranty regardless of dates
    if _is_kbh_ord:
        warranty_ok = False

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
    result["_is_kbh"] = _is_kbh_ord
    return result


# ─── Delivery Requests ──────────────────────────────────────────────────────

def get_delivery_requests() -> list:
    return load("delivery_requests", [])


def get_delivery_reminder_settings() -> dict:
    defaults = {"enabled": True, "reminderMinutes": [10, 30, 60]}
    stored = load("delivery_reminder_settings", {}) or {}
    merged = {**defaults, **stored}
    # Ensure reminderMinutes is a valid sorted list of ints
    try:
        minutes = sorted(int(x) for x in merged["reminderMinutes"] if int(x) > 0)
        merged["reminderMinutes"] = minutes or defaults["reminderMinutes"]
    except Exception:
        merged["reminderMinutes"] = defaults["reminderMinutes"]
    return merged


def save_delivery_reminder_settings(data: dict) -> dict:
    current = load("delivery_reminder_settings", {}) or {}
    updated = {**current, **data}
    save("delivery_reminder_settings", updated)
    return updated


def add_delivery_request(user_id: int, username: str, first_name: str,
                          order_id: str, user_lang: str = "vi",
                          first_reminder_at: str | None = None) -> str:
    requests = load("delivery_requests", [])
    req = {
        "id": str(uuid.uuid4())[:12],
        "userId": str(user_id),
        "username": username or "",
        "firstName": first_name or "",
        "orderId": order_id,
        "userLang": user_lang,
        "submittedAt": datetime.now().isoformat(),
        "status": "pending",           # pending | sent | failed
        "sentAt": None,
        "sentBy": None,
        "accountInfo": None,           # dict: {account, password, twoFA} when sent
        # ── Reminder tracking ──
        "reminderEnabled": True,
        "reminderCount": 0,
        "nextReminderAt": first_reminder_at,   # ISO str or None
        "reminderProcessing": False,
        "lastReminderAt": None,
    }
    requests.append(req)
    save("delivery_requests", requests)
    return req["id"]


def update_delivery_request(req_id: str, fields: dict) -> bool:
    requests = load("delivery_requests", [])
    for req in requests:
        if req.get("id") == req_id:
            req.update(fields)
            save("delivery_requests", requests)
            return True
    return False


def get_delivery_request(req_id: str):
    for req in load("delivery_requests", []):
        if req.get("id") == req_id:
            return req
    return None


def get_delivery_request_by_order(order_id: str):
    """Return the latest delivery request for an orderId."""
    matches = [r for r in load("delivery_requests", []) if r.get("orderId") == order_id]
    return matches[-1] if matches else None


def unlock_delivery_order(order_id: str):
    """
    Mark ALL manual_delivery items for this order as unlocked.
    Also updates delivery_requests status → 'sent' and orders status → 'active'.
    Returns a list of all unlocked item dicts, or [] if none found.
    """
    all_items = load("order_items", {})
    items = all_items.get(order_id, [])
    unlocked_now = datetime.now().isoformat()
    result = []

    for i, item in enumerate(items):
        if item.get("source") == "manual_delivery" or item.get("email"):
            items[i] = {**item, "unlocked": True, "unlockedAt": unlocked_now}
            result.append(items[i])

    if not result:
        return []

    all_items[order_id] = items
    save("order_items", all_items)

    # Update delivery_requests: pending_unlock → sent
    requests = load("delivery_requests", [])
    for req in requests:
        if req.get("orderId") == order_id and req.get("status") == "pending_unlock":
            req.update({
                "status": "sent",
                "sentAt": unlocked_now,
                "deliveredViaBot": True,
            })
    save("delivery_requests", requests)

    # Update order status → active if still pending
    orders = load("orders", {})
    if order_id in orders and orders[order_id].get("status") in ("pending", None, ""):
        orders[order_id]["status"] = "active"
        orders[order_id]["updatedAt"] = unlocked_now
        save("orders", orders)

    return result
