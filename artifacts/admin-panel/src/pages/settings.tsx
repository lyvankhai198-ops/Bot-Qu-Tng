import { useState, useEffect, useRef } from "react"
import { useGetBotSettings, useUpdateBotSettings, useNewRound, getGetBotSettingsQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Save, AlertTriangle, RefreshCcw } from "lucide-react"
import type { BotSettings } from "@workspace/api-client-react"

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

  const [form, setForm] = useState<Partial<BotSettings>>({})
  const [roundModalOpen, setRoundModalOpen] = useState(false)
  const [newRoundId, setNewRoundId] = useState("")

  const initialized = useRef(false)

  useEffect(() => {
    if (settings && !initialized.current) {
      setForm(settings)
      initialized.current = true
    }
  }, [settings])

  const handleSave = () => {
    updateSettings.mutate({ data: form })
  }

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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt hệ thống</h1>
        <p className="text-muted-foreground mt-1">Cấu hình tính năng và quy tắc hoạt động của Bot</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tính năng chính</CardTitle>
          <CardDescription>Bật tắt các module trên hệ thống</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between border-b border-border/50 pb-4">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">Tặng quà</Label>
              <p className="text-sm text-muted-foreground">Cho phép người dùng nhận tài khoản từ kho</p>
            </div>
            <Switch checked={!!form.giftEnabled} onCheckedChange={v => setForm({...form, giftEnabled: v})} />
          </div>
          
          <div className="flex items-center justify-between border-b border-border/50 pb-4">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">Gửi yêu cầu hỗ trợ/bảo hành</Label>
              <p className="text-sm text-muted-foreground">Mở module cho phép người dùng báo lỗi đơn hàng</p>
            </div>
            <Switch checked={!!form.supportEnabled} onCheckedChange={v => setForm({...form, supportEnabled: v})} />
          </div>

          <div className="flex items-center justify-between border-b border-border/50 pb-4">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">Cấu hình Intro</Label>
              <p className="text-sm text-muted-foreground">Sử dụng tin nhắn Intro khi bắt đầu bot</p>
            </div>
            <Switch checked={!!form.introEnabled} onCheckedChange={v => setForm({...form, introEnabled: v})} />
          </div>

          <div className="flex items-center justify-between bg-destructive/5 border border-destructive/20 p-4 rounded-lg">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold text-destructive flex items-center">
                <AlertTriangle className="w-4 h-4 mr-2" /> Bảo trì hệ thống
              </Label>
              <p className="text-sm text-muted-foreground">Tạm ngưng tất cả hoạt động, bot chỉ hiện thông báo bảo trì</p>
            </div>
            <Switch 
              checked={!!form.maintenanceMode} 
              onCheckedChange={v => setForm({...form, maintenanceMode: v})}
              className="data-[state=checked]:bg-destructive" 
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin liên hệ</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Link cửa hàng (Channel/Website)</Label>
              <Input value={form.shopLink || ""} onChange={e => setForm({...form, shopLink: e.target.value})} placeholder="https://t.me/cuahang" />
            </div>
            <div className="space-y-2">
              <Label>Username Cửa hàng</Label>
              <Input value={form.shopUsername || ""} onChange={e => setForm({...form, shopUsername: e.target.value})} placeholder="@cuahang" />
            </div>
            <div className="space-y-2">
              <Label>Username Hỗ trợ viên</Label>
              <Input value={form.supportUsername || ""} onChange={e => setForm({...form, supportUsername: e.target.value})} placeholder="@hotro" />
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
              <Input type="number" value={form.cooldownHours || 0} onChange={e => setForm({...form, cooldownHours: Number(e.target.value)})} />
              <p className="text-xs text-muted-foreground">Thời gian user phải đợi để nhận quà lần tiếp theo</p>
            </div>
            
            <div className="p-4 bg-muted/30 rounded-lg space-y-3 mt-4 border border-border/50">
              <Label className="text-sm font-semibold">Đợt phát quà hiện tại</Label>
              <div className="flex items-center gap-3">
                <Input value={form.roundId || ""} disabled className="bg-muted font-mono" />
                <Button variant="secondary" onClick={() => setRoundModalOpen(true)}>
                  <RefreshCcw className="w-4 h-4 mr-2" /> Đợt mới
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Tạo đợt mới sẽ reset lượt nhận quà của tất cả người dùng.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cấu hình bảo hành/Hoàn tiền</CardTitle>
          <CardDescription>Cách tính toán số tiền hoàn mặc định cho đơn hàng</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup value={form.refundFormula || "remaining_days"} onValueChange={v => setForm({...form, refundFormula: v})}>
            <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="remaining_days" id="r1" className="mt-1" />
              <div>
                <Label htmlFor="r1" className="text-base cursor-pointer">Theo ngày còn lại</Label>
                <p className="text-sm text-muted-foreground mt-1">Tính dựa trên số ngày bảo hành còn lại so với giá gốc</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 border rounded-md hover:bg-muted/50 transition-colors">
              <RadioGroupItem value="custom" id="r2" className="mt-1" />
              <div className="w-full">
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

      <div className="flex justify-end sticky bottom-4 z-10">
        <Button size="lg" className="shadow-lg hover-elevate px-8" onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "Đang lưu..." : <><Save className="w-4 h-4 mr-2" /> Lưu thay đổi</>}
        </Button>
      </div>

      <Dialog open={roundModalOpen} onOpenChange={setRoundModalOpen}>
        <DialogContent>
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoundModalOpen(false)}>Hủy</Button>
            <Button onClick={handleNewRound} disabled={newRoundMutation.isPending}>Khởi tạo đợt mới</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}