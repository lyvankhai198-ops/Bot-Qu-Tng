import { useState } from "react"
import { useQueueBroadcast } from "@workspace/api-client-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { Send, Users, AlertCircle } from "lucide-react"

export default function Broadcast() {
  const { toast } = useToast()
  const broadcast = useQueueBroadcast()

  const [message, setMessage] = useState("")
  const [target, setTarget] = useState("all")

  const handleSend = async () => {
    if (!message.trim()) {
      toast({ title: "Lỗi", description: "Vui lòng nhập nội dung tin nhắn", variant: "destructive" })
      return
    }

    try {
      await broadcast.mutateAsync({ data: { message, target } })
      toast({ title: "Thành công", description: "Đã đưa tin nhắn vào hàng đợi gửi đi" })
      setMessage("")
    } catch (e) {
      toast({ title: "Lỗi", description: "Không thể gửi tin nhắn", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Gửi thông báo (Broadcast)</h1>
        <p className="text-muted-foreground mt-1">Gửi tin nhắn hàng loạt đến người dùng Bot</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Soạn tin nhắn</CardTitle>
          <CardDescription>Tin nhắn sẽ được gửi theo hàng đợi để tránh bị Telegram chặn do spam.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-base">Đối tượng nhận</Label>
            <RadioGroup value={target} onValueChange={setTarget} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Label
                htmlFor="target-all"
                className={`cursor-pointer flex flex-col items-center justify-between rounded-md border-2 p-4 hover:bg-muted ${target === 'all' ? 'border-primary bg-primary/5' : 'border-muted bg-transparent'}`}
              >
                <RadioGroupItem value="all" id="target-all" className="sr-only" />
                <Users className="mb-2 h-6 w-6" />
                <span>Tất cả người dùng</span>
              </Label>
              <Label
                htmlFor="target-received"
                className={`cursor-pointer flex flex-col items-center justify-between rounded-md border-2 p-4 hover:bg-muted ${target === 'has_received' ? 'border-primary bg-primary/5' : 'border-muted bg-transparent'}`}
              >
                <RadioGroupItem value="has_received" id="target-received" className="sr-only" />
                <Users className="mb-2 h-6 w-6 text-green-500" />
                <span className="text-center">Đã nhận quà</span>
              </Label>
              <Label
                htmlFor="target-unreceived"
                className={`cursor-pointer flex flex-col items-center justify-between rounded-md border-2 p-4 hover:bg-muted ${target === 'no_received' ? 'border-primary bg-primary/5' : 'border-muted bg-transparent'}`}
              >
                <RadioGroupItem value="no_received" id="target-unreceived" className="sr-only" />
                <Users className="mb-2 h-6 w-6 text-yellow-500" />
                <span className="text-center">Chưa nhận quà</span>
              </Label>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <Label className="text-base" htmlFor="message">Nội dung tin nhắn</Label>
            <Textarea
              id="message"
              placeholder="Nhập nội dung tin nhắn gửi đi... (Hỗ trợ định dạng HTML cơ bản của Telegram)"
              className="min-h-[200px] resize-y"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3 text-yellow-800 dark:text-yellow-400">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold mb-1">Lưu ý khi gửi tin nhắn hàng loạt:</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>Quá trình gửi sẽ mất thời gian tùy thuộc vào số lượng người dùng.</li>
                <li>Không đóng trang web trong khi tác vụ gửi vừa được khởi tạo.</li>
                <li>Hạn chế gửi liên tục nhiều tin nhắn để tránh rủi ro cho Bot.</li>
              </ul>
            </div>
          </div>
        </CardContent>
        <CardFooter className="bg-muted/20 border-t border-border/50 py-4 flex justify-end">
          <Button size="lg" className="hover-elevate px-8" onClick={handleSend} disabled={broadcast.isPending}>
            {broadcast.isPending ? "Đang gửi..." : <><Send className="w-4 h-4 mr-2" /> Gửi Broadcast</>}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}