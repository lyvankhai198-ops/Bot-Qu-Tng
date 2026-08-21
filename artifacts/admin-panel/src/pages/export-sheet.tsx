/**
 * export-sheet.tsx — Xuất file .xlsx từ đơn hàng chợ theo rule lọc
 */
import { useState, useMemo, useRef } from "react"
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
  FileSpreadsheet, Eye, Lightbulb, Search, X, ClipboardCopy, Check,
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
  price:     number
  date:      string
  expiry:    string
  remaining: number
  refund:    number
  accountKey: string
  status: string
  statusLabel: string
  statusUpdatedAt: string
  note: string
}

interface Suggestion {
  seller:    string
  product:   string   // tên đại diện (ngắn nhất trong nhóm)
  keyword:   string
  count:     number
  price:     number
  minRemain: number   // ngày BH còn lại tối thiểu trong nhóm
  warranty:  number   // warranty_days gợi ý (đọc từ tên sản phẩm)
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
function fmtVND(n: number) {
  return n ? n.toLocaleString("vi-VN") : "—"
}

const ACCOUNT_STATUS_OPTIONS = [
  { value: "pending", label: "⏳ Chưa xử lý" },
  { value: "in_progress", label: "🔄 Đang yêu cầu" },
  { value: "warranted", label: "✅ Đã bảo hành" },
  { value: "refunded", label: "💰 Đã hoàn tiền" },
  { value: "rejected", label: "❌ Từ chối" },
]

// ── Main component ─────────────────────────────────────────────────────────────
export default function ExportSheet() {
  const { toast }  = useToast()
  const qc         = useQueryClient()
  const [rules, setRules]     = useState<ExportRule[]>([])
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [dirty, setDirty]     = useState(false)

  // Preview state
  const [preview, setPreview]             = useState<{ rule: ExportRule; rows: PreviewRow[] } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null)
  const [downloading, setDownloading]       = useState<string | null>(null)
  const [copied, setCopied]                 = useState(false)
  const [savingStatus, setSavingStatus]       = useState<string | null>(null)
  const [previewSearch, setPreviewSearch]     = useState("")
  const copyTextareaRef                     = useRef<HTMLTextAreaElement>(null)

  // Suggestions state
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggSearch, setSuggSearch]           = useState("")

  // ── Load config ──────────────────────────────────────────────────────────────
  const { isLoading } = useQuery({
    queryKey: ["export-sheet-config"],
    queryFn: async () => {
      const d = await apiFetch("GET", "/bot/export-sheet/config")
      setRules((d.rules ?? []).map((r: any) => ({ ...r, id: r.id ?? uid() })))
      return d
    },
  })

  // ── Load suggestions ─────────────────────────────────────────────────────────
  const { data: suggData, isLoading: suggLoading, refetch: refetchSugg } = useQuery<{ total: number; suggestions: Suggestion[] }>({
    queryKey: ["export-sheet-suggestions"],
    queryFn: () => apiFetch("GET", "/bot/export-sheet/suggestions"),
    enabled: showSuggestions,
    staleTime: 60_000,
  })

  const filteredSuggestions = useMemo(() => {
    const list = suggData?.suggestions ?? []
    if (!suggSearch.trim()) return list
    // Tách các từ tìm kiếm — mỗi từ phải khớp ít nhất 1 trường (seller / product / keyword)
    const terms = suggSearch.toLowerCase().split(/\s+/).filter(Boolean)
    return list.filter(s => {
      const haystack = [s.seller, s.product, s.keyword].join(" ").toLowerCase()
      return terms.every(t => haystack.includes(t))
    })
  }, [suggData, suggSearch])

  const filteredPreviewRows = useMemo(() => {
    const rows = preview?.rows ?? []
    const query = previewSearch.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(row => [
      row.seller, row.email, row.password, row.twofa,
      row.status, row.statusLabel, row.note,
    ].join(" ").toLowerCase().includes(query))
  }, [preview, previewSearch])

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
  function addRule(prefill?: Partial<ExportRule>) {
    const blank: ExportRule = {
      id: uid(), name: "", sellers: [], include: [], exclude: [], warranty_days: 30,
      ...prefill,
    }
    setRules(prev => {
      const next = [...prev, blank]
      setOpenIdx(next.length - 1)
      return next
    })
    setDirty(true)
  }
  function removeRule(idx: number) {
    setRules(prev => prev.filter((_, i) => i !== idx))
    setOpenIdx(null)
    setDirty(true)
  }

  /** Tạo rule từ suggestion — dùng warranty_days đọc từ tên sản phẩm */
  function createFromSuggestion(s: Suggestion) {
    const name = `${s.seller.replace(/^@/, "")} – ${s.keyword}`
    addRule({ name, sellers: [s.seller], include: [s.keyword], warranty_days: s.warranty || 30 })
    toast({
      title: `✅ Đã tạo rule "${name}"`,
      description: `BH ${s.warranty || 30} ngày · Cuộn xuống để xem và chỉnh sửa.`,
    })
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
      setPreviewSearch("")
      setPreview({ rule, rows: d.rows })
    } catch (e: any) {
      toast({ title: "❌ Lỗi preview", description: e?.message, variant: "destructive" })
    } finally {
      setLoadingPreview(null)
    }
  }

  async function handleStatusChange(row: PreviewRow, status: string) {
    if (!row.accountKey) return
    setSavingStatus(row.accountKey)
    try {
      const d = await apiFetch("PUT", "/bot/export-sheet/status", {
        accountKey: row.accountKey,
        status,
      })
      setPreview(prev => prev ? {
        ...prev,
        rows: prev.rows.map(r => r.accountKey === row.accountKey
          ? { ...r, status: d.status, statusLabel: d.statusLabel, statusUpdatedAt: d.statusUpdatedAt }
          : r),
      } : prev)
      toast({ title: "✅ Đã cập nhật trạng thái tài khoản" })
    } catch (e: any) {
      toast({ title: "❌ Không thể cập nhật trạng thái", description: e?.message, variant: "destructive" })
    } finally {
      setSavingStatus(null)
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

      {/* ── Header ──────────────────────────────────────────────────────────── */}
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

      {/* ── Gợi ý rule ──────────────────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        {/* Header toggle */}
        <div className="flex items-center">
          <button
            className="flex-1 flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left"
            onClick={() => {
              setShowSuggestions(v => !v)
              if (!showSuggestions) refetchSugg()
            }}
          >
            <Lightbulb className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <span className="font-medium text-sm flex-1">
              Gợi ý rule — đơn còn bảo hành
            </span>
            {suggData && !suggLoading && (
              <Badge variant="outline" className="text-xs mr-1 border-emerald-300 text-emerald-700">
                {suggData.total} nhóm còn BH
              </Badge>
            )}
            {showSuggestions
              ? <ChevronDown  className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>

          {/* Nút quét lại */}
          {showSuggestions && (
            <button
              className="flex items-center gap-1 px-3 py-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors border-l"
              disabled={suggLoading}
              onClick={() => refetchSugg()}
              title="Quét lại đơn hàng"
            >
              {suggLoading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Search   className="h-3.5 w-3.5" />}
              <span>Quét lại</span>
            </button>
          )}
        </div>

        {showSuggestions && (
          <div className="border-t bg-muted/10">
            {/* Search — lọc seller VÀ sản phẩm cùng lúc */}
            <div className="p-2 border-b bg-background">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  value={suggSearch}
                  onChange={e => setSuggSearch(e.target.value)}
                  placeholder="Tìm seller và sản phẩm (gõ nhiều từ để lọc cùng lúc)..."
                  className="pl-8 pr-8 h-8 text-sm"
                />
                {suggSearch && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setSuggSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-auto max-h-[420px]">
              {suggLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Đang quét đơn còn bảo hành...
                </div>
              ) : filteredSuggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  {suggSearch ? "Không tìm thấy kết quả." : "Không có đơn nào còn bảo hành."}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Seller</th>
                      <th className="px-2 py-2 text-left font-semibold">Sản phẩm đại diện</th>
                      <th className="px-2 py-2 text-left font-semibold text-emerald-700">Keyword rule</th>
                      <th className="px-2 py-2 text-center font-semibold">Đơn</th>
                      <th className="px-2 py-2 text-right font-semibold">Giá</th>
                      <th className="px-2 py-2 text-center font-semibold">Còn BH</th>
                      <th className="px-2 py-2 text-center font-semibold">Xem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuggestions.map((s, i) => {
                      const tempId = `sugg-${s.seller}-${s.keyword}`
                      const isPrev = loadingPreview === tempId
                      return (
                      <tr
                        key={`${s.seller}|||${s.keyword}`}
                        className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="font-mono text-blue-700 text-[11px]">{s.seller}</span>
                        </td>
                        <td className="px-2 py-1.5 max-w-[180px]">
                          <span className="line-clamp-2 text-[11px] leading-tight text-muted-foreground" title={s.product}>
                            {s.product}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <code className="bg-emerald-50 text-emerald-700 rounded px-1.5 py-0.5 text-[11px] border border-emerald-200">
                            {s.keyword}
                          </code>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Badge variant="secondary" className="text-[10px] h-4">{s.count}</Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap text-[11px]">
                          {s.price ? s.price.toLocaleString("vi-VN") + "đ" : "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center whitespace-nowrap">
                          <span className={
                            s.minRemain <= 3  ? "text-red-600 font-bold" :
                            s.minRemain <= 7  ? "text-orange-500 font-semibold" :
                            s.minRemain <= 14 ? "text-amber-600" :
                            "text-emerald-600"
                          }>
                            {s.minRemain}n
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 text-[11px] px-2 gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                            disabled={isPrev}
                            onClick={() => {
                              const tempRule: ExportRule = {
                                id:            tempId,
                                name:          `${s.seller.replace(/^@/, "")} – ${s.keyword}`,
                                sellers:       [s.seller],
                                include:       [s.keyword],
                                exclude:       [],
                                warranty_days: s.warranty || 30,
                              }
                              handlePreview(tempRule)
                            }}
                          >
                            {isPrev
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Eye     className="h-3 w-3" />}
                            Xem trước
                          </Button>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            {!suggLoading && filteredSuggestions.length > 0 && (
              <div className="px-3 py-1.5 border-t text-[11px] text-muted-foreground bg-background flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                {suggSearch
                  ? `${filteredSuggestions.length} / ${suggData?.total ?? 0} nhóm còn bảo hành`
                  : `${filteredSuggestions.length} nhóm còn bảo hành trong 30 ngày gần nhất`}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Rule list ────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed text-sm">
            Chưa có rule nào. Dùng "Gợi ý" bên trên hoặc bấm "+ Thêm rule" để tạo mới.
          </div>
        )}

        {rules.map((rule, idx) => {
          const isOpen = openIdx === idx
          const isPrev = loadingPreview === rule.id
          const isDl   = downloading === rule.id

          return (
            <div key={rule.id} className="border rounded-lg overflow-hidden bg-card">
              {/* Row header */}
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
                      ⏳{rule.warranty_days}n
                    </Badge>
                  )}
                </div>

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
                      placeholder="vd: mtdpremium – chatgpt plus"
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
                      onBlur={e  => updateRule(idx, { sellers: parseKws(e.target.value) })}
                      placeholder={"@lemonlove24\n@shop_abc"}
                      className="text-sm font-mono min-h-[52px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-green-700">Từ khoá sản phẩm — Bao gồm</span>
                      <span className="text-muted-foreground font-normal ml-1">— mỗi dòng 1 từ khóa</span>
                    </Label>
                    <Textarea
                      value={rule.include.join("\n")}
                      onChange={e => updateRule(idx, { include: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e  => updateRule(idx, { include: parseKws(e.target.value) })}
                      placeholder={"chatgpt plus"}
                      className="text-sm font-mono min-h-[52px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldX className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">Từ khoá — Loại trừ</span>
                    </Label>
                    <Textarea
                      value={rule.exclude.join("\n")}
                      onChange={e => updateRule(idx, { exclude: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e  => updateRule(idx, { exclude: parseKws(e.target.value) })}
                      placeholder={"api\nkbh"}
                      className="text-sm font-mono min-h-[44px] resize-y" rows={2}
                    />
                  </div>

                  <div className="space-y-1.5 pt-1 border-t">
                    <Label className="text-xs font-medium">⏳ Ngày bảo hành (0 = lấy tất cả)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={0}
                        value={rule.warranty_days}
                        onChange={e => updateRule(idx, { warranty_days: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="text-sm w-28 h-8" placeholder="30"
                      />
                      <span className="text-xs text-muted-foreground">
                        {rule.warranty_days > 0
                          ? `Lấy đơn mua trong vòng ${rule.warranty_days} ngày gần đây`
                          : "Không lọc theo ngày"}
                      </span>
                    </div>
                  </div>

                  {/* Quick download from expanded rule */}
                  <div className="pt-1 flex gap-2">
                    <Button
                      size="sm"
                      className="gap-1.5 bg-green-600 hover:bg-green-700 flex-1"
                      disabled={isDl || isPrev}
                      onClick={() => handleDownload(rule)}
                    >
                      {isDl
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Download className="h-3.5 w-3.5" />}
                      Tải .xlsx ngay
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Button variant="outline" className="w-full gap-2" onClick={() => addRule()}>
        <Plus className="h-4 w-4" /> Thêm rule thủ công
      </Button>

      {/* ── Preview Dialog ─────────────────────────────────────────────────────── */}
      <Dialog open={!!preview} onOpenChange={open => { if (!open) { setPreview(null); setCopied(false) } }}>
        <DialogContent className="max-w-6xl max-h-[90vh] flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="px-4 pt-4 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{preview?.rule.name || "Xem trước"}</span>
              <Badge className="ml-auto flex-shrink-0">{preview?.rows.length ?? 0} dòng</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 py-2 border-b bg-background">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={previewSearch}
                onChange={e => setPreviewSearch(e.target.value)}
                placeholder="Tìm email, mật khẩu, 2FA hoặc trạng thái..."
                className="h-9 pl-9 pr-9 text-sm"
              />
              {previewSearch && (
                <button
                  type="button"
                  aria-label="Xóa tìm kiếm"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setPreviewSearch("")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {previewSearch && (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Hiển thị {filteredPreviewRows.length}/{preview?.rows.length ?? 0} tài khoản
              </div>
            )}
          </div>

          {/* Table — chỉ email / pass / 2fa, hiện full không ẩn */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground w-6">#</th>
                  <th className="px-2 py-2 text-left font-semibold">Email</th>
                  <th className="px-2 py-2 text-left font-semibold">Mật khẩu</th>
                  <th className="px-2 py-2 text-left font-semibold">2FA</th>
                  <th className="px-2 py-2 text-left font-semibold">Trạng thái xử lý</th>
                  <th className="px-2 py-2 text-left font-semibold">Ngày cập nhật</th>
                </tr>
              </thead>
              <tbody>
                {filteredPreviewRows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
                    <td className="px-2 py-1.5 text-muted-foreground text-[10px]">{i + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-[11px] break-all">
                      {row.email || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] break-all">
                      {row.password || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono text-[11px] break-all text-muted-foreground">
                      {row.twofa || <span className="italic">—</span>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <select
                        value={row.status || "pending"}
                        disabled={!row.accountKey || savingStatus === row.accountKey}
                        onChange={e => handleStatusChange(row, e.target.value)}
                        className="h-7 rounded border bg-background px-1.5 text-[11px]"
                        title="Cập nhật trạng thái tài khoản"
                      >
                        {ACCOUNT_STATUS_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                      {row.statusUpdatedAt ? new Date(row.statusUpdatedAt).toLocaleDateString("vi-VN") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Textarea visible — nguồn copy thật, iOS/Android select được */}
          {(() => {
            const text = (preview?.rows ?? [])
              .map(r => [r.email, r.password, r.twofa].filter(Boolean).join(" | "))
              .join("\n")
            return (
              <textarea
                ref={copyTextareaRef}
                readOnly
                value={text}
                rows={3}
                className="mx-4 mt-2 text-xs font-mono border rounded p-2 resize-none bg-muted/30 text-foreground leading-relaxed"
                style={{ minHeight: 64, maxHeight: 100 }}
                onFocus={e => {
                  e.currentTarget.select()
                  e.currentTarget.setSelectionRange(0, text.length)
                }}
              />
            )
          })()}

          {/* Footer */}
          <div className="flex flex-col gap-2 px-4 py-3 border-t bg-background">
            {/* Copy tất cả — select textarea visible rồi execCommand */}
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => {
                const ta = copyTextareaRef.current
                if (!ta) return
                ta.focus()
                ta.select()
                ta.setSelectionRange(0, ta.value.length)
                let ok = false
                try { ok = document.execCommand("copy") } catch {}
                // Backup: Clipboard API nếu có HTTPS
                if (!ok) navigator.clipboard?.writeText?.(ta.value).catch(() => {})
                setCopied(true)
                setTimeout(() => setCopied(false), 2500)
              }}
            >
              {copied
                ? <><Check className="h-4 w-4 text-emerald-600" /> Đã copy!</>
                : <><ClipboardCopy className="h-4 w-4" /> Copy tất cả ({preview?.rows.length ?? 0} dòng)</>}
            </Button>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setPreview(null); setCopied(false) }}>
                Đóng
              </Button>
              <Button
                className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
                disabled={!!downloading}
                onClick={() => preview && handleDownload(preview.rule)}
              >
                {downloading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                Tải .xlsx
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
