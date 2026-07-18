// ─── XLSX Import Utilities ────────────────────────────────────────────────────
// Pure parsing helpers — no React dependencies.

export type Account = { email: string; password: string; twoFA: string; valid: boolean }

export type ParsedRow = {
  rowIndex: number
  orderCode: string
  productNameRaw: string
  productNameMapped: string | null
  quantity: number
  totalPrice: number
  unitPrice: number
  status: string
  customerName: string
  customerEmail: string
  purchaseDate: string | null
  originalDeliveredAt: string | null
  expiryDate: string | null
  warrantyEndDate: string | null
  warrantyDays: number
  usageDays: number
  accounts: Account[]
  issues: RowIssue[]
  rowStatus: "valid" | "warning" | "error"
  conflictAction: "skip" | "update" | "add_missing"
  dupOrderExists: boolean
  dupAccountEmails: string[]
}

export type RowIssue = {
  code: string
  label: string
  severity: "error" | "warning"
}

// ── Column aliases ────────────────────────────────────────────────────────────
const COL_ALIASES: Record<string, string> = {
  "stt": "stt",
  "mã đơn": "orderCode", "ma don": "orderCode", "order_code": "orderCode",
  "mã đơn hàng": "orderCode", "ordercode": "orderCode",
  "sản phẩm": "productName", "san pham": "productName", "product": "productName",
  "tên sản phẩm": "productName", "ten san pham": "productName",
  "số lượng": "quantity", "so luong": "quantity", "sl": "quantity",
  "quantity": "quantity", "qty": "quantity",
  "số tiền": "totalPrice", "so tien": "totalPrice", "amount": "totalPrice",
  "total_price": "totalPrice", "tổng tiền": "totalPrice", "tong tien": "totalPrice",
  "giá": "totalPrice", "gia": "totalPrice",
  "trạng thái": "status", "trang thai": "status", "status": "status",
  "khách hàng": "customerName", "khach hang": "customerName",
  "customer": "customerName", "customer_name": "customerName",
  "email slot": "customerEmail", "customer_email": "customerEmail",
  "email khách": "customerEmail", "email khach": "customerEmail",
  "tạo lúc": "createdAt", "tao luc": "createdAt", "created_at": "createdAt",
  "ngày tạo": "createdAt", "ngay tao": "createdAt",
  "thanh toán": "paymentAt", "thanh toan": "paymentAt", "payment_at": "paymentAt",
  "ngày thanh toán": "paymentAt", "ngay thanh toan": "paymentAt",
  "đã giao": "deliveredAt", "da giao": "deliveredAt",
  "delivered_at": "deliveredAt", "ngày giao": "deliveredAt", "ngay giao": "deliveredAt",
  "tài khoản đã giao": "deliveredAccounts", "tai khoan da giao": "deliveredAccounts",
  "delivered_accounts": "deliveredAccounts", "accounts": "deliveredAccounts",
  "tài khoản": "deliveredAccounts",
}

export function detectColumns(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {}
  headers.forEach((h, i) => {
    const norm = normalize(String(h || ""))
    if (COL_ALIASES[norm]) map[i] = COL_ALIASES[norm]
  })
  return map
}

// ── Date parsing ──────────────────────────────────────────────────────────────
export function parseDate(val: any): string | null {
  if (val === null || val === undefined || val === "") return null
  const s = String(val).trim()
  if (!s) return null

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // "15:05:58 18/7/2026" or "18/7/2026 15:05:58" → extract date part DD/M/YYYY
  const dmyMatch = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  // YYYY/MM/DD
  const ymdMatch = s.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`
  }

  // Excel serial number
  const num = Number(s)
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + num * 86400000)
    return d.toISOString().slice(0, 10)
  }

  return null
}

// ── Price parsing ─────────────────────────────────────────────────────────────
export function parsePrice(val: any): number {
  if (val === null || val === undefined || val === "") return 0
  if (typeof val === "number") return Math.round(val)
  let s = String(val).trim()
  // Remove currency symbols and trailing spaces
  s = s.replace(/[đĐ₫\s]/gi, "").replace(/vnd/gi, "")
  // "90k" → 90000
  const kMatch = s.match(/^([\d.,]+)k$/i)
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(/[.,]/g, "")) * 1000)
  // Remove thousand separators: dots followed by 3 digits, or commas
  // Handle "20.000" (dot = thousand sep) and "20,000"
  s = s.replace(/\./g, "").replace(/,/g, "")
  return parseInt(s, 10) || 0
}

// ── Account parsing ───────────────────────────────────────────────────────────
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/

const BLACKLIST_EXACT = new Set([
  "liên", "hôm nay", "xem chi tiết", "đã giao", "tên khách hàng",
  "lien", "hom nay", "xem chi tiet", "da giao", "ten khach hang",
])

function isBlacklisted(s: string): boolean {
  return BLACKLIST_EXACT.has(s.toLowerCase().trim())
}

export function parseAccounts(val: any): Account[] {
  if (val === null || val === undefined || val === "") return []
  const s = String(val).trim()
  if (!s || isBlacklisted(s)) return []

  // Split into lines (newline > semicolon > keep as single)
  let lines: string[]
  if (s.includes("\n")) {
    lines = s.split(/\r?\n/).map(l => l.trim()).filter(l => l && !isBlacklisted(l))
  } else if (s.includes(";")) {
    lines = s.split(";").map(l => l.trim()).filter(l => l && !isBlacklisted(l))
  } else {
    // Check if there are multiple emails in one line (comma-separated)
    const emailMatches = s.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)
    if (emailMatches && emailMatches.length > 1) {
      // Multiple emails crammed together — treat each email segment as an account
      lines = s.split(",").map(l => l.trim()).filter(l => l && !isBlacklisted(l))
      if (lines.length <= 1) lines = [s]
    } else {
      lines = [s]
    }
  }

  return lines.map(parseAccountLine).filter((a): a is Account => a !== null)
}

function parseAccountLine(line: string): Account | null {
  const s = line.trim()
  if (!s || isBlacklisted(s)) return null

  let email = "", password = "", twoFA = ""

  // Try | separator first
  if (s.includes("|")) {
    const parts = s.split("|").map(p => p.trim())
    email = parts[0]; password = parts[1] || ""; twoFA = parts[2] || ""
  }
  // Try / separator (but not if it's a URL like https://…)
  else if (s.includes("/") && !/https?:\/\//.test(s)) {
    const parts = s.split("/").map(p => p.trim())
    email = parts[0]; password = parts[1] || ""; twoFA = parts[2] || ""
  }
  // Try : separator (but be careful not to split email with : in path)
  else if (s.includes(":") && !s.match(/^https?:/)) {
    const parts = s.split(":").map(p => p.trim())
    email = parts[0]; password = parts[1] || ""; twoFA = parts[2] || ""
  }
  else {
    email = s
  }

  // Extract valid email from the email field
  const emailMatch = email.match(EMAIL_RE)
  if (emailMatch) {
    return { email: emailMatch[0], password, twoFA, valid: true }
  }

  // Not a valid email — mark as invalid so admin can review
  if (email && !isBlacklisted(email) && email.length > 0) {
    return { email, password, twoFA, valid: false }
  }

  return null
}

// ── Status mapping ────────────────────────────────────────────────────────────
export function mapStatus(val: any): string {
  const s = String(val || "").toLowerCase().trim()
  if (["completed", "delivered", "success", "đã giao", "da giao", "hoàn thành", "hoan thanh"].includes(s)) return "active"
  if (["pending", "chờ xử lý", "cho xu ly"].includes(s)) return "pending"
  if (["cancelled", "canceled", "đã hủy", "da huy", "hủy", "huy"].includes(s)) return "cancelled"
  if (s === "active" || s === "hoạt động" || s === "hoat dong") return "active"
  return "active"
}

// ── Product fuzzy matching ────────────────────────────────────────────────────
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/supper/gi, "super")
    .replace(/[-_\s]+/g, " ")
    .trim()
}

export function fuzzyMatchProduct(name: string, products: string[]): string | null {
  if (!name || products.length === 0) return null
  const norm = normalize(name)

  // 1. Exact match
  const exact = products.find(p => normalize(p) === norm)
  if (exact) return exact

  // 2. Substring match
  const sub = products.find(p => {
    const np = normalize(p)
    return np.includes(norm) || norm.includes(np)
  })
  if (sub) return sub

  // 3. Token overlap ≥ 50%
  const nameTokens = new Set(norm.split(/\s+/).filter(t => t.length > 1))
  let best: string | null = null, bestScore = 0
  for (const p of products) {
    const pTokens = normalize(p).split(/\s+/).filter(t => t.length > 1)
    const overlap = pTokens.filter(t => nameTokens.has(t)).length
    const score = overlap / Math.max(nameTokens.size, pTokens.length, 1)
    if (score > bestScore && score >= 0.5) { bestScore = score; best = p }
  }
  return best
}

// ── Compute purchase date (priority: paymentAt > deliveredAt > createdAt) ─────
export function resolvePurchaseDate(paymentAt: string | null, deliveredAt: string | null, createdAt: string | null): string | null {
  return paymentAt || deliveredAt || createdAt || null
}

// ── Compute expiry/warranty from delivered date + product days ────────────────
export function addDaysToDate(dateStr: string, days: number): string | null {
  if (!dateStr || !days) return null
  try {
    const d = new Date(dateStr)
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

// ── Build validated row from raw column map ───────────────────────────────────
export function buildRow(
  rowIndex: number,
  colMap: Record<number, string>,
  cells: any[],
  existingOrderIds: Set<string>,
  existingItemEmails: Set<string>,
  knownProducts: { name: string; warrantyDays: number; usageDays: number }[],
): ParsedRow {
  const get = (field: string) => {
    const idx = Object.entries(colMap).find(([, f]) => f === field)?.[0]
    return idx !== undefined ? cells[Number(idx)] : undefined
  }

  const orderCode = String(get("orderCode") || "").trim().toUpperCase()
  const productNameRaw = String(get("productName") || "").trim()
  const quantity = parseInt(String(get("quantity") || "1"), 10) || 1
  const totalPrice = parsePrice(get("totalPrice"))
  const statusRaw = String(get("status") || "").trim()
  const customerName = String(get("customerName") || "").trim()
  const customerEmail = String(get("customerEmail") || "").trim()
  const createdAt = parseDate(get("createdAt"))
  const paymentAt = parseDate(get("paymentAt"))
  const deliveredAt = parseDate(get("deliveredAt"))
  const deliveredAccountsRaw = get("deliveredAccounts")

  // Dates
  const purchaseDate = resolvePurchaseDate(paymentAt, deliveredAt, createdAt)
  const originalDeliveredAt = deliveredAt || paymentAt || createdAt || null

  // Product matching
  const productNames = knownProducts.map(p => p.name)
  const productNameMapped = fuzzyMatchProduct(productNameRaw, productNames)
  const matchedProduct = knownProducts.find(p => p.name === productNameMapped)
  const warrantyDays = matchedProduct?.warrantyDays ?? 0
  const usageDays = matchedProduct?.usageDays ?? 0

  // Dates from product config
  const expiryDate = originalDeliveredAt && usageDays ? addDaysToDate(originalDeliveredAt, usageDays) : null
  const warrantyEndDate = originalDeliveredAt && warrantyDays ? addDaysToDate(originalDeliveredAt, warrantyDays) : null

  const accounts = parseAccounts(deliveredAccountsRaw)
  const validAccounts = accounts.filter(a => a.valid)
  const status = mapStatus(statusRaw)
  const unitPrice = quantity > 0 && totalPrice > 0 ? Math.round(totalPrice / quantity) : totalPrice

  // Duplicate checks
  const dupOrderExists = existingOrderIds.has(orderCode)
  const dupAccountEmails = validAccounts.map(a => a.email).filter(e => existingItemEmails.has(e.toLowerCase()))

  // Validation
  const issues: RowIssue[] = []
  if (!orderCode) issues.push({ code: "missing_code", label: "Thiếu mã đơn", severity: "error" })
  if (!productNameRaw) issues.push({ code: "missing_product", label: "Thiếu sản phẩm", severity: "error" })
  else if (!productNameMapped) issues.push({ code: "no_product_match", label: "Không tìm thấy sản phẩm", severity: "warning" })
  if (!purchaseDate) issues.push({ code: "no_purchase_date", label: "Sai ngày / thiếu ngày mua", severity: "warning" })
  if (validAccounts.length === 0) issues.push({ code: "no_accounts", label: "Không đọc được tài khoản", severity: "warning" })
  else if (validAccounts.length !== quantity) {
    issues.push({
      code: "qty_mismatch",
      label: `Khai báo ${quantity} TK nhưng đọc được ${validAccounts.length}`,
      severity: "warning",
    })
  }
  if (dupOrderExists) issues.push({ code: "dup_order", label: "Trùng mã đơn", severity: "warning" })
  if (dupAccountEmails.length > 0) {
    issues.push({ code: "dup_accounts", label: `${dupAccountEmails.length} tài khoản đã tồn tại`, severity: "warning" })
  }
  if (accounts.some(a => !a.valid && a.email)) {
    issues.push({ code: "invalid_accounts", label: "Có tài khoản không nhận dạng được email", severity: "warning" })
  }

  const hasError = issues.some(i => i.severity === "error")
  const hasWarning = issues.some(i => i.severity === "warning")
  const rowStatus: ParsedRow["rowStatus"] = hasError ? "error" : hasWarning ? "warning" : "valid"

  return {
    rowIndex,
    orderCode,
    productNameRaw,
    productNameMapped,
    quantity,
    totalPrice,
    unitPrice,
    status,
    customerName,
    customerEmail,
    purchaseDate,
    originalDeliveredAt,
    expiryDate,
    warrantyEndDate,
    warrantyDays,
    usageDays,
    accounts,
    issues,
    rowStatus,
    conflictAction: "skip",
    dupOrderExists,
    dupAccountEmails,
  }
}
