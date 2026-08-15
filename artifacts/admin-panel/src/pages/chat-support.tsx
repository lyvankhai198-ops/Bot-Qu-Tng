import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  MessageSquare, Clock, User, Search, History,
  Settings, RefreshCw, XCircle, Timer, Trash2,
} from "lucide-react"

// ─── helpers ──────────────────────────────────────────────────────────────────

function apiToken() { return localStorage.getItem("admin_token") ?? "" }

async function apiFetch(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken()}`,
    },
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

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function SessionDetailDialog({
  row,
  open,
  onClose,
  onDelete,
}: {
  row: any | null
  open: boolean
  onClose: () => void
  onDelete: () => void
}) {
  if (!row) return null
  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Chi tiết phiên chat
          </DialogTitle>
          <DialogDescription>{fmtDate(row.startedAt)}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {/* user */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tên</span>
              <span className="font-medium">{row.firstName || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Username</span>
              <span className="font-mono">{row.username ? `@${row.username}` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ID</span>
              <code className="font-mono text-xs">{row.userId}</code>
            </div>
          </div>

          {/* session */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Bắt đầu</span>
              <span>{fmtDate(row.startedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kết thúc</span>
              <span>{fmtDate(row.endedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Thời lượng</span>
              <span className="font-medium">{fmtDuration(row.startedAt, row.endedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Số tin nhắn</span>
              <span className="font-medium">{row.msgCount ?? 0} tin</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Lý do đóng</span>
              <EndReasonBadge reason={row.endReason} />
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Nội dung tin nhắn đã được xoá tự động sau phiên kết thúc.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="destructive" size="sm" onClick={onDelete} className="gap-2">
            <Trash2 className="h-4 w-4" />Xoá lịch sử
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Đóng</Button>
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
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)  // single delete
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
      setDetailOpen(false)
      setDeleteTarget(null)
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

  function openDetail(row: any) {
    setSelected(row)
    setDetailOpen(true)
  }

  function handleDeleteRow(row: any, e: React.MouseEvent) {
    e.stopPropagation()
    setDeleteTarget(row)
  }

  const rows = data as any[]

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Tìm theo tên, username, ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 min-h-[44px]"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground"
          >
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

      {/* summary + xoá tất cả */}
      {!isLoading && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Hiển thị <span className="font-medium text-foreground">{rows.length}</span> phiên
          </p>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive gap-1.5 h-8"
              onClick={() => setDeleteAllOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />Xoá tất cả
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {/* Mobile */}
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
                    <div
                      key={i}
                      className="p-4 space-y-2 cursor-pointer hover:bg-muted/30 active:bg-muted/50 transition-colors"
                      onClick={() => openDetail(row)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <User className="h-4 w-4 text-primary shrink-0" />
                          <span className="font-medium text-sm truncate">{userName(row)}</span>
                          <EndReasonBadge reason={row.endReason} />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={e => handleDeleteRow(row, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(row.startedAt)}</span>
                        <span className="flex items-center gap-1"><Timer className="h-3 w-3" />{fmtDuration(row.startedAt, row.endedAt)}</span>
                        <span className="flex items-center gap-1"><MessageSquare className="h-3 w-3" />{row.msgCount ?? 0} tin</span>
                        <code className="font-mono">{row.userId}</code>
                      </div>
                    </div>
                  ))
            }
          </div>

          {/* Desktop */}
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
                      <TableRow key={i}>
                        <TableCell colSpan={7} className="h-12">
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      </TableRow>
                    ))
                  : rows.length === 0
                    ? <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Chưa có lịch sử phiên chat.</TableCell></TableRow>
                    : rows.map((row: any, i: number) => (
                        <TableRow
                          key={i}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => openDetail(row)}
                        >
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sm">{userName(row)}</span>
                              <code className="text-xs text-muted-foreground font-mono">{row.userId}</code>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.startedAt)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fmtDate(row.endedAt)}</TableCell>
                          <TableCell className="text-center">
                            <span className="text-sm flex items-center justify-center gap-1">
                              <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                              {fmtDuration(row.startedAt, row.endedAt)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center gap-1 text-sm">
                              <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                              {row.msgCount ?? 0}
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <EndReasonBadge reason={row.endReason} />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={e => handleDeleteRow(row, e)}
                            >
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

      {/* Detail dialog */}
      <SessionDetailDialog
        row={selected}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onDelete={() => {
          setDetailOpen(false)
          setDeleteTarget(selected)
        }}
      />

      {/* Confirm delete single */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá lịch sử phiên?</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá phiên chat của <strong>{deleteTarget ? userName(deleteTarget) : ""}</strong> lúc {fmtDate(deleteTarget?.startedAt)}?
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm delete all */}
      <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá toàn bộ lịch sử?</AlertDialogTitle>
            <AlertDialogDescription>
              Tất cả {rows.length} phiên chat sẽ bị xoá vĩnh viễn. Không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteAllMutation.mutate()}
            >
              Xoá tất cả
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast()
  const [timeoutMinutes,     setTimeoutMinutes]     = useState(10)
  const [deleteDelayMinutes, setDeleteDelayMinutes] = useState(5)

  const { isLoading } = useQuery({
    queryKey: ["chat-support-settings"],
    queryFn: () => apiFetch("GET", "/bot/chat-support/settings"),
    select: (d: any) => {
      setTimeoutMinutes(d.timeoutMinutes ?? 10)
      setDeleteDelayMinutes(d.deleteDelayMinutes ?? 5)
      return d
    },
  })

  const mutation = useMutation({
    mutationFn: () => apiFetch("PUT", "/bot/chat-support/settings", { timeoutMinutes, deleteDelayMinutes }),
    onSuccess: () => toast({ title: "Đã lưu cài đặt" }),
    onError:   (e: any) => toast({ title: "Lỗi", description: e.message, variant: "destructive" }),
  })

  if (isLoading) return <div className="p-8 text-center text-muted-foreground text-sm">Đang tải...</div>

  return (
    <div className="space-y-5 max-w-sm">
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="timeout" className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              Timeout phiên (phút)
            </Label>
            <Input
              id="timeout"
              type="number"
              min={1} max={120}
              value={timeoutMinutes}
              onChange={e => setTimeoutMinutes(Number(e.target.value))}
              className="min-h-[44px]"
            />
            <p className="text-xs text-muted-foreground">
              Phiên tự đóng nếu không có tin nhắn sau {timeoutMinutes} phút.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delay" className="flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              Thời gian xoá tin (phút)
            </Label>
            <Input
              id="delay"
              type="number"
              min={1} max={60}
              value={deleteDelayMinutes}
              onChange={e => setDeleteDelayMinutes(Number(e.target.value))}
              className="min-h-[44px]"
            />
            <p className="text-xs text-muted-foreground">
              Tin nhắn bị xoá {deleteDelayMinutes} phút sau khi phiên kết thúc.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full min-h-[44px]"
      >
        {mutation.isPending
          ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Đang lưu...</>
          : "Lưu cài đặt"}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        ⚠️ Cài đặt có hiệu lực ngay lần check tiếp theo của bot (trong vòng 1 phút).
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
        <p className="text-muted-foreground mt-1 text-sm">Lịch sử phiên hỗ trợ trực tiếp và cài đặt tự động</p>
      </div>

      <Tabs defaultValue="history">
        <TabsList className="mb-4">
          <TabsTrigger value="history" className="gap-2">
            <History className="h-4 w-4" />
            Lịch sử
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Cài đặt
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history" className="mt-0">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-0">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
