import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Search, RefreshCw, DollarSign, Calendar, Mail, Hash, Plus, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface RefundRecord {
  id: string
  warrantyRequestId: string | null
  orderId: string | null
  email: string
  amount: number
  note: string
  refundedAt: string
  refundedBy: string
  source?: "manual" | "warranty" | "delivery" | string
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

async function fetchHistory(params: Record<string, string>): Promise<RefundRecord[]> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => Boolean(v)))
  ).toString()
  const res = await fetch(`/api/bot/refund-history${qs ? `?${qs}` : ""}`, {
    headers: authHeader(),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function fmtDate(iso: string) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })
}

function fmtAmount(n: number) {
  return Number(n).toLocaleString("vi-VN") + "đ"
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === "warranty") {
    return <Badge variant="outline" className="text-xs border-blue-300 text-blue-600 bg-blue-50">Bảo hành</Badge>
  }
  if (source === "delivery") {
    return <Badge variant="outline" className="text-xs border-orange-300 text-orange-600 bg-orange-50">Giao hàng</Badge>
  }
  if (source === "manual") {
    return <Badge variant="outline" className="text-xs border-purple-300 text-purple-600 bg-purple-50">Thủ công</Badge>
  }
  return <Badge variant="outline" className="text-xs">{source}</Badge>
}

export default function RefundHistoryPage() {
  const { toast } = useToast()
  const [records, setRecords] = useState<RefundRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ orderId: "", email: "", from: "", to: "" })
  const [applied, setApplied] = useState({ orderId: "", email: "", from: "", to: "" })

  // Manual add dialog
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ orderId: "", amount: "", email: "", note: "" })
  const [addLoading, setAddLoading] = useState(false)

  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState<RefundRecord | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = useCallback(async (params: typeof applied) => {
    setLoading(true)
    try {
      const data = await fetchHistory(params)
      setRecords(data)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load(applied) }, []) // initial load

  const handleSearch = () => {
    setApplied(filters)
    load(filters)
  }

  const handleReset = () => {
    const empty = { orderId: "", email: "", from: "", to: "" }
    setFilters(empty)
    setApplied(empty)
    load(empty)
  }

  const handleAdd = async () => {
    if (!addForm.orderId.trim()) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập mã đơn", variant: "destructive" }); return
    }
    const amt = Number(addForm.amount)
    if (!addForm.amount || isNaN(amt) || amt <= 0) {
      toast({ title: "Thiếu thông tin", description: "Vui lòng nhập số tiền hoàn hợp lệ", variant: "destructive" }); return
    }
    setAddLoading(true)
    try {
      const res = await fetch("/api/bot/refund-history/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ orderId: addForm.orderId.trim(), amount: amt, email: addForm.email.trim(), note: addForm.note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || "Lỗi thêm bản ghi")
      toast({ title: "Đã thêm", description: `Thêm thành công hoàn tiền ${fmtAmount(amt)} cho đơn ${addForm.orderId.trim().toUpperCase()}` })
      setAddOpen(false)
      setAddForm({ orderId: "", amount: "", email: "", note: "" })
      load(applied)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setAddLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/bot/refund-history/${deleteTarget.id}`, {
        method: "DELETE",
        headers: authHeader(),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || "Lỗi xoá")
      toast({ title: "Đã xoá", description: `Đã xoá bản ghi hoàn tiền ${fmtAmount(deleteTarget.amount)}` })
      setDeleteTarget(null)
      load(applied)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setDeleteLoading(false)
    }
  }

  const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0)

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Lịch sử hoàn tiền</h1>
          <p className="text-muted-foreground mt-1 text-sm">Tra cứu tất cả giao dịch hoàn tiền đã thực hiện</p>
        </div>
        <Button onClick={() => setAddOpen(true)} className="shrink-0 min-h-[44px] bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-1" /> Thêm thủ công
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Tổng hoàn tiền</p>
                <p className="text-lg font-bold text-green-600">{fmtAmount(totalAmount)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-blue-500 shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Số giao dịch</p>
                <p className="text-lg font-bold">{records.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Bộ lọc</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Hash className="h-3 w-3" /> Mã đơn</label>
              <Input value={filters.orderId} onChange={e => setFilters(f => ({ ...f, orderId: e.target.value }))}
                placeholder="ORD..." className="h-10" onKeyDown={e => e.key === "Enter" && handleSearch()} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" /> Email</label>
              <Input value={filters.email} onChange={e => setFilters(f => ({ ...f, email: e.target.value }))}
                placeholder="email@..." className="h-10" onKeyDown={e => e.key === "Enter" && handleSearch()} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Từ ngày</label>
              <Input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className="h-10" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Đến ngày</label>
              <Input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className="h-10" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSearch} disabled={loading} className="flex-1 sm:flex-none min-h-[44px]">
              <Search className="w-4 h-4 mr-1" /> Tìm kiếm
            </Button>
            <Button variant="outline" onClick={handleReset} disabled={loading} className="min-h-[44px]">
              <RefreshCw className="w-4 h-4 mr-1" /> Đặt lại
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Kết quả ({records.length})</CardTitle>
          <CardDescription>Sắp xếp theo thời gian mới nhất</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-10 animate-pulse text-muted-foreground">Đang tải...</div>
          ) : records.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Không có giao dịch hoàn tiền nào</p>
            </div>
          ) : (
            <div className="space-y-3">
              {records.map(r => (
                <div key={r.id} className="border rounded-lg p-4 space-y-2 hover:bg-muted/20 transition-colors">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="font-medium text-green-600 text-lg">{fmtAmount(r.amount)}</div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <SourceBadge source={r.source} />
                      <Badge variant="outline" className="text-xs">{fmtDate(r.refundedAt)}</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteTarget(r)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Hash className="h-3 w-3 shrink-0" />
                      <span className="font-mono text-xs">{r.orderId || "—"}</span>
                    </div>
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="text-xs truncate">{r.email || "—"}</span>
                    </div>
                  </div>
                  {r.note && (
                    <p className="text-xs text-muted-foreground italic">📝 {r.note}</p>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Admin: <span className="font-medium">{r.refundedBy}</span>
                    {r.warrantyRequestId && (
                      <span className="ml-2">· Req: <span className="font-mono">{r.warrantyRequestId.slice(0, 8)}…</span></span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Add Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm hoàn tiền thủ công</DialogTitle>
            <DialogDescription>
              Nhập mã đơn và số tiền hoàn. Đơn hàng sẽ bị đánh dấu "đã hoàn tiền" và khách không thể gửi yêu cầu bảo hành.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-1">
                <Hash className="h-3.5 w-3.5" /> Mã đơn <span className="text-destructive">*</span>
              </label>
              <Input
                value={addForm.orderId}
                onChange={e => setAddForm(f => ({ ...f, orderId: e.target.value }))}
                placeholder="ORDXXXXXXXX"
                className="h-11 font-mono uppercase"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" /> Số tiền hoàn (đ) <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={addForm.amount}
                onChange={e => setAddForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                className="h-11"
                min={1}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" /> Email khách <span className="text-muted-foreground text-xs">(tuỳ chọn)</span>
              </label>
              <Input
                value={addForm.email}
                onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))}
                placeholder="email@..."
                className="h-11"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Ghi chú <span className="text-muted-foreground text-xs">(tuỳ chọn)</span></label>
              <Textarea
                value={addForm.note}
                onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))}
                placeholder="Lý do hoàn tiền..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addLoading}>Huỷ</Button>
            <Button onClick={handleAdd} disabled={addLoading} className="bg-purple-600 hover:bg-purple-700">
              {addLoading ? "Đang lưu..." : "Thêm bản ghi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Xác nhận xoá</DialogTitle>
            <DialogDescription>
              Bạn có chắc muốn xoá bản ghi hoàn tiền này không? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <div className="font-medium text-green-600">{fmtAmount(deleteTarget.amount)}</div>
              <div className="text-muted-foreground font-mono text-xs"># {deleteTarget.orderId || "—"}</div>
              <div className="text-muted-foreground text-xs">{fmtDate(deleteTarget.refundedAt)}</div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>Huỷ</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "Đang xoá..." : "Xoá bản ghi"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
