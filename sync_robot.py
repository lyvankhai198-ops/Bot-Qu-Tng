#!/usr/bin/env python3
"""
sync_robot.py — Auto Sync Robot
Tự động đăng nhập website bán hàng, tải XLSX, import đơn hàng.
Chạy nền 24/7 theo chu kỳ cấu hình.
"""
import os
import sys
import json
import time
import asyncio
import logging
import threading
import tempfile
import traceback
import shutil
import re
import unicodedata
import urllib.request
import urllib.error
from datetime import datetime, timezone, date, timedelta
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DATA_DIR    = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
CONFIG_FILE  = DATA_DIR / "sync_robot_config.json"
STATUS_FILE  = DATA_DIR / "sync_robot_status.json"
LOG_FILE     = DATA_DIR / "sync_robot_logs.json"
TRIGGER_FILE = DATA_DIR / "sync_robot_trigger.json"

MAX_LOGS = 200

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [robot] %(levelname)s %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger("sync_robot")

# ── Auto-install Playwright browser ───────────────────────────────────────────
def ensure_playwright_browser():
    """Cài Chromium nếu chưa có. Chạy một lần khi khởi động."""
    try:
        import subprocess as _sp
        result = _sp.run(
            [sys.executable, "-m", "playwright", "install", "chromium", "--with-deps"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode == 0:
            logger.info("[robot] Playwright chromium OK")
        else:
            logger.warning(f"[robot] playwright install: {result.stderr[:200]}")
    except Exception as e:
        logger.warning(f"[robot] ensure_playwright_browser: {e}")

# ── Thread lock (prevent concurrent sync runs) ─────────────────────────────────
_run_lock = threading.Lock()

# ── JSON helpers ───────────────────────────────────────────────────────────────
def load_json(path, default):
    try:
        p = Path(path)
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def save_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(p) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(p))

def now_iso():
    return datetime.now(timezone.utc).isoformat()

# ── Status / log helpers ───────────────────────────────────────────────────────
def write_status(running: bool, last_run=None, next_run_at=None):
    status = load_json(STATUS_FILE, {})
    status["running"]    = running
    status["updated_at"] = now_iso()
    if last_run is not None:
        status["last_run"] = last_run
    if next_run_at is not None:
        status["next_run_at"] = next_run_at
    save_json(STATUS_FILE, status)

def append_log(entry: dict):
    logs = load_json(LOG_FILE, [])
    logs.append(entry)
    if len(logs) > MAX_LOGS:
        logs = logs[-MAX_LOGS:]
    save_json(LOG_FILE, logs)

def load_config() -> dict:
    return load_json(CONFIG_FILE, {})

# ── XLSX parsing (ported from xlsxUtils.ts) ────────────────────────────────────
def normalize_vn(s: str) -> str:
    s = str(s).lower()
    s = s.replace("đ", "d").replace("Đ", "d")
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)
    s = s.replace("supper", "super")
    s = re.sub(r"[-_\s]+", " ", s).strip()
    return s

COL_ALIASES = {
    "stt":                   "stt",
    "ma don":                "orderCode",
    "ma don hang":           "orderCode",
    "ordercode":             "orderCode",
    "order code":            "orderCode",
    "order id":              "orderCode",
    "san pham":              "productName",
    "ten san pham":          "productName",
    "product":               "productName",
    "product name":          "productName",
    "so luong":              "quantity",
    "sl":                    "quantity",
    "quantity":              "quantity",
    "qty":                   "quantity",
    "so tien":               "totalPrice",
    "tong tien":             "totalPrice",
    "amount":                "totalPrice",
    "total price":           "totalPrice",
    "total":                 "totalPrice",
    "gia":                   "totalPrice",
    "trang thai":            "status",
    "status":                "status",
    "khach hang":            "customerName",
    "customer":              "customerName",
    "customer name":         "customerName",
    "ten khach":             "customerName",
    "email slot":            "customerEmail",
    "customer email":        "customerEmail",
    "email khach":           "customerEmail",
    "email":                 "customerEmail",
    "tao luc":               "createdAt",
    "created at":            "createdAt",
    "ngay tao":              "createdAt",
    "thanh toan":            "paymentAt",
    "payment at":            "paymentAt",
    "ngay thanh toan":       "paymentAt",
    "da giao":               "deliveredAt",
    "delivered at":          "deliveredAt",
    "ngay giao":             "deliveredAt",
    "tai khoan da giao":     "deliveredAccounts",
    "delivered accounts":    "deliveredAccounts",
    "accounts":              "deliveredAccounts",
    "tai khoan":             "deliveredAccounts",
}

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

def detect_columns(headers: list) -> dict:
    col_map = {}
    for i, h in enumerate(headers):
        norm = normalize_vn(str(h or ""))
        if norm and norm in COL_ALIASES:
            col_map[i] = COL_ALIASES[norm]
    return col_map

def parse_date(val) -> str | None:
    if val is None or val == "":
        return None
    # datetime/date from openpyxl
    if hasattr(val, "strftime"):
        return val.strftime("%Y-%m-%d")
    s = str(val).strip()
    if not s:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    m = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", s)
    if m:
        d2, mo, y = m.group(1), m.group(2), m.group(3)
        return f"{y}-{mo.zfill(2)}-{d2.zfill(2)}"
    m = re.search(r"(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})", s)
    if m:
        y, mo, d2 = m.group(1), m.group(2), m.group(3)
        return f"{y}-{mo.zfill(2)}-{d2.zfill(2)}"
    # Excel serial
    try:
        n = float(s)
        if 40000 < n < 60000:
            epoch = datetime(1899, 12, 30, tzinfo=timezone.utc)
            dt = epoch + timedelta(days=n)
            return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return None

def parse_price(val) -> int:
    if val is None or val == "":
        return 0
    if isinstance(val, (int, float)):
        return int(round(val))
    s = str(val).strip()
    s = re.sub(r"[đĐ₫\s]", "", s, flags=re.IGNORECASE)
    s = re.sub(r"vnd", "", s, flags=re.IGNORECASE)
    k = re.match(r"^([\d.,]+)k$", s, re.IGNORECASE)
    if k:
        return int(round(float(re.sub(r"[.,]", "", k.group(1))) * 1000))
    s = s.replace(".", "").replace(",", "")
    try:
        return int(s) or 0
    except Exception:
        return 0

def parse_single_account_line(line: str):
    segments = [seg.strip() for seg in line.split("|")]
    cred_raw = segments[0]
    meta_two_fa = ""
    for seg in segments[1:]:
        m = re.match(r"^Verify:\s*(.+)$", seg, re.IGNORECASE)
        if m:
            meta_two_fa = m.group(1).strip()
            break
    if not cred_raw:
        return None
    email, password, two_fa = "", "", meta_two_fa
    if "/" in cred_raw:
        parts = [p.strip() for p in cred_raw.split("/")]
        email    = parts[0]
        password = parts[1] if len(parts) > 1 else ""
        two_fa   = parts[2] if len(parts) > 2 else meta_two_fa
    elif ":" in cred_raw:
        parts    = cred_raw.split(":")
        email    = parts[0]
        password = parts[1] if len(parts) > 1 else ""
        two_fa   = parts[2] if len(parts) > 2 else meta_two_fa
    else:
        email = cred_raw
    email    = email.strip()
    password = password.strip()
    two_fa   = two_fa.strip()
    m = EMAIL_RE.search(email)
    if m:
        return {"email": m.group(0), "password": password, "twoFA": two_fa, "valid": True}
    if email:
        return {"email": email, "password": password, "twoFA": two_fa, "valid": False}
    return None

def parse_accounts(val) -> list:
    if val is None or val == "":
        return []
    s = str(val).strip()
    if not s:
        return []
    lines = [l.strip() for l in s.split("\n") if l.strip()] if "\n" in s else [s]
    return [a for a in (parse_single_account_line(l) for l in lines) if a]

def map_status(val) -> str:
    s = normalize_vn(str(val or ""))
    if s in ("completed", "delivered", "success", "da giao", "hoan thanh"):
        return "active"
    if s in ("pending", "cho xu ly"):
        return "pending"
    if s in ("cancelled", "canceled", "da huy", "huy"):
        return "cancelled"
    return "active"

def fuzzy_match_product(name: str, products: list) -> str | None:
    if not name or not products:
        return None
    norm = normalize_vn(name)
    for p in products:
        if normalize_vn(p) == norm:
            return p
    for p in products:
        np = normalize_vn(p)
        if np in norm or norm in np:
            return p
    name_tokens = set(t for t in norm.split() if len(t) > 1)
    best, best_score = None, 0
    for p in products:
        p_tokens = [t for t in normalize_vn(p).split() if len(t) > 1]
        overlap = sum(1 for t in p_tokens if t in name_tokens)
        score = overlap / max(len(name_tokens), len(p_tokens), 1)
        if score > best_score and score >= 0.5:
            best_score = score
            best = p
    return best

def add_days_to_date(date_str: str, days: int) -> str | None:
    if not date_str or not days:
        return None
    try:
        d = date.fromisoformat(date_str)
        return (d + timedelta(days=days)).isoformat()
    except Exception:
        return None

def parse_xlsx_to_rows(xlsx_path: str, known_products: list, existing_order_ids: set, existing_item_emails: set) -> list:
    """Parse XLSX → list of rows compatible with /bot/orders/xlsx-import."""
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl not installed. Run: pip install openpyxl")

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = iter(ws.rows)

    col_map = {}
    for row in rows_iter:
        raw = [cell.value for cell in row]
        cm = detect_columns([str(h or "") for h in raw])
        if "orderCode" in cm.values() and "deliveredAccounts" in cm.values():
            col_map = cm
            break

    if not col_map or "orderCode" not in col_map.values():
        wb.close()
        raise RuntimeError("Không tìm thấy cột Mã đơn và Tài khoản đã giao trong file XLSX")

    product_names = [p["name"] for p in known_products]

    def get(cells, field):
        for idx, f in col_map.items():
            if f == field and idx < len(cells):
                return cells[idx]
        return None

    parsed_rows = []
    for row in rows_iter:
        cells = [cell.value for cell in row]
        if all(c is None or str(c).strip() == "" for c in cells):
            continue

        order_code = str(get(cells, "orderCode") or "").strip().upper()
        if not order_code:
            continue

        product_name_raw = str(get(cells, "productName") or "").strip()
        qty_raw = get(cells, "quantity")
        try:
            quantity = int(str(qty_raw).strip()) if qty_raw is not None else 1
        except Exception:
            quantity = 1
        total_price        = parse_price(get(cells, "totalPrice"))
        customer_name      = str(get(cells, "customerName") or "").strip()
        customer_email     = str(get(cells, "customerEmail") or "").strip()
        created_at         = parse_date(get(cells, "createdAt"))
        payment_at         = parse_date(get(cells, "paymentAt"))
        delivered_at       = parse_date(get(cells, "deliveredAt"))
        purchase_date      = payment_at or delivered_at or created_at
        original_delivered = delivered_at or payment_at or created_at

        product_name_mapped = fuzzy_match_product(product_name_raw, product_names)
        matched = next((p for p in known_products if p["name"] == product_name_mapped), None)
        warranty_days = matched["warrantyDays"] if matched else 0
        usage_days    = matched["usageDays"]    if matched else 0

        expiry_date      = add_days_to_date(original_delivered, usage_days)    if original_delivered and usage_days    else None
        warranty_end_date = add_days_to_date(original_delivered, warranty_days) if original_delivered and warranty_days else None

        accounts    = parse_accounts(get(cells, "deliveredAccounts"))
        status      = map_status(get(cells, "status"))
        unit_price  = round(total_price / quantity) if quantity > 0 and total_price > 0 else total_price
        dup_order   = order_code in existing_order_ids
        dup_emails  = [a["email"] for a in accounts if a.get("valid") and a["email"].lower() in existing_item_emails]

        parsed_rows.append({
            "rowIndex":           len(parsed_rows),
            "orderCode":          order_code,
            "productNameRaw":     product_name_raw,
            "productNameMapped":  product_name_mapped,
            "quantity":           quantity,
            "totalPrice":         total_price,
            "unitPrice":          unit_price,
            "status":             status,
            "customerName":       customer_name,
            "customerEmail":      customer_email,
            "purchaseDate":       purchase_date,
            "originalDeliveredAt": original_delivered,
            "expiryDate":         expiry_date,
            "warrantyEndDate":    warranty_end_date,
            "warrantyDays":       warranty_days,
            "usageDays":          usage_days,
            "accounts":           accounts,
            "issues":             [],
            "rowStatus":          "valid",
            "conflictAction":     "add_missing",   # auto: thêm tài khoản mới vào đơn cũ
            "dupOrderExists":     dup_order,
            "dupAccountEmails":   dup_emails,
        })

    wb.close()
    return parsed_rows

# ── Internal API caller ────────────────────────────────────────────────────────
def get_admin_token(config: dict) -> str:
    return (
        os.environ.get("ADMIN_API_TOKEN", "")
        or config.get("admin_token", "")
        or (load_json(DATA_DIR / "settings.json", {}) or {}).get("sessionSecret", "")
        or os.environ.get("SESSION_SECRET", "")
    )

def call_api(method: str, path: str, body=None, token: str = "") -> dict:
    api_base = os.environ.get("API_BASE_URL", "http://localhost:8080")
    url = f"{api_base}/api{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = ""
        try:
            body_text = e.read().decode("utf-8")
        except Exception:
            pass
        return {"ok": False, "error": f"HTTP {e.code}: {body_text[:200]}"}
    except Exception as ex:
        return {"ok": False, "error": str(ex)}

def get_known_products(token: str) -> list:
    resp = call_api("GET", "/bot/settings", token=token)
    raw = resp.get("products", [])
    if isinstance(raw, list):
        return [{"name": p.get("name", ""), "warrantyDays": p.get("warrantyDays", 0), "usageDays": p.get("usageDays", 0)} for p in raw]
    return []

def get_existing_sets(token: str) -> tuple:
    resp = call_api("GET", "/bot/sync-robot/existing-sets", token=token)
    order_ids   = set(resp.get("orderIds", []))
    item_emails = set(e.lower() for e in resp.get("itemEmails", []))
    return order_ids, item_emails

# ══════════════════════════════════════════════════════════════════════════════
# Shared login helpers — dùng chung cho cả Sync và Test-login
# ══════════════════════════════════════════════════════════════════════════════

# Selector ưu tiên: username trước email (canboso.com dùng input[name="username"])
_ACCOUNT_SELECTORS = [
    'input[name="username"]',
    'input[name="email"]',
    'input[name="user"]',
    'input[name="login"]',
    'input[name="phone"]',
    'input[type="email"]',
    'input[id="email"]',
    'input[id="username"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    'input[placeholder*="tài khoản" i]',
    'input[placeholder*="user" i]',
    'input[placeholder*="mail" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="điện thoại" i]',
]
_PW_SELECTORS = [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="pass"]',
    'input[id="password"]',
    'input[autocomplete="current-password"]',
]
# Ưu tiên text selector đã test thành công trên canboso.com
_SUBMIT_SELECTORS = [
    'button:has-text("Đăng nhập")',
    'button:has-text("Đăng Nhập")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("LOG IN")',
    'button:has-text("Signin")',
    'button[type="submit"]',
    'input[type="submit"]',
    '[data-testid*="login"]',
    '[data-testid*="submit"]',
    'form button:visible',
]
_ERROR_SELECTORS = [
    '[role="alert"]',
    '.alert-danger', '.alert-error', '.alert-warning',
    '[class*="error-message"]', '[class*="error_message"]',
    '[class*="form-error"]', '.form__error',
    'p.error', 'span.error', 'div.error',
    '.notification--error', '.flash--error',
    '[data-testid*="error"]',
    '.message.error', '.msg-error',
    'ul.errorlist li',
]
_LOGOUT_SELECTORS = [
    'a[href*="logout"]', 'a[href*="signout"]', 'a[href*="sign-out"]',
    'button:has-text("Logout")', 'button:has-text("Sign out")',
    'button:has-text("Đăng xuất")', 'a:has-text("Đăng xuất")',
    '[data-testid*="logout"]', '[aria-label*="logout" i]',
    '.user-menu', '.account-menu', '.avatar',
]
_LOGIN_URL_KEYWORDS = ("login", "signin", "sign-in", "auth/login", "/account/login", "/user/login")


def _build_login_url(site_url: str, override: str = "") -> str:
    """Tạo URL login chuẩn — tránh double slash hay /login/login."""
    if override and override.strip():
        return override.rstrip("/")
    base = site_url.rstrip("/")
    if base.endswith("/login"):
        return base
    return f"{base}/login"

async def _find_visible(page, selectors: list) -> str | None:
    """Tìm selector đầu tiên có element visible trên trang."""
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.count() > 0 and await el.is_visible():
                return sel
        except Exception:
            pass
    return None

async def _get_page_error_text(page) -> str:
    """Lấy text lỗi hiển thị trên trang, loại bỏ base64."""
    for sel in _ERROR_SELECTORS:
        try:
            el = page.locator(sel).first
            if await el.count() > 0 and await el.is_visible():
                t = (await el.inner_text()).strip()
                if t:
                    # Loại base64
                    t = re.sub(r'[A-Za-z0-9+/]{80,}={0,2}', '', t).strip()
                    if t:
                        return t[:300]
        except Exception:
            pass
    return ""

async def _is_logged_in(page) -> tuple[bool, str]:
    """
    Kiểm tra phiên đăng nhập THỰC SỰ.
    KHÔNG chấp nhận chỉ URL đổi khỏi /login, tiêu đề trang, hay toast tạm thời.
    Cần ít nhất một trong:
    - Cookie xác thực thực tế (không phải app_locale/login_lang)
    - localStorage chứa key có hint token/auth/session/jwt/user/access
    - Nút đăng xuất / avatar tài khoản hiển thị
    """
    curr = page.url

    # Nếu vẫn ở trang /login → chắc chắn chưa đăng nhập
    if any(kw in curr.lower() for kw in _LOGIN_URL_KEYWORDS):
        return False, f"Vẫn ở trang login — URL={curr}"

    # Tín hiệu 1: Cookie xác thực (loại trừ cookie nhiễu UI)
    _NOISE_COOKIES = {"app_locale", "login_lang"}
    all_cookies: list = []
    auth_cookies: list = []
    try:
        all_cookies = await page.context.cookies()
        auth_cookies = [c["name"] for c in all_cookies if c["name"] not in _NOISE_COOKIES]
    except Exception:
        pass

    # Tín hiệu 2: localStorage chứa key token/session
    auth_ls: list = []
    try:
        ls_keys = await page.evaluate("""() => {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            return keys;
        }""")
        _TOKEN_HINTS = ("token", "access", "auth", "jwt", "session", "user")
        auth_ls = [k for k in (ls_keys or []) if any(h in k.lower() for h in _TOKEN_HINTS)]
    except Exception:
        pass

    # Tín hiệu 3: Nút đăng xuất / avatar tài khoản
    has_logout = await _find_visible(page, _LOGOUT_SELECTORS) is not None

    if auth_cookies:
        return True, f"Cookie xác thực: {auth_cookies}"
    if auth_ls:
        return True, f"localStorage token: {auth_ls}"
    if has_logout:
        return True, "Tìm thấy nút đăng xuất/avatar"

    all_names = [c["name"] for c in all_cookies]
    return False, (
        f"URL đổi sang {curr} nhưng không có token xác thực — "
        f"Cookies có: {all_names if all_names else 'trống'}"
    )

async def loginAndWaitReady(page, config: dict, log_fn=None, step_fn=None, source: str = "sync") -> str:
    """
    Hàm đăng nhập DUY NHẤT — dùng bởi CẢ Test Login VÀ Sync.
    Không được tạo bản copy riêng ở nơi nào khác.

    log_fn(msg): callback ghi log tùy chọn.
    step_fn(label, ok, note): callback ghi step chi tiết (chỉ Test Login truyền vào).
    Trả về URL sau khi đăng nhập thành công.
    Raise RuntimeError nếu thất bại.
    """
    from playwright.async_api import TimeoutError as PwTimeout

    def _log(msg: str):
        if log_fn: log_fn(msg)
        else: logger.info(msg)

    def _step(label: str, ok: bool, note: str = ""):
        if step_fn: step_fn(label, ok, note)
        _log(f"[login] {'✅' if ok else '❌'} {label}" + (f" — {note[:200]}" if note else ""))

    site_url  = config.get("site_url", "").rstrip("/")
    login_url = _build_login_url(site_url, config.get("login_url", ""))
    account   = config.get("email", "")
    password  = config.get("password", "")

    _log(f"[AUTH] Source: {source}")
    _log(f"[AUTH] Username loaded: {'yes' if account else 'NO'}")
    _log(f"[AUTH] Password loaded: {'yes' if password else 'NO'}")

    if not account or not password:
        missing = []
        if not account:  missing.append("tài khoản")
        if not password: missing.append("mật khẩu")
        raise RuntimeError(f"Chưa có {', '.join(missing)} trong cấu hình đã lưu")

    # 1. Mở trang login
    _log(f"[login] Mở trang: {login_url}")
    try:
        await page.goto(login_url, timeout=30_000, wait_until="domcontentloaded")
        _step("Mở trang login", True, f"URL: {page.url}")
    except Exception as ex:
        _step("Mở trang login", False, f"Lỗi: {ex}")
        raise RuntimeError(f"Không mở được trang login: {ex}")

    # 1b. Nếu website tự redirect ra khỏi trang login → đã đăng nhập sẵn
    if not any(kw in page.url.lower() for kw in _LOGIN_URL_KEYWORDS):
        _step("Phát hiện phiên đăng nhập sẵn", True, f"URL: {page.url}")
        return page.url

    # 2. Chờ form render
    _log("[login] Chờ form đăng nhập render...")
    try:
        await page.locator('input[name="username"]').first.wait_for(state="visible", timeout=30_000)
        _log("[login] Form sẵn sàng (input[name='username'] visible)")
    except PwTimeout:
        try:
            await page.locator('input[type="email"]').first.wait_for(state="visible", timeout=10_000)
            _log("[login] Form sẵn sàng (input[type='email'] visible)")
        except PwTimeout:
            _log("[login] Form chưa visible sau 40s — tiếp tục")

    # 3. Điền tài khoản
    acc_sel = await _find_visible(page, _ACCOUNT_SELECTORS)
    if not acc_sel:
        _step("Tìm ô Tài khoản", False, f"Không tìm thấy sau {len(_ACCOUNT_SELECTORS)} selectors")
        raise RuntimeError(f"Không tìm thấy ô nhập Tài khoản trên {page.url}")
    await page.locator(acc_sel).first.fill(account)
    _step(f"Điền Tài khoản [{acc_sel}]", True, "Đã nhập tài khoản")

    # 4. Điền mật khẩu
    pw_sel = await _find_visible(page, _PW_SELECTORS)
    if not pw_sel:
        _step("Tìm ô Mật khẩu", False, f"Không tìm thấy sau {len(_PW_SELECTORS)} selectors")
        raise RuntimeError(f"Không tìm thấy ô Mật khẩu trên {page.url}")
    await page.locator(pw_sel).first.fill(password)
    _step(f"Điền Mật khẩu [{pw_sel}]", True, "Đã nhập mật khẩu (ẩn)")

    # 5. Click nút đăng nhập
    submit_sel = await _find_visible(page, _SUBMIT_SELECTORS)
    if not submit_sel:
        _step("Tìm nút Đăng nhập", False, f"Không tìm thấy sau {len(_SUBMIT_SELECTORS)} selectors")
        raise RuntimeError(f"Không tìm thấy nút Đăng nhập trên {page.url}")

    # Bắt network log để debug
    network_log: list[str] = []
    def _on_req(req):
        network_log.append(f"→ {req.method} {req.url[:180]}")
    def _on_resp(resp):
        network_log.append(f"← {resp.status} {resp.url[:180]}")
    page.on("request",  _on_req)
    page.on("response", _on_resp)

    url_before = page.url
    await page.locator(submit_sel).first.click()
    _step(f"Bấm nút Đăng nhập [{submit_sel}]", True, f"URL trước: {url_before}")

    # ── Helper diagnostics ───────────────────────────────────────────────────
    async def _collect_diag(reason_prefix: str) -> str:
        _dc: list = []
        _dls: dict = {}
        _dss: dict = {}
        try:
            _dc = await page.context.cookies()
        except Exception:
            pass
        try:
            _dls = await page.evaluate("""() => {
                const o = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    o[k] = localStorage.getItem(k);
                }
                return o;
            }""")
        except Exception:
            pass
        try:
            _dss = await page.evaluate("""() => {
                const o = {};
                for (let i = 0; i < sessionStorage.length; i++) {
                    const k = sessionStorage.key(i);
                    o[k] = sessionStorage.getItem(k);
                }
                return o;
            }""")
        except Exception:
            pass
        _err = await _get_page_error_text(page)
        _net = "\n  ".join(network_log[-30:]) if network_log else "(trống)"
        return (
            f"{reason_prefix}\n"
            f"URL hiện tại : {page.url}\n"
            f"Cookies      : {[c['name'] for c in _dc]}\n"
            f"localStorage : {str(_dls)[:600]}\n"
            f"sessionStorage: {str(_dss)[:300]}\n"
            f"Lỗi trang    : {_err}\n"
            f"Network log  :\n  {_net}"
        )

    # 6. Chờ networkidle sau submit
    try:
        await page.wait_for_load_state("networkidle", timeout=20_000)
        _log("[login] networkidle đạt được")
    except PwTimeout:
        _log("[login] networkidle timeout 20s — tiếp tục")

    page.remove_listener("request",  _on_req)
    page.remove_listener("response", _on_resp)
    _log(f"[login] Network ({len(network_log)} entries): " + " | ".join(network_log[-12:]))

    # 7. Nếu vẫn ở /login ngay sau networkidle → thất bại rõ ràng
    if any(kw in page.url.lower() for kw in _LOGIN_URL_KEYWORDS):
        diag = await _collect_diag("Server từ chối đăng nhập — URL vẫn ở /login sau submit.")
        _step("Đăng nhập thất bại", False, diag[:600])
        raise RuntimeError(f"Đăng nhập thất bại — URL vẫn /login\n{diag}")

    _log(f"[login] URL sau submit: {page.url}")

    # 8. Chờ spinner "Đang khởi tạo dashboard"
    #    Spinner này CHỈ xuất hiện khi đã xác thực thành công với server.
    #    Đây là tín hiệu đáng tin cậy nhất — không thể có ở trang /login.
    _log("[login] Chờ spinner 'Đang khởi tạo dashboard'...")
    spinner_appeared = False
    try:
        await page.get_by_text("Đang khởi tạo dashboard").first.wait_for(
            state="visible", timeout=20_000
        )
        spinner_appeared = True
        _log("[login] ✅ Spinner xuất hiện — đã xác thực thành công với server")
        _step("Dashboard đang khởi tạo", True, "Spinner xác nhận phiên đăng nhập thật")
    except PwTimeout:
        _log("[login] Spinner không xuất hiện trong 20s")

    if spinner_appeared:
        # Chờ spinner biến mất = dashboard load xong
        try:
            await page.get_by_text("Đang khởi tạo dashboard").first.wait_for(
                state="hidden", timeout=60_000
            )
            _log("[login] Spinner biến mất — dashboard sẵn sàng")
        except PwTimeout:
            _log("[login] Spinner chưa biến mất sau 60s — tiếp tục")

        # Kiểm tra sau spinner: nếu quay về /login → server reject session
        if any(kw in page.url.lower() for kw in _LOGIN_URL_KEYWORDS):
            diag = await _collect_diag(
                "Session bị server từ chối sau khi dashboard khởi tạo — "
                "redirect về /login dù spinner đã hiện."
            )
            _step("Session bị reject sau init", False, diag[:600])
            raise RuntimeError(f"Session bị reject sau dashboard init\n{diag}")
    else:
        # Spinner không xuất hiện — có thể dashboard đã cached hoặc load nhanh
        if any(kw in page.url.lower() for kw in _LOGIN_URL_KEYWORDS):
            diag = await _collect_diag(
                "Spinner không xuất hiện và URL về /login — đăng nhập thất bại."
            )
            _step("Không có spinner + URL về /login", False, diag[:600])
            raise RuntimeError(f"Đăng nhập thất bại — không spinner, URL /login\n{diag}")
        _log(f"[login] Không có spinner nhưng URL hợp lệ: {page.url} — OK")

    final_url   = page.url
    final_title = await page.title()
    _step(f"✅ Đăng nhập thành công → {final_url}", True, f"Tiêu đề: {final_title}")
    return final_url

# ── Playwright helpers: navigate + download ────────────────────────────────────

def _normalize_text(t: str) -> str:
    """NFC normalize + collapse whitespace + strip."""
    import unicodedata
    return re.sub(r'\s+', ' ', unicodedata.normalize("NFC", t or "")).strip()


async def _log_all_links(page) -> list:
    """Lấy và log toàn bộ <a> trên trang. Trả list dict."""
    try:
        links = await page.locator("a").evaluate_all(
            "items => items.map(a => ({ text: (a.innerText||'').trim(), href: a.href, aria: a.getAttribute('aria-label') }))"
        )
        for lk in links[:60]:
            logger.info(f"[SYNC][link] text={lk.get('text','')!r:30} href={lk.get('href','')}")
        return links
    except Exception as ex:
        logger.warning(f"[SYNC] Could not enumerate links: {ex}")
        return []


async def _click_hamburger_by_position(page) -> bool:
    """
    Tìm nút hamburger ☰ bằng vị trí: x<180, y<250, w<150, h<150.
    Ưu tiên button có aria-label/title/data-testid chứa 'menu', hoặc text rỗng.
    Trả True nếu click được.
    """
    try:
        all_buttons = page.locator("button")
        count = await all_buttons.count()
        candidates = []
        for i in range(min(count, 30)):
            btn = all_buttons.nth(i)
            try:
                if not await btn.is_visible():
                    continue
                bb = await btn.bounding_box()
                if not bb:
                    continue
                if bb["x"] >= 180 or bb["y"] >= 250 or bb["width"] >= 150 or bb["height"] >= 150:
                    continue
                # Thu thập metadata
                aria  = (await btn.get_attribute("aria-label") or "").lower()
                title = (await btn.get_attribute("title") or "").lower()
                dtid  = (await btn.get_attribute("data-testid") or "").lower()
                txt   = _normalize_text(await btn.inner_text())
                score = 0
                if any(kw in aria  for kw in ("menu", "sidebar", "drawer", "hamburger", "nav")): score += 3
                if any(kw in title for kw in ("menu", "sidebar", "drawer", "hamburger", "nav")): score += 3
                if any(kw in dtid  for kw in ("menu", "sidebar", "drawer", "hamburger", "nav")): score += 3
                if txt == "":  score += 2   # nút không có text → thường là icon
                candidates.append((score, bb["x"], bb["y"], btn, aria or title or dtid or f"btn[{i}]"))
            except Exception:
                continue

        if not candidates:
            logger.warning("[SYNC] No hamburger candidates found in top-left region")
            return False

        # Sắp xếp: score cao trước, rồi x nhỏ, rồi y nhỏ
        candidates.sort(key=lambda c: (-c[0], c[1], c[2]))
        score, bx, by, btn, label = candidates[0]
        logger.info(f"[SYNC] Clicking hamburger [{label}] at ({bx:.0f},{by:.0f}) score={score}")
        await btn.click()
        return True
    except Exception as ex:
        logger.warning(f"[SYNC] _click_hamburger_by_position error: {ex}")
        return False


async def _wait_for_sidebar(page) -> bool:
    """
    Đợi sidebar thực sự xuất hiện sau khi click hamburger.
    Kiểm tra bằng text nội dung sidebar hoặc kích thước drawer.
    Trả True nếu sidebar đã mở.
    """
    from playwright.async_api import TimeoutError as PwTimeout
    sidebar_signals = [
        'text=Đơn hàng',
        'text=Sản phẩm',
        'text=Cấu hình bot',
        'text=Đổi mật khẩu',
        'text=Chợ',
        '[role="navigation"] a',
        '[class*="sidebar" i] a',
        '[class*="drawer" i] a',
        'nav a',
    ]
    for sig in sidebar_signals:
        try:
            el = page.locator(sig).first
            if await el.count() > 0 and await el.is_visible():
                logger.info(f"[SYNC] Sidebar confirmed open via: {sig}")
                return True
        except Exception:
            pass
    # Thử chờ tối đa 3s cho bất kỳ signal nào
    for sig in sidebar_signals[:5]:
        try:
            await page.locator(sig).first.wait_for(state="visible", timeout=3_000)
            logger.info(f"[SYNC] Sidebar appeared: {sig}")
            return True
        except PwTimeout:
            pass
        except Exception:
            pass
    return False


async def _find_and_navigate_order_item(page) -> bool:
    """
    Tìm mục 'Đơn hàng' trong DOM, click, rồi chờ xác nhận bằng NỘI DUNG trang.
    Trả True chỉ khi đã xác nhận đang ở trang Đơn hàng thật sự.
    Website là SPA — URL có thể không đổi, xác nhận bằng content.
    """
    target = "Đơn hàng"
    order_link = None
    order_href = None

    # ── Tìm element "Đơn hàng" bằng nhiều cách ──────────────────────────────

    # Cách 1: <a> có text chính xác "Đơn hàng"
    if not order_link:
        try:
            el = page.locator("a").filter(has_text=re.compile(r"^Đơn hàng$", re.IGNORECASE)).first
            if await el.count() > 0 and await el.is_visible():
                order_link = el
        except Exception:
            pass

    # Cách 2: role=link name="Đơn hàng"
    if not order_link:
        try:
            el = page.get_by_role("link", name="Đơn hàng").first
            if await el.count() > 0 and await el.is_visible():
                order_link = el
        except Exception:
            pass

    # Cách 3: duyệt toàn bộ <a> và so sánh text sau normalize
    if not order_link:
        try:
            all_a = page.locator("a")
            count = await all_a.count()
            for i in range(min(count, 100)):
                el = all_a.nth(i)
                try:
                    txt = _normalize_text(await el.inner_text())
                    if txt == target and await el.is_visible():
                        order_link = el
                        break
                except Exception:
                    continue
        except Exception:
            pass

    # Cách 4: get_by_text exact (bất kỳ tag nào)
    if not order_link:
        try:
            el = page.get_by_text(target, exact=True).first
            if await el.count() > 0 and await el.is_visible():
                order_link = el
        except Exception:
            pass

    # Cách 5: button/div/li có text "Đơn hàng" (SPA có thể dùng div thay <a>)
    if not order_link:
        for tag in ["button", "li", "div", "span"]:
            try:
                el = page.locator(tag).filter(
                    has_text=re.compile(r"^Đơn hàng$", re.IGNORECASE)
                ).first
                if await el.count() > 0 and await el.is_visible():
                    order_link = el
                    break
            except Exception:
                continue

    if not order_link:
        logger.warning(f"[SYNC] Không tìm thấy element 'Đơn hàng' trong DOM — URL={page.url}")
        return False

    # Đọc href thật (chỉ để log — không tự ghép URL)
    try:
        order_href = await order_link.get_attribute("href")
    except Exception:
        pass
    logger.info(f"[SYNC] Tìm thấy 'Đơn hàng' — href={order_href!r}")

    # ── Click ────────────────────────────────────────────────────────────────
    try:
        await order_link.click()
        logger.info("[SYNC] Đã click 'Đơn hàng'")
    except Exception as ex:
        logger.warning(f"[SYNC] click() thất bại: {ex} — thử JS click")
        try:
            await order_link.evaluate("el => el.click()")
            logger.info("[SYNC] Đã JS click 'Đơn hàng'")
        except Exception as ex2:
            logger.warning(f"[SYNC] JS click cũng thất bại: {ex2}")

    # ── Chờ xác nhận bằng nội dung trang (SPA — không dựa vào URL) ───────────
    # Các tín hiệu xuất hiện khi đã vào trang Đơn hàng:
    ORDER_SIGNALS = [
        'text=Đơn hàng của bạn',
        'text=Tất cả đơn hàng',
        'th:has-text("MÃ ĐƠN")',
        'th:has-text("SẢN PHẨM")',
        'button:has-text("Tải xuống")',
        'a:has-text("Tải xuống")',
        'h1:has-text("Đơn hàng")',
        'h2:has-text("Đơn hàng")',
    ]

    # Poll 10s
    for tick in range(20):
        for sig in ORDER_SIGNALS:
            try:
                el = page.locator(sig).first
                if await el.count() > 0 and await el.is_visible():
                    logger.info(f"[SYNC] ✅ Trang Đơn hàng xác nhận bằng: {sig!r}")
                    return True
            except Exception:
                pass
        await asyncio.sleep(0.5)

    # Lần cuối: chờ thêm 10s cho heading
    try:
        await page.get_by_text("Đơn hàng của bạn", exact=False).wait_for(
            state="visible", timeout=10_000
        )
        logger.info("[SYNC] ✅ Trang Đơn hàng xác nhận bằng heading (chờ thêm)")
        return True
    except Exception:
        pass

    logger.warning(f"[SYNC] Đã click 'Đơn hàng' nhưng nội dung trang chưa xác nhận — URL={page.url}")
    return False


async def _open_orders_page(page) -> None:
    """
    Mở trang Đơn hàng:
      1. Guard: URL không phải /login
      2. Mở sidebar nếu chưa mở (bấm hamburger ≡)
      3. Tìm 'Đơn hàng' bằng nhiều cách, click, xác nhận bằng nội dung
      4. Retry tối đa 3 lần
      5. Thất bại → log đầy đủ: URL, title, text menu, sidebar links, href, screenshot
    """
    from playwright.async_api import TimeoutError as PwTimeout

    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    # ── 0. Guard: phiên đăng nhập phải còn sống ───────────────────────────────
    _guard_url = page.url
    if any(kw in _guard_url.lower() for kw in _LOGIN_URL_KEYWORDS):
        try:
            _gc = await page.context.cookies()
            _gnames = [c["name"] for c in _gc]
        except Exception:
            _gnames = []
        raise RuntimeError(
            f"Phiên đăng nhập đã bị mất trước khi mở Đơn hàng — "
            f"URL={_guard_url} | Cookies: {_gnames}"
        )
    logger.info(f"[SYNC] _open_orders_page start — URL={_guard_url}")

    # ── 1. Đảm bảo DOM đã tải ─────────────────────────────────────────────────
    await page.wait_for_load_state("domcontentloaded")
    logger.info(f"[SYNC] DOM loaded — URL={page.url} | Title={await page.title()}")

    # ── 2–4. Retry: sidebar → Đơn hàng ────────────────────────────────────────
    navigated   = False
    last_links: list = []
    last_url    = page.url
    last_title  = ""

    for attempt in range(1, 4):
        logger.info(f"[SYNC] Attempt {attempt}/3")

        # Kiểm tra sidebar đã mở chưa (tránh toggle đóng lại nếu đang mở)
        sidebar_already_open = await _wait_for_sidebar(page)
        if sidebar_already_open:
            logger.info(f"[SYNC] Sidebar đã mở sẵn (attempt {attempt})")
        else:
            logger.info(f"[SYNC] Sidebar chưa mở — bấm hamburger (attempt {attempt})")
            await _click_hamburger_by_position(page)
            # Chờ sidebar xuất hiện tối đa 5s
            sidebar_open = await _wait_for_sidebar(page)
            if not sidebar_open:
                logger.warning(f"[SYNC] Sidebar không mở sau hamburger click (attempt {attempt})")
                await page.wait_for_timeout(1_000)

        # Chụp screenshot sau khi sidebar (có thể) đã mở
        ss_name = f"sidebar_attempt_{attempt}.png"
        ss_path = str(SCREENSHOTS_DIR / ss_name)
        try:
            await page.screenshot(path=ss_path, full_page=False)
            logger.info(f"[SYNC] Screenshot: {ss_path}")
        except Exception as e:
            logger.warning(f"[SYNC] Screenshot thất bại: {e}")

        # Log toàn bộ links + text menu để debug
        last_links = await _log_all_links(page)
        try:
            all_texts = await page.evaluate("""() => {
                const els = document.querySelectorAll('a, button, [role=menuitem], [role=option], li');
                return Array.from(els).map(el => (el.innerText||el.textContent||'').trim()).filter(t=>t).slice(0,60);
            }""")
            logger.info(f"[SYNC] Menu texts: {all_texts}")
        except Exception:
            pass

        # Tìm "Đơn hàng" và điều hướng (xác nhận bằng content bên trong)
        navigated = await _find_and_navigate_order_item(page)
        if navigated:
            break

        last_url   = page.url
        last_title = await page.title()
        logger.warning(f"[SYNC] 'Đơn hàng' không tìm thấy/xác nhận (attempt {attempt}) — URL={last_url}")
        await page.wait_for_timeout(1_500)

    # ── 5. Thất bại hoàn toàn — log đầy đủ và raise ───────────────────────────
    if not navigated:
        fail_ss = str(SCREENSHOTS_DIR / "orders_page_failed.png")
        try:
            await page.screenshot(path=fail_ss, full_page=False)
        except Exception:
            pass

        # Thu thập diagnostics đầy đủ
        diag_url   = page.url
        diag_title = await page.title()
        try:
            sidebar_texts = await page.evaluate("""() => {
                const nav = document.querySelector('nav,[role=navigation],[class*=sidebar],[class*=drawer]');
                if (!nav) return [];
                return Array.from(nav.querySelectorAll('a,button,li')).map(el=>(el.innerText||el.textContent||'').trim()).filter(t=>t);
            }""")
        except Exception:
            sidebar_texts = []
        links_summary = " | ".join(
            f"{lk.get('text','')!r}→{lk.get('href','')}"
            for lk in last_links[:25]
        )
        cookies_names = []
        try:
            cookies_names = [c["name"] for c in await page.context.cookies()]
        except Exception:
            pass

        raise RuntimeError(
            f"Không tìm thấy/xác nhận trang 'Đơn hàng' sau 3 lần thử.\n"
            f"URL hiện tại  : {diag_url}\n"
            f"Title         : {diag_title}\n"
            f"Sidebar texts : {sidebar_texts}\n"
            f"Tất cả links  : {links_summary}\n"
            f"Cookies       : {cookies_names}\n"
            f"Screenshot    : orders_page_failed.png"
        )


async def _download_orders_xlsx(page, download_dir: str) -> str:
    """
    Tìm nút 'Tải xuống' và tải file XLSX.
    Xử lý cả trường hợp nút mở dropdown chứa XLSX.
    Trả đường dẫn file đã lưu. Raise RuntimeError nếu thất bại.
    """
    from playwright.async_api import TimeoutError as PwTimeout

    logger.info("[SYNC] Download button found")

    # Selectors theo thứ tự ưu tiên
    btn_selectors = [
        'button:has-text("Tải xuống")',
        'button:has-text("Tải Xuống")',
        'a:has-text("Tải xuống")',
        'button[aria-label*="download" i]',
        'button:has-text("Download")',
        'button:has-text("Export")',
        'button:has-text("Xuất")',
        'a[download]',
    ]

    dl_btn = await _find_visible(page, btn_selectors)
    if not dl_btn:
        raise RuntimeError("Đã mở trang Đơn hàng nhưng không tìm thấy nút Tải xuống")

    logger.info(f"[SYNC] Clicking download button [{dl_btn}]")

    # Thử tải trực tiếp trước
    out_path = os.path.join(download_dir, "orders.xlsx")
    try:
        async with page.expect_download(timeout=5_000) as dl_info:
            await page.locator(dl_btn).first.click()
        dl = await dl_info.value
        await dl.save_as(out_path)
        size = os.path.getsize(out_path)
        if size >= 100:
            logger.info(f"[SYNC] XLSX downloaded successfully → {out_path} ({size} bytes)")
            return out_path
    except PwTimeout:
        # Nút mở dropdown thay vì tải trực tiếp
        pass
    except Exception as ex:
        logger.warning(f"[SYNC] Direct download failed: {ex} — checking for dropdown")

    # Kiểm tra có dropdown XLSX/Excel không
    await page.wait_for_timeout(500)
    xlsx_option_selectors = [
        'text=XLSX',
        'text=Excel',
        'text=Xuất Excel',
        'text=Tải XLSX',
        '*:has-text("XLSX")',
        '*:has-text("Excel")',
        'a:has-text("XLSX")',
        '[role="menuitem"]:has-text("XLSX")',
        '[role="option"]:has-text("XLSX")',
    ]
    xlsx_opt = await _find_visible(page, xlsx_option_selectors)
    if xlsx_opt:
        logger.info(f"[SYNC] Dropdown detected, clicking XLSX option [{xlsx_opt}]")
        try:
            async with page.expect_download(timeout=30_000) as dl_info:
                await page.locator(xlsx_opt).first.click()
            dl = await dl_info.value
            await dl.save_as(out_path)
            size = os.path.getsize(out_path)
            if size >= 100:
                logger.info(f"[SYNC] XLSX downloaded successfully via dropdown → {out_path} ({size} bytes)")
                return out_path
            raise RuntimeError(f"File tải xuống quá nhỏ ({size} bytes)")
        except Exception as ex:
            raise RuntimeError(f"Tải XLSX qua dropdown thất bại: {ex}")

    # Thử lại lần 2 với timeout dài hơn (nút click lần trước có thể cần kích hoạt thêm)
    try:
        async with page.expect_download(timeout=30_000) as dl_info:
            await page.locator(dl_btn).first.click()
        dl = await dl_info.value
        await dl.save_as(out_path)
        size = os.path.getsize(out_path)
        if size >= 100:
            logger.info(f"[SYNC] XLSX downloaded on retry → {out_path} ({size} bytes)")
            return out_path
        raise RuntimeError(f"File tải xuống quá nhỏ ({size} bytes)")
    except Exception as ex:
        raise RuntimeError(f"Không tải được file XLSX: {ex}")


# ── Playwright: login + navigate + download ────────────────────────────────────
async def do_playwright_sync(config: dict) -> dict:
    """
    Đăng nhập → bấm menu Đơn hàng → tải XLSX.
    Trả dict với các flag login_ok, download_ok. Không raise.
    """
    from playwright.async_api import async_playwright

    site_url = config.get("site_url", "").rstrip("/")
    account  = config.get("email", "")
    password = config.get("password", "")

    if not site_url or not account or not password:
        missing = []
        if not site_url:  missing.append("URL website")
        if not account:   missing.append("Tài khoản")
        if not password:  missing.append("Mật khẩu")
        return {"login_ok": False, "download_ok": False, "path": None, "dir": None,
                "error": f"Chưa cấu hình: {', '.join(missing)}"}

    download_dir = tempfile.mkdtemp(prefix="sync_robot_")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                  "--disable-blink-features=AutomationControlled",
                  "--window-size=1280,800"],
        )
        ctx = await browser.new_context(
            accept_downloads=True,
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        )
        page = await ctx.new_page()
        # Ẩn dấu hiệu headless để tránh bot-detection của SPA
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
            "window.chrome={runtime:{}};"
        )

        _ctx_id  = id(ctx)
        _page_id = id(page)
        logger.info(f"[SYNC] Context created — ctx_id={_ctx_id} | page_id={_page_id}")

        try:
            # ── Bước 1: Đăng nhập — dùng loginAndWaitReady (CHUNG với Test Login) ─
            logger.info(f"[SYNC] Bắt đầu đăng nhập... ctx_id={_ctx_id}")
            try:
                login_url_result = await loginAndWaitReady(page, config, source="sync")
                # Log kỹ thuật sau đăng nhập
                _post_ck = await ctx.cookies()
                logger.info(
                    f"[SYNC] Login OK — ctx_id={_ctx_id} | page_id={id(page)} | "
                    f"URL={login_url_result} | "
                    f"Cookies: {[c['name'] for c in _post_ck]}"
                )
            except Exception as ex:
                return {"login_ok": False, "download_ok": False, "path": None, "dir": download_dir,
                        "error": str(ex)}

            # ── Bước 2: Mở trang Đơn hàng qua menu (KHÔNG goto /orders) ────
            # Không tạo context mới — dùng đúng ctx và page từ đăng nhập
            logger.info(f"[SYNC] Mở menu Đơn hàng — ctx_id={_ctx_id} | page_id={id(page)} | URL trước={page.url}")
            try:
                await _open_orders_page(page)
                logger.info(f"[SYNC] Đơn hàng page OK — URL={page.url}")
            except Exception as ex:
                logger.error(f"[SYNC] Lỗi mở trang đơn hàng: {ex}")
                return {"login_ok": True, "download_ok": False, "path": None, "dir": download_dir,
                        "error": str(ex)}

            # ── Bước 3: Tải XLSX ────────────────────────────────────────────
            logger.info(
                f"[SYNC] Starting order download — ctx_id={_ctx_id} | page_id={id(page)} | URL={page.url}"
            )
            try:
                out_path = await _download_orders_xlsx(page, download_dir)
            except Exception as ex:
                logger.error(f"[SYNC] Lỗi tải XLSX: {ex}")
                return {"login_ok": True, "download_ok": False, "path": None, "dir": download_dir,
                        "error": str(ex)}

        finally:
            logger.info(f"[SYNC] Đóng browser — ctx_id={_ctx_id}")
            await browser.close()

    logger.info("[SYNC] Starting order import")
    return {"login_ok": True, "download_ok": True, "path": out_path, "dir": download_dir, "error": ""}

# ── One sync cycle ─────────────────────────────────────────────────────────────
def run_sync_cycle(config: dict) -> dict:
    start_ts = time.time()
    token = get_admin_token(config)
    result = {
        "started_at":      now_iso(),
        "ended_at":        None,
        "duration_s":      0,
        "success":         False,
        "login_ok":        False,
        "download_ok":     False,
        "import_ok":       False,
        "new_orders":      0,
        "updated_orders":  0,
        "skipped_orders":  0,
        "errors":          0,
        "message":         "",
    }
    tmp_dir = None
    try:
        # 1. Playwright: đăng nhập + tải XLSX
        dl      = asyncio.run(do_playwright_sync(config))
        tmp_dir = dl.get("dir")

        # Cập nhật từng bước độc lập — không gộp chung
        result["login_ok"]    = dl.get("login_ok", False)
        result["download_ok"] = dl.get("download_ok", False)

        if not result["login_ok"]:
            result["message"] = f"❌ Không đăng nhập được: {dl.get('error', 'Lỗi không rõ')}"
            result["errors"]  = 1
            return result

        if not result["download_ok"]:
            result["message"] = f"❌ Không tải được file XLSX: {dl.get('error', 'Lỗi không rõ')}"
            result["errors"]  = 1
            return result

        xlsx_path = dl["path"]

        # 2. Dedup sets
        known_products = get_known_products(token)
        existing_order_ids, existing_item_emails = get_existing_sets(token)

        # 3. Parse XLSX
        rows = parse_xlsx_to_rows(xlsx_path, known_products, existing_order_ids, existing_item_emails)
        logger.info(f"[robot] XLSX → {len(rows)} dòng")

        if not rows:
            result["success"] = True
            result["import_ok"] = True
            result["message"] = "✔ File XLSX không có đơn hàng mới"
            return result

        # 4. Import via API
        resp = call_api("POST", "/bot/orders/xlsx-import", body={"rows": rows}, token=token)
        result["import_ok"]      = True
        result["new_orders"]     = resp.get("success", 0)
        result["updated_orders"] = 0
        result["skipped_orders"] = resp.get("skipped", 0)
        result["errors"]         = resp.get("failed", 0)
        result["success"]        = True
        result["message"] = (
            f"✔ Đồng bộ thành công lúc {datetime.now().strftime('%H:%M %d/%m/%Y')}: "
            f"{result['new_orders']} đơn mới, "
            f"{result['skipped_orders']} bỏ qua, "
            f"{result['errors']} lỗi"
        )
        logger.info(result["message"])

    except Exception as exc:
        logger.error(f"[robot] Lỗi: {exc}\n{traceback.format_exc()}")
        result["message"] = f"❌ Lỗi: {exc}"
        result["errors"]  = 1
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        result["ended_at"]   = now_iso()
        result["duration_s"] = round(time.time() - start_ts, 2)

    return result

# ── Main robot loop ────────────────────────────────────────────────────────────
def robot_loop():
    logger.info("[robot] ✅ Sync robot khởi động")
    while True:
        config = load_config()

        if not config.get("enabled", False):
            write_status(False)
            time.sleep(15)
            continue

        interval_s = int(config.get("interval_s", 300))

        # Check trigger
        trigger = load_json(TRIGGER_FILE, {})
        if trigger.get("trigger", False):
            save_json(TRIGGER_FILE, {"trigger": False, "cleared_at": now_iso()})
            logger.info("[robot] Trigger nhận được — chạy ngay")

        # Try acquire lock (non-blocking)
        acquired = _run_lock.acquire(blocking=False)
        if not acquired:
            logger.info("[robot] Đang chạy sync khác, bỏ qua lần này")
            time.sleep(5)
            continue

        next_at = datetime.fromtimestamp(time.time() + interval_s, timezone.utc).isoformat()
        try:
            write_status(True)
            result = run_sync_cycle(config)
            append_log(result)
            write_status(False, last_run=result, next_run_at=next_at)
        finally:
            _run_lock.release()

        # Sleep until next cycle, checking trigger every 5s
        sleep_end = time.time() + interval_s
        while time.time() < sleep_end:
            trig = load_json(TRIGGER_FILE, {})
            if trig.get("trigger", False):
                break
            time.sleep(5)

# ── CLI: --test-login mode (synchronous, for API endpoint) ────────────────────

SCREENSHOTS_DIR = DATA_DIR / "screenshots"

def _cleanup_old_screenshots():
    """Xóa screenshot debug cũ hơn 24 giờ."""
    try:
        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        cutoff = time.time() - 86_400
        for f in SCREENSHOTS_DIR.glob("test_*.jpg"):
            if f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)
    except Exception:
        pass

def _format_duration(seconds: float) -> str:
    """Định dạng thời gian: '1 phút 4.09 giây' thay vì '64.09s'."""
    s = round(seconds, 2)
    if s < 60:
        return f"{s} giây"
    m = int(s // 60)
    rem = round(s % 60, 2)
    return f"{m} phút {rem} giây"


def _safe_text(text: str, max_len: int = 1000) -> str:
    """Cắt text dài, loại bỏ chuỗi base64."""
    if not text:
        return ""
    # Lọc bỏ các token base64 dài (>80 ký tự liên tục không có khoảng trắng)
    cleaned = re.sub(r'[A-Za-z0-9+/]{80,}={0,2}', '[ảnh-đã-ẩn]', text)
    # Loại JPEG magic
    cleaned = re.sub(r'/9j/[^\s]{10,}', '[ảnh-đã-ẩn]', cleaned)
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len] + "…"
    return cleaned.strip()

def _categorize_failure(error_text: str, curr_url: str, still_has_form: bool) -> tuple[str, str]:
    """Trả về (nguyên_nhân, gợi_ý) từ nội dung lỗi trên trang."""
    et = (error_text or "").lower()
    url = (curr_url or "").lower()
    # Sai tài khoản / mật khẩu
    if any(k in et for k in ("sai", "incorrect", "invalid", "wrong", "không đúng",
                               "không khớp", "mật khẩu", "password", "credentials")):
        return "Sai tài khoản hoặc mật khẩu", "Kiểm tra lại email/username và mật khẩu trong cấu hình"
    # Captcha
    if any(k in et for k in ("captcha", "recaptcha", "robot", "human")):
        return "Website yêu cầu captcha xác minh", "Robot tự động không thể vượt captcha — đăng nhập thủ công trước"
    # OTP / 2FA
    if any(k in et for k in ("otp", "2fa", "two-factor", "mã xác minh", "verification code",
                               "authenticator", "xác thực")):
        return "Website yêu cầu OTP / xác minh 2 bước", "Tắt xác minh 2 bước trên tài khoản hoặc dùng thiết bị tin cậy"
    # Bot bị chặn
    if any(k in et for k in ("blocked", "banned", "chặn", "automated", "bot", "tự động")):
        return "Website chặn trình duyệt tự động", "Đăng nhập thủ công và đánh dấu thiết bị tin cậy"
    # Vẫn còn form
    if still_has_form:
        return "Form đăng nhập vẫn còn sau khi bấm — tài khoản hoặc mật khẩu sai", \
               "Thử đăng nhập thủ công để xác nhận tài khoản còn hoạt động"
    return "Không xác định được lý do thất bại", "Kiểm tra log bước cuối và screenshot để debug"

async def do_test_login_only(config: dict) -> dict:
    """
    Kiểm tra đăng nhập với debug chi tiết từng bước + screenshot.
    Dùng loginAndWaitReady() — CHÍNH XÁC cùng hàm với Sync.
    Screenshot lưu thành file, KHÔNG trả base64.
    """
    from playwright.async_api import async_playwright

    _cleanup_old_screenshots()
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    site_url = config.get("site_url", "").rstrip("/")
    account  = config.get("email", "")
    password = config.get("password", "")

    if not site_url or not account or not password:
        missing = []
        if not site_url: missing.append("URL website")
        if not account:  missing.append("Tài khoản")
        if not password: missing.append("Mật khẩu")
        return {"ok": False, "message": f"Chưa cấu hình: {', '.join(missing)}", "steps": []}

    start  = time.time()
    ts     = int(start)
    step_n = [0]
    steps: list = []

    def elapsed() -> float:
        return round(time.time() - start, 2)

    async def snap(page, slug: str) -> str | None:
        step_n[0] += 1
        fname = f"test_{ts}_s{step_n[0]}_{slug[:20]}.jpg"
        try:
            await page.screenshot(path=str(SCREENSHOTS_DIR / fname), type="jpeg", quality=60, full_page=False)
            return fname
        except Exception:
            return None

    def add_step(label: str, ok: bool, note: str = "", screenshot_file: str | None = None):
        safe = _safe_text(note)
        steps.append({"step": label, "ok": ok, "note": safe, "screenshot_file": screenshot_file})
        logger.info(f"[test-login] {'✅' if ok else '❌'} {label}" + (f" — {safe[:200]}" if safe else ""))

    # Adapter: loginAndWaitReady gọi step_fn(label, ok, note) không có screenshot
    def step_fn(label: str, ok: bool, note: str = ""):
        add_step(label, ok, note, None)

    result: dict = {
        "ok": False, "message": "", "url": "", "title": "",
        "error_text": "", "reason": "", "suggestion": "",
        "steps": steps, "duration_s": 0,
    }

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                  "--disable-extensions", "--disable-blink-features=AutomationControlled",
                  "--window-size=1280,800"],
        )
        ctx  = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        )
        page = await ctx.new_page()
        await ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
            "window.chrome={runtime:{}};"
        )

        try:
            # Gọi loginAndWaitReady — CHÍNH XÁC cùng hàm Sync dùng
            try:
                curr_url = await loginAndWaitReady(
                    page, config,
                    log_fn=logger.info,
                    step_fn=step_fn,
                    source="test-login",
                )
                sf         = await snap(page, "result")
                curr_title = await page.title()
                # Gắn screenshot vào step cuối cùng
                if steps:
                    steps[-1]["screenshot_file"] = sf
                result.update({
                    "ok": True,
                    "message": f"Đăng nhập thành công! Redirect đến: {curr_url}",
                    "url": curr_url, "title": curr_title,
                    "duration_s": elapsed(),
                })
            except Exception as ex:
                sf         = await snap(page, "fail")
                curr_url   = page.url
                curr_title = await page.title()
                error_text = await _get_page_error_text(page)
                still_has_form = await _find_visible(page, _ACCOUNT_SELECTORS) is not None
                reason, suggestion = _categorize_failure(error_text, curr_url, still_has_form)
                msg = _safe_text(str(ex))
                # Gắn screenshot vào step cuối cùng nếu chưa có
                if steps and not steps[-1].get("screenshot_file"):
                    steps[-1]["screenshot_file"] = sf
                else:
                    add_step("Kết quả đăng nhập", False, msg, sf)
                result.update({
                    "ok": False,
                    "message": msg,
                    "url": curr_url, "title": curr_title,
                    "error_text": error_text,
                    "reason": reason,
                    "suggestion": suggestion,
                    "duration_s": elapsed(),
                })

        except Exception as ex:
            sf  = await snap(page, "exception")
            msg = _safe_text(str(ex))
            add_step("Lỗi không xác định", False, msg, sf)
            result.update({"message": f"Lỗi: {msg}", "url": page.url, "duration_s": elapsed()})
        finally:
            await browser.close()

    return result

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test-login":
        cfg = load_config()
        if os.environ.get("ROBOT_SITE_URL"):  cfg["site_url"]  = os.environ["ROBOT_SITE_URL"]
        if os.environ.get("ROBOT_LOGIN_URL"): cfg["login_url"] = os.environ["ROBOT_LOGIN_URL"]
        if os.environ.get("ROBOT_EMAIL"):     cfg["email"]     = os.environ["ROBOT_EMAIL"]
        if os.environ.get("ROBOT_PASSWORD"):  cfg["password"]  = os.environ["ROBOT_PASSWORD"]
        try:
            result = asyncio.run(do_test_login_only(cfg))
        except Exception as e:
            result = {"ok": False, "message": _safe_text(str(e)), "steps": []}
        # Không ghi password vào output
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result.get("ok") else 1)
    else:
        ensure_playwright_browser()
        robot_loop()
