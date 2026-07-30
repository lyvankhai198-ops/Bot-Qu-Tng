/**
 * market-orders.tsx — Trang "Đơn hàng chợ"
 * Hoàn toàn độc lập với orders.tsx — không sửa đổi trang cũ.
 */
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Search, RefreshCw, Loader2, CheckCircle2, AlertCircle,
  Clock, ShoppingBag, TrendingUp, Package, Settings, Save,
  ChevronDown, ChevronUp, Wifi, WifiOff,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// ── Auth ──────────────────────────────────────────────────────────────────────
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
interface MarketOrder {
  order_id:         string
  stt:              string
  seller:           string
  buyer:            string
  product_name:     string
  quantity:         string
  price:            string   // Giá nguồn (mua)
  sell_price:       string   // Số tiền (bán)
  fee:              string   // Phí chợ
  status:           string
  status_tx:        string
  completed_at:     string
  created_at_raw:   string
  balance_after:    string
  synced_at:        string
  order_source:     string
}

interface SyncStatus {
  running:          boolean
  last_started_at?: string
  total_stored:     number
  updated_at?:      string
  last_run?: {
    success:        boolean
    new_orders:     number
    updated_orders: number
    skipped_orders: number
    errors:         number
    message:        string
    ended_at:       string
    duration_s:     number
    sheets_added?:  number
  }
}

interface MarketConfig {
  market_sync_enabled: boolean
  market_sync_hour:    number
  market_sync_minute:  number
  market_tab:          string
  has_site_url:        boolean
  has_email:           boolean
  has_password:        boolean
}

const CONFIG_DEFAULT: MarketConfig = {
  market_sync_enabled: true,
  market_sync_hour:    3,
  market_sync_minute:  0,
  market_tab:          "Đơn hàng chợ",
  has_site_url:        false,
  has_email:           false,
  has_password:        false,
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusVariant(s?: string): "default" | "secondary" | "destructive" | "outline" {
  if (!s) return "outline"
  const l = s.toLowerCase()
  if (l.includes("hoàn") || l.includes("thành công") || l.includes("complete"))
    return "default"
  if (l.includes("hủy") || l.includes("lỗi") || l.includes("fail") || l.includes("error"))
    return "destructive"
  if (l.includes("chờ") || l.includes("pending") || l.includes("đang"))
    return "secondary"
  return "outline"
}

function fmtDate(s?: string) {
  if (!s) return "—"
  try {
    // Handle "HH:MM:SS DD/MM/YYYY" format from canboso
    const m = s.match(/^(\d{2}:\d{2}(?::\d{2})?) (\d{2})\/(\d{2})\/(\d{4})$/)
    if (m) return `${m[2]}/${m[3]}/${m[4]} ${m[1]}`
    return new Date(s).toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    })
  } catch { return s }
}

// ── Google Sheets Status Banner ───────────────────────────────────────────────
interface SheetsStatus {
  connected:    boolean
  message:      string
  fix?:         string
  project_id?:  string
  client_email?: string
}

function GoogleSheetsStatusBanner() {
  const [status,  setStatus]  = useState<SheetsStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch("GET", "/bot/sheets/status")
      .then((d: SheetsStatus) => setStatus(d))
      .catch(() => setStatus({ connected: false, message: "Không thể kiểm tra trạng thái Google Sheets." }))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang kiểm tra kết nối Google Sheets…
    </div>
  )

  if (!status) return null

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
      status.connected
        ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
        : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
    }`}>
      {status.connected
        ? <Wifi    className="h-4 w-4 mt-0.5 flex-shrink-0" />
        : <WifiOff className="h-4 w-4 mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="font-medium">{status.message}</p>
        {status.connected && status.client_email && (
          <p className="text-xs opacity-70 mt-0.5 truncate">
            {status.client_email} · {status.project_id}
          </p>
        )}
        {!status.connected && status.fix && (
          <p className="text-xs opacity-80 mt-0.5">{status.fix}</p>
        )}
      </div>
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel() {
  const { toast } = useToast()
  const [open,    setOpen]    = useState(false)
  const [cfg,     setCfg]     = useState<MarketConfig>(CONFIG_DEFAULT)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(false)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data: MarketConfig = await apiFetch("GET", "/bot/market-orders/config")
      setCfg(data)
    } catch (e: any) {
      toast({ title: "Lỗi tải cấu hình", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  async function saveConfig() {
    setSaving(true)
    try {
      const res = await apiFetch("PUT", "/bot/market-orders/config", {
        market_sync_enabled: cfg.market_sync_enabled,
        market_sync_hour:    cfg.market_sync_hour,
        market_sync_minute:  cfg.market_sync_minute,
        market_tab:          cfg.market_tab,
      })
      toast({ title: res.ok ? "Đã lưu cấu hình" : "Lỗi", description: res.message,
              variant: res.ok ? "default" : "destructive" })
    } catch (e: any) {
      toast({ title: "Lỗi lưu cấu hình", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)
  const minutes = [0, 15, 30, 45]

  return (
    <Card>
      {/* Header — click để toggle */}
      <button
        type="button"
        className="w-full text-left"
        onClick={() => setOpen(v => !v)}
      >
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-muted-foreground" />
              Cài đặt đồng bộ
            </span>
            <span className="flex items-center gap-2">
              {/* Trạng thái nhanh */}
              {!loading && (
                <Badge variant={cfg.market_sync_enabled ? "default" : "secondary"} className="text-xs font-normal">
                  {cfg.market_sync_enabled
                    ? `Tự động ${String(cfg.market_sync_hour).padStart(2, "0")}:${String(cfg.market_sync_minute).padStart(2, "0")}`
                    : "Tắt tự động"}
                </Badge>
              )}
              {open
                ? <ChevronUp   className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </span>
          </CardTitle>
        </CardHeader>
      </button>

      {/* Body — chỉ hiện khi mở */}
      {open && (
        <CardContent className="pt-0 space-y-5">
          {/* Trạng thái kết nối Google Sheets */}
          <GoogleSheetsStatusBanner />

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tải…
            </div>
          ) : (
            <>
              {/* Trạng thái website */}
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm space-y-1">
                <p className="font-medium text-muted-foreground mb-2">Kết nối website canboso.com</p>
                <div className="flex flex-wrap gap-3">
                  <StatusDot ok={cfg.has_site_url}  label="URL"       />
                  <StatusDot ok={cfg.has_email}      label="Tài khoản" />
                  <StatusDot ok={cfg.has_password}   label="Mật khẩu" />
                </div>
                {(!cfg.has_site_url || !cfg.has_email || !cfg.has_password) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    ⚠ Chưa đủ thông tin đăng nhập — cấu hình trong trang <strong>Robot đồng bộ</strong>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">

                {/* Bật/tắt tự động */}
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <Label className="text-sm font-medium">Tự động đồng bộ hàng ngày</Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Chạy 1 lần/ngày theo giờ đặt bên dưới
                    </p>
                  </div>
                  <Switch
                    checked={cfg.market_sync_enabled}
                    onCheckedChange={v => setCfg(c => ({ ...c, market_sync_enabled: v }))}
                  />
                </div>

                {/* Giờ đồng bộ */}
                <div className={`space-y-2 rounded-lg border px-4 py-3 transition-opacity ${
                  !cfg.market_sync_enabled ? "opacity-40 pointer-events-none" : ""
                }`}>
                  <Label className="text-sm font-medium">Giờ đồng bộ tự động</Label>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <Select
                        value={String(cfg.market_sync_hour)}
                        onValueChange={v => setCfg(c => ({ ...c, market_sync_hour: Number(v) }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Giờ" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          {hours.map(h => (
                            <SelectItem key={h} value={String(h)}>
                              {String(h).padStart(2, "0")} giờ
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="text-muted-foreground font-medium">:</span>
                    <div className="w-28">
                      <Select
                        value={String(cfg.market_sync_minute)}
                        onValueChange={v => setCfg(c => ({ ...c, market_sync_minute: Number(v) }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Phút" />
                        </SelectTrigger>
                        <SelectContent>
                          {minutes.map(m => (
                            <SelectItem key={m} value={String(m)}>
                              {String(m).padStart(2, "0")} phút
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      (VN)
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Sẽ chạy lúc{" "}
                    <strong>
                      {String(cfg.market_sync_hour).padStart(2, "0")}:{String(cfg.market_sync_minute).padStart(2, "0")}
                    </strong>{" "}
                    mỗi ngày (Asia/Ho_Chi_Minh)
                  </p>
                </div>

                {/* Tên tab Google Sheets */}
                <div className="space-y-2 rounded-lg border px-4 py-3 sm:col-span-2">
                  <Label htmlFor="market-tab" className="text-sm font-medium">
                    Tên tab Google Sheets
                  </Label>
                  <Input
                    id="market-tab"
                    value={cfg.market_tab}
                    onChange={e => setCfg(c => ({ ...c, market_tab: e.target.value }))}
                    placeholder="Đơn hàng chợ"
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Dữ liệu đồng bộ sẽ được ghi vào tab này trong Google Sheets.
                    Tab sẽ được tạo tự động nếu chưa tồn tại.
                  </p>
                </div>
              </div>

              {/* Save button */}
              <div className="flex justify-end pt-1">
                <Button onClick={saveConfig} disabled={saving} size="sm">
                  {saving
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang lưu…</>
                    : <><Save    className="h-4 w-4 mr-2" />Lưu cài đặt</>}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-green-500" : "bg-red-400"}`} />
      {label}: <strong>{ok ? "OK" : "Chưa có"}</strong>
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function MarketOrders() {
  const { toast } = useToast()

  const [orders,        setOrders]        = useState<MarketOrder[]>([])
  const [status,        setStatus]        = useState<SyncStatus | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [syncing,       setSyncing]       = useState(false)
  const [total,         setTotal]         = useState(0)
  const [search,        setSearch]        = useState("")
  const [filterStatus,  setFilterStatus]  = useState("all")

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (search.trim())                          params.set("search", search.trim())
      if (filterStatus && filterStatus !== "all") params.set("status", filterStatus)
      const data = await apiFetch("GET", `/bot/market-orders?${params.toString()}`)
      setOrders(data.orders ?? [])
      setTotal(data.total ?? 0)
    } catch (e: any) {
      toast({ title: "Lỗi tải đơn hàng chợ", description: e.message, variant: "destructive" })
    }
  }, [search, filterStatus])

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch("GET", "/bot/market-orders/status")
      setStatus(data)
    } catch {}
  }, [])

  useEffect(() => {
    Promise.all([fetchOrders(), fetchStatus()]).finally(() => setLoading(false))
  }, [fetchOrders, fetchStatus])

  // Poll khi đang sync
  useEffect(() => {
    if (!status?.running) return
    const id = setInterval(async () => {
      await fetchStatus()
      await fetchOrders()
    }, 3000)
    return () => clearInterval(id)
  }, [status?.running])

  // ── Manual sync ──────────────────────────────────────────────────────────
  async function triggerSync() {
    setSyncing(true)
    try {
      const res = await apiFetch("POST", "/bot/market-orders/sync")
      toast({
        title: res.ok ? "Đã khởi động đồng bộ" : "Không thể đồng bộ",
        description: res.message,
        variant: res.ok ? "default" : "destructive",
      })
      if (res.ok) setStatus(prev => prev ? { ...prev, running: true } : prev)
    } catch (e: any) {
      toast({ title: "Lỗi kích hoạt sync", description: e.message, variant: "destructive" })
    } finally {
      setSyncing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const lastRun = status?.last_run

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Đơn hàng chợ</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Đơn hàng từ kênh chợ — đồng bộ độc lập với luồng "Tất cả đơn hàng"
          </p>
        </div>
        <Button
          onClick={triggerSync}
          disabled={syncing || status?.running}
          className="self-start sm:self-auto"
        >
          {(syncing || status?.running)
            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang đồng bộ…</>
            : <><RefreshCw className="h-4 w-4 mr-2" />Đồng bộ ngay</>}
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <ShoppingBag className="h-8 w-8 text-primary flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Tổng đơn</p>
              <p className="text-xl font-bold">{status?.total_stored ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Package className="h-8 w-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Mới nhất</p>
              <p className="text-xl font-bold">{lastRun?.new_orders ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Cập nhật</p>
              <p className="text-xl font-bold">{lastRun?.updated_orders ?? "—"}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-muted-foreground flex-shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Lần cuối sync</p>
              <p className="text-sm font-medium leading-tight">
                {lastRun?.ended_at ? fmtDate(lastRun.ended_at) : "Chưa sync"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last sync result banner */}
      {lastRun && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
          lastRun.success
            ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
            : "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/30 dark:border-red-800 dark:text-red-300"
        }`}>
          {lastRun.success
            ? <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            : <AlertCircle  className="h-4 w-4 mt-0.5 flex-shrink-0" />}
          <span className="flex-1">{lastRun.message || (lastRun.success ? "Đồng bộ thành công" : "Đồng bộ thất bại")}</span>
          <span className="text-xs opacity-60 flex-shrink-0">{lastRun.duration_s}s</span>
        </div>
      )}

      {/* Running indicator */}
      {status?.running && (
        <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 animate-pulse">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang đồng bộ dữ liệu từ website — trang sẽ tự cập nhật…
        </div>
      )}

      {/* ── Settings Panel ─────────────────────────────────────────────────── */}
      <SettingsPanel />

      {/* Search + filter */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo mã đơn, seller, sản phẩm…"
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchOrders()}
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả trạng thái</SelectItem>
                <SelectItem value="completed">Hoàn tất</SelectItem>
                <SelectItem value="pending">Chờ xử lý</SelectItem>
                <SelectItem value="cancel">Đã hủy</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={fetchOrders}>
              <Search className="h-4 w-4 mr-2" />Tìm
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Orders table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Danh sách đơn hàng chợ
            {!loading && (
              <span className="ml-2 text-muted-foreground font-normal text-sm">({total})</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center items-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <ShoppingBag className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Chưa có đơn hàng chợ nào</p>
              <p className="text-sm mt-1">
                {search || filterStatus !== "all"
                  ? "Không tìm thấy kết quả — thử thay đổi bộ lọc"
                  : "Nhấn \"Đồng bộ ngay\" để tải đơn hàng từ website"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap w-8">#</TableHead>
                    <TableHead className="whitespace-nowrap">Mã đơn</TableHead>
                    <TableHead className="whitespace-nowrap">Seller bán</TableHead>
                    <TableHead className="whitespace-nowrap">Sản phẩm</TableHead>
                    <TableHead className="whitespace-nowrap text-right">SL</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Giá nguồn</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Số tiền</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Phí chợ</TableHead>
                    <TableHead className="whitespace-nowrap">Trạng thái GD</TableHead>
                    <TableHead className="whitespace-nowrap">Chốt lúc</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map(order => (
                    <TableRow key={order.order_id} className="hover:bg-muted/30">
                      <TableCell className="text-xs text-muted-foreground">
                        {order.stt || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {order.order_id}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {order.seller || "—"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={order.product_name}>
                        {order.product_name || "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {order.quantity || "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm font-medium">
                        {order.price || "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-sm font-medium text-blue-600 dark:text-blue-400">
                        {order.sell_price || "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap text-xs text-muted-foreground">
                        {order.fee || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {order.status_tx || order.status
                          ? <Badge variant={statusVariant(order.status_tx || order.status)} className="text-xs">
                              {order.status_tx || order.status}
                            </Badge>
                          : "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {order.completed_at ? fmtDate(order.completed_at) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
