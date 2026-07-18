import { useRef, useState, useCallback } from "react"
import * as XLSX from "xlsx"
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp, Download, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { Order } from "@workspace/api-client-react"
import {
  detectColumns, buildRow, parseAccounts, missingRequiredCols,
  type ParsedRow, type Account,
} from "@/lib/xlsxUtils"

// ── API helper ────────────────────────────────────────────────────────────────
async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = localStorage.getItem("admin_token") || ""
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Phase = "pick" | "preview" | "done"
type ImportResult = {
  success: number; failed: number; skipped: number
  accountsAdded: number; dupOrders: number; dupAccounts: number
  results: { rowIndex: number; status: string; orderId?: string; message?: string; itemsAdded?: number }[]
}

// ── Status icon helpers ───────────────────────────────────────────────────────
function StatusIcon({ status }: { status: ParsedRow["rowStatus"] }) {
  if (status === "valid") return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
  if (status === "warning") return <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
  return <XCircle className="w-4 h-4 text-destructive shrink-0" />
}

function fmtDate(d: string | null) { return d ? d.slice(0, 10) : "—" }
function fmtPrice(n: number) {
  return n ? new Intl.NumberFormat("vi-VN").format(n) + "đ" : "—"
}
function statusLabel(s: string) {
  return { active: "Hoạt động", pending: "Chờ xử lý", cancelled: "Đã hủy" }[s] ?? s
}

// ── EditRowDialog ─────────────────────────────────────────────────────────────
function EditRowDialog({
  row, onSave, onClose,
}: { row: ParsedRow; onSave: (r: ParsedRow) => void; onClose: () => void }) {
  const [local, setLocal] = useState<ParsedRow>({ ...row })
  const set = (k: keyof ParsedRow, v: any) => setLocal(prev => ({ ...prev, [k]: v }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-background rounded-lg shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-5 space-y-4">
        <h3 className="font-semibold">Sửa dòng #{row.rowIndex}</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label>Mã đơn *</Label>
            <Input value={local.orderCode} onChange={e => set("orderCode", e.target.value.toUpperCase())} />
          </div>
          <div className="grid gap-1.5">
            <Label>Sản phẩm đã map *</Label>
            <Input value={local.productNameMapped ?? ""} onChange={e => set("productNameMapped", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Số lượng</Label>
            <Input type="number" value={local.quantity} onChange={e => set("quantity", Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Tổng tiền (đ)</Label>
            <Input type="number" value={local.totalPrice} onChange={e => set("totalPrice", Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Ngày mua</Label>
            <Input type="date" value={local.purchaseDate ?? ""} onChange={e => set("purchaseDate", e.target.value || null)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Ngày giao gốc</Label>
            <Input type="date" value={local.originalDeliveredAt ?? ""} onChange={e => set("originalDeliveredAt", e.target.value || null)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Ngày HH sử dụng</Label>
            <Input type="date" value={local.expiryDate ?? ""} onChange={e => set("expiryDate", e.target.value || null)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Ngày HH bảo hành</Label>
            <Input type="date" value={local.warrantyEndDate ?? ""} onChange={e => set("warrantyEndDate", e.target.value || null)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Số ngày BH</Label>
            <Input type="number" value={local.warrantyDays} onChange={e => set("warrantyDays", Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Số ngày SD</Label>
            <Input type="number" value={local.usageDays} onChange={e => set("usageDays", Number(e.target.value))} />
          </div>
          <div className="grid gap-1.5">
            <Label>Email slot (khách)</Label>
            <Input value={local.customerEmail} onChange={e => set("customerEmail", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Khách hàng</Label>
            <Input value={local.customerName} onChange={e => set("customerName", e.target.value)} />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Tài khoản đã giao <span className="text-muted-foreground text-xs">(mỗi dòng: email|pass|2fa)</span></Label>
          <textarea
            className="w-full border rounded-md p-2 text-xs font-mono min-h-[100px] bg-background resize-y"
            value={local.accounts.map(a => [a.email, a.password, a.twoFA].filter(Boolean).join("|")).join("\n")}
            onChange={e => set("accounts", parseAccounts(e.target.value))}
          />
          <p className="text-xs text-muted-foreground">{local.accounts.filter(a => a.valid).length} tài khoản hợp lệ</p>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="outline" onClick={onClose}>Hủy</Button>
          <Button onClick={() => { onSave(local); onClose() }}>Lưu</Button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dialog ───────────────────────────────────────────────────────────────
interface Props {
  open: boolean
  onClose: () => void
  existingOrders: Order[]
  onImported: () => void
}

export default function XlsxImportDialog({ open, onClose, existingOrders, onImported }: Props) {
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>("pick")
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [editingRow, setEditingRow] = useState<ParsedRow | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [fileName, setFileName] = useState("")

  // Build lookup structures from existing data
  const existingOrderIds = new Set(existingOrders.map(o => (o.orderId || "").toUpperCase()))

  // Collect known products with warranty/usage days inferred from existing orders
  const knownProducts = (() => {
    const map = new Map<string, { warrantyDays: number; usageDays: number }>()
    for (const o of existingOrders) {
      const name = (o.productName || "").trim()
      if (!name) continue
      if (!map.has(name)) {
        const wd = Number((o as any).warrantyDays || 0)
        const ud = Number((o as any).usageDays || 0)
        map.set(name, { warrantyDays: wd, usageDays: ud })
      }
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }))
  })()

  // Build existing item emails set (we don't have order_items on client — skip global check, server handles it)
  const existingItemEmails = new Set<string>()

  const resetState = () => {
    setPhase("pick")
    setRows([])
    setExpandedRow(null)
    setEditingRow(null)
    setImporting(false)
    setResult(null)
    setFileName("")
    if (fileRef.current) fileRef.current.value = ""
  }

  const handleClose = () => { resetState(); onClose() }

  // ── Parse file ──────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      // raw:true → numbers stay numbers, text stays text; we handle dates ourselves
      const wb = XLSX.read(buf, { type: "array", raw: true })

      // Prefer a sheet named "Orders" (case-insensitive), fall back to first sheet
      const targetSheet = wb.SheetNames.find(n => n.toLowerCase() === "orders") ?? wb.SheetNames[0]
      const ws = wb.Sheets[targetSheet]
      const rawData: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

      if (rawData.length < 2) {
        toast({ title: "File trống", description: `Sheet "${targetSheet}" không có dữ liệu.`, variant: "destructive" })
        return
      }

      // Find header row: scan first 6 rows, pick the one with the most recognised columns
      let headerRowIdx = 0
      let colMap: Record<number, string> = {}
      for (let i = 0; i < Math.min(6, rawData.length); i++) {
        const candidate = detectColumns((rawData[i] ?? []) as string[])
        if (Object.keys(candidate).length > Object.keys(colMap).length) {
          colMap = candidate
          headerRowIdx = i
        }
      }

      if (Object.keys(colMap).length === 0) {
        toast({
          title: "Không nhận ra cột nào",
          description: `Hàng tiêu đề không khớp. Sheet dùng: "${targetSheet}". Kiểm tra tên cột: Mã đơn, Sản phẩm, Tài khoản đã giao…`,
          variant: "destructive",
        })
        return
      }

      // Warn about missing required columns but don't block
      const missing = missingRequiredCols(colMap)
      if (missing.length > 0) {
        toast({
          title: `Thiếu cột bắt buộc: ${missing.join(", ")}`,
          description: "Dữ liệu sẽ thiếu thông tin. Tiếp tục xem trước để kiểm tra.",
          variant: "destructive",
        })
      }

      const parsed: ParsedRow[] = []
      for (let i = headerRowIdx + 1; i < rawData.length; i++) {
        const cells = rawData[i] as any[]
        // Skip completely empty rows
        if (cells.every(c => c === "" || c === null || c === undefined)) continue
        const row = buildRow(i + 1, colMap, cells, existingOrderIds, existingItemEmails, knownProducts)
        parsed.push(row)
      }

      if (parsed.length === 0) {
        toast({ title: "Không có dữ liệu", description: "File không chứa dòng nào có thể đọc.", variant: "destructive" })
        return
      }

      setRows(parsed)
      setPhase("preview")
    } catch (err: any) {
      toast({ title: "Lỗi đọc file", description: String(err?.message ?? err), variant: "destructive" })
    }
  }, [existingOrderIds, existingItemEmails, knownProducts, toast])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  // ── Update row (after edit) ─────────────────────────────────────────────────
  const updateRow = (updated: ParsedRow) => {
    setRows(prev => prev.map(r => r.rowIndex === updated.rowIndex ? updated : r))
  }

  // ── Set conflict action for all duplicates ──────────────────────────────────
  const setAllConflict = (action: ParsedRow["conflictAction"]) => {
    setRows(prev => prev.map(r => r.dupOrderExists ? { ...r, conflictAction: action } : r))
  }

  // ── Import ──────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    const toSubmit = rows.filter(r => r.rowStatus !== "error" && !(r.dupOrderExists && r.conflictAction === "skip" && rows.filter(x => x.dupOrderExists).length === rows.length))

    // Include all non-error rows; server handles duplicates per conflictAction
    const submitRows = rows
      .filter(r => r.rowStatus !== "error")
      .map(r => ({
        rowIndex:          r.rowIndex,
        orderCode:         r.orderCode,
        productNameMapped: r.productNameMapped || r.productNameRaw,
        quantity:          r.quantity,
        totalPrice:        r.totalPrice,
        unitPrice:         r.unitPrice,
        status:            r.status,
        customerName:      r.customerName,
        customerEmail:     r.customerEmail,
        purchaseDate:      r.purchaseDate,
        originalDeliveredAt: r.originalDeliveredAt,
        expiryDate:        r.expiryDate,
        warrantyEndDate:   r.warrantyEndDate,
        warrantyDays:      r.warrantyDays,
        usageDays:         r.usageDays,
        conflictAction:    r.conflictAction,
        accounts:          r.accounts.filter(a => a.valid),
      }))

    if (submitRows.length === 0) {
      toast({ title: "Không có dòng hợp lệ để import", variant: "destructive" }); return
    }

    setImporting(true)
    try {
      const res: ImportResult = await apiFetch("/bot/orders/xlsx-import", {
        method: "POST",
        body: JSON.stringify({ rows: submitRows }),
      })
      setResult(res)
      setPhase("done")
      onImported()
    } catch (err: any) {
      toast({ title: "Lỗi import", description: String(err?.message ?? err), variant: "destructive" })
    } finally {
      setImporting(false)
    }
  }

  // ── Download error file ─────────────────────────────────────────────────────
  const downloadErrors = () => {
    if (!result) return
    const errorRows = result.results
      .filter(r => r.status === "error")
      .map(r => ({ "Dòng": r.rowIndex, "Mã đơn": r.orderId ?? "", "Nội dung lỗi": r.message ?? "" }))
    if (errorRows.length === 0) { toast({ title: "Không có lỗi để tải" }); return }
    const ws = XLSX.utils.json_to_sheet(errorRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Errors")
    XLSX.writeFile(wb, "import_errors.xlsx")
  }

  // ── Derived stats ───────────────────────────────────────────────────────────
  const stats = {
    total: rows.length,
    valid: rows.filter(r => r.rowStatus === "valid").length,
    warning: rows.filter(r => r.rowStatus === "warning").length,
    error: rows.filter(r => r.rowStatus === "error").length,
    dup: rows.filter(r => r.dupOrderExists).length,
  }

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && handleClose()}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[1000px] max-h-[92dvh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5" />
              Import đơn hàng từ XLSX
              {phase === "preview" && <span className="text-sm font-normal text-muted-foreground">— {fileName}</span>}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto">

            {/* ── Phase: PICK ── */}
            {phase === "pick" && (
              <div className="p-8 flex flex-col items-center gap-6">
                <div
                  className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center gap-4 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors w-full max-w-md"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f) }}
                >
                  <Upload className="w-10 h-10 text-muted-foreground" />
                  <div className="text-center">
                    <p className="font-medium">Kéo thả hoặc bấm để chọn file</p>
                    <p className="text-sm text-muted-foreground mt-1">Hỗ trợ .xlsx, .xls</p>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-center max-w-sm space-y-1">
                  <p>Cột nhận diện: <b>Mã đơn, Sản phẩm, Số lượng, Số tiền, Trạng thái, Khách hàng, Email slot, Tạo lúc, Thanh toán, Đã giao, Tài khoản đã giao</b></p>
                  <p>Cột <b>Tài khoản đã giao</b> hỗ trợ: <code>email|pass|2fa</code> hoặc nhiều dòng</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
              </div>
            )}

            {/* ── Phase: PREVIEW ── */}
            {phase === "preview" && (
              <div className="p-4 space-y-4">
                {/* Stats bar */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{stats.total} dòng</Badge>
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">{stats.valid} hợp lệ</Badge>
                  {stats.warning > 0 && <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">{stats.warning} cảnh báo</Badge>}
                  {stats.error > 0 && <Badge variant="destructive">{stats.error} lỗi</Badge>}
                  {stats.dup > 0 && (
                    <Badge variant="outline" className="border-yellow-400">
                      {stats.dup} trùng mã đơn
                    </Badge>
                  )}
                </div>

                {/* Bulk conflict action */}
                {stats.dup > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border border-yellow-200 dark:border-yellow-800 text-sm">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 shrink-0" />
                    <span className="text-yellow-800 dark:text-yellow-200">Áp dụng cho <b>tất cả {stats.dup}</b> đơn trùng:</span>
                    <div className="flex gap-2 ml-auto">
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAllConflict("skip")}>Bỏ qua</Button>
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAllConflict("update")}>Cập nhật</Button>
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setAllConflict("add_missing")}>Thêm TK thiếu</Button>
                    </div>
                  </div>
                )}

                {/* Preview table */}
                <div className="rounded-lg border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium w-8">#</th>
                          <th className="text-left p-2 font-medium min-w-[100px]">Mã đơn</th>
                          <th className="text-left p-2 font-medium min-w-[140px]">Sản phẩm</th>
                          <th className="text-center p-2 font-medium">SL/TK</th>
                          <th className="text-right p-2 font-medium min-w-[80px]">Tổng tiền</th>
                          <th className="text-left p-2 font-medium min-w-[90px]">Ngày mua</th>
                          <th className="text-left p-2 font-medium min-w-[90px]">HH BH</th>
                          <th className="text-left p-2 font-medium min-w-[90px]">HH SD</th>
                          <th className="text-left p-2 font-medium min-w-[120px]">Kết quả</th>
                          <th className="text-right p-2 font-medium">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {rows.map(row => {
                          const isExpanded = expandedRow === row.rowIndex
                          const validAccounts = row.accounts.filter(a => a.valid)
                          return (
                            <>
                              <tr
                                key={row.rowIndex}
                                className={`hover:bg-muted/30 ${row.rowStatus === "error" ? "bg-destructive/5" : row.rowStatus === "warning" ? "bg-yellow-50/50 dark:bg-yellow-950/10" : ""}`}
                              >
                                <td className="p-2">
                                  <div className="flex items-center gap-1">
                                    <StatusIcon status={row.rowStatus} />
                                    <span className="text-muted-foreground">{row.rowIndex}</span>
                                  </div>
                                </td>
                                <td className="p-2 font-mono font-medium">{row.orderCode || <span className="text-destructive italic">trống</span>}</td>
                                <td className="p-2">
                                  {row.productNameMapped
                                    ? <span className="text-green-700 dark:text-green-400">{row.productNameMapped}</span>
                                    : <span className="text-yellow-700 dark:text-yellow-400">{row.productNameRaw || "—"}</span>
                                  }
                                  {row.productNameRaw && row.productNameMapped && row.productNameRaw !== row.productNameMapped && (
                                    <div className="text-muted-foreground truncate max-w-[130px]" title={row.productNameRaw}>({row.productNameRaw})</div>
                                  )}
                                </td>
                                <td className="p-2 text-center">
                                  <span className={row.quantity !== validAccounts.length && validAccounts.length > 0 ? "text-yellow-600 font-medium" : ""}>
                                    {row.quantity}/{validAccounts.length}
                                  </span>
                                </td>
                                <td className="p-2 text-right font-mono">{fmtPrice(row.totalPrice)}</td>
                                <td className="p-2">{fmtDate(row.purchaseDate)}</td>
                                <td className="p-2">{fmtDate(row.warrantyEndDate)}</td>
                                <td className="p-2">{fmtDate(row.expiryDate)}</td>
                                <td className="p-2">
                                  <div className="space-y-0.5">
                                    {row.issues.length === 0
                                      ? <span className="text-green-600">Hợp lệ</span>
                                      : row.issues.map((iss, i) => (
                                        <div key={i} className={`truncate max-w-[160px] ${iss.severity === "error" ? "text-destructive" : "text-yellow-700 dark:text-yellow-400"}`} title={iss.label}>
                                          {iss.label}
                                        </div>
                                      ))
                                    }
                                    {row.dupOrderExists && (
                                      <Select value={row.conflictAction} onValueChange={v => updateRow({ ...row, conflictAction: v as any })}>
                                        <SelectTrigger className="h-6 text-xs px-1.5 w-[130px]"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="skip">Bỏ qua</SelectItem>
                                          <SelectItem value="update">Cập nhật đơn</SelectItem>
                                          <SelectItem value="add_missing">Thêm TK thiếu</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2 text-right whitespace-nowrap">
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingRow(row)}>Sửa</Button>
                                  <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => setExpandedRow(isExpanded ? null : row.rowIndex)}>
                                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                  </Button>
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr key={`exp-${row.rowIndex}`} className="bg-muted/20">
                                  <td colSpan={10} className="p-3">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                                      <div><span className="text-muted-foreground">Khách hàng:</span> {row.customerName || "—"}</div>
                                      <div><span className="text-muted-foreground">Email slot:</span> {row.customerEmail || "—"}</div>
                                      <div><span className="text-muted-foreground">Giá/TK:</span> {fmtPrice(row.unitPrice)}</div>
                                      <div><span className="text-muted-foreground">Trạng thái:</span> {statusLabel(row.status)}</div>
                                      <div><span className="text-muted-foreground">Ngày giao gốc:</span> {fmtDate(row.originalDeliveredAt)}</div>
                                      <div><span className="text-muted-foreground">Ngày BH:</span> {row.warrantyDays}d</div>
                                      <div><span className="text-muted-foreground">Ngày SD:</span> {row.usageDays}d</div>
                                    </div>
                                    <div className="text-xs">
                                      <p className="font-medium mb-1 text-muted-foreground">Tài khoản ({validAccounts.length} hợp lệ / {row.accounts.length} tổng):</p>
                                      <div className="space-y-0.5 font-mono max-h-32 overflow-y-auto bg-background rounded p-2 border">
                                        {row.accounts.map((a, i) => (
                                          <div key={i} className={`flex gap-2 ${!a.valid ? "text-yellow-600" : ""}`}>
                                            <span>{a.valid ? "✓" : "?"}</span>
                                            <span>{a.email}</span>
                                            {a.password && <span className="text-muted-foreground">••••</span>}
                                            {a.twoFA && <span className="text-muted-foreground">2FA</span>}
                                          </div>
                                        ))}
                                        {row.accounts.length === 0 && <span className="text-muted-foreground italic">Không có tài khoản</span>}
                                      </div>
                                      {row.dupAccountEmails.length > 0 && (
                                        <p className="mt-1 text-yellow-600">⚠ Trùng hệ thống: {row.dupAccountEmails.join(", ")}</p>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── Phase: DONE ── */}
            {phase === "done" && result && (
              <div className="p-6 space-y-6">
                <div className={`rounded-lg p-5 flex items-start gap-4 ${result.failed > 0 ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200" : "bg-green-50 dark:bg-green-950/30 border border-green-200"}`}>
                  {result.failed > 0
                    ? <AlertTriangle className="w-6 h-6 text-yellow-600 shrink-0 mt-0.5" />
                    : <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
                  }
                  <div className="space-y-1">
                    <p className="font-semibold">Kết quả import</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                      {[
                        { label: "Đơn thành công", val: result.success, color: "text-green-600" },
                        { label: "Tài khoản đã thêm", val: result.accountsAdded, color: "text-green-600" },
                        { label: "Bị bỏ qua", val: result.skipped, color: "text-muted-foreground" },
                        { label: "Lỗi", val: result.failed, color: "text-destructive" },
                        { label: "TK trùng", val: result.dupAccounts, color: "text-yellow-600" },
                        { label: "Đơn trùng xử lý", val: result.dupOrders, color: "text-yellow-600" },
                      ].map(({ label, val, color }) => (
                        <div key={label} className="bg-background rounded p-2 text-center">
                          <p className={`text-xl font-bold ${color}`}>{val}</p>
                          <p className="text-xs text-muted-foreground">{label}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {result.failed > 0 && (
                  <Button variant="outline" onClick={downloadErrors} className="w-full">
                    <Download className="w-4 h-4 mr-2" /> Tải file lỗi XLSX
                  </Button>
                )}

                <div className="max-h-48 overflow-y-auto rounded border divide-y text-xs">
                  {result.results.map((r, i) => (
                    <div key={i} className={`flex items-center gap-2 px-3 py-1.5 ${r.status === "error" ? "text-destructive" : r.status === "skipped" ? "text-muted-foreground" : "text-green-700 dark:text-green-400"}`}>
                      <span className="font-mono shrink-0">Dòng {r.rowIndex}</span>
                      <span className="truncate">{r.status === "ok" ? `✓ ${r.orderId} — ${r.itemsAdded} TK` : r.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row gap-2 justify-between">
            <Button variant="outline" onClick={handleClose}>Đóng</Button>
            {phase === "pick" && (
              <Button onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Chọn file XLSX
              </Button>
            )}
            {phase === "preview" && (
              <div className="flex gap-2">
                <Button variant="outline" onClick={resetState}>← Chọn lại</Button>
                <Button onClick={handleImport} disabled={importing || rows.filter(r => r.rowStatus !== "error").length === 0}>
                  {importing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Đang import…</> : `Import ${rows.filter(r => r.rowStatus !== "error").length} dòng`}
                </Button>
              </div>
            )}
            {phase === "done" && (
              <Button onClick={resetState}>Import thêm</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline row editor */}
      {editingRow && (
        <EditRowDialog
          row={editingRow}
          onSave={updated => { updateRow(updated); setEditingRow(null) }}
          onClose={() => setEditingRow(null)}
        />
      )}
    </>
  )
}
