import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  Target, Plus, Trash2, Edit2, Users, Trophy, Hash,
  RefreshCw, Loader2, Save, ChevronDown, ChevronUp, Copy,
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

interface SecretCodeReward {
  type: string
  label: string
  value: string
}

interface SecretCodeWinner {
  userId: number
  username: string
  firstName: string
  time: string
  ip: string
}

interface SecretCode {
  id: string
  enabled: boolean
  code: string
  reward: SecretCodeReward
  maxWinners: number
  startTime: string
  endTime: string
  membersOnly: boolean
  onePerUser: boolean
  winMessage: string
  exhaustedMessage: string
  invalidMessage: string
  createdAt: string
  winners: SecretCodeWinner[]
}

const REWARD_TYPES = [
  { value: "points",    label: "Cộng điểm" },
  { value: "balance",   label: "Cộng số dư ví" },
  { value: "voucher",   label: "Voucher" },
  { value: "coupon",    label: "Coupon" },
  { value: "warranty",  label: "Gia hạn bảo hành" },
  { value: "spin",      label: "Thêm lượt quay" },
  { value: "account",   label: "Tài khoản miễn phí" },
  { value: "custom",    label: "Tùy chỉnh" },
]

const DEFAULT_FORM: Omit<SecretCode, "id" | "createdAt" | "winners"> = {
  enabled: false,
  code: "",
  reward: { type: "custom", label: "", value: "" },
  maxWinners: 100,
  startTime: "",
  endTime: "",
  membersOnly: false,
  onePerUser: true,
  winMessage: "🎉 Chúc mừng! Bạn nhận được:\n🎁 {reward}",
  exhaustedMessage: "😔 Mã đã hết lượt nhận. Theo dõi bot để không bỏ lỡ sự kiện tiếp theo!",
  invalidMessage: "❌ Mã không hợp lệ. Vui lòng kiểm tra lại.",
}

// ── Helper ────────────────────────────────────────────────────────────────────

function toLocalDatetimeInput(iso: string): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch { return "" }
}

function fromLocalDatetimeInput(val: string): string {
  if (!val) return ""
  try { return new Date(val).toISOString() } catch { return "" }
}

function statusBadge(code: SecretCode) {
  if (!code.enabled) return <Badge variant="secondary">Tắt</Badge>
  const now = Date.now()
  if (code.startTime && new Date(code.startTime).getTime() > now)
    return <Badge variant="outline" className="text-amber-600 border-amber-400">Chưa bắt đầu</Badge>
  if (code.endTime && new Date(code.endTime).getTime() < now)
    return <Badge variant="secondary" className="text-red-500">Hết hạn</Badge>
  if (code.maxWinners > 0 && code.winners.length >= code.maxWinners)
    return <Badge variant="secondary" className="text-orange-500">Hết lượt</Badge>
  return <Badge className="bg-green-600 hover:bg-green-700 text-white">Đang chạy</Badge>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SecretCodes() {
  const { toast } = useToast()

  const [codes, setCodes]       = useState<SecretCode[]>([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)

  // Dialog state
  const [dialogOpen, setDialogOpen]       = useState(false)
  const [editingId, setEditingId]         = useState<string | null>(null)
  const [form, setForm]                   = useState<Omit<SecretCode, "id" | "createdAt" | "winners">>(DEFAULT_FORM)

  // Delete confirm
  const [deleteId, setDeleteId]           = useState<string | null>(null)
  const [deleting, setDeleting]           = useState(false)

  // Expanded winners
  const [expandedId, setExpandedId]       = useState<string | null>(null)
  const [winners, setWinners]             = useState<SecretCodeWinner[]>([])
  const [winnersLoading, setWinnersLoading] = useState(false)

  // ── Fetch codes ───────────────────────────────────────────────────────────
  const fetchCodes = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/bot/secret-codes", { headers: authHeader() })
      if (r.ok) setCodes(await r.json())
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  // ── Open dialog ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null)
    setForm(DEFAULT_FORM)
    setDialogOpen(true)
  }

  const openEdit = (code: SecretCode) => {
    setEditingId(code.id)
    setForm({
      enabled:          code.enabled,
      code:             code.code,
      reward:           { ...code.reward },
      maxWinners:       code.maxWinners,
      startTime:        code.startTime,
      endTime:          code.endTime,
      membersOnly:      code.membersOnly,
      onePerUser:       code.onePerUser,
      winMessage:       code.winMessage,
      exhaustedMessage: code.exhaustedMessage,
      invalidMessage:   code.invalidMessage,
    })
    setDialogOpen(true)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.code.trim()) {
      toast({ title: "Lỗi", description: "Vui lòng nhập mã bí mật", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const body = { ...form, code: form.code.toUpperCase().trim() }
      const url  = editingId ? `/api/bot/secret-codes/${editingId}` : "/api/bot/secret-codes"
      const method = editingId ? "PUT" : "POST"
      const r = await fetch(url, {
        method,
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error()
      toast({ title: "Thành công", description: editingId ? "Đã cập nhật mã" : "Đã tạo mã mới" })
      setDialogOpen(false)
      fetchCodes()
    } catch {
      toast({ title: "Lỗi", description: "Không thể lưu mã", variant: "destructive" })
    } finally { setSaving(false) }
  }

  // ── Quick toggle enabled ──────────────────────────────────────────────────
  const toggleEnabled = async (code: SecretCode) => {
    try {
      await fetch(`/api/bot/secret-codes/${code.id}`, {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !code.enabled }),
      })
      setCodes(prev => prev.map(c => c.id === code.id ? { ...c, enabled: !c.enabled } : c))
    } catch {
      toast({ title: "Lỗi", description: "Không thể thay đổi trạng thái", variant: "destructive" })
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await fetch(`/api/bot/secret-codes/${deleteId}`, { method: "DELETE", headers: authHeader() })
      toast({ title: "Đã xóa mã" })
      setDeleteId(null)
      fetchCodes()
    } catch {
      toast({ title: "Lỗi", description: "Không thể xóa", variant: "destructive" })
    } finally { setDeleting(false) }
  }

  // ── Winners expand ────────────────────────────────────────────────────────
  const toggleWinners = async (code: SecretCode) => {
    if (expandedId === code.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(code.id)
    setWinnersLoading(true)
    try {
      const r = await fetch(`/api/bot/secret-codes/${code.id}/winners`, { headers: authHeader() })
      if (r.ok) setWinners(await r.json())
    } catch { setWinners([]) } finally { setWinnersLoading(false) }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalCodes    = codes.length
  const activeCodes   = codes.filter(c => {
    if (!c.enabled) return false
    const now = Date.now()
    if (c.startTime && new Date(c.startTime).getTime() > now) return false
    if (c.endTime   && new Date(c.endTime).getTime()   < now) return false
    if (c.maxWinners > 0 && c.winners.length >= c.maxWinners) return false
    return true
  }).length
  const totalWinners  = codes.reduce((s, c) => s + c.winners.length, 0)
  const totalSlots    = codes.reduce((s, c) => s + Math.max(0, (c.maxWinners || 0) - c.winners.length), 0)

  // ── Form helpers ──────────────────────────────────────────────────────────
  const setReward = (field: keyof SecretCodeReward, val: string) =>
    setForm(f => ({ ...f, reward: { ...f.reward, [field]: val } }))

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">🎯 Săn mã bí mật</h1>
          <p className="text-muted-foreground mt-1 text-sm">Tạo và quản lý sự kiện mã bí mật cho người dùng</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Button variant="outline" size="icon" onClick={fetchCodes} disabled={loading} className="shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button onClick={openCreate} className="flex-1 sm:flex-none min-h-[44px]">
            <Plus className="w-4 h-4 mr-2" /> Tạo mã mới
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Tổng số mã",    value: totalCodes,   icon: Hash,    color: "text-blue-500" },
          { label: "Đang hoạt động",value: activeCodes,  icon: Target,  color: "text-green-500" },
          { label: "Đã trúng",      value: totalWinners, icon: Trophy,  color: "text-amber-500" },
          { label: "Lượt còn lại",  value: totalSlots,   icon: Users,   color: "text-purple-500" },
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

      {/* Codes list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách mã</CardTitle>
          <CardDescription>Bật/tắt từng mã độc lập, xem danh sách người đã nhận</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Đang tải...
            </div>
          ) : codes.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">Chưa có mã nào</p>
              <p className="text-sm mt-1">Bấm "Tạo mã mới" để bắt đầu</p>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {codes.map(code => (
                <div key={code.id}>
                  {/* Code row */}
                  <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Left: toggle + code + status */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Switch checked={code.enabled} onCheckedChange={() => toggleEnabled(code)} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="font-mono font-bold text-base tracking-widest">{code.code}</code>
                          {statusBadge(code)}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {REWARD_TYPES.find(r => r.value === code.reward?.type)?.label ?? "Tùy chỉnh"}
                          {code.reward?.label && ` — ${code.reward.label}`}
                        </p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
                          <span>👥 {code.winners.length}/{code.maxWinners || "∞"} người trúng</span>
                          {code.startTime && <span>🕐 {new Date(code.startTime).toLocaleString("vi-VN")}</span>}
                          {code.endTime   && <span>🔚 {new Date(code.endTime).toLocaleString("vi-VN")}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-1 sm:ml-auto shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        className="text-xs gap-1"
                        onClick={() => toggleWinners(code)}
                      >
                        <Users className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Người trúng</span>
                        {expandedId === code.id
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(code)}>
                        <Edit2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(code.id)}>
                        <Trash2 className="h-4 w-4 text-destructive/70" />
                      </Button>
                    </div>
                  </div>

                  {/* Winners panel */}
                  {expandedId === code.id && (
                    <div className="border-t border-border/50 bg-muted/20 px-4 py-3">
                      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                        Danh sách người đã nhận ({code.winners.length})
                      </p>
                      {winnersLoading ? (
                        <div className="flex gap-2 text-sm text-muted-foreground py-3">
                          <Loader2 className="h-4 w-4 animate-spin" /> Đang tải...
                        </div>
                      ) : winners.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">Chưa có ai nhận.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Telegram ID</TableHead>
                                <TableHead>Username</TableHead>
                                <TableHead>Tên</TableHead>
                                <TableHead>Thời gian</TableHead>
                                <TableHead>IP</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {winners.map((w, i) => (
                                <TableRow key={i}>
                                  <TableCell className="font-mono text-xs">{w.userId}</TableCell>
                                  <TableCell className="text-xs">{w.username ? `@${w.username}` : "—"}</TableCell>
                                  <TableCell className="text-xs">{w.firstName || "—"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {new Date(w.time).toLocaleString("vi-VN")}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{w.ip || "—"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create / Edit Dialog ──────────────────────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[580px] max-h-[92dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Chỉnh sửa mã" : "Tạo mã bí mật mới"}</DialogTitle>
            <DialogDescription>Cấu hình chi tiết sự kiện săn mã</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">

            {/* Code + enabled */}
            <div className="flex gap-3 items-end">
              <div className="flex-1 grid gap-2">
                <Label>Mã bí mật <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    placeholder="VD: SUMMER2026"
                    className="font-mono uppercase pr-10"
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                    title="Copy mã"
                    onClick={() => { navigator.clipboard.writeText(form.code); toast({ title: "Đã copy mã" }) }}
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 pb-1">
                <Label className="text-xs text-muted-foreground">Bật</Label>
                <Switch checked={form.enabled} onCheckedChange={v => setForm(f => ({ ...f, enabled: v }))} />
              </div>
            </div>

            {/* Reward */}
            <div className="grid gap-3 p-3 border border-border rounded-lg">
              <p className="text-sm font-medium">🎁 Phần thưởng</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-xs">Loại phần thưởng</Label>
                  <Select value={form.reward.type} onValueChange={v => setReward("type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {REWARD_TYPES.map(r => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-xs">Hiển thị trong bot</Label>
                  <Input
                    placeholder="VD: 500 điểm / Voucher 50k"
                    value={form.reward.label}
                    onChange={e => setReward("label", e.target.value)}
                  />
                </div>
              </div>
              {(form.reward.type === "points" || form.reward.type === "balance" || form.reward.type === "custom") && (
                <div className="grid gap-2">
                  <Label className="text-xs">Giá trị / Chi tiết thêm</Label>
                  <Input
                    placeholder={form.reward.type === "points" ? "VD: 500" : form.reward.type === "balance" ? "VD: 50000" : "Mô tả phần thưởng"}
                    value={form.reward.value}
                    onChange={e => setReward("value", e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Time + max winners */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="grid gap-2">
                <Label className="text-xs">Thời gian bắt đầu</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDatetimeInput(form.startTime)}
                  onChange={e => setForm(f => ({ ...f, startTime: fromLocalDatetimeInput(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Thời gian kết thúc</Label>
                <Input
                  type="datetime-local"
                  value={toLocalDatetimeInput(form.endTime)}
                  onChange={e => setForm(f => ({ ...f, endTime: fromLocalDatetimeInput(e.target.value) }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Số người thắng tối đa</Label>
                <Input
                  type="number" min={0}
                  placeholder="0 = không giới hạn"
                  value={form.maxWinners}
                  onChange={e => setForm(f => ({ ...f, maxWinners: Number(e.target.value) }))}
                />
              </div>
            </div>

            {/* Flags */}
            <div className="grid grid-cols-2 gap-3 p-3 border border-border rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Chỉ thành viên bot</p>
                  <p className="text-xs text-muted-foreground">Đã nhận quà mới dùng được</p>
                </div>
                <Switch checked={form.membersOnly} onCheckedChange={v => setForm(f => ({ ...f, membersOnly: v }))} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">Giới hạn 1 lần/người</p>
                  <p className="text-xs text-muted-foreground">Mỗi Telegram ID chỉ nhận 1 lần</p>
                </div>
                <Switch checked={form.onePerUser} onCheckedChange={v => setForm(f => ({ ...f, onePerUser: v }))} />
              </div>
            </div>

            {/* Messages */}
            <div className="grid gap-3 p-3 border border-border rounded-lg">
              <p className="text-sm font-medium">💬 Nội dung thông báo</p>
              <p className="text-xs text-muted-foreground -mt-1">Dùng <code className="bg-muted px-1 rounded">&#123;reward&#125;</code> để chèn tên phần thưởng vào tin nhắn trúng</p>

              <div className="grid gap-2">
                <Label className="text-xs">Khi trúng thưởng</Label>
                <Textarea
                  className="min-h-[70px] text-sm"
                  value={form.winMessage}
                  onChange={e => setForm(f => ({ ...f, winMessage: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Khi mã hết lượt</Label>
                <Textarea
                  className="min-h-[60px] text-sm"
                  value={form.exhaustedMessage}
                  onChange={e => setForm(f => ({ ...f, exhaustedMessage: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Khi mã không hợp lệ / điều kiện không đủ</Label>
                <Textarea
                  className="min-h-[60px] text-sm"
                  value={form.invalidMessage}
                  onChange={e => setForm(f => ({ ...f, invalidMessage: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(false)}>
              Hủy
            </Button>
            <Button className="w-full sm:w-auto" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {editingId ? "Cập nhật" : "Tạo mã"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ────────────────────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Xác nhận xóa mã</DialogTitle>
            <DialogDescription>
              Xóa mã{" "}
              <strong className="font-mono text-foreground">
                {codes.find(c => c.id === deleteId)?.code}
              </strong>{" "}
              và toàn bộ lịch sử người trúng. Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteId(null)}>
              Hủy
            </Button>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Đang xóa..." : "Xóa mã"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
