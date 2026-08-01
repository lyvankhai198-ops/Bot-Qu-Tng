/**
 * warranty-scan.tsx — Trang "Quét Đơn Còn Bảo Hành"
 */
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Search, SheetIcon, Loader2, ExternalLink, Download, Trash2,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
  RefreshCw, FileText, FileSpreadsheet,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// ─────────────────────────── helpers ────────────────────────────────────────

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, url: string, body?: unknown): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { ...authHeader(), "Content-Type": "application/json" },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${url}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function fmtAmount(n: number) {
  return n.toLocaleString("vi-VN") + "đ"
}

function today() {
  return new Date().toISOString().split("T")[0]
}

// ─────────────────────────── types ───────────────────────────────────────────

interface Preset { key: string; label: string; warranty_days: number }

interface ScanEntry {
  order_id: string
  seller: string
  buyer: string
  product_name: string
  account_raw: string
  email: string
  password: string
  twofa: string
  start_date: string
  expire_date: string
  warranty_days: number
  days_used: number
  days_left: number
  sell_price: number
  source_price: number
  refund_amount: number
  refund_status: string
  note: string
  dup_reason?: string
}

interface ScanStats {
  total_scanned:   number
  total_matched:   number
  total_qualified: number
  total_expired:   number
  total_excluded:  number
  total_errors:    number
  total_duplicates: number
  total_refund:    number
}

interface ScanResult {
  ok:         boolean
  stats:      ScanStats
  qualified:  ScanEntry[]
  duplicates: ScanEntry[]
  errors:     Array<{ order_id: string; product: string; reason: string }>
  excluded:   Array<{ order_id: string; product: string; reason: string }>
  expired:    ScanEntry[]
  scan_id?:   string
  sheet_name?: string
  spreadsheet_url?: string
  error?:     string
}

interface HistoryItem {
  scan_id:       string
  preset:        string
  preset_label:  string
  scan_date:     string
  warranty_days: number
  refund_mode:   string
  total_scanned: number
  total_qualified: number
  total_refund:  number
  sheet_name:    string
  spreadsheet_url: string
  created_at:    string
}

// ─────────────────────────── stat card ───────────────────────────────────────

function StatCard({ label, value, color = "default" }: { label: string; value: number | string; color?: string }) {
  const colorMap: Record<string, string> = {
    green:  "text-green-600",
    red:    "text-red-500",
    yellow: "text-yellow-600",
    blue:   "text-blue-600",
    gray:   "text-muted-foreground",
    default: "text-foreground",
  }
  return (
    <div className="flex flex-col gap-1 p-3 rounded-lg border bg-card">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${colorMap[color] ?? colorMap.default}`}>{value}</span>
    </div>
  )
}

// ─────────────────────────── collapsible section ─────────────────────────────

function Section({ title, count, badge, children }: {
  title: string; count: number; badge?: string; children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span>{title}</span>
        <Badge variant={badge === "destructive" ? "destructive" : "secondary"}>{count}</Badge>
      </button>
      {open && <div className="border-t">{children}</div>}
    </div>
  )
}

// ─────────────────────────── main page ───────────────────────────────────────

export default function WarrantyScan() {
  const { toast } = useToast()

  // Form state
  const [presets,       setPresets]       = useState<Preset[]>([])
  const [preset,        setPreset]        = useState("chatgpt_30d")
  const [scanDate,      setScanDate]      = useState(today())
  const [warrantyDays,  setWarrantyDays]  = useState(30)
  const [refundMode,    setRefundMode]    = useState<"sell_price" | "fixed">("sell_price")
  const [refundPrice,   setRefundPrice]   = useState(0)

  // Preview state
  const [previewing,    setPreviewing]    = useState(false)
  const [previewResult, setPreviewResult] = useState<ScanResult | null>(null)

  // Create sheet state
  const [creating,      setCreating]      = useState(false)
  const [createResult,  setCreateResult]  = useState<ScanResult | null>(null)
  const [showCreateDlg, setShowCreateDlg] = useState(false)

  // History state
  const [history,       setHistory]       = useState<HistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)

  // Table expand
  const [showAllQualified, setShowAllQualified] = useState(false)

  // Load presets
  useEffect(() => {
    apiFetch("GET", "/bot/warranty-scan/presets")
      .then(setPresets)
      .catch(() => {})
  }, [])

  // Sync warranty days when preset changes
  useEffect(() => {
    const p = presets.find(x => x.key === preset)
    if (p) setWarrantyDays(p.warranty_days)
  }, [preset, presets])

  // Load history on mount
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const data = await apiFetch("GET", "/bot/warranty-scan/history")
      setHistory(data)
    } catch { /* silent */ }
    finally { setLoadingHistory(false) }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  // ── Preview ────────────────────────────────────────────────────────────────
  const handlePreview = async () => {
    setPreviewing(true)
    setPreviewResult(null)
    try {
      const res = await apiFetch("POST", "/bot/warranty-scan/preview", {
        preset,
        date:           scanDate,
        warranty_days:  warrantyDays,
        refund_mode:    refundMode,
        refund_price:   refundPrice,
      })
      setPreviewResult(res)
      if (!res.ok) toast({ title: "Lỗi", description: res.error ?? res.message, variant: "destructive" })
    } catch (e: any) {
      toast({ title: "Lỗi kết nối", description: e.message, variant: "destructive" })
    } finally {
      setPreviewing(false)
    }
  }

  // ── Create sheet ───────────────────────────────────────────────────────────
  const handleCreateSheet = async () => {
    setCreating(true)
    setShowCreateDlg(false)
    try {
      const res = await apiFetch("POST", "/bot/warranty-scan/create-sheet", {
        preset,
        date:           scanDate,
        warranty_days:  warrantyDays,
        refund_mode:    refundMode,
        refund_price:   refundPrice,
      })
      setCreateResult(res)
      if (res.ok) {
        toast({ title: "✅ Tạo Sheet thành công", description: `Tab: ${res.sheet_name}` })
        loadHistory()
      } else {
        toast({ title: "Lỗi tạo Sheet", description: res.error ?? res.message, variant: "destructive" })
      }
    } catch (e: any) {
      toast({ title: "Lỗi kết nối", description: e.message, variant: "destructive" })
    } finally {
      setCreating(false)
    }
  }

  // ── Delete history ─────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await apiFetch("DELETE", `/bot/warranty-scan/history/${id}`)
      setHistory(h => h.filter(x => x.scan_id !== id))
      toast({ title: "Đã xóa đợt quét" })
    } catch (e: any) {
      toast({ title: "Lỗi xóa", description: e.message, variant: "destructive" })
    } finally {
      setDeletingId(null) }
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const handleDownload = (id: string, format: "xlsx" | "csv") => {
    const token = localStorage.getItem("admin_token") ?? ""
    const url   = `/api/bot/warranty-scan/export/${id}/${format}`
    // Dùng fetch + blob để giữ auth header
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) throw new Error(await res.text())
        const blob = await res.blob()
        const a    = document.createElement("a")
        a.href     = URL.createObjectURL(blob)
        const cd   = res.headers.get("Content-Disposition") ?? ""
        const m    = cd.match(/filename\*=UTF-8''(.+)/)
        a.download  = m ? decodeURIComponent(m[1]) : `scan_${id}.${format}`
        a.click()
        URL.revokeObjectURL(a.href)
      })
      .catch(e => toast({ title: "Lỗi tải file", description: e.message, variant: "destructive" }))
  }

  // ────────────────────────────── render ─────────────────────────────────────
  const presetLabel = presets.find(x => x.key === preset)?.label ?? preset
  const displayedQualified = previewResult?.qualified ?? []
  const displayRows        = showAllQualified ? displayedQualified : displayedQualified.slice(0, 20)

  return (
    <div className="flex flex-col gap-6 p-4 max-w-6xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-blue-500" />
          Quét Đơn Còn Bảo Hành
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Lọc các đơn còn trong thời hạn bảo hành, tính tiền hoàn và tạo Google Sheet gửi nhà cung cấp.
        </p>
      </div>

      {/* ── Form ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-base">Cấu hình đợt quét</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

          {/* Preset */}
          <div className="flex flex-col gap-1.5">
            <Label>Bộ sản phẩm</Label>
            <Select value={preset} onValueChange={setPreset}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {presets.length === 0
                  ? <SelectItem value="chatgpt_30d">ChatGPT Plus BHF 30D</SelectItem>
                  : presets.map(p => (
                    <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          </div>

          {/* Ngày tính */}
          <div className="flex flex-col gap-1.5">
            <Label>Ngày tính bảo hành</Label>
            <Input type="date" value={scanDate} onChange={e => setScanDate(e.target.value)} />
          </div>

          {/* Thời hạn BH */}
          <div className="flex flex-col gap-1.5">
            <Label>Thời hạn bảo hành (ngày)</Label>
            <Input
              type="number" min={1} max={365}
              value={warrantyDays}
              onChange={e => setWarrantyDays(Math.max(1, parseInt(e.target.value) || 30))}
            />
          </div>

          {/* Giá hoàn */}
          <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <Label>Giá hoàn</Label>
            <div className="flex gap-2">
              <Button
                type="button" size="sm"
                variant={refundMode === "sell_price" ? "default" : "outline"}
                onClick={() => setRefundMode("sell_price")}
              >
                Giá bán
              </Button>
              <Button
                type="button" size="sm"
                variant={refundMode === "fixed" ? "default" : "outline"}
                onClick={() => setRefundMode("fixed")}
              >
                Cố định
              </Button>
              {refundMode === "fixed" && (
                <Input
                  type="number" min={0} placeholder="VD: 350000"
                  value={refundPrice || ""}
                  onChange={e => setRefundPrice(parseInt(e.target.value) || 0)}
                  className="w-36"
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {refundMode === "sell_price"
                ? "Hoàn = Giá bán ÷ Tổng ngày × Còn lại"
                : `Hoàn cố định: ${fmtAmount(refundPrice)} / đơn`}
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <Button onClick={handlePreview} disabled={previewing || creating} className="gap-2">
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {previewing ? "Đang quét…" : "Xem trước"}
            </Button>
            <Button
              variant="default"
              className="gap-2 bg-green-600 hover:bg-green-700"
              disabled={creating || previewing}
              onClick={() => setShowCreateDlg(true)}
            >
              {creating
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Đang tạo…</>
                : <><SheetIcon className="h-4 w-4" /> Tạo Sheet</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Kết quả tạo sheet ────────────────────────────────────────────── */}
      {createResult?.ok && (
        <Card className="border-green-500">
          <CardContent className="pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-medium text-sm">Đã tạo tab: <span className="font-mono">{createResult.sheet_name}</span></p>
                <p className="text-xs text-muted-foreground">
                  {createResult.stats?.total_qualified} đơn —{" "}
                  {fmtAmount(createResult.stats?.total_refund ?? 0)} hoàn dự kiến
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button size="sm" variant="outline" className="gap-1.5" asChild>
                <a href={createResult.spreadsheet_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" /> Mở Sheet
                </a>
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => handleDownload(createResult.scan_id!, "xlsx")}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> XLSX
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5"
                onClick={() => handleDownload(createResult.scan_id!, "csv")}>
                <FileText className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Preview stats ─────────────────────────────────────────────────── */}
      {previewResult && (
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">
            Kết quả xem trước — <span className="text-blue-500">{presetLabel}</span>
            {" | "}ngày {scanDate} | BH {warrantyDays} ngày
          </h2>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <StatCard label="Đã quét"        value={previewResult.stats.total_scanned}   />
            <StatCard label="Khớp sản phẩm"  value={previewResult.stats.total_matched}    color="blue" />
            <StatCard label="Còn bảo hành"   value={previewResult.stats.total_qualified}  color="green" />
            <StatCard label="Hết bảo hành"   value={previewResult.stats.total_expired}    color="gray" />
            <StatCard label="Bị loại"         value={previewResult.stats.total_excluded}   color="gray" />
            <StatCard label="Thiếu dữ liệu"  value={previewResult.stats.total_errors}     color="yellow" />
            <StatCard label="Tiền hoàn DK"   value={fmtAmount(previewResult.stats.total_refund)} color="green" />
          </div>

          {/* Duplicates warning */}
          {previewResult.stats.total_duplicates > 0 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <span className="text-yellow-800 dark:text-yellow-200">
                <strong>{previewResult.stats.total_duplicates} đơn trùng</strong> đã được loại khỏi danh sách.
                Xem chi tiết bên dưới để kiểm tra trước khi tạo Sheet.
              </span>
            </div>
          )}

          {/* Qualified orders table */}
          {previewResult.qualified.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Đơn sẽ đưa vào Sheet ({previewResult.qualified.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">#</TableHead>
                        <TableHead>Mã đơn</TableHead>
                        <TableHead>Sản phẩm</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Ngày mua</TableHead>
                        <TableHead>Hết hạn</TableHead>
                        <TableHead className="text-right">Còn lại</TableHead>
                        <TableHead className="text-right">Tiền hoàn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayRows.map((e, i) => (
                        <TableRow key={e.order_id}>
                          <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                          <TableCell className="font-mono text-xs">{e.order_id}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate" title={e.product_name}>
                            {e.product_name}
                          </TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate" title={e.email}>
                            {e.email || <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="text-xs">{e.start_date}</TableCell>
                          <TableCell className="text-xs">{e.expire_date}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant={e.days_left <= 3 ? "destructive" : "secondary"}>
                              {e.days_left}d
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-xs font-medium text-green-600">
                            {fmtAmount(e.refund_amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {displayedQualified.length > 20 && (
                  <div className="p-3 text-center border-t">
                    <Button variant="ghost" size="sm" onClick={() => setShowAllQualified(v => !v)}>
                      {showAllQualified
                        ? "Thu gọn"
                        : `Xem thêm ${displayedQualified.length - 20} đơn`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Collapsible sections */}
          <div className="flex flex-col gap-2">
            <Section title="Đơn trùng (bị loại khỏi kết quả)" count={previewResult.duplicates.length} badge="destructive">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã đơn</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Lý do trùng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewResult.duplicates.map(e => (
                      <TableRow key={e.order_id}>
                        <TableCell className="font-mono text-xs">{e.order_id}</TableCell>
                        <TableCell className="text-xs">{e.product_name}</TableCell>
                        <TableCell className="text-xs">{e.email || "—"}</TableCell>
                        <TableCell className="text-xs text-yellow-600">{e.dup_reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>

            <Section title="Đơn hết bảo hành" count={previewResult.expired.length}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã đơn</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Ngày mua</TableHead>
                      <TableHead className="text-right">Đã dùng</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewResult.expired.map(e => (
                      <TableRow key={e.order_id}>
                        <TableCell className="font-mono text-xs">{e.order_id}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{e.product_name}</TableCell>
                        <TableCell className="text-xs">{e.start_date}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">{e.days_used}d</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>

            <Section title="Đơn thiếu dữ liệu ngày" count={previewResult.errors.length} badge="destructive">
              <div className="p-3 flex flex-col gap-1">
                {previewResult.errors.map(e => (
                  <div key={e.order_id} className="text-xs flex gap-2">
                    <span className="font-mono text-muted-foreground">{e.order_id}</span>
                    <span className="text-red-500">{e.reason}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      )}

      {/* ── Lịch sử đợt quét ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Lịch sử đợt quét</h2>
          <Button variant="ghost" size="sm" onClick={loadHistory} disabled={loadingHistory}>
            <RefreshCw className={`h-4 w-4 ${loadingHistory ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {history.length === 0 && !loadingHistory && (
          <p className="text-sm text-muted-foreground">Chưa có đợt quét nào.</p>
        )}

        <div className="flex flex-col gap-2">
          {history.map(h => (
            <Card key={h.scan_id} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-bold">{h.sheet_name}</span>
                      <Badge variant="outline" className="text-xs">{h.preset_label}</Badge>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>📅 {h.scan_date}</span>
                      <span>🛡 BH {h.warranty_days}d</span>
                      <span>📦 {h.total_qualified} đơn</span>
                      <span className="text-green-600 font-medium">💰 {fmtAmount(h.total_refund)}</span>
                      <span>⏱ {new Date(h.created_at).toLocaleString("vi-VN")}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap flex-shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5" asChild>
                          <a href={h.spreadsheet_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Mở Google Sheet</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5"
                          onClick={() => handleDownload(h.scan_id, "xlsx")}>
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Tải XLSX</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" className="gap-1.5"
                          onClick={() => handleDownload(h.scan_id, "csv")}>
                          <FileText className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Tải CSV</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm" variant="outline"
                          className="text-red-500 hover:text-red-600 hover:border-red-300"
                          onClick={() => handleDelete(h.scan_id)}
                          disabled={deletingId === h.scan_id}
                        >
                          {deletingId === h.scan_id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Xóa đợt quét</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Confirm create sheet dialog ──────────────────────────────────── */}
      <Dialog open={showCreateDlg} onOpenChange={setShowCreateDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xác nhận tạo Google Sheet</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ quét đơn và tạo tab mới trong Spreadsheet. Thao tác này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-sm py-2">
            <span className="text-muted-foreground">Bộ sản phẩm:</span>
            <span className="font-medium">{presetLabel}</span>
            <span className="text-muted-foreground">Ngày tính:</span>
            <span className="font-medium">{scanDate}</span>
            <span className="text-muted-foreground">Thời hạn BH:</span>
            <span className="font-medium">{warrantyDays} ngày</span>
            <span className="text-muted-foreground">Giá hoàn:</span>
            <span className="font-medium">
              {refundMode === "sell_price" ? "Theo giá bán" : `Cố định ${fmtAmount(refundPrice)}`}
            </span>
          </div>
          {previewResult && (
            <div className="flex gap-4 p-3 bg-muted rounded-lg text-sm">
              <div>✅ <strong>{previewResult.stats.total_qualified}</strong> đơn còn BH</div>
              <div>💰 <strong>{fmtAmount(previewResult.stats.total_refund)}</strong></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDlg(false)}>Hủy</Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleCreateSheet}>
              <SheetIcon className="h-4 w-4 mr-1.5" /> Tạo Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
