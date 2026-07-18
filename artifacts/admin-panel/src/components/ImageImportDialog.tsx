/**
 * ImageImportDialog — Thêm đơn hàng từ ảnh
 * OCR Engine: Tesseract.js (cục bộ, không cần API key)
 * Parser: Rule-based regex cho layout "Chi tiết đơn hàng"
 */
import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Camera, Upload, X, CheckCircle2, AlertTriangle,
  Loader2, ChevronLeft, ChevronRight
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { getListOrdersQueryKey } from "@workspace/api-client-react"
import type { Order } from "@workspace/api-client-react"

// ── Types ──────────────────────────────────────────────────────────────────────
type FileStatus = "selected" | "error"
type DupStatus  = "none" | "exists" | "update" | "skip"
type Stage      = "upload" | "extracting" | "review" | "done"
type Conf       = "high" | "medium" | "low"

interface FileItem {
  id: string
  file: File
  previewUrl: string
  status: FileStatus
  error?: string
}

// confidence cho từng trường — dùng để highlight vàng
type ConfMap = Partial<Record<keyof OrderDraftFields, Conf>>

interface OrderDraftFields {
  email: string
  password: string
  twoFA: string
  productName: string
  price: string
  customerName: string
  purchaseDate: string
  warrantyDays: string
  status: string
  paymentMethod: string
  notes: string
}

interface OrderDraft extends OrderDraftFields {
  id: string
  fileItem: FileItem
  ocrSuccess: boolean
  ocrError?: string
  confidence: ConfMap    // per-field confidence từ OCR
  dupStatus: DupStatus
}

interface DoneResult {
  total: number; added: number; updated: number; skipped: number; errors: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / 1048576).toFixed(1)}MB`
}

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
}

function convertToJpeg(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img  = new Image()
    const url  = URL.createObjectURL(file)
    const tid  = setTimeout(() => { URL.revokeObjectURL(url); reject(new Error("Timeout chuyển đổi HEIC")) }, 15000)
    img.onload = () => {
      clearTimeout(tid)
      const canvas = document.createElement("canvas")
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext("2d")!.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error("Canvas toBlob thất bại")); return }
        resolve(new File([blob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" }))
      }, "image/jpeg", 0.92)
    }
    img.onerror = () => { clearTimeout(tid); URL.revokeObjectURL(url); reject(new Error("Không thể đọc ảnh HEIC")) }
    img.src = url
  })
}

function calcExpiry(purchaseDate: string, days: number): string {
  if (!purchaseDate || days <= 0) return ""
  try {
    const d = new Date(purchaseDate)
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  } catch { return "" }
}

function fmtDate(iso: string): string {
  if (!iso) return ""
  const [y, m, d] = iso.split("-")
  return `${d}/${m}/${y}`
}

function getProductNames(orders: Order[]): string[] {
  const s = new Set<string>()
  orders.forEach(o => { if (o.productName) s.add(o.productName) })
  return Array.from(s).sort()
}

function fuzzyMatch(query: string, names: string[]): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]+/g, "")
  const q = norm(query)
  return names.find(n => norm(n) === q) ??
         names.find(n => norm(n).includes(q) || q.includes(norm(n))) ??
         null
}

function defaultDraft(fileItem: FileItem): OrderDraft {
  return {
    id: uid(), fileItem,
    ocrSuccess: false,
    email: "", password: "", twoFA: "", productName: "",
    price: "", customerName: "", purchaseDate: "",
    warrantyDays: "0", status: "active", paymentMethod: "", notes: "",
    confidence: {},
    dupStatus: "none",
  }
}

// ── Component ──────────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
  existingOrders: Order[]
}

export default function ImageImportDialog({ open, onClose, existingOrders }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [stage, setStage]           = useState<Stage>("upload")
  const [items, setItems]           = useState<FileItem[]>([])
  const [drafts, setDrafts]         = useState<OrderDraft[]>([])
  const [curIdx, setCurIdx]         = useState(0)
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null)
  const [extractProgress, setExtractProgress] = useState<string>("")

  const productNames = getProductNames(existingOrders)

  // ── File selection ─────────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const fileArray = Array.from(e.target.files ?? [])
    if (!fileArray.length) return

    const newItems: FileItem[] = fileArray
      .filter(f => f.size <= 15 * 1024 * 1024)
      .map(f => ({ id: uid(), file: f, previewUrl: URL.createObjectURL(f), status: "selected" as FileStatus }))

    const oversize = fileArray.filter(f => f.size > 15 * 1024 * 1024)
    if (oversize.length) {
      toast({ title: "File quá lớn", description: `${oversize.map(f => f.name).join(", ")} vượt giới hạn 15MB`, variant: "destructive" })
    }

    setItems(prev => {
      const combined = [...prev, ...newItems]
      if (combined.length > 20) combined.slice(20).forEach(i => { try { URL.revokeObjectURL(i.previewUrl) } catch {} })
      return combined.slice(0, 20)
    })
    requestAnimationFrame(() => { try { e.target.value = "" } catch {} })
  }, [toast])

  const removeItem = useCallback((id: string) => {
    setItems(prev => {
      const found = prev.find(i => i.id === id)
      if (found) { try { URL.revokeObjectURL(found.previewUrl) } catch {} }
      return prev.filter(i => i.id !== id)
    })
  }, [])

  // ── OCR Extract ────────────────────────────────────────────────────────────
  const handleExtract = async () => {
    if (!items.length) return
    setExtracting(true)
    setStage("extracting")
    setExtractProgress("Đang khởi động OCR engine...")

    try {
      const fd = new FormData()

      for (const item of items) {
        let file = item.file
        if (isHeic(file)) {
          try { file = await convertToJpeg(file) } catch (err: any) {
            toast({ title: `HEIC: ${item.file.name}`, description: err.message, variant: "destructive" })
          }
        }
        fd.append("images", file)
      }

      setExtractProgress(`Đang đọc ${items.length} ảnh bằng Tesseract OCR...`)
      const token = localStorage.getItem("admin_token") ?? ""
      const resp  = await fetch("/api/orders/ocr", {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}` },
        body:    fd,
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({})) as any
        throw new Error(err.error || `Lỗi server ${resp.status}`)
      }

      const data = await resp.json() as {
        results: Array<{
          filename: string
          success: boolean
          extracted?: Record<string, { value: any; confidence: Conf }>
          confidence?: number
          error?: string
        }>
      }

      const newDrafts: OrderDraft[] = items.map((item, i) => {
        const result = data.results[i]
        const draft  = defaultDraft(item)

        if (!result?.success || !result.extracted) {
          draft.ocrError = result?.error || "Không đọc được thông tin từ ảnh"
          return draft
        }

        const ex = result.extracted
        draft.ocrSuccess = true

        // Gán giá trị + lưu confidence per field để highlight
        const confMap: ConfMap = {}

        function pick(key: string): string {
          const v = ex[key]?.value
          confMap[key as keyof ConfMap] = ex[key]?.confidence ?? "low"
          return v != null ? String(v) : ""
        }

        draft.email         = pick("email")
        draft.password      = pick("password")
        draft.twoFA         = pick("twoFA")
        draft.customerName  = pick("customerName")
        draft.purchaseDate  = pick("purchaseDate")
        draft.paymentMethod = pick("paymentMethod")
        draft.status        = ex.status?.value ?? "active"
        confMap.status      = ex.status?.confidence ?? "low"
        draft.price         = ex.price?.value != null ? String(ex.price.value) : ""
        confMap.price       = ex.price?.confidence ?? "low"
        draft.warrantyDays  = ex.warrantyDays?.value != null ? String(ex.warrantyDays.value) : "0"
        confMap.warrantyDays = ex.warrantyDays?.confidence ?? "low"

        // Product matching
        const rawProd     = ex.productName?.value ?? ""
        const matched     = fuzzyMatch(rawProd, productNames) ?? rawProd
        draft.productName = matched
        confMap.productName = matched === rawProd && !productNames.includes(rawProd)
          ? "medium"
          : (ex.productName?.confidence ?? "low")

        draft.confidence = confMap

        // Duplicate check
        if (draft.email) {
          const dup = existingOrders.find(o => o.email?.toLowerCase() === draft.email.toLowerCase())
          draft.dupStatus = dup ? "exists" : "none"
        }

        return draft
      })

      setDrafts(newDrafts)
      setCurIdx(0)
      setStage("review")
    } catch (err: any) {
      toast({ title: "Lỗi đọc dữ liệu", description: err.message, variant: "destructive" })
      setStage("upload")
    } finally {
      setExtracting(false)
      setExtractProgress("")
    }
  }

  // ── Update draft field ────────────────────────────────────────────────────
  const setField = (idx: number, field: keyof OrderDraft, value: string) => {
    setDrafts(prev => {
      const next = [...prev]
      const draft = { ...next[idx], [field]: value }
      // Khi admin sửa tay → xóa highlight (coi như high)
      draft.confidence = { ...draft.confidence, [field]: "high" as Conf }
      next[idx] = draft
      return next
    })
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true)
    const token = localStorage.getItem("admin_token") ?? ""
    let added = 0, updated = 0, skipped = 0, errors = 0

    for (const draft of drafts) {
      if (draft.dupStatus === "skip")                            { skipped++; continue }
      if (!draft.ocrSuccess || !draft.email || !draft.productName) { errors++;  continue }

      const wdays  = parseInt(draft.warrantyDays) || 0
      const expiry = calcExpiry(draft.purchaseDate, wdays)

      const body: Record<string, any> = {
        email:        draft.email,
        productName:  draft.productName,
        price:        parseInt(draft.price) || 0,
        warrantyDays: wdays,
        status:       draft.status || "active",
      }
      if (draft.password)      body.password      = draft.password
      if (draft.twoFA)         body.twoFA         = draft.twoFA
      if (draft.customerName)  body.customerName  = draft.customerName
      if (draft.purchaseDate)  body.purchaseDate  = draft.purchaseDate
      if (expiry)              body.expiryDate    = expiry
      if (draft.paymentMethod) body.paymentMethod = draft.paymentMethod
      if (draft.notes)         body.notes         = draft.notes

      try {
        if (draft.dupStatus === "update") {
          const existing = existingOrders.find(o => o.email?.toLowerCase() === draft.email.toLowerCase())
          if (!existing) { errors++; continue }
          const r = await fetch(`/api/bot/orders/${existing.orderId}`, {
            method:  "PUT",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body:    JSON.stringify(body),
          })
          if (!r.ok) throw new Error("Update failed")
          updated++
        } else {
          const r = await fetch("/api/bot/orders", {
            method:  "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body:    JSON.stringify(body),
          })
          if (!r.ok) throw new Error("Create failed")
          added++
        }
      } catch { errors++ }
    }

    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() })
    setSaving(false)
    setDoneResult({ total: drafts.length, added, updated, skipped, errors })
    setStage("done")
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    items.forEach(i => { try { URL.revokeObjectURL(i.previewUrl) } catch {} })
    setItems([]); setDrafts([]); setCurIdx(0)
    setStage("upload"); setDoneResult(null); setExtracting(false); setSaving(false)
  }, [items])

  if (!open) return null

  const cur        = drafts[curIdx]
  const validCount = drafts.filter(d => d.ocrSuccess && d.email && d.dupStatus !== "skip").length
  const expiry     = cur ? calcExpiry(cur.purchaseDate, parseInt(cur.warrantyDays) || 0) : ""

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "0.5rem", overflowY: "auto" }}>
      {/* Backdrop */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)" }} onClick={() => { handleReset(); onClose() }} />

      {/* Panel */}
      <div style={{
        position: "relative", zIndex: 1,
        background: "var(--color-background)", border: "1px solid var(--color-border)",
        borderRadius: "16px", width: "100%", maxWidth: "860px",
        padding: "1.25rem", marginTop: "0.5rem", marginBottom: "1rem",
      }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Camera className="w-5 h-5" /> Thêm đơn hàng từ ảnh
          </h2>
          <button onClick={() => { handleReset(); onClose() }} className="p-1 rounded hover:bg-muted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── UPLOAD ── */}
        {stage === "upload" && (
          <div className="space-y-4">
            <div className="space-y-3">
              <label className="flex items-center justify-center gap-3 w-full py-5 rounded-xl border-2 border-dashed border-border bg-muted/20 cursor-pointer hover:bg-muted/40 transition-colors text-sm font-medium select-none">
                <Upload className="w-5 h-5 shrink-0" />
                <span>Chọn ảnh</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
                  multiple
                  className="sr-only"
                  onChange={handleFileChange}
                />
              </label>

              <label className="flex items-center justify-center gap-3 w-full py-4 rounded-xl border border-border bg-card cursor-pointer hover:bg-muted/30 transition-colors text-sm font-medium select-none">
                <Camera className="w-5 h-5 shrink-0" />
                <span>Dùng camera</span>
                <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} />
              </label>
            </div>

            {items.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{items.length}/20 ảnh đã chọn</p>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {items.map(item => (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                      <div className="w-12 h-12 rounded-md overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                        <img src={item.previewUrl} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">{fmtSize(item.file.size)}</p>
                        {item.error && <p className="text-xs text-destructive mt-0.5">{item.error}</p>}
                      </div>
                      <Badge variant={item.status === "error" ? "destructive" : "secondary"} className="shrink-0 text-xs">
                        {item.status === "selected" ? "Đã chọn" : "Lỗi"}
                      </Badge>
                      <button onClick={() => removeItem(item.id)} className="p-1 shrink-0 text-muted-foreground hover:text-destructive transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 min-h-[44px]" onClick={() => { handleReset(); onClose() }}>Hủy</Button>
              <Button className="flex-1 min-h-[44px]" disabled={!items.length} onClick={handleExtract}>
                Đọc dữ liệu
              </Button>
            </div>
          </div>
        )}

        {/* ── EXTRACTING ── */}
        {stage === "extracting" && (
          <div className="py-16 flex flex-col items-center gap-4 text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="font-medium">Đang đọc dữ liệu từ {items.length} ảnh...</p>
            <p className="text-sm text-muted-foreground">
              {extractProgress || "Tesseract OCR đang xử lý cục bộ, không cần internet"}
            </p>
          </div>
        )}

        {/* ── REVIEW ── */}
        {stage === "review" && cur && (
          <div className="space-y-4">
            {/* Nav */}
            {drafts.length > 1 && (
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={curIdx === 0} onClick={() => setCurIdx(i => i - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="text-center">
                  <p className="text-sm font-medium">Ảnh {curIdx + 1} / {drafts.length}</p>
                  <p className="text-xs text-muted-foreground truncate max-w-40">{cur.fileItem.file.name}</p>
                </div>
                <Button variant="outline" size="sm" disabled={curIdx === drafts.length - 1} onClick={() => setCurIdx(i => i + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {/* Left: image + status */}
              <div className="space-y-3">
                <div className="rounded-xl overflow-hidden border bg-muted max-h-[380px]">
                  <img src={cur.fileItem.previewUrl} alt="" className="w-full h-full object-contain max-h-[380px]" />
                </div>

                {!cur.ocrSuccess && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-3">
                    <p className="text-sm font-medium text-destructive">Lỗi đọc dữ liệu</p>
                    <p className="text-xs text-muted-foreground mt-1">{cur.ocrError}</p>
                  </div>
                )}

                {/* Legend khi có highlight */}
                {cur.ocrSuccess && Object.values(cur.confidence).some(c => c === "medium" || c === "low") && (
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 p-2.5">
                    <p className="text-xs text-yellow-700 dark:text-yellow-400">
                      🟡 <strong>Highlight vàng</strong> = OCR không chắc chắn, vui lòng kiểm tra lại
                    </p>
                  </div>
                )}

                {cur.dupStatus === "exists" && (
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-700 p-3 space-y-2">
                    <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">⚠ Tài khoản này đã tồn tại trong đơn hàng</p>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setField(curIdx, "dupStatus", "update")}>Cập nhật đơn cũ</Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setField(curIdx, "dupStatus", "skip")}>Bỏ qua</Button>
                    </div>
                  </div>
                )}
                {cur.dupStatus === "update" && <Badge variant="secondary">Sẽ cập nhật đơn cũ</Badge>}
                {cur.dupStatus === "skip"   && <Badge variant="outline">Bỏ qua đơn này</Badge>}
              </div>

              {/* Right: edit form */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                <F label="Email / Tài khoản *" value={cur.email}         onChange={v => setField(curIdx, "email", v)}         confidence={cur.confidence.email} />
                <F label="Mật khẩu"            value={cur.password}      onChange={v => setField(curIdx, "password", v)}      type="password" confidence={cur.confidence.password} />
                <F label="Mã 2FA"              value={cur.twoFA}         onChange={v => setField(curIdx, "twoFA", v)}         confidence={cur.confidence.twoFA} />
                <F label="Sản phẩm *"          value={cur.productName}   onChange={v => setField(curIdx, "productName", v)}   list={productNames} confidence={cur.confidence.productName} />
                <F label="Giá bán (VNĐ)"       value={cur.price}         onChange={v => setField(curIdx, "price", v)}         type="number" confidence={cur.confidence.price} />
                <F label="Khách hàng"          value={cur.customerName}  onChange={v => setField(curIdx, "customerName", v)}  confidence={cur.confidence.customerName} />
                <F label="Ngày mua"            value={cur.purchaseDate}  onChange={v => setField(curIdx, "purchaseDate", v)}  type="date" confidence={cur.confidence.purchaseDate} />
                <div className="grid gap-1">
                  <Label className="text-xs">Trạng thái</Label>
                  <Select value={cur.status} onValueChange={v => setField(curIdx, "status", v)}>
                    <SelectTrigger className={`h-9 ${cur.confidence.status === "low" ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20" : ""}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Hoạt động</SelectItem>
                      <SelectItem value="expired">Hết hạn</SelectItem>
                      <SelectItem value="refunded">Hoàn tiền</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <F label="Số ngày bảo hành"  value={cur.warrantyDays}  onChange={v => setField(curIdx, "warrantyDays", v)} type="number" confidence={cur.confidence.warrantyDays} />
                {expiry && <p className="text-xs text-muted-foreground px-0.5">Hết bảo hành: {fmtDate(expiry)}</p>}
                <F label="Phương thức TT"    value={cur.paymentMethod} onChange={v => setField(curIdx, "paymentMethod", v)} confidence={cur.confidence.paymentMethod} />
                <F label="Ghi chú"           value={cur.notes}         onChange={v => setField(curIdx, "notes", v)} />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
              <Button variant="outline" className="min-h-[44px]" onClick={() => setStage("upload")}>← Quay lại</Button>
              <span className="text-xs text-muted-foreground flex-1">
                {validCount} đơn hợp lệ / {drafts.length} ảnh
              </span>
              <Button className="min-h-[44px]" disabled={saving || validCount === 0} onClick={handleSave}>
                {saving
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Đang lưu...</>
                  : `Lưu ${validCount} đơn hợp lệ`}
              </Button>
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {stage === "done" && doneResult && (
          <div className="space-y-4 py-4">
            <div className={`rounded-xl p-5 flex items-start gap-3 ${
              doneResult.errors > 0
                ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800"
                : "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
            }`}>
              {doneResult.errors > 0
                ? <AlertTriangle className="w-6 h-6 text-yellow-600 shrink-0 mt-0.5" />
                : <CheckCircle2  className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />}
              <div className="space-y-1">
                <p className="font-semibold">Hoàn tất!</p>
                <p className="text-sm text-muted-foreground">
                  Tổng {doneResult.total} ảnh
                  {doneResult.added   > 0 && <> · <span className="text-green-600 font-medium">{doneResult.added} đơn mới</span></>}
                  {doneResult.updated > 0 && <> · {doneResult.updated} cập nhật</>}
                  {doneResult.skipped > 0 && <> · {doneResult.skipped} bỏ qua</>}
                  {doneResult.errors  > 0 && <> · <span className="text-destructive">{doneResult.errors} lỗi</span></>}
                </p>
              </div>
            </div>
            <Button className="w-full min-h-[44px]" onClick={() => { handleReset(); onClose() }}>Đóng</Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Field helper — highlight vàng nếu confidence medium/low ───────────────────
function F({ label, value, onChange, type = "text", list, confidence }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  list?: string[]
  confidence?: Conf
}) {
  const listId    = list?.length ? `fl-${label.replace(/\W/g, "")}` : undefined
  const uncertain = confidence === "low" || confidence === "medium"
  return (
    <div className="grid gap-1">
      <Label className="text-xs flex items-center gap-1">
        {label}
        {uncertain && <span title="OCR không chắc chắn" style={{ fontSize: 10, color: "#b45309" }}>●</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`h-9 text-sm transition-colors ${
          uncertain
            ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-950/20 focus:border-yellow-500"
            : ""
        }`}
        list={listId}
      />
      {listId && <datalist id={listId}>{list!.map(n => <option key={n} value={n} />)}</datalist>}
    </div>
  )
}
