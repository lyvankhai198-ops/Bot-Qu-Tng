import { useState, useEffect, useRef } from "react"
import { useGetIntro, useUpdateIntro, getGetIntroQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Save, Plus, Trash2, LayoutTemplate, Link2 } from "lucide-react"
import type { IntroConfig, IntroConfigButtonsItem } from "@workspace/api-client-react"

function BotIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" /><path d="M20 14h2" />
      <path d="M15 13v2" /><path d="M9 13v2" />
    </svg>
  )
}

export default function IntroConfigPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  const { data: intro, isLoading } = useGetIntro({ query: { queryKey: getGetIntroQueryKey() } })
  const updateIntro = useUpdateIntro({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetIntroQueryKey(), data)
        toast({ title: "Thành công", description: "Đã lưu cấu hình Intro" })
      }
    }
  })

  const [form, setForm] = useState<IntroConfig>({
    title: "", content: "", photoUrl: "", videoUrl: "", buttons: []
  })
  const initialized = useRef(false)

  useEffect(() => {
    if (intro && !initialized.current) {
      setForm(intro)
      initialized.current = true
    }
  }, [intro])

  const handleSave = () => updateIntro.mutate({ data: form })

  const addButton = () => setForm({ ...form, buttons: [...(form.buttons || []), { text: "", url: "" }] })

  const removeButton = (index: number) => {
    const newButtons = [...(form.buttons || [])]
    newButtons.splice(index, 1)
    setForm({ ...form, buttons: newButtons })
  }

  const updateButton = (index: number, field: keyof IntroConfigButtonsItem, value: string) => {
    const newButtons = [...(form.buttons || [])]
    newButtons[index] = { ...newButtons[index], [field]: value }
    setForm({ ...form, buttons: newButtons })
  }

  if (isLoading) return <div className="p-8 text-center animate-pulse">Đang tải...</div>

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Cấu hình Intro</h1>
        <p className="text-muted-foreground mt-1 text-sm">Giao diện tin nhắn chào mừng (Welcome message)</p>
      </div>

      {/* Editor + Preview: stack on mobile, side-by-side on lg */}
      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">

        {/* Editor side */}
        <div className="flex-1 space-y-4 md:space-y-6 w-full min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Nội dung chính</CardTitle>
              <CardDescription>Tiêu đề và văn bản hiển thị khi người dùng /start</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Tiêu đề in đậm</Label>
                <Input
                  value={form.title || ""}
                  onChange={e => setForm({...form, title: e.target.value})}
                  placeholder="🎉 CHÀO MỪNG BẠN..."
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label>Nội dung chi tiết</Label>
                <Textarea
                  value={form.content || ""}
                  onChange={e => setForm({...form, content: e.target.value})}
                  className="min-h-[150px]"
                  placeholder="Nhập thông tin giới thiệu bot..."
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Media đính kèm</CardTitle>
              <CardDescription>Cung cấp link Ảnh hoặc Video (Telegram URL ưu tiên)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL Ảnh (Image)</Label>
                <Input
                  value={form.photoUrl || ""}
                  onChange={e => setForm({...form, photoUrl: e.target.value})}
                  placeholder="https://..."
                  className="min-h-[44px]"
                />
              </div>
              <div className="space-y-2">
                <Label>URL Video</Label>
                <Input
                  value={form.videoUrl || ""}
                  onChange={e => setForm({...form, videoUrl: e.target.value})}
                  placeholder="https://..."
                  className="min-h-[44px]"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>Nút bấm (Inline Buttons)</CardTitle>
                  <CardDescription>Các nút liên kết ngoài đặt dưới tin nhắn</CardDescription>
                </div>
                <Button onClick={addButton} variant="outline" size="sm" className="shrink-0 min-h-[44px]">
                  <Plus className="w-4 h-4 mr-1" /> Thêm nút
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {(!form.buttons || form.buttons.length === 0) ? (
                <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed rounded-lg">
                  Chưa có nút bấm nào. Hãy thêm nút để hướng dẫn người dùng.
                </div>
              ) : (
                <div className="space-y-3">
                  {form.buttons.map((btn: IntroConfigButtonsItem, i: number) => (
                    <div key={i} className="bg-muted/20 p-3 rounded-md border space-y-3">
                      {/* Single column on mobile, two columns on sm+ */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Tên nút</Label>
                          <Input
                            value={btn.text || ""}
                            onChange={e => updateButton(i, 'text', e.target.value)}
                            placeholder="VD: Vào nhóm"
                            className="h-10 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Link URL</Label>
                          <div className="relative">
                            <Link2 className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              value={btn.url || ""}
                              onChange={e => updateButton(i, 'url', e.target.value)}
                              placeholder="https://..."
                              className="h-10 text-sm pl-8"
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 min-h-[44px]"
                          onClick={() => removeButton(i)}
                        >
                          <Trash2 className="w-4 h-4 mr-1" /> Xóa nút
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="pb-4">
            <Button
              size="lg"
              className="w-full sm:w-auto min-h-[48px] px-8"
              onClick={handleSave}
              disabled={updateIntro.isPending}
            >
              {updateIntro.isPending ? "Đang lưu..." : <><Save className="w-4 h-4 mr-2" /> Lưu cấu hình Intro</>}
            </Button>
          </div>
        </div>

        {/* Preview pane — shows below editor on mobile */}
        <div className="w-full lg:w-80 shrink-0 lg:sticky lg:top-24">
          <div className="bg-[#EBEBEB] dark:bg-[#0F0F0F] rounded-[30px] p-3 shadow-2xl border-4 border-muted relative max-w-sm mx-auto lg:max-w-none">
            <div className="absolute top-0 inset-x-0 h-4 flex justify-center">
              <div className="w-20 h-4 bg-muted rounded-b-xl"></div>
            </div>
            <div className="bg-blue-50/50 dark:bg-slate-900/50 rounded-[20px] h-[480px] lg:h-[560px] overflow-hidden flex flex-col">
              <div className="bg-white/80 dark:bg-black/80 backdrop-blur-md h-12 flex items-center px-4 border-b border-black/5 dark:border-white/5 shrink-0 z-10 pt-2">
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center mr-3">
                  <BotIcon className="w-5 h-5 text-primary" />
                </div>
                <div className="font-semibold text-sm">Bot Quà Tặng AI</div>
              </div>
              <div className="flex-1 p-4 overflow-y-auto flex flex-col justify-end space-y-2">
                <div className="bg-white dark:bg-slate-800 rounded-2xl rounded-bl-sm p-1 shadow-sm max-w-[90%] self-start border border-black/5 dark:border-white/5 overflow-hidden">
                  {form.photoUrl && (
                    <img
                      src={form.photoUrl}
                      alt="Preview"
                      className="w-full h-28 object-cover bg-muted rounded-t-xl"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  {form.videoUrl && !form.photoUrl && (
                    <div className="w-full h-28 bg-muted flex items-center justify-center rounded-t-xl">
                      <span className="text-xs text-muted-foreground">Video Preview</span>
                    </div>
                  )}
                  <div className="p-3 text-sm space-y-2">
                    {form.title && <div className="font-bold text-sm">{form.title}</div>}
                    {form.content && <div className="whitespace-pre-wrap text-xs">{form.content}</div>}
                    {!form.title && !form.content && (
                      <div className="text-muted-foreground italic text-xs">Văn bản intro...</div>
                    )}
                  </div>
                </div>
                {form.buttons && form.buttons.length > 0 && (
                  <div className="flex flex-col gap-1 w-full max-w-[90%]">
                    {form.buttons.map((btn, i) => (
                      <div key={i} className="bg-white/80 dark:bg-slate-800/80 backdrop-blur border border-black/5 dark:border-white/5 rounded-xl py-2 px-4 text-center text-primary font-medium text-xs shadow-sm">
                        {btn.text || "Button"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1">
            <LayoutTemplate className="w-3 h-3" /> Bản xem trước (Mô phỏng)
          </p>
        </div>
      </div>
    </div>
  )
}
