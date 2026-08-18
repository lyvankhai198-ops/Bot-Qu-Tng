/**
 * product-guides.tsx — Quản lý hướng dẫn sản phẩm + Quét tự động từ đơn hàng
 */
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import {
  BookOpen, Plus, Trash2, Pencil, X, Save, ChevronDown, ChevronUp,
  Search, CheckCircle2, AlertCircle, HelpCircle, Tags, Loader2,
  ShieldCheck, ArrowRight, RotateCcw,
} from "lucide-react"

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")
const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}`,
  "Content-Type": "application/json",
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductGuide {
  id: string
  product: string
  aliases?: string[]
  title?: string
  activation_guide?: string
  usage_guide?: string
  error_guide?: string
  warranty_guide?: string
  refund_note?: string
  enabled: boolean
  warranty_variants?: string[]
  confidence?: number
  confidence_level?: string
  updated_at?: string
  created_at?: string
}

interface ProductNameStat {
  name: string
  count: number
  warrantyPattern: string | null
  baseName: string
}

interface FamilySuggestion {
  suggestedName: string
  confidence: number
  confidenceLevel: "HIGH" | "MEDIUM" | "LOW"
  members: ProductNameStat[]
  warrantyVariants: string[]
  existingGuideId: string | null
  existingGuideName: string | null
  newAliases: string[]
}

interface ScanResult {
  stats: {
    ordersScanned: number
    uniqueNames: number
    familiesFound: number
    highConfidence: number
    mediumConfidence: number
    lowConfidence: number
    unclassified: number
    guidesNew: number
    aliasesNew: number
  }
  families: FamilySuggestion[]
  unclassified: Array<{ name: string; count: number; reason: string }>
  productStats: ProductNameStat[]
  scanTime: string
}

// ─── Sub-components ──────────────────────────────────────────────────────────

const CONF_CONFIG = {
  HIGH:   { color: "bg-green-500/10 text-green-700 border-green-300",  dot: "bg-green-500",  icon: CheckCircle2, label: "HIGH" },
  MEDIUM: { color: "bg-yellow-500/10 text-yellow-700 border-yellow-300", dot: "bg-yellow-500", icon: AlertCircle, label: "MEDIUM" },
  LOW:    { color: "bg-red-500/10 text-red-700 border-red-300",        dot: "bg-red-500",    icon: HelpCircle, label: "LOW" },
}

function ConfBadge({ level, confidence }: { level: "HIGH" | "MEDIUM" | "LOW"; confidence: number }) {
  const cfg = CONF_CONFIG[level]
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.color}`}>
      <Icon className="h-3.5 w-3.5" />
      {cfg.label} — {confidence}%
    </span>
  )
}

// ─── Scan result family card ─────────────────────────────────────────────────

function FamilyCard({
  family,
  selected,
  onToggle,
  index,
}: {
  family: FamilySuggestion
  selected: boolean
  onToggle: () => void
  index: number
}) {
  const [expanded, setExpanded] = useState(false)
  const isExisting = !!family.existingGuideId
  const allAliases = family.members.map(m => m.name)

  return (
    <Card className={`transition-all border-2 ${selected ? "border-primary/50 bg-primary/5" : "border-transparent"}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-1 h-4 w-4 rounded accent-primary cursor-pointer"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <ConfBadge level={family.confidenceLevel} confidence={family.confidence} />
              {isExisting ? (
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300">
                  <ShieldCheck className="h-3 w-3 mr-1" />
                  Đã có Guide: {family.existingGuideName}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs bg-purple-50 text-purple-700 border-purple-300">
                  <Plus className="h-3 w-3 mr-1" />
                  Guide mới
                </Badge>
              )}
            </div>
            <CardTitle className="text-base">
              {isExisting ? (
                <span className="flex items-center gap-2">
                  <span>{family.existingGuideName}</span>
                  {family.newAliases.length > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      +{family.newAliases.length} alias mới
                    </span>
                  )}
                </span>
              ) : (
                family.suggestedName
              )}
            </CardTitle>
            {family.warrantyVariants.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Biến thể warranty: {family.warrantyVariants.join(", ")}
              </p>
            )}
          </div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 border-t">
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Tags className="h-3.5 w-3.5" />
                Tên sản phẩm trong đơn hàng ({allAliases.length})
              </p>
              <div className="space-y-1">
                {family.members.map(m => (
                  <div key={m.name} className="flex items-center justify-between text-sm bg-muted/40 rounded px-3 py-1.5">
                    <span className="font-mono text-xs">{m.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {m.warrantyPattern && (
                        <Badge variant="outline" className="text-xs">{m.warrantyPattern}</Badge>
                      )}
                      <span className="text-muted-foreground text-xs">{m.count} đơn</span>
                      {isExisting && !family.newAliases.includes(m.name) && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" title="Đã có trong guide" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {isExisting && family.newAliases.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-1">
                  Aliases sẽ được thêm vào guide hiện tại:
                </p>
                <div className="flex flex-wrap gap-1">
                  {family.newAliases.map(a => (
                    <Badge key={a} variant="outline" className="text-xs bg-yellow-50 border-yellow-300">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ─── Scan view ────────────────────────────────────────────────────────────────

function ScanView({
  result,
  onClose,
  onApplied,
}: {
  result: ScanResult
  onClose: () => void
  onApplied: () => void
}) {
  const { toast } = useToast()
  const [selected, setSelected] = useState<Set<number>>(() => {
    const s = new Set<number>()
    result.families.forEach((f, i) => { if (f.confidenceLevel === "HIGH") s.add(i) })
    return s
  })
  const [showUnclassified, setShowUnclassified] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [applying, setApplying] = useState(false)

  const toggle = (i: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  })

  const selectAll = (level?: string) => setSelected(prev => {
    const next = new Set(prev)
    result.families.forEach((f, i) => {
      if (!level || f.confidenceLevel === level) next.add(i)
    })
    return next
  })

  const deselectAll = () => setSelected(new Set())

  const handleApply = async () => {
    if (selected.size === 0) {
      toast({ title: "⚠️ Chưa chọn mục nào", variant: "destructive" })
      return
    }
    setApplying(true)
    try {
      const items = [...selected].map(i => {
        const f = result.families[i]
        return {
          suggestedName: f.suggestedName,
          aliases: f.members.map(m => m.name),
          warrantyVariants: f.warrantyVariants,
          confidence: f.confidence,
          confidenceLevel: f.confidenceLevel,
          existingGuideId: f.existingGuideId,
        }
      })
      const res = await fetch(`${BASE}/api/bot/product-guides/scan/apply`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Áp dụng thất bại")
      }
      const r = await res.json()
      toast({
        title: "✅ Áp dụng thành công",
        description: `Tạo mới: ${r.created} · Cập nhật: ${r.updated} · Bỏ qua: ${r.skipped}`,
      })
      onApplied()
    } catch (e: any) {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setApplying(false)
    }
  }

  const { stats, families, unclassified } = result
  const highFamilies   = families.filter(f => f.confidenceLevel === "HIGH")
  const medFamilies    = families.filter(f => f.confidenceLevel === "MEDIUM")
  const lowFamilies    = families.filter(f => f.confidenceLevel === "LOW")

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Kết quả quét sản phẩm</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {new Date(result.scanTime).toLocaleString("vi-VN")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose} className="gap-2 shrink-0">
          <RotateCcw className="h-4 w-4" />
          Quay lại
        </Button>
      </div>

      {/* Summary stats */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Tổng kết
            </CardTitle>
            <button onClick={() => setShowStats(e => !e)} className="text-muted-foreground text-xs flex items-center gap-1">
              {showStats ? "Ẩn chi tiết" : "Xem chi tiết"}
              {showStats ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Đơn đã quét", value: stats.ordersScanned.toLocaleString(), sub: "" },
              { label: "Tên SP tìm thấy", value: stats.uniqueNames, sub: `${stats.familiesFound} nhóm` },
              { label: "Guide mới", value: stats.guidesNew, sub: `${stats.aliasesNew} alias mới` },
              { label: "Không xác định", value: stats.unclassified, sub: "cần kiểm tra" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
                {sub && <p className="text-xs text-muted-foreground/60">{sub}</p>}
              </div>
            ))}
          </div>
          {showStats && (
            <div className="mt-3 flex flex-wrap gap-2 pt-3 border-t">
              <ConfBadge level="HIGH"   confidence={0} /> <span className="text-sm self-center">{stats.highConfidence} nhóm</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <ConfBadge level="MEDIUM" confidence={0} /> <span className="text-sm self-center">{stats.mediumConfidence} nhóm</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <ConfBadge level="LOW"    confidence={0} /> <span className="text-sm self-center">{stats.lowConfidence} nhóm</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 justify-between bg-muted/30 rounded-lg px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => selectAll("HIGH")} className="text-xs">
            ✅ Chọn tất cả HIGH
          </Button>
          <Button size="sm" variant="outline" onClick={() => selectAll()} className="text-xs">
            Chọn tất cả
          </Button>
          <Button size="sm" variant="ghost" onClick={deselectAll} className="text-xs">
            Bỏ chọn
          </Button>
        </div>
        <Button
          onClick={handleApply}
          disabled={applying || selected.size === 0}
          className="gap-2"
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {applying ? "Đang áp dụng..." : `Áp dụng ${selected.size} mục đã chọn`}
        </Button>
      </div>

      {/* HIGH confidence */}
      {highFamilies.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <h2 className="font-semibold">HIGH Confidence ({highFamilies.length})</h2>
            <span className="text-xs text-muted-foreground">— Được chọn tự động</span>
          </div>
          {highFamilies.map((f, localIdx) => {
            const globalIdx = families.indexOf(f)
            return (
              <FamilyCard
                key={`${f.suggestedName}-${localIdx}`}
                family={f}
                selected={selected.has(globalIdx)}
                onToggle={() => toggle(globalIdx)}
                index={globalIdx}
              />
            )
          })}
        </div>
      )}

      {/* MEDIUM confidence */}
      {medFamilies.length > 0 && (
        <div className="space-y-3">
          <Separator />
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <h2 className="font-semibold">MEDIUM Confidence ({medFamilies.length})</h2>
            <span className="text-xs text-muted-foreground">— Cần Admin kiểm tra</span>
          </div>
          {medFamilies.map((f, localIdx) => {
            const globalIdx = families.indexOf(f)
            return (
              <FamilyCard
                key={`${f.suggestedName}-${localIdx}`}
                family={f}
                selected={selected.has(globalIdx)}
                onToggle={() => toggle(globalIdx)}
                index={globalIdx}
              />
            )
          })}
        </div>
      )}

      {/* LOW confidence */}
      {lowFamilies.length > 0 && (
        <div className="space-y-3">
          <Separator />
          <div className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-red-500" />
            <h2 className="font-semibold">LOW Confidence ({lowFamilies.length})</h2>
            <span className="text-xs text-muted-foreground">— Chỉ xem, không tự áp dụng</span>
          </div>
          {lowFamilies.map((f, localIdx) => {
            const globalIdx = families.indexOf(f)
            return (
              <FamilyCard
                key={`${f.suggestedName}-${localIdx}`}
                family={f}
                selected={selected.has(globalIdx)}
                onToggle={() => toggle(globalIdx)}
                index={globalIdx}
              />
            )
          })}
        </div>
      )}

      {/* Unclassified */}
      {unclassified.length > 0 && (
        <div className="space-y-2">
          <Separator />
          <button
            onClick={() => setShowUnclassified(e => !e)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground w-full"
          >
            <HelpCircle className="h-4 w-4" />
            Không xác định ({unclassified.length} tên)
            {showUnclassified ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
          </button>
          {showUnclassified && (
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-1">
                  {unclassified.map(u => (
                    <div key={u.name} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                      <span className="font-mono text-xs text-muted-foreground">{u.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{u.count} đơn</span>
                        <Badge variant="outline" className="text-xs">{u.reason}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Bottom apply button */}
      <div className="flex justify-end pt-2 pb-6">
        <Button
          onClick={handleApply}
          disabled={applying || selected.size === 0}
          size="lg"
          className="gap-2"
        >
          {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {applying ? "Đang áp dụng..." : `Áp dụng ${selected.size} mục đã chọn`}
        </Button>
      </div>
    </div>
  )
}

// ─── Scan progress steps ──────────────────────────────────────────────────────

const SCAN_STEPS = [
  "Đang quét đơn hàng...",
  "Đang phân tích tên sản phẩm...",
  "Đang gom Product Family...",
  "Đang cập nhật aliases...",
  "Hoàn tất.",
]

function ScanProgress() {
  const [step, setStep] = useState(0)

  // Advance steps for UX feel
  useState(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    SCAN_STEPS.forEach((_, i) => {
      timers.push(setTimeout(() => setStep(i), i * 900))
    })
    return () => timers.forEach(clearTimeout)
  })

  return (
    <div className="space-y-3 py-6">
      {SCAN_STEPS.map((s, i) => (
        <div key={s} className={`flex items-center gap-3 text-sm transition-opacity duration-500 ${i <= step ? "opacity-100" : "opacity-30"}`}>
          {i < step ? (
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
          ) : i === step ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          ) : (
            <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0" />
          )}
          {s}
        </div>
      ))}
    </div>
  )
}

// ─── Form (edit/create) ───────────────────────────────────────────────────────

const EMPTY_FORM: Omit<ProductGuide, "id" | "enabled" | "updated_at" | "created_at" | "aliases" | "warranty_variants" | "confidence" | "confidence_level"> & { id?: string; enabled?: boolean } = {
  product: "",
  title: "",
  activation_guide: "",
  usage_guide: "",
  error_guide: "",
  warranty_guide: "",
  refund_note: "",
}

// ─── Main component ───────────────────────────────────────────────────────────

type ViewMode = "list" | "edit" | "scanning" | "results"

export default function ProductGuidesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const [view, setView] = useState<ViewMode>("list")
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)

  // ── Fetch guides ───────────────────────────────────────────────────────────
  const { data: guides = [], isLoading } = useQuery<ProductGuide[]>({
    queryKey: ["product-guides"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/bot/product-guides`, { headers: authHeader() })
      if (!res.ok) throw new Error("Không tải được danh sách guide")
      return res.json()
    },
  })

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: typeof form & { id?: string; enabled?: boolean }) => {
      const res = await fetch(`${BASE}/api/bot/product-guides`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ ...data, enabled: data.enabled ?? true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Lưu thất bại")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-guides"] })
      toast({ title: "✅ Đã lưu", description: "Hướng dẫn sản phẩm đã được cập nhật" })
      setView("list"); setEditId(null); setForm({ ...EMPTY_FORM })
    },
    onError: (e: Error) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  // ── Delete ─────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/api/bot/product-guides/${id}`, {
        method: "DELETE", headers: authHeader(),
      })
      if (!res.ok) throw new Error("Xóa thất bại")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-guides"] })
      toast({ title: "🗑 Đã xóa" })
    },
    onError: (e: Error) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  // ── Toggle ─────────────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/api/bot/product-guides/${id}/toggle`, {
        method: "PATCH", headers: authHeader(),
      })
      if (!res.ok) throw new Error("Bật/tắt thất bại")
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["product-guides"] }),
    onError: (e: Error) => toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" }),
  })

  // ── Scan ───────────────────────────────────────────────────────────────────
  const handleScan = async () => {
    setView("scanning")
    try {
      const res = await fetch(`${BASE}/api/bot/product-guides/scan`, {
        method: "POST", headers: authHeader(),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Quét thất bại")
      }
      const data: ScanResult = await res.json()
      setScanResult(data)
      setView("results")
    } catch (e: any) {
      toast({ title: "❌ Lỗi khi quét", description: e.message, variant: "destructive" })
      setView("list")
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({ ...EMPTY_FORM }); setEditId("new"); setView("edit")
  }
  const openEdit = (g: ProductGuide) => {
    setForm({
      id: g.id, product: g.product, title: g.title ?? "",
      activation_guide: g.activation_guide ?? "", usage_guide: g.usage_guide ?? "",
      error_guide: g.error_guide ?? "", warranty_guide: g.warranty_guide ?? "",
      refund_note: g.refund_note ?? "", enabled: g.enabled,
    })
    setEditId(g.id); setView("edit")
  }
  const cancelEdit = () => { setView("list"); setEditId(null); setForm({ ...EMPTY_FORM }) }
  const handleSave = () => {
    if (!form.product.trim()) {
      toast({ title: "⚠️ Thiếu tên sản phẩm", variant: "destructive" }); return
    }
    saveMutation.mutate(form)
  }
  const f = (key: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }))

  // ─────────────────────────── Render ─────────────────────────────────────

  if (isLoading) return <div className="p-8 text-center animate-pulse text-muted-foreground">Đang tải...</div>

  // ── Scanning progress ──────────────────────────────────────────────────────
  if (view === "scanning") {
    return (
      <div className="space-y-4 animate-in fade-in duration-300">
        <div className="flex items-center gap-3">
          <Search className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Đang quét đơn hàng...</h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <ScanProgress />
          </CardContent>
        </Card>
      </div>
    )
  }

  // ── Scan results ───────────────────────────────────────────────────────────
  if (view === "results" && scanResult) {
    return (
      <ScanView
        result={scanResult}
        onClose={() => setView("list")}
        onApplied={() => {
          qc.invalidateQueries({ queryKey: ["product-guides"] })
          setScanResult(null)
          setView("list")
        }}
      />
    )
  }

  // ── Edit / Create form ─────────────────────────────────────────────────────
  if (view === "edit") {
    const isNew = editId === "new"
    return (
      <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={cancelEdit} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              {isNew ? "Thêm hướng dẫn mới" : "Sửa hướng dẫn"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              AI sẽ tự động dùng nội dung này khi khách hỏi về sản phẩm
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin sản phẩm</CardTitle>
            <CardDescription>Tên sản phẩm dùng để AI nhận dạng — phải khớp với tên trong đơn hàng</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tên sản phẩm <span className="text-red-500">*</span></Label>
              <Input value={form.product} onChange={f("product")} placeholder="vd: Gemini Pro 18 Tháng" className="min-h-[44px]" />
              <p className="text-xs text-muted-foreground">
                Sau khi quét đơn hàng, hệ thống sẽ tự tạo aliases — bạn chỉ cần nhập tên đại diện
              </p>
            </div>
            <div className="space-y-2">
              <Label>Tiêu đề ngắn (tuỳ chọn)</Label>
              <Input value={form.title} onChange={f("title")} placeholder="vd: Hướng dẫn Gemini Pro" className="min-h-[44px]" />
            </div>
            {!isNew && (
              <div className="flex items-center gap-3 pt-1">
                <Switch checked={form.enabled ?? true} onCheckedChange={v => setForm(p => ({ ...p, enabled: v }))} />
                <Label className="cursor-pointer">Bật guide này</Label>
              </div>
            )}
          </CardContent>
        </Card>

        {[
          { key: "activation_guide" as const, label: "Hướng dẫn kích hoạt", placeholder: "Bước 1: ...\nBước 2: ...\nBước 3: ...", desc: "Hiện khi khách hỏi cách kích hoạt / đăng nhập" },
          { key: "usage_guide"      as const, label: "Hướng dẫn sử dụng",   placeholder: "Mô tả cách dùng, các tính năng...", desc: "Hiện khi khách hỏi cách dùng sản phẩm" },
          { key: "error_guide"      as const, label: "Xử lý lỗi",           placeholder: "Nếu gặp lỗi X, hãy thử Y...", desc: "Hiện khi khách báo lỗi / không đăng nhập / rớt gói" },
          { key: "warranty_guide"   as const, label: "Hướng dẫn bảo hành",  placeholder: "Nếu tài khoản lỗi trong thời hạn BH...", desc: "Hiện khi khách hỏi về bảo hành" },
          { key: "refund_note"      as const, label: "Ghi chú hoàn tiền",   placeholder: "Hoàn tiền theo tỉ lệ số ngày còn lại...", desc: "AI dùng để giải thích chính sách hoàn tiền (không override công thức backend)" },
        ].map(({ key, label, placeholder, desc }) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{label}</CardTitle>
              <CardDescription className="text-xs">{desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea value={(form[key] as string) ?? ""} onChange={f(key)} placeholder={placeholder} className="min-h-[120px] resize-y font-mono text-sm" />
            </CardContent>
          </Card>
        ))}

        <div className="flex gap-3 pb-6">
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Đang lưu..." : "Lưu"}
          </Button>
          <Button variant="outline" onClick={cancelEdit}>Huỷ</Button>
        </div>
      </div>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Product Guides</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Hướng dẫn sản phẩm — AI Support tự động dùng để trả lời khách hàng
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleScan} className="gap-2 shrink-0">
            <Search className="h-4 w-4" />
            Quét sản phẩm từ đơn hàng
          </Button>
          <Button onClick={openCreate} className="gap-2 shrink-0">
            <Plus className="h-4 w-4" />
            Thêm hướng dẫn
          </Button>
        </div>
      </div>

      {guides.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-muted-foreground">Chưa có hướng dẫn nào</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Bấm <b>Quét sản phẩm từ đơn hàng</b> để tự động tạo, hoặc thêm thủ công
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleScan} className="gap-2">
                <Search className="h-4 w-4" />
                Quét tự động
              </Button>
              <Button onClick={openCreate} variant="ghost" className="gap-2">
                <Plus className="h-4 w-4" />
                Thêm thủ công
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {guides.map(g => {
            const isExpanded = expandedId === g.id
            const hasContent = [g.activation_guide, g.usage_guide, g.error_guide, g.warranty_guide, g.refund_note].some(Boolean)
            const hasAliases = g.aliases && g.aliases.length > 0
            return (
              <Card key={g.id} className={!g.enabled ? "opacity-60" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base truncate">{g.product}</CardTitle>
                        <Badge variant={g.enabled ? "default" : "secondary"} className="text-xs shrink-0">
                          {g.enabled ? "Bật" : "Tắt"}
                        </Badge>
                        {hasAliases && (
                          <Badge variant="outline" className="text-xs shrink-0 bg-blue-50 text-blue-700 border-blue-300">
                            <Tags className="h-3 w-3 mr-1" />
                            {g.aliases!.length} alias
                          </Badge>
                        )}
                        {[
                          g.activation_guide && "Kích hoạt",
                          g.error_guide      && "Xử lý lỗi",
                          g.warranty_guide   && "Bảo hành",
                        ].filter(Boolean).map(tag => (
                          <Badge key={tag as string} variant="outline" className="text-xs shrink-0">{tag}</Badge>
                        ))}
                      </div>
                      {g.title && <CardDescription className="mt-0.5">{g.title}</CardDescription>}
                      {hasAliases && (
                        <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">
                          Aliases: {g.aliases!.slice(0, 3).join(", ")}{g.aliases!.length > 3 ? ` +${g.aliases!.length - 3} nữa` : ""}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        Cập nhật: {g.updated_at ? new Date(g.updated_at).toLocaleString("vi-VN") : "—"}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={g.enabled}
                        onCheckedChange={() => toggleMutation.mutate(g.id)}
                        title={g.enabled ? "Tắt guide" : "Bật guide"}
                      />
                      <Button variant="ghost" size="icon" onClick={() => setExpandedId(isExpanded ? null : g.id)} title="Xem nội dung">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(g)} title="Sửa">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title="Xóa" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Xóa hướng dẫn?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Hướng dẫn <b>{g.product}</b> sẽ bị xóa vĩnh viễn. AI sẽ không còn tự trả lời về sản phẩm này.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Huỷ</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(g.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >Xóa</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 border-t">
                    <div className="space-y-3 mt-3">
                      {hasAliases && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                            <Tags className="h-3.5 w-3.5" /> Aliases ({g.aliases!.length})
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {g.aliases!.map(a => (
                              <Badge key={a} variant="outline" className="text-xs font-mono">{a}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {g.warranty_variants && g.warranty_variants.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Biến thể warranty</p>
                          <div className="flex flex-wrap gap-1">
                            {g.warranty_variants.map(v => (
                              <Badge key={v} variant="secondary" className="text-xs">{v}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      {hasContent && (
                        <>
                          {(hasAliases || (g.warranty_variants && g.warranty_variants.length > 0)) && <Separator />}
                          {[
                            { label: "🚀 Kích hoạt",   val: g.activation_guide },
                            { label: "📖 Sử dụng",     val: g.usage_guide },
                            { label: "🔧 Xử lý lỗi",   val: g.error_guide },
                            { label: "🛡 Bảo hành",    val: g.warranty_guide },
                            { label: "💰 Hoàn tiền",   val: g.refund_note },
                          ].filter(x => x.val).map(({ label, val }) => (
                            <div key={label} className="space-y-1">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                              <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/40 rounded-md p-3 leading-relaxed">{val}</pre>
                            </div>
                          ))}
                        </>
                      )}
                      {!hasContent && !hasAliases && (
                        <p className="text-sm text-muted-foreground italic">Chưa có nội dung nào.</p>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
