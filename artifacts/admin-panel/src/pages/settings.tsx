import { useState, useEffect, useRef } from "react"
import {
  useGetBotSettings, useUpdateBotSettings, useNewRound, getGetBotSettingsQueryKey,
  useGetNotificationSettings, useUpdateNotificationSettings, getGetNotificationSettingsQueryKey,
} from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Save, AlertTriangle, RefreshCcw, Bell, BellOff, Plus, Trash2 } from "lucide-react"
import type { BotSettings, NotificationSettings } from "@workspace/api-client-react"

export default function Settings() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  const { data: settings, isLoading } = useGetBotSettings({ query: { queryKey: getGetBotSettingsQueryKey() } })
  const updateSettings = useUpdateBotSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetBotSettingsQueryKey(), data)
        toast({ title: "Thành công", description: "Đã lưu cài đặt" })
      }
    }
  })
  const newRoundMutation = useNewRound({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBotSettingsQueryKey() })
        toast({ title: "Thành công", description: "Đã chuyển sang đợt tặng quà mới" })
      }
    }
  })

  const { data: notifData } = useGetNotificationSettings({ query: { queryKey: getGetNotificationSettingsQueryKey() } })
  const updateNotif = useUpdateNotificationSettings({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetNotificationSettingsQueryKey(), data)
        toast({ title: "Thành công", description: "Đã lưu cài đặt thông báo" })
      }
    }
  })

  const [form, setForm] = useState<Partial<BotSettings>>({})
  const [roundModalOpen, setRoundModalOpen] = useState(false)
  const [newRoundId, setNewRoundId] = useState("")
  const initialized = useRef(false)

  const [notifForm, setNotifForm] = useState<Partial<NotificationSettings>>({
    enabled: true, adminIds: [], reminderEnabled: true,
    reminder1Minutes: 5, reminder2Minutes: 15, urgentMinutes: 30,
  })
  const [newAdminId, setNewAdminId] = useState("")
  const notifInitialized = useRef(false)

  useEffect(() => {
    if (settings && !initialized.current) {
      setForm(settings)
      initialized.current = true
    }
  }, [settings])

  useEffect(() => {
    if (notifData && !notifInitialized.current) {
      setNotifForm(notifData)
      notifInitialized.current = true
    }
  }, [notifData])

  const handleSave = () => updateSettings.mutate({ data: form })

  const handleSaveNotif = () => updateNotif.mutate({ data: notifForm })

  const addAdminId = () => {
    const id = newAdminId.trim()
    if (!id || !/^\d+$/.test(id)) {
      toast({ title: "Lỗi", description: "Telegram ID chỉ gồm số", variant: "destructive" }); return
    }
    const existing = notifForm.adminIds ?? []
    if (existing.includes(id)) {
      toast({ title: "Đã tồn tại", description: `ID ${id} đã có trong danh sách`, variant: "destructive" }); return
    }
    setNotifForm({ ...notifForm, adminIds: [...existing, id] })
    setNewAdminId("")
  }

  const removeAdminId = (id: string) =>
    setNotifForm({ ...notifForm, adminIds: (notifForm.adminIds ?? []).filter(x => x !== id) })

  const handleNewRound = () => {
    if (!newRoundId.trim()) {
      toast({ title: "Lỗi", description: "Vui lòng nhập ID đợt mới", variant: "destructive" })
      return
    }
    newRoundMutation.mutate({ data: { roundId: newRoundId.trim() } })
    setRoundModalOpen(false)
    setNewRoundId("")
  }

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground animate-pulse">Đang tải cài đặt...</div>
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Cài đặt hệ thống</h1>
        <p className="text-muted-foreground mt-1 text-sm">Cấu hình tính năng và quy tắc hoạt động của Bot</p>
      </div>

      {/* Feature toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Tính năng chính</CardTitle>
          <CardDescription>Bật tắt các module trên hệ thống</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 md:space-y-6">
          {/* Each toggle row: text left, switch right */}
          <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-4">
            <div className="space-y-0.5 min-w-0">
              <Label className="text-base font-semibold">Tặng quà</Label>
              <p className="text-sm text-muted-foreground">Cho phép người dùng nhận tài khoản từ kho</p>
            </div>
            <Switch
              checked={!!form.giftEnabled}
              onCheckedChange={v => setForm({...form, giftEnabled: v})}
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-4">
            <div className="space-y-0.5 min-w-0">
              <Label className="text-base font-semibold">Hỗ trợ / Bảo hành</Label>
              <p className="text-sm text-muted-foreground">Mở module cho phép người dùng báo lỗi đơn hàng</p>
            </div>
            <Switch
              checked={!!form.supportEnabled}
              onCheckedChange={v => setForm({...form, supportEnabled: v})}
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-4">
            <div className="space-y-0.5 min-w-0">
              <Label className="text-base font-semibold">Cấu hình Intro</Label>
              <p className="text-sm text-muted-foreground">Sử dụng tin nhắn Intro khi bắt đầu bot</p>
            </div>
            <Switch
              checked={!!form.introEnabled}
              onCheckedChange={v => setForm({...form, introEnabled: v})}
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-4 bg-destructive/5 border border-destructive/20 p-4 rounded-lg">
            <div className="space-y-0.5 min-w-0">
              <Label className="text-base font-semibold text-destructive flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> Bảo trì hệ thống
              </Label>
              <p className="text-sm text-muted-foreground">Tạm ngưng tất cả hoạt động, bot chỉ hiện thông báo bảo trì</p>
            </div>
            <Switch
              checked={!!form.maintenanceMode}
              onCheckedChange={v => setForm({...form, maintenanceMode: v})}
              className="data-[state=checked]:bg-destructive shrink-0"
            />
          </div>
        </CardContent>
      </Card>

      {/* Contact + operations — stacked on mobile, 2-col on md */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin liên hệ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Link cửa hàng (Channel/Website)</Label>
              <Input
                value={form.shopLink || ""}
                onChange={e => setForm({...form, shopLink: e.target.value})}
                placeholder="https://t.me/cuahang"
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Username Cửa hàng</Label>
              <Input
                value={form.shopUsername || ""}
                onChange={e => setForm({...form, shopUsername: e.target.value})}
                placeholder="@cuahang"
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Username Hỗ trợ viên</Label>
              <Input
                value={form.supportUsername || ""}
                onChange={e => setForm({...form, supportUsername: e.target.value})}
                placeholder="@hotro"
                className="min-h-[44px]"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cấu hình vận hành</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Thời gian chờ nhận quà (Giờ)</Label>
              <Input
                type="number"
                value={form.cooldownHours || 0}
                onChange={e => setForm({...form, cooldownHours: Number(e.target.value)})}
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">Thời gian user phải đợi để nhận quà lần tiếp theo</p>
            </div>
            <div className="p-4 bg-muted/30 rounded-lg space-y-3 border border-border/50">
              <Label className="text-sm font-semibold">Đợt phát quà hiện tại</Label>
              <div className="flex items-center gap-2">
                <Input value={form.roundId || ""} disabled className="bg-muted font-mono min-h-[44px] flex-1" />
                <Button variant="secondary" onClick={() => setRoundModalOpen(true)} className="shrink-0 min-h-[44px]">
                  <RefreshCcw className="w-4 h-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Đợt mới</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Tạo đợt mới sẽ reset lượt nhận quà của tất cả người dùng.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Refund formula */}
      <Card>
        <CardHeader>
          <CardTitle>Cấu hình bảo hành / Hoàn tiền</CardTitle>
          <CardDescription>Cách tính toán số tiền hoàn mặc định cho đơn hàng</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 md:space-y-6">
          <RadioGroup value={form.refundFormula || "remaining_days"} onValueChange={v => setForm({...form, refundFormula: v})}>
            <div className="flex items-start space-x-3 p-4 border rounded-md hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="remaining_days" id="r1" className="mt-0.5 shrink-0" />
              <div>
                <Label htmlFor="r1" className="text-base cursor-pointer">Theo ngày còn lại</Label>
                <p className="text-sm text-muted-foreground mt-1">Tính dựa trên số ngày bảo hành còn lại so với giá gốc</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-4 border rounded-md hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="custom" id="r2" className="mt-0.5 shrink-0" />
              <div className="w-full min-w-0">
                <Label htmlFor="r2" className="text-base cursor-pointer">Văn bản tùy chỉnh</Label>
                <p className="text-sm text-muted-foreground mt-1 mb-3">Hiển thị thông báo hoặc công thức riêng do bạn tự định nghĩa</p>
                {form.refundFormula === "custom" && (
                  <Textarea
                    value={form.refundCustomText || ""}
                    onChange={e => setForm({...form, refundCustomText: e.target.value})}
                    placeholder="Nhập thông báo chính sách hoàn tiền..."
                    className="w-full h-24"
                  />
                )}
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="pb-4">
        <Button
          size="lg"
          className="w-full sm:w-auto min-h-[48px] px-8"
          onClick={handleSave}
          disabled={updateSettings.isPending}
        >
          {updateSettings.isPending ? "Đang lưu..." : <><Save className="w-4 h-4 mr-2" /> Lưu thay đổi</>}
        </Button>
      </div>

      {/* ── Notification settings ───────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg md:text-xl font-semibold tracking-tight flex items-center gap-2 mt-2 mb-4">
          <Bell className="w-5 h-5 text-blue-500" /> Cài đặt thông báo bảo hành
        </h2>
        <p className="text-sm text-muted-foreground -mt-3 mb-4">Bot gửi thông báo Telegram đến Admin khi có yêu cầu bảo hành mới</p>
      </div>

      {/* Master toggle */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">Bật thông báo Admin</Label>
              <p className="text-sm text-muted-foreground mt-1">Gửi Telegram ngay khi có yêu cầu bảo hành mới</p>
            </div>
            <Switch
              checked={!!notifForm.enabled}
              onCheckedChange={v => setNotifForm({ ...notifForm, enabled: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Admin IDs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách Admin nhận thông báo</CardTitle>
          <CardDescription>Thêm Telegram ID của các Admin (dùng lệnh /myid trong bot để lấy ID)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              className="min-h-[44px] flex-1"
              placeholder="Nhập Telegram ID (ví dụ: 123456789)"
              value={newAdminId}
              onChange={e => setNewAdminId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addAdminId()}
              type="number"
            />
            <Button className="min-h-[44px] shrink-0" onClick={addAdminId} variant="outline">
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 min-h-[28px]">
            {(notifForm.adminIds ?? []).length === 0 ? (
              <span className="text-sm text-muted-foreground">Chưa có Admin nào được cấu hình</span>
            ) : (
              (notifForm.adminIds ?? []).map(id => (
                <Badge key={id} variant="secondary" className="flex items-center gap-1 px-3 py-1">
                  {id}
                  <button onClick={() => removeAdminId(id)} className="ml-1 hover:text-destructive transition-colors">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Reminder settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Nhắc lại & Khẩn cấp</CardTitle>
              <CardDescription className="mt-1">Bot tự động nhắc lại nếu Admin chưa xử lý sau một thời gian</CardDescription>
            </div>
            <Switch
              checked={!!notifForm.reminderEnabled}
              onCheckedChange={v => setNotifForm({ ...notifForm, reminderEnabled: v })}
            />
          </div>
        </CardHeader>
        {notifForm.reminderEnabled && (
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1">⏰ Nhắc lần 1 (phút)</Label>
                <Input
                  type="number" min={1} max={60}
                  className="min-h-[44px]"
                  value={notifForm.reminder1Minutes ?? 5}
                  onChange={e => setNotifForm({ ...notifForm, reminder1Minutes: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1">⚠️ Nhắc lần 2 (phút)</Label>
                <Input
                  type="number" min={1} max={120}
                  className="min-h-[44px]"
                  value={notifForm.reminder2Minutes ?? 15}
                  onChange={e => setNotifForm({ ...notifForm, reminder2Minutes: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1">🚨 Khẩn cấp (phút)</Label>
                <Input
                  type="number" min={1} max={480}
                  className="min-h-[44px]"
                  value={notifForm.urgentMinutes ?? 30}
                  onChange={e => setNotifForm({ ...notifForm, urgentMinutes: Number(e.target.value) })}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Save notification settings */}
      <div className="pb-4">
        <Button
          size="lg"
          className="w-full sm:w-auto min-h-[48px] px-8 bg-blue-600 hover:bg-blue-700"
          onClick={handleSaveNotif}
          disabled={updateNotif.isPending}
        >
          {updateNotif.isPending ? "Đang lưu..." : <><Bell className="w-4 h-4 mr-2" /> Lưu cài đặt thông báo</>}
        </Button>
      </div>

      {/* New round dialog */}
      <Dialog open={roundModalOpen} onOpenChange={setRoundModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Tạo đợt phát quà mới</DialogTitle>
            <DialogDescription>
              Khi bắt đầu đợt mới, toàn bộ người dùng đã nhận quà ở đợt cũ sẽ có thể nhận quà lại.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Tên ID đợt mới</Label>
              <Input
                value={newRoundId}
                onChange={e => setNewRoundId(e.target.value)}
                placeholder="VD: Tet2025, Thang10..."
                className="min-h-[44px]"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setRoundModalOpen(false)}>Hủy</Button>
            <Button className="w-full sm:w-auto min-h-[44px]" onClick={handleNewRound} disabled={newRoundMutation.isPending}>
              Khởi tạo đợt mới
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
