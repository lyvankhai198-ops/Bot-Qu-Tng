/**
 * export-sheet.tsx — Xuất file .xlsx từ đơn hàng chợ theo rule lọc
 */
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Button }    from "@/components/ui/button"
import { Input }     from "@/components/ui/input"
import { Textarea }  from "@/components/ui/textarea"
import { Label }     from "@/components/ui/label"
import { Badge }     from "@/components/ui/badge"
import { useToast }  from "@/hooks/use-toast"
import {
  Plus, Trash2, Save, Loader2, Download,
  ShieldCheck, ShieldX, User, ChevronDown, ChevronRight, FileSpreadsheet,
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

// ── Main component ─────────────────────────────────────────────────────────────
export default function ExportSheet() {
  const { toast }  = useToast()
  const qc         = useQueryClient()
  const [rules, setRules]     = useState<ExportRule[]>([])
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [dirty, setDirty]     = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)   // rule id đang tạo

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
    mutationFn: () =>
      apiFetch("PUT", "/bot/export-sheet/config", { rules }),
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
    const blank: ExportRule = {
      id: uid(), name: "", sellers: [], include: [], exclude: [], warranty_days: 0,
    }
    setRules(prev => [...prev, blank])
    setOpenIdx(rules.length)
    setDirty(true)
  }

  function removeRule(idx: number) {
    setRules(prev => prev.filter((_, i) => i !== idx))
    setOpenIdx(null)
    setDirty(true)
  }

  // ── Download xlsx ─────────────────────────────────────────────────────────────
  async function handleDownload(rule: ExportRule) {
    setDownloading(rule.id)
    try {
      const res = await apiFetchRaw("POST", "/bot/export-sheet/download", {
        name:          rule.name || "export",
        sellers:       rule.sellers,
        include:       rule.include,
        exclude:       rule.exclude,
        warranty_days: rule.warranty_days,
      })

      // Kiểm tra content-type — nếu là JSON thì là thông báo lỗi
      const ct = res.headers.get("content-type") ?? ""
      if (ct.includes("json")) {
        const d = await res.json()
        toast({ title: d.message ?? "Không có đơn nào khớp rule.", variant: "destructive" })
        return
      }

      // Tải file
      const blob     = await res.blob()
      const cd       = res.headers.get("content-disposition") ?? ""
      const fnMatch  = cd.match(/filename="([^"]+)"/)
      const filename = fnMatch ? fnMatch[1] : `${rule.name || "export"}.xlsx`

      const url = URL.createObjectURL(blob)
      const a   = document.createElement("a")
      a.href    = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: `✅ Đã tạo: ${filename}` })
    } catch (e: any) {
      toast({ title: "❌ Lỗi tạo file", description: e?.message, variant: "destructive" })
    } finally {
      setDownloading(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
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
            Lọc đơn theo người bán + từ khóa sản phẩm + bảo hành → tải file .xlsx
          </p>
        </div>
        <Button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          size="sm"
          className="gap-1.5"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Lưu cấu hình
        </Button>
      </div>

      {/* Danh sách rule */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-center py-10 text-muted-foreground border rounded-lg border-dashed text-sm">
            Chưa có rule nào. Bấm "+ Thêm rule" để tạo mới.
          </div>
        )}

        {rules.map((rule, idx) => {
          const isOpen = openIdx === idx
          const isLoading = downloading === rule.id
          return (
            <div key={rule.id} className="border rounded-lg overflow-hidden bg-card">
              {/* Rule header */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setOpenIdx(isOpen ? null : idx)}
              >
                {isOpen
                  ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}

                <span className="font-medium text-sm flex-1 truncate">
                  {rule.name || <span className="text-muted-foreground italic">Chưa đặt tên</span>}
                </span>

                {/* Badges */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
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
                    <Badge variant="outline" className="text-xs gap-1 text-orange-700 border-orange-300">
                      ⏳{rule.warranty_days}d
                    </Badge>
                  )}
                </div>

                {/* Nút Tạo Sheet */}
                <Button
                  size="sm"
                  variant="default"
                  className="gap-1.5 h-7 text-xs ml-1 bg-green-600 hover:bg-green-700"
                  disabled={isLoading}
                  onClick={e => { e.stopPropagation(); handleDownload(rule) }}
                >
                  {isLoading
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Download className="h-3.5 w-3.5" />}
                  Tạo Sheet
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={e => { e.stopPropagation(); removeRule(idx) }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Rule body */}
              {isOpen && (
                <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                  {/* Tên rule */}
                  <div className="pt-3 space-y-1.5">
                    <Label className="text-xs font-medium">Tên rule (dùng làm tên file)</Label>
                    <Input
                      value={rule.name}
                      onChange={e => updateRule(idx, { name: e.target.value })}
                      placeholder="vd: ChatGPT Plus lemonlove24"
                      className="text-sm"
                    />
                  </div>

                  {/* Người bán */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-blue-600" />
                      <span className="text-blue-700">Người bán</span>
                      <span className="text-muted-foreground font-normal ml-1">— mỗi username một dòng, để trống = tất cả</span>
                    </Label>
                    <Textarea
                      value={rule.sellers.join("\n")}
                      onChange={e => updateRule(idx, { sellers: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { sellers: parseKws(e.target.value) })}
                      placeholder={"@lemonlove24\n@shop_abc"}
                      className="text-sm font-mono min-h-[56px] resize-y"
                      rows={2}
                    />
                  </div>

                  {/* Tên sản phẩm bao gồm */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-green-700">Tên sản phẩm — Bao gồm</span>
                      <span className="text-muted-foreground font-normal ml-1">— một từ khóa mỗi dòng</span>
                    </Label>
                    <Textarea
                      value={rule.include.join("\n")}
                      onChange={e => updateRule(idx, { include: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { include: parseKws(e.target.value) })}
                      placeholder={"chatgpt plus\ngpt plus"}
                      className="text-sm font-mono min-h-[56px] resize-y"
                      rows={2}
                    />
                  </div>

                  {/* Tên sản phẩm loại trừ */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1">
                      <ShieldX className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">Tên sản phẩm — Loại trừ</span>
                      <span className="text-muted-foreground font-normal ml-1">— bỏ qua nếu có từ này</span>
                    </Label>
                    <Textarea
                      value={rule.exclude.join("\n")}
                      onChange={e => updateRule(idx, { exclude: parseKws(e.target.value.replace(/,/g, "\n")) })}
                      onBlur={e => updateRule(idx, { exclude: parseKws(e.target.value) })}
                      placeholder={"api\ntoken"}
                      className="text-sm font-mono min-h-[44px] resize-y"
                      rows={2}
                    />
                  </div>

                  {/* Bảo hành */}
                  <div className="space-y-1.5 pt-1 border-t">
                    <Label className="text-xs font-medium">⏳ Tổng ngày bảo hành (0 = lấy tất cả)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number" min={0}
                        value={rule.warranty_days}
                        onChange={e => updateRule(idx, { warranty_days: Math.max(0, parseInt(e.target.value) || 0) })}
                        className="text-sm w-28 h-8"
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground">
                        {rule.warranty_days > 0
                          ? `Chỉ lấy đơn mua trong vòng ${rule.warranty_days} ngày gần đây`
                          : "Không lọc BH — lấy tất cả đơn khớp"}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Nút thêm rule */}
      <Button variant="outline" className="w-full gap-2" onClick={addRule}>
        <Plus className="h-4 w-4" />
        Thêm rule
      </Button>

      {/* Ghi chú cột */}
      <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Cột trong file .xlsx xuất ra:</p>
        <p>Email · Mật khẩu · 2FA · Ngày mua · Giá mua (VNĐ)</p>
        <p>Dữ liệu email/mật khẩu/2FA lấy từ trường <code className="font-mono bg-muted px-1 rounded">content</code> của đơn hàng chợ.</p>
      </div>
    </div>
  )
}
