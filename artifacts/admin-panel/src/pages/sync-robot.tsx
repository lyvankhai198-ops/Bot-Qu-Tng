import { useState, useEffect, useRef } from "react"
import { useToast } from "@/hooks/use-toast"
import { apiClient } from "@workspace/api-client-react"
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
import { RefreshCw, Play, Plug, Save, Eye, EyeOff, CheckCircle2, XCircle, Clock, Activity } from "lucide-react"

// ── Types ─────────────────────────────────────────────────────────────────────
type Config = {
  enabled: boolean
  site_url: string
  login_url: string
  orders_url: string
  email: string
  password: string   // "***" when returned by API
  interval_s: number
}

type SyncStatus = {
  running: boolean
  updated_at: string | null
  next_run_at: string | null
  last_run: {
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
  } | null
}

type LogEntry = {
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

const INTERVALS = [
  { value: "30", label: "30 giây" },
  { value: "60", label: "1 phút" },
  { value: "120", label: "2 phút" },
  { value: "300", label: "5 phút" },
  { value: "600", label: "10 phút" },
]

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("vi-VN", { hour12: false })
  } catch {
    return iso
  }
}

function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60), rem = s % 60
  return `${m}m ${rem}s`
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function SyncRobot() {
  const { toast } = useToast()
  const [config, setConfig] = useState<Config>({
    enabled: false,
    site_url: "",
    login_url: "",
    orders_url: "",
    email: "",
    password: "",
    interval_s: 300,
  })
  const [showPw, setShowPw] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load config + status ───────────────────────────────────────────────────
  async function reload() {
    try {
      const [cfgRes, statusRes, logsRes] = await Promise.all([
        apiClient.get("/bot/sync-robot/config"),
        apiClient.get("/bot/sync-robot/status"),
        apiClient.get("/bot/sync-robot/logs"),
      ])
      setConfig((prev) => ({
        ...cfgRes,
        password: passwordChanged ? prev.password : "***",
      }))
      setStatus(statusRes)
      setLogs(Array.isArray(logsRes) ? logsRes.slice().reverse() : [])
    } catch (e: any) {
      // silent on poll
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    pollRef.current = setInterval(reload, 8_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ── Save config ────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      const body: any = { ...config }
      if (!passwordChanged) delete body.password  // don't overwrite with "***"
      await apiClient.put("/bot/sync-robot/config", body)
      setPasswordChanged(false)
      toast({ title: "Đã lưu cấu hình robot" })
      reload()
    } catch (e: any) {
      toast({ title: "Lỗi lưu cấu hình", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // ── Test login ─────────────────────────────────────────────────────────────
  async function handleTest() {
    setTesting(true)
    try {
      const body: any = { ...config }
      if (!passwordChanged) delete body.password
      const res = await apiClient.post("/bot/sync-robot/test-login", body)
      if (res.ok) {
        toast({ title: "✅ Đăng nhập thành công!" })
      } else {
        toast({ title: "❌ Đăng nhập thất bại", description: res.message || "Kiểm tra lại URL/email/mật khẩu", variant: "destructive" })
      }
    } catch (e: any) {
      toast({ title: "❌ Lỗi kết nối", description: e.message, variant: "destructive" })
    } finally {
      setTesting(false)
    }
  }

  // ── Sync now ───────────────────────────────────────────────────────────────
  async function handleSyncNow() {
    setSyncing(true)
    try {
      await apiClient.post("/bot/sync-robot/trigger", {})
      toast({ title: "🔄 Đã kích hoạt đồng bộ ngay", description: "Robot sẽ chạy trong vài giây..." })
      setTimeout(reload, 3000)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setTimeout(() => setSyncing(false), 2000)
    }
  }

  // ── Toggle enabled ─────────────────────────────────────────────────────────
  async function handleToggleEnabled(enabled: boolean) {
    try {
      await apiClient.put("/bot/sync-robot/config", { ...config, enabled, password: passwordChanged ? config.password : undefined })
      setConfig((prev) => ({ ...prev, enabled }))
      toast({ title: enabled ? "✅ Robot đã bật" : "⏹ Robot đã tắt" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  // ── Step indicator ─────────────────────────────────────────────────────────
  function StepIcon({ ok }: { ok: boolean | null }) {
    if (ok === null) return <Clock className="h-4 w-4 text-muted-foreground" />
    return ok
      ? <CheckCircle2 className="h-4 w-4 text-green-500" />
      : <XCircle className="h-4 w-4 text-red-500" />
  }

  const lastRun = status?.last_run

  if (loading) {
    return <div className="flex items-center justify-center h-40 text-muted-foreground">Đang tải...</div>
  }

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Robot Đồng Bộ</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Tự động tải XLSX từ website bán hàng và import đơn hàng theo chu kỳ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={status?.running ? "default" : config.enabled ? "outline" : "secondary"}
            className="gap-1"
          >
            <span className={`h-2 w-2 rounded-full ${status?.running ? "bg-green-400 animate-pulse" : config.enabled ? "bg-yellow-400" : "bg-gray-400"}`} />
            {status?.running ? "Đang chạy" : config.enabled ? "Chờ chu kỳ" : "Tắt"}
          </Badge>
          <Button
            size="sm"
            variant={config.enabled ? "destructive" : "default"}
            onClick={() => handleToggleEnabled(!config.enabled)}
          >
            {config.enabled ? "Tắt robot" : "Bật robot"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* ── Config form ── */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Cấu hình</CardTitle>
            <CardDescription>Thông tin đăng nhập website bán hàng</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label>URL website</Label>
                <Input
                  placeholder="https://shop.example.com"
                  value={config.site_url}
                  onChange={(e) => setConfig((p) => ({ ...p, site_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>URL trang đăng nhập <span className="text-xs text-muted-foreground">(để trống = tự tìm)</span></Label>
                <Input
                  placeholder="https://shop.example.com/login"
                  value={config.login_url}
                  onChange={(e) => setConfig((p) => ({ ...p, login_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>URL trang đơn hàng <span className="text-xs text-muted-foreground">(để trống = tự tìm)</span></Label>
                <Input
                  placeholder="https://shop.example.com/orders"
                  value={config.orders_url}
                  onChange={(e) => setConfig((p) => ({ ...p, orders_url: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email đăng nhập</Label>
                <Input
                  type="email"
                  placeholder="admin@shop.example.com"
                  value={config.email}
                  onChange={(e) => setConfig((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mật khẩu</Label>
                <div className="relative">
                  <Input
                    type={showPw ? "text" : "password"}
                    placeholder="••••••••"
                    value={config.password}
                    onChange={(e) => {
                      setConfig((p) => ({ ...p, password: e.target.value }))
                      setPasswordChanged(true)
                    }}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">Được mã hóa, không hiển thị sau khi lưu</p>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label>Chu kỳ đồng bộ</Label>
                <Select
                  value={String(config.interval_s)}
                  onValueChange={(v) => setConfig((p) => ({ ...p, interval_s: Number(v) }))}
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

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleSave} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                {saving ? "Đang lưu..." : "Lưu cấu hình"}
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing}>
                <Plug className="h-4 w-4 mr-2" />
                {testing ? "Đang kiểm tra..." : "Kiểm tra đăng nhập"}
              </Button>
              <Button variant="secondary" onClick={handleSyncNow} disabled={syncing || status?.running}>
                <Play className="h-4 w-4 mr-2" />
                {syncing ? "Đã kích hoạt..." : "Đồng bộ ngay"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Status panel ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Next run */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                Trạng thái
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Chu kỳ tiếp theo</span>
                <span className="font-mono text-xs">{fmtDate(status?.next_run_at)}</span>
              </div>
              {lastRun && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lần cuối chạy</span>
                    <span className="font-mono text-xs">{fmtDate(lastRun.started_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Thời gian chạy</span>
                    <span>{fmtDuration(lastRun.duration_s)}</span>
                  </div>
                  <hr className="border-border" />
                  {/* Steps */}
                  <div className="space-y-1">
                    {[
                      { label: "Đăng nhập", ok: lastRun.login_ok },
                      { label: "Tải file XLSX", ok: lastRun.download_ok },
                      { label: "Import đơn hàng", ok: lastRun.import_ok },
                    ].map((step) => (
                      <div key={step.label} className="flex items-center gap-2">
                        <StepIcon ok={step.ok} />
                        <span className={step.ok ? "" : "text-muted-foreground"}>{step.label}</span>
                      </div>
                    ))}
                  </div>
                  <hr className="border-border" />
                  {/* Stats */}
                  <div className="grid grid-cols-3 text-center gap-2">
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
                  {/* Message */}
                  <p className={`text-xs rounded p-2 ${lastRun.success ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                    {lastRun.message}
                  </p>
                </>
              )}
              {!lastRun && (
                <p className="text-muted-foreground text-xs">Chưa có lần chạy nào.</p>
              )}
            </CardContent>
          </Card>

          {/* Refresh button */}
          <Button variant="outline" size="sm" className="w-full" onClick={reload}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Làm mới
          </Button>
        </div>
      </div>

      {/* ── Log table ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lịch sử đồng bộ</CardTitle>
          <CardDescription>Tối đa 200 lần gần nhất</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">Chưa có lịch sử.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">Thời gian</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Trạng thái</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Mới</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Bỏ qua</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Lỗi</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Thời gian</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Thông báo</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {fmtDate(log.started_at)}
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant={log.success ? "outline" : "destructive"} className="gap-1 text-xs">
                          {log.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
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
