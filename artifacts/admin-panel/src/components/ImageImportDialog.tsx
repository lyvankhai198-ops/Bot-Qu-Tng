import { useState, useCallback, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Camera, Upload, X, CheckCircle2, AlertTriangle, XCircle,
  Loader2, ImageIcon, ChevronLeft, ChevronRight, Save
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { useQueryClient } from "@tanstack/react-query"
import { getListOrdersQueryKey } from "@workspace/api-client-react"
import type { Order } from "@workspace/api-client-react"
import { format } from "date-fns"

// ── Types ─────────────────────────────────────────────────────────────────────
type Confidence = "high" | "medium" | "low"

interface ExtractedField<T = string | null> {
  value: T
  confidence: Confidence
}

interface ExtractedOrder {
  email: ExtractedField
  password: ExtractedField
  twoFA: ExtractedField
  productName: ExtractedField
  price: ExtractedField<number | null>
  customerName: ExtractedField
  status: ExtractedField
  purchaseDate: ExtractedField
  paymentMethod: ExtractedField
  warrantyDays: ExtractedField<number | null>
}

interface ImageItem {
  id: string
  filename: string
  previewUrl: string
  base64: string
  mimeType: string
  // null = not yet processed
  extracted: ExtractedOrder | null
  error: string | null
  processed: boolean
  // editable form state after extraction
  form: EditableOrder
  // duplicate status
  dupStatus: "none" | "exists" | "ignored" | "updating"
}

interface EditableOrder {
  email: string
  password: string
  twoFA: string
  productName: string
  price: string
  customerName: string
  status: string
  purchaseDate: string
  paymentMethod: string
  warrantyDays: string
  warrantyExpiry: string
  notes: string
}

const emptyForm = (): EditableOrder => ({
  email: "", password: "", twoFA: "", productName: "", price: "",
  customerName: "", status: "active", purchaseDate: "", paymentMethod: "",
  warrantyDays: "", warrantyExpiry: "", notes: "",
})

// ── Helpers ───────────────────────────────────────────────────────────────────
function addDays(dateStr: string, days: number): string {
  if (!dateStr || !days) return ""
  const [y, m, d] = dateStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`
}

function extractedToForm(e: ExtractedOrder): EditableOrder {
  const warrantyDays = e.warrantyDays.value ?? 0
  const purchaseDate = e.purchaseDate.value ?? ""
  const warrantyExpiry = warrantyDays && purchaseDate ? addDays(purchaseDate, warrantyDays) : ""
  return {
    email: e.email.value ?? "",
    password: e.password.value ?? "",
    twoFA: e.twoFA.value ?? "",
    productName: e.productName.value ?? "",
    price: e.price.value != null ? String(e.price.value) : "",
    customerName: e.customerName.value ?? "",
    status: e.status.value || "active",
    purchaseDate,
    paymentMethod: e.paymentMethod.value ?? "",
    warrantyDays: warrantyDays ? String(warrantyDays) : "",
    warrantyExpiry,
    notes: "",
  }
}

function fieldBadge(c: Confidence) {
  if (c === "high") return null
  if (c === "medium") return <span className="ml-1 text-xs text-yellow-600 dark:text-yellow-400">⚠ cần kiểm tra</span>
  return <span className="ml-1 text-xs text-destructive">✗ không rõ</span>
}

function inputClass(c: Confidence) {
  if (c === "high") return "min-h-[40px]"
  if (c === "medium") return "min-h-[40px] border-yellow-400 dark:border-yellow-600 bg-yellow-50/30 dark:bg-yellow-950/20"
  return "min-h-[40px] border-destructive bg-red-50/30 dark:bg-red-950/20"
}

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") + "/api"
const SESSION_SECRET = (() => {
  // Read from cookie set by login
  const m = document.cookie.match(/session_token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : (localStorage.getItem("admin_token") ?? "")
})()

async function callOcrExtract(images: { data: string; mimeType: string; filename: string }[]) {
  const token = localStorage.getItem("admin_token") ?? SESSION_SECRET
  const resp = await fetch(`${API_BASE}/bot/orders/ocr-extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ images }),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json() as Promise<{ results: { filename: string; success: boolean; extracted?: ExtractedOrder; error?: string }[] }>
}

async function saveOrder(form: EditableOrder, existingOrders: Order[], dupAction?: "update" | "skip"): Promise<{ ok: boolean; skipped?: boolean; orderId?: string; error?: string }> {
  const token = localStorage.getItem("admin_token") ?? SESSION_SECRET
  const emailLower = form.email.toLowerCase()
  const existing = existingOrders.find(o => (o.email || "").toLowerCase() === emailLower)

  if (existing && dupAction !== "update" && dupAction !== "skip") {
    return { ok: false, error: "DUPLICATE" }
  }
  if (existing && dupAction === "skip") {
    return { ok: true, skipped: true }
  }

  const warrantyDays = Number(form.warrantyDays) || 0
  const expiryDate = warrantyDays && form.purchaseDate ? addDays(form.purchaseDate, warrantyDays) : null

  const payload = {
    email: form.email,
    password: form.password || null,
    twoFA: form.twoFA || null,
    productName: form.productName,
    price: form.price ? Number(form.price) : null,
    customerName: form.customerName || null,
    purchaseDate: form.purchaseDate ? new Date(form.purchaseDate).toISOString() : null,
    warrantyPeriod: warrantyDays ? `${warrantyDays} ngày` : null,
    warrantyExpiry: expiryDate ? new Date(expiryDate).toISOString() : null,
    status: form.status || "active",
    notes: form.notes || null,
  }

  if (existing && dupAction === "update") {
    const resp = await fetch(`${API_BASE}/bot/orders/${existing.orderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
    return { ok: true, orderId: existing.orderId }
  }

  const resp = await fetch(`${API_BASE}/bot/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
  const data = await resp.json()
  return { ok: true, orderId: data.orderId }
}

// ── Main Component ────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
  existingOrders: Order[]
}

type Stage = "upload" | "review" | "done"

interface DoneResult { added: number; skipped: number; errors: number }

export default function ImageImportDialog({ open, onClose, existingOrders }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const [stage, setStage] = useState<Stage>("upload")
  const [images, setImages] = useState<ImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [saving, setSaving] = useState(false)
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null)

  // ── File ingestion ──────────────────────────────────────────────────────────
  const ingestFiles = useCallback((files: File[]) => {
    // Accept any image file — iOS HEIC/HEIF, empty type from some browsers, etc.
    // Unsupported types (e.g. HEIC) will fail at OCR stage with a clear error.
    const imageExtRe = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i
    const valid = files.filter(f =>
      f.type.startsWith("image/") || imageExtRe.test(f.name) || f.type === ""
    )
    if (valid.length === 0) {
      toast({ title: "Không tìm thấy ảnh", description: "Vui lòng chọn file ảnh", variant: "destructive" })
      return
    }

    const readers = valid.map(file => new Promise<ImageItem>((resolve) => {
      const reader = new FileReader()
      reader.onload = e => {
        const dataUrl = e.target?.result as string
        if (!dataUrl) { resolve({ id: crypto.randomUUID(), filename: file.name, previewUrl: "", base64: "", mimeType: "image/jpeg", extracted: null, error: "Không đọc được file", processed: false, form: emptyForm(), dupStatus: "none" }); return }
        const base64 = dataUrl.split(",")[1] ?? ""
        // Normalise MIME: iOS HEIC often comes as image/heic or empty — send as jpeg to OpenAI
        const rawMime = file.type || "image/jpeg"
        const mimeType = rawMime.includes("heic") || rawMime.includes("heif") ? "image/jpeg" : rawMime
        resolve({
          id: crypto.randomUUID(),
          filename: file.name,
          previewUrl: dataUrl,
          base64,
          mimeType,
          extracted: null,
          error: null,
          processed: false,
          form: emptyForm(),
          dupStatus: "none",
        })
      }
      reader.onerror = () => resolve({ id: crypto.randomUUID(), filename: file.name, previewUrl: "", base64: "", mimeType: "image/jpeg", extracted: null, error: "Không đọc được file", processed: false, form: emptyForm(), dupStatus: "none" })
      reader.readAsDataURL(file)
    }))

    Promise.all(readers).then(items => {
      setImages(prev => [...prev, ...items].slice(0, 20))
    })
  }, [toast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    ingestFiles(Array.from(e.dataTransfer.files))
  }, [ingestFiles])

  const removeImage = (id: string) => setImages(prev => prev.filter(i => i.id !== id))

  // ── OCR extraction ──────────────────────────────────────────────────────────
  const handleExtract = async () => {
    if (images.length === 0) return
    setLoading(true)
    try {
      const payload = images.map(img => ({ data: img.base64, mimeType: img.mimeType, filename: img.filename }))
      const { results } = await callOcrExtract(payload)

      setImages(prev => prev.map((img, idx) => {
        const r = results[idx]
        if (!r) return img
        if (r.success && r.extracted) {
          const form = extractedToForm(r.extracted)
          const emailLower = form.email.toLowerCase()
          const dup = existingOrders.some(o => (o.email || "").toLowerCase() === emailLower)
          return { ...img, extracted: r.extracted, error: null, processed: true, form, dupStatus: dup ? "exists" : "none" }
        }
        return { ...img, extracted: null, error: r.error || "Không thể đọc ảnh", processed: true }
      }))

      setCurrentIdx(0)
      setStage("review")
    } catch (err: any) {
      toast({ title: "Lỗi kết nối", description: String(err?.message), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  // ── Form update ─────────────────────────────────────────────────────────────
  const updateForm = (id: string, patch: Partial<EditableOrder>) => {
    setImages(prev => prev.map(img => {
      if (img.id !== id) return img
      const next = { ...img.form, ...patch }
      // Auto-calc warranty expiry when warrantyDays or purchaseDate changes
      if ("warrantyDays" in patch || "purchaseDate" in patch) {
        const wDays = Number(next.warrantyDays) || 0
        next.warrantyExpiry = wDays && next.purchaseDate ? addDays(next.purchaseDate, wDays) : ""
      }
      // Re-check dup on email change
      const dupStatus = "email" in patch
        ? (existingOrders.some(o => (o.email || "").toLowerCase() === (patch.email || "").toLowerCase()) ? "exists" : "none")
        : img.dupStatus
      return { ...img, form: next, dupStatus }
    }))
  }

  // ── Save all ────────────────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    setSaving(true)
    let added = 0, skipped = 0, errors = 0
    const updatedOrders = [...existingOrders] // local shadow for mid-batch dup check

    for (const img of images) {
      if (!img.processed || img.error) { errors++; continue }
      const form = img.form
      if (!form.email || !form.productName) { errors++; continue }

      const dupAction = img.dupStatus === "ignored" ? "skip"
        : img.dupStatus === "updating" ? "update"
        : undefined

      try {
        const result = await saveOrder(form, updatedOrders, dupAction)
        if (!result.ok) {
          if (result.error === "DUPLICATE") { /* handled per-card */ }
          errors++
        } else if (result.skipped) {
          skipped++
        } else {
          added++
          // Add to shadow so subsequent items in same batch don't re-collide
          updatedOrders.push({ orderId: result.orderId!, email: form.email } as Order)
        }
      } catch {
        errors++
      }
    }

    queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() })
    setSaving(false)
    setDoneResult({ added, skipped, errors })
    setStage("done")
  }

  // ── Valid count for save ────────────────────────────────────────────────────
  const validForSave = images.filter(i =>
    i.processed && !i.error && i.form.email && i.form.productName &&
    i.dupStatus !== "exists" // block until admin resolves dups
  )
  const unresolvedDups = images.filter(i => i.processed && !i.error && i.dupStatus === "exists")

  const handleReset = () => {
    setStage("upload"); setImages([]); setCurrentIdx(0); setDoneResult(null)
  }

  // ── Current image for review ────────────────────────────────────────────────
  const cur = images[currentIdx]

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) { handleReset(); onClose() } }}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[860px] max-h-[94dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Camera className="w-5 h-5" /> Thêm đơn hàng từ ảnh
          </DialogTitle>
        </DialogHeader>

        {/* ── STAGE: UPLOAD ─────────────────────────────────────────────────── */}
        {stage === "upload" && (
          <div className="space-y-4 py-2">
            {/* Drop zone */}
            <div
              ref={dropRef}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary hover:bg-muted/30 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium text-sm">Kéo thả ảnh vào đây hoặc bấm để chọn</p>
              <p className="text-xs text-muted-foreground mt-1">Hỗ trợ JPG, PNG, WEBP · Tối đa 20 ảnh</p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 min-h-[44px]" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Chọn từ máy tính
              </Button>
              <Button variant="outline" className="flex-1 min-h-[44px]" onClick={() => cameraRef.current?.click()}>
                <Camera className="w-4 h-4 mr-2" /> Dùng camera
              </Button>
            </div>

            {/* sr-only instead of hidden — iOS Safari blocks .click() on display:none inputs */}
            <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only"
              onChange={e => { ingestFiles(Array.from(e.target.files ?? [])); e.target.value = "" }} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={e => { ingestFiles(Array.from(e.target.files ?? [])); e.target.value = "" }} />

            {/* Thumbnail grid */}
            {images.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">{images.length} ảnh đã chọn</p>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {images.map(img => (
                    <div key={img.id} className="relative group rounded-lg overflow-hidden border bg-muted aspect-square">
                      <img src={img.previewUrl} alt={img.filename} className="w-full h-full object-cover" />
                      <button
                        onClick={e => { e.stopPropagation(); removeImage(img.id) }}
                        className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 p-1">
                        <p className="text-white text-[9px] truncate">{img.filename}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2 flex-col sm:flex-row gap-2">
              <Button variant="outline" className="w-full sm:w-auto min-h-[44px]" onClick={() => { handleReset(); onClose() }}>Hủy</Button>
              <Button
                className="w-full sm:w-auto min-h-[44px]"
                disabled={images.length === 0 || loading}
                onClick={handleExtract}
              >
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang đọc ảnh...</> : "Đọc dữ liệu"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ── STAGE: REVIEW ─────────────────────────────────────────────────── */}
        {stage === "review" && cur && (
          <div className="space-y-4 py-2">
            {/* Summary bar */}
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <span className="text-muted-foreground">Tổng: <b>{images.length}</b></span>
              <span className="text-green-600">✓ {images.filter(i => i.processed && !i.error).length} đọc được</span>
              <span className="text-yellow-600">⚠ {unresolvedDups.length} trùng</span>
              <span className="text-destructive">✗ {images.filter(i => i.error).length} lỗi</span>
            </div>

            {/* Nav */}
            {images.length > 1 && (
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" disabled={currentIdx === 0} onClick={() => setCurrentIdx(i => i - 1)}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <div className="flex gap-1 flex-wrap">
                  {images.map((img, idx) => (
                    <button
                      key={img.id}
                      onClick={() => setCurrentIdx(idx)}
                      className={`w-7 h-7 rounded text-xs font-mono border transition-colors ${
                        idx === currentIdx ? "bg-primary text-primary-foreground border-primary" :
                        img.error ? "border-destructive text-destructive" :
                        img.dupStatus === "exists" ? "border-yellow-400 text-yellow-600" :
                        img.processed ? "border-green-500 text-green-600" : "border-border"
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
                <Button size="icon" variant="outline" disabled={currentIdx === images.length - 1} onClick={() => setCurrentIdx(i => i + 1)}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">{currentIdx + 1} / {images.length}</span>
              </div>
            )}

            {/* Card */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Original image */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" /> Ảnh gốc — {cur.filename}
                </p>
                <div className="rounded-lg border overflow-hidden bg-muted max-h-[380px]">
                  <img src={cur.previewUrl} alt={cur.filename} className="w-full h-full object-contain" style={{ maxHeight: 380 }} />
                </div>
              </div>

              {/* Form / error */}
              <div>
                {cur.error ? (
                  <div className="rounded-lg border border-destructive bg-red-50/30 dark:bg-red-950/20 p-4 flex items-start gap-3 h-full">
                    <XCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm text-destructive">Không đọc được ảnh</p>
                      <p className="text-xs text-muted-foreground mt-1">{cur.error}</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => removeImage(cur.id)}>Bỏ ảnh này</Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Dup warning */}
                    {cur.dupStatus === "exists" && (
                      <div className="rounded-lg border border-yellow-400 bg-yellow-50/30 dark:bg-yellow-950/20 p-3">
                        <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" /> Tài khoản này đã có trong hệ thống
                        </p>
                        <div className="flex gap-2 mt-2 flex-wrap">
                          <Button size="sm" variant="outline" className="text-xs"
                            onClick={() => setImages(p => p.map(i => i.id === cur.id ? { ...i, dupStatus: "ignored" } : i))}>
                            Bỏ qua
                          </Button>
                          <Button size="sm" variant="outline" className="text-xs text-yellow-700 dark:text-yellow-400 border-yellow-400"
                            onClick={() => setImages(p => p.map(i => i.id === cur.id ? { ...i, dupStatus: "updating" } : i))}>
                            Cập nhật đơn cũ
                          </Button>
                          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground"
                            onClick={() => removeImage(cur.id)}>
                            Hủy ảnh này
                          </Button>
                        </div>
                      </div>
                    )}

                    {(cur.dupStatus === "ignored" || cur.dupStatus === "updating") && (
                      <div className="rounded-lg border border-border bg-muted/30 p-2 text-xs text-muted-foreground flex items-center gap-2">
                        {cur.dupStatus === "ignored"
                          ? <><CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground" /> Sẽ bỏ qua đơn này</>
                          : <><CheckCircle2 className="w-3.5 h-3.5 text-yellow-600" /> Sẽ cập nhật đơn cũ</>}
                        <button className="ml-auto underline" onClick={() => setImages(p => p.map(i => i.id === cur.id ? { ...i, dupStatus: "exists" } : i))}>Đổi lại</button>
                      </div>
                    )}

                    {/* Fields */}
                    <ReviewField
                      label="Email / tài khoản *"
                      conf={cur.extracted?.email.confidence ?? "low"}
                      value={cur.form.email}
                      onChange={v => updateForm(cur.id, { email: v })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <ReviewField label="Mật khẩu" conf={cur.extracted?.password.confidence ?? "low"}
                        value={cur.form.password} onChange={v => updateForm(cur.id, { password: v })} />
                      <ReviewField label="2FA" conf={cur.extracted?.twoFA.confidence ?? "high"}
                        value={cur.form.twoFA} onChange={v => updateForm(cur.id, { twoFA: v })} />
                    </div>
                    <ReviewField
                      label="Sản phẩm *"
                      conf={cur.extracted?.productName.confidence ?? "low"}
                      value={cur.form.productName}
                      onChange={v => updateForm(cur.id, { productName: v })}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <ReviewField label="Giá bán (VNĐ)" conf={cur.extracted?.price.confidence ?? "low"}
                        value={cur.form.price} onChange={v => updateForm(cur.id, { price: v })} type="number" />
                      <ReviewField label="Khách hàng" conf={cur.extracted?.customerName.confidence ?? "low"}
                        value={cur.form.customerName} onChange={v => updateForm(cur.id, { customerName: v })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <ReviewField label="Ngày mua" conf={cur.extracted?.purchaseDate.confidence ?? "low"}
                        value={cur.form.purchaseDate} onChange={v => updateForm(cur.id, { purchaseDate: v })} type="date" />
                      <ReviewField label="Số ngày BH" conf={cur.extracted?.warrantyDays.confidence ?? "low"}
                        value={cur.form.warrantyDays} onChange={v => updateForm(cur.id, { warrantyDays: v })} type="number" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Trạng thái</Label>
                        <Select value={cur.form.status} onValueChange={v => updateForm(cur.id, { status: v })}>
                          <SelectTrigger className="min-h-[40px] text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Hoạt động</SelectItem>
                            <SelectItem value="expired">Hết hạn</SelectItem>
                            <SelectItem value="refunded">Đã hoàn tiền</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <ReviewField label="PTTT" conf={cur.extracted?.paymentMethod.confidence ?? "low"}
                        value={cur.form.paymentMethod} onChange={v => updateForm(cur.id, { paymentMethod: v })} />
                    </div>
                    {cur.form.warrantyExpiry && (
                      <p className="text-xs text-muted-foreground">
                        Hết hạn BH: <b>{format(new Date(cur.form.warrantyExpiry), "dd/MM/yyyy")}</b>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="pt-2 flex-col sm:flex-row gap-2">
              <Button variant="outline" className="w-full sm:w-auto min-h-[44px]" onClick={() => setStage("upload")}>← Quay lại</Button>
              <Button
                className="w-full sm:w-auto min-h-[44px]"
                disabled={saving || validForSave.length === 0 || unresolvedDups.length > 0}
                onClick={handleSaveAll}
              >
                {saving
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang lưu...</>
                  : <><Save className="w-4 h-4 mr-2" /> Lưu {validForSave.length} đơn hợp lệ</>}
              </Button>
            </DialogFooter>
            {unresolvedDups.length > 0 && (
              <p className="text-xs text-center text-yellow-600 dark:text-yellow-400">
                ⚠ Còn {unresolvedDups.length} đơn bị trùng — hãy chọn "Bỏ qua" hoặc "Cập nhật" trước khi lưu
              </p>
            )}
          </div>
        )}

        {/* ── STAGE: DONE ───────────────────────────────────────────────────── */}
        {stage === "done" && doneResult && (
          <div className="py-6 space-y-4">
            <div className={`rounded-xl p-5 flex items-start gap-3 ${doneResult.errors > 0 || doneResult.skipped > 0 ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800" : "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"}`}>
              {doneResult.errors > 0 ? <AlertTriangle className="w-6 h-6 text-yellow-600 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />}
              <div>
                <p className="font-semibold">Hoàn tất!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {doneResult.added} đơn đã lưu · {doneResult.skipped} bỏ qua · {doneResult.errors} lỗi
                </p>
              </div>
            </div>
            <Button className="w-full min-h-[44px]" onClick={() => { handleReset(); onClose() }}>Đóng</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Sub-component: ReviewField ────────────────────────────────────────────────
function ReviewField({
  label, conf, value, onChange, type = "text"
}: {
  label: string
  conf: Confidence
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs flex items-center gap-0.5">
        {label}{fieldBadge(conf)}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className={inputClass(conf)}
      />
    </div>
  )
}
