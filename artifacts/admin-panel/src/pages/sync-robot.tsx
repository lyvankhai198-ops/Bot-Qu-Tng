/**
 * sync-robot.tsx
 *
 * QUAN TRỌNG — tách biệt hoàn toàn:
 *   formData    → dữ liệu người dùng đang nhập (CHỈ load 1 lần lúc mở trang)
 *   robotStatus → trạng thái robot đang polling (KHÔNG được ghi đè formData)
 */
import { useState, useEffect, useRef, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  RefreshCw,
  Play,
  Plug,
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Activity,
  FileText,
  ChevronDown,
  ChevronUp,
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

type FormData = {
  site_url: string
  login_url: string
  orders_url: string
  email: string
  password: string
  interval_s: number
}

type RobotStatus = {
  enabled: boolean
  running: boolean
  updated_at: string | null
  next_run_at: string | null
  last_run: LastRun | null
}

type LastRun = {
  started_at: string
  ended_at: string
  duration_s: number
  success: boolean
  login_ok: boolean
  download_ok: boolean
  import_ok: boolean
  new_orders: number
  updated_orders: number
  skipped_orders: number
  errors: number
  message: string
}

type TestStep = {
  step: string
  ok: boolean
  note: string
  screenshot: string | null   // base64 JPEG
}

type TestResult = {
  ok: boolean
  message: string
  url?: string
  title?: string
  error_text?: string
  duration_s?: number
  steps?: TestStep[]
}

type LogEntry = LastRun & { type?: string }

const INTERVALS = [
  { value: "30",  label: "30 giây" },
  { value: "60",  label: "1 phút"  },
  { value: "120", label: "2 phút"  },
  { value: "300", label: "5 phút"  },
  { value: "600", label: "10 phút" },
]

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString("vi-VN", { hour12: false }) }
  catch { return iso }
}

function fmtDuration(s: number): string {
  if (!s) return "—"
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return `${m}m ${r}s`
}

const FORM_DEFAULT: FormData = {
  site_url: "", login_url: "", orders_url: "",
  email: "", password: "", interval_s: 300,
}

const STATUS_DEFAULT: RobotStatus = {
  enabled: false, running: false,
  updated_at: null, next_run_at: null, last_run: null,
}

// ── TestResultDialog ──────────────────────────────────────────────────────────
function TestResultDialog({ result, onClose }: { result: TestResult; onClose: () => void }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const steps = result.steps ?? []

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {result.ok
              ? <CheckCircle2 className="h-5 w-5 text-green-500" />
              : <XCircle      className="h-5 w-5 text-red-500" />}
            {result.ok ? "Đăng nhập thành công" : "Đăng nhập thất bại"}
          </DialogTitle>
        </DialogHeader>

        {/* Tóm tắt */}
        <div className={`rounded-lg p-3 text-sm leading-relaxed ${
          result.ok
            ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200"
            : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
        }`}>
          <p className="font-medium">{result.message}</p>
        </div>

        {/* Metadata */}
        {(result.url || result.title || result.error_text || result.duration_s) && (
          <div className="space-y-1.5 text-sm">
            {result.url && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-24">URL:</span>
                <span className="font-mono text-xs break-all">{result.url}</span>
              </div>
            )}
            {result.title && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-24">Tiêu đề:</span>
                <span>{result.title}</span>
              </div>
            )}
            {result.error_text && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-24">Lỗi trang:</span>
                <span className="text-red-600 dark:text-red-400 whitespace-pre-line">{result.error_text}</span>
              </div>
            )}
            {result.duration_s !== undefined && (
              <div className="flex gap-2">
                <span className="text-muted-foreground shrink-0 w-24">Thời gian:</span>
                <span>{fmtDuration(result.duration_s)}</span>
              </div>
            )}
          </div>
        )}

        {/* Steps */}
        {steps.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Chi tiết từng bước ({steps.length})</h4>
            <div className="space-y-1.5">
              {steps.map((s, i) => (
                <div key={i} className={`rounded-md border text-sm overflow-hidden ${
                  s.ok ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"
                }`}>
                  {/* Header row */}
                  <button
                    type="button"
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors ${
                      s.ok ? "bg-green-50/50 dark:bg-green-950/20" : "bg-red-50/50 dark:bg-red-950/20"
                    }`}
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  >
                    {s.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      : <XCircle      className="h-4 w-4 text-red-500 shrink-0" />}
                    <span className="flex-1 font-medium truncate">{s.step}</span>
                    <span className="text-xs text-muted-foreground">
                      {(s.note || s.screenshot) && (
                        expandedIdx === i
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </span>
                  </button>

                  {/* Expanded content */}
                  {expandedIdx === i && (
                    <div className="px-3 py-2 space-y-2 border-t border-inherit">
                      {s.note && (
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all leading-relaxed">
                          {s.note}
                        </pre>
                      )}
                      {s.screenshot && (
                        <img
                          src={`data:image/jpeg;base64,${s.screenshot}`}
                          alt={`Screenshot: ${s.step}`}
                          className="w-full rounded border"
                          loading="lazy"
                        />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Button type="button" variant="outline" className="w-full" onClick={onClose}>
          Đóng
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SyncRobot() {
  const { toast } = useToast()

  // form state — CHỈ user cập nhật
  const [formData, setFormData]             = useState<FormData>(FORM_DEFAULT)
  const [isDirty,  setIsDirty]              = useState(false)
  const [hasServerPassword, setHasServerPw] = useState(false)
  const [showPw,   setShowPw]               = useState(false)

  // robot status state — CHỈ polling cập nhật
  const [status, setStatus]  = useState<RobotStatus>(STATUS_DEFAULT)
  const [logs,   setLogs]    = useState<LogEntry[]>([])

  // UI state
  const [configLoaded,  setConfigLoaded]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [syncing,  setSyncing]  = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load config — CHỈ 1 LẦN khi mount ─────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch("GET", "/bot/sync-robot/config")
      const serverHasPw = !!(cfg.password)
      setHasServerPw(serverHasPw)
      setFormData({
        site_url:   cfg.site_url   ?? "",
        login_url:  cfg.login_url  ?? "",
        orders_url: cfg.orders_url ?? "",
        email:      cfg.email      ?? "",
        password:   "",
        interval_s: cfg.interval_s ?? 300,
      })
      setConfigLoaded(true)
    } catch (e: any) {
      toast({ title: "Lỗi tải cấu hình", description: e.message, variant: "destructive" })
    }
  }, []) // eslint-disable-line

  // ── Poll status + logs — KHÔNG đụng formData ───────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const [st, lg] = await Promise.all([
        apiFetch("GET", "/bot/sync-robot/status"),
        apiFetch("GET", "/bot/sync-robot/logs"),
      ])
      setStatus({
        enabled:    st.enabled     ?? false,
        running:    st.running     ?? false,
        updated_at: st.updated_at  ?? null,
        next_run_at: st.next_run_at ?? null,
        last_run:   st.last_run    ?? null,
      })
      setLogs(Array.isArray(lg) ? [...lg].reverse() : [])
    } catch {
      // polling failure — im lặng
    }
  }, [])

  useEffect(() => {
    loadConfig()
    pollStatus()
    pollRef.current = setInterval(pollStatus, 8_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadConfig, pollStatus])

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setFormData(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function buildBody(extraEnabled?: boolean) {
    const body: any = {
      site_url: formData.site_url, login_url: formData.login_url,
      orders_url: formData.orders_url, email: formData.email,
      interval_s: formData.interval_s,
    }
    if (extraEnabled !== undefined) body.enabled = extraEnabled
    if (formData.password && formData.password !== "***") body.password = formData.password
    return body
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    setSaving(true)
    try {
      const saved = await apiFetch("PUT", "/bot/sync-robot/config", buildBody())
      setIsDirty(false)
      if (formData.password && formData.password !== "***") {
        setHasServerPw(true)
        setFormData(prev => ({ ...prev, password: "" }))
      }
      if (saved?.enabled !== undefined) setStatus(prev => ({ ...prev, enabled: saved.enabled }))
      toast({ title: "✅ Đã lưu cấu hình" })
    } catch (e: any) {
      toast({ title: "Lỗi lưu cấu hình", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // ── Toggle bật/tắt ─────────────────────────────────────────────────────────
  async function handleToggle(enabled: boolean) {
    try {
      await apiFetch("PUT", "/bot/sync-robot/config", buildBody(enabled))
      setStatus(prev => ({ ...prev, enabled }))
      toast({ title: enabled ? "✅ Robot đã bật" : "⏹ Robot đã tắt" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  // ── Test login — gọi API, hiển thị kết quả chi tiết ───────────────────────
  async function handleTest() {
    setTesting(true)
    toast({ title: "🔍 Đang kiểm tra...", description: "Playwright đang mở trình duyệt, chờ tối đa 2 phút" })
    try {
      const result: TestResult = await apiFetch("POST", "/bot/sync-robot/test-login", buildBody())
      setTestResult(result)
      // Toast nhanh theo kết quả
      if (result.ok) {
        toast({ title: "✅ Đăng nhập thành công!", description: result.message })
      } else {
        toast({ title: "❌ Đăng nhập thất bại", description: result.message, variant: "destructive" })
      }
    } catch (e: any) {
      setTestResult({ ok: false, message: `Lỗi kết nối tới robot: ${e.message}`, steps: [] })
      toast({ title: "❌ Lỗi kết nối", description: e.message, variant: "destructive" })
    } finally {
      setTesting(false)
      pollStatus()
    }
  }

  // ── Sync now ───────────────────────────────────────────────────────────────
  async function handleSyncNow() {
    setSyncing(true)
    try {
      await apiFetch("POST", "/bot/sync-robot/trigger", {})
      toast({ title: "🔄 Đã kích hoạt đồng bộ ngay", description: "Robot sẽ chạy trong vài giây..." })
      setTimeout(pollStatus, 4_000)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setTimeout(() => setSyncing(false), 2_000)
    }
  }

  async function handleManualRefresh() {
    await Promise.all([loadConfig(), pollStatus()])
    setIsDirty(false)
  }

  function StepIcon({ ok }: { ok: boolean }) {
    return ok
      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      : <XCircle      className="h-4 w-4 text-red-500 shrink-0" />
  }

  const lastRun = status.last_run

  if (!configLoaded) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
        Đang tải...
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Dialog chi tiết test-login */}
      {testResult && (
        <TestResultDialog result={testResult} onClose={() => setTestResult(null)} />
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Robot Đồng Bộ</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tự động tải XLSX từ website bán hàng và import đơn hàng theo chu kỳ
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isDirty && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-400 gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
              Chưa lưu
            </Badge>
          )}
          <Badge
            variant={status.running ? "default" : status.enabled ? "outline" : "secondary"}
            className="gap-1.5"
          >
            <span className={`h-2 w-2 rounded-full ${
              status.running  ? "bg-green-400 animate-pulse" :
              status.enabled  ? "bg-yellow-400" : "bg-gray-400"
            }`} />
            {status.running ? "Đang chạy" : status.enabled ? "Chờ chu kỳ" : "Tắt"}
          </Badge>
          <Button
            type="button"
            size="sm"
            variant={status.enabled ? "destructive" : "default"}
            onClick={() => handleToggle(!status.enabled)}
          >
            {status.enabled ? "Tắt robot" : "Bật robot"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Config form ─────────────────────────────────────────────────── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Cấu hình</CardTitle>
            <CardDescription>Thông tin đăng nhập website bán hàng</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="site_url">URL website</Label>
                  <Input
                    id="site_url"
                    type="url"
                    placeholder="https://shop.example.com"
                    value={formData.site_url}
                    onChange={(e) => setField("site_url", e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="login_url">
                    URL đăng nhập{" "}
                    <span className="text-xs text-muted-foreground">(để trống = tự dò)</span>
                  </Label>
                  <Input
                    id="login_url"
                    type="url"
                    placeholder="https://shop.example.com/login"
                    value={formData.login_url}
                    onChange={(e) => setField("login_url", e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="orders_url">
                    URL trang đơn hàng{" "}
                    <span className="text-xs text-muted-foreground">(để trống = tự dò)</span>
                  </Label>
                  <Input
                    id="orders_url"
                    type="url"
                    placeholder="https://shop.example.com/orders"
                    value={formData.orders_url}
                    onChange={(e) => setField("orders_url", e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">Email đăng nhập</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@shop.example.com"
                    value={formData.email}
                    onChange={(e) => setField("email", e.target.value)}
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Mật khẩu</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPw ? "text" : "password"}
                      placeholder={
                        hasServerPassword && !formData.password
                          ? "Đã lưu mật khẩu — để trống để giữ nguyên"
                          : "Nhập mật khẩu mới"
                      }
                      value={formData.password}
                      onChange={(e) => setField("password", e.target.value)}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                      onClick={() => setShowPw(v => !v)}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {hasServerPassword && !formData.password && (
                    <p className="text-xs text-muted-foreground">Mật khẩu đã lưu — nhập mới để thay đổi.</p>
                  )}
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Chu kỳ đồng bộ</Label>
                  <Select
                    value={String(formData.interval_s)}
                    onValueChange={(v) => setField("interval_s", Number(v))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INTERVALS.map(i => (
                        <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Đang lưu..." : "Lưu cấu hình"}
                </Button>

                <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                  <Plug className="h-4 w-4 mr-2" />
                  {testing ? "Đang kiểm tra..." : "Kiểm tra đăng nhập"}
                </Button>

                {/* Nút Mở Log — chỉ hiện khi có kết quả test */}
                {testResult && (
                  <Button type="button" variant="secondary" onClick={() => setTestResult(testResult)}>
                    <FileText className="h-4 w-4 mr-2" />
                    Mở Log
                  </Button>
                )}

                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSyncNow}
                  disabled={syncing || status.running}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {syncing ? "Đã kích hoạt..." : "Đồng bộ ngay"}
                </Button>
              </div>

              {/* Tóm tắt kết quả test nhanh (không cần mở dialog) */}
              {testResult && !testing && (
                <div
                  className={`mt-2 rounded-md p-3 text-sm cursor-pointer hover:opacity-80 transition-opacity ${
                    testResult.ok
                      ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200 border border-green-200 dark:border-green-800"
                      : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200 border border-red-200 dark:border-red-800"
                  }`}
                  onClick={() => setTestResult({ ...testResult })}
                  title="Bấm để xem chi tiết"
                >
                  <div className="flex items-center gap-2">
                    {testResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <XCircle      className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{testResult.message}</span>
                  </div>
                  {testResult.error_text && (
                    <p className="mt-1 text-xs opacity-80 line-clamp-2">{testResult.error_text}</p>
                  )}
                  {(testResult.steps?.length ?? 0) > 0 && (
                    <p className="mt-1 text-xs opacity-60">
                      {testResult.steps!.length} bước — bấm để xem screenshot chi tiết
                    </p>
                  )}
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {/* ── Status panel ─────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Trạng thái
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Chu kỳ tiếp theo</span>
                <span className="font-mono">{fmtDate(status.next_run_at)}</span>
              </div>

              {lastRun ? (
                <>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Lần cuối chạy</span>
                    <span className="font-mono">{fmtDate(lastRun.started_at)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Thời gian chạy</span>
                    <span>{fmtDuration(lastRun.duration_s)}</span>
                  </div>
                  <hr className="border-border" />
                  <div className="space-y-1.5">
                    {([
                      { label: "Đăng nhập",       ok: lastRun.login_ok    },
                      { label: "Tải file XLSX",    ok: lastRun.download_ok },
                      { label: "Import đơn hàng", ok: lastRun.import_ok   },
                    ] as const).map(s => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <StepIcon ok={s.ok} />
                        <span className={s.ok ? "" : "text-muted-foreground"}>{s.label}</span>
                      </div>
                    ))}
                  </div>
                  <hr className="border-border" />
                  <div className="grid grid-cols-3 text-center gap-1">
                    <div>
                      <div className="text-lg font-bold text-green-600">{lastRun.new_orders}</div>
                      <div className="text-xs text-muted-foreground">Đơn mới</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-blue-600">{lastRun.updated_orders}</div>
                      <div className="text-xs text-muted-foreground">Cập nhật</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-muted-foreground">{lastRun.skipped_orders}</div>
                      <div className="text-xs text-muted-foreground">Bỏ qua</div>
                    </div>
                  </div>
                  <p className={`text-xs rounded-md p-2 leading-relaxed ${
                    lastRun.success
                      ? "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300"
                      : "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                  }`}>
                    {lastRun.message}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Chưa có lần chạy nào.</p>
              )}
            </CardContent>
          </Card>

          <Button type="button" variant="outline" size="sm" className="w-full" onClick={handleManualRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
        </div>
      </div>

      {/* ── Log table ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lịch sử đồng bộ</CardTitle>
          <CardDescription>Bao gồm cả kết quả Kiểm tra đăng nhập</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-10">Chưa có lịch sử.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                    <th className="text-left px-4 py-2 font-medium whitespace-nowrap">Thời gian</th>
                    <th className="text-left px-4 py-2 font-medium">Loại</th>
                    <th className="text-left px-4 py-2 font-medium">Kết quả</th>
                    <th className="text-right px-4 py-2 font-medium">Mới</th>
                    <th className="text-right px-4 py-2 font-medium">Bỏ qua</th>
                    <th className="text-right px-4 py-2 font-medium">Lỗi</th>
                    <th className="text-right px-4 py-2 font-medium">Thời gian</th>
                    <th className="text-left px-4 py-2 font-medium">Thông báo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {fmtDate(log.started_at)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className="text-xs font-normal">
                          {log.type === "test_login" ? "🔍 Test" : "🔄 Sync"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={log.success ? "outline" : "destructive"}
                          className="gap-1 text-xs"
                        >
                          {log.success
                            ? <CheckCircle2 className="h-3 w-3" />
                            : <XCircle      className="h-3 w-3" />}
                          {log.success ? "OK" : "Lỗi"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-green-600">{log.new_orders || "—"}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{log.skipped_orders || "—"}</td>
                      <td className="px-4 py-2 text-right text-red-500">{log.errors || 0}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground text-xs">{fmtDuration(log.duration_s)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">{log.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
