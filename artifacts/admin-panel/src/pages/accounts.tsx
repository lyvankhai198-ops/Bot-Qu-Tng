import { useState, useMemo, useEffect } from "react"
import { useListAccounts, useAddAccounts, useUpdateAccount, useDeleteAccount, getListAccountsQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Search, Plus, Edit2, Trash2, Package, Bell, BellOff, Users, ArrowDownUp, UserCheck, RotateCcw, Warehouse } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDistanceToNow, format, differenceInDays } from "date-fns"
import { vi as viLocale } from "date-fns/locale"
import type { Account } from "@workspace/api-client-react"

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

const DEFAULT_NOTIFY_MSG = "🎁 Kho quà vừa được bổ sung!\n\nTruy cập bot để nhận quà ngay nhé!"

function StatusBadge({ status }: { status?: string }) {
  if (status === "distributed") {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 shrink-0">Đã phát</Badge>
  }
  if (status === "returned") {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 shrink-0">Hoàn về</Badge>
  }
  return <Badge className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 shrink-0">Chưa nhận</Badge>
}

/** Normalize ISO string: server lưu UTC không có suffix → thêm Z để browser parse đúng */
function normalizeISO(iso: string): string {
  if (/[Z]$/.test(iso) || /[+-]\d{2}:\d{2}$/.test(iso)) return iso
  return iso + "Z"
}

/** Hiển thị thống nhất: < 7 ngày → "X phút/giờ/ngày trước", cũ hơn → "dd/MM/yyyy" */
function smartDate(iso?: string | null): { label: string; title: string } | null {
  if (!iso) return null
  try {
    const d = new Date(normalizeISO(iso))
    if (isNaN(d.getTime())) return null
    const title = format(d, "HH:mm dd/MM/yyyy")
    const daysDiff = differenceInDays(new Date(), d)
    const label = daysDiff < 7
      ? formatDistanceToNow(d, { addSuffix: true, locale: viLocale })
      : format(d, "dd/MM/yyyy")
    return { label, title }
  } catch { return null }
}

export default function Accounts() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: accounts, isLoading } = useListAccounts({ query: { queryKey: getListAccountsQueryKey() } })
  const addAccounts   = useAddAccounts({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })
  const updateAccount = useUpdateAccount({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })
  const deleteAccount = useDeleteAccount({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() }) } })

  const [search, setSearch]             = useState("")
  const [filterStatus, setFilterStatus] = useState("all")

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [addText, setAddText]   = useState("")
  const [addType, setAddType]   = useState("")
  const [addNote, setAddNote]   = useState("")

  // ── Notify state ──────────────────────────────────────────────────────────
  const [notifyEnabled, setNotifyEnabled]   = useState(true)
  const [notifyTarget, setNotifyTarget]     = useState<"all" | "no_received">("no_received")
  const [notifyMessage, setNotifyMessage]   = useState(DEFAULT_NOTIFY_MSG)
  const [showMsgEditor, setShowMsgEditor]   = useState(false)
  const [notifySettingsSaving, setNotifySettingsSaving] = useState(false)

  useEffect(() => {
    fetch("/api/bot/stock-notify-settings", { headers: authHeader() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return
        setNotifyEnabled(d.enabled !== false)
        setNotifyMessage(d.message || DEFAULT_NOTIFY_MSG)
        setNotifyTarget(d.target === "all" ? "all" : "no_received")
      })
      .catch(() => {})
  }, [])

  const saveNotifySettings = async (enabled: boolean, message: string, target: string) => {
    setNotifySettingsSaving(true)
    try {
      await fetch("/api/bot/stock-notify-settings", {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, message, target }),
      })
    } catch { /* ignore */ } finally { setNotifySettingsSaving(false) }
  }

  // ── Account state ─────────────────────────────────────────────────────────
  const [editAccount, setEditAccount]               = useState<Account | null>(null)
  const [editType, setEditType]                     = useState("")
  const [editNote, setEditNote]                     = useState("")
  const [editStatus, setEditStatus]                 = useState("")
  const [deleteAccountEmail, setDeleteAccountEmail] = useState<string | null>(null)

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!accounts) return { total: 0, available: 0, distributed: 0, returned: 0 }
    return {
      total:       accounts.length,
      available:   accounts.filter(a => !a.status || a.status === "available").length,
      distributed: accounts.filter(a => a.status === "distributed").length,
      returned:    accounts.filter(a => a.status === "returned").length,
    }
  }, [accounts])

  // ── Filter + sort (newest first by addedAt / distributedAt / returnedAt) ──
  const filteredAccounts = useMemo(() => {
    if (!accounts) return []
    const filtered = accounts.filter(acc => {
      const matchSearch = acc.email.toLowerCase().includes(search.toLowerCase()) ||
                          (acc.note || "").toLowerCase().includes(search.toLowerCase()) ||
                          (acc.distributedTo || "").toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === "all" || acc.status === filterStatus ||
                          (filterStatus === "available" && (!acc.status || acc.status === "available"))
      return matchSearch && matchStatus
    })
    // Sort: dùng mốc thời gian phù hợp nhất với từng trạng thái
    const primaryDate = (a: any) => {
      if (a.status === "returned")    return (a.returnedAt    || a.addedAt || "")
      if (a.status === "distributed") return (a.distributedAt || a.addedAt || "")
      return (a.addedAt || "")
    }
    return [...filtered].sort((a, b) => primaryDate(b).localeCompare(primaryDate(a)))
  }, [accounts, search, filterStatus])

  const openEdit = (acc: Account) => {
    setEditAccount(acc)
    setEditType(acc.type || "")
    setEditNote(acc.note || "")
    setEditStatus(acc.status || "available")
  }

  const handleAddSubmit = async () => {
    if (!addText.trim()) return
    const lines = addText.split("\n").map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length === 0) {
      toast({ title: "Lỗi", description: "Vui lòng nhập ít nhất một dòng", variant: "destructive" })
      return
    }
    const parsedAccounts = lines.map(line => ({
      email: line,
      password: "",
      type: addType || undefined,
      note: addNote || undefined,
    }))
    try {
      const result: any = await addAccounts.mutateAsync({
        data: {
          accounts: parsedAccounts,
          notify: notifyEnabled,
          notifyMessage: notifyMessage.trim() || DEFAULT_NOTIFY_MSG,
          notifyTarget,
        } as any,
      })
      const added = result?.added ?? parsedAccounts.length
      if (notifyEnabled && added > 0) {
        const targetLabel = notifyTarget === "all" ? "tất cả người dùng" : "người chưa nhận quà"
        toast({ title: "✅ Đã thêm & xếp hàng thông báo", description: `Thêm ${added} mục. Đang gửi tới ${targetLabel}.` })
      } else {
        toast({ title: "Thành công", description: `Đã thêm ${added} mục` })
      }
      setAddDialogOpen(false)
      setAddText(""); setAddType(""); setAddNote("")
    } catch {
      toast({ title: "Lỗi", description: "Không thể thêm tài khoản", variant: "destructive" })
    }
  }

  const handleEditSubmit = async () => {
    if (!editAccount) return
    try {
      await updateAccount.mutateAsync({ email: editAccount.email, data: { type: editType, note: editNote, status: editStatus } })
      toast({ title: "Thành công", description: "Đã cập nhật" })
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
      toast({ title: "Lỗi", description: "Không thể xóa", variant: "destructive" })
    }
  }

  const lineCount = addText.split("\n").filter(l => l.trim().length > 0).length

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Kho tài khoản</h1>
          <p className="text-muted-foreground mt-1 text-sm">Quản lý kho tài khoản dùng để phát quà · mới nhất trước</p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} className="w-full sm:w-auto min-h-[44px]">
          <Plus className="w-4 h-4 mr-2" /> Thêm tài khoản
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2 md:gap-3">
        {[
          { label: "Tổng", value: stats.total,       icon: Warehouse,   color: "text-foreground" },
          { label: "Chưa nhận", value: stats.available,  icon: Package,     color: "text-green-600 dark:text-green-400" },
          { label: "Đã phát",  value: stats.distributed, icon: UserCheck,   color: "text-blue-600 dark:text-blue-400" },
          { label: "Hoàn về",  value: stats.returned,    icon: RotateCcw,   color: "text-amber-600 dark:text-amber-400" },
        ].map(s => (
          <Card key={s.label} className="cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setFilterStatus(
                  s.label === "Tổng" ? "all"
                  : s.label === "Chưa nhận" ? "available"
                  : s.label === "Đã phát" ? "distributed"
                  : "returned"
                )}>
            <CardContent className="p-3 text-center">
              <s.icon className={`h-5 w-5 mx-auto mb-1 ${s.color}`} />
              <div className={`text-xl font-bold ${s.color}`}>{isLoading ? "—" : s.value}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm email, ghi chú, ID người nhận..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background min-h-[44px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="bg-background min-h-[44px] flex-1">
                  <SelectValue placeholder="Trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả trạng thái</SelectItem>
                  <SelectItem value="available">✅ Chưa nhận</SelectItem>
                  <SelectItem value="distributed">📤 Đã phát</SelectItem>
                  <SelectItem value="returned">↩️ Hoàn về</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
                <ArrowDownUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Mới nhất trước</span>
              </div>
            </div>
          </div>

          {/* Account list */}
          <div className="divide-y divide-border/40">
            {isLoading ? (
              Array(5).fill(0).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/2" />
                </div>
              ))
            ) : filteredAccounts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground text-sm">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                Không tìm thấy tài khoản nào.
              </div>
            ) : (
              filteredAccounts.map(acc => {
                const accAny = acc as any
                return (
                  <div key={acc.email} className="p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      {/* Left: main info */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Email */}
                        <code className="text-xs font-mono break-all leading-relaxed">{acc.email}</code>

                        {/* Badges row */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={acc.status} />
                          {acc.type && (
                            <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-[11px]">
                              {acc.type}
                            </span>
                          )}
                        </div>

                        {/* Detail row */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">

                          {/* Thêm vào — chỉ hiện khi chưa nhận (available) */}
                          {(!acc.status || acc.status === "available") && (() => {
                            const t = smartDate(acc.addedAt)
                            return t ? <span title={t.title}>📦 Thêm {t.label}</span> : null
                          })()}

                          {/* Đã phát — thời gian phát + ai nhận */}
                          {acc.status === "distributed" && (() => {
                            const t = smartDate(acc.distributedAt)
                            return (
                              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                                <UserCheck className="h-3 w-3" />
                                {t ? <span title={t.title}>Phát {t.label}</span> : "Đã phát"}
                                {acc.distributedTo && (
                                  <span className="text-muted-foreground">· ID {acc.distributedTo}</span>
                                )}
                              </span>
                            )
                          })()}

                          {/* Hoàn về — thời gian hoàn + từ ai */}
                          {acc.status === "returned" && (() => {
                            const t = smartDate(accAny.returnedAt || acc.distributedAt)
                            return (
                              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                <RotateCcw className="h-3 w-3" />
                                {t ? <span title={t.title}>Hoàn {t.label}</span> : "Đã hoàn về kho"}
                                {acc.distributedTo && (
                                  <span className="text-muted-foreground">· từ ID {acc.distributedTo}</span>
                                )}
                              </span>
                            )
                          })()}

                          {/* Note */}
                          {acc.note && (
                            <span className="italic">"{acc.note}"</span>
                          )}
                        </div>
                      </div>

                      {/* Right: actions */}
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(acc)}>
                          <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setDeleteAccountEmail(acc.email)}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive/70" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer count */}
          {!isLoading && filteredAccounts.length > 0 && (
            <div className="px-4 py-2.5 border-t border-border/40 bg-muted/10 text-xs text-muted-foreground text-right">
              {filteredAccounts.length} / {stats.total} tài khoản
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add Dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[520px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Thêm tài khoản mới</DialogTitle>
            <DialogDescription>Mỗi dòng là một mục — email:pass, link, hoặc bất kỳ nội dung nào.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="accounts">Danh sách nội dung</Label>
                {lineCount > 0 && <span className="text-xs text-muted-foreground">{lineCount} mục</span>}
              </div>
              <Textarea
                id="accounts"
                placeholder={"email@example.com:pass123\nhttps://t.me/example\nBất kỳ nội dung nào..."}
                className="h-32 font-mono text-sm"
                value={addText}
                onChange={e => setAddText(e.target.value)}
              />
            </div>

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

            {/* Notify */}
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between gap-3 p-3 bg-muted/30">
                <div className="flex items-center gap-2 min-w-0">
                  {notifyEnabled ? <Bell className="h-4 w-4 text-primary shrink-0" /> : <BellOff className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none">Thông báo người dùng</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Gửi tin nhắn sau khi thêm vào kho</p>
                  </div>
                </div>
                <Switch checked={notifyEnabled} onCheckedChange={v => { setNotifyEnabled(v); saveNotifySettings(v, notifyMessage, notifyTarget) }} className="shrink-0" />
              </div>

              {notifyEnabled && (
                <div className="p-3 border-t border-border space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    {(["no_received", "all"] as const).map(t => (
                      <button key={t} type="button"
                        onClick={() => { setNotifyTarget(t); saveNotifySettings(notifyEnabled, notifyMessage, t) }}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                          notifyTarget === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
                        }`}>
                        <Users className="h-3.5 w-3.5 shrink-0" />
                        {t === "no_received" ? "Chưa nhận quà" : "Tất cả người dùng"}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Nội dung tin nhắn</Label>
                      <button type="button" className="text-xs text-primary underline-offset-2 hover:underline"
                        onClick={() => setShowMsgEditor(v => !v)}>
                        {showMsgEditor ? "Ẩn" : "Chỉnh sửa"}
                      </button>
                    </div>
                    {showMsgEditor ? (
                      <Textarea className="text-sm min-h-[80px]" value={notifyMessage}
                        onChange={e => setNotifyMessage(e.target.value)}
                        onBlur={() => saveNotifySettings(notifyEnabled, notifyMessage, notifyTarget)} />
                    ) : (
                      <div className="bg-background border border-border/60 rounded p-2 text-xs whitespace-pre-wrap text-foreground/80 font-mono">
                        {notifyMessage || DEFAULT_NOTIFY_MSG}
                      </div>
                    )}
                    {notifySettingsSaving && <p className="text-xs text-muted-foreground">Đang lưu...</p>}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setAddDialogOpen(false)}>Hủy</Button>
            <Button className="w-full sm:w-auto" onClick={handleAddSubmit} disabled={addAccounts.isPending}>
              {addAccounts.isPending ? "Đang lưu..." : notifyEnabled ? "Lưu & Thông báo" : "Lưu tài khoản"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editAccount} onOpenChange={(open) => !open && setEditAccount(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Chỉnh sửa tài khoản</DialogTitle>
            <DialogDescription className="break-all">{editAccount?.email}</DialogDescription>
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
                  <SelectItem value="available">✅ Chưa nhận</SelectItem>
                  <SelectItem value="distributed">📤 Đã phát</SelectItem>
                  <SelectItem value="returned">↩️ Hoàn về</SelectItem>
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
              Bạn có chắc chắn muốn xóa{" "}
              <span className="font-bold text-foreground break-all">{deleteAccountEmail}</span>? Hành động này không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDeleteAccountEmail(null)}>Hủy</Button>
            <Button variant="destructive" className="w-full sm:w-auto" onClick={handleDeleteSubmit} disabled={deleteAccount.isPending}>
              {deleteAccount.isPending ? "Đang xóa..." : "Xóa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
