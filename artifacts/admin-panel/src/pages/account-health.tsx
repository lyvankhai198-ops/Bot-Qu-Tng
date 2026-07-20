import { useState, useEffect, useCallback, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
  CheckCircle2, XCircle, AlertCircle, HelpCircle, RefreshCw,
  Activity, Save, ChevronDown, ChevronUp, Clock, Loader2, Trash2,
  Stethoscope, PackageX, KeyRound, ShieldOff, Lock, Mail, Phone,
  Bot, Wifi, Timer, Search, Info,
} from "lucide-react"

// ── Auth helper ───────────────────────────────────────────────────────────────
function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

async function apiFetch(method: string, path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { ...authHeader(), "Content-Type": "application/json" },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────
type ResultCode =
  | "ACTIVE" | "PACKAGE_LOST" | "PASSWORD_INVALID" | "ACCOUNT_BANNED"
  | "ACCOUNT_LOCKED" | "REQUIRE_EMAIL" | "REQUIRE_PHONE" | "CAPTCHA"
  | "NETWORK_ERROR" | "TIMEOUT" | "NO_PLUGIN" | "UNKNOWN" | "UNCHECKED"

type JobStatus = "queued" | "running" | "done" | "failed"

type OrderHealth = {
  orderId: string
  email: string
  productName: string
  status: string
  healthCode: ResultCode
  lastCheckedAt: string | null
  lastMessage: string | null
  lastResponseTime: number | null
  plugin: string | null
  checkCount: number
}

type Summary = { total: number; active: number; issues: number; unchecked: number }

type HistoryEntry = {
  checkedAt: string
  code: ResultCode
  message: string
  responseTime: number | null
  plugin: string
  playwrightLog?: string
  screenshotBase64?: string
}

type HealthJob = {
  id: string
  orderId: string
  email: string
  type: string
  status: JobStatus
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  pluginName: string | null
  result: { code: string; message: string; responseTime: number | null } | null
}

type HealthConfig = { timeoutMs: number; workerCount: number }

// ── Code display map ──────────────────────────────────────────────────────────
const CODE: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  ACTIVE:           { label: "Hoạt động",         icon: <CheckCircle2 className="h-3 w-3" />, className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-200" },
  PACKAGE_LOST:     { label: "Mất gói",            icon: <PackageX className="h-3 w-3" />,    className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  PASSWORD_INVALID: { label: "Sai mật khẩu",       icon: <KeyRound className="h-3 w-3" />,    className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  ACCOUNT_BANNED:   { label: "Bị cấm",             icon: <ShieldOff className="h-3 w-3" />,   className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  ACCOUNT_LOCKED:   { label: "Bị khóa",            icon: <Lock className="h-3 w-3" />,        className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  REQUIRE_EMAIL:    { label: "Cần xác minh email", icon: <Mail className="h-3 w-3" />,        className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200" },
  REQUIRE_PHONE:    { label: "Cần xác minh SĐT",   icon: <Phone className="h-3 w-3" />,       className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200" },
  CAPTCHA:          { label: "CAPTCHA",             icon: <Bot className="h-3 w-3" />,         className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  NETWORK_ERROR:    { label: "Lỗi kết nối",         icon: <Wifi className="h-3 w-3" />,        className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  TIMEOUT:          { label: "Timeout",             icon: <Timer className="h-3 w-3" />,       className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  NO_PLUGIN:        { label: "Chưa hỗ trợ",         icon: <AlertCircle className="h-3 w-3" />, className: "bg-muted text-muted-foreground border-border" },
  UNKNOWN:          { label: "Không xác định",      icon: <HelpCircle className="h-3 w-3" />, className: "bg-muted text-muted-foreground border-border" },
  UNCHECKED:        { label: "Chưa kiểm tra",       icon: <HelpCircle className="h-3 w-3" />, className: "bg-muted text-muted-foreground border-border" },
}

function HealthBadge({ code }: { code: string }) {
  const d = CODE[code] ?? CODE.UNKNOWN
  return (
    <Badge className={`gap-1 text-xs font-medium border ${d.className} hover:opacity-90`}>
      {d.icon} {d.label}
    </Badge>
  )
}

function JobStatusBadge({ status }: { status: JobStatus }) {
  if (status === "running") {
    return (
      <Badge className="gap-1 bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200">
        <Loader2 className="h-3 w-3 animate-spin" /> Đang chạy
      </Badge>
    )
  }
  if (status === "queued") {
    return (
      <Badge className="gap-1 bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200">
        <Clock className="h-3 w-3" /> Chờ
      </Badge>
    )
  }
  if (status === "done") {
    return (
      <Badge className="gap-1 bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-200">
        <CheckCircle2 className="h-3 w-3" /> Xong
      </Badge>
    )
  }
  return (
    <Badge className="gap-1 bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200">
      <XCircle className="h-3 w-3" /> Thất bại
    </Badge>
  )
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString("vi-VN", { hour12: false }) } catch { return iso }
}
function fmtMs(ms: number | null) {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// ── History Dialog ─────────────────────────────────────────────────────────────
function HistoryDialog({
  orderId, email, productName, open, onClose,
}: {
  orderId: string; email: string; productName: string; open: boolean; onClose: () => void
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)

  useEffect(() => {
    if (!open || !orderId) return
    setLoading(true)
    apiFetch("GET", `/bot/orders/${orderId}/health`)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, orderId])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="h-4 w-4" /> Lịch sử kiểm tra
          </DialogTitle>
          <DialogDescription className="text-xs font-mono">{email} — {productName}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">Chưa có lịch sử kiểm tra</div>
        ) : (
          <div className="space-y-2 py-2">
            {history.map((e, i) => (
              <div key={i} className="rounded-lg border bg-card p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <HealthBadge code={e.code} />
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDate(e.checkedAt)}</span>
                </div>
                <p className="text-sm">{e.message}</p>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  {e.responseTime != null && <span>⏱ {fmtMs(e.responseTime)}</span>}
                  {e.plugin && <span>🔌 {e.plugin}</span>}
                </div>
                {e.playwrightLog && (
                  <div>
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => setExpandedLog(expandedLog === i ? null : i)}
                    >
                      {expandedLog === i ? "Ẩn nhật ký" : "Xem nhật ký Playwright"}
                    </button>
                    {expandedLog === i && (
                      <pre className="mt-2 text-xs bg-muted rounded p-2 max-h-40 overflow-y-auto font-mono whitespace-pre-wrap">{e.playwrightLog}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Queue Panel ────────────────────────────────────────────────────────────────
function QueuePanel({
  jobs, onClear,
}: { jobs: HealthJob[]; onClear: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const active = jobs.filter(j => j.status === "queued" || j.status === "running")
  const done   = jobs.filter(j => j.status === "done" || j.status === "failed")

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium">Hàng đợi kiểm tra</CardTitle>
            {active.length > 0 && (
              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> {active.length} đang xử lý
              </Badge>
            )}
            {active.length === 0 && jobs.length > 0 && (
              <Badge variant="outline" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-600" /> Hoàn thành
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            {done.length > 0 && (
              <Button size="sm" variant="ghost" className="h-8 text-xs gap-1" onClick={onClear}>
                <Trash2 className="h-3.5 w-3.5" /> Xóa đã xong
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {expanded && jobs.length > 0 && (
        <CardContent className="pt-0 pb-3 px-4">
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {jobs.map(job => (
              <div key={job.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/40 last:border-0">
                <JobStatusBadge status={job.status} />
                <code className="text-muted-foreground truncate flex-1 min-w-0">{job.email}</code>
                <span className="text-muted-foreground shrink-0">{job.pluginName ?? job.type}</span>
                {job.result && (
                  <span className="text-muted-foreground truncate max-w-[160px]">{job.result.message?.slice(0, 40)}</span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function AccountHealth() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<OrderHealth[]>([])
  const [summary, setSummary] = useState<Summary>({ total: 0, active: 0, issues: 0, unchecked: 0 })
  const [config, setConfig] = useState<HealthConfig>({ timeoutMs: 60000, workerCount: 2 })
  const [allJobs, setAllJobs] = useState<HealthJob[]>([])
  const [polling, setPolling] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [historyOrder, setHistoryOrder] = useState<OrderHealth | null>(null)
  const [search, setSearch] = useState("")
  const [filterCode, setFilterCode] = useState("all")
  const [showConfig, setShowConfig] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadOrders = useCallback(async () => {
    try {
      const data = await apiFetch("GET", "/bot/orders/health")
      setOrders(data.orders ?? [])
      setSummary(data.summary ?? { total: 0, active: 0, issues: 0, unchecked: 0 })
      setConfig(prev => ({ ...prev, ...(data.config ?? {}) }))
    } catch (e: any) {
      toast({ title: "Lỗi tải dữ liệu", description: e.message, variant: "destructive" })
    }
  }, [toast])

  const loadJobs = useCallback(async () => {
    try {
      const jobs = await apiFetch("GET", "/bot/orders/health/jobs")
      setAllJobs(jobs ?? [])
      return jobs as HealthJob[]
    } catch {
      return [] as HealthJob[]
    }
  }, [])

  const startPolling = useCallback(() => {
    if (pollingRef.current) return
    setPolling(true)
    pollingRef.current = setInterval(async () => {
      const jobs = await loadJobs()
      const hasActive = jobs.some(j => j.status === "queued" || j.status === "running")
      if (!hasActive) {
        stopPolling()
        await loadOrders()
        setCheckingAll(false)
        setCheckingId(null)
      }
    }, 3_000)
  }, [loadJobs, loadOrders])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
    setPolling(false)
  }, [])

  useEffect(() => {
    loadOrders()
    loadJobs().then(jobs => {
      if (jobs.some(j => j.status === "queued" || j.status === "running")) {
        startPolling()
      }
    })
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  const handleCheckAll = async () => {
    setCheckingAll(true)
    try {
      const res = await apiFetch("POST", "/bot/orders/health/check", {})
      toast({ title: `Đã thêm ${res.queued} đơn vào hàng đợi` })
      await loadJobs()
      startPolling()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
      setCheckingAll(false)
    }
  }

  const handleCheckOne = async (orderId: string) => {
    setCheckingId(orderId)
    try {
      await apiFetch("POST", "/bot/orders/health/check", { orderId })
      await loadJobs()
      startPolling()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
      setCheckingId(null)
    }
  }

  const handleClearQueue = async () => {
    try {
      await apiFetch("DELETE", "/bot/orders/health/jobs/done")
      await loadJobs()
      toast({ title: "Đã xóa các job hoàn thành" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      await apiFetch("PUT", "/bot/orders/health/config", config)
      toast({ title: "Đã lưu cấu hình" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setSavingConfig(false)
    }
  }

  const activeJobIds = new Set(
    allJobs.filter(j => j.status === "queued" || j.status === "running").map(j => j.orderId)
  )

  const ISSUE_CODES = new Set(["PACKAGE_LOST","PASSWORD_INVALID","ACCOUNT_BANNED","ACCOUNT_LOCKED","REQUIRE_EMAIL","REQUIRE_PHONE","CAPTCHA","NETWORK_ERROR","TIMEOUT","UNKNOWN","NO_PLUGIN"])

  const filtered = orders.filter(o => {
    const matchSearch = !search ||
      o.email.toLowerCase().includes(search.toLowerCase()) ||
      o.productName?.toLowerCase().includes(search.toLowerCase()) ||
      o.orderId.toLowerCase().includes(search.toLowerCase())
    const matchCode = filterCode === "all" ||
      (filterCode === "active" && o.healthCode === "ACTIVE") ||
      (filterCode === "issues" && ISSUE_CODES.has(o.healthCode)) ||
      (filterCode === "unchecked" && o.healthCode === "UNCHECKED") ||
      o.healthCode === filterCode
    return matchSearch && matchCode
  })

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Kiểm Tra Tài Khoản</h1>
          <p className="text-muted-foreground mt-1 text-sm">Sử dụng dữ liệu từ danh sách đơn hàng</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <Button variant="outline" size="sm" className="gap-1.5 min-h-[44px]" onClick={() => { loadOrders(); loadJobs() }}>
            <RefreshCw className={`h-4 w-4 ${polling ? "animate-spin" : ""}`} />
            {polling ? "Đang kiểm tra..." : "Làm mới"}
          </Button>
          <Button
            size="sm"
            className="gap-1.5 min-h-[44px]"
            disabled={checkingAll || polling}
            onClick={handleCheckAll}
          >
            {checkingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
            Kiểm tra tất cả
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => setFilterCode("all")}>
          <CardContent className="p-4">
            <p className="text-2xl font-bold">{summary.total}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Tổng đơn hàng</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/40 transition-colors border-green-200 dark:border-green-800" onClick={() => setFilterCode("active")}>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-green-600">{summary.active}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Hoạt động tốt</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/40 transition-colors border-red-200 dark:border-red-800" onClick={() => setFilterCode("issues")}>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-red-600">{summary.issues}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Có vấn đề</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/40 transition-colors" onClick={() => setFilterCode("unchecked")}>
          <CardContent className="p-4">
            <p className="text-2xl font-bold text-muted-foreground">{summary.unchecked}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Chưa kiểm tra</p>
          </CardContent>
        </Card>
      </div>

      {/* Queue Panel */}
      <QueuePanel jobs={allJobs} onClear={handleClearQueue} />

      {/* Config */}
      <Card>
        <CardHeader className="py-3 px-4 cursor-pointer" onClick={() => setShowConfig(!showConfig)}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Cấu hình Worker</CardTitle>
            {showConfig ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {showConfig && (
          <CardContent className="pt-0 pb-4 px-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label className="text-xs">Số worker song song</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={config.workerCount}
                  onChange={e => setConfig({ ...config, workerCount: Number(e.target.value) })}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">Số đơn hàng kiểm tra đồng thời (1–10)</p>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Timeout mỗi lần kiểm tra (ms)</Label>
                <Input
                  type="number"
                  min={10000}
                  step={5000}
                  value={config.timeoutMs}
                  onChange={e => setConfig({ ...config, timeoutMs: Number(e.target.value) })}
                  className="h-9"
                />
                <p className="text-xs text-muted-foreground">Thời gian tối đa cho mỗi lần Playwright chạy</p>
              </div>
            </div>
            <Button size="sm" className="mt-4 gap-1.5" onClick={handleSaveConfig} disabled={savingConfig}>
              {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Lưu cấu hình
            </Button>
          </CardContent>
        )}
      </Card>

      {/* Orders table */}
      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm email, sản phẩm, mã đơn..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background min-h-[44px]"
              />
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border/50">
            {filtered.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">Không tìm thấy đơn hàng.</div>
            ) : filtered.map(o => (
              <div key={o.orderId} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{o.productName}</p>
                    <code className="text-xs text-muted-foreground font-mono break-all">{o.email}</code>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {activeJobIds.has(o.orderId) ? (
                      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm
                      </Badge>
                    ) : (
                      <Button variant="ghost" size="sm" className="h-9 px-2 text-xs gap-1"
                        onClick={() => handleCheckOne(o.orderId)}
                        disabled={checkingId === o.orderId}
                      >
                        {checkingId === o.orderId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Stethoscope className="h-3 w-3" />}
                        Kiểm tra
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-9 px-2 text-xs gap-1"
                      onClick={() => setHistoryOrder(o)}
                    >
                      <Info className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <HealthBadge code={o.healthCode} />
                  {o.lastCheckedAt && <span className="text-xs text-muted-foreground">• {fmtDate(o.lastCheckedAt)}</span>}
                </div>
                {o.lastMessage && <p className="text-xs text-muted-foreground truncate">{o.lastMessage}</p>}
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Trạng thái kiểm tra</TableHead>
                  <TableHead>Tin nhắn</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Lần kiểm tra</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy đơn hàng.
                    </TableCell>
                  </TableRow>
                ) : filtered.map(o => (
                  <TableRow key={o.orderId} className={activeJobIds.has(o.orderId) ? "bg-blue-50/30 dark:bg-blue-950/10" : ""}>
                    <TableCell className="font-mono text-sm">{o.email}</TableCell>
                    <TableCell className="text-sm">{o.productName}</TableCell>
                    <TableCell>
                      {activeJobIds.has(o.orderId) ? (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm
                        </Badge>
                      ) : (
                        <HealthBadge code={o.healthCode} />
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {o.lastMessage || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDate(o.lastCheckedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{o.checkCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1"
                          onClick={() => setHistoryOrder(o)}
                        >
                          <Activity className="h-3.5 w-3.5" /> Lịch sử
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1"
                          onClick={() => handleCheckOne(o.orderId)}
                          disabled={activeJobIds.has(o.orderId) || checkingId === o.orderId}
                        >
                          {(activeJobIds.has(o.orderId) || checkingId === o.orderId)
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Stethoscope className="h-3.5 w-3.5" />
                          }
                          Kiểm tra
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* History dialog */}
      {historyOrder && (
        <HistoryDialog
          orderId={historyOrder.orderId}
          email={historyOrder.email}
          productName={historyOrder.productName}
          open={!!historyOrder}
          onClose={() => setHistoryOrder(null)}
        />
      )}
    </div>
  )
}
