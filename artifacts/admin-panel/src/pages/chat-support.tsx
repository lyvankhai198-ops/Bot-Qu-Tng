import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
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

// ─── History tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const [search, setSearch] = useState("")
  const [limit,  setLimit]  = useState(50)

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["chat-support-history", search, limit],
    queryFn: () => apiFetch("GET", `/bot/chat-support/history?limit=${limit}&search=${encodeURIComponent(search)}`),
  })

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

      {/* summary */}
      {!isLoading && (
        <p className="text-sm text-muted-foreground">
          Hiển thị <span className="font-medium text-foreground">{(data as any[]).length}</span> phiên
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {/* Mobile */}
          <div className="md:hidden divide-y divide-border/50">
            {isLoading
              ? Array(6).fill(0).map((_, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                    <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                  </div>
                ))
              : (data as any[]).length === 0
                ? <div className="p-10 text-center text-muted-foreground text-sm">Chưa có lịch sử phiên chat.</div>
                : (data as any[]).map((row: any, i: number) => (
                    <div key={i} className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium text-sm">
                          {row.firstName || row.username
                            ? `${row.firstName ?? ""}${row.username ? ` @${row.username}` : ""}`
                            : `User ${row.userId}`}
                        </span>
                        <EndReasonBadge reason={row.endReason} />
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? Array(8).fill(0).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6} className="h-12">
                          <div className="h-4 bg-muted animate-pulse rounded" />
                        </TableCell>
                      </TableRow>
                    ))
                  : (data as any[]).length === 0
                    ? <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Chưa có lịch sử phiên chat.</TableCell></TableRow>
                    : (data as any[]).map((row: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-sm">
                                {row.firstName || row.username
                                  ? `${row.firstName ?? ""}${row.username ? ` @${row.username}` : ""}`
                                  : `User ${row.userId}`}
                              </span>
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
                        </TableRow>
                      ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function EndReasonBadge({ reason }: { reason: string }) {
  if (reason === "timeout") {
    return (
      <Badge variant="outline" className="text-xs gap-1 text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30">
        <Timer className="h-3 w-3" /> Timeout
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-xs gap-1 text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30">
      <XCircle className="h-3 w-3" /> User kết thúc
    </Badge>
  )
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

function SettingsTab() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ["chat-support-settings"],
    queryFn: () => apiFetch("GET", "/bot/chat-support/settings"),
  })

  const [timeout,     setTimeout_]     = useState<number | "">("")
  const [deleteDelay, setDeleteDelay]  = useState<number | "">("")

  // sync from server once loaded
  const timeoutVal     = timeout     !== "" ? timeout     : (settings?.timeoutMinutes     ?? 10)
  const deleteDelayVal = deleteDelay !== "" ? deleteDelay : (settings?.deleteDelayMinutes ?? 5)

  const mutation = useMutation({
    mutationFn: (body: any) => apiFetch("PUT", "/bot/chat-support/settings", body),
    onSuccess: () => {
      toast({ title: "✅ Đã lưu cài đặt Chat Support" })
      qc.invalidateQueries({ queryKey: ["chat-support-settings"] })
    },
    onError: (e: any) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  const handleSave = () => {
    mutation.mutate({
      timeoutMinutes:     Number(timeoutVal),
      deleteDelayMinutes: Number(deleteDelayVal),
    })
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          {Array(2).fill(0).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 bg-muted animate-pulse rounded w-32" />
              <div className="h-10 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="max-w-lg space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Timer className="h-4 w-4 text-amber-500" />
            Thời gian chờ (timeout)
          </CardTitle>
          <CardDescription>
            Tự động đóng phiên chat sau bao nhiêu phút không có tin nhắn.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={120}
              value={timeoutVal}
              onChange={e => setTimeout_(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-28 min-h-[44px]"
            />
            <Label className="text-muted-foreground">phút (1–120)</Label>
          </div>
          <p className="text-xs text-muted-foreground">Hiện tại: <span className="font-medium text-foreground">{settings?.timeoutMinutes ?? "—"} phút</span></p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-500" />
            Thời gian xoá tin nhắn
          </CardTitle>
          <CardDescription>
            Sau khi kết thúc phiên, bot sẽ xoá toàn bộ tin nhắn sau bao nhiêu phút.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={1}
              max={60}
              value={deleteDelayVal}
              onChange={e => setDeleteDelay(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-28 min-h-[44px]"
            />
            <Label className="text-muted-foreground">phút (1–60)</Label>
          </div>
          <p className="text-xs text-muted-foreground">Hiện tại: <span className="font-medium text-foreground">{settings?.deleteDelayMinutes ?? "—"} phút</span></p>
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={mutation.isPending}
        className="w-full min-h-[44px]"
      >
        {mutation.isPending ? (
          <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Đang lưu...</>
        ) : "Lưu cài đặt"}
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
