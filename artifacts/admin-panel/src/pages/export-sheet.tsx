/**
 * export-sheet.tsx — Xuất file .xlsx từ đơn hàng chợ theo rule lọc
 */
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label }    from "@/components/ui/label"
import { Badge }    from "@/components/ui/badge"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useToast }  from "@/hooks/use-toast"
import {
  Plus, Trash2, Save, Loader2, Download,
  ShieldCheck, ShieldX, User, ChevronDown, ChevronRight,
  FileSpreadsheet, Eye,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────
interface ExportRule {
  id:            string
  name:          string
  sellers:       string[]
  include:       string[]
  exclude:       string[]
  warranty_days: number
}

interface PreviewRow {
  seller:    string
  email:     string
  password:  string
  twofa:     string
  price:     number        // giá mua sau -3%
  date:      string        // ngày mua DD/MM/YYYY
  expiry:    string        // hết hạn BH DD/MM/YYYY
  remaining: number        // ngày còn lại
  refund:    number        // tiền hoàn
}

// ── Auth helpers ───────────────────────────────────────────────────────────────
function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = { method, headers: { ...authHeader(), "Content-Type": "application/json" } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
async function apiFetchRaw(method: string, path: string, body?: unknown): Promise<Response> {
  const opts: RequestInit = { method, headers: { ...authHeader(), "Content-Type": "application/json" } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  return fetch(`/api${path}`, opts)
}

function uid() { return Math.random().toString(36).slice(2, 9) }
function parseKws(raw: string): string[] {
  return raw.split(/\n|,/).map(s => s.trim()).filter(Boolean)
}
function maskPass(s: string) {
  if (!s) return "—"
  if (s.length <= 4) return "••••"
  return s.slice(0, 2) + "••••" + s.slice(-2)
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ExportSheet() {
  const { toast }  = useToast()
  const qc         = useQueryClient()
  const [rules, setRules]     = useState<ExportRule[]>([])
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [dirty, setDirty]     = useState(false)

  // Preview state
  const [preview, setPreview] = useState<{ rule: ExportRule; rows: PreviewRow[] } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null)
  const [downloading, setDownloading]       = useState<string | null>(null)

  // ── Load config ──────────────────────────────────────────────────────────────
  const { isLoading } = useQuery({
    queryKey: ["export-sheet-config"],
    queryFn: async () => {
      const d = await apiFetch("GET", "/bot/export-sheet/config")
      setRules((d.rules ?? []).map((r: any) => ({ ...r, id: r.id ?? uid() })))
      return d
    },
  })

  // ── Save config ──────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: () => apiFetch("PUT", "/bot/export-sheet/config", { rules }),
    onSuccess: () => {
      toast({ title: "✅ Đã lưu cấu hình" })
      setDirty(false)
      qc.invalidateQueries({ queryKey: ["export-sheet-config"] })
    },
    onError: () => toast({ title: "❌ Lưu thất bại", variant: "destructive" }),
  })

  function updateRule(idx: number, patch: Partial<ExportRule>) {
    setRules(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
    setDirty(true)
  }
  function addRule() {
    const blank: ExportRule = { id: uid(), name: "", sellers: [], include: [], exclude: [], warranty_days: 0 }
    setRules(prev => [...prev, blank])
    setOpenIdx(rules.length)
    setDirty(true)
  }
  function removeRule(idx: number) {
    setRules(prev => prev.filter((_, i) => i !== idx))
    setOpenIdx(null)
    setDirty(true)
  }

  // ── Preview ───────────────────────────────────────────────────────────────────
  async function handlePreview(rule: ExportRule) {
    setLoadingPreview(rule.id)
    try {
      const d = await apiFetch("POST", "/bot/export-sheet/preview", {
        sellers: rule.sellers, include: rule.include,
        exclude: rule.exclude, warranty_days: rule.warranty_days,
      })
      if (!d.total) {
        toast({ title: "Không có đơn nào khớp rule này.", variant: "destructive" })
        return
      }
      setPreview({ rule, rows: d.rows })
    } catch (e: any) {
      toast({ title: "❌ Lỗi preview", description: e?.message, variant: "destructive" })
    } finally {
      setLoadingPreview(null)
    }
  }

  // ── Download xlsx ─────────────────────────────────────────────────────────────
  async function handleDownload(rule: ExportRule) {
    setDownloading(rule.id)
    try {
      const res = await apiFetchRaw("POST", "/bot/export-sheet/download", {
        name: rule.name || "export",
        sellers: rule.sellers, include: rule.include,
        exclude: rule.exclude, warranty_days: rule.warranty_days,
      })
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("json")) {
        const d = await res.json()
        toast({ title: d.message ?? "Không có đơn nào khớp.", variant: "destructive" })
        return
      }
      const blob    = await res.blob()
      const cd      = res.headers.get("content-disposition") ?? ""
      const fnMatch = cd.match(/filename="([^"]+)"/)
      const filename = fnMatch ? fnMatch[1] : `${rule.name || "export"}.xlsx`
      const url = URL.createObjectURL(blob)
      const a   = document.createElement("a")
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      toast({ title: `✅ Đã tải: ${filename}` })
      setPreview(null)
    } catch (e: any) {
      toast({ title: "❌ Lỗi tạo file", description: e?.message, variant: "destructive" })
    } finally {
      setDownloading(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-green-600" />
            Xuất Sheet từ Đơn Chợ
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Lọc đơn → xem trước → tải file .xlsx
          </p>
        </div>
        <Button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          size="sm" className="gap-1.5"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Lưu cấu hình
        </Button>
      </div>

      {/* Rule list */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed text-sm">
            Chưa có rule nào. Bấm "+ Thêm rule" để tạo mới.
          </div>
        )}

        {rules.map((rule, idx) => {
          const isOpen    = openIdx === idx
          const isPrev    = loadingPreview === rule.id
          const isDl      = downloading === rule.id

          return (
            <div key={rule.id} className="border rounded-lg overflow-hidden bg-card">
              {/* Header */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
              >
                {isOpen
                  ? <ChevronDown  className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}

                <span className="font-medium text-sm flex-1 truncate">
                  {rule.name || <span className="text-muted-foreground italic">Chưa đặt tên</span>}
                </span>

                {/* Badges */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {rule.sellers.length > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 text-blue-700 border-blue-300">
                      <User className="h-3 w-3" />{rule.sellers.length}
                    </Badge>
                  )}
                  {rule.include.length > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 text-green-700 border-green-300">
                      <ShieldCheck className="h-3 w-3" />{rule.include.length}
                    </Badge>
                  )}
                  {rule.exclude.length > 0 && (
                    <Badge variant="outline" className="text-xs gap-1 text-destructive border-destructive/30">
                      <ShieldX className="h-3 w-3" />{rule.exclude.length}
                    </Badge>
                  )}
                  {rule.warranty_days > 0 && (
                    <Badge variant="outline" className="text-xs text-orange-700 border-orange-300">
                      ⏳{rule.warranty_days}d
                    </Badge>
                  )}
                </div>

                {/* Nút Xem trước */}
                <Button
                  size="sm" variant="outline"
                  className="gap-1 h-7 text-xs ml-1"
                  disabled={isPrev || isDl}
                  onClick={e => { e.stopPropagation(); handlePreview(rule) }}
                >
                  {isPrev ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                  Xem trước
                </Button>

                <Button
                  size="icon" variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={e => { e.stopPropagation(); removeRule(idx) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Body */}
              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                  <div className="pt-3 space-y-1.5">
                    <Label className="text-xs font-medium">Tên rule (dùng làm tên file .xlsx)</Label>
                    <Input
                      value={rule.name}
                      onChange={e => updateRule(idx, { name: e.target.value })}
                      placeholder="vd: ChatGPT Plus lemonlove24"
                      className="text-sm"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-blue-700">Người bán</span>
                      <span className="text-muted-foreground font-normal ml-1">— mỗi dòng 1 username, trống = tất cả</span>
                    </Label>
                    <Textarea
                      value={rule.sellers.join("\n")}
                      onChange={e => updateRule(idx, { sellers: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { sellers: parseKws(e.target.value) })}
                      placeholder={"@lemonlove24\n@shop_abc"}
                      className="text-sm font-mono min-h-[52px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-green-700">Tên SP — Bao gồm</span>
                      <span className="text-muted-foreground font-normal ml-1">— một từ khóa mỗi dòng</span>
                    </Label>
                    <Textarea
                      value={rule.include.join("\n")}
                      onChange={e => updateRule(idx, { include: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { include: parseKws(e.target.value) })}
                      placeholder={"chatgpt plus"}
                      className="text-sm font-mono min-h-[52px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldX className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">Tên SP — Loại trừ</span>
                    </Label>
                    <Textarea
                      value={rule.exclude.join("\n")}
                      onChange={e => updateRule(idx, { exclude: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { exclude: parseKws(e.target.value) })}
                      placeholder={"api\ntoken"}
                      className="text-sm font-mono min-h-[44px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5 pt-1 border-t">
                    <Label className="text-xs font-medium">⏳ Tổng ngày bảo hành (0 = lấy tất cả)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={0}
                        value={rule.warranty_days}
                        onChange={e => updateRule(idx, { warranty_days: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="text-sm w-28 h-8" placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground">
                        {rule.warranty_days > 0
                          ? `Chỉ lấy đơn trong vòng ${rule.warranty_days} ngày gần đây`
                          : "Không lọc BH"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Button variant="outline" className="w-full gap-2" onClick={addRule}>
        <Plus className="h-4 w-4" /> Thêm rule
      </Button>

      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Cột trong file .xlsx:</p>
        <p>Email · Mật khẩu · 2FA · Ngày mua · Giá mua (VNĐ)</p>
      </div>

      {/* ── Preview Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={!!preview} onOpenChange={open => !open && setPreview(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Xem trước — {preview?.rule.name || "export"}
              <Badge className="ml-1">{preview?.rows.length ?? 0} đơn</Badge>
            </DialogTitle>
          </DialogHeader>

          {/* Table */}
          <div className="flex-1 overflow-auto border rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">#</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Seller</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Email</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Mật khẩu</th>
                  <th className="px-2 py-1.5 text-left font-semibold">2FA</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Giá mua</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Ngày mua</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Hết hạn BH</th>
                  <th className="px-2 py-1.5 text-center font-semibold">Còn lại</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Tiền hoàn</th>
                </tr>
              </thead>
              <tbody>
                {preview?.rows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1 text-[11px] truncate max-w-[100px]" title={row.seller}>
                      {row.seller || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-2 py-1 font-mono max-w-[180px] truncate" title={row.email}>
                      {row.email || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{maskPass(row.password)}</td>
                    <td className="px-2 py-1 font-mono max-w-[120px] truncate text-muted-foreground" title={row.twofa}>
                      {row.twofa ? maskPass(row.twofa) : <span className="italic">—</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                      {row.price ? row.price.toLocaleString("vi-VN") : "—"}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">{row.date || "—"}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{row.expiry || "—"}</td>
                    <td className="px-2 py-1 text-center">
                      <span className={
                        row.remaining <= 0 ? "text-red-500 font-semibold" :
                        row.remaining <= 7 ? "text-orange-500 font-semibold" :
                        "text-emerald-600"
                      }>
                        {row.remaining}n
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-semibold text-emerald-700">
                      {row.refund ? row.refund.toLocaleString("vi-VN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setPreview(null)}>Đóng</Button>
            <Button
              className="gap-2 bg-green-600 hover:bg-green-700"
              disabled={!!downloading}
              onClick={() => preview && handleDownload(preview.rule)}
            >
              {downloading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              Tải file .xlsx ({preview?.rows.length ?? 0} đơn)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
