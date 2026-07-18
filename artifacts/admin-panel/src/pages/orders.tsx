import { useState, useMemo } from "react"
import { useListOrders, useCreateOrder, useUpdateOrder, useDeleteOrder, getListOrdersQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Search, Plus, Edit2, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { OrderInput, Order } from "@workspace/api-client-react"
import { format } from "date-fns"

const statusLabel = (s?: string) => ({ active: "Hoạt động", expired: "Hết hạn", refunded: "Hoàn tiền" }[s || ""] || s || "-")
const statusVariant = (s?: string): "default" | "secondary" | "destructive" =>
  s === "active" ? "default" : s === "expired" ? "secondary" : "destructive"

export default function Orders() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  const { data: orders, isLoading } = useListOrders({ query: { queryKey: getListOrdersQueryKey() } })
  const createOrder = useCreateOrder({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }) } })
  const updateOrder = useUpdateOrder({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }) } })
  const deleteOrder = useDeleteOrder({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }) } })

  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("all")
  
  const [dialogMode, setDialogOpen] = useState<"add" | "edit" | null>(null)
  const [currentOrder, setCurrentOrder] = useState<Partial<Order>>({})
  
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter(o => {
      const matchSearch = (o.email || "").toLowerCase().includes(search.toLowerCase()) ||
                          (o.productName || "").toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === "all" || o.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [orders, search, filterStatus])

  const handleOpenAdd = () => {
    setCurrentOrder({ status: "active" })
    setDialogOpen("add")
  }

  const handleOpenEdit = (order: Order) => {
    setCurrentOrder({ ...order })
    setDialogOpen("edit")
  }

  const handleSave = async () => {
    if (!currentOrder.email || !currentOrder.productName) {
      toast({ title: "Lỗi", description: "Email và Tên sản phẩm là bắt buộc", variant: "destructive" })
      return
    }

    try {
      const payload: OrderInput = {
        email: currentOrder.email,
        productName: currentOrder.productName,
        price: currentOrder.price ? Number(currentOrder.price) : undefined,
        costPrice: currentOrder.costPrice ? Number(currentOrder.costPrice) : undefined,
        purchaseDate: currentOrder.purchaseDate || undefined,
        usagePeriod: currentOrder.usagePeriod || undefined,
        warrantyPeriod: currentOrder.warrantyPeriod || undefined,
        warrantyExpiry: currentOrder.warrantyExpiry || undefined,
        expiryDate: currentOrder.expiryDate || undefined,
        status: currentOrder.status,
        notes: currentOrder.notes || undefined,
      }

      if (dialogMode === "add") {
        await createOrder.mutateAsync({ data: payload })
        toast({ title: "Thành công", description: "Đã thêm đơn hàng" })
      } else if (dialogMode === "edit" && currentOrder.orderId) {
        await updateOrder.mutateAsync({ orderId: currentOrder.orderId, data: payload })
        toast({ title: "Thành công", description: "Đã cập nhật đơn hàng" })
      }
      setDialogOpen(null)
    } catch (e) {
      toast({ title: "Lỗi", description: "Không thể lưu đơn hàng", variant: "destructive" })
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteOrder.mutateAsync({ orderId: deleteId })
      toast({ title: "Thành công", description: "Đã xóa đơn hàng" })
      setDeleteId(null)
    } catch (e) {
      toast({ title: "Lỗi", description: "Không thể xóa", variant: "destructive" })
    }
  }

  const formatCurrency = (val?: number | null) => val ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val) : "-"
  const formatDate = (val?: string | null) => val ? format(new Date(val), 'dd/MM/yyyy') : "-"

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Đơn hàng</h1>
          <p className="text-muted-foreground mt-1 text-sm">Quản lý giao dịch mua bán</p>
        </div>
        <Button onClick={handleOpenAdd} className="w-full sm:w-auto min-h-[44px]">
          <Plus className="w-4 h-4 mr-2" /> Thêm đơn hàng
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm email, sản phẩm..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background min-h-[44px]"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="bg-background min-h-[44px]">
                <SelectValue placeholder="Trạng thái" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả trạng thái</SelectItem>
                <SelectItem value="active">Hoạt động</SelectItem>
                <SelectItem value="expired">Hết hạn</SelectItem>
                <SelectItem value="refunded">Đã hoàn tiền</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/50">
            {isLoading ? (
              Array(3).fill(0).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </div>
              ))
            ) : filteredOrders.length > 0 ? (
              filteredOrders.map(order => (
                <div key={order.orderId} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{order.productName}</p>
                      <code className="text-xs text-muted-foreground font-mono break-all">{order.email}</code>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => handleOpenEdit(order)}>
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setDeleteId(order.orderId)}>
                        <Trash2 className="w-4 h-4 text-destructive/70" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge>
                    <span className="text-sm font-medium">{formatCurrency(order.price)}</span>
                    {order.warrantyExpiry && (
                      <span className="text-xs text-muted-foreground ml-auto">BH: {formatDate(order.warrantyExpiry)}</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Không tìm thấy đơn hàng.
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Email khách hàng</TableHead>
                  <TableHead>Giá bán</TableHead>
                  <TableHead>Hết hạn BH</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredOrders.length > 0 ? (
                  filteredOrders.map(order => (
                    <TableRow key={order.orderId}>
                      <TableCell className="font-medium">{order.productName}</TableCell>
                      <TableCell className="font-mono text-sm">{order.email}</TableCell>
                      <TableCell>{formatCurrency(order.price)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(order.warrantyExpiry)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenEdit(order)}>
                            <Edit2 className="w-4 h-4 text-muted-foreground hover:text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteId(order.orderId)}>
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy đơn hàng.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Save Dialog — single-column on mobile */}
      <Dialog open={!!dialogMode} onOpenChange={(open) => !open && setDialogOpen(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[600px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogMode === "add" ? "Thêm đơn hàng" : "Chỉnh sửa đơn hàng"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Email khách hàng *</Label>
                <Input value={currentOrder.email || ""} onChange={e => setCurrentOrder({...currentOrder, email: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>Tên sản phẩm *</Label>
                <Input value={currentOrder.productName || ""} onChange={e => setCurrentOrder({...currentOrder, productName: e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Giá bán (VNĐ)</Label>
                <Input type="number" value={currentOrder.price || ""} onChange={e => setCurrentOrder({...currentOrder, price: Number(e.target.value)})} />
              </div>
              <div className="grid gap-2">
                <Label>Giá gốc (VNĐ)</Label>
                <Input type="number" value={currentOrder.costPrice || ""} onChange={e => setCurrentOrder({...currentOrder, costPrice: Number(e.target.value)})} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Ngày mua</Label>
                <Input type="date" value={currentOrder.purchaseDate?.split('T')[0] || ""} onChange={e => setCurrentOrder({...currentOrder, purchaseDate: e.target.value ? new Date(e.target.value).toISOString() : undefined})} />
              </div>
              <div className="grid gap-2">
                <Label>Ngày hết hạn SD</Label>
                <Input type="date" value={currentOrder.expiryDate?.split('T')[0] || ""} onChange={e => setCurrentOrder({...currentOrder, expiryDate: e.target.value ? new Date(e.target.value).toISOString() : undefined})} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Thời hạn BH (VD: 6 tháng)</Label>
                <Input value={currentOrder.warrantyPeriod || ""} onChange={e => setCurrentOrder({...currentOrder, warrantyPeriod: e.target.value})} />
              </div>
              <div className="grid gap-2">
                <Label>Ngày hết hạn BH</Label>
                <Input type="date" value={currentOrder.warrantyExpiry?.split('T')[0] || ""} onChange={e => setCurrentOrder({...currentOrder, warrantyExpiry: e.target.value ? new Date(e.target.value).toISOString() : undefined})} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Trạng thái</Label>
              <Select value={currentOrder.status || "active"} onValueChange={v => setCurrentOrder({...currentOrder, status: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Hoạt động</SelectItem>
                  <SelectItem value="expired">Hết hạn</SelectItem>
                  <SelectItem value="refunded">Đã hoàn tiền</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Ghi chú</Label>
              <Textarea value={currentOrder.notes || ""} onChange={e => setCurrentOrder({...currentOrder, notes: e.target.value})} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(null)}>Hủy</Button>
            <Button className="w-full sm:w-auto" onClick={handleSave} disabled={createOrder.isPending || updateOrder.isPending}>
              {createOrder.isPending || updateOrder.isPending ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Xác nhận xóa</DialogTitle>
            <DialogDescription>
              Bạn có chắc muốn xóa đơn hàng này không? Dữ liệu không thể khôi phục.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteId(null)}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDelete} disabled={deleteOrder.isPending}>
              {deleteOrder.isPending ? "Đang xóa..." : "Xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
