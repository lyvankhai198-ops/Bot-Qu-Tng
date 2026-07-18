import { useState, useEffect, useRef } from "react"
import {
  useListWarranty,
  useResolveWarrantyReplacement,
  useResolveWarrantyRefund,
  useResolveWarrantyReject,
  useResendWarrantyReplacement,
  useResendWarrantyAckNotif,
  getListWarrantyQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import type { WarrantyRequest } from "@workspace/api-client-react"
import { format } from "date-fns"
import { ShieldAlert, RefreshCcw, DollarSign, XCircle, CheckCircle2, SendHorizonal, AlertTriangle, Clock } from "lucide-react"

// Parse ?id=xxx from URL hash (e.g. #/warranty?id=abc123)
function getUrlTargetId(): string | null {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return null
  return new URLSearchParams(hash.slice(qIdx)).get("id")
}

export default function Warranty() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListWarrantyQueryKey() })

  const { data: warranties, isLoading } = useListWarranty({ query: { queryKey: getListWarrantyQueryKey() } })
  const replaceM   = useResolveWarrantyReplacement({ mutation: { onSuccess: invalidate } })
  const refundM    = useResolveWarrantyRefund({ mutation: { onSuccess: invalidate } })
  const rejectM    = useResolveWarrantyReject({ mutation: { onSuccess: invalidate } })
  const resendM    = useResendWarrantyReplacement({ mutation: { onSuccess: invalidate } })
  const ackResendM = useResendWarrantyAckNotif({ mutation: { onSuccess: invalidate } })

  const [activeReq, setActiveReq] = useState<WarrantyRequest | null>(null)
  const [modalType, setModalType] = useState<"replace" | "refund" | "reject" | null>(null)

  // Replacement fields
  const [rEmail,    setREmail]    = useState("")
  const [rPassword, setRPassword] = useState("")
  const [rTwoFA,    setRTwoFA]    = useState("")
  const [rNote,     setRNote]     = useState("")
  // Refund fields
  const [refAmount, setRefAmount] = useState("")
  const [refNote,   setRefNote]   = useState("")
  // Reject field
  const [rejReason, setRejReason] = useState("")

  // Deep-link: highlight target warranty from URL
  const [targetId, setTargetId] = useState<string | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const id = getUrlTargetId()
    if (id) setTargetId(id)
  }, [])

  useEffect(() => {
    if (targetId && targetRef.current) {
      setTimeout(() => targetRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 400)
    }
  }, [targetId, warranties])

  const openModal = (req: WarrantyRequest, type: "replace" | "refund" | "reject") => {
    setActiveReq(req); setModalType(type)
    setREmail(""); setRPassword(""); setRTwoFA(""); setRNote("")
    setRefAmount(""); setRefNote(""); setRejReason("")
  }

  const handleResolve = async () => {
    if (!activeReq || !modalType) return
    const id = activeReq.id
    try {
      if (modalType === "replace") {
        if (!rEmail || !rPassword) {
          toast({ title: "Lỗi", description: "Điền đủ email và mật khẩu", variant: "destructive" }); return
        }
        const result = await replaceM.mutateAsync({ id, data: { email: rEmail, password: rPassword, twoFA: rTwoFA || undefined, note: rNote || undefined } })
        if ((result as any)?.ok === false) {
          toast({ title: "Lưu thành công nhưng gửi thất bại", description: (result as any).message, variant: "destructive" })
        } else {
          toast({ title: "✅ Đã gửi thành công", description: "Khách hàng đã nhận được tài khoản mới" })
        }
      } else if (modalType === "refund") {
        if (!refAmount) { toast({ title: "Lỗi", description: "Điền số tiền hoàn", variant: "destructive" }); return }
        await refundM.mutateAsync({ id, data: { amount: Number(refAmount), note: refNote || undefined } })
        toast({ title: "Thành công", description: "Đã xử lý hoàn tiền" })
      } else if (modalType === "reject") {
        if (!rejReason) { toast({ title: "Lỗi", description: "Điền lý do từ chối", variant: "destructive" }); return }
        await rejectM.mutateAsync({ id, data: { reason: rejReason } })
        toast({ title: "Thành công", description: "Đã từ chối yêu cầu" })
      }
      setModalType(null); setActiveReq(null)
    } catch {
      toast({ title: "Lỗi", description: "Xử lý thất bại", variant: "destructive" })
    }
  }

  const handleResend = async (req: WarrantyRequest) => {
    try {
      await resendM.mutateAsync({ id: req.id })
      toast({ title: "✅ Gửi lại thành công", description: "Khách hàng đã nhận được thông tin" })
    } catch {
      toast({ title: "Gửi lại thất bại", description: "Kiểm tra token bot hoặc thử lại sau", variant: "destructive" })
    }
  }

  const handleResendAck = async (req: WarrantyRequest) => {
    try {
      const result = await ackResendM.mutateAsync({ id: req.id })
      if ((result as any)?.ok === false) {
        toast({ title: "Gửi lại thất bại", description: (result as any).message, variant: "destructive" })
      } else {
        toast({ title: "✅ Đã gửi lại thông báo tiếp nhận", description: "Khách hàng đã được thông báo" })
      }
    } catch {
      toast({ title: "Gửi lại thất bại", description: "Kiểm tra token bot hoặc thử lại sau", variant: "destructive" })
    }
  }

  const pendingWarranties    = warranties?.filter(w => w.status === "pending")    || []
  const processingWarranties = warranties?.filter(w => w.status === "processing") || []
  const resolvedWarranties   = warranties?.filter(w => !["pending", "processing"].includes(w.status)) || []

  const sentStatusBadge = (req: WarrantyRequest) => {
    if (req.status === "rejected")          return <Badge variant="destructive">Từ chối</Badge>
    if (req.status === "processing")        return <Badge className="bg-blue-600 text-white">Đang xử lý</Badge>
    if ((req as any).sentStatus === "sent") return <Badge className="bg-green-600 text-white">Đã gửi cho khách</Badge>
    if ((req as any).sentStatus === "failed") return <Badge variant="destructive">Gửi thất bại</Badge>
    return <Badge variant="secondary">Đã xử lý</Badge>
  }

  // Card wrapper — highlighted if it's the deep-linked target
  const WarrantyCard = ({ req, children }: { req: WarrantyRequest; children: React.ReactNode }) => {
    const isTarget = req.id === targetId
    return (
      <div
        ref={isTarget ? targetRef : undefined}
        className={`p-4 md:p-6 space-y-4 transition-colors duration-700 ${isTarget ? "bg-yellow-500/10 border-l-4 border-yellow-500" : ""}`}
      >
        {children}
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Bảo hành</h1>
        <p className="text-muted-foreground mt-1 text-sm">Xử lý yêu cầu bảo hành từ khách hàng</p>
      </div>

      <div className="grid gap-4 md:gap-6">

        {/* ── Pending ─────────────────────────────────────────────── */}
        <Card className="border-warning/50">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="flex items-center text-base md:text-lg">
              <ShieldAlert className="w-5 h-5 mr-2 text-yellow-500" />
              Chờ xử lý ({pendingWarranties.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
            ) : pendingWarranties.length > 0 ? (
              <div className="divide-y divide-border/50">
                {pendingWarranties.map(req => (
                  <WarrantyCard key={req.id} req={req}>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Chờ xử lý</Badge>
                          <span className="text-sm text-muted-foreground">{format(new Date(req.submittedAt), 'dd/MM/yyyy HH:mm')}</span>
                        </div>
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{req.orderId}</code>
                      </div>
                      <div>
                        <h4 className="font-medium">{req.email || req.username || "Ẩn danh"}</h4>
                        <div className="mt-2 bg-muted/50 p-3 rounded-lg text-sm border border-border/50">{req.description}</div>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="sm" className="w-full sm:flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace")}>
                        <RefreshCcw className="w-4 h-4 mr-2" /> Tài khoản mới
                      </Button>
                      <Button size="sm" variant="outline" className="w-full sm:flex-1 min-h-[44px]" onClick={() => openModal(req, "refund")}>
                        <DollarSign className="w-4 h-4 mr-2" /> Hoàn tiền
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject")}>
                        <XCircle className="w-4 h-4 mr-2" /> Từ chối
                      </Button>
                    </div>
                  </WarrantyCard>
                ))}
              </div>
            ) : (
              <div className="p-10 text-center text-muted-foreground flex flex-col items-center">
                <CheckCircle2 className="w-12 h-12 text-green-500/50 mb-3" />
                <p className="text-sm">Không có yêu cầu bảo hành nào cần xử lý.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Processing ──────────────────────────────────────────── */}
        {processingWarranties.length > 0 && (
          <Card className="border-blue-500/30">
            <CardHeader className="pb-3 border-b border-border/50 bg-blue-500/5">
              <CardTitle className="flex items-center text-base md:text-lg text-blue-700 dark:text-blue-400">
                <Clock className="w-5 h-5 mr-2" />
                Đang xử lý ({processingWarranties.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {processingWarranties.map(req => {
                  const r = req as any
                  const ackFailed = r.ackNotifSentStatus === "failed"
                  return (
                    <WarrantyCard key={req.id} req={req}>
                      {/* Header */}
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="bg-blue-600 text-white">Đang xử lý</Badge>
                          <span className="text-sm font-medium">{req.email || req.username || "Ẩn danh"}</span>
                        </div>
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{req.orderId}</code>
                      </div>

                      {/* Description */}
                      <div className="bg-muted/50 p-3 rounded-lg text-sm border border-border/50">{req.description}</div>

                      {/* Ack info */}
                      <div className="text-xs text-muted-foreground space-y-1">
                        {r.acknowledgedAt && (
                          <div>✅ Tiếp nhận lúc: {format(new Date(r.acknowledgedAt), 'dd/MM/yyyy HH:mm')}
                            {r.acknowledgedBy && <span className="ml-1">(Admin #{r.acknowledgedBy})</span>}
                          </div>
                        )}
                        {r.ackNotifSentStatus === "sent" && r.ackNotifSentAt && (
                          <div className="text-green-600">📨 Đã thông báo khách lúc: {format(new Date(r.ackNotifSentAt), 'dd/MM/yyyy HH:mm')}</div>
                        )}
                      </div>

                      {/* Ack notif failed → resend button */}
                      {ackFailed && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
                            <AlertTriangle className="w-4 h-4" /> Gửi thông báo tiếp nhận cho khách thất bại
                          </div>
                          {r.ackNotifError && <p className="text-xs text-muted-foreground">{r.ackNotifError}</p>}
                          <Button
                            size="sm"
                            className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleResendAck(req)}
                            disabled={ackResendM.isPending}
                          >
                            <SendHorizonal className="w-4 h-4 mr-2" />
                            {ackResendM.isPending ? "Đang gửi lại..." : "Gửi lại thông báo tiếp nhận"}
                          </Button>
                        </div>
                      )}

                      {/* Action buttons (can still resolve from processing state) */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button size="sm" className="w-full sm:flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace")}>
                          <RefreshCcw className="w-4 h-4 mr-2" /> Tài khoản mới
                        </Button>
                        <Button size="sm" variant="outline" className="w-full sm:flex-1 min-h-[44px]" onClick={() => openModal(req, "refund")}>
                          <DollarSign className="w-4 h-4 mr-2" /> Hoàn tiền
                        </Button>
                        <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject")}>
                          <XCircle className="w-4 h-4 mr-2" /> Từ chối
                        </Button>
                      </div>
                    </WarrantyCard>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Resolved / Rejected ─────────────────────────────────── */}
        {resolvedWarranties.length > 0 && (
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base md:text-lg">Đã xử lý ({resolvedWarranties.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {resolvedWarranties.slice(0, 20).map(req => {
                  const r = req as any
                  const isFailed = r.sentStatus === "failed"
                  return (
                    <WarrantyCard key={req.id} req={req}>
                      {/* Header row */}
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sentStatusBadge(req)}
                          <span className="text-sm font-medium">{req.email || req.username}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {req.resolvedAt ? format(new Date(req.resolvedAt), 'dd/MM/yyyy HH:mm') : "-"}
                        </span>
                      </div>

                      {/* Order info */}
                      <div className="text-xs text-muted-foreground space-y-1">
                        <div>📦 Mã đơn: <code className="bg-muted px-1 rounded">{req.orderId}</code></div>
                        {r.replacementEmail && (
                          <>
                            <div>📧 TK thay thế: <code className="bg-muted px-1 rounded">{r.replacementEmail}</code></div>
                            <div>🔒 Mật khẩu: <code className="bg-muted px-1 rounded">{r.replacementPassword}</code></div>
                            {r.replacementTwoFA && <div>🛡 2FA: <code className="bg-muted px-1 rounded">{r.replacementTwoFA}</code></div>}
                            {r.replacementNote && <div>📝 Ghi chú: {r.replacementNote}</div>}
                          </>
                        )}
                        {req.status === "rejected" && req.resolution && (
                          <div>❌ Lý do: {req.resolution.replace("reject:", "")}</div>
                        )}
                        {r.sentAt && <div>✅ Đã gửi lúc: {format(new Date(r.sentAt), 'dd/MM/yyyy HH:mm')}</div>}
                      </div>

                      {/* Failed send error + resend */}
                      {isFailed && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
                            <AlertTriangle className="w-4 h-4" /> Gửi Telegram thất bại
                          </div>
                          {r.sentError && <p className="text-xs text-muted-foreground">{r.sentError}</p>}
                          <Button
                            size="sm"
                            className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleResend(req)}
                            disabled={resendM.isPending}
                          >
                            <SendHorizonal className="w-4 h-4 mr-2" />
                            {resendM.isPending ? "Đang gửi lại..." : "Gửi lại cho khách"}
                          </Button>
                        </div>
                      )}
                    </WarrantyCard>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Replacement Modal ──────────────────────────────────────── */}
      <Dialog open={modalType === "replace"} onOpenChange={open => !open && setModalType(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gửi tài khoản thay thế</DialogTitle>
            <DialogDescription>Điền đầy đủ thông tin — bot sẽ gửi ngay cho khách</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Email / Tài khoản <span className="text-destructive">*</span></Label>
              <Input value={rEmail} onChange={e => setREmail(e.target.value)} placeholder="email@example.com" className="min-h-[44px]" />
            </div>
            <div className="grid gap-2">
              <Label>Mật khẩu <span className="text-destructive">*</span></Label>
              <Input value={rPassword} onChange={e => setRPassword(e.target.value)} placeholder="password123" className="min-h-[44px]" />
            </div>
            <div className="grid gap-2">
              <Label>2FA / Thông tin bổ sung <span className="text-muted-foreground text-xs">(nếu có)</span></Label>
              <Input value={rTwoFA} onChange={e => setRTwoFA(e.target.value)} placeholder="Mã 2FA hoặc backup code..." className="min-h-[44px]" />
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú <span className="text-muted-foreground text-xs">(nếu có)</span></Label>
              <Textarea value={rNote} onChange={e => setRNote(e.target.value)} placeholder="Thông tin thêm gửi kèm cho khách..." />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModalType(null)}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={handleResolve} disabled={replaceM.isPending}>
              <SendHorizonal className="w-4 h-4 mr-2" />
              {replaceM.isPending ? "Đang gửi..." : "Xác nhận và gửi cho khách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Refund Modal ───────────────────────────────────────────── */}
      <Dialog open={modalType === "refund"} onOpenChange={open => !open && setModalType(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hoàn tiền</DialogTitle>
            <DialogDescription>Ghi nhận hoàn tiền cho đơn hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Số tiền hoàn (VNĐ) <span className="text-destructive">*</span></Label>
              <Input type="number" value={refAmount} onChange={e => setRefAmount(e.target.value)} placeholder="50000" className="min-h-[44px]" />
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú</Label>
              <Textarea value={refNote} onChange={e => setRefNote(e.target.value)} placeholder="Lý do hoàn tiền..." />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModalType(null)}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px]" onClick={handleResolve} disabled={refundM.isPending}>
              {refundM.isPending ? "Đang xử lý..." : "Xác nhận hoàn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reject Modal ───────────────────────────────────────────── */}
      <Dialog open={modalType === "reject"} onOpenChange={open => !open && setModalType(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Từ chối bảo hành</DialogTitle>
            <DialogDescription>Lý do từ chối sẽ được gửi cho khách hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Lý do từ chối <span className="text-destructive">*</span></Label>
              <Textarea value={rejReason} onChange={e => setRejReason(e.target.value)} placeholder="VD: Hết hạn bảo hành, vi phạm chính sách..." rows={4} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setModalType(null)}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto min-h-[44px]" onClick={handleResolve} disabled={rejectM.isPending}>
              {rejectM.isPending ? "Đang xử lý..." : "Xác nhận từ chối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
