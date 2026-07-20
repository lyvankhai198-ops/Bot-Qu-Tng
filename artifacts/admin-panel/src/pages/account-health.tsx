import { useState, useEffect, useCallback, useMemo } from "react"
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  CheckCircle2, XCircle, AlertCircle, HelpCircle, RefreshCw,
  Search, Activity, Save, ChevronDown, ChevronUp, Clock, Zap,
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
type HealthStatus = "healthy" | "unhealthy" | "error" | "unchecked" | "manual"

type AccountHealth = {
  id: string
  email: string
  password: string
  type: string
  note: string
  status: string
  health: HealthStatus
  lastCheckedAt: string | null
  lastMessage: string | null
  lastResponseTime: number | null
  checkCount: number
}

type HealthSummary = {
  total: number
  healthy: number
  unhealthy: number
  error: number
  unchecked: number
  manual: number
}

type HistoryEntry = {
  checkedAt: string
  status: HealthStatus
  message: string
  responseTime: number | null
  httpStatus: number | null
}

type HealthConfig = {
  checkUrl: string
  method: string
  emailField: string
  passwordField: string
  successStatus: number
  successPattern: string
  timeoutMs: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString("vi-VN", { hour12: false }) }
  catch { return iso }
}

function fmtMs(ms: number | null) {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function HealthBadge({ status }: { status: HealthStatus }) {
  switch (status) {
    case "healthy":
      return (
        <Badge className="gap-1 bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-300 border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-3 w-3" /> Khỏe mạnh
        </Badge>
      )
    case "unhealthy":
      return (
        <Badge className="gap-1 bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-800">
          <XCircle className="h-3 w-3" /> Không hợp lệ
        </Badge>
      )
    case "error":
      return (
        <Badge className="gap-1 bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200 dark:border-orange-800">
          <AlertCircle className="h-3 w-3" /> Lỗi kết nối
        </Badge>
      )
    case "manual":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Clock className="h-3 w-3" /> Thủ công
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <HelpCircle className="h-3 w-3" /> Chưa kiểm tra
        </Badge>
      )
  }
}

// ── History Dialog ────────────────────────────────────────────────────────────
function HistoryDialog({
  account,
  onClose,
}: {
  account: AccountHealth
  onClose: () => void
}) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)

  useEffect(() => {
    setLoading(true)
    apiFetch("GET", `/bot/accounts/${account.id}/health-history`)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false))
  }, [account.id])

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-full max-w-lg mx-auto max-h-[85dvh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Lịch sử kiểm tra
          </DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{account.email}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-2">
          {loading ? (
            Array(3).fill(0).map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />
            ))
          ) : history.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              Chưa có lịch sử kiểm tra
            </div>
          ) : (
            history.map((entry, i) => {
              const isOk = entry.status === "healthy"
              const isExpanded = expanded === i
              return (
                <div
                  key={i}
                  className={`rounded-md border text-sm overflow-hidden ${
                    isOk
                      ? "border-green-200 dark:border-green-800"
                      : entry.status === "manual"
                        ? "border-border"
                        : "border-red-200 dark:border-red-800"
                  }`}
                >
                  <button
                    type="button"
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                      isOk
                        ? "bg-green-50/50 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30"
                        : entry.status === "manual"
                          ? "bg-muted/30 hover:bg-muted/50"
                          : "bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30"
                    }`}
                    onClick={() => setExpanded(isExpanded ? null : i)}
                  >
                    <HealthBadge status={entry.status} />
                    <span className="flex-1 text-xs text-muted-foreground font-mono">
                      {fmtDate(entry.checkedAt)}
                    </span>
                    {entry.responseTime != null && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {fmtMs(entry.responseTime)}
                      </span>
                    )}
                    {isExpanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                  </button>
                  {isExpanded && (
                    <div className="px-3 py-2 border-t border-inherit text-xs text-muted-foreground space-y-1">
                      <div><span className="font-medium text-foreground">Thông báo:</span> {entry.message}</div>
                      {entry.httpStatus != null && (
                        <div><span className="font-medium text-foreground">HTTP Status:</span> {entry.httpStatus}</div>
                      )}
                      {entry.responseTime != null && (
                        <div><span className="font-medium text-foreground">Thời gian phản hồi:</span> {fmtMs(entry.responseTime)}</div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="px-4 pb-4 pt-3 border-t shrink-0">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
const CONFIG_DEFAULTS: HealthConfig = {
  checkUrl: "",
  method: "POST",
  emailField: "email",
  passwordField: "password",
  successStatus: 200,
  successPattern: "",
  timeoutMs: 10000,
}

export default function AccountHealth() {
  const { toast } = useToast()

  const [accounts, setAccounts] = useState<AccountHealth[]>([])
  const [summary, setSummary] = useState<HealthSummary | null>(null)
  const [config, setConfig] = useState<HealthConfig>(CONFIG_DEFAULTS)
  const [configDirty, setConfigDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [historyAccount, setHistoryAccount] = useState<AccountHealth | null>(null)
  const [search, setSearch] = useState("")
  const [filterHealth, setFilterHealth] = useState("all")
  const [filterStatus, setFilterStatus] = useState("all")
  const [showConfig, setShowConfig] = useState(false)

  const loadHealth = useCallback(async () => {
    try {
      const data = await apiFetch("GET", "/bot/accounts/health")
      setAccounts(data.accounts ?? [])
      setSummary(data.summary ?? null)
      if (!configDirty) {
        setConfig({ ...CONFIG_DEFAULTS, ...(data.config ?? {}) })
      }
    } catch (e: any) {
      toast({ title: "Lỗi tải dữ liệu", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [configDirty]) // eslint-disable-line

  useEffect(() => { loadHealth() }, [loadHealth])

  const filteredAccounts = useMemo(() => {
    return accounts.filter(acc => {
      const matchSearch =
        acc.email.toLowerCase().includes(search.toLowerCase()) ||
        (acc.note || "").toLowerCase().includes(search.toLowerCase()) ||
        (acc.type || "").toLowerCase().includes(search.toLowerCase())
      const matchHealth = filterHealth === "all" || acc.health === filterHealth
      const matchStatus = filterStatus === "all" || acc.status === filterStatus
      return matchSearch && matchHealth && matchStatus
    })
  }, [accounts, search, filterHealth, filterStatus])

  async function handleSaveConfig() {
    setSavingConfig(true)
    try {
      await apiFetch("PUT", "/bot/accounts/health/config", config)
      setConfigDirty(false)
      toast({ title: "✅ Đã lưu cấu hình kiểm tra" })
    } catch (e: any) {
      toast({ title: "Lỗi lưu cấu hình", description: e.message, variant: "destructive" })
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleCheckAll() {
    setCheckingAll(true)
    try {
      const result = await apiFetch("POST", "/bot/accounts/health/check", {})
      toast({
        title: `✅ Đã kiểm tra ${result.checked} tài khoản`,
        description: `Khỏe: ${result.healthy} · Lỗi: ${result.unhealthy + result.error} · Thủ công: ${result.manual}`,
      })
      await loadHealth()
    } catch (e: any) {
      toast({ title: "Lỗi kiểm tra", description: e.message, variant: "destructive" })
    } finally {
      setCheckingAll(false)
    }
  }

  async function handleCheckOne(acc: AccountHealth) {
    setCheckingId(acc.id)
    try {
      const result = await apiFetch("POST", "/bot/accounts/health/check", { accountId: acc.id })
      const r = result.results?.[0]
      toast({
        title: r?.status === "healthy" ? `✅ ${acc.email} — Khỏe mạnh` : `⚠️ ${acc.email} — ${r?.status}`,
        description: r?.message,
      })
      await loadHealth()
    } catch (e: any) {
      toast({ title: "Lỗi kiểm tra", description: e.message, variant: "destructive" })
    } finally {
      setCheckingId(null)
    }
  }

  function setConfigField<K extends keyof HealthConfig>(key: K, value: HealthConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }))
    setConfigDirty(true)
  }

  const statCards = [
    { label: "Tổng số", value: summary?.total ?? 0, color: "text-foreground", icon: Activity },
    { label: "Khỏe mạnh", value: summary?.healthy ?? 0, color: "text-green-600 dark:text-green-400", icon: CheckCircle2 },
    { label: "Không hợp lệ", value: summary?.unhealthy ?? 0, color: "text-red-600 dark:text-red-400", icon: XCircle },
    { label: "Lỗi kết nối", value: summary?.error ?? 0, color: "text-orange-600 dark:text-orange-400", icon: AlertCircle },
    { label: "Chưa kiểm tra", value: (summary?.unchecked ?? 0) + (summary?.manual ?? 0), color: "text-muted-foreground", icon: HelpCircle },
  ]

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {historyAccount && (
        <HistoryDialog account={historyAccount} onClose={() => setHistoryAccount(null)} />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Kiểm Tra Tình Trạng Tài Khoản</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tự động kiểm tra và theo dõi sức khỏe của tất cả tài khoản trong kho
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowConfig(v => !v)}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {showConfig ? "Ẩn cấu hình" : "Cấu hình"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadHealth}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Làm mới
          </Button>
          <Button
            size="sm"
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="gap-2 min-h-[36px]"
          >
            <Zap className="h-4 w-4" />
            {checkingAll ? "Đang kiểm tra..." : "Kiểm tra tất cả"}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statCards.map(s => (
          <Card key={s.label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon className={`h-4 w-4 ${s.color}`} />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </Card>
        ))}
      </div>

      {/* Config Panel */}
      {showConfig && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cấu hình URL Kiểm tra</CardTitle>
            <CardDescription>
              Hệ thống sẽ gửi HTTP request với thông tin đăng nhập của từng tài khoản để kiểm tra tính hợp lệ.
              Để trống URL nếu chỉ muốn ghi nhận kiểm tra thủ công.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>URL Kiểm tra <span className="text-xs text-muted-foreground">(endpoint nhận đăng nhập)</span></Label>
                <Input
                  placeholder="https://api.example.com/auth/login"
                  value={config.checkUrl}
                  onChange={e => setConfigField("checkUrl", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phương thức HTTP</Label>
                <Select value={config.method} onValueChange={v => setConfigField("method", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="PUT">PUT</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>HTTP Status thành công</Label>
                <Input
                  type="number"
                  value={config.successStatus}
                  onChange={e => setConfigField("successStatus", Number(e.target.value))}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Tên trường email <span className="text-xs text-muted-foreground">(trong JSON body)</span></Label>
                <Input
                  placeholder="email"
                  value={config.emailField}
                  onChange={e => setConfigField("emailField", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Tên trường mật khẩu <span className="text-xs text-muted-foreground">(trong JSON body)</span></Label>
                <Input
                  placeholder="password"
                  value={config.passwordField}
                  onChange={e => setConfigField("passwordField", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Pattern xác nhận thành công <span className="text-xs text-muted-foreground">(tùy chọn, trong response body)</span></Label>
                <Input
                  placeholder='VD: "success":true'
                  value={config.successPattern}
                  onChange={e => setConfigField("successPattern", e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  value={config.timeoutMs}
                  onChange={e => setConfigField("timeoutMs", Number(e.target.value))}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={handleSaveConfig} disabled={savingConfig || !configDirty}>
                <Save className="h-4 w-4 mr-2" />
                {savingConfig ? "Đang lưu..." : configDirty ? "Lưu cấu hình" : "Đã lưu"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounts Table */}
      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm email, loại, ghi chú..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background min-h-[44px]"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={filterHealth} onValueChange={setFilterHealth}>
                <SelectTrigger className="bg-background min-h-[44px] flex-1 min-w-[140px]">
                  <SelectValue placeholder="Tình trạng" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả tình trạng</SelectItem>
                  <SelectItem value="healthy">Khỏe mạnh</SelectItem>
                  <SelectItem value="unhealthy">Không hợp lệ</SelectItem>
                  <SelectItem value="error">Lỗi kết nối</SelectItem>
                  <SelectItem value="manual">Thủ công</SelectItem>
                  <SelectItem value="unchecked">Chưa kiểm tra</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="bg-background min-h-[44px] flex-1 min-w-[140px]">
                  <SelectValue placeholder="Trạng thái kho" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả kho</SelectItem>
                  <SelectItem value="available">Còn hàng</SelectItem>
                  <SelectItem value="distributed">Đã phát</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/50">
            {loading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </div>
              ))
            ) : filteredAccounts.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Không tìm thấy tài khoản nào.
              </div>
            ) : (
              filteredAccounts.map(acc => (
                <div key={acc.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <code className="text-xs font-mono break-all leading-relaxed">{acc.email}</code>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        disabled={checkingId === acc.id}
                        onClick={() => handleCheckOne(acc)}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${checkingId === acc.id ? "animate-spin" : ""}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setHistoryAccount(acc)}
                      >
                        <Activity className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <HealthBadge status={acc.health} />
                    <Badge variant={acc.status === "available" ? "default" : "secondary"} className="text-xs">
                      {acc.status === "available" ? "Còn hàng" : "Đã phát"}
                    </Badge>
                    {acc.type && <span className="bg-muted px-2 py-0.5 rounded text-xs">{acc.type}</span>}
                  </div>
                  {acc.lastCheckedAt && (
                    <div className="text-xs text-muted-foreground">
                      Kiểm tra lần cuối: {fmtDate(acc.lastCheckedAt)}
                      {acc.lastResponseTime != null && ` · ${fmtMs(acc.lastResponseTime)}`}
                    </div>
                  )}
                  {acc.lastMessage && (
                    <p className="text-xs text-muted-foreground truncate" title={acc.lastMessage}>
                      {acc.lastMessage}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Kho</TableHead>
                  <TableHead>Tình trạng</TableHead>
                  <TableHead>Lần kiểm tra cuối</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Thông báo</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredAccounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy tài khoản nào.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredAccounts.map(acc => (
                    <TableRow key={acc.id}>
                      <TableCell className="font-mono text-xs">{acc.email}</TableCell>
                      <TableCell className="text-sm">{acc.type || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={acc.status === "available" ? "default" : "secondary"} className="text-xs">
                          {acc.status === "available" ? "Còn hàng" : "Đã phát"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <HealthBadge status={acc.health} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(acc.lastCheckedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtMs(acc.lastResponseTime)}
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground max-w-[200px] truncate"
                        title={acc.lastMessage ?? ""}
                      >
                        {acc.lastMessage || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Kiểm tra ngay"
                            disabled={checkingId === acc.id}
                            onClick={() => handleCheckOne(acc)}
                          >
                            <RefreshCw className={`h-4 w-4 ${checkingId === acc.id ? "animate-spin" : ""}`} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Xem lịch sử"
                            onClick={() => setHistoryAccount(acc)}
                          >
                            <Activity className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Footer count */}
          {!loading && (
            <div className="px-4 py-3 border-t border-border/50 text-xs text-muted-foreground">
              Hiển thị {filteredAccounts.length} / {accounts.length} tài khoản
              {summary && (
                <span className="ml-3">
                  · <span className="text-green-600 dark:text-green-400">{summary.healthy} khỏe mạnh</span>
                  {(summary.unhealthy + summary.error) > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-1">
                      · {summary.unhealthy + summary.error} có vấn đề
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
