import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Calculator, Copy, Check, Clock, Trash2, ChevronDown, ChevronUp } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// ── Types ──────────────────────────────────────────────────────────────────────
interface CalcResult {
  originalPrice: number
  purchaseDate: string
  returnDate: string
  serviceDays: number
  feePercent: number
  daysUsed: number
  daysRemaining: number
  pricePerDay: number
  usedAmount: number
  feeAmount: number
  refundAmount: number
  usedPercent: number
  savedAt: string
}

const STORAGE_KEY = "refund_calc_history"
const MAX_HISTORY = 5

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseDate(str: string): Date | null {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function fmtVND(n: number): string {
  return n.toLocaleString("vi-VN") + "đ"
}

function fmtDate(iso: string): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function fmtSavedAt(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function calcRefund(
  originalPrice: number,
  purchaseDate: string,
  returnDate: string,
  serviceDays: number,
  feePercent: number,
): CalcResult | null {
  const pd = parseDate(purchaseDate)
  const rd = parseDate(returnDate)
  if (!pd || !rd || serviceDays <= 0 || originalPrice <= 0) return null

  const daysUsed = Math.max(0, diffDays(pd, rd))
  const daysRemaining = Math.max(0, serviceDays - daysUsed)
  const pricePerDay = originalPrice / serviceDays
  const usedAmount = Math.round(pricePerDay * daysUsed)
  const refundBase = originalPrice - usedAmount
  const feeAmount = Math.round(refundBase * (feePercent / 100))
  const refundAmount = Math.max(0, refundBase - feeAmount)
  const usedPercent = Math.min(100, (daysUsed / serviceDays) * 100)

  return {
    originalPrice, purchaseDate, returnDate, serviceDays, feePercent,
    daysUsed, daysRemaining, pricePerDay,
    usedAmount, feeAmount, refundAmount, usedPercent,
    savedAt: new Date().toISOString(),
  }
}

function loadHistory(): CalcResult[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
  } catch {
    return []
  }
}

function saveHistory(h: CalcResult[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)))
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ percent }: { percent: number }) {
  const color = percent >= 90 ? "bg-red-500" : percent >= 60 ? "bg-orange-400" : "bg-emerald-500"
  return (
    <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ r, compact = false, onRestore }: {
  r: CalcResult
  compact?: boolean
  onRestore?: (r: CalcResult) => void
}) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(!compact)

  const copyText = `🧾 MÁY TÍNH HOÀN TIỀN\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💰 Giá gốc: ${fmtVND(r.originalPrice)}\n` +
    `📅 Ngày mua: ${fmtDate(r.purchaseDate)}\n` +
    `📅 Ngày trả: ${fmtDate(r.returnDate)}\n` +
    `⏱ Thời hạn: ${r.serviceDays} ngày\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📊 Đã dùng: ${r.daysUsed}/${r.serviceDays} ngày (${r.usedPercent.toFixed(1)}%)\n` +
    `💸 Chi phí đã dùng: ${fmtVND(r.usedAmount)}\n` +
    (r.feePercent > 0 ? `🔧 Phí hoàn: ${fmtVND(r.feeAmount)} (${r.feePercent}%)\n` : "") +
    `✅ Hoàn lại: ${fmtVND(r.refundAmount)}`

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      toast({ title: "Đã sao chép kết quả", description: "Paste vào tin nhắn để chia sẻ" })
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`rounded-xl border bg-card shadow-sm overflow-hidden ${compact ? "text-sm" : ""}`}>
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-emerald-600 text-lg whitespace-nowrap">{fmtVND(r.refundAmount)}</span>
          <Badge variant="outline" className="text-xs shrink-0">hoàn lại</Badge>
        </div>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {compact && onRestore && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onRestore(r)}>
              Dùng lại
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          {compact && (
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setExpanded(v => !v)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 space-y-3">
          {/* Progress */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Đã dùng {r.daysUsed}/{r.serviceDays} ngày</span>
              <span>{r.usedPercent.toFixed(1)}%</span>
            </div>
            <ProgressBar percent={r.usedPercent} />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Còn lại: <strong className="text-foreground">{r.daysRemaining} ngày</strong></span>
              <span className="text-muted-foreground">{fmtVND(Math.round(r.pricePerDay))}/ngày</span>
            </div>
          </div>

          {/* Numbers grid */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Giá gốc", value: fmtVND(r.originalPrice), highlight: false },
              { label: "Đã dùng", value: fmtVND(r.usedAmount), highlight: false },
              ...(r.feePercent > 0 ? [{ label: `Phí hoàn (${r.feePercent}%)`, value: fmtVND(r.feeAmount), highlight: false }] : []),
              { label: "Hoàn lại", value: fmtVND(r.refundAmount), highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={`rounded-lg px-3 py-2 ${highlight ? "bg-emerald-50 border border-emerald-200" : "bg-muted/40"}`}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`font-semibold mt-0.5 ${highlight ? "text-emerald-700" : ""}`}>{value}</div>
              </div>
            ))}
          </div>

          {compact && r.savedAt && (
            <p className="text-xs text-muted-foreground text-right">{fmtSavedAt(r.savedAt)}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RefundCalc() {
  const { toast } = useToast()

  // Form state
  const [originalPrice, setOriginalPrice] = useState("")
  const [purchaseDate, setPurchaseDate] = useState("")
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [serviceDays, setServiceDays] = useState("")
  const [feePercent, setFeePercent] = useState("0")

  // Results
  const [result, setResult] = useState<CalcResult | null>(null)
  const [history, setHistory] = useState<CalcResult[]>(loadHistory)

  // Auto-calculate whenever inputs change
  useEffect(() => {
    const price = parseFloat(originalPrice.replace(/[,.\s]/g, ""))
    const days = parseInt(serviceDays)
    const fee = parseFloat(feePercent) || 0

    if (!isNaN(price) && !isNaN(days) && purchaseDate && returnDate) {
      setResult(calcRefund(price, purchaseDate, returnDate, days, fee))
    } else {
      setResult(null)
    }
  }, [originalPrice, purchaseDate, returnDate, serviceDays, feePercent])

  const handleSave = useCallback(() => {
    if (!result) return
    const next = [result, ...history].slice(0, MAX_HISTORY)
    setHistory(next)
    saveHistory(next)
    toast({ title: "Đã lưu vào lịch sử" })
  }, [result, history, toast])

  const handleRestore = useCallback((r: CalcResult) => {
    setOriginalPrice(String(r.originalPrice))
    setPurchaseDate(r.purchaseDate.slice(0, 10))
    setReturnDate(r.returnDate.slice(0, 10))
    setServiceDays(String(r.serviceDays))
    setFeePercent(String(r.feePercent))
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
    toast({ title: "Đã xoá lịch sử" })
  }, [toast])

  // Parse display price
  const displayPrice = (() => {
    const n = parseFloat(originalPrice.replace(/[,.\s]/g, ""))
    return isNaN(n) ? "" : fmtVND(n)
  })()

  return (
    <div className="space-y-6 max-w-xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Calculator className="h-6 w-6 text-primary" />
          Máy tính hoàn tiền
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tính số tiền cần hoàn lại sau khi trừ số ngày đã sử dụng
        </p>
      </div>

      {/* Input form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nhập thông tin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Price */}
          <div className="space-y-1.5">
            <Label>Giá gốc <span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                placeholder="vd: 150000"
                value={originalPrice}
                onChange={e => setOriginalPrice(e.target.value)}
                inputMode="numeric"
                className="pr-16"
              />
              {displayPrice && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  {displayPrice}
                </span>
              )}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ngày mua <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={purchaseDate}
                onChange={e => setPurchaseDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Ngày hoàn trả <span className="text-red-500">*</span></Label>
              <Input
                type="date"
                value={returnDate}
                onChange={e => setReturnDate(e.target.value)}
              />
            </div>
          </div>

          {/* Service days */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Thời hạn dịch vụ (ngày) <span className="text-red-500">*</span></Label>
              <Input
                placeholder="vd: 30"
                value={serviceDays}
                onChange={e => setServiceDays(e.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phí hoàn trả (%)</Label>
              <Input
                placeholder="0"
                value={feePercent}
                onChange={e => setFeePercent(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Result */}
      {result ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Kết quả</h2>
            <Button size="sm" variant="outline" onClick={handleSave}>
              Lưu vào lịch sử
            </Button>
          </div>
          <ResultCard r={result} />
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-2">
            <Calculator className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Nhập đầy đủ thông tin để xem kết quả tức thì</p>
          </CardContent>
        </Card>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Lịch sử ({history.length}/{MAX_HISTORY})
            </h2>
            <Button variant="ghost" size="sm" className="text-xs text-destructive hover:text-destructive h-7" onClick={clearHistory}>
              <Trash2 className="h-3 w-3 mr-1" />
              Xoá tất cả
            </Button>
          </div>
          <div className="space-y-2">
            {history.map((h, i) => (
              <ResultCard key={i} r={h} compact onRestore={handleRestore} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
