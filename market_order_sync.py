#!/usr/bin/env python3
"""
market_order_sync.py — Đồng bộ "Đơn hàng chợ"
Module HOÀN TOÀN ĐỘC LẬP với sync_robot.py.
Không thay đổi bất kỳ luồng nào của "Tất cả đơn hàng".

Luồng:
  1. Đăng nhập website (tái sử dụng loginAndWaitReady từ sync_robot)
  2. Mở trang "Đơn hàng" (tái sử dụng _open_orders_page)
  3. Click tab "Đơn hàng chợ"
  4. Chờ nút "Tải xuống" → download file XLSX
  5. Parse XLSX lấy các cột: Mã đơn, Người bán, Người mua,
     Sản phẩm, SL, Giá mua, Giá bán, Lợi nhuận,
     Trạng thái giao dịch, Hoàn tất, Số dư sau GD
  6. Lưu vào market_orders.json — chống trùng theo mã đơn
  7. Đồng bộ đơn mới vào Google Sheets (tab riêng "Đơn hàng chợ")
  8. Cập nhật status + log riêng

Data files:
  data/market_orders.json            — dữ liệu đơn hàng chợ
  data/market_order_sync_status.json — trạng thái sync riêng
  data/market_order_sync_logs.json   — lịch sử sync riêng

order_source = "MARKET_ORDER" (phân biệt với "ALL_ORDERS")
"""
import os
import sys
import json
import time
import asyncio
import logging
import traceback
import re
import unicodedata
import tempfile
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger("market_order_sync")
if not logger.handlers:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s [market] %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))

MARKET_ORDERS_FILE = DATA_DIR / "market_orders.json"
MARKET_STATUS_FILE = DATA_DIR / "market_order_sync_status.json"
MARKET_LOG_FILE    = DATA_DIR / "market_order_sync_logs.json"
MARKET_SYNCED_FILE = DATA_DIR / "market_sheets_synced.json"   # chống trùng sheet

MAX_LOGS = 200


# ── JSON helpers (standalone — không import từ sync_robot để tránh side-effect) ─

def _load_json(path, default):
    try:
        p = Path(path)
        if p.exists():
            with open(p, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _save_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(p) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, str(p))

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


# ── Status / log (riêng, độc lập) ─────────────────────────────────────────────

def write_market_status(data: dict):
    existing = _load_json(MARKET_STATUS_FILE, {})
    existing.update(data)
    existing["updated_at"] = _now_iso()
    _save_json(MARKET_STATUS_FILE, existing)

def append_market_log(entry: dict):
    logs = _load_json(MARKET_LOG_FILE, [])
    logs.append(entry)
    if len(logs) > MAX_LOGS:
        logs = logs[-MAX_LOGS:]
    _save_json(MARKET_LOG_FILE, logs)

def read_market_orders() -> dict:
    return _load_json(MARKET_ORDERS_FILE, {})

def save_market_orders(orders: dict):
    _save_json(MARKET_ORDERS_FILE, orders)


# ── XLSX column normalization ──────────────────────────────────────────────────

_MARKET_COL_MAP = {
    # ── STT ───────────────────────────────────────────────────────────────
    "stt":                       "stt",
    "no":                        "stt",
    "#":                         "stt",
    # ── Mã đơn ────────────────────────────────────────────────────────────
    "ma don":                    "order_id",
    "ma don hang":               "order_id",
    "order id":                  "order_id",
    "id":                        "order_id",
    "code":                      "order_id",
    "so don":                    "order_id",
    # ── Sản phẩm ──────────────────────────────────────────────────────────
    "san pham":                  "product_name",
    "product":                   "product_name",
    "ten san pham":              "product_name",
    "ten sp":                    "product_name",
    "mo ta":                     "product_name",
    "san pham nguon":            "source_product",   # col 13: Sản phẩm nguồn
    # ── Số lượng ──────────────────────────────────────────────────────────
    "so luong":                  "quantity",
    "sl":                        "quantity",
    "qty":                       "quantity",
    # ── Giá (cột 4: Số tiền = giá bán ra cho khách) ───────────────────────
    "so tien":                   "sell_price",       # col 4: Số tiền (giá bán)
    "gia ban don hang":          "sell_price",       # col 14: Giá bán đơn hàng
    "gia ban":                   "sell_price",
    "gia ban ra":                "sell_price",
    # ── Giá nguồn = giá seller phải mua (= "Giá mua" trong web UI) ───────
    "gia nguon":                 "price",            # col 15: Giá nguồn (giá mua/cost)
    "gia mua":                   "price",
    "gia":                       "price",
    "don gia":                   "price",
    # ── Phí & tổng ────────────────────────────────────────────────────────
    "phi cho":                   "fee",              # col 16: Phí chợ
    "tong seller mua cho":       "total_cost",       # col 17: Tổng seller mua chợ
    "thanh tien":                "total_cost",
    "tong tien":                 "total_cost",
    # ── Trạng thái ────────────────────────────────────────────────────────
    "trang thai":                "status",           # col 5: Trạng thái
    "status":                    "status",
    "trang thai giao dich":      "status_tx",        # col 18: Trạng thái giao dịch
    # ── Người bán (seller) ────────────────────────────────────────────────
    "seller ban":                "seller",           # col 12: Seller bán ← tên thật trong XLSX
    "nguoi ban":                 "seller",
    "seller":                    "seller",
    "ten nguoi ban":             "seller",
    # ── Người mua (buyer) ─────────────────────────────────────────────────
    "nguoi mua":                 "buyer",
    "buyer":                     "buyer",
    "khach hang":                "buyer",
    "ten khach":                 "buyer",
    "ten nguoi mua":             "buyer",
    # ── Thời gian ─────────────────────────────────────────────────────────
    "tao luc":                   "created_at",       # col 7: Tạo lúc
    "thanh toan":                "payment_at",       # col 8: Thanh toán
    "da giao":                   "delivered_at",     # col 9: Đã giao
    "chot cho luc":              "completed_at",     # col 19: Chốt chợ lúc ← "Hoàn tất" trong ảnh
    "bien dong vi luc":          "wallet_change_at", # col 20: Biến động ví lúc
    "hoan tat":                  "completed_at",
    "thoi gian hoan tat":        "completed_at",
    "ngay hoan tat":             "completed_at",
    "ngay tao":                  "created_at",
    # ── Tài khoản đã giao ─────────────────────────────────────────────────
    "tai khoan da giao":         "content",          # col 10: Tài khoản đã giao
    "noi dung":                  "content",
    # ── Loại giao dịch ────────────────────────────────────────────────────
    "loai giao dich":            "transaction_type", # col 11: Loại giao dịch
    # ── Số dư sau GD ──────────────────────────────────────────────────────
    "so du sau gd":              "balance_after",    # col 21: Số dư sau GD ← tên thật
    "so du sau":                 "balance_after",
    "so du":                     "balance_after",
    "balance":                   "balance_after",
    "so du sau giao dich":       "balance_after",
    # ── Email slot ────────────────────────────────────────────────────────
    "email slot":                "email_slot",       # col 6
}

def _normalize_col_key(s: str) -> str:
    s = str(s).lower().strip()
    for src, tgt in [("đ", "d"), ("Đ", "d")]:
        s = s.replace(src, tgt)
    s = unicodedata.normalize("NFD", s)
    s = re.sub(r"[\u0300-\u036f]", "", s)
    s = re.sub(r"[-_/\s]+", " ", s).strip()
    return s

def _parse_price(val) -> str:
    """Trả chuỗi nguyên bản hoặc đã format từ số."""
    if val is None:
        return ""
    if isinstance(val, (int, float)):
        return f"{int(val):,}".replace(",", ".") + "đ"
    return str(val).strip()

def _parse_date(val) -> str:
    """Trả chuỗi date đã chuẩn hoá."""
    if val is None:
        return ""
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val).strip()


# ── Parse XLSX (tương tự sync_robot nhưng dành cho "Đơn hàng chợ") ────────────

def parse_market_xlsx(xlsx_path: str) -> list:
    """
    Đọc file XLSX "Đơn hàng chợ" → list dict.
    Tự phát hiện header row, map cột theo _MARKET_COL_MAP.
    Bắt buộc có cột Mã đơn. Các cột khác optional.
    """
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl chưa cài. Chạy: pip install openpyxl")

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = iter(ws.rows)

    # Tìm header row (dòng đầu tiên có "mã đơn" hoặc tương đương)
    col_map: dict = {}   # col_index → field_name
    header_row_found = False
    max_header_scan = 10

    for i, row in enumerate(rows_iter):
        raw = [cell.value for cell in row]
        norm = [_normalize_col_key(str(h or "")) for h in raw]

        # Kiểm tra có ít nhất 1 cột nhận dạng được là "order_id"
        found_order_id = any(_MARKET_COL_MAP.get(n) == "order_id" for n in norm)
        if found_order_id:
            for idx, n in enumerate(norm):
                field = _MARKET_COL_MAP.get(n)
                if field:
                    col_map[idx] = field
            header_row_found = True
            logger.info(f"[MARKET-XLSX] Header row tại dòng {i+1}: {col_map}")
            break
        if i >= max_header_scan:
            break

    if not header_row_found or not col_map:
        wb.close()
        raise RuntimeError(
            "Không tìm thấy cột Mã đơn trong file XLSX — "
            "hãy kiểm tra lại file tải về từ tab 'Đơn hàng chợ'"
        )

    def _get(cells: list, field: str):
        for idx, f in col_map.items():
            if f == field and idx < len(cells):
                return cells[idx]
        return None

    parsed: list = []
    for row in rows_iter:
        cells = [cell.value for cell in row]
        # Bỏ dòng trống
        if all(c is None or str(c).strip() == "" for c in cells):
            continue

        order_id_raw = _get(cells, "order_id")
        order_id = str(order_id_raw or "").strip().upper()
        if not order_id:
            continue

        parsed.append({
            "order_id":          order_id,
            "stt":               str(_get(cells, "stt")              or "").strip(),
            "product_name":      str(_get(cells, "product_name")     or "").strip(),
            "quantity":          str(_get(cells, "quantity")         or "").strip(),
            # Giá mua = Giá nguồn (chi phí seller trả), Giá bán = Số tiền khách trả
            "price":             _parse_price(_get(cells, "price")),        # Giá nguồn / Giá mua
            "sell_price":        _parse_price(_get(cells, "sell_price")),   # Số tiền / Giá bán
            "fee":               _parse_price(_get(cells, "fee")),          # Phí chợ
            "total_cost":        _parse_price(_get(cells, "total_cost")),   # Tổng seller mua
            "status":            str(_get(cells, "status")           or "").strip(),
            "status_tx":         str(_get(cells, "status_tx")        or "").strip(),  # Trạng thái giao dịch
            "seller":            str(_get(cells, "seller")           or "").strip(),  # Seller bán
            "buyer":             str(_get(cells, "buyer")            or "").strip(),
            "transaction_type":  str(_get(cells, "transaction_type") or "").strip(),
            "content":           str(_get(cells, "content")          or "").strip(),  # Tài khoản đã giao
            "created_at":        _parse_date(_get(cells, "created_at")),    # Tạo lúc
            "payment_at":        _parse_date(_get(cells, "payment_at")),    # Thanh toán
            "delivered_at":      _parse_date(_get(cells, "delivered_at")),  # Đã giao
            "completed_at":      _parse_date(_get(cells, "completed_at")),  # Chốt chợ lúc = Hoàn tất
            "balance_after":     _parse_price(_get(cells, "balance_after")),# Số dư sau GD
        })

    wb.close()
    logger.info(f"[MARKET-XLSX] Parse xong: {len(parsed)} đơn")
    return parsed


# ── Playwright: navigate to "Đơn hàng chợ" tab ───────────────────────────────

async def _navigate_to_market_tab(page) -> bool:
    """Từ trang Orders, tìm + click tab 'Đơn hàng chợ'."""
    SELECTORS = [
        'a:has-text("Đơn hàng chợ")',
        'button:has-text("Đơn hàng chợ")',
        '[role=tab]:has-text("Đơn hàng chợ")',
        '[role=menuitem]:has-text("Đơn hàng chợ")',
        'li:has-text("Đơn hàng chợ")',
        'span:has-text("Đơn hàng chợ")',
    ]
    for _ in range(20):     # poll 10s
        for sel in SELECTORS:
            try:
                el = page.locator(sel).first
                if await el.count() > 0 and await el.is_visible():
                    logger.info(f"[MARKET] Tìm thấy tab 'Đơn hàng chợ': {sel!r}")
                    await el.click()
                    await asyncio.sleep(1.5)
                    return True
            except Exception:
                pass
        await asyncio.sleep(0.5)

    # Fallback JS: tìm element chứa text "chợ"
    try:
        fallbacks = await page.evaluate(r"""() => {
            return Array.from(document.querySelectorAll('a,button,[role=tab],[role=menuitem]'))
                .filter(el => /ch\u1ee3/i.test(el.innerText || ''))
                .map(el => ({ tag: el.tagName, text: (el.innerText||'').trim().slice(0,50) }));
        }""")
        logger.warning(f"[MARKET] Không tìm được selector chuẩn — fallbacks: {fallbacks}")
    except Exception:
        pass

    return False


async def _download_market_xlsx(page, download_dir: str) -> str:
    """
    Sau khi đang ở tab 'Đơn hàng chợ', click nút 'Tải xuống' để tải XLSX.
    Trả đường dẫn file đã lưu. Raise RuntimeError nếu thất bại.
    """
    from playwright.async_api import TimeoutError as PwTimeout

    DL_SELECTORS = [
        'button:has-text("Tải xuống")',
        'button:has-text("Tải Xuống")',
        'a:has-text("Tải xuống")',
        'button[aria-label*="download" i]',
        'button:has-text("Download")',
        'button:has-text("Export")',
        'button:has-text("Xuất")',
        'a[download]',
    ]

    # Chờ nút "Tải xuống" xuất hiện sau khi click tab (tối đa 15s)
    dl_sel = None
    for _ in range(30):
        for sel in DL_SELECTORS:
            try:
                el = page.locator(sel).first
                if await el.count() > 0 and await el.is_visible():
                    dl_sel = sel
                    break
            except Exception:
                pass
        if dl_sel:
            break
        await asyncio.sleep(0.5)

    if not dl_sel:
        raise RuntimeError(
            f"Đã click tab 'Đơn hàng chợ' nhưng không tìm thấy nút 'Tải xuống' — "
            f"URL={page.url}"
        )

    logger.info(f"[MARKET] Nhấn nút tải xuống: {dl_sel!r}")
    out_path = os.path.join(download_dir, "market_orders.xlsx")

    # Thử tải trực tiếp
    try:
        async with page.expect_download(timeout=8_000) as dl_info:
            await page.locator(dl_sel).first.click()
        dl = await dl_info.value
        await dl.save_as(out_path)
        size = os.path.getsize(out_path)
        if size >= 100:
            logger.info(f"[MARKET] XLSX tải xong → {out_path} ({size} bytes)")
            return out_path
    except PwTimeout:
        pass  # có thể nút mở dropdown
    except Exception as ex:
        logger.warning(f"[MARKET] Tải trực tiếp thất bại: {ex} — thử dropdown")

    # Kiểm tra dropdown XLSX/Excel
    await page.wait_for_timeout(600)
    XLSX_OPT_SELS = [
        'text=XLSX', 'text=Excel', 'text=Xuất Excel', 'text=Tải XLSX',
        '*:has-text("XLSX")', '*:has-text("Excel")',
        'a:has-text("XLSX")', '[role="menuitem"]:has-text("XLSX")',
        '[role="option"]:has-text("XLSX")',
    ]
    for xsel in XLSX_OPT_SELS:
        try:
            xel = page.locator(xsel).first
            if await xel.count() > 0 and await xel.is_visible():
                logger.info(f"[MARKET] Dropdown XLSX phát hiện: {xsel!r}")
                async with page.expect_download(timeout=30_000) as dl_info:
                    await xel.click()
                dl = await dl_info.value
                await dl.save_as(out_path)
                size = os.path.getsize(out_path)
                if size >= 100:
                    logger.info(f"[MARKET] XLSX tải qua dropdown → {out_path} ({size} bytes)")
                    return out_path
                raise RuntimeError(f"File tải xuống quá nhỏ ({size} bytes)")
        except Exception as ex:
            logger.warning(f"[MARKET] Dropdown {xsel!r} thất bại: {ex}")
            continue

    # Retry trực tiếp với timeout dài hơn
    try:
        async with page.expect_download(timeout=30_000) as dl_info:
            await page.locator(dl_sel).first.click()
        dl = await dl_info.value
        await dl.save_as(out_path)
        size = os.path.getsize(out_path)
        if size >= 100:
            logger.info(f"[MARKET] XLSX tải xong (retry) → {out_path} ({size} bytes)")
            return out_path
        raise RuntimeError(f"File tải xuống quá nhỏ ({size} bytes)")
    except Exception as ex:
        raise RuntimeError(f"Không tải được file XLSX Đơn hàng chợ: {ex}")


# ── Playwright session (độc lập, không chia sẻ với sync_robot) ────────────────

async def _do_market_playwright_sync(config: dict) -> dict:
    from playwright.async_api import async_playwright

    # Tái sử dụng loginAndWaitReady + _open_orders_page từ sync_robot
    try:
        from sync_robot import loginAndWaitReady, _open_orders_page  # type: ignore
    except ImportError as e:
        return {"ok": False, "error": f"Không import sync_robot: {e}", "rows": []}

    result: dict = {
        "ok": False, "login_ok": False, "nav_tab_ok": False,
        "download_ok": False, "rows": [], "error": "",
    }

    download_dir = tempfile.mkdtemp(prefix="market_sync_")

    _SYSTEM_CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium"

    async with async_playwright() as pw:
        launch_kwargs: dict = {
            "headless": True,
            "args": ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
                     "--disable-blink-features=AutomationControlled",
                     "--window-size=1280,800"],
        }
        import os as _os
        if _os.path.exists(_SYSTEM_CHROMIUM):
            launch_kwargs["executable_path"] = _SYSTEM_CHROMIUM
        browser = await pw.chromium.launch(**launch_kwargs)
        ctx = await browser.new_context(
            accept_downloads=True,          # PHẢI bật để tải XLSX
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            extra_http_headers={
                "sec-ch-ua": '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "accept-language": "vi-VN,vi;q=0.9,en;q=0.8",
            },
        )
        page = await ctx.new_page()
        await ctx.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3] });
            Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en'] });
            window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };
            Object.defineProperty(navigator, 'platform',  { get: () => 'Win32' });
        """)

        try:
            logger.info(f"[MARKET] Đăng nhập {config.get('site_url','')!r}")
            await loginAndWaitReady(page, config, source="market_sync")
            result["login_ok"] = True

            # Mở trang Đơn hàng (sidebar → click "Đơn hàng")
            await _open_orders_page(page)
            logger.info("[MARKET] ✅ Đang ở trang Đơn hàng")

            # Click tab "Đơn hàng chợ"
            nav_ok = await _navigate_to_market_tab(page)
            result["nav_tab_ok"] = nav_ok
            if not nav_ok:
                result["error"] = "Không tìm thấy tab 'Đơn hàng chợ' trên trang Đơn hàng"
                return result
            logger.info("[MARKET] ✅ Đã click tab Đơn hàng chợ")

            # Download XLSX
            xlsx_path = await _download_market_xlsx(page, download_dir)
            result["download_ok"] = True
            logger.info(f"[MARKET] ✅ XLSX đã tải: {xlsx_path}")

            # Parse
            rows = parse_market_xlsx(xlsx_path)
            result["rows"] = rows
            result["ok"]   = True

        except Exception as e:
            logger.error(f"[MARKET] Playwright error: {e}\n{traceback.format_exc()}")
            result["error"] = str(e)
        finally:
            try:
                await browser.close()
            except Exception:
                pass
            # Dọn temp dir
            try:
                import shutil
                shutil.rmtree(download_dir, ignore_errors=True)
            except Exception:
                pass

    return result


# ── Google Sheets sync (đơn hàng chợ) ─────────────────────────────────────────

MARKET_SHEET_HEADERS = [
    "STT", "Mã đơn", "Seller bán", "Sản phẩm", "SL",
    "Giá nguồn (mua)", "Số tiền (bán)", "Phí chợ",
    "Trạng thái", "Trạng thái GD", "Hoàn tất (Chốt chợ)",
    "Tạo lúc", "Số dư sau GD", "Ngày đồng bộ",
]

import re as _re

def _normalize_name(s: str) -> str:
    """
    Chuẩn hóa tên sản phẩm:
      - Lowercase
      - Bỏ ký tự đặc biệt (giữ chữ, số, khoảng trắng)
      - Collapse khoảng trắng thừa
    Ví dụ: "GROK SUPER BHF 🔥" → "grok super bhf"
    """
    s = s.lower()
    s = _re.sub(r'[^\w\s]', ' ', s)
    s = _re.sub(r'\s+', ' ', s).strip()
    return s


def _resolve_tab(product_name: str, config: dict, default_tab: str) -> str:
    """
    Tìm tab phù hợp cho đơn hàng theo config (tab_rules hoặc tab_mappings cũ).

    Chế độ mới — tab_rules (include + exclude):
      1. Chuẩn hóa tên sản phẩm
      2. Với từng rule:
         - Nếu tên chứa bất kỳ từ khóa Loại trừ → bỏ qua
         - Đếm số từ khóa Bao gồm xuất hiện trong tên
         - Cần ≥1 include khớp
      3. Chọn rule có nhiều include khớp nhất (cụ thể hơn thắng)

    Fallback — tab_mappings cũ:
      - Dùng khi không có tab_rules
    """
    name_norm    = _normalize_name(product_name)
    name_nospace = name_norm.replace(' ', '')      # "chat gpt" ≈ "chatgpt"

    # ── Chế độ mới: tab_rules ─────────────────────────────────────────────────
    tab_rules: list = config.get("tab_rules") or []
    if tab_rules:
        best_tab   = None
        best_score = 0

        for rule in tab_rules:
            tab      = (rule.get("tab") or "").strip()
            includes = [k.lower().strip() for k in (rule.get("include") or []) if k.strip()]
            excludes = [k.lower().strip() for k in (rule.get("exclude") or []) if k.strip()]

            if not tab or not includes:
                continue

            # Bất kỳ exclude keyword nào khớp → bỏ qua ngay
            if any(kw in name_norm or kw in name_nospace for kw in excludes):
                continue

            # Đếm include keyword khớp (so sánh cả có/không dấu cách)
            matched = sum(
                1 for kw in includes
                if kw in name_norm or kw in name_nospace
            )
            if matched > 0 and matched > best_score:
                best_score = matched
                best_tab   = tab

        return best_tab if best_tab else default_tab

    # ── Fallback: tab_mappings cũ ─────────────────────────────────────────────
    tab_mappings: dict = config.get("tab_mappings") or {}
    if not tab_mappings:
        return default_tab

    best_tab   = None
    best_score = 0
    for keyword, tab in tab_mappings.items():
        # Tách CamelCase: "ChatGPT" → ["chat","gpt"]
        spaced = _re.sub(r'(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', ' ', keyword)
        words  = [w.lower() for w in spaced.split() if len(w) > 1]
        matched = sum(1 for w in words if w in name_norm or w in name_nospace)
        if matched >= 1 and matched > best_score:
            best_score = matched
            best_tab   = tab.strip()

    return best_tab if best_tab else default_tab


def _get_or_create_worksheet(spreadsheet, tab_name: str, headers: list):
    """
    Lấy worksheet theo tên (exact → case-insensitive → tạo mới).
    Không bao giờ tạo tab mới nếu đã có tab khớp case-insensitive.
    """
    # ── Lấy danh sách tất cả worksheets 1 lần ─────────────────────────────────
    all_ws = spreadsheet.worksheets()
    name_lower = tab_name.strip().lower()

    # Exact match
    for w in all_ws:
        if w.title == tab_name:
            return w

    # Case-insensitive match
    for w in all_ws:
        if w.title.strip().lower() == name_lower:
            logger.info(f"[MARKET-SHEETS] Tab khớp gần đúng: {w.title!r} ≈ {tab_name!r}")
            return w

    # Không tìm thấy → tạo mới
    ws = spreadsheet.add_worksheet(title=tab_name, rows=5000, cols=len(headers))
    ws.append_row(headers, value_input_option="USER_ENTERED")
    logger.info(f"[MARKET-SHEETS] Tạo mới tab: {tab_name!r}")
    return ws


def _sync_to_sheets(new_orders: list) -> dict:
    """
    Ghi đơn hàng chợ MỚI vào Google Sheets với phân tab theo ánh xạ sản phẩm.

    Luồng:
      1. Đọc config: spreadsheet_id, default_tab, tab_mappings
      2. Với mỗi đơn: match product_name với tab_mappings → chọn tab đích
      3. Nhóm đơn theo tab → ghi batch vào từng tab
      4. Chống trùng qua market_sheets_synced.json (lưu {order_id: {tab, synced_at}})
    """
    if not new_orders:
        return {"added": 0, "skipped_dup": 0, "errors": [], "skipped": False}

    try:
        config: dict = _load_json(DATA_DIR / "sheets_config.json", {})
    except Exception:
        config = {}

    if not config.get("sync_enabled"):
        return {"skipped": True, "reason": "Tính năng đồng bộ Sheet chưa được bật"}

    spreadsheet_id = (config.get("spreadsheet_id") or "").strip()
    if not spreadsheet_id:
        return {"skipped": True, "reason": "Chưa cấu hình Spreadsheet ID"}

    default_tab  = (config.get("default_tab")  or "Đơn Hàng").strip()

    synced: dict = _load_json(MARKET_SYNCED_FILE, {})

    # ── Kết nối Google Sheets ──────────────────────────────────────────────────
    try:
        import gspread  # type: ignore
        from google.oauth2.service_account import Credentials  # type: ignore

        sa_json_str = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
        if not sa_json_str:
            sa_file = DATA_DIR / "google_sa.json"
            if sa_file.exists():
                sa_json_str = sa_file.read_text(encoding="utf-8").strip()
        if not sa_json_str:
            return {"skipped": True, "reason": "Chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON"}

        creds       = Credentials.from_service_account_info(
            json.loads(sa_json_str),
            scopes=["https://www.googleapis.com/auth/spreadsheets"],
        )
        spreadsheet = gspread.authorize(creds).open_by_key(spreadsheet_id)
    except Exception as e:
        logger.error(f"[MARKET-SHEETS] Không mở được spreadsheet: {e}")
        return {"added": 0, "skipped_dup": 0, "errors": [str(e)], "fatal": True}

    # ── Phân loại đơn theo tab ─────────────────────────────────────────────────
    # groups: {tab_name: [order, ...]}
    groups: dict = {}
    skipped_dup  = 0

    for order in new_orders:
        order_id = str(order.get("order_id", "")).strip().upper()
        if not order_id:
            continue

        product_name = order.get("product_name", "")
        tab = _resolve_tab(product_name, config, default_tab)

        if order_id in synced:
            if synced[order_id].get("tab") == tab:
                # Đã synced đúng tab → bỏ qua
                skipped_dup += 1
                continue
            # Tab thay đổi (do cập nhật tab_rules) → xóa record cũ, ghi lại
            logger.info(
                f"[MARKET-SHEETS] Re-sync {order_id}: "
                f"{synced[order_id].get('tab')!r} → {tab!r}"
            )
            del synced[order_id]

        groups.setdefault(tab, []).append(order)

    if not groups:
        _save_json(MARKET_SYNCED_FILE, synced)
        return {"added": 0, "skipped_dup": skipped_dup, "errors": [], "skipped": False,
                "tab_summary": {}}

    # ── Ghi từng tab ──────────────────────────────────────────────────────────
    added       = 0
    errors: list = []
    tab_summary: dict = {}   # {tab_name: count}
    now_str      = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ws_cache: dict = {}

    for tab_name, orders in groups.items():
        logger.info(f"[MARKET-SHEETS] Tab {tab_name!r}: {len(orders)} đơn")
        try:
            if tab_name not in ws_cache:
                ws_cache[tab_name] = _get_or_create_worksheet(
                    spreadsheet, tab_name, MARKET_SHEET_HEADERS
                )
            ws = ws_cache[tab_name]

            # Sort mới nhất lên đầu — dùng completed_at hoặc created_at_raw
            def _order_sort_key(o):
                return o.get("completed_at", "") or o.get("created_at_raw", "") or ""
            orders_sorted = sorted(orders, key=_order_sort_key, reverse=True)

            rows_to_insert = []
            order_ids_ok   = []

            for order in orders_sorted:
                order_id = str(order.get("order_id", "")).strip().upper()
                row_data = [
                    "",                               # STT — để trống, tự quản
                    order_id,
                    order.get("seller",       ""),
                    order.get("product_name", ""),
                    order.get("quantity",     ""),
                    order.get("price",        ""),   # Giá nguồn (mua)
                    order.get("sell_price",   ""),   # Số tiền (bán)
                    order.get("fee",          ""),   # Phí chợ
                    order.get("status",       ""),
                    order.get("status_tx",    ""),   # Trạng thái giao dịch
                    order.get("completed_at", ""),   # Chốt chợ lúc
                    order.get("created_at_raw", ""),
                    order.get("balance_after",""),
                    now_str,                          # Ngày đồng bộ
                ]
                rows_to_insert.append(row_data)
                order_ids_ok.append(order_id)

            # Ghi batch — insert tại row 2 → đơn mới nhất luôn ở đầu
            if rows_to_insert:
                ws.insert_rows(rows_to_insert, row=2,
                               value_input_option="USER_ENTERED")
                for order_id in order_ids_ok:
                    synced[order_id] = {"tab": tab_name, "synced_at": now_str}
                added += len(order_ids_ok)
                logger.info(f"[MARKET-SHEETS] ✔ Ghi {len(order_ids_ok)} đơn → {tab_name!r}")

            tab_summary[tab_name] = len(order_ids_ok)

        except Exception as e:
            logger.error(f"[MARKET-SHEETS] Lỗi tab {tab_name!r}: {e}")
            for order in orders:
                errors.append({
                    "order_id": str(order.get("order_id", "")),
                    "tab": tab_name, "error": str(e),
                })

    try:
        _save_json(MARKET_SYNCED_FILE, synced)
    except Exception as e:
        logger.warning(f"[MARKET-SHEETS] Không lưu market_sheets_synced.json: {e}")

    return {
        "added":       added,
        "skipped_dup": skipped_dup,
        "errors":      errors,
        "tab_summary": tab_summary,
    }


# ── Public: sync_market_orders ─────────────────────────────────────────────────

def sync_market_orders(config: dict | None = None) -> dict:
    """
    Entry point chính — chạy đồng bộ Đơn hàng chợ.
    Hoàn toàn độc lập: lỗi ở đây KHÔNG ảnh hưởng sync_all_orders.

    config: None → tự đọc từ sync_robot_config.json
    Returns: dict kết quả với new_orders, updated_orders, skipped_orders, errors, message
    """
    if config is None:
        try:
            from sync_robot import load_config  # type: ignore
            config = load_config()
        except ImportError:
            config = _load_json(DATA_DIR / "sync_robot_config.json", {})

    start_ts = time.time()
    result: dict = {
        "started_at":     _now_iso(),
        "ended_at":       None,
        "duration_s":     0,
        "success":        False,
        "login_ok":       False,
        "nav_tab_ok":     False,
        "download_ok":    False,
        "new_orders":     0,
        "updated_orders": 0,
        "skipped_orders": 0,
        "sheets_added":   0,
        "errors":         0,
        "message":        "",
    }

    write_market_status({"running": True, "last_started_at": result["started_at"]})

    try:
        pw_result = asyncio.run(_do_market_playwright_sync(config))
        result["login_ok"]    = pw_result.get("login_ok",    False)
        result["nav_tab_ok"]  = pw_result.get("nav_tab_ok",  False)
        result["download_ok"] = pw_result.get("download_ok", False)

        if not pw_result.get("ok"):
            err = pw_result.get("error", "Lỗi không rõ")
            result["message"] = f"❌ {err}"
            result["errors"]  = 1
            return result

        rows = pw_result.get("rows", [])
        logger.info(f"[MARKET] Xử lý {len(rows)} rows vào database")

        market_orders = read_market_orders()
        now_str = _now_iso()
        new_count = updated_count = skipped_count = 0
        truly_new: list = []   # đơn chưa tồn tại — để ghi vào Sheets

        for row in rows:
            order_id = str(row.get("order_id", "")).strip().upper()
            if not order_id:
                continue

            new_entry = {
                "order_id":         order_id,
                "stt":              row.get("stt",              ""),
                "product_name":     row.get("product_name",     ""),
                "quantity":         row.get("quantity",         ""),
                "price":            row.get("price",            ""),   # Giá nguồn (mua)
                "sell_price":       row.get("sell_price",       ""),   # Số tiền (bán)
                "fee":              row.get("fee",              ""),   # Phí chợ
                "total_cost":       row.get("total_cost",       ""),   # Tổng seller mua
                "status":           row.get("status",           ""),
                "status_tx":        row.get("status_tx",        ""),   # Trạng thái giao dịch
                "seller":           row.get("seller",           ""),   # Seller bán
                "buyer":            row.get("buyer",            ""),
                "transaction_type": row.get("transaction_type", ""),
                "content":          row.get("content",          ""),
                "created_at_raw":   row.get("created_at",       ""),
                "payment_at":       row.get("payment_at",       ""),
                "delivered_at":     row.get("delivered_at",     ""),
                "completed_at":     row.get("completed_at",     ""),   # Chốt chợ lúc
                "balance_after":    row.get("balance_after",    ""),
                "order_source":     "MARKET_ORDER",
                "synced_at":        now_str,
            }

            existing = market_orders.get(order_id)

            if not existing:
                new_entry["created_at"] = now_str
                market_orders[order_id] = new_entry
                new_count += 1
                truly_new.append(new_entry)
            else:
                # Giữ nguyên dữ liệu cũ — chỉ cập nhật trường thay đổi
                changed = False
                for field in ("status", "profit", "sell_price", "balance_after", "completed_at"):
                    nv = new_entry.get(field, "")
                    if nv and nv != existing.get(field, ""):
                        existing[field] = nv
                        changed = True
                for field in ("seller", "buyer", "product_name", "quantity", "price"):
                    if not existing.get(field) and new_entry.get(field):
                        existing[field] = new_entry[field]
                        changed = True
                existing["synced_at"]    = now_str
                existing["order_source"] = "MARKET_ORDER"
                market_orders[order_id]  = existing
                if changed:
                    updated_count += 1
                else:
                    skipped_count += 1

        save_market_orders(market_orders)

        # ── Ghi đơn mới vào Google Sheets ─────────────────────────────────────
        sheets_result = {"added": 0, "skipped": False}
        if truly_new:
            try:
                sheets_result = _sync_to_sheets(truly_new)
                result["sheets_added"] = sheets_result.get("added", 0)
            except Exception as se:
                logger.warning(f"[MARKET] Lỗi Sheets sync: {se}")

        result["new_orders"]     = new_count
        result["updated_orders"] = updated_count
        result["skipped_orders"] = skipped_count
        result["success"]        = True

        sheets_note = ""
        if not sheets_result.get("skipped"):
            sheets_note = f", Sheet: +{result['sheets_added']}"

        result["message"] = (
            f"✔ Đồng bộ Đơn hàng chợ "
            f"lúc {datetime.now().strftime('%H:%M %d/%m/%Y')}: "
            f"{new_count} mới, {updated_count} cập nhật, "
            f"{skipped_count} bỏ qua trùng{sheets_note}"
        )
        logger.info(result["message"])

    except Exception as exc:
        logger.error(f"[MARKET] Lỗi: {exc}\n{traceback.format_exc()}")
        result["message"] = f"❌ Lỗi: {exc}"
        result["errors"]  = 1
    finally:
        result["ended_at"]   = _now_iso()
        result["duration_s"] = round(time.time() - start_ts, 2)
        write_market_status({
            "running":  False,
            "last_run": result,
        })
        append_market_log(result)

    return result


# ── Push-all: đẩy toàn bộ đơn trong DB lên Sheets (bỏ qua đã sync) ───────────

def push_all_to_sheets(filter_tab: str | None = None) -> dict:
    """
    Đẩy đơn trong market_orders.json lên Google Sheets.
    filter_tab=None/"all" → đẩy tất cả
    filter_tab="Kling 66" → chỉ đẩy đơn resolve về tab "Kling 66"
    """
    orders_dict: dict = _load_json(MARKET_ORDERS_FILE, {})
    if not orders_dict:
        return {"ok": False, "message": "Không có đơn nào trong DB để đẩy lên Sheet."}

    config: dict    = _load_json(DATA_DIR / "sheets_config.json", {})
    default_tab     = (config.get("default_tab") or "Đơn Hàng").strip()

    all_orders = list(orders_dict.values())

    # Lọc theo tab nếu được chỉ định
    if filter_tab and filter_tab != "all":
        all_orders = [
            o for o in all_orders
            if _resolve_tab(o.get("product_name", ""), config, default_tab) == filter_tab
        ]
        if not all_orders:
            return {
                "ok": True, "added": 0, "skipped_dup": 0, "errors": [], "tab_summary": {},
                "message": f"Không có đơn nào thuộc tab '{filter_tab}'.",
            }

    result = _sync_to_sheets(all_orders)

    if result.get("skipped"):
        return {"ok": False, "message": result.get("reason", "Chưa cấu hình Google Sheets.")}

    added    = result.get("added",       0)
    skipped  = result.get("skipped_dup", 0)
    errors   = result.get("errors",      [])
    tab_sum  = result.get("tab_summary", {})
    scope    = f"tab '{filter_tab}'" if filter_tab and filter_tab != "all" else "tất cả"
    msg = f"✔ Đẩy {scope} lên Sheet: +{added} đơn mới, {skipped} đã có, {len(errors)} lỗi"
    logger.info(msg)
    return {"ok": True, "message": msg, "added": added, "skipped_dup": skipped,
            "errors": errors, "tab_summary": tab_sum}


# ── CLI entry ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys as _sys
    try:
        if len(_sys.argv) > 1 and _sys.argv[1] == "--push-all":
            tab_filter = None
            if "--tab" in _sys.argv:
                idx = _sys.argv.index("--tab")
                if idx + 1 < len(_sys.argv):
                    tab_filter = _sys.argv[idx + 1]
            print(json.dumps(push_all_to_sheets(filter_tab=tab_filter), ensure_ascii=False, indent=2))
        else:
            print(json.dumps(sync_market_orders(), ensure_ascii=False, indent=2))
    except Exception as _e:
        print(json.dumps({"ok": False, "message": f"Lỗi: {_e}"}, ensure_ascii=False))
