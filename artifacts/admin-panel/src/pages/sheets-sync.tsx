/**
 * sheets-sync.tsx — Trang "Đồng bộ Sheet"
 * Cấu hình Google Sheets: Spreadsheet ID, tab mặc định, ánh xạ sản phẩm → tab
 */
import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import {
  Save, Loader2, Plus, Trash2, RefreshCw,
  TableProperties, Wifi, WifiOff, BookOpen, CheckCircle2, Upload,
  ChevronRight, ChevronDown, ShieldCheck, ShieldX,
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

interface TabRule {
  tab:     string
  include: string[]
  exclude: string[]
}

interface SheetsConfig {
  spreadsheet_id: string
  default_tab:    string
  market_tab:     string
  sync_enabled:   boolean
  tab_mappings:   Record<string, string>   // backward compat
  tab_rules:      TabRule[]                // new include/exclude system
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

  const [pushing,       setPushing]       = useState(false)
  const [showPushDlg,   setShowPushDlg]   = useState(false)
  const [selectedTab,   setSelectedTab]   = useState("all")

  const [cfg,     setCfg]     = useState<SheetsConfig>({
    spreadsheet_id: "", default_tab: "Đơn hàng", market_tab: "Đơn hàng chợ",
    sync_enabled: false, tab_mappings: {}, tab_rules: [],
  })
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [synced,   setSynced]   = useState<SyncedEntry[]>([])
  const [syncLoad, setSyncLoad] = useState(false)
  // Trạng thái mở/đóng từng rule card
  const [openRules, setOpenRules] = useState<Record<number, boolean>>({})

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

  async function pushAll(tab: string) {
    setShowPushDlg(false)
    setPushing(true)
    try {
      const res = await apiFetch("POST", "/bot/sheets/push-all", { tab })
      let desc = res.message ?? ""
      if (res.ok && res.tab_summary && Object.keys(res.tab_summary).length > 0) {
        const tabLines = Object.entries(res.tab_summary as Record<string, number>)
          .map(([t, count]) => `• ${t}: ${count} đơn`)
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

  // Tính danh sách tab có thể chọn để đẩy
  const pushTabOptions = useMemo(() => {
    const tabs = new Set<string>()
    cfg.tab_rules?.forEach(r => r.tab && tabs.add(r.tab.trim()))
    Object.values(cfg.tab_mappings || {}).forEach(t => tabs.add(t.trim()))
    if (cfg.default_tab) tabs.add(cfg.default_tab.trim())
    return Array.from(tabs).filter(Boolean)
  }, [cfg.tab_rules, cfg.tab_mappings, cfg.default_tab])

  // Rule CRUD
  function addRule() {
    const blank: TabRule = { tab: "", include: [], exclude: [] }
    setCfg(c => ({ ...c, tab_rules: [...(c.tab_rules || []), blank] }))
    const newIdx = (cfg.tab_rules?.length || 0)
    setOpenRules(o => ({ ...o, [newIdx]: true }))
  }
  function updateRule(idx: number, rule: TabRule) {
    setCfg(c => {
      const rules = [...(c.tab_rules || [])]
      rules[idx] = rule
      return { ...c, tab_rules: rules }
    })
  }
  function deleteRule(idx: number) {
    setCfg(c => ({ ...c, tab_rules: (c.tab_rules || []).filter((_, i) => i !== idx) }))
    setOpenRules(o => {
      const next: Record<number, boolean> = {}
      Object.entries(o).forEach(([k, v]) => {
        const n = Number(k)
        if (n < idx) next[n] = v
        else if (n > idx) next[n - 1] = v
      })
      return next
    })
  }

  // Parse textarea → string[]
  function parseKws(text: string): string[] {
    return text.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
  }

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
          <Button variant="outline" onClick={() => setShowPushDlg(true)} disabled={pushing || loading}>
            {pushing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Đang đẩy…</>
              : <><Upload  className="h-4 w-4 mr-2" />Đẩy lên Sheet</>}
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

          {/* Ánh xạ sản phẩm → Tab (include / exclude) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Ánh xạ sản phẩm → Tab Sheet</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Mỗi tab có từ khóa <span className="text-green-600 font-medium">Bao gồm</span> và{" "}
                  <span className="text-destructive font-medium">Loại trừ</span>.
                  Nhập mỗi từ khóa một dòng, không phân biệt hoa thường.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={addRule}>
                <Plus className="h-4 w-4 mr-1" /> Thêm tab
              </Button>
            </div>

            {(!cfg.tab_rules || cfg.tab_rules.length === 0) && (
              <div className="border border-dashed rounded-lg py-8 text-center text-muted-foreground text-sm">
                Chưa có tab nào. Bấm <strong>Thêm tab</strong> để bắt đầu.
              </div>
            )}

            {(cfg.tab_rules || []).map((rule, idx) => {
              const isOpen = openRules[idx] ?? false
              return (
                <Card key={idx} className="overflow-hidden">
                  {/* Header rule */}
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-muted/40 transition-colors"
                    onClick={() => setOpenRules(o => ({ ...o, [idx]: !o[idx] }))}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                      <span className="font-medium text-sm truncate">
                        {rule.tab || <span className="text-muted-foreground italic">(chưa đặt tên)</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                      <Badge variant="outline" className="text-xs gap-1 text-green-700 border-green-300">
                        <ShieldCheck className="h-3 w-3" />{rule.include.length}
                      </Badge>
                      {rule.exclude.length > 0 && (
                        <Badge variant="outline" className="text-xs gap-1 text-destructive border-destructive/30">
                          <ShieldX className="h-3 w-3" />{rule.exclude.length}
                        </Badge>
                      )}
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={e => { e.stopPropagation(); deleteRule(idx) }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Body rule */}
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 border-t">
                      <div className="pt-3 space-y-1.5">
                        <Label className="text-xs font-medium">Tên tab trong Google Sheet</Label>
                        <Input
                          value={rule.tab}
                          onChange={e => updateRule(idx, { ...rule, tab: e.target.value })}
                          placeholder="vd: ChatGPT BHF"
                          className="text-sm"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium flex items-center gap-1">
                          <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-green-700">Bao gồm</span>
                          <span className="text-muted-foreground font-normal ml-1">— một từ khóa mỗi dòng</span>
                        </Label>
                        <Textarea
                          value={rule.include.join("\n")}
                          onChange={e => updateRule(idx, { ...rule, include: parseKws(e.target.value.replace(/,/g, "\n")) })}
                          onBlur={e => updateRule(idx, { ...rule, include: parseKws(e.target.value) })}
                          placeholder={"chatgpt\nchat gpt\ngpt plus"}
                          className="text-sm font-mono min-h-[80px] resize-y"
                          rows={4}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium flex items-center gap-1">
                          <ShieldX className="h-3.5 w-3.5 text-destructive" />
                          <span className="text-destructive">Loại trừ</span>
                          <span className="text-muted-foreground font-normal ml-1">— tên có từ này sẽ bị bỏ qua</span>
                        </Label>
                        <Textarea
                          value={rule.exclude.join("\n")}
                          onChange={e => updateRule(idx, { ...rule, exclude: parseKws(e.target.value.replace(/,/g, "\n")) })}
                          onBlur={e => updateRule(idx, { ...rule, exclude: parseKws(e.target.value) })}
                          placeholder={"api\ntoken\ncredit"}
                          className="text-sm font-mono min-h-[60px] resize-y"
                          rows={3}
                        />
                      </div>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

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

      {/* Dialog chọn loại đẩy */}
      <Dialog open={showPushDlg} onOpenChange={setShowPushDlg}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Chọn loại đơn cần đẩy lên Sheet
            </DialogTitle>
            <DialogDescription>
              Chọn tab muốn đẩy, hoặc đẩy tất cả cùng lúc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-1">
            {/* Đẩy tất cả */}
            <button
              onClick={() => { setSelectedTab("all"); pushAll("all") }}
              className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm font-medium transition-colors
                ${selectedTab === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-muted border-border"}`}
            >
              <span>🗂 Tất cả đơn</span>
              <ChevronRight className="h-4 w-4 opacity-50" />
            </button>

            {/* Từng tab */}
            {pushTabOptions.map(tab => (
              <button
                key={tab}
                onClick={() => { setSelectedTab(tab); pushAll(tab) }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border text-sm transition-colors
                  ${selectedTab === tab
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-muted border-border"}`}
              >
                <span>📋 {tab}</span>
                <ChevronRight className="h-4 w-4 opacity-50" />
              </button>
            ))}

            {pushTabOptions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">
                Chưa có ánh xạ tab — thêm ở mục "Ánh xạ sản phẩm" bên dưới
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPushDlg(false)}>Hủy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
