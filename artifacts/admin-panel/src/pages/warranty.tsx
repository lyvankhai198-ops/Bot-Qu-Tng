import { useState, useEffect, useRef } from "react"
import {
  useListWarranty,
  useResolveWarrantyReplacement,
  useResolveWarrantyRefund,
  useResolveWarrantyReject,
  useResendWarrantyReplacement,
  useResendWarrantyAckNotif,
  useResolveWarrantyAccountReplacement,
  useResolveWarrantyAccountRefund,
  useResolveWarrantyAccountReject,
  useResendWarrantyAccountReplacement,
  useRespondWarranty,
  useRespondWarrantyAccount,
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
import type { WarrantyRequest, WarrantyAccount } from "@workspace/api-client-react"
import { format } from "date-fns"
import { ShieldAlert, RefreshCcw, DollarSign, XCircle, CheckCircle2, SendHorizonal, AlertTriangle, Clock, Users, ChevronDown, ChevronUp, MessageSquareReply } from "lucide-react"

// Parse ?id=xxx from URL hash (e.g. #/warranty?id=abc123)
function getUrlTargetId(): string | null {
  const hash = window.location.hash
  const qIdx = hash.indexOf("?")
  if (qIdx === -1) return null
  return new URLSearchParams(hash.slice(qIdx)).get("id")
}

type ModalType = "replace" | "refund" | "reject" | "respond" | null

export default function Warranty() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListWarrantyQueryKey() })

  const { data: warranties, isLoading } = useListWarranty({ query: { queryKey: getListWarrantyQueryKey() } })

  // Single-request mutations
  const replaceM   = useResolveWarrantyReplacement({ mutation: { onSuccess: invalidate } })
  const refundM    = useResolveWarrantyRefund({ mutation: { onSuccess: invalidate } })
  const rejectM    = useResolveWarrantyReject({ mutation: { onSuccess: invalidate } })
  const resendM    = useResendWarrantyReplacement({ mutation: { onSuccess: invalidate } })
  const ackResendM = useResendWarrantyAckNotif({ mutation: { onSuccess: invalidate } })

  // Group sub-account mutations
  const accReplaceM = useResolveWarrantyAccountReplacement({ mutation: { onSuccess: invalidate } })
  const accRefundM  = useResolveWarrantyAccountRefund({ mutation: { onSuccess: invalidate } })
  const accRejectM  = useResolveWarrantyAccountReject({ mutation: { onSuccess: invalidate } })
  const accResendM  = useResendWarrantyAccountReplacement({ mutation: { onSuccess: invalidate } })

  // Respond mutations
  const respondM    = useRespondWarranty({ mutation: { onSuccess: invalidate } })
  const accRespondM = useRespondWarrantyAccount({ mutation: { onSuccess: invalidate } })

  // Modal state — shared for single and group
  const [activeReq,  setActiveReq]  = useState<WarrantyRequest | null>(null)
  const [activeAcc,  setActiveAcc]  = useState<WarrantyAccount | null>(null)   // for group sub-account
  const [modalType,  setModalType]  = useState<ModalType>(null)

  // Form fields
  const [rEmail,     setREmail]     = useState("")
  const [rPassword,  setRPassword]  = useState("")
  const [rTwoFA,     setRTwoFA]     = useState("")
  const [rNote,      setRNote]      = useState("")
  const [refAmount,  setRefAmount]  = useState("")
  const [refNote,    setRefNote]    = useState("")
  const [rejReason,  setRejReason]  = useState("")
  const [respondMsg, setRespondMsg] = useState("")

  // Deep-link highlight
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

  const openModal = (req: WarrantyRequest, type: ModalType, acc?: WarrantyAccount) => {
    setActiveReq(req)
    setActiveAcc(acc ?? null)
    setModalType(type)
    setREmail(""); setRPassword(""); setRTwoFA(""); setRNote("")
    setRefAmount(""); setRefNote(""); setRejReason(""); setRespondMsg("")
  }

  const isGroupMode = activeAcc !== null

  const isBusy = isGroupMode
    ? (accReplaceM.isPending || accRefundM.isPending || accRejectM.isPending || accRespondM.isPending)
    : (replaceM.isPending || refundM.isPending || rejectM.isPending || respondM.isPending)

  const handleResolve = async () => {
    if (!activeReq || !modalType) return
    const id = activeReq.id
    try {
      if (modalType === "replace") {
        if (!rEmail || !rPassword) {
          toast({ title: "Lỗi", description: "Điền đủ email và mật khẩu", variant: "destructive" }); return
        }
        if (isGroupMode && activeAcc) {
          const result = await accReplaceM.mutateAsync({ id, accId: activeAcc.id, data: { email: rEmail, password: rPassword, twoFA: rTwoFA || undefined, note: rNote || undefined } })
          if ((result as any)?.ok === false) {
            toast({ title: "Lưu OK nhưng gửi thất bại", description: (result as any).message, variant: "destructive" })
          } else {
            toast({ title: "✅ Đã gửi thành công", description: `Khách nhận được TK thay thế cho ${activeAcc.email}` })
          }
        } else {
          const result = await replaceM.mutateAsync({ id, data: { email: rEmail, password: rPassword, twoFA: rTwoFA || undefined, note: rNote || undefined } })
          if ((result as any)?.ok === false) {
            toast({ title: "Lưu thành công nhưng gửi thất bại", description: (result as any).message, variant: "destructive" })
          } else {
            toast({ title: "✅ Đã gửi thành công", description: "Khách hàng đã nhận được tài khoản mới" })
          }
        }
      } else if (modalType === "refund") {
        if (!refAmount) { toast({ title: "Lỗi", description: "Điền số tiền hoàn", variant: "destructive" }); return }
        if (isGroupMode && activeAcc) {
          await accRefundM.mutateAsync({ id, accId: activeAcc.id, data: { amount: Number(refAmount), note: refNote || undefined } })
        } else {
          await refundM.mutateAsync({ id, data: { amount: Number(refAmount), note: refNote || undefined } })
        }
        toast({ title: "Thành công", description: "Đã xử lý hoàn tiền" })
      } else if (modalType === "reject") {
        if (!rejReason) { toast({ title: "Lỗi", description: "Điền lý do từ chối", variant: "destructive" }); return }
        if (isGroupMode && activeAcc) {
          await accRejectM.mutateAsync({ id, accId: activeAcc.id, data: { reason: rejReason } })
        } else {
          await rejectM.mutateAsync({ id, data: { reason: rejReason } })
        }
        toast({ title: "Thành công", description: "Đã từ chối" })
      } else if (modalType === "respond") {
        if (!respondMsg.trim()) { toast({ title: "Lỗi", description: "Điền nội dung phản hồi", variant: "destructive" }); return }
        if (isGroupMode && activeAcc) {
          const result = await accRespondM.mutateAsync({ id, accId: activeAcc.id, data: { message: respondMsg.trim() } })
          if ((result as any)?.ok === false) {
            toast({ title: "Đã lưu nhưng gửi Telegram thất bại", description: (result as any).message, variant: "destructive" })
          } else {
            toast({ title: "✅ Đã gửi phản hồi cho khách" })
          }
        } else {
          const result = await respondM.mutateAsync({ id, data: { message: respondMsg.trim() } })
          if ((result as any)?.ok === false) {
            toast({ title: "Đã lưu nhưng gửi Telegram thất bại", description: (result as any).message, variant: "destructive" })
          } else {
            toast({ title: "✅ Đã gửi phản hồi cho khách" })
          }
        }
      }
      setModalType(null); setActiveReq(null); setActiveAcc(null)
    } catch {
      toast({ title: "Lỗi", description: "Xử lý thất bại", variant: "destructive" })
    }
  }

  const handleResend = async (req: WarrantyRequest) => {
    try {
      await resendM.mutateAsync({ id: req.id })
      toast({ title: "✅ Gửi lại thành công", description: "Khách hàng đã nhận được thông tin" })
    } catch {
      toast({ title: "Gửi lại thất bại", variant: "destructive" })
    }
  }

  const handleAccResend = async (req: WarrantyRequest, acc: WarrantyAccount) => {
    try {
      await accResendM.mutateAsync({ id: req.id, accId: acc.id })
      toast({ title: "✅ Gửi lại thành công", description: `Đã gửi lại cho tài khoản ${acc.email}` })
    } catch {
      toast({ title: "Gửi lại thất bại", variant: "destructive" })
    }
  }

  const handleResendAck = async (req: WarrantyRequest) => {
    try {
      const result = await ackResendM.mutateAsync({ id: req.id })
      if ((result as any)?.ok === false) {
        toast({ title: "Gửi lại thất bại", description: (result as any).message, variant: "destructive" })
      } else {
        toast({ title: "✅ Đã gửi lại thông báo tiếp nhận" })
      }
    } catch {
      toast({ title: "Gửi lại thất bại", variant: "destructive" })
    }
  }

  // Separate single vs group
  const singleWarranties = warranties?.filter((w: any) => !w.type || w.type !== "group") || []
  const groupWarranties  = warranties?.filter((w: any) => w.type === "group") || []

  const pendingSingle    = singleWarranties.filter(w => w.status === "pending")
  const processingSingle = singleWarranties.filter(w => w.status === "processing")
  const resolvedSingle   = singleWarranties.filter(w => !["pending", "processing"].includes(w.status))

  const pendingGroup    = groupWarranties.filter(w => w.status === "pending")
  const processingGroup = groupWarranties.filter(w => w.status === "processing")
  const resolvedGroup   = groupWarranties.filter(w => !["pending", "processing"].includes(w.status))

  const totalPending    = pendingSingle.length    + pendingGroup.length
  const totalProcessing = processingSingle.length + processingGroup.length
  const totalResolved   = resolvedSingle.length   + resolvedGroup.length

  const sentStatusBadge = (req: WarrantyRequest) => {
    if (req.status === "rejected")            return <Badge variant="destructive">Từ chối</Badge>
    if (req.status === "processing")          return <Badge className="bg-blue-600 text-white">Đang xử lý</Badge>
    if ((req as any).sentStatus === "sent")   return <Badge className="bg-green-600 text-white">Đã gửi cho khách</Badge>
    if ((req as any).sentStatus === "failed") return <Badge variant="destructive">Gửi thất bại</Badge>
    return <Badge variant="secondary">Đã xử lý</Badge>
  }

  const accStatusBadge = (acc: WarrantyAccount) => {
    if (acc.status === "rejected")          return <Badge variant="destructive" className="text-xs">Từ chối</Badge>
    if (acc.status === "resolved") {
      if (acc.sentStatus === "sent")        return <Badge className="bg-green-600 text-white text-xs">Đã gửi</Badge>
      if (acc.sentStatus === "failed")      return <Badge variant="destructive" className="text-xs">Gửi thất bại</Badge>
      return <Badge className="bg-green-600 text-white text-xs">Đã xử lý</Badge>
    }
    if (acc.status === "processing")        return <Badge className="bg-blue-600 text-white text-xs">Đang xử lý</Badge>
    return <Badge variant="outline" className="text-xs bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Chờ</Badge>
  }

  // Card wrapper with deep-link highlight
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

  // ── Group Warranty Card ──────────────────────────────────────────────────────
  const GroupCard = ({ req }: { req: WarrantyRequest }) => {
    const r = req as any
    const [expanded, setExpanded] = useState(true)
    const accounts: WarrantyAccount[] = r.accounts ?? []
    const n = accounts.length
    const pendingCount = accounts.filter(a => a.status === "pending").length
    const ackFailed = r.ackNotifSentStatus === "failed"

    return (
      <WarrantyCard req={req}>
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Users className="w-4 h-4 text-purple-500" />
            <Badge variant="outline" className={
              req.status === "pending"    ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" :
              req.status === "processing" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
              "bg-green-500/10 text-green-600 border-green-500/20"
            }>
              {req.status === "pending" ? "Chờ xử lý" : req.status === "processing" ? "Đang xử lý" : "Đã xử lý"} — {n} TK
            </Badge>
            <span className="text-sm font-medium">@{r.username || "?"}</span>
          </div>
          <span className="text-xs text-muted-foreground">{format(new Date(req.submittedAt), 'dd/MM/yyyy HH:mm')}</span>
        </div>

        {/* Description */}
        <div className="bg-muted/50 p-3 rounded-lg text-sm border border-border/50">
          <span className="text-muted-foreground text-xs">Lý do: </span>{req.description}
        </div>

        {/* Processing info */}
        {req.status !== "pending" && (
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
        )}

        {/* Ack notif failed */}
        {ackFailed && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
              <AlertTriangle className="w-4 h-4" /> Gửi thông báo tiếp nhận cho khách thất bại
            </div>
            {r.ackNotifError && <p className="text-xs text-muted-foreground">{r.ackNotifError}</p>}
            <Button size="sm" className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700" onClick={() => handleResendAck(req)} disabled={ackResendM.isPending}>
              <SendHorizonal className="w-4 h-4 mr-2" />
              {ackResendM.isPending ? "Đang gửi lại..." : "Gửi lại thông báo tiếp nhận"}
            </Button>
          </div>
        )}

        {/* Accounts list */}
        <div className="border border-border/50 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2 bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors"
            onClick={() => setExpanded(!expanded)}
          >
            <span>Danh sách tài khoản ({n}) {pendingCount > 0 && <span className="text-yellow-600">• {pendingCount} chờ xử lý</span>}</span>
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {expanded && (
            <div className="divide-y divide-border/50">
              {accounts.map((acc) => (
                <div key={acc.id} className="p-3 space-y-2">
                  {/* Account row */}
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      {accStatusBadge(acc)}
                      <code className="text-xs bg-muted px-2 py-0.5 rounded">{acc.email}</code>
                      {acc.productName && <span className="text-xs text-muted-foreground">{acc.productName}</span>}
                    </div>
                    {acc.resolvedAt && <span className="text-xs text-muted-foreground">{format(new Date(acc.resolvedAt), 'dd/MM HH:mm')}</span>}
                  </div>

                  {/* Resolved info */}
                  {acc.status === "resolved" && acc.replacementEmail && (
                    <div className="text-xs text-muted-foreground space-y-1 pl-1">
                      <div>📧 TK mới: <code className="bg-muted px-1 rounded">{acc.replacementEmail}</code></div>
                      <div>🔒 MK: <code className="bg-muted px-1 rounded">{acc.replacementPassword}</code></div>
                      {acc.replacementTwoFA && <div>🛡 2FA: <code className="bg-muted px-1 rounded">{acc.replacementTwoFA}</code></div>}
                    </div>
                  )}
                  {acc.status === "rejected" && acc.resolution && (
                    <div className="text-xs text-muted-foreground pl-1">❌ Lý do: {acc.resolution.replace("reject:", "")}</div>
                  )}

                  {/* Sent failed → resend */}
                  {acc.sentStatus === "failed" && acc.replacementEmail && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded p-2 space-y-1">
                      <div className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Gửi thất bại</div>
                      {acc.sentError && <p className="text-xs text-muted-foreground">{acc.sentError}</p>}
                      <Button size="sm" className="w-full min-h-[36px] text-xs bg-blue-600 hover:bg-blue-700" onClick={() => handleAccResend(req, acc)} disabled={accResendM.isPending}>
                        <SendHorizonal className="w-3 h-3 mr-1" /> Gửi lại
                      </Button>
                    </div>
                  )}

                  {/* Responses history */}
                  {((acc as any).responses ?? []).length > 0 && (
                    <div className="space-y-1 mt-1">
                      {((acc as any).responses as any[]).map((r: any, i: number) => (
                        <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-xs text-blue-700 dark:text-blue-300">
                          💬 {r.message}
                          <span className="ml-2 text-muted-foreground">{r.sentAt ? format(new Date(r.sentAt), 'dd/MM HH:mm') : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Action buttons (only when pending or processing) */}
                  {["pending", "processing"].includes(acc.status) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace", acc)}>
                        <RefreshCcw className="w-3 h-3 mr-1" /> TK mới
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => openModal(req, "refund", acc)}>
                        <DollarSign className="w-3 h-3 mr-1" /> Hoàn tiền
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs text-violet-600 hover:bg-violet-500/10" onClick={() => openModal(req, "respond", acc)}>
                        <MessageSquareReply className="w-3 h-3 mr-1" /> Phản hồi
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject", acc)}>
                        <XCircle className="w-3 h-3 mr-1" /> Từ chối
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </WarrantyCard>
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
              Chờ xử lý ({totalPending})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
            ) : totalPending > 0 ? (
              <div className="divide-y divide-border/50">
                {/* Single requests */}
                {pendingSingle.map(req => (
                  <WarrantyCard key={req.id} req={req}>
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Chờ xử lý</Badge>
                          <span className="text-sm text-muted-foreground">{format(new Date(req.submittedAt), 'dd/MM/yyyy HH:mm')}</span>
                        </div>
                      </div>
                      <div>
                        <h4 className="font-medium">{req.email || (req as any).username || "Ẩn danh"}</h4>
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{req.orderId}</code>
                        <div className="mt-2 bg-muted/50 p-3 rounded-lg text-sm border border-border/50">{req.description}</div>
                      </div>
                    </div>
                    {((req as any).responses ?? []).length > 0 && (
                      <div className="space-y-1">
                        {((req as any).responses as any[]).map((r: any, i: number) => (
                          <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-xs text-blue-700 dark:text-blue-300">
                            💬 {r.message}
                            <span className="ml-2 text-muted-foreground">{r.sentAt ? format(new Date(r.sentAt), 'dd/MM HH:mm') : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Button size="sm" className="w-full sm:flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace")}>
                        <RefreshCcw className="w-4 h-4 mr-2" /> Tài khoản mới
                      </Button>
                      <Button size="sm" variant="outline" className="w-full sm:flex-1 min-h-[44px]" onClick={() => openModal(req, "refund")}>
                        <DollarSign className="w-4 h-4 mr-2" /> Hoàn tiền
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-violet-600 hover:bg-violet-500/10" onClick={() => openModal(req, "respond")}>
                        <MessageSquareReply className="w-4 h-4 mr-2" /> Phản hồi
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject")}>
                        <XCircle className="w-4 h-4 mr-2" /> Từ chối
                      </Button>
                    </div>
                  </WarrantyCard>
                ))}
                {/* Group requests */}
                {pendingGroup.map(req => (
                  <GroupCard key={req.id} req={req} />
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
        {totalProcessing > 0 && (
          <Card className="border-blue-500/30">
            <CardHeader className="pb-3 border-b border-border/50 bg-blue-500/5">
              <CardTitle className="flex items-center text-base md:text-lg text-blue-700 dark:text-blue-400">
                <Clock className="w-5 h-5 mr-2" />
                Đang xử lý ({totalProcessing})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {/* Single processing */}
                {processingSingle.map(req => {
                  const r = req as any
                  const ackFailed = r.ackNotifSentStatus === "failed"
                  return (
                    <WarrantyCard key={req.id} req={req}>
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="bg-blue-600 text-white">Đang xử lý</Badge>
                          <span className="text-sm font-medium">{req.email || (req as any).username || "Ẩn danh"}</span>
                        </div>
                      </div>
                      <code className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">{req.orderId}</code>
                      <div className="bg-muted/50 p-3 rounded-lg text-sm border border-border/50">{req.description}</div>
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
                      {ackFailed && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
                            <AlertTriangle className="w-4 h-4" /> Gửi thông báo tiếp nhận cho khách thất bại
                          </div>
                          {r.ackNotifError && <p className="text-xs text-muted-foreground">{r.ackNotifError}</p>}
                          <Button size="sm" className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700" onClick={() => handleResendAck(req)} disabled={ackResendM.isPending}>
                            <SendHorizonal className="w-4 h-4 mr-2" />
                            {ackResendM.isPending ? "Đang gửi lại..." : "Gửi lại thông báo tiếp nhận"}
                          </Button>
                        </div>
                      )}
                      {(r.responses ?? []).length > 0 && (
                        <div className="space-y-1">
                          {(r.responses as any[]).map((resp: any, i: number) => (
                            <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded p-2 text-xs text-blue-700 dark:text-blue-300">
                              💬 {resp.message}
                              <span className="ml-2 text-muted-foreground">{resp.sentAt ? format(new Date(resp.sentAt), 'dd/MM HH:mm') : ""}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Button size="sm" className="w-full sm:flex-1 min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace")}>
                          <RefreshCcw className="w-4 h-4 mr-2" /> Tài khoản mới
                        </Button>
                        <Button size="sm" variant="outline" className="w-full sm:flex-1 min-h-[44px]" onClick={() => openModal(req, "refund")}>
                          <DollarSign className="w-4 h-4 mr-2" /> Hoàn tiền
                        </Button>
                        <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-violet-600 hover:bg-violet-500/10" onClick={() => openModal(req, "respond")}>
                          <MessageSquareReply className="w-4 h-4 mr-2" /> Phản hồi
                        </Button>
                        <Button size="sm" variant="ghost" className="w-full sm:flex-1 min-h-[44px] text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject")}>
                          <XCircle className="w-4 h-4 mr-2" /> Từ chối
                        </Button>
                      </div>
                    </WarrantyCard>
                  )
                })}
                {/* Group processing */}
                {processingGroup.map(req => (
                  <GroupCard key={req.id} req={req} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Resolved / Rejected ─────────────────────────────────── */}
        {totalResolved > 0 && (
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-base md:text-lg">Đã xử lý ({totalResolved})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {/* Single resolved */}
                {resolvedSingle.slice(0, 20).map(req => {
                  const r = req as any
                  const isFailed = r.sentStatus === "failed"
                  return (
                    <WarrantyCard key={req.id} req={req}>
                      <div className="flex flex-wrap items-center gap-2 justify-between">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sentStatusBadge(req)}
                          <span className="text-sm font-medium">{req.email || (req as any).username}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {req.resolvedAt ? format(new Date(req.resolvedAt), 'dd/MM/yyyy HH:mm') : "-"}
                        </span>
                      </div>
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
                      {isFailed && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 space-y-2">
                          <div className="flex items-center gap-2 text-red-600 text-xs font-medium">
                            <AlertTriangle className="w-4 h-4" /> Gửi Telegram thất bại
                          </div>
                          {r.sentError && <p className="text-xs text-muted-foreground">{r.sentError}</p>}
                          <Button size="sm" className="w-full min-h-[40px] bg-blue-600 hover:bg-blue-700" onClick={() => handleResend(req)} disabled={resendM.isPending}>
                            <SendHorizonal className="w-4 h-4 mr-2" />
                            {resendM.isPending ? "Đang gửi lại..." : "Gửi lại cho khách"}
                          </Button>
                        </div>
                      )}
                    </WarrantyCard>
                  )
                })}
                {/* Group resolved */}
                {resolvedGroup.slice(0, 10).map(req => (
                  <GroupCard key={req.id} req={req} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Modal (shared single + group sub-account) ──────────── */}
      {/* Replacement Modal */}
      <Dialog open={modalType === "replace"} onOpenChange={open => !open && (setModalType(null), setActiveAcc(null))}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gửi tài khoản thay thế{activeAcc ? ` — ${activeAcc.email}` : ""}</DialogTitle>
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
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setModalType(null); setActiveAcc(null) }}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px] bg-blue-600 hover:bg-blue-700" onClick={handleResolve} disabled={isBusy}>
              <SendHorizonal className="w-4 h-4 mr-2" />
              {isBusy ? "Đang gửi..." : "Xác nhận và gửi cho khách"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      <Dialog open={modalType === "refund"} onOpenChange={open => !open && (setModalType(null), setActiveAcc(null))}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Hoàn tiền{activeAcc ? ` — ${activeAcc.email}` : ""}</DialogTitle>
            <DialogDescription>Ghi nhận hoàn tiền</DialogDescription>
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
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setModalType(null); setActiveAcc(null) }}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px]" onClick={handleResolve} disabled={isBusy}>
              {isBusy ? "Đang xử lý..." : "Xác nhận hoàn"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog open={modalType === "reject"} onOpenChange={open => !open && (setModalType(null), setActiveAcc(null))}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Từ chối bảo hành{activeAcc ? ` — ${activeAcc.email}` : ""}</DialogTitle>
            <DialogDescription>Lý do từ chối sẽ được gửi cho khách hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Lý do từ chối <span className="text-destructive">*</span></Label>
              <Textarea value={rejReason} onChange={e => setRejReason(e.target.value)} placeholder="VD: Hết hạn bảo hành, vi phạm chính sách..." rows={4} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setModalType(null); setActiveAcc(null) }}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto min-h-[44px]" onClick={handleResolve} disabled={isBusy}>
              {isBusy ? "Đang xử lý..." : "Xác nhận từ chối"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Respond Modal */}
      <Dialog open={modalType === "respond"} onOpenChange={open => !open && (setModalType(null), setActiveAcc(null))}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[480px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Phản hồi khách hàng{activeAcc ? ` — ${activeAcc.email}` : ""}</DialogTitle>
            <DialogDescription>Nội dung sẽ được gửi cho khách qua Telegram. Yêu cầu bảo hành vẫn giữ nguyên trạng thái.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nội dung phản hồi <span className="text-destructive">*</span></Label>
              <Textarea
                value={respondMsg}
                onChange={e => setRespondMsg(e.target.value)}
                placeholder="VD: Chúng tôi đã nhận được yêu cầu và đang xem xét, sẽ phản hồi trong 24h..."
                rows={5}
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => { setModalType(null); setActiveAcc(null) }}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px] bg-violet-600 hover:bg-violet-700" onClick={handleResolve} disabled={isBusy}>
              <SendHorizonal className="w-4 h-4 mr-2" />
              {isBusy ? "Đang gửi..." : "Gửi phản hồi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
