/**
 * product-guides.tsx — Quản lý hướng dẫn sản phẩm
 * Admin có thể thêm/sửa/xóa/bật-tắt guide cho từng sản phẩm.
 * AI Support sẽ tự động lấy guide này khi khách hỏi về sản phẩm.
 */
import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/hooks/use-toast"
import {
  BookOpen, Plus, Trash2, Pencil, X, Save, Power, ChevronDown, ChevronUp,
} from "lucide-react"

// ─── API helpers ──────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "")
const authHeader = () => ({
  Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}`,
  "Content-Type": "application/json",
})

interface ProductGuide {
  id: string
  product: string
  title?: string
  activation_guide?: string
  usage_guide?: string
  error_guide?: string
  warranty_guide?: string
  refund_note?: string
  enabled: boolean
  updated_at?: string
  created_at?: string
}

const EMPTY_FORM: Omit<ProductGuide, "id" | "enabled" | "updated_at" | "created_at"> & { id?: string; enabled?: boolean } = {
  product: "",
  title: "",
  activation_guide: "",
  usage_guide: "",
  error_guide: "",
  warranty_guide: "",
  refund_note: "",
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProductGuidesPage() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const [editId, setEditId] = useState<string | null>(null)   // null = list view, "new" = create, "<id>" = edit
  const [form, setForm] = useState<typeof EMPTY_FORM>({ ...EMPTY_FORM })
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const { data: guides = [], isLoading } = useQuery<ProductGuide[]>({
    queryKey: ["product-guides"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/bot/product-guides`, { headers: authHeader() })
      if (!res.ok) throw new Error("Không tải được danh sách guide")
      return res.json()
    },
  })

  // ── Save (create or update) ────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: typeof form & { id?: string; enabled?: boolean }) => {
      const res = await fetch(`${BASE}/api/bot/product-guides`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ ...data, enabled: data.enabled ?? true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? "Lưu thất bại")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-guides"] })
      toast({ title: "✅ Đã lưu", description: "Hướng dẫn sản phẩm đã được cập nhật" })
      setEditId(null)
      setForm({ ...EMPTY_FORM })
    },
    onError: (e: Error) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/api/bot/product-guides/${id}`, {
        method: "DELETE",
        headers: authHeader(),
      })
      if (!res.ok) throw new Error("Xóa thất bại")
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-guides"] })
      toast({ title: "🗑 Đã xóa", description: "Hướng dẫn sản phẩm đã được xóa" })
    },
    onError: (e: Error) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  // ── Toggle enabled ─────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${BASE}/api/bot/product-guides/${id}/toggle`, {
        method: "PATCH",
        headers: authHeader(),
      })
      if (!res.ok) throw new Error("Bật/tắt thất bại")
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product-guides"] })
    },
    onError: (e: Error) => {
      toast({ title: "❌ Lỗi", description: e.message, variant: "destructive" })
    },
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm({ ...EMPTY_FORM })
    setEditId("new")
  }

  const openEdit = (g: ProductGuide) => {
    setForm({
      id: g.id,
      product: g.product,
      title: g.title ?? "",
      activation_guide: g.activation_guide ?? "",
      usage_guide: g.usage_guide ?? "",
      error_guide: g.error_guide ?? "",
      warranty_guide: g.warranty_guide ?? "",
      refund_note: g.refund_note ?? "",
      enabled: g.enabled,
    })
    setEditId(g.id)
  }

  const cancelEdit = () => {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
  }

  const handleSave = () => {
    if (!form.product.trim()) {
      toast({ title: "⚠️ Thiếu tên sản phẩm", description: "Vui lòng nhập tên sản phẩm", variant: "destructive" })
      return
    }
    saveMutation.mutate(form)
  }

  const f = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }))

  // ─────────────────────────── Render ──────────────────────────────────────

  if (isLoading) return <div className="p-8 text-center animate-pulse text-muted-foreground">Đang tải...</div>

  // ── Edit / Create form ─────────────────────────────────────────────────────
  if (editId !== null) {
    const isNew = editId === "new"
    return (
      <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={cancelEdit} className="shrink-0">
            <X className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight">
              {isNew ? "Thêm hướng dẫn mới" : "Sửa hướng dẫn"}
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              AI sẽ tự động dùng nội dung này khi khách hỏi về sản phẩm
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Thông tin sản phẩm</CardTitle>
            <CardDescription>Tên sản phẩm dùng để AI nhận dạng — phải khớp với tên trong đơn hàng</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Tên sản phẩm <span className="text-red-500">*</span></Label>
              <Input
                value={form.product}
                onChange={f("product")}
                placeholder="vd: Gemini Pro 18 Tháng"
                className="min-h-[44px]"
              />
              <p className="text-xs text-muted-foreground">
                AI dùng partial match — nhập đúng phần tên đặc trưng của sản phẩm
              </p>
            </div>
            <div className="space-y-2">
              <Label>Tiêu đề ngắn (tuỳ chọn)</Label>
              <Input
                value={form.title}
                onChange={f("title")}
                placeholder="vd: Hướng dẫn Gemini Pro"
                className="min-h-[44px]"
              />
            </div>
            {!isNew && (
              <div className="flex items-center gap-3 pt-1">
                <Switch
                  checked={form.enabled ?? true}
                  onCheckedChange={v => setForm(p => ({ ...p, enabled: v }))}
                />
                <Label className="cursor-pointer">Bật guide này</Label>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Content fields */}
        {[
          { key: "activation_guide" as const, label: "Hướng dẫn kích hoạt", placeholder: "Bước 1: ...\nBước 2: ...\nBước 3: ...", desc: "Hiện khi khách hỏi cách kích hoạt / đăng nhập" },
          { key: "usage_guide"      as const, label: "Hướng dẫn sử dụng",   placeholder: "Mô tả cách dùng, các tính năng...", desc: "Hiện khi khách hỏi cách dùng sản phẩm" },
          { key: "error_guide"      as const, label: "Xử lý lỗi",           placeholder: "Nếu gặp lỗi X, hãy thử Y...\nNếu vẫn lỗi → dùng /support → Báo lỗi bảo hành", desc: "Hiện khi khách báo lỗi / không đăng nhập / rớt gói" },
          { key: "warranty_guide"   as const, label: "Hướng dẫn bảo hành",  placeholder: "Nếu tài khoản lỗi trong thời hạn BH, dùng /support → Báo lỗi bảo hành", desc: "Hiện khi khách hỏi về bảo hành" },
          { key: "refund_note"      as const, label: "Ghi chú hoàn tiền",   placeholder: "Hoàn tiền theo tỉ lệ số ngày còn lại...", desc: "AI dùng để giải thích chính sách hoàn tiền (không override công thức backend)" },
        ].map(({ key, label, placeholder, desc }) => (
          <Card key={key}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{label}</CardTitle>
              <CardDescription className="text-xs">{desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={(form[key] as string) ?? ""}
                onChange={f(key)}
                placeholder={placeholder}
                className="min-h-[120px] resize-y font-mono text-sm"
              />
            </CardContent>
          </Card>
        ))}

        <div className="flex gap-3 pb-6">
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            {saveMutation.isPending ? "Đang lưu..." : "Lưu"}
          </Button>
          <Button variant="outline" onClick={cancelEdit}>
            Huỷ
          </Button>
        </div>
      </div>
    )
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Product Guides</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Hướng dẫn sản phẩm — AI Support tự động dùng để trả lời khách hàng
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          Thêm hướng dẫn
        </Button>
      </div>

      {guides.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <div>
              <p className="font-medium text-muted-foreground">Chưa có hướng dẫn nào</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                Thêm hướng dẫn để AI tự động trả lời khách về từng sản phẩm
              </p>
            </div>
            <Button onClick={openCreate} variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              Thêm hướng dẫn đầu tiên
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {guides.map(g => {
            const isExpanded = expandedId === g.id
            const hasContent = [g.activation_guide, g.usage_guide, g.error_guide, g.warranty_guide, g.refund_note].some(Boolean)
            return (
              <Card key={g.id} className={!g.enabled ? "opacity-60" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base truncate">{g.product}</CardTitle>
                        <Badge variant={g.enabled ? "default" : "secondary"} className="text-xs shrink-0">
                          {g.enabled ? "Bật" : "Tắt"}
                        </Badge>
                        {[
                          g.activation_guide && "Kích hoạt",
                          g.error_guide      && "Xử lý lỗi",
                          g.warranty_guide   && "Bảo hành",
                        ].filter(Boolean).map(tag => (
                          <Badge key={tag as string} variant="outline" className="text-xs shrink-0">{tag}</Badge>
                        ))}
                      </div>
                      {g.title && <CardDescription className="mt-0.5">{g.title}</CardDescription>}
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        Cập nhật: {g.updated_at ? new Date(g.updated_at).toLocaleString("vi-VN") : "—"}
                      </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={g.enabled}
                        onCheckedChange={() => toggleMutation.mutate(g.id)}
                        title={g.enabled ? "Tắt guide" : "Bật guide"}
                      />
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => setExpandedId(isExpanded ? null : g.id)}
                        title="Xem nội dung"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => openEdit(g)}
                        title="Sửa"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" title="Xóa" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Xóa hướng dẫn?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Hướng dẫn <b>{g.product}</b> sẽ bị xóa vĩnh viễn.
                              AI sẽ không còn tự trả lời về sản phẩm này.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Huỷ</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(g.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Xóa
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardHeader>

                {/* Expandable content preview */}
                {isExpanded && hasContent && (
                  <CardContent className="pt-0 border-t">
                    <div className="space-y-3 mt-3">
                      {[
                        { label: "🚀 Kích hoạt",       val: g.activation_guide },
                        { label: "📖 Sử dụng",         val: g.usage_guide },
                        { label: "🔧 Xử lý lỗi",       val: g.error_guide },
                        { label: "🛡 Bảo hành",        val: g.warranty_guide },
                        { label: "💰 Hoàn tiền",       val: g.refund_note },
                      ].filter(x => x.val).map(({ label, val }) => (
                        <div key={label} className="space-y-1">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                          <pre className="text-sm whitespace-pre-wrap font-sans bg-muted/40 rounded-md p-3 leading-relaxed">
                            {val}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}

                {isExpanded && !hasContent && (
                  <CardContent className="pt-0 border-t">
                    <p className="text-sm text-muted-foreground italic mt-3">Chưa có nội dung nào.</p>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
