import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  MessageSquare, Clock, User, Search, History,
  Settings, RefreshCw, XCircle, Timer, Trash2, ShieldAlert,
  Ban, UserCog, Plus, ArrowRightLeft, CheckCircle2,
} from "lucide-react"

// ─── helpers ──────────────────────────────────────────────────────────────────

function apiToken() { return localStorage.getItem("admin_token") ?? "" }

async function apiFetch(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiToken()}` },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function fmtDate(iso: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtTime(iso: string) {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function fmtDuration(startIso: string, endIso: string) {
  if (!startIso || !endIso) return "—"
  const diff = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.round(diff / 60)}p`
  return `${Math.floor(diff / 3600)}h${Math.round((diff % 3600) / 60)}p`
}

function userName(row: any) {
  if (row.firstName || row.username) {
    return `${row.firstName ?? ""}${row.username ? ` @${row.username}` : ""}`.trim()
  }
  return `User ${row.userId}`
}

function computeExpiresAt(duration: string): string | null {
  if (duration === "permanent") return null
  const ms: Record<string, number> = {
    "1h":  1 * 3600 * 1000,
    "3h":  3 * 3600 * 1000,
    "8h":  8 * 3600 * 1000,
    "24h": 24 * 3600 * 1000,
    "3d":  3 * 86400 * 1000,
    "7d":  7 * 86400 * 1000,
    "30d": 30 * 86400 * 1000,
  }
  return new Date(Date.now() + (ms[duration] ?? 0)).toISOString()
}

function EndReasonBadge({ reason }: { reason: string }) {
  if (reason === "timeout") {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
        <XCircle className="h-3 w-3" />Timeout
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30">
      <XCircle className="h-3 w-3" />User kết thúc
    </Badge>
  )
}

// ─── Chat Bubble ──────────────────────────────────────────────────────────────

function ChatBubble({ msg }: { msg: { role: string; text: string; time: string } }) {
  const isUser = msg.role === "user"
  return (
    <div className={`flex flex-col gap-0.5 ${isUser ? "items-start" : "items-end"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
        isUser
          ? "bg-muted text-foreground rounded-tl-sm"
          : "bg-primary text-primary-foreground rounded-tr-sm"
      }`}>
        {msg.text}
      </div>
      <span className="text-[10px] text-muted-foreground px-1">{fmtTime(msg.time)}</span>
    </div>
  )
}

// ─── Session Detail Dialog ────────────────────────────────────────────────────

function SessionDetailDialog({
  row, open, onClose, onDelete,
}: {
  row: any | null; open: boolean; onClose: () => void; onDelete: () => void
}) {
  const [tab, setTab] = useState<"info" | "chat">("info")
  if (!row) return null
  const messages: any[] = row.messages ?? []

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); setTab("info") } }}>
      <DialogContent className="max-w-sm max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />Chi tiết phiên chat
          </DialogTitle>
          <DialogDescription>{fmtDate(row.startedAt)}</DialogDescription>
        </DialogHeader>

        {messages.length > 0 && (
          <div className="flex shrink-0 border rounded-lg overflow-hidden text-sm">
            <button onClick={() => setTab("info")} className={`flex-1 py-2 font-medium transition-colors ${tab === "info" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              Thông tin
            </button>
            <button onClick={() => setTab("chat")} className={`flex-1 py-2 font-medium transition-colors ${tab === "chat" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              Hội thoại ({messages.length})
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto min-h-0">
          {tab === "info" ? (
            <div className="space-y-3 text-sm py-1">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Tên</span><span className="font-medium">{row.firstName || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Username</span><span className="font-mono">{row.username ? `@${row.username}` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">ID</span><code className="font-mono text-xs">{row.userId}</code></div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Bắt đầu</span><span>{fmtDate(row.startedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Kết thúc</span><span>{fmtDate(row.endedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Thời lượng</span><span className="font-medium">{fmtDuration(row.startedAt, row.endedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Số tin nhắn</span><span className="font-medium">{row.msgCount ?? 0} tin</span></div>
                <div className="flex justify-between items-center"><span className="text-muted-foreground">Lý do đóng</span><EndReasonBadge reason={row.endReason} /></div>
              </div>
              {messages.length === 0 && (
                <p className="text-xs text-muted-foreground text-center">Phiên này chưa có nội dung hội thoại được lưu.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="flex justify-between text-[11px] text-muted-foreground px-1">
                <span>👤 Khách hàng</span><span>Support 🎧</span>
              </div>
              {messages.map((m: any, i: number) => <ChatBubble key={i} msg={m} />)}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0 pt-2 border-t">
          <Button variant="destructive" size="sm" onClick={onDelete} className="gap-2">
            <Trash2 className="h-4 w-4" />Xoá lịch sử
          </Button>
          <Button variant="outline" size="sm" onClick={() => { onClose(); setTab("info") }}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const [search, setSearch] = useState("")
  const [limit,  setLimit]  = useState(50)
  const [selected, setSelected] = useState<any | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)

  const qc = useQueryClient()
  const { toast } = useToast()

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["chat-support-history", search, limit],
    queryFn: () => apiFetch("GET", `/bot/chat-support/history?limit=${limit}&search=${encodeURIComponent(search)}`),
  })

  const deleteMutation = useMutation({
    mutationFn: (row: any) =>
      apiFetch("DELETE", `/bot/chat-support/history/${row.userId}/${encodeURIComponent(row.startedAt)}`),
    onSuccess: () => {
      toast({ title: "Đã xoá phiên chat" })
      qc.invalidateQueries({ queryKey: ["chat-support-history"] })
      setDetailOpen(false); setDeleteTarget(null)
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const deleteAllMutation = useMutation({
    mutationFn: () => apiFetch("DELETE", "/bot/chat-support/history"),
    onSuccess: () => {
      toast({ title: "Đã xoá toàn bộ lịch sử" })
      qc.invalidateQueries({ queryKey: ["chat-support-history"] })
      setDeleteAllOpen(false)
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  function openDetail(row: any) { setSelected(row); setDetailOpen(true) }
  function handleDeleteRow(row: any, e: React.MouseEvent) { e.stopPropagation(); setDeleteTarget(row) }

  const rows = data as any[]

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input placeholder="Tìm theo tên, username, ID..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 min-h-[44px]" />
        </div>
        <div className="flex gap-2">
          <select value={limit} onChange={e => setLimit(Number(e.target.value))} className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground">
            <option value={50}>50 phiên</option>
            <option value={100}>100 phiên</option>
            <option value={200}>200 phiên</option>
            <option value={500}>500 phiên</option>
          </select>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0" onClick={() => refetch()}>
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {!isLoading && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Hiển thị <span className="font-medium text-foreground">{rows.length}</span> phiên
          </p>
          {rows.length > 0 && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive gap-1.5 h-8" onClick={() => setDeleteAllOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />Xoá tất cả
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="md:hidden divide-y divide-border/50">
            {isLoading
              ? Array(5).fill(0).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                  </div>
                ))
              : rows.length === 0
                ? <div className="p-10 text-center text-muted-foreground text-sm">Chưa có lịch sử phiên chat.</div>
                : rows.map((row: any, i: number) => (
                    <div key={i} className="p-4 space-y-2 cursor-pointer hover:bg-muted/30 active:bg-muted/50 transition-colors" onClick={() => openDetail(row)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium text-sm truncate">{userName(row)}</span>
                          <EndReasonBadge reason={row.endReason} />
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0" onClick={e => handleDeleteRow(row, e)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(row.startedAt)}</span>
                        <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{fmtDuration(row.startedAt, row.endedAt)}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{row.msgCount ?? 0} tin</span>
                        {(row.messages ?? []).length > 0 && (
                          <span className="text-primary font-medium">• Có lịch sử hội thoại</span>
                        )}
                      </div>
                    </div>
                  ))
            }
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Người dùng</TableHead>
                  <TableHead>Bắt đầu</TableHead>
                  <TableHead>Kết thúc</TableHead>
                  <TableHead className="text-center">Thời lượng</TableHead>
                  <TableHead className="text-center">Tin nhắn</TableHead>
                  <TableHead className="text-center">Lý do đóng</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array(8).fill(0).map((_, i) => (
                      <TableRow key={i}><TableCell colSpan={7} className="h-12"><div className="h-4 bg-muted animate-pulse rounded" /></TableCell></TableRow>
                    ))
                  : rows.length === 0
                    ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Chưa có lịch sử phiên chat.</TableCell></TableRow>
                    : rows.map((row: any, i: number) => (
                        <TableRow key={i} className="cursor-pointer hover:bg-muted/40" onClick={() => openDetail(row)}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-sm">{userName(row)}</span>
                                {(row.messages ?? []).length > 0 && (
                                  <MessageSquare className="h-3 w-3 text-primary" title="Có lịch sử hội thoại" />
                                )}
                              </div>
                              <code className="text-xs text-muted-foreground font-mono">{row.userId}</code>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.startedAt)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.endedAt)}</TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm flex items-center justify-center gap-1">
                              <Timer className="h-3.5 w-3.5 text-muted-foreground" />{fmtDuration(row.startedAt, row.endedAt)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center gap-1 text-sm">
                              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />{row.msgCount ?? 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-center"><EndReasonBadge reason={row.endReason} /></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={e => handleDeleteRow(row, e)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <SessionDetailDialog row={selected} open={detailOpen} onClose={() => setDetailOpen(false)} onDelete={() => { setDetailOpen(false); setDeleteTarget(selected) }} />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá lịch sử phiên?</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá phiên chat của <strong>{deleteTarget ? userName(deleteTarget) : ""}</strong> lúc {fmtDate(deleteTarget?.startedAt)}? Không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}>Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá toàn bộ lịch sử?</AlertDialogTitle>
            <AlertDialogDescription>Tất cả {rows.length} phiên chat sẽ bị xoá vĩnh viễn. Không thể hoàn tác.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteAllMutation.mutate()}>Xoá tất cả</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Ban tab ──────────────────────────────────────────────────────────────────

const DURATION_OPTIONS = [
  { value: "1h",        label: "1 giờ" },
  { value: "3h",        label: "3 giờ" },
  { value: "8h",        label: "8 giờ" },
  { value: "24h",       label: "1 ngày" },
  { value: "3d",        label: "3 ngày" },
  { value: "7d",        label: "7 ngày" },
  { value: "30d",       label: "30 ngày" },
  { value: "permanent", label: "Vĩnh viễn" },
]

function BanTab() {
  const [userId,   setUserId]   = useState("")
  const [note,     setNote]     = useState("")
  const [duration, setDuration] = useState("permanent")
  const [unbanTarget, setUnbanTarget] = useState<any | null>(null)

  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: bannedList = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["chat-banned"],
    queryFn:  () => apiFetch("GET", "/bot/chat-support/banned"),
    refetchInterval: 30000,
  })

  const banMutation = useMutation({
    mutationFn: () => apiFetch("POST", `/bot/chat-support/banned/${userId.trim()}`, {
      note,
      expiresAt: computeExpiresAt(duration),
    }),
    onSuccess: () => {
      toast({ title: "✅ Đã cấm user" })
      qc.invalidateQueries({ queryKey: ["chat-banned"] })
      setUserId(""); setNote(""); setDuration("permanent")
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const unbanMutation = useMutation({
    mutationFn: (uid: string) => apiFetch("DELETE", `/bot/chat-support/banned/${uid}`),
    onSuccess: () => {
      toast({ title: "✅ Đã bỏ cấm" })
      qc.invalidateQueries({ queryKey: ["chat-banned"] })
      setUnbanTarget(null)
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const rows = bannedList as any[]

  function banLabel(row: any) {
    if (!row.expiresAt) return "Vĩnh viễn"
    const exp = new Date(row.expiresAt)
    const now = new Date()
    const diff = exp.getTime() - now.getTime()
    if (diff <= 0) return "Hết hạn"
    const h = Math.floor(diff / 3600000)
    const d = Math.floor(h / 24)
    if (d >= 1) return `Còn ${d} ngày`
    return `Còn ${h}h`
  }

  return (
    <div className="space-y-5">
      {/* Form cấm mới */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />Cấm user khỏi Chat Support
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm">ID Telegram</Label>
            <Input
              type="number" placeholder="VD: 123456789"
              value={userId} onChange={e => setUserId(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Thời hạn</Label>
              <select
                value={duration}
                onChange={e => setDuration(e.target.value)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {DURATION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Lý do (tuỳ chọn)</Label>
              <Input
                placeholder="Spam, quấy rối..."
                value={note} onChange={e => setNote(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>
          <Button
            onClick={() => banMutation.mutate()}
            disabled={!userId.trim() || banMutation.isPending}
            variant="destructive" className="w-full min-h-[44px]"
          >
            {banMutation.isPending ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Đang xử lý...</> : <><Ban className="h-4 w-4 mr-2" />Cấm Chat</>}
          </Button>
        </CardContent>
      </Card>

      {/* Danh sách đang cấm */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Đang cấm ({rows.length} user)</p>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="p-8 text-center text-muted-foreground text-sm">Đang tải...</div>
            : rows.length === 0
              ? <div className="p-8 text-center text-muted-foreground text-sm">Chưa có user nào bị cấm chat.</div>
              : <div className="divide-y divide-border/50">
                  {rows.map((row: any, i: number) => (
                    <div key={i} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-sm font-mono font-medium">{row.userId}</code>
                          <Badge
                            variant={row.expiresAt ? "outline" : "destructive"}
                            className="text-xs"
                          >
                            {row.expiresAt ? <><Clock className="h-3 w-3 mr-1" />{banLabel(row)}</> : "Vĩnh viễn"}
                          </Badge>
                        </div>
                        {row.note && <p className="text-xs text-muted-foreground truncate">{row.note}</p>}
                        <p className="text-xs text-muted-foreground">Cấm từ {fmtDate(row.bannedAt)}</p>
                        {row.expiresAt && <p className="text-xs text-muted-foreground">Đến {fmtDate(row.expiresAt)}</p>}
                      </div>
                      <Button
                        variant="outline" size="sm"
                        className="shrink-0 text-xs"
                        onClick={() => setUnbanTarget(row)}
                      >
                        Bỏ cấm
                      </Button>
                    </div>
                  ))}
                </div>
          }
        </CardContent>
      </Card>

      <AlertDialog open={!!unbanTarget} onOpenChange={v => !v && setUnbanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bỏ cấm chat?</AlertDialogTitle>
            <AlertDialogDescription>
              User <strong>{unbanTarget?.userId}</strong> sẽ có thể sử dụng chat support trở lại ngay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => unbanTarget && unbanMutation.mutate(String(unbanTarget.userId))}>
              Bỏ cấm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Admin tab ────────────────────────────────────────────────────────────────

function AdminTab() {
  const [newId,       setNewId]       = useState("")
  const [newName,     setNewName]     = useState("")
  const [newUsername, setNewUsername] = useState("")
  const [removeTarget, setRemoveTarget] = useState<any | null>(null)

  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: admins = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["chat-admins"],
    queryFn:  () => apiFetch("GET", "/bot/chat-support/admins"),
  })

  const addMutation = useMutation({
    mutationFn: () => apiFetch("POST", "/bot/chat-support/admins", {
      id:       Number(newId.trim()),
      name:     newName.trim(),
      username: newUsername.trim(),
    }),
    onSuccess: () => {
      toast({ title: "✅ Đã thêm admin phụ" })
      qc.invalidateQueries({ queryKey: ["chat-admins"] })
      setNewId(""); setNewName(""); setNewUsername("")
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiFetch("PUT", `/bot/chat-support/admins/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chat-admins"] }),
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => apiFetch("DELETE", `/bot/chat-support/admins/${id}`),
    onSuccess: () => {
      toast({ title: "✅ Đã xoá admin phụ" })
      qc.invalidateQueries({ queryKey: ["chat-admins"] })
      setRemoveTarget(null)
    },
    onError: (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  const rows = admins as any[]

  return (
    <div className="space-y-5">
      {/* Thông tin cơ chế */}
      <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 p-3 text-xs text-blue-800 dark:text-blue-300 space-y-1">
        <p className="font-semibold flex items-center gap-1.5"><ArrowRightLeft className="h-3.5 w-3.5" />Cơ chế chuyển phiên</p>
        <p>• Khi khách nhắn tin, bạn (Admin chính) sẽ nhận được với nút <strong>↗️ Chuyển phiên</strong>.</p>
        <p>• Bấm nút để chuyển cho Admin phụ — họ tiếp tục trò chuyện mà không thấy thông tin khách.</p>
        <p>• Admin phụ chỉ nhận được nội dung hội thoại, không thấy tên/ID khách.</p>
      </div>

      {/* Form thêm admin */}
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <UserCog className="h-4 w-4 text-primary" />Thêm Admin Phụ
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm">ID Telegram <span className="text-destructive">*</span></Label>
              <Input
                type="number" placeholder="VD: 123456789"
                value={newId} onChange={e => setNewId(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Tên hiển thị <span className="text-destructive">*</span></Label>
              <Input
                placeholder="VD: Admin B"
                value={newName} onChange={e => setNewName(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Username (tuỳ chọn)</Label>
            <Input
              placeholder="VD: @admin_b"
              value={newUsername} onChange={e => setNewUsername(e.target.value)}
              className="min-h-[44px]"
            />
          </div>
          <Button
            onClick={() => addMutation.mutate()}
            disabled={!newId.trim() || !newName.trim() || addMutation.isPending}
            className="w-full min-h-[44px]"
          >
            {addMutation.isPending
              ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Đang thêm...</>
              : <><Plus className="h-4 w-4 mr-2" />Thêm Admin Phụ</>
            }
          </Button>
        </CardContent>
      </Card>

      {/* Danh sách admin phụ */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Admin phụ ({rows.length})</p>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading
            ? <div className="p-8 text-center text-muted-foreground text-sm">Đang tải...</div>
            : rows.length === 0
              ? <div className="p-8 text-center text-muted-foreground text-sm">
                  <UserCog className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                  Chưa có admin phụ nào. Thêm để có thể chuyển phiên chat.
                </div>
              : <div className="divide-y divide-border/50">
                  {rows.map((admin: any) => (
                    <div key={admin.id} className="p-4 flex items-center gap-3">
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{admin.name}</span>
                          {admin.enabled
                            ? <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 gap-1">
                                <CheckCircle2 className="h-3 w-3" />Hoạt động
                              </Badge>
                            : <Badge variant="outline" className="text-xs text-muted-foreground gap-1">
                                <XCircle className="h-3 w-3" />Tắt
                              </Badge>
                          }
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs text-muted-foreground font-mono">{admin.id}</code>
                          {admin.username && <span className="text-xs text-muted-foreground">{admin.username}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground">Thêm {fmtDate(admin.addedAt)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Switch
                          checked={admin.enabled}
                          onCheckedChange={enabled => toggleMutation.mutate({ id: admin.id, enabled })}
                        />
                        <Button
                          variant="ghost" size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => setRemoveTarget(admin)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
          }
        </CardContent>
      </Card>

      <AlertDialog open={!!removeTarget} onOpenChange={v => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá admin phụ?</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá <strong>{removeTarget?.name}</strong> ({removeTarget?.id}) khỏi danh sách admin phụ? Họ sẽ không còn nhận được phiên chat được chuyển.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}>Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function NumberField({
  id, label, hint, value, onChange, min, max,
}: {
  id: string; label: string; hint?: string;
  value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <Input
        id={id} type="number" min={min} max={max}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="min-h-[44px]"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SettingsTab() {
  const { toast } = useToast()

  const [timeoutMinutes,     setTimeoutMinutes]     = useState(10)
  const [deleteDelayMinutes, setDeleteDelayMinutes] = useState(5)
  const [spamMaxMsgs,        setSpamMaxMsgs]        = useState(10)
  const [spamWindowSec,      setSpamWindowSec]      = useState(60)
  const [spamWarnAt,         setSpamWarnAt]         = useState(8)
  const [sessionCooldownSec, setSessionCooldownSec] = useState(120)

  const { isLoading, data: settingsData } = useQuery({
    queryKey: ["chat-support-settings"],
    queryFn: () => apiFetch("GET", "/bot/chat-support/settings"),
  })

  useEffect(() => {
    if (!settingsData) return
    const d = settingsData as any
    setTimeoutMinutes(d.timeoutMinutes        ?? 10)
    setDeleteDelayMinutes(d.deleteDelayMinutes ?? 5)
    setSpamMaxMsgs(d.spamMaxMsgs              ?? 10)
    setSpamWindowSec(d.spamWindowSec          ?? 60)
    setSpamWarnAt(d.spamWarnAt                ?? 8)
    setSessionCooldownSec(d.sessionCooldownSec ?? 120)
  }, [settingsData])

  const warnAtError = spamWarnAt >= spamMaxMsgs
    ? `Cảnh báo (${spamWarnAt}) phải nhỏ hơn giới hạn chặn (${spamMaxMsgs})`
    : null

  const mutation = useMutation({
    mutationFn: () => apiFetch("PUT", "/bot/chat-support/settings", {
      timeoutMinutes, deleteDelayMinutes,
      spamMaxMsgs, spamWindowSec, spamWarnAt, sessionCooldownSec,
    }),
    onSuccess: () => toast({ title: "Đã lưu cài đặt" }),
    onError:   (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Đang tải...</div>

  return (
    <div className="space-y-5 max-w-sm">
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />Phiên chat
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <NumberField
            id="timeout" label="Timeout phiên (phút)"
            hint={`Phiên tự đóng sau ${timeoutMinutes} phút không có tin nhắn.`}
            value={timeoutMinutes} onChange={setTimeoutMinutes} min={1} max={120}
          />
          <NumberField
            id="delay" label="Thời gian xoá tin (phút)"
            hint={`Tin nhắn bị xoá ${deleteDelayMinutes} phút sau khi phiên kết thúc.`}
            value={deleteDelayMinutes} onChange={setDeleteDelayMinutes} min={1} max={60}
          />
          <NumberField
            id="cooldown" label="Cooldown mở phiên mới (giây)"
            hint={`User phải chờ ${sessionCooldownSec}s sau khi đóng phiên trước. Đặt 0 để tắt.`}
            value={sessionCooldownSec} onChange={setSessionCooldownSec} min={0} max={600}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />Chống spam tin nhắn
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="maxMsgs" label="Giới hạn chặn (tin)"
              hint="Chặn khi vượt quá"
              value={spamMaxMsgs} onChange={setSpamMaxMsgs} min={1} max={100}
            />
            <NumberField
              id="window" label="Cửa sổ (giây)"
              hint="Tính trong N giây"
              value={spamWindowSec} onChange={setSpamWindowSec} min={10} max={600}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="warnAt" className="text-sm font-medium">Cảnh báo từ tin thứ</Label>
            <Input
              id="warnAt" type="number" min={1} max={spamMaxMsgs - 1}
              value={spamWarnAt}
              onChange={e => setSpamWarnAt(Number(e.target.value))}
              className={`min-h-[44px] ${warnAtError ? "border-destructive" : ""}`}
            />
            {warnAtError
              ? <p className="text-xs text-destructive">{warnAtError}</p>
              : <p className="text-xs text-muted-foreground">
                  Gửi cảnh báo khi user đạt tin thứ {spamWarnAt} trong {spamWindowSec}s (còn {spamMaxMsgs - spamWarnAt} tin trước khi bị chặn).
                </p>
            }
          </div>
          <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
            <p>📊 <strong>Tóm tắt:</strong></p>
            <p>• Cảnh báo khi gửi tin thứ <strong>{spamWarnAt}</strong> trong <strong>{spamWindowSec}s</strong></p>
            <p>• Chặn khi gửi tin thứ <strong>{spamMaxMsgs}</strong> trong <strong>{spamWindowSec}s</strong></p>
            <p>• Cooldown mở phiên mới: <strong>{sessionCooldownSec === 0 ? "Tắt" : `${sessionCooldownSec}s`}</strong></p>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !!warnAtError}
        className="w-full min-h-[44px]"
      >
        {mutation.isPending
          ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Đang lưu...</>
          : "Lưu cài đặt"
        }
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        ⚠️ Cài đặt spam có hiệu lực ngay lần gửi tin tiếp theo (đọc realtime từ file).
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatSupport() {
  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Chat Support</h1>
        <p className="text-muted-foreground mt-1 text-sm">Lịch sử phiên, cấm chat và quản lý admin phụ</p>
      </div>
      <Tabs defaultValue="history">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="history"  className="gap-1.5 text-xs sm:text-sm"><History   className="h-3.5 w-3.5" />Lịch sử</TabsTrigger>
          <TabsTrigger value="ban"      className="gap-1.5 text-xs sm:text-sm"><Ban       className="h-3.5 w-3.5" />Cấm chat</TabsTrigger>
          <TabsTrigger value="admins"   className="gap-1.5 text-xs sm:text-sm"><UserCog   className="h-3.5 w-3.5" />Admin</TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5 text-xs sm:text-sm"><Settings  className="h-3.5 w-3.5" />Cài đặt</TabsTrigger>
        </TabsList>
        <TabsContent value="history"  className="mt-0"><HistoryTab /></TabsContent>
        <TabsContent value="ban"      className="mt-0"><BanTab /></TabsContent>
        <TabsContent value="admins"   className="mt-0"><AdminTab /></TabsContent>
        <TabsContent value="settings" className="mt-0"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  )
}
