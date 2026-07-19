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
    Kiểm tra đăng nhập với debug chi tiết từng bước.
    Screenshot lưu thành file, KHÔNG trả base64 trong JSON.
    """
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout

    _cleanup_old_screenshots()
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    site_url  = config.get("site_url", "").rstrip("/")
    login_url = config.get("login_url", "").rstrip("/") or (f"{site_url}/login" if site_url else "")
    account   = config.get("email", "")   # có thể là username hoặc số điện thoại
    password  = config.get("password", "")

    if not site_url or not account or not password:
        missing = []
        if not site_url: missing.append("URL website")
        if not account:  missing.append("Tài khoản")
        if not password: missing.append("Mật khẩu")
        return {"ok": False, "message": f"Chưa cấu hình: {', '.join(missing)}", "steps": []}

    start    = time.time()
    ts       = int(start)
    step_n   = [0]   # dùng list để mutate trong closure
    steps    = []

    def elapsed() -> float:
        return round(time.time() - start, 2)

    async def snap(page, label_slug: str) -> str | None:
        """Lưu screenshot thành file, trả tên file. KHÔNG trả base64."""
        step_n[0] += 1
        fname = f"test_{ts}_s{step_n[0]}_{label_slug[:20]}.jpg"
        fpath = SCREENSHOTS_DIR / fname
        try:
            await page.screenshot(path=str(fpath), type="jpeg", quality=60, full_page=False)
            return fname
        except Exception:
            return None

    def add_step(label: str, ok: bool, note: str = "", screenshot_file: str | None = None):
        safe_note = _safe_text(note)
        steps.append({"step": label, "ok": ok, "note": safe_note, "screenshot_file": screenshot_file})
        log_note = safe_note[:200] if safe_note else ""
        logger.info(f"[test-login] {'✅' if ok else '❌'} {label}" + (f" — {log_note}" if log_note else ""))

    # ── Selectors ──────────────────────────────────────────────────────────────
    ACCOUNT_SELECTORS = [
        'input[name="email"]',
        'input[name="username"]',
        'input[name="user"]',
        'input[name="login"]',
        'input[name="phone"]',
        'input[type="email"]',
        'input[id="email"]',
        'input[id="username"]',
        'input[autocomplete="email"]',
        'input[autocomplete="username"]',
        'input[placeholder*="mail" i]',
        'input[placeholder*="tài khoản" i]',
        'input[placeholder*="user" i]',
        'input[placeholder*="phone" i]',
        'input[placeholder*="điện thoại" i]',
    ]
    PW_SELECTORS = [
        'input[type="password"]',
        'input[name="password"]',
        'input[name="pass"]',
        'input[id="password"]',
        'input[autocomplete="current-password"]',
    ]
    SUBMIT_SELECTORS = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Đăng nhập")',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
        'button:has-text("Đăng Nhập")',
        'button:has-text("LOG IN")',
        'button:has-text("Signin")',
        '[data-testid*="login"]',
        '[data-testid*="submit"]',
        'form button:visible',
    ]
    ERROR_SELECTORS = [
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
    LOGOUT_SELECTORS = [
        'a[href*="logout"]', 'a[href*="signout"]', 'a[href*="sign-out"]',
        'button:has-text("Logout")', 'button:has-text("Sign out")',
        'button:has-text("Đăng xuất")', 'a:has-text("Đăng xuất")',
        '[data-testid*="logout"]', '[aria-label*="logout" i]',
        '.user-menu', '.account-menu', '.avatar',
    ]

    async def find_visible(page, selectors: list[str]) -> str | None:
        for sel in selectors:
            try:
                el = page.locator(sel).first
                if await el.count() > 0 and await el.is_visible():
                    return sel
            except Exception:
                pass
        return None

    async def get_error_text(page) -> str:
        """Lấy text lỗi từ trang — loại bỏ base64."""
        for sel in ERROR_SELECTORS:
            try:
                el = page.locator(sel).first
                if await el.count() > 0 and await el.is_visible():
                    t = (await el.inner_text()).strip()
                    t = _safe_text(t, max_len=300)
                    if t and "[ảnh-đã-ẩn]" not in t:
                        return t
            except Exception:
                pass
        return ""

    async def check_logged_in(page, url_before: str) -> tuple[bool, str]:
        """Kiểm tra đa tín hiệu — trả (logged_in, reason)."""
        curr = page.url
        # Tín hiệu 1: URL rời khỏi login
        login_kws = ("login", "signin", "sign-in", "auth/login", "/account/login", "/user/login")
        url_left_login = not any(kw in curr.lower() for kw in login_kws)
        # Tín hiệu 2: Có nút logout / avatar
        has_logout = await find_visible(page, LOGOUT_SELECTORS) is not None
        # Tín hiệu 3: Form đăng nhập biến mất
        login_form_gone = await find_visible(page, ACCOUNT_SELECTORS) is None

        if url_left_login and (has_logout or login_form_gone):
            return True, f"URL đổi sang {curr}, tìm thấy tín hiệu đăng nhập thành công"
        if url_left_login:
            return True, f"URL đổi sang {curr}"
        if has_logout and login_form_gone:
            return True, "Tìm thấy nút đăng xuất và form login đã ẩn"
        return False, ""

    result: dict = {
        "ok": False, "message": "", "url": "", "title": "",
        "error_text": "", "reason": "", "suggestion": "",
        "steps": steps, "duration_s": 0,
    }

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                  "--disable-extensions", "--window-size=1280,800"],
        )
        ctx  = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        )
        page = await ctx.new_page()

        try:
            # ── Bước 1: Mở trang login ────────────────────────────────────
            try:
                await page.goto(login_url, timeout=30_000, wait_until="domcontentloaded")
                sf = await snap(page, "open")
                add_step(f"Mở trang login", True, f"URL: {page.url}", sf)
            except Exception as ex:
                sf = await snap(page, "open_fail")
                add_step("Mở trang login", False, f"Lỗi: {ex}", sf)
                result.update({"message": f"Không mở được trang login: {_safe_text(str(ex))}",
                               "url": login_url, "duration_s": elapsed()})
                return result

            # ── Bước 2: Điền tài khoản ────────────────────────────────────
            acc_sel = await find_visible(page, ACCOUNT_SELECTORS)
            if not acc_sel:
                sf = await snap(page, "no_account")
                tried = " | ".join(ACCOUNT_SELECTORS[:6]) + " …"
                add_step("Tìm ô Tài khoản / Email", False,
                         f"Không tìm thấy selector.\nĐã thử: {tried}", sf)
                result.update({
                    "message": "Không tìm thấy ô nhập Tài khoản / Email trên trang",
                    "url": page.url, "title": await page.title(),
                    "error_text": f"Đã thử {len(ACCOUNT_SELECTORS)} selectors — không tìm thấy ô nhập liệu",
                    "reason": "Selector email/username không tồn tại",
                    "suggestion": "Kiểm tra lại URL đăng nhập hoặc cung cấp URL login chính xác hơn",
                    "duration_s": elapsed(),
                })
                return result

            await page.locator(acc_sel).first.fill(account)
            sf = await snap(page, "account")
            add_step(f"Điền Tài khoản [{acc_sel}]", True, f"Đã nhập tài khoản", sf)

            # ── Bước 3: Điền mật khẩu ────────────────────────────────────
            pw_sel = await find_visible(page, PW_SELECTORS)
            if not pw_sel:
                sf = await snap(page, "no_pw")
                add_step("Tìm ô Mật khẩu", False,
                         f"Không tìm thấy selector mật khẩu", sf)
                result.update({
                    "message": "Không tìm thấy ô nhập Mật khẩu trên trang",
                    "url": page.url, "title": await page.title(),
                    "error_text": f"Đã thử: {' | '.join(PW_SELECTORS)}",
                    "reason": "Selector mật khẩu không tồn tại",
                    "suggestion": "Trang có thể dùng đăng nhập nhiều bước — nhập tài khoản trước rồi mới hiện mật khẩu",
                    "duration_s": elapsed(),
                })
                return result

            await page.locator(pw_sel).first.fill(password)
            sf = await snap(page, "password")
            add_step(f"Điền Mật khẩu [{pw_sel}]", True, "Đã nhập mật khẩu (ẩn)", sf)

            # ── Bước 4: Bấm nút đăng nhập ────────────────────────────────
            submit_sel = await find_visible(page, SUBMIT_SELECTORS)
            if not submit_sel:
                sf = await snap(page, "no_submit")
                add_step("Tìm nút Đăng nhập", False, "Không tìm thấy nút submit", sf)
                result.update({
                    "message": "Không tìm thấy nút Đăng nhập trên trang",
                    "url": page.url, "title": await page.title(),
                    "error_text": f"Đã thử: {' | '.join(SUBMIT_SELECTORS[:5])} …",
                    "reason": "Nút submit không tồn tại hoặc bị ẩn",
                    "suggestion": "Thử cung cấp URL đăng nhập chính xác hơn",
                    "duration_s": elapsed(),
                })
                return result

            url_before = page.url
            await page.locator(submit_sel).first.click()
            sf = await snap(page, "after_click")
            add_step(f"Bấm nút Đăng nhập [{submit_sel}]", True, f"URL trước khi click: {url_before}", sf)

            # ── Bước 5: Chờ trang xử lý (tối đa 15s) ────────────────────
            try:
                await page.wait_for_function(
                    f"() => window.location.href !== {json.dumps(url_before)}",
                    timeout=12_000,
                )
            except PwTimeout:
                pass  # URL chưa đổi — tiếp tục kiểm tra bằng tín hiệu khác

            try:
                await page.wait_for_load_state("networkidle", timeout=8_000)
            except PwTimeout:
                pass

            curr_url   = page.url
            curr_title = await page.title()
            sf         = await snap(page, "result")
            error_text = await get_error_text(page)

            logged_in, login_reason = await check_logged_in(page, url_before)
            still_has_form = await find_visible(page, ACCOUNT_SELECTORS) is not None

            if logged_in:
                add_step(f"✅ Đăng nhập thành công → {curr_url}", True,
                         f"Tiêu đề: {curr_title}\n{login_reason}", sf)
                result.update({
                    "ok": True,
                    "message": f"Đăng nhập thành công! Redirect đến: {curr_url}",
                    "url": curr_url, "title": curr_title,
                    "duration_s": elapsed(),
                })
            else:
                reason, suggestion = _categorize_failure(error_text, curr_url, still_has_form)
                note_parts = [f"URL: {curr_url}", f"Tiêu đề: {curr_title}"]
                if error_text:
                    note_parts.append(f"Lỗi trang: {error_text}")
                note_parts.append(f"Nguyên nhân: {reason}")
                add_step("Xác minh sau đăng nhập", False, "\n".join(note_parts), sf)
                result.update({
                    "ok": False,
                    "message": "Đăng nhập thất bại",
                    "url": curr_url, "title": curr_title,
                    "error_text": error_text,
                    "reason": reason,
                    "suggestion": suggestion,
                    "duration_s": elapsed(),
                })

        except Exception as ex:
            sf = await snap(page, "exception")
            msg = _safe_text(str(ex))
            add_step("Lỗi không xác định", False, msg, sf)
            result.update({
                "message": f"Lỗi: {msg}",
                "url": page.url, "title": "",
                "duration_s": elapsed(),
            })
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
