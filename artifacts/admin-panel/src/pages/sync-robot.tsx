/**
 * sync-robot.tsx
 *
 * QUAN TRỌNG — tách biệt hoàn toàn:
 *   formData   → dữ liệu người dùng đang nhập (CHỈ load 1 lần lúc mở trang)
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
  RefreshCw,
  Play,
  Plug,
  Save,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Activity,
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

/** Dữ liệu form — chỉ do người dùng kiểm soát */
type FormData = {
  site_url: string
  login_url: string
  orders_url: string
  email: string
  /** "" = chưa nhập gì (hiển thị placeholder "Đã lưu mật khẩu"), giá trị thật = người dùng đang gõ mới */
  password: string
  interval_s: number
}

/** Trạng thái robot — chỉ cập nhật từ polling, KHÔNG liên quan form */
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

type LogEntry = LastRun

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
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), r = s % 60
  return `${m}m ${r}s`
}

const FORM_DEFAULT: FormData = {
  site_url: "",
  login_url: "",
  orders_url: "",
  email: "",
  password: "",   // "" = server có mật khẩu cũ, placeholder thay thế
  interval_s: 300,
}

const STATUS_DEFAULT: RobotStatus = {
  enabled: false,
  running: false,
  updated_at: null,
  next_run_at: null,
  last_run: null,
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SyncRobot() {
  const { toast } = useToast()

  // ── form state — chỉ user cập nhật ────────────────────────────────────────
  const [formData, setFormData] = useState<FormData>(FORM_DEFAULT)
  const [isDirty,  setIsDirty]  = useState(false)
  const [hasServerPassword, setHasServerPassword] = useState(false)
  const [showPw,  setShowPw]    = useState(false)

  // ── robot status state — chỉ polling cập nhật ─────────────────────────────
  const [status,  setStatus]    = useState<RobotStatus>(STATUS_DEFAULT)
  const [logs,    setLogs]      = useState<LogEntry[]>([])

  // ── UI state ───────────────────────────────────────────────────────────────
  const [configLoaded, setConfigLoaded] = useState(false)
  const [saving,  setSaving]    = useState(false)
  const [testing, setTesting]   = useState(false)
  const [syncing, setSyncing]   = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load config — CHỈ 1 LẦN khi mount ────────────────────────────────────
  const loadConfig = useCallback(async () => {
    try {
      const cfg = await apiFetch("GET", "/bot/sync-robot/config")
      // Nếu server trả "***" thì password cũ đang tồn tại — KHÔNG gán vào formData
      const serverHasPw = cfg.password === "***" || (cfg.password && cfg.password !== "")
      setHasServerPassword(serverHasPw)
      setFormData({
        site_url:   cfg.site_url   ?? "",
        login_url:  cfg.login_url  ?? "",
        orders_url: cfg.orders_url ?? "",
        email:      cfg.email      ?? "",
        password:   "",           // luôn để trống, placeholder chỉ thông báo đã có pw
        interval_s: cfg.interval_s ?? 300,
      })
      setConfigLoaded(true)
    } catch (e: any) {
      toast({ title: "Lỗi tải cấu hình", description: e.message, variant: "destructive" })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll status + logs — KHÔNG đụng formData ──────────────────────────────
  const pollStatus = useCallback(async () => {
    try {
      const [st, lg] = await Promise.all([
        apiFetch("GET", "/bot/sync-robot/status"),
        apiFetch("GET", "/bot/sync-robot/logs"),
      ])
      setStatus({
        enabled:    st.enabled    ?? false,
        running:    st.running    ?? false,
        updated_at: st.updated_at ?? null,
        next_run_at: st.next_run_at ?? null,
        last_run:   st.last_run   ?? null,
      })
      setLogs(Array.isArray(lg) ? [...lg].reverse() : [])
    } catch {
      // polling failure — im lặng, không toast
    }
  }, [])

  // ── Mount: load config 1 lần, bắt đầu poll status ─────────────────────────
  useEffect(() => {
    loadConfig()
    pollStatus()
    pollRef.current = setInterval(pollStatus, 8_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [loadConfig, pollStatus])

  // ── Form field updater — đánh dấu dirty ───────────────────────────────────
  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setFormData(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  // ── Build body gửi lên server ──────────────────────────────────────────────
  function buildConfigBody(extraEnabled?: boolean) {
    const body: any = {
      site_url:   formData.site_url,
      login_url:  formData.login_url,
      orders_url: formData.orders_url,
      email:      formData.email,
      interval_s: formData.interval_s,
    }
    if (extraEnabled !== undefined) body.enabled = extraEnabled
    // Chỉ gửi password nếu người dùng thật sự gõ mới (không phải "" hay "***")
    if (formData.password && formData.password !== "***") {
      body.password = formData.password
    }
    return body
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault()
    setSaving(true)
    try {
      const saved = await apiFetch("PUT", "/bot/sync-robot/config", buildConfigBody())
      setIsDirty(false)
      // Nếu user vừa lưu password mới, cập nhật trạng thái
      if (formData.password && formData.password !== "***") {
        setHasServerPassword(true)
        setFormData(prev => ({ ...prev, password: "" }))
      }
      // Cập nhật enabled từ response (nếu server trả về)
      if (saved?.enabled !== undefined) {
        setStatus(prev => ({ ...prev, enabled: saved.enabled }))
      }
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
      await apiFetch("PUT", "/bot/sync-robot/config", buildConfigBody(enabled))
      setStatus(prev => ({ ...prev, enabled }))
      toast({ title: enabled ? "✅ Robot đã bật" : "⏹ Robot đã tắt" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  // ── Test login ─────────────────────────────────────────────────────────────
  async function handleTest() {
    setTesting(true)
    try {
      const result = await apiFetch("POST", "/bot/sync-robot/test-login", buildConfigBody())
      if (result.ok) {
        toast({ title: "✅ Đăng nhập thành công!", description: result.message })
      } else {
        toast({ title: "❌ Đăng nhập thất bại", description: result.message, variant: "destructive" })
      }
    } catch (e: any) {
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

  // ── Reload manual (nút Làm mới) ────────────────────────────────────────────
  async function handleManualRefresh() {
    await Promise.all([loadConfig(), pollStatus()])
    setIsDirty(false)
  }

  // ── Step icon ──────────────────────────────────────────────────────────────
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

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Robot Đồng Bộ</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tự động tải XLSX từ website bán hàng và import đơn hàng theo chu kỳ
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              status.enabled  ? "bg-yellow-400"              :
                                "bg-gray-400"
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
            {/* form với preventDefault để không reload trang */}
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
                      placeholder={hasServerPassword && !formData.password ? "Đã lưu mật khẩu — để trống để giữ nguyên" : "Nhập mật khẩu mới"}
                      value={formData.password}
                      onChange={(e) => {
                        // setField tự đánh dấu dirty
                        setField("password", e.target.value)
                      }}
                      className="pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                      onClick={() => setShowPw((v) => !v)}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {hasServerPassword && !formData.password && (
                    <p className="text-xs text-muted-foreground">
                      Mật khẩu đã lưu — nhập mới để thay đổi.
                    </p>
                  )}
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Chu kỳ đồng bộ</Label>
                  <Select
                    value={String(formData.interval_s)}
                    onValueChange={(v) => setField("interval_s", Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVALS.map((i) => (
                        <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex flex-wrap gap-2 pt-2">
                {/* Nút Lưu là submit thật — có preventDefault qua onSubmit */}
                <Button type="submit" disabled={saving}>
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Đang lưu..." : "Lưu cấu hình"}
                </Button>
                <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                  <Plug className="h-4 w-4 mr-2" />
                  {testing ? "Đang kiểm tra..." : "Kiểm tra đăng nhập"}
                </Button>
                <Button type="button" variant="secondary" onClick={handleSyncNow} disabled={syncing || status.running}>
                  <Play className="h-4 w-4 mr-2" />
                  {syncing ? "Đã kích hoạt..." : "Đồng bộ ngay"}
                </Button>
              </div>
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

                  {/* Step progress */}
                  <div className="space-y-1.5">
                    {([
                      { label: "Đăng nhập",       ok: lastRun.login_ok    },
                      { label: "Tải file XLSX",    ok: lastRun.download_ok },
                      { label: "Import đơn hàng", ok: lastRun.import_ok   },
                    ] as const).map((s) => (
                      <div key={s.label} className="flex items-center gap-2 text-xs">
                        <StepIcon ok={s.ok} />
                        <span className={s.ok ? "" : "text-muted-foreground"}>{s.label}</span>
                      </div>
                    ))}
                  </div>

                  <hr className="border-border" />

                  {/* Stats */}
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

                  {/* Result message */}
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

          {/* Làm mới thủ công — load lại cả config lẫn status */}
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
          <CardDescription>Tối đa 200 lần gần nhất, mới nhất trước</CardDescription>
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
                      <td className="px-4 py-2 text-right font-medium text-green-600">{log.new_orders}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{log.skipped_orders}</td>
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
