/**
 * sheets-sync.tsx — Trang "Đồng bộ Sheet"
 * Cấu hình Google Sheets: Spreadsheet ID, tab mặc định, ánh xạ sản phẩm → tab
 */
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Save, Loader2, Plus, Trash2, RefreshCw,
  TableProperties, Wifi, WifiOff, BookOpen, CheckCircle2, Upload,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

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

interface SheetsConfig {
  spreadsheet_id: string
  default_tab:    string
  market_tab:     string
  sync_enabled:   boolean
  tab_mappings:   Record<string, string>
}

interface SheetsStatus {
  connected:     boolean
  message:       string
  fix?:          string
  client_email?: string
  project_id?:   string
}

interface SyncedEntry {
  order_id:   string
  tab:        string
  synced_at?: string
}

// ── Trạng thái kết nối ─────────────────────────────────────────────────────
function ConnectionStatus() {
  const [st, setSt] = useState<SheetsStatus | null>(null)

  useEffect(() => {
    apiFetch("GET", "/bot/sheets/status")
      .then(setSt)
      .catch(() => setSt({ connected: false, message: "Không thể kiểm tra trạng thái." }))
  }, [])

  if (!st) return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Đang kiểm tra kết nối…
    </div>
  )

  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
      st.connected
        ? "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800 dark:text-green-300"
        : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300"
    }`}>
      {st.connected
        ? <Wifi    className="h-4 w-4 mt-0.5 flex-shrink-0" />
        : <WifiOff className="h-4 w-4 mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <p className="font-medium">{st.message}</p>
        {st.connected && st.client_email && (
          <p className="text-xs opacity-70 mt-0.5 truncate">{st.client_email}</p>
        )}
        {!st.connected && st.fix && (
          <p className="text-xs mt-1 opacity-80">{st.fix}</p>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SheetsSync() {
  const { toast } = useToast()

  const [pushing, setPushing] = useState(false)

  const [cfg,     setCfg]     = useState<SheetsConfig>({
    spreadsheet_id: "", default_tab: "Đơn hàng", market_tab: "Đơn hàng chợ",
    sync_enabled: false, tab_mappings: {},
  })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [synced,   setSynced]   = useState<SyncedEntry[]>([])
  const [syncLoad, setSyncLoad] = useState(false)

  // Ánh xạ mới
  const [newKw,  setNewKw]  = useState("")
  const [newTab, setNewTab] = useState("")

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch("GET", "/bot/sheets/config")
      setCfg(data)
    } catch (e: any) {
      toast({ title: "Lỗi tải cấu hình", description: e.message, variant: "destructive" })
    } finally { setLoading(false) }
  }, [])

  const loadSynced = useCallback(async () => {
    setSyncLoad(true)
    try {
      const data = await apiFetch("GET", "/bot/sheets/synced")
      setSynced(Array.isArray(data) ? data : (data.entries ?? []))
    } catch { setSynced([]) } finally { setSyncLoad(false) }
  }, [])

  useEffect(() => { loadConfig(); loadSynced() }, [loadConfig, loadSynced])

  async function pushAll() {
    setPushing(true)
    try {
      const res = await apiFetch("POST", "/bot/sheets/push-all")
      // Tạo mô tả chi tiết từng tab
      let desc = res.message ?? ""
      if (res.ok && res.tab_summary && Object.keys(res.tab_summary).length > 0) {
        const tabLines = Object.entries(res.tab_summary as Record<string, number>)
          .map(([tab, count]) => `• ${tab}: ${count} đơn`)
          .join("\n")
        desc = `${desc}\n${tabLines}`
      }
      toast({ title: res.ok ? "✅ Hoàn tất" : "Lỗi", description: desc,
              variant: res.ok ? "default" : "destructive" })
      if (res.ok) loadSynced()
    } catch (e: any) {
      toast({ title: "Lỗi đẩy Sheet", description: e.message, variant: "destructive" })
    } finally { setPushing(false) }
  }

  async function save() {
    setSaving(true)
    try {
      const res = await apiFetch("PUT", "/bot/sheets/config", cfg)
      toast({ title: res.ok ? "Đã lưu cấu hình" : "Lỗi", description: res.message,
              variant: res.ok ? "default" : "destructive" })
    } catch (e: any) {
      toast({ title: "Lỗi lưu cấu hình", description: e.message, variant: "destructive" })
    } finally { setSaving(false) }
  }

  function addMapping() {
    const kw = newKw.trim()
    const tb = newTab.trim()
    if (!kw || !tb) {
      toast({ title: "Cần nhập cả hai ô", variant: "destructive" }); return
    }
    setCfg(c => ({ ...c, tab_mappings: { ...c.tab_mappings, [kw]: tb } }))
    setNewKw(""); setNewTab("")
  }

  function removeMapping(kw: string) {
    setCfg(c => {
      const m = { ...c.tab_mappings }
      delete m[kw]
      return { ...c, tab_mappings: m }
    })
  }

  const mappings = Object.entries(cfg.tab_mappings)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TableProperties className="h-6 w-6 text-primary" />
            Đồng bộ Google Sheets
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tự động ghi đơn hàng mới vào đúng bảng Sheet theo loại sản phẩm
          </p>
        </div>
        <div className="flex gap-2 flex-wrap self-start sm:self-auto">
          <Button onClick={save} disabled={saving || loading}>
            {saving
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang lưu…</>
              : <><Save    className="h-4 w-4 mr-2" />Lưu cấu hình</>}
          </Button>
          <Button variant="outline" onClick={pushAll} disabled={pushing || loading}>
            {pushing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang đẩy…</>
              : <><Upload  className="h-4 w-4 mr-2" />Đẩy tất cả lên Sheet</>}
          </Button>
        </div>
      </div>

      {/* Trạng thái kết nối */}
      <ConnectionStatus />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Bật / Tắt */}
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Bật / Tắt tính năng</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cfg.sync_enabled ? "Đang bật — đơn mới sẽ được ghi tự động" : "Đang tắt"}
                  </p>
                </div>
                <Switch
                  checked={cfg.sync_enabled}
                  onCheckedChange={v => setCfg(c => ({ ...c, sync_enabled: v }))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Cấu hình Spreadsheet */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cấu hình Spreadsheet</CardTitle>
              <p className="text-xs text-muted-foreground">
                Lấy Spreadsheet ID từ URL Google Sheet:{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-xs">
                  docs.google.com/spreadsheets/d/<strong>ID_Ở_ĐÂY</strong>/edit
                </code>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="spreadsheet-id">Spreadsheet ID</Label>
                <Input
                  id="spreadsheet-id"
                  value={cfg.spreadsheet_id}
                  onChange={e => setCfg(c => ({ ...c, spreadsheet_id: e.target.value }))}
                  placeholder="1BxiMxxxxxxxxxxxxxxxxxxxxxxxxx"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default-tab">Tab mặc định (khi không khớp sản phẩm)</Label>
                <Input
                  id="default-tab"
                  value={cfg.default_tab}
                  onChange={e => setCfg(c => ({ ...c, default_tab: e.target.value }))}
                  placeholder="Đơn hàng"
                  className="max-w-xs"
                />
              </div>
            </CardContent>
          </Card>

          {/* Ánh xạ sản phẩm → Tab */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ánh xạ sản phẩm → Tab Sheet</CardTitle>
              <p className="text-xs text-muted-foreground">
                Mỗi loại sản phẩm sẽ được ghi vào tab tương ứng. So sánh theo từ khóa trong tên sản phẩm.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {mappings.length > 0 && (
                <div className="space-y-2">
                  {mappings.map(([kw, tab]) => (
                    <div key={kw} className="flex items-center gap-2">
                      <Input value={kw}  readOnly className="flex-1 bg-muted/40 text-sm" />
                      <Input value={tab} readOnly className="flex-1 bg-muted/40 text-sm" />
                      <Button
                        variant="ghost" size="icon"
                        className="text-destructive hover:text-destructive flex-shrink-0"
                        onClick={() => removeMapping(kw)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {/* Thêm mới */}
              <div className="flex items-end gap-2 pt-1">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Từ khóa sản phẩm</Label>
                  <Input
                    value={newKw}
                    onChange={e => setNewKw(e.target.value)}
                    placeholder="vd: Netflix"
                    className="text-sm"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Tên tab Sheet</Label>
                  <Input
                    value={newTab}
                    onChange={e => setNewTab(e.target.value)}
                    placeholder="vd: Netflix"
                    className="text-sm"
                    onKeyDown={e => e.key === "Enter" && addMapping()}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={addMapping} className="flex-shrink-0">
                  <Plus className="h-4 w-4 mr-1" /> Thêm
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Hướng dẫn */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                Hướng dẫn cài đặt Service Account
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2.5 text-sm text-muted-foreground list-none">
                {[
                  <>Vào <strong className="text-foreground">Google Cloud Console</strong> → tạo hoặc chọn project.</>,
                  <>Bật <strong className="text-foreground">Google Sheets API</strong> trong Library.</>,
                  <>Tạo <strong className="text-foreground">Service Account</strong> → tải JSON key về máy.</>,
                  <>Vào <strong className="text-foreground">Replit Secrets</strong> → thêm secret tên{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">GOOGLE_SERVICE_ACCOUNT_JSON</code>,
                    dán toàn bộ nội dung file JSON vào.</>,
                  <>Mở Google Sheet → nhấn <strong className="text-foreground">Share</strong> → thêm email của
                    Service Account (dạng{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">xxx@yyy.iam.gserviceaccount.com</code>)
                    với quyền <strong className="text-foreground">Editor</strong>.</>,
                  <>Điền Spreadsheet ID ở trên → Lưu cấu hình → Bật tính năng.</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                Mỗi lần robot đồng bộ xong, đơn hàng mới sẽ tự động được ghi vào Google Sheet.
                Đơn đã ghi sẽ không bị ghi lại (kiểm tra ở mục bên dưới).
              </p>
            </CardContent>
          </Card>

          {/* Đơn đã đồng bộ */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Đơn đã đồng bộ lên Sheet
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={loadSynced} disabled={syncLoad}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncLoad ? "animate-spin" : ""}`} />
                  Làm mới
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {syncLoad ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : synced.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-6">
                  Chưa có đơn nào được đồng bộ lên Sheet
                </p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {synced.slice(0, 100).map((e, i) => (
                    <div key={i} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                      <span className="font-mono">{e.order_id}</span>
                      <Badge variant="outline" className="text-xs">{e.tab}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
