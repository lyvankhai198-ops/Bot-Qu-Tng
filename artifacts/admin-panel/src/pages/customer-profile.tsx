/**
 * customer-profile.tsx — Trang "Hồ sơ khách hàng"
 * 6 tab: Tổng quan | Cấu hình hiển thị | Điểm & điểm danh | Thành tích | Phần thưởng | Lịch sử giao dịch
 */
import { useState, useCallback, useEffect } from "react"
import {
  Users, BarChart3, Settings2, CalendarCheck, Trophy, Gift, History,
  RefreshCw, Save, ToggleLeft, ToggleRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"

// ── Auth helper ───────────────────────────────────────────────────────────────
function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, p: string, body?: any): Promise<any> {
  const res = await fetch(`/api${p}`, {
    method,
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProfileConfig {
  profileEnabled: boolean
  showOrders: boolean
  showWarranty: boolean
  showPoints: boolean
  showLog: boolean
  showSettings: boolean
  showAchievements: boolean
  showRewards: boolean
  showFavorites: boolean
  showStats: boolean
}

interface AdminStats {
  usersWithCheckin: number
  totalPoints: number
  topStreak: number
  checkedToday: number
  usersWithPrefs: number
}

const DEFAULT_CONFIG: ProfileConfig = {
  profileEnabled: true,
  showOrders: true,
  showWarranty: true,
  showPoints: true,
  showLog: true,
  showSettings: true,
  showAchievements: false,
  showRewards: false,
  showFavorites: false,
  showStats: false,
}

// ── Tab list ──────────────────────────────────────────────────────────────────
const TABS = [
  { id: "overview",  label: "Tổng quan",              icon: BarChart3 },
  { id: "config",    label: "Cấu hình hiển thị",      icon: Settings2 },
  { id: "points",    label: "Điểm & điểm danh",       icon: CalendarCheck },
  { id: "achieve",   label: "Thành tích",              icon: Trophy },
  { id: "rewards",   label: "Phần thưởng đổi điểm",  icon: Gift },
  { id: "history",   label: "Lịch sử giao dịch",      icon: History },
]

// ── Toggle row ────────────────────────────────────────────────────────────────
function ToggleRow({
  label, description, checked, onChange, disabled,
}: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 border-b last:border-0 ${disabled ? "opacity-50" : ""}`}>
      <div>
        <p className="text-sm font-medium leading-tight">{label}</p>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => !disabled && onChange(!checked)}
        className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
          checked ? "text-green-600 hover:text-green-700" : "text-muted-foreground hover:text-foreground"
        }`}
        disabled={disabled}
      >
        {checked
          ? <ToggleRight className="w-6 h-6" />
          : <ToggleLeft  className="w-6 h-6" />}
        {checked ? "Bật" : "Tắt"}
      </button>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color = "text-blue-600" }: {
  label: string; value: string | number; icon: React.ElementType; color?: string
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="pt-5 pb-4 px-5">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-muted ${color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-tight">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Placeholder tab ───────────────────────────────────────────────────────────
function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border-2 border-dashed border-muted-foreground/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            🚧 Tính năng này sẽ được triển khai trong giai đoạn tiếp theo.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function OverviewTab({ stats, loadingStats, onRefresh }: {
  stats: AdminStats | null; loadingStats: boolean; onRefresh: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Thống kê tổng hợp
        </h2>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loadingStats} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </div>

      {loadingStats && !stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="pt-5 pb-4 px-5 h-20" /></Card>
          ))}
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
          <StatCard label="User đã điểm danh" value={stats.usersWithCheckin} icon={Users} color="text-blue-600" />
          <StatCard label="Tổng điểm đã cấp" value={stats.totalPoints.toLocaleString()} icon={BarChart3} color="text-yellow-600" />
          <StatCard label="Chuỗi dài nhất" value={`${stats.topStreak} ngày`} icon={CalendarCheck} color="text-orange-600" />
          <StatCard label="Điểm danh hôm nay" value={stats.checkedToday} icon={Users} color="text-green-600" />
          <StatCard label="User đã cài thông báo" value={stats.usersWithPrefs} icon={Settings2} color="text-purple-600" />
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hướng dẫn nhanh</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1.5">
          <p>• <strong>Tab "Cấu hình"</strong>: Bật/tắt từng tính năng trong Hồ sơ khách hàng trên bot.</p>
          <p>• <strong>Tắt toàn bộ Hồ sơ</strong>: Bot sẽ hiện thông báo bảo trì thay vì màn hình hồ sơ.</p>
          <p>• <strong>Thành tích & Đổi quà</strong>: Mặc định tắt, sẽ khả dụng ở giai đoạn tiếp theo.</p>
          <p>• <strong>Liên kết đơn hàng</strong>: Chỉ hiện đơn có Telegram ID / username khớp chắc chắn.</p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Config tab ────────────────────────────────────────────────────────────────
function ConfigTab({ config, onChange, onSave, saving }: {
  config: ProfileConfig
  onChange: (c: ProfileConfig) => void
  onSave: () => void
  saving: boolean
}) {
  const set = (key: keyof ProfileConfig) => (v: boolean) => onChange({ ...config, [key]: v })

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Bật/tắt tính năng Hồ sơ</CardTitle>
              <CardDescription className="mt-0.5">
                Thay đổi sẽ áp dụng cho bot sau khi lưu. Tắt "Bật Hồ sơ" sẽ ẩn toàn bộ tính năng.
              </CardDescription>
            </div>
            <Button onClick={onSave} disabled={saving} size="sm" className="gap-1.5 shrink-0">
              <Save className="w-3.5 h-3.5" />
              {saving ? "Đang lưu…" : "Lưu cấu hình"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ToggleRow
            label="Bật Hồ sơ khách hàng"
            description="Tắt để ẩn toàn bộ tính năng, bot hiện thông báo bảo trì"
            checked={config.profileEnabled}
            onChange={set("profileEnabled")}
          />

          <div className="mt-3 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mặc định bật
            </p>
          </div>
          <ToggleRow label="Hiện Đơn hàng của tôi" checked={config.showOrders} onChange={set("showOrders")} disabled={!config.profileEnabled} />
          <ToggleRow label="Hiện Bảo hành của tôi" checked={config.showWarranty} onChange={set("showWarranty")} disabled={!config.profileEnabled} />
          <ToggleRow label="Hiện Điểm tích lũy" checked={config.showPoints} onChange={set("showPoints")} disabled={!config.profileEnabled} />
          <ToggleRow label="Hiện Nhật ký hoạt động" checked={config.showLog} onChange={set("showLog")} disabled={!config.profileEnabled} />
          <ToggleRow label="Hiện Cài đặt thông báo" checked={config.showSettings} onChange={set("showSettings")} disabled={!config.profileEnabled} />

          <div className="mt-4 mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Mặc định tắt — cần cấu hình thêm
            </p>
          </div>
          <ToggleRow
            label="Hiện Thành tích"
            description="Khả dụng sau khi triển khai giai đoạn 2"
            checked={config.showAchievements}
            onChange={set("showAchievements")}
            disabled={!config.profileEnabled}
          />
          <ToggleRow
            label="Hiện Đổi quà"
            description="Cần tạo ít nhất một phần thưởng trước"
            checked={config.showRewards}
            onChange={set("showRewards")}
            disabled={!config.profileEnabled}
          />
          <ToggleRow
            label="Hiện Yêu thích"
            description="Khả dụng ở giai đoạn tiếp theo"
            checked={config.showFavorites}
            onChange={set("showFavorites")}
            disabled={!config.profileEnabled}
          />
          <ToggleRow
            label="Hiện Thống kê mua hàng"
            description="Khả dụng ở giai đoạn tiếp theo"
            checked={config.showStats}
            onChange={set("showStats")}
            disabled={!config.profileEnabled}
          />
        </CardContent>
      </Card>

      <Card className="shadow-sm bg-amber-50 border-amber-200">
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-sm text-amber-800">
            ⚠️ Các thay đổi config được bot đọc trực tiếp từ file. Sau khi lưu, tắt mở lại menu hồ sơ trên bot để thấy thay đổi.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Points tab ────────────────────────────────────────────────────────────────
function PointsTab({ stats, loadingStats, onRefresh }: {
  stats: AdminStats | null; loadingStats: boolean; onRefresh: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Thống kê điểm danh
        </h2>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={loadingStats} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? "animate-spin" : ""}`} />
          Làm mới
        </Button>
      </div>

      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="User đã điểm danh" value={stats.usersWithCheckin} icon={Users} color="text-blue-600" />
          <StatCard label="Tổng điểm đã cấp" value={stats.totalPoints.toLocaleString()} icon={BarChart3} color="text-yellow-600" />
          <StatCard label="Chuỗi cao nhất" value={`${stats.topStreak} ngày`} icon={CalendarCheck} color="text-orange-600" />
          <StatCard label="Điểm danh hôm nay" value={stats.checkedToday} icon={Users} color="text-green-600" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="pt-5 pb-4 px-5 h-20" /></Card>
          ))}
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cài đặt điểm danh</CardTitle>
          <CardDescription>Cấu hình chi tiết điểm danh tại trang Điểm danh trong nhóm Quà tặng.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={() => window.location.assign("/checkin")}>
            Đến trang Điểm danh →
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CustomerProfile() {
  const [activeTab,    setActiveTab]    = useState("overview")
  const [config,       setConfig]       = useState<ProfileConfig>(DEFAULT_CONFIG)
  const [loadingCfg,   setLoadingCfg]   = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [stats,        setStats]        = useState<AdminStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const { toast } = useToast()

  const loadConfig = useCallback(async () => {
    setLoadingCfg(true)
    try {
      const cfg = await apiFetch("GET", "/bot/profile/config")
      setConfig(cfg)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e?.message, variant: "destructive" })
    } finally {
      setLoadingCfg(false)
    }
  }, [toast])

  const loadStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const s = await apiFetch("GET", "/bot/profile/admin-stats")
      setStats(s)
    } catch {
      /* non-critical */
    } finally {
      setLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
    loadStats()
  }, [loadConfig, loadStats])

  const saveConfig = async () => {
    setSaving(true)
    try {
      await apiFetch("PUT", "/bot/profile/config", config)
      toast({ title: "✅ Đã lưu cấu hình" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e?.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Hồ sơ khách hàng</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Quản lý tính năng "Hồ sơ của tôi" trên bot Telegram
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={config.profileEnabled ? "default" : "secondary"} className="text-xs">
            {config.profileEnabled ? "✅ Đang bật" : "❌ Đang tắt"}
          </Badge>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b overflow-x-auto">
        <nav className="flex gap-0 -mb-px min-w-max">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  activeTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/40",
                ].join(" ")}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* Tab content */}
      {loadingCfg ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse"><CardContent className="h-24 pt-5" /></Card>
          ))}
        </div>
      ) : (
        <>
          {activeTab === "overview" && (
            <OverviewTab stats={stats} loadingStats={loadingStats} onRefresh={loadStats} />
          )}
          {activeTab === "config" && (
            <ConfigTab config={config} onChange={setConfig} onSave={saveConfig} saving={saving} />
          )}
          {activeTab === "points" && (
            <PointsTab stats={stats} loadingStats={loadingStats} onRefresh={loadStats} />
          )}
          {activeTab === "achieve" && (
            <PlaceholderTab
              title="Thành tích"
              description="Hệ thống thành tích sẽ được triển khai trong Task #9 (Giai đoạn 3). Bao gồm 5 thành tích mặc định và cài đặt bật/tắt."
            />
          )}
          {activeTab === "rewards" && (
            <PlaceholderTab
              title="Phần thưởng đổi điểm"
              description="Hệ thống đổi quà bằng điểm sẽ được triển khai trong Task #9. Admin có thể tạo phần thưởng, đặt số lượng và theo dõi lịch sử đổi."
            />
          )}
          {activeTab === "history" && (
            <PlaceholderTab
              title="Lịch sử giao dịch điểm"
              description="Lịch sử toàn bộ giao dịch điểm (cộng, trừ, đổi quà) sẽ khả dụng sau khi hệ thống đổi quà được triển khai."
            />
          )}
        </>
      )}
    </div>
  )
}
