/**
 * system-health.tsx — Trang "Kiểm tra hệ thống"
 * Hiển thị trạng thái thật của 8 thành phần hệ thống từ /api/health/system.
 */
import { useState, useCallback } from "react"
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  Server, Bot, RefreshCcw, Globe, Database, HardDrive,
  History, Wifi,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card"

// ── Auth / fetch helper ───────────────────────────────────────────────────────
function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, p: string): Promise<any> {
  const res = await fetch(`/api${p}`, { method, headers: { ...authHeader(), "Content-Type": "application/json" } })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────
type CompStatus = "ok" | "warn" | "error"

interface ComponentInfo {
  status:    CompStatus
  label:     string
  detail:    string
  checkedAt?: string
  [key: string]: unknown
}

interface SystemHealth {
  checkedAt: string
  components: {
    api:      ComponentInfo
    bot:      ComponentInfo
    robot:    ComponentInfo
    canboso:  ComponentInfo
    sheets:   ComponentInfo
    database: ComponentInfo
    backup:   ComponentInfo
    lastSync: ComponentInfo
  }
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: CompStatus }) {
  if (status === "ok")
    return (
      <Badge className="gap-1 bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
        <CheckCircle2 className="w-3 h-3" /> OK
      </Badge>
    )
  if (status === "warn")
    return (
      <Badge className="gap-1 bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">
        <AlertTriangle className="w-3 h-3" /> WARN
      </Badge>
    )
  return (
    <Badge className="gap-1 bg-red-100 text-red-800 hover:bg-red-100 border-red-200">
      <XCircle className="w-3 h-3" /> ERROR
    </Badge>
  )
}

// ── Icon per component key ────────────────────────────────────────────────────
const ICONS: Record<string, React.ElementType> = {
  api:      Server,
  bot:      Bot,
  robot:    RefreshCcw,
  canboso:  Globe,
  sheets:   Database,
  database: HardDrive,
  backup:   HardDrive,
  lastSync: History,
}

// ── Left border colour per status ─────────────────────────────────────────────
const BORDER: Record<CompStatus, string> = {
  ok:    "border-l-4 border-l-green-400",
  warn:  "border-l-4 border-l-yellow-400",
  error: "border-l-4 border-l-red-500",
}

// ── Relative time helper ──────────────────────────────────────────────────────
function relTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  const ms = Date.now() - new Date(iso).getTime()
  const m  = Math.round(ms / 60_000)
  if (m < 1)    return "vừa xong"
  if (m < 60)   return `${m} phút trước`
  const h = Math.round(m / 60)
  if (h < 24)   return `${h} giờ trước`
  return `${Math.round(h / 24)} ngày trước`
}

// ── Single component card ─────────────────────────────────────────────────────
function ComponentCard({ compKey, info }: { compKey: string; info: ComponentInfo }) {
  const Icon = ICONS[compKey] ?? Wifi
  return (
    <Card className={`${BORDER[info.status]} shadow-sm`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="text-sm font-semibold">{info.label}</CardTitle>
          </div>
          <StatusBadge status={info.status} />
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0 space-y-1">
        <p className="text-sm text-muted-foreground leading-snug">{info.detail || "—"}</p>
        {info.checkedAt && (
          <p className="text-xs text-muted-foreground/60">Kiểm tra {relTime(info.checkedAt)}</p>
        )}
      </CardContent>
    </Card>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────
function SummaryBar({ components }: { components: SystemHealth["components"] }) {
  const counts = Object.values(components).reduce(
    (acc, c) => { acc[c.status] = (acc[c.status] ?? 0) + 1; return acc },
    {} as Record<CompStatus, number>,
  )
  const total  = Object.values(components).length
  const errors = counts.error ?? 0
  const warns  = counts.warn  ?? 0
  const oks    = counts.ok    ?? 0

  if (errors > 0)
    return <p className="text-sm text-red-600 font-medium">{errors}/{total} lỗi · {warns} cảnh báo</p>
  if (warns > 0)
    return <p className="text-sm text-yellow-700 font-medium">{warns}/{total} cần chú ý · {oks} OK</p>
  return <p className="text-sm text-green-700 font-medium">Tất cả {total} thành phần hoạt động bình thường ✓</p>
}

// ── Main page ─────────────────────────────────────────────────────────────────
const COMPONENT_ORDER: (keyof SystemHealth["components"])[] = [
  "api", "bot", "robot", "canboso", "sheets", "database", "backup", "lastSync",
]

export default function SystemHealth() {
  const [data,    setData]    = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [lastFetch, setLastFetch] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch("GET", "/health/system")
      setData(result)
      setLastFetch(new Date().toISOString())
    } catch (e: any) {
      setError(e?.message ?? "Không thể kết nối API")
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load on mount
  useState(() => { refresh() })

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Kiểm tra hệ thống</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Trạng thái thật của 8 thành phần — không tự cập nhật
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Cập nhật {relTime(lastFetch)}
            </span>
          )}
          <Button onClick={refresh} disabled={loading} size="sm" variant="outline" className="gap-1.5">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Đang kiểm tra…" : "Làm mới"}
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && !loading && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <strong>Lỗi:</strong> {error}
          <button className="ml-3 underline text-red-600 hover:text-red-800" onClick={refresh}>
            Thử lại
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="border-l-4 border-l-gray-200 animate-pulse">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="h-3 bg-gray-100 rounded w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Summary */}
      {data && <SummaryBar components={data.components} />}

      {/* Component grid */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {COMPONENT_ORDER.map(key => (
            <ComponentCard key={key} compKey={key} info={data.components[key]} />
          ))}
        </div>
      )}

      {/* Checked-at footer */}
      {data && (
        <p className="text-xs text-muted-foreground text-center">
          Lần kiểm tra: {new Date(data.checkedAt).toLocaleString("vi-VN")}
        </p>
      )}
    </div>
  )
}
