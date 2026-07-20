/**
 * sync-robot.tsx
 * - formData  → user input only, load once on mount
 * - robotStatus → polling only, never overwrites formData
 * - Screenshots served via /api/bot/sync-robot/screenshot/:file (auth header)
 */
import { useState, useEffect, useRef, useCallback } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  RefreshCw, Play, Plug, Save, Eye, EyeOff,
  CheckCircle2, XCircle, Activity, FileText,
  ChevronDown, ChevronUp, Lightbulb,
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

// ── AuthImage — load screenshot qua fetch (có auth) ──────────────────────────
function AuthImage({ filename, alt }: { filename: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let objectUrl = ""
    fetch(`/api/bot/sync-robot/screenshot/${encodeURIComponent(filename)}`, {
      headers: authHeader(),
    })
      .then(r => { if (!r.ok) throw new Error("not found"); return r.blob() })
      .then(b => { objectUrl = URL.createObjectURL(b); setSrc(objectUrl) })
      .catch(() => setErr(true))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [filename])

  if (err)  return <div className="text-xs text-muted-foreground py-2">Không tải được ảnh</div>
  if (!src) return <div className="w-full h-24 bg-muted/40 rounded animate-pulse" />
  return (
    <img
      src={src}
      alt={alt}
      className="w-full rounded border border-border mt-1"
      loading="lazy"
    />
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────
type FormData = {
  site_url: string; login_url: string; orders_url: string
  email: string; password: string; interval_s: number
  sync_mode: "full" | "new_only"
}

type RobotStatus = {
  enabled: boolean; running: boolean
  updated_at: string | null; next_run_at: string | null; last_run: LastRun | null
}

type LastRun = {
  started_at: string; ended_at: string; duration_s: number; success: boolean
  login_ok: boolean; download_ok: boolean; import_ok: boolean
  new_orders: number; updated_orders: number; skipped_orders: number
  errors: number; message: string
}

type TestStep = {
  step: string; ok: boolean; note: string
  screenshot_file: string | null  // filename only — load via /api/bot/sync-robot/screenshot/
}

type TestResult = {
  ok: boolean; message: string
  url?: string; title?: string; error_text?: string
  reason?: string; suggestion?: string
  duration_s?: number; steps?: TestStep[]
}

type LogEntry = LastRun & { type?: string }

const INTERVALS = [
  { value: "30", label: "30 giây" }, { value: "60", label: "1 phút" },
  { value: "120", label: "2 phút" }, { value: "300", label: "5 phút" },
  { value: "600", label: "10 phút" },
]

function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString("vi-VN", { hour12: false }) }
  catch { return iso }
}

function fmtDuration(s: number) {
  if (!s) return "—"
  const rounded = Math.round(s * 100) / 100
  if (rounded < 60) return `${rounded} giây`
  const m = Math.floor(rounded / 60)
  const rem = Math.round((rounded % 60) * 100) / 100
  return `${m} phút ${rem} giây`
}

const FORM_DEFAULT: FormData = {
  site_url: "", login_url: "", orders_url: "",
  email: "", password: "", interval_s: 300,
  sync_mode: "full",
}

const STATUS_DEFAULT: RobotStatus = {
  enabled: false, running: false,
  updated_at: null, next_run_at: null, last_run: null,
}

// ── TestResultDialog ──────────────────────────────────────────────────────────
function TestResultDialog({ result, onClose }: { result: TestResult; onClose: () => void }) {
  const isSuccess = result.ok === true          // tường minh: chỉ true mới là thành công
  const [showSteps, setShowSteps] = useState(!isSuccess)  // thất bại: auto-hiện steps
  const [expandedIdx, setExpandedIdx] = useState<number | null>(
    !isSuccess && result.steps ? result.steps.findLastIndex(s => !s.ok) : null
  )
  const steps = result.steps ?? []

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-full max-w-xl mx-auto max-h-[85dvh] flex flex-col gap-0 p-0">
        {/* Header cố định */}
        <DialogHeader className="px-4 pt-4 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isSuccess
              ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              : <XCircle      className="h-5 w-5 text-red-500 shrink-0" />}
            {isSuccess ? "Đăng nhập thành công" : "Đăng nhập thất bại"}
          </DialogTitle>
        </DialogHeader>

        {/* Nội dung cuộn */}
        <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">

          {/* Banner tóm tắt */}
          <div className={`rounded-lg p-3 text-sm leading-relaxed ${
            isSuccess
              ? "bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200"
              : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
          }`}>
            <p className="font-medium">{result.message}</p>
          </div>

          {/* Metadata chính — luôn hiển thị */}
          <div className="space-y-1.5">
            {result.url && (
              <Row label="URL">
                <span className="font-mono text-xs break-all">{result.url}</span>
              </Row>
            )}
            {result.title && <Row label="Trang">{result.title}</Row>}
            {result.duration_s !== undefined && (
              <Row label="Thời gian kiểm tra">{fmtDuration(result.duration_s)}</Row>
            )}
            {/* Chỉ hiển thị khi thất bại */}
            {!isSuccess && result.error_text && (
              <Row label="Lỗi trang">
                <span className="text-red-600 dark:text-red-400 whitespace-pre-line break-words">
                  {result.error_text}
                </span>
              </Row>
            )}
            {!isSuccess && result.reason && (
              <Row label="Nguyên nhân">
                <span className="font-medium">{result.reason}</span>
              </Row>
            )}
            {!isSuccess && result.suggestion && (
              <div className="flex gap-2 items-start rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 p-2 text-xs text-yellow-800 dark:text-yellow-200">
                <Lightbulb className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{result.suggestion}</span>
              </div>
            )}
          </div>

          {/* Steps — ẩn sau nút "Xem chi tiết kỹ thuật" */}
          {steps.length > 0 && (
            <div className="space-y-1.5">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowSteps(v => !v)}
              >
                {showSteps
                  ? <ChevronUp   className="h-3.5 w-3.5" />
                  : <ChevronDown className="h-3.5 w-3.5" />}
                {showSteps ? "Ẩn chi tiết kỹ thuật" : `Xem chi tiết kỹ thuật (${steps.length} bước)`}
              </button>

              {showSteps && steps.map((s, i) => (
                <div key={i} className={`rounded-md border text-sm overflow-hidden ${
                  s.ok
                    ? "border-green-200 dark:border-green-800"
                    : "border-red-200 dark:border-red-800"
                }`}>
                  <button
                    type="button"
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      s.ok
                        ? "bg-green-50/50 dark:bg-green-950/20 hover:bg-green-50 dark:hover:bg-green-950/30"
                        : "bg-red-50/50 dark:bg-red-950/20 hover:bg-red-50 dark:hover:bg-red-950/30"
                    }`}
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  >
                    {s.ok
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                      : <XCircle      className="h-4 w-4 text-red-500 shrink-0" />}
                    <span className="flex-1 font-medium text-xs leading-tight">{s.step}</span>
                    {(s.note || s.screenshot_file) && (
                      expandedIdx === i
                        ? <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {expandedIdx === i && (
                    <div className="px-3 py-2 space-y-2 border-t border-inherit">
                      {s.note && (
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed">
                          {s.note}
                        </pre>
                      )}
                      {s.screenshot_file && (
                        <AuthImage filename={s.screenshot_file} alt={s.step} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer cố định */}
        <div className="px-4 pb-4 pt-3 border-t shrink-0">
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-24 text-xs pt-0.5">{label}:</span>
      <span className="text-xs flex-1 break-words">{children}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SyncRobot() {
  const { toast } = useToast()

  // form state — CHỈ user cập nhật
  const [formData, setFormData]   = useState<FormData>(FORM_DEFAULT)
  const [isDirty,  setIsDirty]    = useState(false)
  const [hasServerPw, setHasPw]   = useState(false)
  const [showPw,   setShowPw]     = useState(false)

  // robot status — CHỈ polling cập nhật, không đụng formData
  const [status, setStatus] = useState<RobotStatus>(STATUS_DEFAULT)
  const [logs,   setLogs]   = useState<LogEntry[]>([])

  // UI state
  const [configLoaded, setConfigLoaded] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [syncing,  setSyncing]  = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load config — CHỈ 1 LẦN ────────────────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch("GET", "/bot/sync-robot/config")
      setHasPw(!!(cfg.password))
      setFormData({
        site_url:   cfg.site_url   ?? "",
        login_url:  cfg.login_url  ?? "",
        orders_url: cfg.orders_url ?? "",
        email:      cfg.email      ?? "",
        password:   "",
        interval_s: cfg.interval_s ?? 300,
        sync_mode:  (cfg.sync_mode === "new_only" ? "new_only" : "full") as "full" | "new_only",
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
        enabled: st.enabled ?? false, running: st.running ?? false,
        updated_at: st.updated_at ?? null, next_run_at: st.next_run_at ?? null,
        last_run: st.last_run ?? null,
      })
      setLogs(Array.isArray(lg) ? [...lg].reverse() : [])
    } catch { /* im lặng */ }
  }, [])

  useEffect(() => {
    loadConfig()
    pollStatus()
    pollRef.current = setInterval(pollStatus, 8_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadConfig, pollStatus])

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setFormData(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
    setTestResult(null)   // cấu hình đổi → kết quả test cũ không còn hợp lệ
  }

  function buildBody(extraEnabled?: boolean) {
    const body: any = {
      site_url: formData.site_url, login_url: formData.login_url,
      orders_url: formData.orders_url, email: formData.email,
      interval_s: formData.interval_s,
      sync_mode: formData.sync_mode,
    }
    if (extraEnabled !== undefined) body.enabled = extraEnabled
    if (formData.password && formData.password !== "***") body.password = formData.password
    return body
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    setSaving(true)
    try {
      const saved = await apiFetch("PUT", "/bot/sync-robot/config", buildBody())
      setIsDirty(false)
      if (formData.password && formData.password !== "***") {
        setHasPw(true)
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

  async function handleToggle(enabled: boolean) {
    try {
      await apiFetch("PUT", "/bot/sync-robot/config", buildBody(enabled))
      setStatus(prev => ({ ...prev, enabled }))
      toast({ title: enabled ? "✅ Robot đã bật" : "⏹ Robot đã tắt" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  // ── Test login — chỉ mở modal, không toast lỗi thêm ───────────────────────
  async function handleTest() {
    setTesting(true)
    const { dismiss } = toast({
      title: "🔍 Đang kiểm tra...",
      description: "Playwright đang mở trình duyệt, tối đa 2 phút",
    })
    try {
      const raw = await apiFetch("POST", "/bot/sync-robot/test-login", buildBody())
      // Unwrap nếu API wrapper bọc trong { data: ... } hoặc { result: ... }
      const parsed = raw?.data ?? raw?.result ?? raw
      const result: TestResult = {
        ...parsed,
        ok: parsed?.ok === true,   // tường minh — chỉ boolean true mới là thành công
      }
      dismiss()
      setTestResult(result)   // mở dialog — KHÔNG toast thêm
    } catch (e: any) {
      dismiss()
      setTestResult({ ok: false, message: `Lỗi kết nối tới robot: ${e.message}`, steps: [] })
    } finally {
      setTesting(false)
      pollStatus()
    }
  }

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

  // ok=true → ✅  ok=false → ❌  ok=null → ⏭ (bước chưa chạy)
  function StepIcon({ ok }: { ok: boolean | null }) {
    if (ok === true)  return <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
    if (ok === false) return <XCircle      className="h-4 w-4 text-red-500 shrink-0" />
    return <span className="h-4 w-4 text-muted-foreground shrink-0 text-center leading-4 text-xs font-bold select-none">⏭</span>
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

      {testResult && (
        <TestResultDialog result={testResult} onClose={() => setTestResult(null)} />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Robot Đồng Bộ</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tự động tải XLSX từ website bán hàng và import đơn hàng theo chu kỳ
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
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
              status.running ? "bg-green-400 animate-pulse" :
              status.enabled ? "bg-yellow-400" : "bg-gray-400"
            }`} />
            {status.running ? "Đang chạy" : status.enabled ? "Chờ chu kỳ" : "Tắt"}
          </Badge>
          <Button type="button" size="sm"
            variant={status.enabled ? "destructive" : "default"}
            onClick={() => handleToggle(!status.enabled)}
          >
            {status.enabled ? "Tắt robot" : "Bật robot"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Config form */}
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
                  <Input id="site_url" placeholder="https://shop.example.com"
                    value={formData.site_url}
                    onChange={e => setField("site_url", e.target.value)}
                    autoComplete="off" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="login_url">
                    URL đăng nhập
                    <span className="ml-1 text-xs text-muted-foreground">(để trống = tự dò)</span>
                  </Label>
                  <Input id="login_url" placeholder="https://shop.example.com/login"
                    value={formData.login_url}
                    onChange={e => setField("login_url", e.target.value)}
                    autoComplete="off" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="orders_url">
                    URL trang đơn hàng
                    <span className="ml-1 text-xs text-muted-foreground">(để trống = tự dò)</span>
                  </Label>
                  <Input id="orders_url" placeholder="https://shop.example.com/orders"
                    value={formData.orders_url}
                    onChange={e => setField("orders_url", e.target.value)}
                    autoComplete="off" />
                </div>

                <div className="space-y-1.5">
                  {/* Label đổi: hỗ trợ email, username, số điện thoại */}
                  <Label htmlFor="account">Tài khoản / Email</Label>
                  <Input id="account"
                    placeholder="username, email hoặc số điện thoại"
                    value={formData.email}
                    onChange={e => setField("email", e.target.value)}
                    autoComplete="username" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="password">Mật khẩu</Label>
                  <div className="relative">
                    <Input id="password"
                      type={showPw ? "text" : "password"}
                      placeholder={
                        hasServerPw && !formData.password
                          ? "Đã lưu — để trống để giữ nguyên"
                          : "Nhập mật khẩu mới"
                      }
                      value={formData.password}
                      onChange={e => setField("password", e.target.value)}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                      onClick={() => setShowPw(v => !v)}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {hasServerPw && !formData.password && (
                    <p className="text-xs text-muted-foreground">Mật khẩu đã lưu — nhập mới để thay đổi</p>
                  )}
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Chu kỳ đồng bộ</Label>
                  <Select value={String(formData.interval_s)}
                    onValueChange={v => setField("interval_s", Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INTERVALS.map(i => (
                        <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Chế độ đồng bộ</Label>
                  <Select value={formData.sync_mode}
                    onValueChange={v => setField("sync_mode", v as "full" | "new_only")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">
                        🔄 Toàn bộ — cập nhật mật khẩu cho đơn cũ + thêm đơn mới
                      </SelectItem>
                      <SelectItem value="new_only">
                        ✨ Chỉ đơn mới — bỏ qua đơn đã có (nhanh hơn)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {formData.sync_mode === "full"
                      ? "Chạy lần đầu hoặc khi cần cập nhật mật khẩu cho tất cả đơn cũ"
                      : "Dùng sau khi đã đồng bộ đầy đủ — chỉ import đơn chưa tồn tại"}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="submit" disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Đang lưu..." : "Lưu cấu hình"}
                </Button>
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                  <Plug className="h-4 w-4 mr-2" />
                  {testing ? "Đang kiểm tra..." : "Kiểm tra đăng nhập"}
                </Button>
                {testResult && (
                  <Button type="button" variant="ghost" onClick={() => setTestResult({ ...testResult })}>
                    <FileText className="h-4 w-4 mr-2" />
                    Mở Log
                  </Button>
                )}
                <Button type="button" variant="secondary"
                  onClick={handleSyncNow}
                  disabled={syncing || status.running || isDirty || !testResult?.ok}
                  title={
                    isDirty ? "Lưu cấu hình trước khi đồng bộ" :
                    !testResult?.ok ? "Kiểm tra đăng nhập thành công trước khi đồng bộ" : ""
                  }>
                  <Play className="h-4 w-4 mr-2" />
                  {syncing ? "Đã kích hoạt..." : "Đồng bộ ngay"}
                </Button>
              </div>

              {/* Kết quả test nhanh — bấm để mở dialog */}
              {testResult && !testing && (
                <button
                  type="button"
                  className={`mt-1 w-full text-left rounded-md px-3 py-2.5 text-sm border transition-opacity hover:opacity-75 ${
                    testResult.ok
                      ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200"
                      : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"
                  }`}
                  onClick={() => setTestResult({ ...testResult })}
                >
                  <div className="flex items-center gap-2">
                    {testResult.ok
                      ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                      : <XCircle      className="h-4 w-4 shrink-0" />}
                    <span className="font-medium">{testResult.message}</span>
                  </div>
                  {testResult.reason && (
                    <p className="mt-0.5 text-xs opacity-80 pl-6">{testResult.reason}</p>
                  )}
                  {(testResult.steps?.length ?? 0) > 0 && (
                    <p className="mt-0.5 text-xs opacity-60 pl-6">
                      {testResult.steps!.length} bước · bấm để xem screenshot chi tiết
                    </p>
                  )}
                </button>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Status panel */}
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
                    {((): { label: string; ok: boolean | null }[] => {
                      // Cascade: bước chưa chạy hiện ⏭ (null), không hiện ❌
                      const loginOk    = lastRun.login_ok    ?? false
                      const downloadOk = loginOk ? (lastRun.download_ok ?? false) : null
                      const importOk   = (loginOk && downloadOk === true) ? (lastRun.import_ok ?? false) : null
                      return [
                        { label: "Đăng nhập",       ok: loginOk    },
                        { label: "Tải file XLSX",    ok: downloadOk },
                        { label: "Import đơn hàng", ok: importOk   },
                      ]
                    })().map(s => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <StepIcon ok={s.ok} />
                        <span className={s.ok === true ? "" : "text-muted-foreground"}>{s.label}</span>
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

      {/* Log table */}
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
                        <Badge variant={log.success ? "outline" : "destructive"} className="gap-1 text-xs">
                          {log.success
                            ? <CheckCircle2 className="h-3 w-3" />
                            : <XCircle      className="h-3 w-3" />}
                          {log.success ? "OK" : "Lỗi"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-green-600">
                        {log.type === "test_login" ? "—" : log.new_orders}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {log.type === "test_login" ? "—" : log.skipped_orders}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                        {fmtDuration(log.duration_s)}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground max-w-xs truncate">
                        {log.message}
                      </td>
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
