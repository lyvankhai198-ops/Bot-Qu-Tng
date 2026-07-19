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
    handlers=[logging.StreamHandler(sys.stdout)],
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

# ── Playwright: login + download ───────────────────────────────────────────────
async def do_playwright_sync(config: dict) -> dict:
    from playwright.async_api import async_playwright

    site_url   = config.get("site_url", "").rstrip("/")
    login_url  = config.get("login_url", "").rstrip("/") or f"{site_url}/login"
    orders_url = config.get("orders_url", "").rstrip("/") or f"{site_url}/orders"
    email      = config.get("email", "")
    password   = config.get("password", "")

    if not site_url or not email or not password:
        raise RuntimeError("Chưa cấu hình đầy đủ URL / email / mật khẩu")

    download_dir = tempfile.mkdtemp(prefix="sync_robot_")

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        ctx = await browser.new_context(accept_downloads=True)
        page = await ctx.new_page()

        try:
            # ── Login ──────────────────────────────────────────────────────
            logger.info(f"[robot] Login → {login_url}")
            await page.goto(login_url, timeout=30_000)
            await page.wait_for_load_state("domcontentloaded")

            # Email field
            await page.fill(
                'input[type="email"], input[name="email"], input[name="username"], '
                'input[placeholder*="mail" i], input[placeholder*="Email" i]',
                email,
            )
            # Password field
            await page.fill(
                'input[type="password"], input[name="password"]',
                password,
            )
            # Submit
            await page.click(
                'button[type="submit"], input[type="submit"], '
                'button:has-text("Đăng nhập"), button:has-text("Login"), button:has-text("Sign in")',
            )
            await page.wait_for_load_state("networkidle", timeout=20_000)

            curr = page.url
            if any(kw in curr.lower() for kw in ("login", "signin", "sign-in")):
                raise RuntimeError("Đăng nhập thất bại — trình duyệt vẫn ở trang login")
            logger.info(f"[robot] Đăng nhập OK → {curr}")

            # ── Trang đơn hàng ─────────────────────────────────────────────
            logger.info(f"[robot] Mở trang đơn hàng → {orders_url}")
            await page.goto(orders_url, timeout=30_000)
            await page.wait_for_load_state("networkidle", timeout=20_000)

            # ── Bấm nút tải xuống ──────────────────────────────────────────
            logger.info("[robot] Tìm nút Tải xuống...")
            async with page.expect_download(timeout=60_000) as dl_info:
                await page.click(
                    'button:has-text("Tải xuống"), button:has-text("Tải Xuống"), '
                    'button:has-text("Download"), button:has-text("Export"), '
                    'button:has-text("Xuất"), a[download], '
                    'a:has-text("Tải xuống"), button[aria-label*="download" i]',
                )
            dl = await dl_info.value
            out_path = os.path.join(download_dir, "orders.xlsx")
            await dl.save_as(out_path)
            size = os.path.getsize(out_path)
            logger.info(f"[robot] Tải xong → {out_path} ({size} bytes)")

            if size < 100:
                raise RuntimeError(f"File tải xuống quá nhỏ ({size} bytes) — có thể lỗi")

        finally:
            await browser.close()

    return {"path": out_path, "dir": download_dir}

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
        # 1. Playwright download
        dl = asyncio.run(do_playwright_sync(config))
        xlsx_path = dl["path"]
        tmp_dir   = dl["dir"]
        result["login_ok"]    = True
        result["download_ok"] = True

        # 2. Dedup sets
        known_products           = get_known_products(token)
        existing_order_ids, existing_item_emails = get_existing_sets(token)

        # 3. Parse
        rows = parse_xlsx_to_rows(xlsx_path, known_products, existing_order_ids, existing_item_emails)
        logger.info(f"[robot] XLSX → {len(rows)} dòng")

        if not rows:
            result["success"] = True
            result["message"] = "File XLSX không có đơn hàng"
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
        msg = str(exc)
        if any(kw in msg.lower() for kw in ("login", "đăng nhập")):
            result["message"] = f"❌ Không đăng nhập được: {msg}"
        elif any(kw in msg.lower() for kw in ("download", "tải")):
            result["message"] = f"❌ Không tải được file: {msg}"
        elif any(kw in msg.lower() for kw in ("xlsx", "đọc", "parse")):
            result["message"] = f"❌ Không đọc được XLSX: {msg}"
        else:
            result["message"] = f"❌ Lỗi: {msg}"
        result["errors"] = 1
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        result["ended_at"]  = now_iso()
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
async def do_test_login_only(config: dict) -> dict:
    """Chỉ đăng nhập, không tải file. Trả JSON kết quả ra stdout."""
    from playwright.async_api import async_playwright

    site_url  = config.get("site_url", "").rstrip("/")
    login_url = config.get("login_url", "").rstrip("/") or f"{site_url}/login"
    email     = config.get("email", "")
    password  = config.get("password", "")

    if not site_url or not email or not password:
        return {"ok": False, "message": "Chưa cấu hình URL / email / mật khẩu"}

    start = time.time()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        ctx  = await browser.new_context()
        page = await ctx.new_page()
        try:
            await page.goto(login_url, timeout=30_000)
            await page.wait_for_load_state("domcontentloaded")
            await page.fill(
                'input[type="email"], input[name="email"], input[name="username"], '
                'input[placeholder*="mail" i], input[placeholder*="Email" i]',
                email,
            )
            await page.fill('input[type="password"], input[name="password"]', password)
            await page.click(
                'button[type="submit"], input[type="submit"], '
                'button:has-text("Đăng nhập"), button:has-text("Login"), button:has-text("Sign in")',
            )
            await page.wait_for_load_state("networkidle", timeout=20_000)
            curr = page.url
            if any(kw in curr.lower() for kw in ("login", "signin", "sign-in")):
                return {"ok": False, "message": f"Đăng nhập thất bại — trình duyệt vẫn ở {curr}", "url": curr, "duration_s": round(time.time()-start, 2)}
            return {"ok": True, "message": f"✅ Đăng nhập thành công! Redirect đến: {curr}", "url": curr, "duration_s": round(time.time()-start, 2)}
        except Exception as ex:
            return {"ok": False, "message": f"❌ Lỗi: {ex}", "duration_s": round(time.time()-start, 2)}
        finally:
            await browser.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test-login":
        # Synchronous test mode — called by API server, prints JSON to stdout
        cfg = load_config()
        # Allow passing config as env override
        if os.environ.get("ROBOT_SITE_URL"):    cfg["site_url"]    = os.environ["ROBOT_SITE_URL"]
        if os.environ.get("ROBOT_LOGIN_URL"):   cfg["login_url"]   = os.environ["ROBOT_LOGIN_URL"]
        if os.environ.get("ROBOT_EMAIL"):       cfg["email"]       = os.environ["ROBOT_EMAIL"]
        if os.environ.get("ROBOT_PASSWORD"):    cfg["password"]    = os.environ["ROBOT_PASSWORD"]
        try:
            result = asyncio.run(do_test_login_only(cfg))
        except Exception as e:
            result = {"ok": False, "message": str(e)}
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result.get("ok") else 1)
    else:
        ensure_playwright_browser()
        robot_loop()
