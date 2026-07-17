import { useState } from "react"
import { useListWarranty, useResolveWarrantyReplacement, useResolveWarrantyRefund, useResolveWarrantyReject, getListWarrantyQueryKey } from "@workspace/api-client-react"
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
import { ShieldAlert, RefreshCcw, DollarSign, XCircle, CheckCircle2 } from "lucide-react"

export default function Warranty() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  const { data: warranties, isLoading } = useListWarranty({ query: { queryKey: getListWarrantyQueryKey() } })
  const replaceM = useResolveWarrantyReplacement({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWarrantyQueryKey() }) } })
  const refundM = useResolveWarrantyRefund({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWarrantyQueryKey() }) } })
  const rejectM = useResolveWarrantyReject({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWarrantyQueryKey() }) } })

  const [activeReq, setActiveReq] = useState<WarrantyRequest | null>(null)
  const [modalType, setModalType] = useState<"replace" | "refund" | "reject" | null>(null)

  // Replace State
  const [rEmail, setREmail] = useState("")
  const [rPassword, setRPassword] = useState("")
  const [rNote, setRNote] = useState("")

  // Refund State
  const [refAmount, setRefAmount] = useState("")
  const [refNote, setRefNote] = useState("")

  // Reject State
  const [rejReason, setRejReason] = useState("")

  const openModal = (req: WarrantyRequest, type: "replace" | "refund" | "reject") => {
    setActiveReq(req)
    setModalType(type)
    setREmail(""); setRPassword(""); setRNote("");
    setRefAmount(""); setRefNote("");
    setRejReason("");
  }

  const handleResolve = async () => {
    if (!activeReq || !modalType) return
    const id = activeReq.id

    try {
      if (modalType === "replace") {
        if (!rEmail || !rPassword) {
          toast({ title: "Lỗi", description: "Điền đủ thông tin tài khoản", variant: "destructive" })
          return
        }
        await replaceM.mutateAsync({ id, data: { email: rEmail, password: rPassword, note: rNote } })
      } else if (modalType === "refund") {
        if (!refAmount) {
          toast({ title: "Lỗi", description: "Điền số tiền hoàn", variant: "destructive" })
          return
        }
        await refundM.mutateAsync({ id, data: { amount: Number(refAmount), note: refNote } })
      } else if (modalType === "reject") {
        if (!rejReason) {
          toast({ title: "Lỗi", description: "Điền lý do từ chối", variant: "destructive" })
          return
        }
        await rejectM.mutateAsync({ id, data: { reason: rejReason } })
      }

      toast({ title: "Thành công", description: "Đã xử lý yêu cầu" })
      setModalType(null)
      setActiveReq(null)
    } catch (e) {
      toast({ title: "Lỗi", description: "Xử lý thất bại", variant: "destructive" })
    }
  }

  const pendingWarranties = warranties?.filter(w => w.status === "pending") || []
  const resolvedWarranties = warranties?.filter(w => w.status !== "pending") || []

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Bảo hành</h1>
        <p className="text-muted-foreground mt-1">Xử lý yêu cầu bảo hành từ khách hàng</p>
      </div>

      <div className="grid gap-6">
        <Card className="border-warning/50">
          <CardHeader className="pb-3 border-b border-border/50 bg-muted/20">
            <CardTitle className="flex items-center text-lg">
              <ShieldAlert className="w-5 h-5 mr-2 text-yellow-500" /> 
              Cần xử lý ({pendingWarranties.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground">Đang tải...</div>
            ) : pendingWarranties.length > 0 ? (
              <div className="divide-y divide-border/50">
                {pendingWarranties.map(req => (
                  <div key={req.id} className="p-6 flex flex-col lg:flex-row gap-6 hover:bg-muted/10 transition-colors">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Chờ xử lý</Badge>
                          <span className="text-sm text-muted-foreground">{format(new Date(req.submittedAt), 'dd/MM/yyyy HH:mm')}</span>
                        </div>
                        <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded">Order: {req.orderId.slice(0, 8)}...</span>
                      </div>
                      
                      <div>
                        <h4 className="font-medium text-foreground">{req.email || req.username || "Người dùng ẩn danh"}</h4>
                        <div className="mt-2 bg-muted/50 p-3 rounded-lg text-sm border border-border/50">
                          {req.description}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-row lg:flex-col gap-2 shrink-0 justify-center">
                      <Button size="sm" variant="default" className="w-full lg:w-40 hover-elevate bg-blue-600 hover:bg-blue-700" onClick={() => openModal(req, "replace")}>
                        <RefreshCcw className="w-4 h-4 mr-2" /> Tài khoản mới
                      </Button>
                      <Button size="sm" variant="outline" className="w-full lg:w-40" onClick={() => openModal(req, "refund")}>
                        <DollarSign className="w-4 h-4 mr-2" /> Hoàn tiền
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full lg:w-40 text-destructive hover:bg-destructive/10" onClick={() => openModal(req, "reject")}>
                        <XCircle className="w-4 h-4 mr-2" /> Từ chối
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                <CheckCircle2 className="w-12 h-12 text-green-500/50 mb-3" />
                <p>Không có yêu cầu bảo hành nào cần xử lý.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {resolvedWarranties.length > 0 && (
          <Card>
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-lg">Đã xử lý</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border/50">
                {resolvedWarranties.slice(0, 10).map(req => (
                  <div key={req.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/10">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant={req.status === "resolved" ? "secondary" : "destructive"}>
                          {req.status === "resolved" ? "Đã giải quyết" : "Đã từ chối"}
                        </Badge>
                        <span className="text-sm font-medium">{req.email || req.username}</span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1">{req.resolution || req.description}</p>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      {req.resolvedAt ? format(new Date(req.resolvedAt), 'dd/MM/yyyy HH:mm') : "-"}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Replacement Modal */}
      <Dialog open={modalType === "replace"} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gửi tài khoản thay thế</DialogTitle>
            <DialogDescription>Cung cấp tài khoản mới cho khách hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Email tài khoản</Label>
              <Input value={rEmail} onChange={e => setREmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="grid gap-2">
              <Label>Mật khẩu</Label>
              <Input value={rPassword} onChange={e => setRPassword(e.target.value)} placeholder="password123" />
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú (Gửi kèm cho khách)</Label>
              <Textarea value={rNote} onChange={e => setRNote(e.target.value)} placeholder="Thông tin thêm..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalType(null)}>Hủy</Button>
            <Button onClick={handleResolve} disabled={replaceM.isPending}>Xác nhận</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      <Dialog open={modalType === "refund"} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hoàn tiền</DialogTitle>
            <DialogDescription>Ghi nhận hoàn tiền cho đơn hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Số tiền hoàn (VNĐ)</Label>
              <Input type="number" value={refAmount} onChange={e => setRefAmount(e.target.value)} placeholder="50000" />
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú</Label>
              <Textarea value={refNote} onChange={e => setRefNote(e.target.value)} placeholder="Lý do hoàn tiền..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalType(null)}>Hủy</Button>
            <Button onClick={handleResolve} disabled={refundM.isPending}>Xác nhận hoàn</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Modal */}
      <Dialog open={modalType === "reject"} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Từ chối bảo hành</DialogTitle>
            <DialogDescription>Lý do từ chối sẽ được gửi cho khách hàng</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Lý do từ chối</Label>
              <Textarea value={rejReason} onChange={e => setRejReason(e.target.value)} placeholder="VD: Hết hạn bảo hành, vi phạm chính sách..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalType(null)}>Hủy</Button>
            <Button variant="destructive" onClick={handleResolve} disabled={rejectM.isPending}>Xác nhận từ chối</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}