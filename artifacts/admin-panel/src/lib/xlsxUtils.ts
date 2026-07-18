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

// ── Normalise Vietnamese text ─────────────────────────────────────────────────
// "đ" / "Đ" (U+0111 / U+0110) do NOT decompose in NFD — they must be mapped
// explicitly before the NFD + combining-mark strip.
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[đĐ]/g, "d")          // ← the critical fix: đ has no NFD decomposition
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip all combining diacritical marks
    .replace(/supper/g, "super")     // common product name typo
    .replace(/[-_\s]+/g, " ")
    .trim()
}

// ── Column header → field mapping ─────────────────────────────────────────────
// Keys are all in *normalised* form (no diacritics, đ→d, lower-case, spaces).
const COL_ALIASES: Record<string, string> = {
  "stt":                   "stt",
  // order code
  "ma don":                "orderCode",
  "ma don hang":           "orderCode",
  "ordercode":             "orderCode",
  "order code":            "orderCode",
  "order id":              "orderCode",
  // product
  "san pham":              "productName",
  "ten san pham":          "productName",
  "product":               "productName",
  "product name":          "productName",
  // quantity
  "so luong":              "quantity",
  "sl":                    "quantity",
  "quantity":              "quantity",
  "qty":                   "quantity",
  // price / total
  "so tien":               "totalPrice",
  "tong tien":             "totalPrice",
  "amount":                "totalPrice",
  "total price":           "totalPrice",
  "total":                 "totalPrice",
  "gia":                   "totalPrice",
  // status
  "trang thai":            "status",
  "status":                "status",
  // customer
  "khach hang":            "customerName",
  "customer":              "customerName",
  "customer name":         "customerName",
  "ten khach":             "customerName",
  // customer email / slot email
  "email slot":            "customerEmail",
  "customer email":        "customerEmail",
  "email khach":           "customerEmail",
  "email":                 "customerEmail",
  // dates
  "tao luc":               "createdAt",
  "created at":            "createdAt",
  "ngay tao":              "createdAt",
  "thanh toan":            "paymentAt",
  "payment at":            "paymentAt",
  "ngay thanh toan":       "paymentAt",
  "da giao":               "deliveredAt",
  "delivered at":          "deliveredAt",
  "ngay giao":             "deliveredAt",
  // accounts
  "tai khoan da giao":     "deliveredAccounts",
  "delivered accounts":    "deliveredAccounts",
  "accounts":              "deliveredAccounts",
  "tai khoan":             "deliveredAccounts",
}

export function detectColumns(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {}
  headers.forEach((h, i) => {
    const norm = normalize(String(h ?? ""))
    if (norm && COL_ALIASES[norm]) map[i] = COL_ALIASES[norm]
  })
  return map
}

// Returns the list of *required* fields that were not mapped
export function missingRequiredCols(colMap: Record<number, string>): string[] {
  const required: Array<[string, string]> = [
    ["orderCode", "Mã đơn"],
    ["deliveredAccounts", "Tài khoản đã giao"],
  ]
  const mapped = new Set(Object.values(colMap))
  return required.filter(([f]) => !mapped.has(f)).map(([, label]) => label)
}

// ── Date parsing ──────────────────────────────────────────────────────────────
export function parseDate(val: any): string | null {
  if (val === null || val === undefined || val === "") return null
  const s = String(val).trim()
  if (!s) return null

  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)

  // "HH:MM:SS DD/MM/YYYY" or "DD/MM/YYYY HH:MM:SS" or just "DD/MM/YYYY"
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

  // Excel serial number (e.g. 46218 = 2026-07-18)
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
  s = s.replace(/[đĐ₫\s]/gi, "").replace(/vnd/gi, "")
  // "90k" → 90000
  const kMatch = s.match(/^([\d.,]+)k$/i)
  if (kMatch) return Math.round(parseFloat(kMatch[1].replace(/[.,]/g, "")) * 1000)
  // Remove thousand separators
  s = s.replace(/\./g, "").replace(/,/g, "")
  return parseInt(s, 10) || 0
}

// ── Account parsing ───────────────────────────────────────────────────────────
//
// Cell format (from this system's export):
//   email / password | Giao: HH:MM:SS DD/MM/YYYY
//   email / password | Verify: 2FA_CODE | Giao: ...
//   email:pass:2fa   | Giao: ...
//   Liên / hệ | Verify: admin | Expiry: ... | Giao: ...   ← no real account
//   license_key      | Giao: ...                          ← no email
//
// Multiple accounts in one cell are separated by newlines.
// Strategy:
//   1. Split by \n → one line per account candidate
//   2. For each line: take the part BEFORE the first " | " → that's the credential
//   3. Optionally extract twoFA from "| Verify: CODE"
//   4. Parse credential as email/pass/2fa (separator: / or :)

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/

export function parseAccounts(val: any): Account[] {
  if (val === null || val === undefined || val === "") return []
  const s = String(val).trim()
  if (!s) return []

  // Split into per-account lines (multi-line cells use \n)
  const lines = s.includes("\n")
    ? s.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    : [s]

  return lines.map(parseSingleAccountLine).filter((a): a is Account => a !== null)
}

function parseSingleAccountLine(line: string): Account | null {
  // Split on " | " to separate credential from metadata
  const segments = line.split("|").map(seg => seg.trim())
  const credRaw = segments[0]  // everything before the first |

  // Extract twoFA from "Verify: CODE" metadata segment if present
  let metaTwoFA = ""
  for (const seg of segments.slice(1)) {
    const verifyMatch = seg.match(/^Verify:\s*(.+)$/i)
    if (verifyMatch) { metaTwoFA = verifyMatch[1].trim(); break }
  }

  if (!credRaw) return null

  // Parse credential
  let email = "", password = "", twoFA = metaTwoFA

  if (credRaw.includes("/")) {
    // format: email / password [/ 2fa]
    const parts = credRaw.split("/").map(p => p.trim())
    email = parts[0]
    password = parts[1] ?? ""
    twoFA = parts[2] ?? metaTwoFA
  } else if (credRaw.includes(":")) {
    // format: email:password:2fa  (email itself contains no colon)
    const parts = credRaw.split(":")
    email = parts[0]
    password = parts[1] ?? ""
    twoFA = parts[2] ?? metaTwoFA
  } else {
    email = credRaw
  }

  email = email.trim()
  password = password.trim()
  twoFA = twoFA.trim()

  // Validate: must have a real email address
  const emailMatch = email.match(EMAIL_RE)
  if (emailMatch) {
    return { email: emailMatch[0], password, twoFA, valid: true }
  }

  // No email → mark invalid so admin can see it in preview
  if (email) {
    return { email, password, twoFA, valid: false }
  }

  return null
}

// ── Status mapping ────────────────────────────────────────────────────────────
export function mapStatus(val: any): string {
  const s = normalize(String(val ?? ""))
  if (["completed", "delivered", "success", "da giao", "hoan thanh"].includes(s)) return "active"
  if (["pending", "cho xu ly"].includes(s)) return "pending"
  if (["cancelled", "canceled", "da huy", "huy"].includes(s)) return "cancelled"
  if (["active", "hoat dong"].includes(s)) return "active"
  return "active"
}

// ── Product fuzzy matching ─────────────────────────────────────────────────────
export function fuzzyMatchProduct(name: string, products: string[]): string | null {
  if (!name || products.length === 0) return null
  const norm = normalize(name)

  const exact = products.find(p => normalize(p) === norm)
  if (exact) return exact

  const sub = products.find(p => {
    const np = normalize(p)
    return np.includes(norm) || norm.includes(np)
  })
  if (sub) return sub

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

// ── Date helpers ──────────────────────────────────────────────────────────────
export function resolvePurchaseDate(
  paymentAt: string | null,
  deliveredAt: string | null,
  createdAt: string | null,
): string | null {
  return paymentAt || deliveredAt || createdAt || null
}

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

// ── Build one validated row from raw cells ────────────────────────────────────
export function buildRow(
  rowIndex: number,
  colMap: Record<number, string>,
  cells: any[],
  existingOrderIds: Set<string>,
  existingItemEmails: Set<string>,
  knownProducts: { name: string; warrantyDays: number; usageDays: number }[],
): ParsedRow {
  const get = (field: string): any => {
    for (const [idxStr, f] of Object.entries(colMap)) {
      if (f === field) return cells[Number(idxStr)]
    }
    return undefined
  }

  const orderCode = String(get("orderCode") ?? "").trim().toUpperCase()
  const productNameRaw = String(get("productName") ?? "").trim()
  const quantityRaw = get("quantity")
  const quantity = parseInt(String(quantityRaw ?? "1"), 10) || 1
  const totalPrice = parsePrice(get("totalPrice"))
  const statusRaw = String(get("status") ?? "").trim()
  const customerName = String(get("customerName") ?? "").trim()
  const customerEmail = String(get("customerEmail") ?? "").trim()
  const createdAt = parseDate(get("createdAt"))
  const paymentAt = parseDate(get("paymentAt"))
  const deliveredAt = parseDate(get("deliveredAt"))
  const deliveredAccountsRaw = get("deliveredAccounts")

  const purchaseDate = resolvePurchaseDate(paymentAt, deliveredAt, createdAt)
  const originalDeliveredAt = deliveredAt || paymentAt || createdAt || null

  const productNames = knownProducts.map(p => p.name)
  const productNameMapped = fuzzyMatchProduct(productNameRaw, productNames)
  const matchedProduct = knownProducts.find(p => p.name === productNameMapped)
  const warrantyDays = matchedProduct?.warrantyDays ?? 0
  const usageDays = matchedProduct?.usageDays ?? 0

  const expiryDate = originalDeliveredAt && usageDays
    ? addDaysToDate(originalDeliveredAt, usageDays) : null
  const warrantyEndDate = originalDeliveredAt && warrantyDays
    ? addDaysToDate(originalDeliveredAt, warrantyDays) : null

  const accounts = parseAccounts(deliveredAccountsRaw)
  const validAccounts = accounts.filter(a => a.valid)
  const status = mapStatus(statusRaw)
  const unitPrice = quantity > 0 && totalPrice > 0 ? Math.round(totalPrice / quantity) : totalPrice

  const dupOrderExists = !!orderCode && existingOrderIds.has(orderCode)
  const dupAccountEmails = validAccounts
    .map(a => a.email)
    .filter(e => existingItemEmails.has(e.toLowerCase()))

  const issues: RowIssue[] = []
  if (!orderCode)
    issues.push({ code: "missing_code", label: "Thiếu mã đơn", severity: "error" })
  if (!productNameRaw)
    issues.push({ code: "missing_product", label: "Thiếu sản phẩm", severity: "error" })
  else if (!productNameMapped)
    issues.push({ code: "no_product_match", label: "Không tìm thấy sản phẩm phù hợp", severity: "warning" })
  if (!purchaseDate)
    issues.push({ code: "no_purchase_date", label: "Sai ngày / thiếu ngày mua", severity: "warning" })
  if (validAccounts.length === 0)
    issues.push({ code: "no_accounts", label: "Không đọc được tài khoản hợp lệ", severity: "warning" })
  else if (validAccounts.length !== quantity)
    issues.push({
      code: "qty_mismatch",
      label: `Khai báo ${quantity} TK, đọc được ${validAccounts.length}`,
      severity: "warning",
    })
  if (dupOrderExists)
    issues.push({ code: "dup_order", label: "Mã đơn đã tồn tại", severity: "warning" })
  if (dupAccountEmails.length > 0)
    issues.push({
      code: "dup_accounts",
      label: `${dupAccountEmails.length} tài khoản đã tồn tại`,
      severity: "warning",
    })

  const hasError = issues.some(i => i.severity === "error")
  const rowStatus: ParsedRow["rowStatus"] = hasError ? "error"
    : issues.length > 0 ? "warning"
    : "valid"

  return {
    rowIndex, orderCode, productNameRaw, productNameMapped,
    quantity, totalPrice, unitPrice, status,
    customerName, customerEmail,
    purchaseDate, originalDeliveredAt, expiryDate, warrantyEndDate,
    warrantyDays, usageDays, accounts, issues, rowStatus,
    conflictAction: "skip",
    dupOrderExists,
    dupAccountEmails,
  }
}
