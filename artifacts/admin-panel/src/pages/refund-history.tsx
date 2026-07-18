import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Search, RefreshCw, DollarSign, Calendar, Mail, Hash } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? ""

interface RefundRecord {
  id: string
  warrantyRequestId: string
  orderId: string | null
  email: string
  amount: number
  note: string
  refundedAt: string
  refundedBy: string
}

async function fetchHistory(params: Record<string, string>): Promise<RefundRecord[]> {
  const token = localStorage.getItem("admin_token") ?? ""
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([,v]) => v))).toString()
  const res = await fetch(`${BASE}/api/bot/refund-history${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
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

export default function RefundHistoryPage() {
  const { toast } = useToast()
  const [records, setRecords] = useState<RefundRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ orderId: "", email: "", from: "", to: "" })
  const [applied, setApplied] = useState({ orderId: "", email: "", from: "", to: "" })

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

  const totalAmount = records.reduce((s, r) => s + (r.amount || 0), 0)

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Lịch sử hoàn tiền</h1>
        <p className="text-muted-foreground mt-1 text-sm">Tra cứu tất cả giao dịch hoàn tiền đã thực hiện</p>
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
                    <Badge variant="outline" className="text-xs shrink-0">{fmtDate(r.refundedAt)}</Badge>
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
    </div>
  )
}
