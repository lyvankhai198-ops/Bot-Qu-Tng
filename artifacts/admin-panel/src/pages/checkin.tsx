import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  CalendarCheck, Flame, Star, Users, Send, Plus, Trash2,
  RefreshCw, Loader2, Save, TrendingUp, CheckCircle2, Clock,
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

interface CheckinSettings {
  enabled: boolean
  hour: number
  minute: number
  timezone: string
  points_per_day: number
  streak_bonuses: { days: number; bonus_points: number }[]
}

interface CheckinStats {
  today: string
  checkedInToday: number
  notCheckedInToday: number
  longestStreak: number
  totalPointsToday: number
  notifSent: number
  notifFailed: number
  triggeredAt: string | null
  totalUsersWithRecords: number
}

interface CheckinRecord {
  userId: number
  username: string
  firstName: string
  lastCheckin: string
  streak: number
  totalPoints: number
  totalCheckins: number
  checkedInToday: boolean
}

const TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "UTC",
]

export default function Checkin() {
  const { toast } = useToast()

  const [settings, setSettings] = useState<CheckinSettings>({
    enabled: true,
    hour: 7,
    minute: 0,
    timezone: "Asia/Ho_Chi_Minh",
    points_per_day: 10,
    streak_bonuses: [
      { days: 7,  bonus_points: 20  },
      { days: 30, bonus_points: 100 },
    ],
  })
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving]   = useState(false)

  const [stats, setStats]             = useState<CheckinStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)

  const [records, setRecords]             = useState<CheckinRecord[]>([])
  const [recordsLoading, setRecordsLoading] = useState(true)

  const [triggering, setTriggering] = useState(false)
  const [newBonus, setNewBonus]     = useState({ days: 7, bonus_points: 20 })

  // ── Load settings ──────────────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    try {
      const res = await fetch("/api/bot/checkin/settings", { headers: authHeader() })
      if (!res.ok) throw new Error(await res.text())
      setSettings(await res.json())
    } catch (e: any) {
      toast({ title: "Lỗi tải cài đặt", description: e.message, variant: "destructive" })
    } finally { setSettingsLoading(false) }
  }, [toast])

  // ── Load stats ─────────────────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await fetch("/api/bot/checkin/stats", { headers: authHeader() })
      if (!res.ok) throw new Error(await res.text())
      setStats(await res.json())
    } catch { /* silent */ } finally { setStatsLoading(false) }
  }, [])

  // ── Load records ───────────────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    setRecordsLoading(true)
    try {
      const res = await fetch("/api/bot/checkin/records", { headers: authHeader() })
      if (!res.ok) throw new Error(await res.text())
      setRecords(await res.json())
    } catch { /* silent */ } finally { setRecordsLoading(false) }
  }, [])

  useEffect(() => {
    loadSettings()
    loadStats()
    loadRecords()
  }, [loadSettings, loadStats, loadRecords])

  // ── Save settings ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSettingsSaving(true)
    try {
      const res = await fetch("/api/bot/checkin/settings", {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error(await res.text())
      setSettings(await res.json())
      toast({ title: "✅ Đã lưu cài đặt điểm danh" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setSettingsSaving(false) }
  }

  // ── Manual trigger ─────────────────────────────────────────────────────────
  const handleTrigger = async () => {
    setTriggering(true)
    try {
      const res = await fetch("/api/bot/checkin/trigger", {
        method: "POST",
        headers: authHeader(),
      })
      if (!res.ok) throw new Error(await res.text())
      toast({ title: "✅ Đã đưa vào hàng đợi", description: "Bot sẽ gửi thông báo điểm danh đến tất cả người dùng." })
      setTimeout(() => { loadStats(); loadRecords() }, 3000)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setTriggering(false) }
  }

  // ── Streak bonuses ─────────────────────────────────────────────────────────
  const addBonus = () => {
    if (!newBonus.days || !newBonus.bonus_points) return
    setSettings(s => ({
      ...s,
      streak_bonuses: [...s.streak_bonuses, { ...newBonus }]
        .sort((a, b) => a.days - b.days),
    }))
    setNewBonus({ days: 14, bonus_points: 50 })
  }

  const removeBonus = (idx: number) => {
    setSettings(s => ({
      ...s,
      streak_bonuses: s.streak_bonuses.filter((_, i) => i !== idx),
    }))
  }

  if (settingsLoading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">Đang tải...</div>
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Điểm danh hằng ngày</h1>
          <p className="text-muted-foreground mt-1 text-sm">Cấu hình và thống kê tính năng điểm danh</p>
        </div>
        <Button onClick={handleTrigger} disabled={triggering} className="gap-2 shrink-0">
          {triggering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Gửi thông báo ngay
        </Button>
      </div>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      {statsLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => (
            <Card key={i}><CardContent className="p-4 animate-pulse"><div className="h-12 bg-muted rounded" /></CardContent></Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Đã điểm danh hôm nay</span>
              </div>
              <p className="text-2xl font-bold text-green-600">{stats.checkedInToday}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="h-4 w-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Chưa điểm danh</span>
              </div>
              <p className="text-2xl font-bold text-orange-500">{stats.notCheckedInToday}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Flame className="h-4 w-4 text-red-500" />
                <span className="text-xs text-muted-foreground">Chuỗi dài nhất</span>
              </div>
              <p className="text-2xl font-bold">{stats.longestStreak} ngày</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Star className="h-4 w-4 text-yellow-500" />
                <span className="text-xs text-muted-foreground">Đã gửi thông báo</span>
              </div>
              <p className="text-2xl font-bold">{stats.notifSent}</p>
              {stats.triggeredAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(stats.triggeredAt).toLocaleTimeString("vi-VN")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ── Settings card ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" /> Cài đặt điểm danh
          </CardTitle>
          <CardDescription>Cấu hình lịch gửi thông báo và điểm thưởng</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-4">
            <div>
              <Label className="text-base font-semibold">Tự động gửi thông báo</Label>
              <p className="text-sm text-muted-foreground">Bot sẽ tự động nhắn riêng đến từng người dùng theo lịch</p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={v => setSettings(s => ({ ...s, enabled: v }))}
              className="shrink-0"
            />
          </div>

          {/* Time & timezone */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Giờ gửi (0–23)</Label>
              <Input
                type="number" min={0} max={23}
                value={settings.hour}
                onChange={e => setSettings(s => ({ ...s, hour: Math.min(23, Math.max(0, Number(e.target.value))) }))}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Phút (0–59)</Label>
              <Input
                type="number" min={0} max={59}
                value={settings.minute}
                onChange={e => setSettings(s => ({ ...s, minute: Math.min(59, Math.max(0, Number(e.target.value))) }))}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Múi giờ</Label>
              <select
                className="w-full min-h-[44px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                value={settings.timezone}
                onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
              >
                {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </div>
          </div>

          {/* Points */}
          <div className="space-y-2">
            <Label>Điểm thưởng mỗi ngày</Label>
            <Input
              type="number" min={1} max={10000}
              value={settings.points_per_day}
              onChange={e => setSettings(s => ({ ...s, points_per_day: Math.max(1, Number(e.target.value)) }))}
              className="max-w-[200px] min-h-[44px]"
            />
          </div>

          {/* Streak bonuses */}
          <div className="space-y-3">
            <Label className="text-base font-semibold flex items-center gap-2">
              <Flame className="h-4 w-4 text-orange-500" /> Thưởng chuỗi liên tiếp
            </Label>
            <p className="text-sm text-muted-foreground">Người dùng nhận thêm điểm khi đạt chuỗi điểm danh đủ N ngày (tính theo bội số).</p>

            <div className="space-y-2">
              {settings.streak_bonuses.map((bonus, idx) => (
                <div key={idx} className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
                  <div className="flex-1 flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="font-mono">🔥 Chuỗi {bonus.days} ngày</Badge>
                    <span className="text-sm text-muted-foreground">→</span>
                    <Badge className="bg-yellow-500/10 text-yellow-700 border-yellow-500/30">⭐ +{bonus.bonus_points} điểm</Badge>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => removeBonus(idx)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add bonus */}
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">Số ngày chuỗi</Label>
                <Input
                  type="number" min={1} placeholder="7"
                  value={newBonus.days}
                  onChange={e => setNewBonus(b => ({ ...b, days: Number(e.target.value) }))}
                  className="w-28 min-h-[44px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Điểm thưởng thêm</Label>
                <Input
                  type="number" min={1} placeholder="20"
                  value={newBonus.bonus_points}
                  onChange={e => setNewBonus(b => ({ ...b, bonus_points: Number(e.target.value) }))}
                  className="w-36 min-h-[44px]"
                />
              </div>
              <Button variant="outline" onClick={addBonus} className="gap-1 min-h-[44px]">
                <Plus className="h-4 w-4" /> Thêm
              </Button>
            </div>
          </div>

          <Button onClick={handleSave} disabled={settingsSaving} className="gap-2 w-full sm:w-auto">
            {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Lưu cài đặt
          </Button>
        </CardContent>
      </Card>

      {/* ── Records table ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Bảng xếp hạng điểm danh
            </CardTitle>
            <CardDescription>{records.length} người dùng có lịch sử điểm danh</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={loadRecords} disabled={recordsLoading}>
            <RefreshCw className={`h-4 w-4 ${recordsLoading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {recordsLoading ? (
            <div className="p-8 text-center text-muted-foreground animate-pulse">Đang tải...</div>
          ) : records.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p>Chưa có ai điểm danh.</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Người dùng</TableHead>
                      <TableHead>Hôm nay</TableHead>
                      <TableHead>Chuỗi 🔥</TableHead>
                      <TableHead>Tổng ngày</TableHead>
                      <TableHead>Tổng điểm ⭐</TableHead>
                      <TableHead>Lần cuối</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((rec, idx) => (
                      <TableRow key={rec.userId}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        <TableCell>
                          <div className="font-medium">
                            {rec.firstName || rec.username || String(rec.userId)}
                          </div>
                          {rec.username && (
                            <div className="text-xs text-muted-foreground">@{rec.username}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {rec.checkedInToday
                            ? <Badge className="bg-green-500/10 text-green-700 border-green-500/30">✅ Đã điểm</Badge>
                            : <Badge variant="outline" className="text-muted-foreground">Chưa</Badge>
                          }
                        </TableCell>
                        <TableCell>
                          <span className={`font-bold ${rec.streak >= 7 ? "text-orange-500" : ""}`}>
                            {rec.streak} ngày
                          </span>
                        </TableCell>
                        <TableCell>{rec.totalCheckins}</TableCell>
                        <TableCell className="font-semibold text-yellow-600">{rec.totalPoints}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {rec.lastCheckin || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-border">
                {records.map((rec, idx) => (
                  <div key={rec.userId} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs text-muted-foreground mr-2">#{idx + 1}</span>
                        <span className="font-medium">
                          {rec.firstName || rec.username || String(rec.userId)}
                        </span>
                        {rec.username && (
                          <div className="text-xs text-muted-foreground">@{rec.username}</div>
                        )}
                      </div>
                      {rec.checkedInToday
                        ? <Badge className="bg-green-500/10 text-green-700 border-green-500/30 shrink-0">✅ Đã điểm</Badge>
                        : <Badge variant="outline" className="text-muted-foreground shrink-0">Chưa</Badge>
                      }
                    </div>
                    <div className="flex gap-4 text-sm flex-wrap">
                      <span>🔥 <b>{rec.streak}</b> ngày</span>
                      <span>📅 <b>{rec.totalCheckins}</b> ngày</span>
                      <span>⭐ <b className="text-yellow-600">{rec.totalPoints}</b></span>
                    </div>
                    <div className="text-xs text-muted-foreground">Lần cuối: {rec.lastCheckin || "—"}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
