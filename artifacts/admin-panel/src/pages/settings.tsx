import { useState, useEffect, useRef, useCallback } from "react"
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
import { Save, AlertTriangle, RefreshCcw, Bell, Plus, Trash2, Radio, ExternalLink, Link, Wifi, WifiOff, Loader2, ShoppingBag, ChevronUp, ChevronDown, Pencil, Check, X, Truck } from "lucide-react"
import type { BotSettings, NotificationSettings } from "@workspace/api-client-react"

interface RequiredChannel {
  id: string
  name: string
  username: string   // e.g. @kenhchính — used for getChatMember for public channels
  chatId: string     // numeric Telegram channel ID e.g. -1001234567890 — required for private channels
  url: string        // full t.me link — used as button URL
  enabled: boolean
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

async function fetchChannels(): Promise<RequiredChannel[]> {
  const res = await fetch("/api/bot/required-channels", { headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function saveChannels(channels: RequiredChannel[]): Promise<RequiredChannel[]> {
  const res = await fetch("/api/bot/required-channels", {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(channels),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Shop channels helpers ─────────────────────────────────────────────────────
interface ShopChannel {
  id: string
  name: string
  username: string
  link: string
  icon: string
  order: number
  enabled: boolean
}

async function fetchShopChannels(): Promise<ShopChannel[]> {
  const res = await fetch("/api/bot/shop-channels", { headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function apiAddShopChannel(data: Omit<ShopChannel, "id" | "order">): Promise<ShopChannel> {
  const res = await fetch("/api/bot/shop-channels", {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function apiUpdateShopChannel(id: string, data: Partial<ShopChannel>): Promise<ShopChannel> {
  const res = await fetch(`/api/bot/shop-channels/${id}`, {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function apiDeleteShopChannel(id: string): Promise<void> {
  const res = await fetch(`/api/bot/shop-channels/${id}`, { method: "DELETE", headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
}

async function apiReorderShopChannels(ids: string[]): Promise<ShopChannel[]> {
  const res = await fetch("/api/bot/shop-channels/reorder", {
    method: "PUT",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

// ── Gift shop channels helpers ────────────────────────────────────────────────
async function fetchGiftShopChannels(): Promise<ShopChannel[]> {
  const res = await fetch("/api/bot/gift-shop-channels", { headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
async function apiAddGiftShopChannel(data: Omit<ShopChannel, "id" | "order">): Promise<ShopChannel> {
  const res = await fetch("/api/bot/gift-shop-channels", {
    method: "POST", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
async function apiUpdateGiftShopChannel(id: string, data: Partial<ShopChannel>): Promise<ShopChannel> {
  const res = await fetch(`/api/bot/gift-shop-channels/${id}`, {
    method: "PUT", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
async function apiDeleteGiftShopChannel(id: string): Promise<void> {
  const res = await fetch(`/api/bot/gift-shop-channels/${id}`, { method: "DELETE", headers: authHeader() })
  if (!res.ok) throw new Error(await res.text())
}
async function apiReorderGiftShopChannels(ids: string[]): Promise<ShopChannel[]> {
  const res = await fetch("/api/bot/gift-shop-channels/reorder", {
    method: "PUT", headers: { ...authHeader(), "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

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

  // ── Required channels state ──────────────────────────────────────────────
  const [channels, setChannels] = useState<RequiredChannel[]>([])
  const [channelsSaving, setChannelsSaving] = useState(false)
  const [newCh, setNewCh] = useState({ name: "", username: "", chatId: "", url: "" })
  const [channelTests, setChannelTests] = useState<Record<string, { loading?: boolean; ok?: boolean; title?: string; botStatus?: string; isAdmin?: boolean; error?: string }>>({})
  const [fetchingInfo, setFetchingInfo] = useState(false)
  const [fetchResult, setFetchResult] = useState<{ ok: boolean; chatId?: string; title?: string; username?: string; isAdmin?: boolean; botStatus?: string; error?: string } | null>(null)

  // ── Shop channels state ──────────────────────────────────────────────────
  const [shopChannels, setShopChannels] = useState<ShopChannel[]>([])
  const [shopSaving, setShopSaving] = useState(false)
  const [newShopCh, setNewShopCh] = useState({ name: "", username: "", link: "", icon: "🛒" })
  const [editingShopId, setEditingShopId] = useState<string | null>(null)
  const [editShopCh, setEditShopCh] = useState<Partial<ShopChannel>>({})

  // ── Delivery reminder settings state ────────────────────────────────────
  const [deliveryReminderSettings, setDeliveryReminderSettings] = useState<{ enabled: boolean; reminderMinutes: number[] }>({ enabled: true, reminderMinutes: [10, 30, 60] })
  const [deliveryReminderSaving, setDeliveryReminderSaving] = useState(false)
  const [newReminderMinute, setNewReminderMinute] = useState("")

  // ── Gift shop channels state ─────────────────────────────────────────────
  const [giftShopChannels, setGiftShopChannels] = useState<ShopChannel[]>([])
  const [giftShopSaving, setGiftShopSaving] = useState(false)
  const [newGiftShopCh, setNewGiftShopCh] = useState({ name: "", username: "", link: "", icon: "🛍️" })
  const [editingGiftShopId, setEditingGiftShopId] = useState<string | null>(null)
  const [editGiftShopCh, setEditGiftShopCh] = useState<Partial<ShopChannel>>({})

  const handleFetchChannelInfo = async () => {
    // Accept username (@handle), link (t.me/...), or numeric chatId
    const raw = (newCh.username || newCh.chatId || newCh.url || "").trim()
    if (!raw) {
      toast({ title: "Cần nhập thông tin kênh", description: "Nhập Username (không @), link t.me hoặc Channel ID để tra cứu", variant: "destructive" })
      return
    }
    // Resolve to an identifier getChat can handle
    let identifier = raw
    // Link → extract username or use as-is
    const linkMatch = raw.match(/t\.me\/([^/?]+)/)
    if (linkMatch) identifier = linkMatch[1].startsWith("+") ? raw : linkMatch[1]
    // Strip leading @ if any
    if (identifier.startsWith("@")) identifier = identifier.slice(1)

    setFetchingInfo(true)
    setFetchResult(null)
    try {
      const res = await fetch(`/api/bot/check-channel/${encodeURIComponent(identifier)}`, { headers: authHeader() })
      const data = await res.json()
      setFetchResult(data)
      if (data.ok && data.canAccess) {
        // Auto-fill form fields
        setNewCh(n => ({
          ...n,
          name: n.name || data.title || "",
          chatId: data.chatId || n.chatId,
          username: data.username || n.username,
        }))
        if (data.isAdmin) {
          toast({ title: "✅ Lấy thông tin thành công", description: `${data.title} · ID: ${data.chatId} · Bot là ${data.botStatus}` })
        } else {
          toast({ title: "⚠️ Lấy được thông tin nhưng bot chưa là admin", description: `ID: ${data.chatId} · Bot status: ${data.botStatus}. Cần thêm bot làm admin kênh để xác minh thành viên.`, variant: "destructive" })
        }
      } else {
        toast({ title: "Không thể truy cập kênh", description: data.error ?? "Bot không nhận ra kênh này. Kiểm tra username/link và đảm bảo bot đã được thêm vào kênh.", variant: "destructive" })
      }
    } catch (e: any) {
      setFetchResult({ ok: false, error: e.message })
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally {
      setFetchingInfo(false)
    }
  }

  const handleTestChannel = async (ch: RequiredChannel) => {
    // Prefer numeric chatId (works for private channels); fallback to username
    const rawId = ch.chatId?.trim() || ch.username?.replace(/^@/, "").trim() || ""
    if (!rawId) {
      toast({ title: "Không thể kiểm tra", description: "Kênh chưa có Username hoặc Channel ID — hãy bổ sung để bot có thể xác minh thành viên", variant: "destructive" })
      return
    }
    setChannelTests(prev => ({ ...prev, [ch.id]: { loading: true } }))
    try {
      const res = await fetch(`/api/bot/check-channel/${encodeURIComponent(rawId)}`, { headers: authHeader() })
      const data = await res.json()
      setChannelTests(prev => ({ ...prev, [ch.id]: data }))
      if (!data.canAccess) toast({ title: "Lỗi kết nối kênh", description: data.error ?? "Bot không thể truy cập kênh", variant: "destructive" })
      else if (!data.isAdmin) toast({ title: "⚠️ Bot chưa là admin", description: `Bot status: ${data.botStatus}. Cần thêm bot làm quản trị viên để getChatMember hoạt động.`, variant: "destructive" })
      else toast({ title: "✅ Kênh OK", description: `${data.title} — Bot là ${data.botStatus}, getChatMember hoạt động` })
    } catch (e: any) {
      setChannelTests(prev => ({ ...prev, [ch.id]: { ok: false, error: e.message } }))
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    }
  }

  const loadChannels = useCallback(async () => {
    try { setChannels(await fetchChannels()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])

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

  // ── Delivery reminder settings load/save ────────────────────────────────
  useEffect(() => {
    fetch("/api/bot/delivery-reminder-settings", { headers: authHeader() })
      .then(r => r.json())
      .then(data => setDeliveryReminderSettings(data))
      .catch(() => {})
  }, [])

  const handleSaveDeliveryReminder = async () => {
    setDeliveryReminderSaving(true)
    try {
      const res = await fetch("/api/bot/delivery-reminder-settings", {
        method: "PUT",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(deliveryReminderSettings),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = await res.json()
      setDeliveryReminderSettings(updated)
      toast({ title: "Đã lưu", description: "Cài đặt nhắc giao tài khoản đã được cập nhật" })
    } catch {
      toast({ title: "Lỗi", description: "Không thể lưu cài đặt", variant: "destructive" })
    } finally {
      setDeliveryReminderSaving(false)
    }
  }

  const addReminderMinute = () => {
    const val = parseInt(newReminderMinute, 10)
    if (isNaN(val) || val <= 0) {
      toast({ title: "Lỗi", description: "Vui lòng nhập số phút hợp lệ (> 0)", variant: "destructive" }); return
    }
    if (deliveryReminderSettings.reminderMinutes.includes(val)) {
      toast({ title: "Đã tồn tại", description: `Mốc ${val} phút đã có trong danh sách`, variant: "destructive" }); return
    }
    setDeliveryReminderSettings({
      ...deliveryReminderSettings,
      reminderMinutes: [...deliveryReminderSettings.reminderMinutes, val].sort((a, b) => a - b),
    })
    setNewReminderMinute("")
  }

  const removeReminderMinute = (min: number) =>
    setDeliveryReminderSettings({
      ...deliveryReminderSettings,
      reminderMinutes: deliveryReminderSettings.reminderMinutes.filter(m => m !== min),
    })

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

  // ── Channel helpers ──────────────────────────────────────────────────────
  const handleAddChannel = async () => {
    const name = newCh.name.trim()
    if (!name) {
      toast({ title: "Lỗi", description: "Tên kênh là bắt buộc", variant: "destructive" }); return
    }

    const chatId  = newCh.chatId.trim()
    // username: if we have a fetchResult, it's already `@handle`; otherwise treat as raw input
    const rawUsr  = newCh.username.trim()
    const handle  = rawUsr.startsWith("@") ? rawUsr : rawUsr ? `@${rawUsr}` : ""
    const url     = newCh.url.trim()

    if (!chatId && !handle && !url) {
      toast({ title: "Lỗi", description: "Bấm 'Lấy thông tin kênh' trước để điền Channel ID tự động", variant: "destructive" }); return
    }
    if (!chatId) {
      toast({
        title: "⚠️ Không có Channel ID",
        description: "Bot sẽ không thể xác minh thành viên qua getChatMember. Khuyến nghị dùng 'Lấy thông tin kênh' trước.",
      })
    }

    const ch: RequiredChannel = {
      id: Date.now().toString(),
      name,
      username: handle,
      chatId,
      url: url || (handle ? `https://t.me/${handle.replace(/^@/, "")}` : ""),
      enabled: true,
    }
    const updated = [...channels, ch]
    setChannelsSaving(true)
    try {
      const saved = await saveChannels(updated)
      setChannels(saved)
      setNewCh({ name: "", username: "", chatId: "", url: "" })
      setFetchResult(null)
      toast({ title: "Đã thêm kênh", description: ch.name })
    } catch (e: any) {
      toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setChannelsSaving(false) }
  }

  const handleToggleChannel = async (id: string, enabled: boolean) => {
    const updated = channels.map(c => c.id === id ? { ...c, enabled } : c)
    setChannels(updated)
    try { await saveChannels(updated) }
    catch (e: any) { toast({ title: "Lỗi lưu kênh", description: e.message, variant: "destructive" }) }
  }

  const handleDeleteChannel = async (id: string) => {
    const updated = channels.filter(c => c.id !== id)
    setChannels(updated)
    try { await saveChannels(updated) }
    catch (e: any) { toast({ title: "Lỗi xóa kênh", description: e.message, variant: "destructive" }) }
  }

  // ── Shop channel handlers ─────────────────────────────────────────────────
  const loadShopChannels = useCallback(async () => {
    try { setShopChannels(await fetchShopChannels()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadShopChannels() }, [loadShopChannels])

  const handleAddShopChannel = async () => {
    const { name, username, link, icon } = newShopCh
    if (!name.trim() || !link.trim()) {
      toast({ title: "Lỗi", description: "Tên và Link là bắt buộc", variant: "destructive" }); return
    }
    setShopSaving(true)
    try {
      const ch = await apiAddShopChannel({ name: name.trim(), username: username.trim(), link: link.trim(), icon: icon.trim() || "🛒", enabled: true })
      setShopChannels(prev => [...prev, ch])
      setNewShopCh({ name: "", username: "", link: "", icon: "🛒" })
      toast({ title: "Đã thêm kênh bán hàng", description: ch.name })
    } catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setShopSaving(false) }
  }

  const handleToggleShopChannel = async (id: string, enabled: boolean) => {
    setShopChannels(prev => prev.map(c => c.id === id ? { ...c, enabled } : c))
    try { await apiUpdateShopChannel(id, { enabled }) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadShopChannels() }
  }

  const handleDeleteShopChannel = async (id: string) => {
    const ch = shopChannels.find(c => c.id === id)
    setShopChannels(prev => prev.filter(c => c.id !== id))
    try { await apiDeleteShopChannel(id); toast({ title: "Đã xoá", description: ch?.name }) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadShopChannels() }
  }

  const handleStartEditShop = (ch: ShopChannel) => {
    setEditingShopId(ch.id)
    setEditShopCh({ name: ch.name, username: ch.username, link: ch.link, icon: ch.icon })
  }

  const handleSaveEditShop = async (id: string) => {
    if (!editShopCh.name?.trim() || !editShopCh.link?.trim()) {
      toast({ title: "Lỗi", description: "Tên và Link là bắt buộc", variant: "destructive" }); return
    }
    try {
      const updated = await apiUpdateShopChannel(id, editShopCh)
      setShopChannels(prev => prev.map(c => c.id === id ? updated : c))
      setEditingShopId(null)
      toast({ title: "Đã lưu", description: updated.name })
    } catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }) }
  }

  const handleMoveShop = async (id: string, direction: "up" | "down") => {
    const sorted = [...shopChannels].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex(c => c.id === id)
    if (direction === "up" && idx === 0) return
    if (direction === "down" && idx === sorted.length - 1) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    const newArr = [...sorted]
    ;[newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]]
    const newOrder = newArr.map((c, i) => ({ ...c, order: i + 1 }))
    setShopChannels(newOrder)
    try { await apiReorderShopChannels(newOrder.map(c => c.id)) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadShopChannels() }
  }

  // ── Gift shop channel handlers ────────────────────────────────────────────
  const loadGiftShopChannels = useCallback(async () => {
    try { setGiftShopChannels(await fetchGiftShopChannels()) } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadGiftShopChannels() }, [loadGiftShopChannels])

  const handleAddGiftShopChannel = async () => {
    const { name, username, link, icon } = newGiftShopCh
    if (!name.trim() || !link.trim()) {
      toast({ title: "Lỗi", description: "Tên và Link là bắt buộc", variant: "destructive" }); return
    }
    setGiftShopSaving(true)
    try {
      const ch = await apiAddGiftShopChannel({ name: name.trim(), username: username.trim(), link: link.trim(), icon: icon.trim() || "🛍️", enabled: true })
      setGiftShopChannels(prev => [...prev, ch])
      setNewGiftShopCh({ name: "", username: "", link: "", icon: "🛍️" })
      toast({ title: "Đã thêm kênh", description: ch.name })
    } catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" })
    } finally { setGiftShopSaving(false) }
  }

  const handleToggleGiftShopChannel = async (id: string, enabled: boolean) => {
    setGiftShopChannels(prev => prev.map(c => c.id === id ? { ...c, enabled } : c))
    try { await apiUpdateGiftShopChannel(id, { enabled }) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadGiftShopChannels() }
  }

  const handleDeleteGiftShopChannel = async (id: string) => {
    const ch = giftShopChannels.find(c => c.id === id)
    setGiftShopChannels(prev => prev.filter(c => c.id !== id))
    try { await apiDeleteGiftShopChannel(id); toast({ title: "Đã xoá", description: ch?.name }) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadGiftShopChannels() }
  }

  const handleStartEditGiftShop = (ch: ShopChannel) => {
    setEditingGiftShopId(ch.id)
    setEditGiftShopCh({ name: ch.name, username: ch.username, link: ch.link, icon: ch.icon })
  }

  const handleSaveEditGiftShop = async (id: string) => {
    if (!editGiftShopCh.name?.trim() || !editGiftShopCh.link?.trim()) {
      toast({ title: "Lỗi", description: "Tên và Link là bắt buộc", variant: "destructive" }); return
    }
    try {
      const updated = await apiUpdateGiftShopChannel(id, editGiftShopCh)
      setGiftShopChannels(prev => prev.map(c => c.id === id ? updated : c))
      setEditingGiftShopId(null)
      toast({ title: "Đã lưu", description: updated.name })
    } catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }) }
  }

  const handleMoveGiftShop = async (id: string, direction: "up" | "down") => {
    const sorted = [...giftShopChannels].sort((a, b) => a.order - b.order)
    const idx = sorted.findIndex(c => c.id === id)
    if (direction === "up" && idx === 0) return
    if (direction === "down" && idx === sorted.length - 1) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    const newArr = [...sorted]
    ;[newArr[idx], newArr[swapIdx]] = [newArr[swapIdx], newArr[idx]]
    const newOrder = newArr.map((c, i) => ({ ...c, order: i + 1 }))
    setGiftShopChannels(newOrder)
    try { await apiReorderGiftShopChannels(newOrder.map(c => c.id)) }
    catch (e: any) { toast({ title: "Lỗi", description: e.message, variant: "destructive" }); loadGiftShopChannels() }
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

      {/* ── Required channels (gift join-gate) ───────────────────────────── */}
      <div>
        <h2 className="text-lg md:text-xl font-semibold tracking-tight flex items-center gap-2 mt-2 mb-1">
          <Radio className="w-5 h-5 text-orange-500" /> Kênh bắt buộc tham gia trước khi nhận quà
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Khi bật, người dùng phải tham gia <b>tất cả</b> kênh đang bật thì mới được nhận quà.
        </p>
      </div>

      {/* Global toggle */}
      <Card>
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-medium">Bật kiểm tra tham gia kênh</Label>
              <p className="text-sm text-muted-foreground mt-1">Bot sẽ xác minh user đã join kênh trước khi cấp quà</p>
            </div>
            <Switch
              checked={!!form.requireChannelCheck}
              onCheckedChange={v => setForm({ ...form, requireChannelCheck: v })}
            />
          </div>
          {form.requireChannelCheck && channels.length === 0 && (
            <p className="mt-3 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md">
              ⚠️ Đã bật nhưng chưa có kênh nào. Thêm ít nhất 1 kênh bên dưới.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Channel list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách kênh bắt buộc</CardTitle>
          <CardDescription>Bot tham gia kênh và dùng getChatMember để xác minh</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add new channel */}
          <div className="border border-dashed border-border/70 rounded-lg p-4 space-y-3 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thêm kênh mới</p>
            {/* Step 1: Lookup */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Bước 1 — Tra cứu kênh</Label>
              <div className="flex gap-2">
                <Input
                  value={newCh.username}
                  onChange={e => { setNewCh(n => ({ ...n, username: e.target.value })); setFetchResult(null) }}
                  placeholder="username (không @), t.me/+xxx hoặc -100xxxxxxxxx"
                  className="min-h-[44px] flex-1"
                />
                <Button
                  onClick={handleFetchChannelInfo}
                  disabled={fetchingInfo}
                  variant="secondary"
                  className="min-h-[44px] shrink-0 gap-1.5"
                >
                  {fetchingInfo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  Lấy thông tin kênh
                </Button>
              </div>

              {/* Fetch result card */}
              {fetchResult && (
                <div className={`rounded-lg border px-3 py-2 text-xs space-y-0.5 ${fetchResult.ok && fetchResult.chatId ? "border-green-300 bg-green-50 dark:bg-green-950/30" : "border-red-300 bg-red-50 dark:bg-red-950/30"}`}>
                  {fetchResult.ok && fetchResult.chatId ? (
                    <>
                      <p className="font-semibold text-green-700 dark:text-green-400">✅ Tìm thấy kênh — thông tin đã tự động điền</p>
                      <p>Tên: <b>{fetchResult.title}</b></p>
                      <p>Channel ID: <code className="bg-muted px-1 rounded font-mono">{fetchResult.chatId}</code></p>
                      {fetchResult.username && <p>Username: <code className="bg-muted px-1 rounded">{fetchResult.username}</code></p>}
                      {fetchResult.isAdmin
                        ? <p className="text-green-700 dark:text-green-400">🤖 Bot là <b>{fetchResult.botStatus}</b> — getChatMember hoạt động ✓</p>
                        : <p className="text-amber-600 font-semibold">⚠️ Bot chưa là admin (status: {fetchResult.botStatus}) — cần thêm bot làm quản trị viên kênh để xác minh thành viên</p>
                      }
                    </>
                  ) : (
                    <p className="text-red-700 dark:text-red-400">❌ {fetchResult.error ?? "Không thể truy cập kênh"}</p>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Fill remaining fields */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Bước 2 — Điền thông tin còn lại</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tên hiển thị *</Label>
                  <Input
                    value={newCh.name}
                    onChange={e => setNewCh(n => ({ ...n, name: e.target.value }))}
                    placeholder="AI Center Official"
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Channel ID <span className="text-muted-foreground/70">(tự động từ Bước 1)</span></Label>
                  <Input
                    value={newCh.chatId}
                    onChange={e => setNewCh(n => ({ ...n, chatId: e.target.value }))}
                    placeholder="-1001234567890"
                    className={`min-h-[44px] font-mono text-sm ${newCh.chatId ? "border-green-400" : ""}`}
                    readOnly={!!fetchResult?.ok && !!newCh.chatId}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Link tham gia <span className="text-muted-foreground/70">tuỳ chọn</span></Label>
                  <Input
                    value={newCh.url}
                    onChange={e => setNewCh(n => ({ ...n, url: e.target.value }))}
                    placeholder="https://t.me/+abcxyz"
                    className="min-h-[44px]"
                  />
                </div>
              </div>
            </div>

            <Button
              onClick={handleAddChannel}
              disabled={channelsSaving || !newCh.name.trim()}
              className="min-h-[44px]"
            >
              <Plus className="w-4 h-4 mr-1" /> Thêm kênh
            </Button>
          </div>

          {/* Channel list */}
          {channels.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <Link className="h-6 w-6 mx-auto mb-2 opacity-30" />
              Chưa có kênh nào được cấu hình
            </div>
          ) : (
            <div className="space-y-2">
              {channels.map(ch => (
                <div key={ch.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${ch.enabled ? "bg-background border-border" : "bg-muted/30 border-border/40 opacity-60"}`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{ch.name}</span>
                      {ch.chatId
                        ? <Badge variant="default" className="font-mono text-xs bg-green-600 hover:bg-green-600">{ch.chatId}</Badge>
                        : ch.username
                          ? <Badge variant="secondary" className="font-mono text-xs">{ch.username}</Badge>
                          : <Badge variant="destructive" className="text-xs">⚠️ Chưa có ID</Badge>
                      }
                      {ch.username && ch.chatId && (
                        <Badge variant="outline" className="font-mono text-xs text-muted-foreground">{ch.username}</Badge>
                      )}
                      {ch.url && (
                        <a href={ch.url} target="_blank" rel="noopener noreferrer"
                           className="text-blue-500 hover:text-blue-600 inline-flex items-center gap-0.5 text-xs">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    {/* Test result */}
                    {channelTests[ch.id] && !channelTests[ch.id].loading && (
                      <div className={`mt-1 text-xs flex items-center gap-1 ${channelTests[ch.id].ok && channelTests[ch.id].isAdmin ? "text-green-600" : "text-amber-600"}`}>
                        {channelTests[ch.id].ok && channelTests[ch.id].isAdmin
                          ? <><Wifi className="w-3 h-3" /> {channelTests[ch.id].title} · Bot là {channelTests[ch.id].botStatus} ✓</>
                          : <><WifiOff className="w-3 h-3" /> {channelTests[ch.id].error ?? `Bot status: ${channelTests[ch.id].botStatus} — cần là admin`}</>
                        }
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleTestChannel(ch)}
                      className="text-muted-foreground hover:text-blue-500 transition-colors p-1"
                      title="Kiểm tra kết nối kênh"
                    >
                      {channelTests[ch.id]?.loading
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Wifi className="w-4 h-4" />
                      }
                    </button>
                    <Switch
                      checked={ch.enabled}
                      onCheckedChange={v => handleToggleChannel(ch.id, v)}
                    />
                    <button
                      onClick={() => handleDeleteChannel(ch.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save settings (includes requireChannelCheck) */}
      <div className="pb-4">
        <Button
          size="lg"
          className="w-full sm:w-auto min-h-[48px] px-8 bg-orange-600 hover:bg-orange-700"
          onClick={handleSave}
          disabled={updateSettings.isPending}
        >
          {updateSettings.isPending ? "Đang lưu..." : <><Save className="w-4 h-4 mr-2" /> Lưu cài đặt kênh</>}
        </Button>
      </div>

      {/* ── Kênh bán hàng ────────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-lg md:text-xl font-semibold tracking-tight flex items-center gap-2 mt-2 mb-1">
          <ShoppingBag className="w-5 h-5 text-purple-500" /> Kênh bán hàng
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Khi bấm 🛍️ <b>Kênh Bán Hàng</b>: nếu chỉ có 1 kênh bật → mở trực tiếp. Nếu có nhiều kênh → bot hiện danh sách chọn.
        </p>
      </div>

      {/* Shop channel list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách kênh bán hàng</CardTitle>
          <CardDescription>Thứ tự hiển thị trong bot dùng các nút ↑ ↓</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Channel list */}
          {shopChannels.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <ShoppingBag className="h-6 w-6 mx-auto mb-2 opacity-30" />
              Chưa có kênh bán hàng nào
            </div>
          ) : (
            <div className="space-y-2">
              {[...shopChannels].sort((a, b) => a.order - b.order).map((ch, idx, arr) => (
                <div key={ch.id} className={`rounded-lg border transition-colors ${ch.enabled ? "bg-background border-border" : "bg-muted/30 border-border/40 opacity-60"}`}>
                  {editingShopId === ch.id ? (
                    /* ── Edit row ── */
                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Icon</Label>
                          <Input value={editShopCh.icon ?? ""} onChange={e => setEditShopCh(v => ({ ...v, icon: e.target.value }))} placeholder="🛒" className="min-h-[40px] text-center text-lg" maxLength={4} />
                        </div>
                        <div className="space-y-1 sm:col-span-3">
                          <Label className="text-xs">Tên hiển thị *</Label>
                          <Input value={editShopCh.name ?? ""} onChange={e => setEditShopCh(v => ({ ...v, name: e.target.value }))} placeholder="Shop AI Chính" className="min-h-[40px]" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Username</Label>
                          <Input value={editShopCh.username ?? ""} onChange={e => setEditShopCh(v => ({ ...v, username: e.target.value }))} placeholder="@shoptaikhoan" className="min-h-[40px]" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Link Telegram *</Label>
                          <Input value={editShopCh.link ?? ""} onChange={e => setEditShopCh(v => ({ ...v, link: e.target.value }))} placeholder="https://t.me/..." className="min-h-[40px]" />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setEditingShopId(null)} className="gap-1"><X className="w-3 h-3" />Huỷ</Button>
                        <Button size="sm" onClick={() => handleSaveEditShop(ch.id)} className="gap-1"><Check className="w-3 h-3" />Lưu</Button>
                      </div>
                    </div>
                  ) : (
                    /* ── Display row ── */
                    <div className="flex items-center gap-3 p-3">
                      <span className="text-xl shrink-0">{ch.icon || "🛒"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{ch.name}</span>
                          {ch.username && <Badge variant="secondary" className="font-mono text-xs">{ch.username}</Badge>}
                        </div>
                        {ch.link && (
                          <a href={ch.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 text-xs flex items-center gap-0.5 mt-0.5 truncate max-w-[200px]">
                            <ExternalLink className="w-3 h-3 shrink-0" />{ch.link}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Reorder */}
                        <button onClick={() => handleMoveShop(ch.id, "up")} disabled={idx === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Lên">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleMoveShop(ch.id, "down")} disabled={idx === arr.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Xuống">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {/* Edit */}
                        <button onClick={() => handleStartEditShop(ch)} className="p-1 text-muted-foreground hover:text-blue-500 transition-colors" title="Chỉnh sửa">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* Toggle */}
                        <Switch checked={ch.enabled} onCheckedChange={v => handleToggleShopChannel(ch.id, v)} />
                        {/* Delete */}
                        <button onClick={() => handleDeleteShopChannel(ch.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Xoá">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new shop channel */}
          <div className="border border-dashed border-border/70 rounded-lg p-4 space-y-3 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thêm kênh mới</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Icon</Label>
                <Input value={newShopCh.icon} onChange={e => setNewShopCh(n => ({ ...n, icon: e.target.value }))} placeholder="🛒" className="min-h-[44px] text-center text-lg" maxLength={4} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Tên hiển thị *</Label>
                <Input value={newShopCh.name} onChange={e => setNewShopCh(n => ({ ...n, name: e.target.value }))} placeholder="Shop AI Chính" className="min-h-[44px]" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Username</Label>
                <Input value={newShopCh.username} onChange={e => setNewShopCh(n => ({ ...n, username: e.target.value }))} placeholder="@shoptaikhoan" className="min-h-[44px]" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link Telegram *</Label>
              <Input value={newShopCh.link} onChange={e => setNewShopCh(n => ({ ...n, link: e.target.value }))} placeholder="https://t.me/shoptaikhoan hoặc https://t.me/+xxxxx" className="min-h-[44px]" />
            </div>
            <Button onClick={handleAddShopChannel} disabled={shopSaving || !newShopCh.name.trim() || !newShopCh.link.trim()} className="min-h-[44px]">
              <Plus className="w-4 h-4 mr-1" /> Thêm kênh bán hàng
            </Button>
          </div>

        </CardContent>
      </Card>

      {/* ── Kênh bán hàng sau khi phát quà ─────────────────────────────────── */}
      <div>
        <h2 className="text-lg md:text-xl font-semibold tracking-tight flex items-center gap-2 mt-2 mb-1">
          <ShoppingBag className="w-5 h-5 text-green-600" /> Kênh bán hàng sau khi phát quà
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Các nút URL này xuất hiện ngay trong tin nhắn nhận quà thành công. Mỗi kênh bật = 1 nút riêng biệt.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Danh sách kênh hiển thị sau khi nhận quà</CardTitle>
          <CardDescription>
            Thứ tự hiển thị dùng ↑ ↓ · Tất cả kênh đang bật sẽ xuất hiện dưới dạng nút trong tin nhắn quà
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Preview */}
          {giftShopChannels.filter(c => c.enabled).length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1.5">
              <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">Xem trước tin nhắn quà</p>
              <p className="text-foreground">🎉 <b>Chúc mừng! Bạn đã nhận quà thành công.</b></p>
              <p className="text-muted-foreground">📧 Tài khoản: … &nbsp;🔑 Mật khẩu: …</p>
              <p className="text-foreground">🛍️ <b>Nếu cần mua tài khoản Premium, vui lòng tham gia các kênh bán hàng bên dưới:</b></p>
              <div className="flex flex-wrap gap-1 mt-1">
                {[...giftShopChannels].filter(c => c.enabled).sort((a,b)=>a.order-b.order).map(ch => (
                  <span key={ch.id} className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded px-2 py-0.5 text-[11px]">
                    {ch.icon} {ch.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Channel list */}
          {giftShopChannels.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <ShoppingBag className="h-6 w-6 mx-auto mb-2 opacity-30" />
              Chưa có kênh nào — thêm bên dưới để hiển thị nút trong tin nhắn quà
            </div>
          ) : (
            <div className="space-y-2">
              {[...giftShopChannels].sort((a, b) => a.order - b.order).map((ch, idx, arr) => (
                <div key={ch.id} className={`rounded-lg border transition-colors ${ch.enabled ? "bg-background border-border" : "bg-muted/30 border-border/40 opacity-60"}`}>
                  {editingGiftShopId === ch.id ? (
                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Icon</Label>
                          <Input value={editGiftShopCh.icon ?? ""} onChange={e => setEditGiftShopCh(v => ({ ...v, icon: e.target.value }))} placeholder="🛍️" className="min-h-[40px] text-center text-lg" maxLength={4} />
                        </div>
                        <div className="space-y-1 sm:col-span-3">
                          <Label className="text-xs">Tên hiển thị *</Label>
                          <Input value={editGiftShopCh.name ?? ""} onChange={e => setEditGiftShopCh(v => ({ ...v, name: e.target.value }))} placeholder="Shop AI Chính" className="min-h-[40px]" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Username</Label>
                          <Input value={editGiftShopCh.username ?? ""} onChange={e => setEditGiftShopCh(v => ({ ...v, username: e.target.value }))} placeholder="@shoptaikhoan" className="min-h-[40px]" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Link Telegram *</Label>
                          <Input value={editGiftShopCh.link ?? ""} onChange={e => setEditGiftShopCh(v => ({ ...v, link: e.target.value }))} placeholder="https://t.me/..." className="min-h-[40px]" />
                        </div>
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => setEditingGiftShopId(null)} className="gap-1"><X className="w-3 h-3" />Huỷ</Button>
                        <Button size="sm" onClick={() => handleSaveEditGiftShop(ch.id)} className="gap-1"><Check className="w-3 h-3" />Lưu</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-3">
                      <span className="text-xl shrink-0">{ch.icon || "🛍️"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{ch.name}</span>
                          {ch.username && <Badge variant="secondary" className="font-mono text-xs">{ch.username}</Badge>}
                        </div>
                        {ch.link && (
                          <a href={ch.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 text-xs flex items-center gap-0.5 mt-0.5 truncate max-w-[200px]">
                            <ExternalLink className="w-3 h-3 shrink-0" />{ch.link}
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => handleMoveGiftShop(ch.id, "up")} disabled={idx === 0} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Lên">
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleMoveGiftShop(ch.id, "down")} disabled={idx === arr.length - 1} className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors" title="Xuống">
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleStartEditGiftShop(ch)} className="p-1 text-muted-foreground hover:text-blue-500 transition-colors" title="Chỉnh sửa">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <Switch checked={ch.enabled} onCheckedChange={v => handleToggleGiftShopChannel(ch.id, v)} />
                        <button onClick={() => handleDeleteGiftShopChannel(ch.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors" title="Xoá">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add new gift shop channel */}
          <div className="border border-dashed border-border/70 rounded-lg p-4 space-y-3 bg-muted/20">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Thêm kênh mới</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Icon</Label>
                <Input value={newGiftShopCh.icon} onChange={e => setNewGiftShopCh(n => ({ ...n, icon: e.target.value }))} placeholder="🛍️" className="min-h-[44px] text-center text-lg" maxLength={4} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Tên hiển thị *</Label>
                <Input value={newGiftShopCh.name} onChange={e => setNewGiftShopCh(n => ({ ...n, name: e.target.value }))} placeholder="Shop AI Chính" className="min-h-[44px]" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Username</Label>
                <Input value={newGiftShopCh.username} onChange={e => setNewGiftShopCh(n => ({ ...n, username: e.target.value }))} placeholder="@shoptaikhoan" className="min-h-[44px]" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Link Telegram *</Label>
              <Input value={newGiftShopCh.link} onChange={e => setNewGiftShopCh(n => ({ ...n, link: e.target.value }))} placeholder="https://t.me/shoptaikhoan hoặc https://t.me/+xxxxx" className="min-h-[44px]" />
            </div>
            <Button onClick={handleAddGiftShopChannel} disabled={giftShopSaving || !newGiftShopCh.name.trim() || !newGiftShopCh.link.trim()} className="min-h-[44px] bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-1" /> Thêm kênh sau khi phát quà
            </Button>
          </div>
        </CardContent>
      </Card>

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

      {/* ── Delivery reminder settings ─────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" /> Nhắc giao tài khoản
              </CardTitle>
              <CardDescription className="mt-1">
                Bot tự động nhắc Admin nếu yêu cầu giao hàng chưa được xử lý
              </CardDescription>
            </div>
            <Switch
              checked={deliveryReminderSettings.enabled}
              onCheckedChange={v => setDeliveryReminderSettings({ ...deliveryReminderSettings, enabled: v })}
            />
          </div>
        </CardHeader>
        {deliveryReminderSettings.enabled && (
          <CardContent className="space-y-4">
            <div>
              <Label className="mb-2 block">Các mốc thời gian nhắc (phút)</Label>
              <div className="flex flex-wrap gap-2 mb-3">
                {deliveryReminderSettings.reminderMinutes.map((m, i) => (
                  <div key={m} className="flex items-center gap-1 bg-muted rounded-md px-3 py-1.5 text-sm font-medium">
                    {i === 0 ? "⏰" : i === 1 ? "⚠️" : "🚨"} {m} phút
                    <button
                      onClick={() => removeReminderMinute(m)}
                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {deliveryReminderSettings.reminderMinutes.length === 0 && (
                  <span className="text-sm text-muted-foreground">Chưa có mốc nào — sẽ không nhắc</span>
                )}
              </div>
              <div className="flex gap-2 max-w-xs">
                <Input
                  type="number"
                  min={1}
                  placeholder="VD: 10"
                  className="min-h-[44px]"
                  value={newReminderMinute}
                  onChange={e => setNewReminderMinute(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addReminderMinute()}
                />
                <Button variant="outline" onClick={addReminderMinute} className="min-h-[44px] px-3">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Nhắc lần lượt sau khi người dùng gửi yêu cầu. Ví dụ: 10, 30, 60 → nhắc sau 10 phút, 30 phút, 60 phút.
              </p>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="pb-4">
        <Button
          size="lg"
          className="w-full sm:w-auto min-h-[48px] px-8 bg-orange-600 hover:bg-orange-700"
          onClick={handleSaveDeliveryReminder}
          disabled={deliveryReminderSaving}
        >
          {deliveryReminderSaving
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Truck className="w-4 h-4 mr-2" />
          }
          Lưu cài đặt nhắc giao hàng
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
