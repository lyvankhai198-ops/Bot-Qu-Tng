import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Truck, RefreshCw, Loader2, Send, Clock, CheckCircle2, XCircle, Package, Banknote, RotateCcw, BadgeCheck, Lock, ExternalLink } from "lucide-react"
import { format } from "date-fns"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

const UNLOCK_PAGE_BASE = "http://103.180.138.203/api/customer-page"

interface DeliveryRequest {
  id: string
  userId: string
  username: string
  firstName: string
  orderId: string
  userLang: string
  submittedAt: string
  status: "pending" | "sent" | "failed" | "refunded" | "done" | "pending_unlock"
  sentAt: string | null
  sentBy: string | null
  refundedAt: string | null
  refundAmount: number | null
  refundNote: string | null
  doneAt: string | null
  doneNote: string | null
  accountInfo: { account: string; password: string; twoFA: string | null } | null
  unlockUrl?: string | null
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent")           return <Badge className="bg-green-100 text-green-800 border-green-300 whitespace-nowrap">✅ Đã giao</Badge>
  if (status === "pending_unlock") return <Badge className="bg-blue-100 text-blue-800 border-blue-300 whitespace-nowrap">🔒 Chờ khách mở khoá</Badge>
  if (status === "failed")         return <Badge className="bg-red-100 text-red-800 border-red-300 whitespace-nowrap">❌ Giao thất bại</Badge>
  if (status === "refunded")       return <Badge className="bg-purple-100 text-purple-800 border-purple-300 whitespace-nowrap">💰 Đã hoàn tiền</Badge>
  if (status === "done")           return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 whitespace-nowrap">✅ Đã xong</Badge>
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 whitespace-nowrap">⏳ Chờ xử lý</Badge>
}

function parseAccountLine(line: string): { account: string; password: string; twoFA: string } {
  const parts = line.split("|")
  return {
    account: parts[0]?.trim() ?? "",
    password: parts[1]?.trim() ?? "",
    twoFA: parts[2]?.trim() ?? "",
  }
}

export default function Delivery() {
  const { toast } = useToast()
  const [requests, setRequests] = useState<DeliveryRequest[]>([])
  const [loading, setLoading] = useState(true)

  // --- Send dialog ---
  const [selected, setSelected] = useState<DeliveryRequest | null>(null)
  const [sending, setSending] = useState(false)
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [twoFA, setTwoFA] = useState("")
  const [rawLine, setRawLine] = useState("")
  const [useRaw, setUseRaw] = useState(false)

  // --- Refund dialog ---
  const [refundTarget, setRefundTarget] = useState<DeliveryRequest | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [refundAmount, setRefundAmount] = useState("")
  const [refundNote, setRefundNote] = useState("")

  // --- Done dialog ---
  const [doneTarget, setDoneTarget] = useState<DeliveryRequest | null>(null)
  const [doneLoading, setDoneLoading] = useState(false)
  const [doneNote, setDoneNote] = useState("")
  const [doneNotify, setDoneNotify] = useState(true)

  const fetchRequests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/bot/delivery", { headers: authHeader() })
      const data = await res.json()
      setRequests(Array.isArray(data) ? data : [])
    } catch {
      toast({ title: "Lỗi", description: "Không thể tải danh sách yêu cầu", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  function openSendModal(req: DeliveryRequest) {
    setSelected(req)
    setAccount(""); setPassword(""); setTwoFA(""); setRawLine(""); setUseRaw(false)
  }
  function closeSendModal() { setSelected(null) }

  function openRefundModal(req: DeliveryRequest) {
    setRefundTarget(req); setRefundAmount(""); setRefundNote("")
  }
  function closeRefundModal() { setRefundTarget(null) }

  function openDoneModal(req: DeliveryRequest) {
    setDoneTarget(req); setDoneNote(""); setDoneNotify(true)
  }
  function closeDoneModal() { setDoneTarget(null) }

  async function handleSend() {
    if (!selected) return
    let acc = account.trim(), pwd = password.trim(), tfa = twoFA.trim()
    if (useRaw) { const p = parseAccountLine(rawLine); acc = p.account; pwd = p.password; tfa = p.twoFA }
    if (!acc || !pwd) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập tài khoản và mật khẩu", variant: "destructive" })
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/bot/delivery/${selected.id}/send`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ account: acc, password: pwd, twoFA: tfa || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.message ?? "Lỗi không xác định")
      if (data.warned) {
        toast({ title: "⚠️ Đã lưu tài khoản", description: data.warned, variant: "destructive" })
      } else {
        toast({ title: "🔒 Đã lưu & gửi link", description: "Khách sẽ nhận được link mở khoá qua Telegram" })
      }
      closeSendModal(); fetchRequests()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message ?? "Không thể gửi tài khoản", variant: "destructive" })
    } finally { setSending(false) }
  }

  async function handleRefund() {
    if (!refundTarget) return
    const amt = refundAmount.trim().replace(/[.,\s]/g, "")
    if (!amt || isNaN(Number(amt))) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập số tiền hoàn hợp lệ", variant: "destructive" })
      return
    }
    setRefunding(true)
    try {
      const res = await fetch(`/api/bot/delivery/${refundTarget.id}/refund`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amt), note: refundNote.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.message ?? "Lỗi không xác định")
      toast({ title: "💰 Đã hoàn tiền", description: "Khách hàng đã được thông báo qua Telegram" })
      closeRefundModal(); fetchRequests()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message ?? "Không thể hoàn tiền", variant: "destructive" })
    } finally { setRefunding(false) }
  }

  async function handleDone() {
    if (!doneTarget) return
    setDoneLoading(true)
    try {
      const res = await fetch(`/api/bot/delivery/${doneTarget.id}/done`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ note: doneNote.trim() || undefined, notify: doneNotify }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.message ?? "Lỗi không xác định")
      if (data.warned) toast({ title: "⚠️ Đã lưu", description: data.warned, variant: "destructive" })
      else toast({ title: "✅ Đã đánh dấu xong", description: doneNotify ? "Khách hàng đã được thông báo" : "Đã cập nhật trạng thái" })
      closeDoneModal(); fetchRequests()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message ?? "Không thể cập nhật", variant: "destructive" })
    } finally { setDoneLoading(false) }
  }

  const pending       = requests.filter(r => r.status === "pending").length
  const pendingUnlock = requests.filter(r => r.status === "pending_unlock").length
  const sent          = requests.filter(r => r.status === "sent").length
  const refunded      = requests.filter(r => r.status === "refunded").length
  const failed        = requests.filter(r => r.status === "failed").length

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-6 w-6" /> Giao tài khoản
          </h1>
          <p className="text-muted-foreground mt-1">Xử lý các yêu cầu giao hàng từ khách hàng</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchRequests} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Làm mới</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Clock className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
            <div className="text-2xl font-bold">{pending}</div>
            <div className="text-sm text-muted-foreground">Chờ xử lý</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Lock className="h-8 w-8 mx-auto mb-2 text-blue-500" />
            <div className="text-2xl font-bold">{pendingUnlock}</div>
            <div className="text-sm text-muted-foreground">Chờ mở khoá</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
            <div className="text-2xl font-bold">{sent}</div>
            <div className="text-sm text-muted-foreground">Đã giao</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <Banknote className="h-8 w-8 mx-auto mb-2 text-purple-500" />
            <div className="text-2xl font-bold">{refunded}</div>
            <div className="text-sm text-muted-foreground">Đã hoàn tiền</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 text-center">
            <XCircle className="h-8 w-8 mx-auto mb-2 text-red-500" />
            <div className="text-2xl font-bold">{failed}</div>
            <div className="text-sm text-muted-foreground">Giao thất bại</div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" /> Danh sách yêu cầu
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Truck className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Chưa có yêu cầu giao hàng nào</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Người dùng</TableHead>
                    <TableHead className="hidden md:table-cell">Telegram ID</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map(req => (
                    <TableRow key={req.id} className={req.status === "pending" ? "bg-yellow-50/40 dark:bg-yellow-950/20" : req.status === "pending_unlock" ? "bg-blue-50/40 dark:bg-blue-950/20" : ""}>
                      <TableCell className="font-mono font-medium text-xs">{req.orderId}</TableCell>
                      <TableCell>
                        <div className="font-medium">{req.firstName || "—"}</div>
                        {req.username && <div className="text-xs text-muted-foreground">@{req.username}</div>}
                      </TableCell>
                      <TableCell className="hidden md:table-cell font-mono text-sm">{req.userId}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(req.submittedAt), "dd/MM/yyyy HH:mm")}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <StatusBadge status={req.status} />
                          {req.status === "pending_unlock" && (
                            <a
                              href={`${UNLOCK_PAGE_BASE}?id=${encodeURIComponent(req.orderId)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" /> Link mở khoá
                            </a>
                          )}
                          {req.status === "refunded" && req.refundAmount != null && (
                            <div className="text-xs text-muted-foreground">
                              {req.refundAmount.toLocaleString("vi-VN")}đ
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {/* Hoàn tiền / Đã xong — cho pending, pending_unlock, failed */}
                          {(req.status === "pending" || req.status === "pending_unlock" || req.status === "failed") ? (<>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                              onClick={() => openDoneModal(req)}
                            >
                              <BadgeCheck className="h-3 w-3 mr-1" /> Đã xong
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-purple-600 border-purple-300 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                              onClick={() => openRefundModal(req)}
                            >
                              <Banknote className="h-3 w-3 mr-1" /> Hoàn tiền
                            </Button>
                          </>) : null}
                          {/* Giao tài khoản / Giao lại */}
                          <Button
                            size="sm"
                            variant={req.status === "pending" ? "default" : "outline"}
                            onClick={() => openSendModal(req)}
                          >
                            {req.status === "pending"
                              ? <><Send className="h-3 w-3 mr-1" />Giao tài khoản</>
                              : req.status === "pending_unlock"
                                ? <><RotateCcw className="h-3 w-3 mr-1" />Gửi lại link</>
                                : <><RotateCcw className="h-3 w-3 mr-1" />Giao lại</>
                            }
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Send Account Dialog ── */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) closeSendModal() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" /> Giao tài khoản
            </DialogTitle>
            <DialogDescription>
              Mã đơn: <span className="font-mono font-medium">{selected?.orderId}</span>
              {" · "}Người dùng:{" "}
              {selected?.username ? `@${selected.username}` : selected?.firstName || selected?.userId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button size="sm" variant={!useRaw ? "default" : "outline"} onClick={() => setUseRaw(false)} className="flex-1">
                Nhập riêng từng ô
              </Button>
              <Button size="sm" variant={useRaw ? "default" : "outline"} onClick={() => setUseRaw(true)} className="flex-1">
                Định dạng email|pass|2FA
              </Button>
            </div>

            {useRaw ? (
              <div className="space-y-2">
                <Label>Định dạng: email|password|2FA</Label>
                <Input
                  placeholder="abc@email.com|password123|123456"
                  value={rawLine}
                  onChange={e => setRawLine(e.target.value)}
                  className="font-mono text-sm"
                />
                {rawLine && (
                  <div className="text-xs text-muted-foreground bg-muted rounded p-2 font-mono space-y-1">
                    {(() => { const p = parseAccountLine(rawLine); return <>
                      <div>📧 {p.account || "—"}</div>
                      <div>🔒 {p.password || "—"}</div>
                      {p.twoFA && <div>🛡 {p.twoFA}</div>}
                    </> })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="del-account">📧 Tài khoản</Label>
                  <Input id="del-account" placeholder="email@example.com" value={account} onChange={e => setAccount(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="del-password">🔒 Mật khẩu</Label>
                  <Input id="del-password" placeholder="Mật khẩu" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="del-2fa">🛡 2FA (tuỳ chọn)</Label>
                  <Input id="del-2fa" placeholder="Để trống nếu không có" value={twoFA} onChange={e => setTwoFA(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeSendModal} disabled={sending}>Huỷ</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Gửi tài khoản
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Done Dialog ── */}
      <Dialog open={!!doneTarget} onOpenChange={open => { if (!open) closeDoneModal() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="h-5 w-5" /> Đánh dấu đã xong
            </DialogTitle>
            <DialogDescription>
              Mã đơn: <span className="font-mono font-medium">{doneTarget?.orderId}</span>
              {" · "}Người dùng:{" "}
              {doneTarget?.username ? `@${doneTarget.username}` : doneTarget?.firstName || doneTarget?.userId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="done-note">📝 Ghi chú <span className="text-muted-foreground text-xs">(tuỳ chọn)</span></Label>
              <Textarea
                id="done-note"
                placeholder="VD: Đã xử lý qua kênh khác..."
                value={doneNote}
                onChange={e => setDoneNote(e.target.value)}
                rows={3}
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer select-none rounded-lg border p-3 hover:bg-muted/40 transition-colors">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={doneNotify}
                onChange={e => setDoneNotify(e.target.checked)}
              />
              <div>
                <div className="text-sm font-medium">Gửi thông báo cho khách</div>
                <div className="text-xs text-muted-foreground">Bot sẽ nhắn Telegram: "✅ Yêu cầu giao tài khoản đã được xử lý xong."</div>
              </div>
            </label>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={closeDoneModal} disabled={doneLoading} className="w-full sm:w-auto">
              Huỷ
            </Button>
            <Button
              onClick={handleDone}
              disabled={doneLoading}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {doneLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BadgeCheck className="h-4 w-4 mr-2" />}
              Xác nhận đã xong
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Refund Dialog ── */}
      <Dialog open={!!refundTarget} onOpenChange={open => { if (!open) closeRefundModal() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
              <Banknote className="h-5 w-5" /> Hoàn tiền
            </DialogTitle>
            <DialogDescription>
              Mã đơn: <span className="font-mono font-medium">{refundTarget?.orderId}</span>
              {" · "}Người dùng:{" "}
              {refundTarget?.username ? `@${refundTarget.username}` : refundTarget?.firstName || refundTarget?.userId}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-950/20 dark:border-purple-800 p-3 text-sm text-purple-800 dark:text-purple-300">
              ⚠️ Không có tài khoản để giao — bot sẽ gửi thông báo hoàn tiền cho khách qua Telegram.
            </div>

            <div className="space-y-1">
              <Label htmlFor="refund-amount">💵 Số tiền hoàn (VNĐ) <span className="text-destructive">*</span></Label>
              <Input
                id="refund-amount"
                type="text"
                inputMode="numeric"
                placeholder="VD: 200000"
                value={refundAmount}
                onChange={e => setRefundAmount(e.target.value.replace(/[^0-9.,]/g, ""))}
                className="font-mono"
              />
              {refundAmount && !isNaN(Number(refundAmount.replace(/[.,]/g, ""))) && (
                <div className="text-xs text-muted-foreground">
                  = {Number(refundAmount.replace(/[.,\s]/g, "")).toLocaleString("vi-VN")}đ
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label htmlFor="refund-note">📝 Ghi chú <span className="text-muted-foreground text-xs">(tuỳ chọn)</span></Label>
              <Textarea
                id="refund-note"
                placeholder="VD: Hết hàng, hoàn tiền trong vòng 24h..."
                value={refundNote}
                onChange={e => setRefundNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={closeRefundModal} disabled={refunding} className="w-full sm:w-auto">
              Huỷ
            </Button>
            <Button
              onClick={handleRefund}
              disabled={refunding}
              className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white"
            >
              {refunding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Banknote className="h-4 w-4 mr-2" />}
              Xác nhận hoàn tiền
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
