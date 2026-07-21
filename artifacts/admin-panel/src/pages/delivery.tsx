import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Truck, RefreshCw, Loader2, Send, Clock, CheckCircle2, XCircle, Package } from "lucide-react"
import { format } from "date-fns"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

interface DeliveryRequest {
  id: string
  userId: string
  username: string
  firstName: string
  orderId: string
  userLang: string
  submittedAt: string
  status: "pending" | "sent" | "failed"
  sentAt: string | null
  sentBy: string | null
  accountInfo: { account: string; password: string; twoFA: string | null } | null
}

function StatusBadge({ status }: { status: string }) {
  if (status === "sent")
    return <Badge className="bg-green-100 text-green-800 border-green-300">✅ Đã giao</Badge>
  if (status === "failed")
    return <Badge className="bg-red-100 text-red-800 border-red-300">❌ Giao thất bại</Badge>
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">⏳ Chờ xử lý</Badge>
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
  const [selected, setSelected] = useState<DeliveryRequest | null>(null)
  const [sending, setSending] = useState(false)

  // Form fields
  const [account, setAccount] = useState("")
  const [password, setPassword] = useState("")
  const [twoFA, setTwoFA] = useState("")
  const [rawLine, setRawLine] = useState("")
  const [useRaw, setUseRaw] = useState(false)

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

  function openModal(req: DeliveryRequest) {
    setSelected(req)
    setAccount("")
    setPassword("")
    setTwoFA("")
    setRawLine("")
    setUseRaw(false)
  }

  function closeModal() {
    setSelected(null)
  }

  async function handleSend() {
    if (!selected) return
    let acc = account.trim()
    let pwd = password.trim()
    let tfa = twoFA.trim()

    if (useRaw) {
      const parsed = parseAccountLine(rawLine)
      acc = parsed.account
      pwd = parsed.password
      tfa = parsed.twoFA
    }

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
      toast({ title: "✅ Thành công", description: "Tài khoản đã được gửi cho người dùng" })
      closeModal()
      fetchRequests()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message ?? "Không thể gửi tài khoản", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  const pending = requests.filter(r => r.status === "pending").length
  const sent    = requests.filter(r => r.status === "sent").length
  const failed  = requests.filter(r => r.status === "failed").length

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
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6 text-center">
            <Clock className="h-8 w-8 mx-auto mb-2 text-yellow-500" />
            <div className="text-2xl font-bold">{pending}</div>
            <div className="text-sm text-muted-foreground">Chờ xử lý</div>
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
                    <TableHead>Telegram ID</TableHead>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map(req => (
                    <TableRow key={req.id} className={req.status === "pending" ? "bg-yellow-50/40" : ""}>
                      <TableCell className="font-mono font-medium">{req.orderId}</TableCell>
                      <TableCell>
                        <div className="font-medium">{req.firstName || "—"}</div>
                        {req.username && <div className="text-xs text-muted-foreground">@{req.username}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{req.userId}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(req.submittedAt), "dd/MM/yyyy HH:mm")}
                      </TableCell>
                      <TableCell><StatusBadge status={req.status} /></TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={req.status === "pending" ? "default" : "outline"}
                          onClick={() => openModal(req)}
                        >
                          <Send className="h-3 w-3 mr-1" />
                          {req.status === "pending" ? "Giao tài khoản" : "Giao lại"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Send Account Dialog */}
      <Dialog open={!!selected} onOpenChange={open => { if (!open) closeModal() }}>
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
            {/* Toggle input mode */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={!useRaw ? "default" : "outline"}
                onClick={() => setUseRaw(false)}
                className="flex-1"
              >Nhập riêng từng ô</Button>
              <Button
                size="sm"
                variant={useRaw ? "default" : "outline"}
                onClick={() => setUseRaw(true)}
                className="flex-1"
              >Định dạng email|pass|2FA</Button>
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
                    {(() => {
                      const p = parseAccountLine(rawLine)
                      return <>
                        <div>📧 {p.account || "—"}</div>
                        <div>🔒 {p.password || "—"}</div>
                        {p.twoFA && <div>🛡 {p.twoFA}</div>}
                      </>
                    })()}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="del-account">📧 Tài khoản</Label>
                  <Input
                    id="del-account"
                    placeholder="email@example.com"
                    value={account}
                    onChange={e => setAccount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="del-password">🔒 Mật khẩu</Label>
                  <Input
                    id="del-password"
                    placeholder="Mật khẩu"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="del-2fa">🛡 2FA (tuỳ chọn)</Label>
                  <Input
                    id="del-2fa"
                    placeholder="Để trống nếu không có"
                    value={twoFA}
                    onChange={e => setTwoFA(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal} disabled={sending}>Huỷ</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Gửi tài khoản
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
