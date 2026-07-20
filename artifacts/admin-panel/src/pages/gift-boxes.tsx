import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import {
  Gift, Plus, Trash2, Edit2, Users, LayoutGrid,
  RefreshCw, Loader2, Save, ChevronDown, ChevronUp,
  Trophy, Box, Minus,
} from "lucide-react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GiftPrize {
  id: string
  type: string
  label: string
  value: string
  quantity: number  // 0 = unlimited (filler)
}

interface GiftBoxEvent {
  id: string
  name: string
  enabled: boolean
  startTime: string
  endTime: string
  totalBoxes: number
  maxPicksPerUser: number
  membersOnly: boolean
  buyersOnly: boolean
  prizes: GiftPrize[]
  boxes: any[]
  createdAt: string
}

interface EventStats {
  totalBoxes: number
  openedBoxes: number
  remainingBoxes: number
  participants: number
  winners: {
    boxIndex: number
    openedBy: number
    openedByName: string
    openedAt: string
    prize: GiftPrize | null
  }[]
}

const PRIZE_TYPES = [
  { value: "points",   label: "Cộng điểm" },
  { value: "balance",  label: "Cộng số dư ví" },
  { value: "voucher",  label: "Voucher" },
  { value: "warranty", label: "Gia hạn bảo hành" },
  { value: "spin",     label: "Thêm lượt quay" },
  { value: "account",  label: "Tài khoản miễn phí" },
  { value: "lucky",    label: "Chúc may mắn (không có thưởng)" },
  { value: "custom",   label: "Tùy chỉnh" },
]

const BOX_SIZES = [9, 16, 25, 36, 49, 64, 100]

function toLocalDatetimeInput(iso: string): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return "" }
}

function fromLocalDatetimeInput(v: string): string {
  if (!v) return ""
  try { return new Date(v).toISOString() } catch { return "" }
}

function statusBadge(ev: GiftBoxEvent) {
  if (!ev.enabled) return <Badge variant="secondary">Tắt</Badge>
  const now = Date.now()
  if (ev.startTime && new Date(ev.startTime).getTime() > now)
    return <Badge variant="outline" className="text-amber-600 border-amber-400">Chưa bắt đầu</Badge>
  if (ev.endTime && new Date(ev.endTime).getTime() < now)
    return <Badge variant="secondary" className="text-red-500">Hết hạn</Badge>
  const opened = ev.boxes?.filter(b => b.opened).length ?? 0
  if (opened >= ev.totalBoxes)
    return <Badge variant="secondary" className="text-orange-500">Hết ô</Badge>
  return <Badge className="bg-green-600 hover:bg-green-700 text-white">Đang chạy</Badge>
}

function newPrize(): GiftPrize {
  return { id: `p_${Date.now()}`, type: "custom", label: "", value: "", quantity: 10 }
}

const DEFAULT_FORM = {
  name: "",
  enabled: false,
  startTime: "",
  endTime: "",
  totalBoxes: 25,
  maxPicksPerUser: 1,
  membersOnly: false,
  buyersOnly: false,
  prizes: [] as GiftPrize[],
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GiftBoxes() {
  const { toast } = useToast()
  const [events, setEvents]     = useState<GiftBoxEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [form, setForm]             = useState({ ...DEFAULT_FORM })
  const [deleteId, setDeleteId]     = useState<string | null>(null)
  const [deleting, setDeleting]     = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [stats, setStats]           = useState<EventStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [, setTick] = useState(0)   // timer tick — forces re-render để badge cập nhật đúng giờ

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/bot/gift-boxes", { headers: authHeader() })
      if (r.ok) setEvents(await r.json())
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchEvents() }, [fetchEvents])

  // Tick mỗi 30s để badge thời gian (Chưa bắt đầu / Đang chạy / Hết hạn) tự cập nhật
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  // ── Quick toggle ──────────────────────────────────────────────────────────
  const toggleEnabled = async (ev: GiftBoxEvent) => {
    try {
      await fetch(`/api/bot/gift-boxes/${ev.id}`, {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !ev.enabled }),
      })
      setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, enabled: !e.enabled } : e))
    } catch { toast({ title: "Lỗi", description: "Không thể thay đổi trạng thái", variant: "destructive" }) }
  }

  // ── Open dialog ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null)
    setForm({ ...DEFAULT_FORM, prizes: [{ id: `p_${Date.now()}`, type: "lucky", label: "Chúc may mắn", value: "", quantity: 0 }] })
    setDialogOpen(true)
  }

  const openEdit = (ev: GiftBoxEvent) => {
    setEditingId(ev.id)
    setForm({
      name: ev.name,
      enabled: ev.enabled,
      startTime: ev.startTime,
      endTime: ev.endTime,
      totalBoxes: ev.totalBoxes,
      maxPicksPerUser: ev.maxPicksPerUser,
      membersOnly: ev.membersOnly,
      buyersOnly: ev.buyersOnly,
      prizes: ev.prizes.map(p => ({ ...p })),
    })
    setDialogOpen(true)
  }

  // ── Prize CRUD ────────────────────────────────────────────────────────────
  const addPrize = () => setForm(f => ({ ...f, prizes: [...f.prizes, newPrize()] }))
  const removePrize = (id: string) => setForm(f => ({ ...f, prizes: f.prizes.filter(p => p.id !== id) }))
  const updatePrize = (id: string, field: keyof GiftPrize, val: any) =>
    setForm(f => ({ ...f, prizes: f.prizes.map(p => p.id === id ? { ...p, [field]: val } : p) }))

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "Lỗi", description: "Vui lòng nhập tên sự kiện", variant: "destructive" })
      return
    }
    if (form.prizes.length === 0) {
      toast({ title: "Lỗi", description: "Vui lòng thêm ít nhất 1 phần thưởng", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const url    = editingId ? `/api/bot/gift-boxes/${editingId}` : "/api/bot/gift-boxes"
      const method = editingId ? "PUT" : "POST"
      const r = await fetch(url, {
        method,
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (!r.ok) throw new Error()
      toast({ title: "Thành công", description: editingId ? "Đã cập nhật sự kiện" : "Đã tạo sự kiện mới" })
      setDialogOpen(false)
      fetchEvents()
    } catch {
      toast({ title: "Lỗi", description: "Không thể lưu sự kiện", variant: "destructive" })
    } finally { setSaving(false) }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await fetch(`/api/bot/gift-boxes/${deleteId}`, { method: "DELETE", headers: authHeader() })
      toast({ title: "Đã xóa sự kiện" })
      setDeleteId(null)
      fetchEvents()
    } catch {
      toast({ title: "Lỗi", description: "Không thể xóa", variant: "destructive" })
    } finally { setDeleting(false) }
  }

  // ── Stats expand ──────────────────────────────────────────────────────────
  const toggleStats = async (ev: GiftBoxEvent) => {
    if (expandedId === ev.id) { setExpandedId(null); return }
    setExpandedId(ev.id)
    setStatsLoading(true)
    try {
      const r = await fetch(`/api/bot/gift-boxes/${ev.id}/stats`, { headers: authHeader() })
      if (r.ok) setStats(await r.json())
    } catch { setStats(null) } finally { setStatsLoading(false) }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────
  const totalEvents  = events.length
  const activeEvents = events.filter(e => {
    if (!e.enabled) return false
    const now = Date.now()
    if (e.startTime && new Date(e.startTime).getTime() > now) return false
    if (e.endTime   && new Date(e.endTime).getTime()   < now) return false
    return true
  }).length
  const totalOpened  = events.reduce((s, e) => s + (e.boxes?.filter(b => b.opened).length ?? 0), 0)
  const totalRemain  = events.reduce((s, e) => s + (e.boxes?.filter(b => !b.opened).length ?? 0), 0)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">🎁 Ô Quà Bí Mật</h1>
          <p className="text-muted-foreground mt-1 text-sm">Tạo sự kiện lưới ô quà ngẫu nhiên cho người dùng</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" size="icon" onClick={fetchEvents} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button onClick={openCreate} className="flex-1 sm:flex-none min-h-[44px]">
            <Plus className="w-4 h-4 mr-2" /> Tạo sự kiện
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Tổng sự kiện",    value: totalEvents,  icon: Gift,       color: "text-blue-500" },
          { label: "Đang chạy",       value: activeEvents, icon: LayoutGrid, color: "text-green-500" },
          { label: "Ô đã mở",         value: totalOpened,  icon: Trophy,     color: "text-amber-500" },
          { label: "Ô còn lại",       value: totalRemain,  icon: Box,        color: "text-purple-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold mt-1">{value}</p>
                </div>
                <Icon className={`h-8 w-8 ${color} opacity-80`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Events list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách sự kiện</CardTitle>
          <CardDescription>Hệ thống tự phân bổ phần thưởng ngẫu nhiên vào các ô</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
            </div>
          ) : events.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Gift className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Chưa có sự kiện nào</p>
              <p className="text-sm mt-1">Bấm "Tạo sự kiện" để bắt đầu</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {events.map(ev => {
                const opened   = ev.boxes?.filter(b => b.opened).length ?? 0
                const total    = ev.boxes?.length ?? ev.totalBoxes
                const pct      = total > 0 ? Math.round(opened / total * 100) : 0
                return (
                  <div key={ev.id}>
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                      {/* Left */}
                      <div className="flex items-center gap-3 min-w-0">
                        <Switch checked={ev.enabled} onCheckedChange={() => toggleEnabled(ev)} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{ev.name}</span>
                            {statusBadge(ev)}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                            <span>⬜ {total} ô ({Math.sqrt(total)}×{Math.sqrt(total)})</span>
                            <span>✅ Đã mở: {opened} ({pct}%)</span>
                            <span>🎯 Tối đa {ev.maxPicksPerUser} ô/người</span>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-muted-foreground">
                            {ev.startTime && <span>🕐 {new Date(ev.startTime).toLocaleString("vi-VN")}</span>}
                            {ev.endTime   && <span>🔚 {new Date(ev.endTime).toLocaleString("vi-VN")}</span>}
                          </div>
                          {/* Progress bar */}
                          <div className="mt-1.5 h-1.5 w-40 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </div>
                      {/* Actions */}
                      <div className="flex items-center gap-1 sm:ml-auto shrink-0">
                        <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => toggleStats(ev)}>
                          <Users className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Thống kê</span>
                          {expandedId === ev.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(ev)}>
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(ev.id)}>
                          <Trash2 className="h-4 w-4 text-destructive/70" />
                        </Button>
                      </div>
                    </div>

                    {/* Stats panel */}
                    {expandedId === ev.id && (
                      <div className="border-t border-border/50 bg-muted/20 px-4 py-3 space-y-3">
                        {statsLoading ? (
                          <div className="flex gap-2 text-sm text-muted-foreground py-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Đang tải thống kê...
                          </div>
                        ) : stats ? (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              {[
                                { label: "Người tham gia", value: stats.participants },
                                { label: "Ô đã mở",        value: stats.openedBoxes },
                                { label: "Ô còn lại",      value: stats.remainingBoxes },
                                { label: "Lượt trúng thưởng", value: stats.winners.filter(w => w.prize && w.prize.type !== "lucky").length },
                              ].map(({ label, value }) => (
                                <div key={label} className="bg-background rounded p-2 text-center border border-border/50">
                                  <p className="text-muted-foreground">{label}</p>
                                  <p className="font-bold text-base">{value}</p>
                                </div>
                              ))}
                            </div>

                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                                Danh sách người đã mở ô ({stats.winners.length})
                              </p>
                              {stats.winners.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Chưa có ai mở ô nào.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Ô</TableHead>
                                        <TableHead>Tên</TableHead>
                                        <TableHead>Phần thưởng</TableHead>
                                        <TableHead>Thời gian</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {stats.winners.map((w, i) => {
                                        const isLucky = !w.prize || w.prize.type === "lucky"
                                        return (
                                          <TableRow key={i}>
                                            <TableCell className="font-mono text-xs">#{w.boxIndex + 1}</TableCell>
                                            <TableCell className="text-xs">{w.openedByName || w.openedBy}</TableCell>
                                            <TableCell>
                                              {isLucky
                                                ? <span className="text-xs text-muted-foreground">😄 Chúc may mắn</span>
                                                : <span className="text-xs font-medium">🎁 {w.prize?.label}</span>}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground">
                                              {new Date(w.openedAt).toLocaleString("vi-VN")}
                                            </TableCell>
                                          </TableRow>
                                        )
                                      })}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">Không thể tải thống kê.</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[620px] max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Chỉnh sửa sự kiện" : "Tạo sự kiện mới"}</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ tự phân bổ phần thưởng ngẫu nhiên vào các ô. Admin không cần tự gán từng ô.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">

            {/* Name + enabled */}
            <div className="flex gap-3 items-end">
              <div className="flex-1 grid gap-2">
                <Label>Tên sự kiện <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="VD: Sự kiện tháng 7"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="flex flex-col items-center gap-1 pb-1">
                <Label className="text-xs text-muted-foreground">Bật</Label>
                <Switch checked={form.enabled} onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))} />
              </div>
            </div>

            {/* Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-xs">Bắt đầu</Label>
                <Input type="datetime-local"
                  value={toLocalDatetimeInput(form.startTime)}
                  onChange={e => setForm(f => ({ ...f, startTime: fromLocalDatetimeInput(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Kết thúc</Label>
                <Input type="datetime-local"
                  value={toLocalDatetimeInput(form.endTime)}
                  onChange={e => setForm(f => ({ ...f, endTime: fromLocalDatetimeInput(e.target.value) }))}
                />
              </div>
            </div>

            {/* Grid + picks */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-xs">Tổng số ô quà</Label>
                <Select
                  value={String(form.totalBoxes)}
                  onValueChange={v => setForm(f => ({ ...f, totalBoxes: Number(v) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOX_SIZES.map(n => (
                      <SelectItem key={n} value={String(n)}>
                        {n} ô ({Math.sqrt(n)}×{Math.sqrt(n)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Mỗi người chọn tối đa</Label>
                <Input
                  type="number" min={1} max={form.totalBoxes}
                  value={form.maxPicksPerUser}
                  onChange={e => setForm(f => ({ ...f, maxPicksPerUser: Number(e.target.value) }))}
                />
              </div>
            </div>

            {/* Flags */}
            <div className="grid grid-cols-2 gap-3 p-3 border border-border rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Chỉ thành viên bot</p>
                  <p className="text-xs text-muted-foreground">Đã nhận quà mới được tham gia</p>
                </div>
                <Switch checked={form.membersOnly} onCheckedChange={v => setForm(f => ({ ...f, membersOnly: v }))} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Chỉ người mua hàng</p>
                  <p className="text-xs text-muted-foreground">Có đơn hàng mới được tham gia</p>
                </div>
                <Switch checked={form.buyersOnly} onCheckedChange={v => setForm(f => ({ ...f, buyersOnly: v }))} />
              </div>
            </div>

            {/* Prizes */}
            <div className="grid gap-3 p-3 border border-border rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">🎁 Danh sách phần thưởng</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Số lượng 0 = không giới hạn (dùng làm phần thưởng lấp đầy ô còn lại)
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={addPrize}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Thêm
                </Button>
              </div>

              {form.prizes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Chưa có phần thưởng nào. Thêm ít nhất 1 phần thưởng.
                </p>
              )}

              <div className="space-y-3">
                {form.prizes.map((prize, idx) => (
                  <div key={prize.id} className="border border-border/60 rounded-lg p-3 space-y-2 bg-muted/10">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">Phần thưởng #{idx + 1}</span>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => removePrize(prize.id)}
                      >
                        <Minus className="h-3.5 w-3.5 text-destructive/70" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Loại</Label>
                        <Select
                          value={prize.type}
                          onValueChange={v => updatePrize(prize.id, "type", v)}
                        >
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PRIZE_TYPES.map(t => (
                              <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Số lượng (0=∞)</Label>
                        <Input
                          type="number" min={0} className="h-9 text-xs"
                          value={prize.quantity}
                          onChange={e => updatePrize(prize.id, "quantity", Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-1">
                        <Label className="text-xs">Hiển thị trong bot</Label>
                        <Input
                          className="h-9 text-xs" placeholder="VD: Voucher 20K"
                          value={prize.label}
                          onChange={e => updatePrize(prize.id, "label", e.target.value)}
                        />
                      </div>
                      {prize.type !== "lucky" && (
                        <div className="grid gap-1">
                          <Label className="text-xs">Giá trị</Label>
                          <Input
                            className="h-9 text-xs" placeholder="VD: 500 (điểm), 50000 (ví)"
                            value={prize.value}
                            onChange={e => updatePrize(prize.id, "value", e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Prize summary */}
              {form.prizes.length > 0 && (() => {
                const totalFixed = form.prizes.filter(p => p.quantity > 0).reduce((s, p) => s + p.quantity, 0)
                const hasUnlimited = form.prizes.some(p => p.quantity === 0)
                const remaining = form.totalBoxes - totalFixed
                return (
                  <div className="mt-1 text-xs text-muted-foreground bg-muted/30 rounded p-2">
                    Tổng phần thưởng cố định: <strong>{totalFixed}</strong> / {form.totalBoxes} ô.
                    {remaining > 0 && hasUnlimited && <> Còn lại <strong>{remaining}</strong> ô sẽ nhận phần thưởng không giới hạn.</>}
                    {remaining > 0 && !hasUnlimited && <span className="text-amber-600"> ⚠️ Còn {remaining} ô chưa có phần thưởng — thêm phần thưởng số lượng 0 để lấp đầy.</span>}
                    {remaining < 0 && <span className="text-red-500"> ⚠️ Tổng phần thưởng ({totalFixed}) vượt quá số ô ({form.totalBoxes}).</span>}
                  </div>
                )
              })()}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(false)}>Hủy</Button>
            <Button className="w-full sm:w-auto" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {editingId ? "Cập nhật" : "Tạo sự kiện"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Xác nhận xóa</DialogTitle>
            <DialogDescription>
              Xóa sự kiện <strong className="text-foreground">{events.find(e => e.id === deleteId)?.name}</strong> và toàn bộ dữ liệu người chơi. Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteId(null)}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Đang xóa..." : "Xóa sự kiện"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
