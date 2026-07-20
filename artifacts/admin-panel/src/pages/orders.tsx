import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import ImageImportDialog from "@/components/ImageImportDialog"
import XlsxImportDialog from "@/components/XlsxImportDialog"
import { useListOrders, useCreateOrder, useUpdateOrder, useDeleteOrder, useBulkCreateOrders, getListOrdersQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Search, Plus, Edit2, Trash2, ListPlus, CheckCircle2, AlertCircle, Camera,
  FileSpreadsheet, Stethoscope, Loader2, Activity, RefreshCw, Clock,
  XCircle, HelpCircle, PackageX, KeyRound, ShieldOff, Lock, Mail, Phone, Bot, Wifi, Timer,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { OrderInput, Order, BulkOrderResult } from "@workspace/api-client-react"
import { format } from "date-fns"

// ── Auth helper ───────────────────────────────────────────────────────────────
function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}
async function apiFetch(method: string, path: string, body?: unknown): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { ...authHeader(), "Content-Type": "application/json" },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(`/api${path}`, opts)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Status / Health helpers ───────────────────────────────────────────────────
const statusLabel = (s?: string) => ({ active: "Hoạt động", expired: "Hết hạn", refunded: "Hoàn tiền" }[s || ""] || s || "-")
const statusVariant = (s?: string): "default" | "secondary" | "destructive" =>
  s === "active" ? "default" : s === "expired" ? "secondary" : "destructive"

type ResultCode = "ACTIVE"|"PACKAGE_LOST"|"PASSWORD_INVALID"|"ACCOUNT_BANNED"|"ACCOUNT_LOCKED"|"REQUIRE_EMAIL"|"REQUIRE_PHONE"|"CAPTCHA"|"NETWORK_ERROR"|"TIMEOUT"|"NO_PLUGIN"|"UNKNOWN"|"UNCHECKED"

const CODE_DISPLAY: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  ACTIVE:           { label: "Hoạt động",         icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300 border-green-200" },
  PACKAGE_LOST:     { label: "Mất gói",            icon: <PackageX className="h-3 w-3" />,    cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  PASSWORD_INVALID: { label: "Sai mật khẩu",       icon: <KeyRound className="h-3 w-3" />,    cls: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  ACCOUNT_BANNED:   { label: "Bị cấm",             icon: <ShieldOff className="h-3 w-3" />,   cls: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  ACCOUNT_LOCKED:   { label: "Bị khóa",            icon: <Lock className="h-3 w-3" />,        cls: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-200" },
  REQUIRE_EMAIL:    { label: "Cần email",           icon: <Mail className="h-3 w-3" />,        cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200" },
  REQUIRE_PHONE:    { label: "Cần SĐT",             icon: <Phone className="h-3 w-3" />,       cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300 border-yellow-200" },
  CAPTCHA:          { label: "CAPTCHA",             icon: <Bot className="h-3 w-3" />,         cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  NETWORK_ERROR:    { label: "Lỗi mạng",            icon: <Wifi className="h-3 w-3" />,        cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  TIMEOUT:          { label: "Timeout",             icon: <Timer className="h-3 w-3" />,       cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200" },
  NO_PLUGIN:        { label: "Chưa hỗ trợ",         icon: <AlertCircle className="h-3 w-3" />, cls: "bg-muted text-muted-foreground border-border" },
  UNKNOWN:          { label: "Không xác định",      icon: <HelpCircle className="h-3 w-3" />, cls: "bg-muted text-muted-foreground border-border" },
  UNCHECKED:        { label: "Chưa kiểm tra",       icon: <HelpCircle className="h-3 w-3" />, cls: "bg-muted text-muted-foreground border-border" },
}

function HealthBadge({ code }: { code: string }) {
  const d = CODE_DISPLAY[code] ?? CODE_DISPLAY.UNKNOWN
  return (
    <Badge className={`gap-1 text-xs font-medium border ${d.cls} hover:opacity-90`}>
      {d.icon} {d.label}
    </Badge>
  )
}

type HealthEntry = {
  checkedAt: string
  code: ResultCode
  message: string
  responseTime: number | null
  plugin: string
  playwrightLog?: string
}

function fmtDate(iso?: string | null) {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString("vi-VN", { hour12: false }) } catch { return iso }
}
function fmtMs(ms: number | null) {
  if (ms == null) return "—"
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ── Health Tab (inside order edit modal) ──────────────────────────────────────
function HealthTab({ orderId, email }: { orderId: string; email: string }) {
  const { toast } = useToast()
  const [history, setHistory] = useState<HealthEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [expandedLog, setExpandedLog] = useState<number | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch("GET", `/bot/orders/${orderId}/health`)
      setHistory(data ?? [])
    } catch {
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (!orderId) return
    loadHistory()
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [orderId, loadHistory])

  const stopPolling = () => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null }
    setChecking(false)
  }

  const handleCheck = async () => {
    setChecking(true)
    try {
      await apiFetch("POST", "/bot/order-health/check", { orderId })
      // Poll jobs until ours is done
      pollingRef.current = setInterval(async () => {
        try {
          const jobs = await apiFetch("GET", `/bot/order-health/jobs?orderId=${orderId}`)
          const active = jobs.some((j: any) => j.status === "queued" || j.status === "running")
          if (!active) {
            stopPolling()
            await loadHistory()
          }
        } catch { stopPolling() }
      }, 2_000)
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
      setChecking(false)
    }
  }

  const latest = history[0]

  return (
    <div className="space-y-4 py-2">
      {/* Latest status */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Trạng thái hiện tại</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={handleCheck}
            disabled={checking}
          >
            {checking
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang kiểm tra...</>
              : <><RefreshCw className="h-3.5 w-3.5" /> Kiểm tra lại</>
            }
          </Button>
        </div>
        {latest ? (
          <div className="space-y-1.5">
            <HealthBadge code={latest.code} />
            <p className="text-sm">{latest.message}</p>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>🕐 {fmtDate(latest.checkedAt)}</span>
              {latest.responseTime != null && <span>⏱ {fmtMs(latest.responseTime)}</span>}
              {latest.plugin && <span>🔌 {latest.plugin}</span>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {loading ? "Đang tải..." : "Chưa có kết quả kiểm tra. Bấm \"Kiểm tra lại\" để bắt đầu."}
          </p>
        )}
      </div>

      {/* History list */}
      {history.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Lịch sử ({history.length} lần)</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {history.slice(1).map((e, i) => (
              <div key={i} className="rounded-lg border bg-card p-3 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <HealthBadge code={e.code} />
                  <span className="text-xs text-muted-foreground ml-auto">{fmtDate(e.checkedAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{e.message}</p>
                {e.responseTime != null && <p className="text-xs text-muted-foreground">⏱ {fmtMs(e.responseTime)}</p>}
                {e.playwrightLog && (
                  <div>
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => setExpandedLog(expandedLog === i ? null : i)}
                    >
                      {expandedLog === i ? "Ẩn nhật ký" : "Nhật ký Playwright"}
                    </button>
                    {expandedLog === i && (
                      <pre className="mt-1 text-xs bg-muted rounded p-2 max-h-32 overflow-y-auto font-mono whitespace-pre-wrap">{e.playwrightLog}</pre>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
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
  const [activeTab, setActiveTab] = useState<"info" | "health">("info")
  const [grokCookieInput, setGrokCookieInput] = useState("")
  const [cookieSaving, setCookieSaving] = useState(false)

  // ── Health check state ────────────────────────────────────────────────────
  // activeJobMap: orderId → true (has active job)
  const [activeJobMap, setActiveJobMap] = useState<Record<string, boolean>>({})
  // orderHealthMap: orderId → healthCode (latest)
  const [orderHealthMap, setOrderHealthMap] = useState<Record<string, string>>({})
  const [checkingAll, setCheckingAll] = useState(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadOrderHealth = useCallback(async () => {
    try {
      const data = await apiFetch("GET", "/bot/order-health")
      const map: Record<string, string> = {}
      for (const o of (data.orders ?? [])) {
        map[o.orderId] = o.healthCode
      }
      setOrderHealthMap(map)
    } catch {}
  }, [])

  const pollJobs = useCallback(async () => {
    try {
      const jobs = await apiFetch("GET", "/bot/order-health/jobs?status=queued,running")
      const map: Record<string, boolean> = {}
      for (const j of jobs) map[j.orderId] = true
      setActiveJobMap(map)
      return jobs.length > 0
    } catch { return false }
  }, [])

  const startPolling = useCallback(() => {
    if (pollingRef.current) return
    pollingRef.current = setInterval(async () => {
      const hasActive = await pollJobs()
      if (!hasActive) {
        clearInterval(pollingRef.current!)
        pollingRef.current = null
        setCheckingAll(false)
        setActiveJobMap({})
        loadOrderHealth()
      }
    }, 3_000)
  }, [pollJobs, loadOrderHealth])

  useEffect(() => {
    loadOrderHealth()
    // Check if there are already active jobs
    pollJobs().then(hasActive => { if (hasActive) startPolling() })
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  const filteredOrders = useMemo(() => {
    if (!orders) return []
    return orders.filter(o => {
      const matchSearch = (o.email || "").toLowerCase().includes(search.toLowerCase()) ||
                          (o.orderId || "").toLowerCase().includes(search.toLowerCase()) ||
                          (o.productName || "").toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === "all" || o.status === filterStatus
      return matchSearch && matchStatus
    })
  }, [orders, search, filterStatus])

  const handleOpenAdd = () => {
    setCurrentOrder({ status: "active" })
    setActiveTab("info")
    setDialogOpen("add")
  }

  const handleOpenEdit = (order: Order) => {
    setCurrentOrder({ ...order })
    setActiveTab("info")
    setGrokCookieInput("")
    setDialogOpen("edit")
  }

  const handleSaveCookie = async () => {
    if (!currentOrder.orderId || !grokCookieInput.trim()) return
    setCookieSaving(true)
    try {
      const data = await apiFetch("PUT", `/bot/orders/${currentOrder.orderId}/grok-cookie`, { cookie: grokCookieInput.trim() })
      setCurrentOrder(prev => ({ ...prev, grokSessionCookieSavedAt: data.savedAt } as any))
      setGrokCookieInput("")
      toast({ title: "Đã lưu cookie", description: "Health check sẽ dùng cookie này (không cần Playwright)" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setCookieSaving(false) }
  }

  const handleClearCookie = async () => {
    if (!currentOrder.orderId) return
    setCookieSaving(true)
    try {
      await apiFetch("PUT", `/bot/orders/${currentOrder.orderId}/grok-cookie`, { cookie: "" })
      setCurrentOrder(prev => { const o = { ...prev } as any; delete o.grokSessionCookie; o.grokSessionCookieSavedAt = null; return o })
      toast({ title: "Đã xóa cookie" })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setCookieSaving(false) }
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
        password: (currentOrder as any).password || undefined,
        twoFA: (currentOrder as any).twoFA || undefined,
      }
      if (dialogMode === "add") {
        await createOrder.mutateAsync({ data: payload })
        toast({ title: "Thành công", description: "Đã thêm đơn hàng" })
      } else if (dialogMode === "edit" && currentOrder.orderId) {
        await updateOrder.mutateAsync({ orderId: currentOrder.orderId, data: payload })
        toast({ title: "Thành công", description: "Đã cập nhật đơn hàng" })
      }
      setDialogOpen(null)
    } catch {
      toast({ title: "Lỗi", description: "Không thể lưu đơn hàng", variant: "destructive" })
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteOrder.mutateAsync({ orderId: deleteId })
      toast({ title: "Thành công", description: "Đã xóa đơn hàng" })
      setDeleteId(null)
    } catch {
      toast({ title: "Lỗi", description: "Không thể xóa", variant: "destructive" })
    }
  }

  const handleCheckOrder = async (orderId: string) => {
    setActiveJobMap(prev => ({ ...prev, [orderId]: true }))
    try {
      await apiFetch("POST", "/bot/order-health/check", { orderId })
      startPolling()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
      setActiveJobMap(prev => { const n = {...prev}; delete n[orderId]; return n })
    }
  }

  const handleCheckAll = async () => {
    setCheckingAll(true)
    try {
      const res = await apiFetch("POST", "/bot/order-health/check", {})
      toast({ title: `Đã thêm ${res.queued} đơn vào hàng đợi kiểm tra` })
      await pollJobs()
      startPolling()
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
      setCheckingAll(false)
    }
  }

  const formatCurrency = (val?: number | null) => val ? new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val) : "-"
  const formatDate = (val?: string | null) => val ? format(new Date(val), 'dd/MM/yyyy') : "-"

  // ── Bulk add ────────────────────────────────────────────────────────────────
  const BULK_LS_KEY = "bot_bulk_order_defaults"
  const bulkCreateOrders = useBulkCreateOrders({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }) } })

  const todayStr = () => new Date().toISOString().split("T")[0]
  const addDays = (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split("-").map(Number)
    const dt = new Date(y, m - 1, d + days)
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`
  }

  const [imgOpen, setImgOpen] = useState(false)
  const [xlsxOpen, setXlsxOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bProd, setBProd] = useState("")
  const [bPrice, setBPrice] = useState("")
  const [bPurchaseDate, setBPurchaseDate] = useState(todayStr())
  const [bUsageDays, setBUsageDays] = useState("")
  const [bWarrDays, setBWarrDays] = useState("")
  const [bNotes, setBNotes] = useState("")
  const [bText, setBText] = useState("")
  const [bValidation, setBValidation] = useState<{
    totalLines: number
    valid: { email: string; password: string; twoFA: string; lineNum: number }[]
    errors: { lineNum: number; email: string; reason: string }[]
  } | null>(null)
  const [bResult, setBResult] = useState<BulkOrderResult | null>(null)
  const [bSaving, setBSaving] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(BULK_LS_KEY) || "{}")
      if (saved.productName) setBProd(saved.productName)
      if (saved.price) setBPrice(String(saved.price))
      if (saved.usageDays) setBUsageDays(String(saved.usageDays))
      if (saved.warrantyDays) setBWarrDays(String(saved.warrantyDays))
    } catch {}
  }, [])

  const saveDefaults = (prod: string, price: string, uDays: string, wDays: string) => {
    try {
      localStorage.setItem(BULK_LS_KEY, JSON.stringify({ productName: prod, price, usageDays: uDays, warrantyDays: wDays }))
    } catch {}
  }

  const bLineCount = bText.split("\n").filter(l => l.trim()).length

  const validateBulk = () => {
    const existingEmails = new Set((orders || []).map(o => (o.email || "").toLowerCase()))
    const lines = bText.split("\n").map(l => l.trim()).filter(l => l)
    const valid: { email: string; password: string; twoFA: string; lineNum: number }[] = []
    const errors: { lineNum: number; email: string; reason: string }[] = []
    const seenInBatch = new Map<string, number>()

    lines.forEach((line, idx) => {
      const lineNum = idx + 1
      const parts = line.split("|")
      const email = (parts[0] || "").trim()
      if (!email) { errors.push({ lineNum, email: "(trống)", reason: "Thiếu email" }); return }
      const emailLower = email.toLowerCase()
      if (existingEmails.has(emailLower)) { errors.push({ lineNum, email, reason: "Email đã tồn tại trong hệ thống" }); return }
      if (seenInBatch.has(emailLower)) { errors.push({ lineNum, email, reason: `Trùng với dòng ${seenInBatch.get(emailLower)}` }); return }
      seenInBatch.set(emailLower, lineNum)
      valid.push({ email, password: (parts[1] || "").trim(), twoFA: (parts[2] || "").trim(), lineNum })
    })

    return { totalLines: lines.length, valid, errors }
  }

  const handleBulkValidate = () => { setBValidation(validateBulk()); setBResult(null) }

  const handleBulkSave = async (validOnly?: { email: string; password: string; twoFA: string; lineNum: number }[]) => {
    if (!bProd) { toast({ title: "Lỗi", description: "Vui lòng nhập tên sản phẩm", variant: "destructive" }); return }
    const validation = bValidation || validateBulk()
    if (!bValidation) setBValidation(validation)
    const accounts = validOnly ?? validation.valid
    if (accounts.length === 0) { toast({ title: "Không có tài khoản hợp lệ", description: "Kiểm tra lại danh sách", variant: "destructive" }); return }

    const uDays = Number(bUsageDays) || 0
    const wDays = Number(bWarrDays) || 0
    const expiryDate = uDays > 0 ? addDays(bPurchaseDate, uDays) : undefined
    const warrantyExpiry = wDays > 0 ? addDays(bPurchaseDate, wDays) : undefined

    setBSaving(true)
    try {
      const result = await bulkCreateOrders.mutateAsync({
        data: {
          productName: bProd,
          price: bPrice ? Number(bPrice) : undefined,
          purchaseDate: bPurchaseDate,
          expiryDate: expiryDate ?? null,
          warrantyExpiry: warrantyExpiry ?? null,
          usagePeriod: bUsageDays ? `${bUsageDays} ngày` : null,
          warrantyPeriod: bWarrDays ? `${bWarrDays} ngày` : null,
          notes: bNotes || null,
          accounts: accounts.map(a => ({ email: a.email, password: a.password || null, twoFA: a.twoFA || null })),
        }
      })
      saveDefaults(bProd, bPrice, bUsageDays, bWarrDays)
      setBResult(result)
      setBValidation(null)
      setBText("")
    } catch {
      toast({ title: "Lỗi", description: "Không thể lưu đơn hàng hàng loạt", variant: "destructive" })
    } finally { setBSaving(false) }
  }

  const resetBulk = () => { setBText(""); setBValidation(null); setBResult(null); setBSaving(false) }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Đơn hàng</h1>
          <p className="text-muted-foreground mt-1 text-sm">Quản lý giao dịch mua bán</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button variant="outline" onClick={() => setXlsxOpen(true)} className="w-full sm:w-auto min-h-[44px]">
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Nhập từ XLSX
          </Button>
          <Button variant="outline" onClick={() => setImgOpen(true)} className="w-full sm:w-auto min-h-[44px]">
            <Camera className="w-4 h-4 mr-2" /> Thêm từ ảnh
          </Button>
          <Button variant="outline" onClick={() => { resetBulk(); setBPurchaseDate(todayStr()); setBulkOpen(true) }} className="w-full sm:w-auto min-h-[44px]">
            <ListPlus className="w-4 h-4 mr-2" /> Thêm hàng loạt
          </Button>
          <Button
            variant="outline"
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="w-full sm:w-auto min-h-[44px] gap-2"
          >
            {checkingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Stethoscope className="w-4 h-4" />}
            Kiểm tra tất cả
          </Button>
          <Button onClick={handleOpenAdd} className="w-full sm:w-auto min-h-[44px]">
            <Plus className="w-4 h-4 mr-2" /> Thêm đơn hàng
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Filter bar */}
          <div className="flex flex-col gap-3 p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm mã đơn, email, sản phẩm..."
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
                      {activeJobMap[order.orderId] ? (
                        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 gap-1 self-start">
                          <Loader2 className="h-3 w-3 animate-spin" /> Kiểm tra
                        </Badge>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-10 w-10" title="Kiểm tra"
                          onClick={() => handleCheckOrder(order.orderId)}>
                          <Stethoscope className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      )}
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
                    {orderHealthMap[order.orderId] && <HealthBadge code={orderHealthMap[order.orderId]} />}
                    <span className="text-sm font-medium">{formatCurrency(order.price)}</span>
                    {order.warrantyExpiry && (
                      <span className="text-xs text-muted-foreground ml-auto">BH: {formatDate(order.warrantyExpiry)}</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">Không tìm thấy đơn hàng.</div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Email khách hàng</TableHead>
                  <TableHead>Giá bán</TableHead>
                  <TableHead>Hết hạn BH</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Health Check</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredOrders.length > 0 ? (
                  filteredOrders.map(order => (
                    <TableRow key={order.orderId} className={activeJobMap[order.orderId] ? "bg-blue-50/20 dark:bg-blue-950/10" : ""}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{(order.orderId || "").slice(0, 8)}...</TableCell>
                      <TableCell className="font-medium">{order.productName}</TableCell>
                      <TableCell className="font-mono text-sm">{order.email}</TableCell>
                      <TableCell>{formatCurrency(order.price)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(order.warrantyExpiry)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        {activeJobMap[order.orderId] ? (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Đang kiểm
                          </Badge>
                        ) : orderHealthMap[order.orderId] ? (
                          <HealthBadge code={orderHealthMap[order.orderId]} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Kiểm tra"
                            disabled={!!activeJobMap[order.orderId]}
                            onClick={() => handleCheckOrder(order.orderId)}>
                            {activeJobMap[order.orderId]
                              ? <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                              : <Stethoscope className="w-4 h-4 text-muted-foreground hover:text-primary" />
                            }
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenEdit(order)}>
                            <Edit2 className="w-4 h-4 text-muted-foreground hover:text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(order.orderId)}>
                            <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy đơn hàng.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit / Add Dialog with tabs */}
      <Dialog open={!!dialogMode} onOpenChange={(open) => !open && setDialogOpen(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[600px] max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogMode === "add" ? "Thêm đơn hàng" : "Chỉnh sửa đơn hàng"}</DialogTitle>
          </DialogHeader>

          {/* Tabs (only show health tab on edit mode) */}
          {dialogMode === "edit" && (
            <div className="flex gap-1 border-b border-border">
              <button
                onClick={() => setActiveTab("info")}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === "info"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Thông tin
              </button>
              <button
                onClick={() => setActiveTab("health")}
                className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  activeTab === "health"
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                Health Check
                {currentOrder.orderId && orderHealthMap[currentOrder.orderId] && orderHealthMap[currentOrder.orderId] !== "UNCHECKED" && (
                  <span className={`inline-block w-2 h-2 rounded-full ml-0.5 ${
                    orderHealthMap[currentOrder.orderId] === "ACTIVE" ? "bg-green-500" : "bg-red-500"
                  }`} />
                )}
              </button>
            </div>
          )}

          {/* Info tab */}
          {(activeTab === "info" || dialogMode === "add") && (
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
              {/* ── Thông tin đăng nhập (dùng cho Health Check) ────────── */}
              <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3 grid gap-3">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" /> Thông tin đăng nhập tài khoản (Health Check)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-xs">Mật khẩu đăng nhập</Label>
                    <Input
                      type="password"
                      placeholder="Nhập mật khẩu tài khoản..."
                      value={(currentOrder as any).password || ""}
                      onChange={e => setCurrentOrder({...currentOrder, password: e.target.value} as any)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-xs">Mã 2FA / thông tin bổ sung</Label>
                    <Input
                      placeholder="Mã 2FA (nếu có)..."
                      value={(currentOrder as any).twoFA || ""}
                      onChange={e => setCurrentOrder({...currentOrder, twoFA: e.target.value} as any)}
                    />
                  </div>
                </div>

                {/* ── Session Cookie (Grok bypass Cloudflare) ───────────── */}
                {dialogMode === "edit" && (
                  <div className="grid gap-2 pt-1">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5 text-blue-500" />
                        Session Cookie <span className="text-muted-foreground font-normal ml-1">(Grok — bypass Cloudflare)</span>
                      </Label>
                      {(currentOrder as any).grokSessionCookieSavedAt ? (
                        <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800">
                          ✓ Cookie đã lưu
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          Chưa có cookie
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Đăng nhập <strong>grok.com</strong> trên trình duyệt → F12 → Application → Cookies → copy giá trị <code className="bg-muted px-1 rounded">__Secure-next-auth.session-token</code> (hoặc dán cả Cookie header).
                    </p>
                    <Textarea
                      rows={2}
                      placeholder="Dán cookie vào đây... (VD: __Secure-next-auth.session-token=eyJ...)"
                      value={grokCookieInput}
                      onChange={e => setGrokCookieInput(e.target.value)}
                      className="font-mono text-xs resize-none"
                    />
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        size="sm" variant="outline"
                        onClick={handleSaveCookie}
                        disabled={cookieSaving || !grokCookieInput.trim()}
                        className="text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-700"
                      >
                        {cookieSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <KeyRound className="h-3.5 w-3.5 mr-1" />}
                        Lưu Cookie
                      </Button>
                      {(currentOrder as any).grokSessionCookieSavedAt && (
                        <Button
                          size="sm" variant="ghost"
                          onClick={handleClearCookie}
                          disabled={cookieSaving}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" /> Xóa Cookie
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <DialogFooter className="flex-col sm:flex-row gap-2 pt-0">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogOpen(null)}>Hủy</Button>
                <Button className="w-full sm:w-auto" onClick={handleSave} disabled={createOrder.isPending || updateOrder.isPending}>
                  {createOrder.isPending || updateOrder.isPending ? "Đang lưu..." : "Lưu"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Health tab */}
          {activeTab === "health" && dialogMode === "edit" && currentOrder.orderId && (
            <HealthTab orderId={currentOrder.orderId} email={currentOrder.email ?? ""} />
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bulk Add Dialog ─────────────────────────────────────────────── */}
      <Dialog open={bulkOpen} onOpenChange={(open) => { if (!open) setBulkOpen(false) }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-[640px] max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5" /> Thêm đơn hàng hàng loạt
            </DialogTitle>
            <DialogDescription>Điền thông tin chung, sau đó dán danh sách tài khoản.</DialogDescription>
          </DialogHeader>

          {bResult ? (
            <div className="space-y-4 py-2">
              <div className={`rounded-lg p-4 flex items-start gap-3 ${bResult.skipped > 0 ? "bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800" : "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"}`}>
                {bResult.skipped > 0 ? <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />}
                <div>
                  <p className="font-semibold text-sm">Đã thêm thành công {bResult.added}/{bResult.added + bResult.skipped} đơn hàng.</p>
                  <p className="text-sm text-muted-foreground mt-1">{bResult.added} thành công · {bResult.skipped} bị bỏ qua</p>
                </div>
              </div>
              {bResult.errors.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Danh sách lỗi:</p>
                  {bResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-destructive font-mono">{e.email}: {e.reason}</p>
                  ))}
                </div>
              )}
              <Button className="w-full min-h-[44px]" onClick={() => setBulkOpen(false)}>Đóng</Button>
            </div>
          ) : (
            <>
              <div className="grid gap-3 py-2">
                <div className="grid gap-1.5">
                  <Label>Sản phẩm *</Label>
                  <Input value={bProd} onChange={e => setBProd(e.target.value)} placeholder="VD: Grok Super" className="min-h-[44px]" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Giá bán (VNĐ)</Label>
                    <Input type="number" value={bPrice} onChange={e => setBPrice(e.target.value)} placeholder="0" className="min-h-[44px]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Ngày mua</Label>
                    <Input type="date" value={bPurchaseDate} onChange={e => setBPurchaseDate(e.target.value)} className="min-h-[44px]" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Số ngày sử dụng</Label>
                    <Input type="number" value={bUsageDays} onChange={e => setBUsageDays(e.target.value)} placeholder="30" className="min-h-[44px]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Số ngày bảo hành</Label>
                    <Input type="number" value={bWarrDays} onChange={e => setBWarrDays(e.target.value)} placeholder="7" className="min-h-[44px]" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>Ghi chú chung</Label>
                  <Input value={bNotes} onChange={e => setBNotes(e.target.value)} placeholder="(tùy chọn)" className="min-h-[44px]" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Danh sách tài khoản</Label>
                  <Textarea
                    value={bText}
                    onChange={e => { setBText(e.target.value); setBValidation(null) }}
                    placeholder={"email|password|2fa\naccount1@gmail.com|pass123|ABCDEF\naccount2@gmail.com|pass456"}
                    className="font-mono text-xs min-h-[180px] sm:min-h-[200px] resize-y"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">{bLineCount > 0 ? `${bLineCount} tài khoản` : "Mỗi dòng một tài khoản. Định dạng: email | email|mật khẩu | email|mật khẩu|2fa"}</p>
                </div>

                {bValidation && (
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                      <div className="rounded-md bg-background p-2">
                        <p className="text-lg font-bold">{bValidation.totalLines}</p>
                        <p className="text-xs text-muted-foreground">Tổng dòng</p>
                      </div>
                      <div className="rounded-md bg-background p-2">
                        <p className="text-lg font-bold text-green-600">{bValidation.valid.length}</p>
                        <p className="text-xs text-muted-foreground">Hợp lệ</p>
                      </div>
                      <div className="rounded-md bg-background p-2">
                        <p className="text-lg font-bold text-destructive">{bValidation.errors.length}</p>
                        <p className="text-xs text-muted-foreground">Lỗi / trùng</p>
                      </div>
                      <div className="rounded-md bg-background p-2">
                        <p className="text-lg font-bold text-yellow-600">{bValidation.errors.filter(e => e.reason.startsWith("Trùng")).length}</p>
                        <p className="text-xs text-muted-foreground">Trùng lặp</p>
                      </div>
                    </div>
                    {bValidation.errors.length > 0 && (
                      <div className="max-h-32 overflow-y-auto space-y-1 rounded border bg-background p-2">
                        {bValidation.errors.map((e, i) => (
                          <p key={i} className="text-xs text-destructive font-mono">Dòng {e.lineNum}: {e.reason}{e.email && e.email !== "(trống)" ? ` (${e.email})` : ""}</p>
                        ))}
                      </div>
                    )}
                    {bValidation.errors.length > 0 && bValidation.valid.length > 0 && (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => handleBulkSave(bValidation.valid)} disabled={bSaving}>
                        {bSaving ? "Đang lưu..." : `Bỏ qua lỗi và lưu ${bValidation.valid.length} đơn hợp lệ`}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
                <Button variant="outline" className="w-full sm:w-auto min-h-[44px] sm:order-1" onClick={() => setBulkOpen(false)}>Hủy</Button>
                <Button variant="secondary" className="w-full sm:w-auto min-h-[44px] sm:order-2" onClick={handleBulkValidate} disabled={!bText.trim()}>Kiểm tra</Button>
                <Button className="w-full sm:w-auto min-h-[44px] sm:order-3" onClick={() => handleBulkSave()} disabled={bSaving || !bText.trim() || !bProd}>
                  {bSaving ? "Đang lưu..." : "Lưu tất cả"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* XLSX Import Dialog */}
      <XlsxImportDialog
        open={xlsxOpen}
        onClose={() => setXlsxOpen(false)}
        existingOrders={orders ?? []}
        onImported={() => queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() })}
      />

      {/* Image Import Dialog */}
      <ImageImportDialog
        open={imgOpen}
        onClose={() => setImgOpen(false)}
        existingOrders={orders ?? []}
      />

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
