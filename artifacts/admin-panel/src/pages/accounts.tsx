import { useState, useMemo, useEffect } from "react"
import { useListAccounts, useAddAccounts, useUpdateAccount, useDeleteAccount, getListAccountsQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Search, Plus, Edit2, Trash2, Package, Bell, BellOff } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Account } from "@workspace/api-client-react"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

const DEFAULT_NOTIFY_MSG = "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!"

export default function Accounts() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: accounts, isLoading } = useListAccounts({ query: { queryKey: getListAccountsQueryKey() } })
  const addAccounts   = useAddAccounts({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })
  const updateAccount = useUpdateAccount({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })
  const deleteAccount = useDeleteAccount({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })

  const [search, setSearch]           = useState("")
  const [filterStatus, setFilterStatus] = useState("all")

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addText, setAddText]   = useState("")
  const [addType, setAddType]   = useState("")
  const [addNote, setAddNote]   = useState("")

  // ── Notify state ──────────────────────────────────────────────────────────
  const [notifyEnabled, setNotifyEnabled]     = useState(true)
  const [notifyMessage, setNotifyMessage]     = useState(DEFAULT_NOTIFY_MSG)
  const [showMsgEditor, setShowMsgEditor]     = useState(false)
  const [notifySettingsSaving, setNotifySettingsSaving] = useState(false)

  useEffect(() => {
    fetch("/api/bot/stock-notify-settings", { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setNotifyEnabled(d.enabled !== false)
        setNotifyMessage(d.message || DEFAULT_NOTIFY_MSG)
      })
      .catch(() => {})
  }, [])

  // ── Save default notify settings ─────────────────────────────────────────
  const saveNotifySettings = async (enabled: boolean, message: string) => {
    setNotifySettingsSaving(true)
    try {
      await fetch("/api/bot/stock-notify-settings", {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message }),
      })
    } catch { /* ignore */ } finally { setNotifySettingsSaving(false) }
  }

  // ── Account state ─────────────────────────────────────────────────────────
  const [editAccount, setEditAccount]             = useState<Account | null>(null)
  const [editType, setEditType]                   = useState("")
  const [editNote, setEditNote]                   = useState("")
  const [editStatus, setEditStatus]               = useState("")
  const [deleteAccountEmail, setDeleteAccountEmail] = useState<string | null>(null)

  const filteredAccounts = useMemo(() => {
    if (!accounts) return []
    return accounts.filter(acc => {
      const matchSearch = acc.email.toLowerCase().includes(search.toLowerCase()) ||
                          (acc.note || "").toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === "all" || acc.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [accounts, search, filterStatus])

  const openEdit = (acc: Account) => {
    setEditAccount(acc)
    setEditType(acc.type || "")
    setEditNote(acc.note || "")
    setEditStatus(acc.status || "available")
  }

  const handleAddSubmit = async () => {
    if (!addText.trim()) return
    const lines = addText.split("\n").filter(l => l.trim().includes(":"))
    const parsedAccounts = lines.map(line => {
      const [email, ...rest] = line.split(":")
      return {
        email: email.trim(),
        password: rest.join(":").trim(),
        type: addType || undefined,
        note: addNote || undefined,
      }
    })

    if (parsedAccounts.length === 0) {
      toast({ title: "Lỗi", description: "Định dạng không hợp lệ. Vui lòng dùng định dạng email:password", variant: "destructive" })
      return
    }

    try {
      const result: any = await addAccounts.mutateAsync({
        data: {
          accounts: parsedAccounts,
          notify: notifyEnabled,
          notifyMessage: notifyMessage.trim() || DEFAULT_NOTIFY_MSG,
        } as any,
      })
      const added = result?.added ?? parsedAccounts.length
      if (notifyEnabled && added > 0) {
        toast({
          title: "✅ Đã thêm & xếp hàng thông báo",
          description: `Thêm ${added} tài khoản. Đang gửi thông báo tới người chưa nhận quà.`,
        })
      } else {
        toast({ title: "Thành công", description: `Đã thêm ${added} tài khoản` })
      }
      setAddDialogOpen(false)
      setAddText("")
      setAddType("")
      setAddNote("")
    } catch {
      toast({ title: "Lỗi", description: "Không thể thêm tài khoản", variant: "destructive" })
    }
  }

  const handleEditSubmit = async () => {
    if (!editAccount) return
    try {
      await updateAccount.mutateAsync({ email: editAccount.email, data: { type: editType, note: editNote, status: editStatus } })
      toast({ title: "Thành công", description: "Cập nhật tài khoản thành công" })
      setEditAccount(null)
    } catch {
      toast({ title: "Lỗi", description: "Không thể cập nhật", variant: "destructive" })
    }
  }

  const handleDeleteSubmit = async () => {
    if (!deleteAccountEmail) return
    try {
      await deleteAccount.mutateAsync({ email: deleteAccountEmail })
      toast({ title: "Thành công", description: "Đã xóa tài khoản" })
      setDeleteAccountEmail(null)
    } catch {
      toast({ title: "Lỗi", description: "Không thể xóa tài khoản", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Kho tài khoản</h1>
          <p className="text-muted-foreground mt-1 text-sm">Quản lý kho tài khoản dùng để phát quà</p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="w-full sm:w-auto min-h-[44px]">
          <Plus className="w-4 h-4 mr-2" /> Thêm tài khoản
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm email hoặc ghi chú..."
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
                <SelectItem value="available">Còn hàng</SelectItem>
                <SelectItem value="distributed">Đã phát</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/50">
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-4">
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4 mb-2" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </div>
              ))
            ) : filteredAccounts.length > 0 ? (
              filteredAccounts.map(acc => (
                <div key={acc.email} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <code className="text-xs font-mono break-all leading-relaxed">{acc.email}</code>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => openEdit(acc)}>
                        <Edit2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-10 w-10" onClick={() => setDeleteAccountEmail(acc.email)}>
                        <Trash2 className="w-4 h-4 text-destructive/70" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={acc.status === "available" ? "default" : "secondary"}>
                      {acc.status === "available" ? "Còn hàng" : "Đã phát"}
                    </Badge>
                    {acc.type && <span className="bg-muted px-2 py-0.5 rounded text-xs">{acc.type}</span>}
                    {acc.addedAt && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(acc.addedAt).toLocaleDateString('vi-VN')}
                      </span>
                    )}
                  </div>
                  {acc.note && <p className="text-xs text-muted-foreground">{acc.note}</p>}
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Không tìm thấy tài khoản nào.
              </div>
            )}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-12"><Package className="w-4 h-4" /></TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Ghi chú</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Ngày thêm</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredAccounts.length > 0 ? (
                  filteredAccounts.map(acc => (
                    <TableRow key={acc.email}>
                      <TableCell></TableCell>
                      <TableCell className="font-medium font-mono text-xs">{acc.email}</TableCell>
                      <TableCell>{acc.type || "-"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate" title={acc.note}>{acc.note || "-"}</TableCell>
                      <TableCell>
                        <Badge variant={acc.status === "available" ? "default" : "secondary"}>
                          {acc.status === "available" ? "Còn hàng" : "Đã phát"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {acc.addedAt ? new Date(acc.addedAt).toLocaleDateString('vi-VN') : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(acc)}>
                            <Edit2 className="w-4 h-4 text-muted-foreground hover:text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteAccountEmail(acc.email)}>
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy tài khoản nào.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ── Add Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[520px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Thêm tài khoản mới</DialogTitle>
            <DialogDescription>
              Nhập danh sách tài khoản theo định dạng email:password, mỗi tài khoản một dòng.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {/* Accounts textarea */}
            <div className="grid gap-2">
              <Label htmlFor="accounts">Danh sách tài khoản</Label>
              <Textarea
                id="accounts"
                placeholder={"user1@email.com:pass123\nuser2@email.com:pass456"}
                className="h-32 font-mono text-sm"
                value={addText}
                onChange={e => setAddText(e.target.value)}
              />
            </div>

            {/* Type + note */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Loại tài khoản</Label>
                <Input id="type" placeholder="VD: Premium" value={addType} onChange={e => setAddType(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="note">Ghi chú chung</Label>
                <Input id="note" placeholder="Ghi chú tùy chọn" value={addNote} onChange={e => setAddNote(e.target.value)} />
              </div>
            </div>

            {/* ── Notify section ─────────────────────────────────────────── */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  {notifyEnabled
                    ? <Bell className="h-4 w-4 text-primary shrink-0" />
                    : <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none">Thông báo người dùng</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Gửi tin nhắn đến người chưa nhận quà
                    </p>
                  </div>
                </div>
                <Switch
                  checked={notifyEnabled}
                  onCheckedChange={v => {
                    setNotifyEnabled(v)
                    saveNotifySettings(v, notifyMessage)
                  }}
                  className="shrink-0"
                />
              </div>

              {notifyEnabled && (
                <div className="p-3 border-t border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Nội dung tin nhắn</Label>
                    <button
                      type="button"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => setShowMsgEditor(v => !v)}
                    >
                      {showMsgEditor ? "Ẩn" : "Chỉnh sửa"}
                    </button>
                  </div>

                  {showMsgEditor ? (
                    <Textarea
                      className="text-sm min-h-[80px]"
                      value={notifyMessage}
                      onChange={e => setNotifyMessage(e.target.value)}
                      onBlur={() => saveNotifySettings(notifyEnabled, notifyMessage)}
                    />
                  ) : (
                    <div className="bg-background border border-border/60 rounded p-2 text-xs whitespace-pre-wrap text-foreground/80 font-mono">
                      {notifyMessage || DEFAULT_NOTIFY_MSG}
                    </div>
                  )}
                  {notifySettingsSaving && (
                    <p className="text-xs text-muted-foreground">Đang lưu...</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAddDialogOpen(false)}>Hủy</Button>
            <Button className="w-full sm:w-auto" onClick={handleAddSubmit} disabled={addAccounts.isPending}>
              {addAccounts.isPending
                ? "Đang lưu..."
                : notifyEnabled ? "Lưu & Thông báo" : "Lưu tài khoản"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa tài khoản</DialogTitle>
            <DialogDescription>{editAccount?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-type">Loại tài khoản</Label>
              <Input id="edit-type" value={editType} onChange={e => setEditType(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-status">Trạng thái</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Còn hàng</SelectItem>
                  <SelectItem value="distributed">Đã phát</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-note">Ghi chú</Label>
              <Textarea id="edit-note" value={editNote} onChange={e => setEditNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setEditAccount(null)}>Hủy</Button>
            <Button className="w-full sm:w-auto" onClick={handleEditSubmit} disabled={updateAccount.isPending}>
              {updateAccount.isPending ? "Đang lưu..." : "Cập nhật"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteAccountEmail} onOpenChange={(open) => !open && setDeleteAccountEmail(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Xác nhận xóa</DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa tài khoản{" "}
              <span className="font-bold text-foreground break-all">{deleteAccountEmail}</span>? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteAccountEmail(null)}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDeleteSubmit} disabled={deleteAccount.isPending}>
              {deleteAccount.isPending ? "Đang xóa..." : "Xóa tài khoản"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
