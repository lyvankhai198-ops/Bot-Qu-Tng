/**
 * layout.tsx — Admin Panel Layout
 * Sidebar có nhóm thu gọn, tìm kiếm, ghim nhanh, badge, icon-only desktop mode
 */
import * as React from "react"
import { useLocation, Link } from "wouter"
import {
  LayoutDashboard, Users, Package, ShoppingCart, Store, Truck,
  ShieldCheck, Search, Calculator, WalletCards, RefreshCw,
  TableProperties, Activity, Send, FileText, CalendarCheck,
  Gift, PackageOpen, Target, Settings as SettingsIcon,
  LogOut, Bot, Menu, X, ChevronDown, ChevronRight,
  Star, PanelLeftClose, PanelLeftOpen,
} from "lucide-react"
import { Button } from "./ui/button"
import {
  Tooltip, TooltipContent, TooltipTrigger, TooltipProvider,
} from "./ui/tooltip"

// ─────────────────────────── types ────────────────────────────────────────────

type BadgeKey = "warranty" | "delivery" | "syncRobot"

interface NavItem {
  href:      string
  label:     string
  icon:      React.ElementType
  badgeKey?: BadgeKey
}

interface NavGroup {
  key:   string
  label: string
  items: NavItem[]
}

// ─────────────────────────── nav structure ────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    key: "tong-quan", label: "TỔNG QUAN",
    items: [
      { href: "/dashboard",  label: "Tổng quan",     icon: LayoutDashboard },
      { href: "/users",      label: "Người dùng",     icon: Users },
      { href: "/accounts",   label: "Kho tài khoản", icon: Package },
    ],
  },
  {
    key: "don-hang", label: "ĐƠN HÀNG",
    items: [
      { href: "/orders",        label: "Đơn hàng",      icon: ShoppingCart },
      { href: "/market-orders", label: "Đơn hàng chợ", icon: Store },
      { href: "/delivery",      label: "Giao tài khoản", icon: Truck, badgeKey: "delivery" },
    ],
  },
  {
    key: "bao-hanh", label: "BẢO HÀNH & HOÀN TIỀN",
    items: [
      { href: "/warranty",       label: "Bảo hành",            icon: ShieldCheck, badgeKey: "warranty" },
      { href: "/warranty-scan",  label: "Quét đơn còn BH",     icon: Search },
      { href: "/refund-calc",    label: "Máy tính hoàn tiền",  icon: Calculator },
      { href: "/refund-history", label: "Lịch sử hoàn tiền",  icon: WalletCards },
    ],
  },
  {
    key: "dong-bo", label: "ĐỒNG BỘ",
    items: [
      { href: "/sync-robot",  label: "Robot đồng bộ",        icon: RefreshCw, badgeKey: "syncRobot" },
      { href: "/sheets-sync", label: "Đồng bộ Google Sheets", icon: TableProperties },
      { href: "/logs",        label: "Lịch sử hệ thống",     icon: Activity },
    ],
  },
  {
    key: "cham-soc", label: "CHĂM SÓC KHÁCH HÀNG",
    items: [
      { href: "/broadcast", label: "Gửi tin nhắn",   icon: Send },
      { href: "/intro",     label: "Cấu hình Intro", icon: FileText },
    ],
  },
  {
    key: "qua-tang", label: "QUÀ TẶNG",
    items: [
      { href: "/checkin",      label: "Điểm danh",     icon: CalendarCheck },
      { href: "/receivers",    label: "Đã nhận quà",   icon: Gift },
      { href: "/gift-boxes",   label: "Ô Quà Bí Mật",  icon: PackageOpen },
      { href: "/secret-codes", label: "Săn mã bí mật", icon: Target },
    ],
  },
  {
    key: "he-thong", label: "HỆ THỐNG",
    items: [
      { href: "/settings", label: "Cài đặt", icon: SettingsIcon },
    ],
  },
]

// All items flat (for search & label lookup)
const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap(g => g.items)

const DEFAULT_PINS = ["/market-orders", "/warranty-scan", "/sheets-sync"]
const LS_PINS      = "sidebar_pins_v1"
const LS_GROUPS    = "sidebar_groups_v1"
const LS_COLLAPSED = "sidebar_collapsed_v1"

// ─────────────────────────── helpers ──────────────────────────────────────────

function normalizeVi(s: string): string {
  return s.toLowerCase()
    .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
    .replace(/[èéẹẻẽêềếệểễ]/g, "e")
    .replace(/[ìíịỉĩ]/g, "i")
    .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
    .replace(/[ùúụủũưừứựửữ]/g, "u")
    .replace(/[ỳýỵỷỹ]/g, "y")
    .replace(/đ/g, "d")
}

function lsGetArray(key: string, fallback: string[]): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "") } catch { return fallback }
}
function lsGetObj(key: string, fallback: Record<string, boolean>): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(key) ?? "") } catch { return fallback }
}

// ─────────────────────────── pending counts hook ──────────────────────────────

interface PendingCounts { delivery: number; warranty: number; syncRobot: number }

function usePendingCounts(): PendingCounts {
  const [counts, setCounts] = React.useState<PendingCounts>({ delivery: 0, warranty: 0, syncRobot: 0 })
  const fetch_ = React.useCallback(async () => {
    const token = localStorage.getItem("admin_token")
    if (!token) return
    try {
      const res = await fetch("/api/bot/pending-counts", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setCounts(await res.json())
    } catch { /* non-critical */ }
  }, [])
  React.useEffect(() => {
    fetch_()
    const id = setInterval(fetch_, 30_000)
    return () => clearInterval(id)
  }, [fetch_])
  return counts
}

// ─────────────────────────── badge ────────────────────────────────────────────

function Badge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-auto flex-shrink-0 min-w-[20px] h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  )
}

// ─────────────────────────── single nav item row ──────────────────────────────

function NavRow({
  item, isActive, badgeCount, collapsed, onNavigate, pinned, onTogglePin, showPin,
}: {
  item: NavItem
  isActive: boolean
  badgeCount: number
  collapsed: boolean
  onNavigate: () => void
  pinned: boolean
  onTogglePin: (href: string) => void
  showPin: boolean
}) {
  const Icon = item.icon
  const row = (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "group relative flex items-center gap-3 rounded-md transition-colors",
        "text-[15px] font-medium select-none",
        collapsed ? "px-0 py-2.5 justify-center mx-1" : "px-3 py-[11px] mx-1",
        isActive
          ? "bg-primary/10 text-primary"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
      ].join(" ")}
    >
      {/* active indicator */}
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-primary" />
      )}
      <Icon className={[
        "h-[18px] w-[18px] flex-shrink-0",
        isActive ? "text-primary" : "opacity-60 group-hover:opacity-100",
      ].join(" ")} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          <Badge count={badgeCount} />
          {showPin && (
            <button
              onClick={e => { e.preventDefault(); e.stopPropagation(); onTogglePin(item.href) }}
              className={[
                "opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded",
                pinned ? "opacity-100 text-yellow-500" : "text-sidebar-foreground/40 hover:text-yellow-400",
              ].join(" ")}
              title={pinned ? "Bỏ ghim" : "Ghim vào Dùng nhanh"}
              aria-label={pinned ? "Bỏ ghim" : "Ghim"}
            >
              <Star className={["h-3.5 w-3.5", pinned ? "fill-yellow-400" : ""].join(" ")} />
            </button>
          )}
        </>
      )}
    </Link>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right" className="flex items-center gap-2">
          {item.label}
          {badgeCount > 0 && <Badge count={badgeCount} />}
        </TooltipContent>
      </Tooltip>
    )
  }
  return row
}

// ─────────────────────────── sidebar content ──────────────────────────────────

function SidebarContent({
  collapsed,
  onCollapse,
  onNavigate,
  location,
  counts,
}: {
  collapsed: boolean
  onCollapse: () => void
  onNavigate: () => void
  location: string
  counts: PendingCounts
}) {
  // Search
  const [query, setQuery] = React.useState("")
  const normQuery = normalizeVi(query.trim())

  // Pinned items
  const [pins, setPins] = React.useState<string[]>(() => lsGetArray(LS_PINS, DEFAULT_PINS))
  const togglePin = React.useCallback((href: string) => {
    setPins(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
      localStorage.setItem(LS_PINS, JSON.stringify(next))
      return next
    })
  }, [])

  // Group open/close — default: open group that contains active route
  const activeGroup = NAV_GROUPS.find(g => g.items.some(i => location.startsWith(i.href)))?.key ?? ""
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() => {
    const saved = lsGetObj(LS_GROUPS, {})
    // ensure active group is open
    if (activeGroup && saved[activeGroup] === undefined) saved[activeGroup] = true
    return saved
  })

  // Open active group when location changes
  React.useEffect(() => {
    if (!activeGroup) return
    setOpenGroups(prev => {
      if (prev[activeGroup]) return prev
      const next = { ...prev, [activeGroup]: true }
      localStorage.setItem(LS_GROUPS, JSON.stringify(next))
      return next
    })
  }, [activeGroup])

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(LS_GROUPS, JSON.stringify(next))
      return next
    })
  }

  // Filtered items for search
  const searchResults = normQuery
    ? ALL_ITEMS.filter(i => normalizeVi(i.label).includes(normQuery))
    : []

  const pinnedItems = ALL_ITEMS.filter(i => pins.includes(i.href))

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className={[
        "flex items-center border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground flex-shrink-0",
        collapsed ? "flex-col gap-1 py-3 px-2" : "px-4 py-3 gap-3",
      ].join(" ")}>
        <Bot className="h-5 w-5 flex-shrink-0" />
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-[15px] truncate leading-tight">Bot Quà Tặng AI</h1>
            <p className="text-[11px] opacity-70 leading-tight mt-0.5">Admin Panel v2.0</p>
          </div>
        )}
        {/* Status dot */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={["w-2 h-2 rounded-full bg-green-400 shadow-sm flex-shrink-0", collapsed ? "" : ""].join(" ")} />
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "bottom"}>Hệ thống đang hoạt động</TooltipContent>
        </Tooltip>
      </div>

      {/* ── Search ── */}
      {!collapsed && (
        <div className="px-3 py-2 border-b border-sidebar-border flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-sidebar-foreground/40 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm chức năng…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-md border border-sidebar-border bg-sidebar-accent/30 text-sidebar-foreground placeholder:text-sidebar-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-sidebar-foreground/40 hover:text-sidebar-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Scrollable nav area ── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2">

        {/* Search results */}
        {normQuery ? (
          <div>
            {searchResults.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-sidebar-foreground/50">Không tìm thấy chức năng nào.</p>
            ) : (
              <div>
                <p className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
                  Kết quả ({searchResults.length})
                </p>
                {searchResults.map(item => (
                  <NavRow
                    key={item.href}
                    item={item}
                    isActive={location.startsWith(item.href)}
                    badgeCount={"badgeKey" in item && item.badgeKey ? counts[item.badgeKey] ?? 0 : 0}
                    collapsed={collapsed}
                    onNavigate={() => { setQuery(""); onNavigate() }}
                    pinned={pins.includes(item.href)}
                    onTogglePin={togglePin}
                    showPin={true}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Dùng nhanh */}
            {pinnedItems.length > 0 && (
              <div className="mb-1">
                {!collapsed && (
                  <p className="px-4 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
                    Dùng nhanh
                  </p>
                )}
                {collapsed && <div className="mx-1 my-1 border-t border-sidebar-border/50" />}
                {pinnedItems.map(item => (
                  <NavRow
                    key={item.href}
                    item={item}
                    isActive={location.startsWith(item.href)}
                    badgeCount={"badgeKey" in item && item.badgeKey ? counts[item.badgeKey] ?? 0 : 0}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                    pinned={true}
                    onTogglePin={togglePin}
                    showPin={true}
                  />
                ))}
                {!collapsed && <div className="mx-3 mt-2 border-t border-sidebar-border/40" />}
              </div>
            )}

            {/* Groups */}
            {NAV_GROUPS.map(group => {
              const isOpen = openGroups[group.key] ?? false
              return (
                <div key={group.key} className="mb-0.5">
                  {/* Group header */}
                  {collapsed ? (
                    <div className="mx-1 my-1.5 border-t border-sidebar-border/30" />
                  ) : (
                    <button
                      onClick={() => toggleGroup(group.key)}
                      className="w-full flex items-center gap-1 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors"
                    >
                      <span className="flex-1 text-left">{group.label}</span>
                      {isOpen
                        ? <ChevronDown className="h-3 w-3 flex-shrink-0" />
                        : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
                    </button>
                  )}

                  {/* Group items */}
                  {(collapsed || isOpen) && group.items.map(item => (
                    <NavRow
                      key={item.href}
                      item={item}
                      isActive={location.startsWith(item.href)}
                      badgeCount={item.badgeKey ? counts[item.badgeKey] ?? 0 : 0}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                      pinned={pins.includes(item.href)}
                      onTogglePin={togglePin}
                      showPin={true}
                    />
                  ))}
                </div>
              )
            })}
          </>
        )}
      </nav>

      {/* ── Logout + collapse toggle ── */}
      <div className="flex-shrink-0 border-t border-sidebar-border p-2 space-y-1">
        {/* Logout */}
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onNavigate}
                className="w-full flex justify-center py-2.5 rounded-md text-sidebar-foreground/60 hover:text-red-500 hover:bg-red-50/10 transition-colors"
                data-logout="true"
              >
                <LogOut className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Đăng xuất</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={onNavigate}
            data-logout="true"
            className="w-full flex items-center gap-3 px-3 py-[11px] mx-0 rounded-md text-[15px] font-medium text-sidebar-foreground/60 hover:text-red-500 hover:bg-red-50/10 transition-colors"
          >
            <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
            <span>Đăng xuất</span>
          </button>
        )}

        {/* Desktop collapse toggle */}
        <button
          onClick={onCollapse}
          className={[
            "hidden md:flex w-full items-center rounded-md py-2 text-[13px] text-sidebar-foreground/40 hover:text-sidebar-foreground/70 hover:bg-sidebar-accent/40 transition-colors",
            collapsed ? "justify-center px-0" : "gap-2 px-3",
          ].join(" ")}
          title={collapsed ? "Mở rộng sidebar" : "Thu nhỏ sidebar"}
        >
          {collapsed
            ? <PanelLeftOpen className="h-4 w-4" />
            : <><PanelLeftClose className="h-4 w-4" /><span>Thu gọn</span></>}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────── Layout ───────────────────────────────────────────

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation()
  const [drawerOpen,  setDrawerOpen]  = React.useState(false)
  const [collapsed,   setCollapsed]   = React.useState(() =>
    localStorage.getItem(LS_COLLAPSED) === "true"
  )
  const counts = usePendingCounts()

  const closeDrawer = React.useCallback(() => setDrawerOpen(false), [])

  const handleCollapse = () => {
    setCollapsed(v => {
      localStorage.setItem(LS_COLLAPSED, String(!v))
      return !v
    })
  }

  const handleLogoutClick = React.useCallback(() => {
    closeDrawer()
    localStorage.removeItem("admin_token")
    setLocation("/login")
  }, [closeDrawer, setLocation])

  // Close drawer when route changes
  React.useEffect(() => { closeDrawer() }, [location, closeDrawer])

  // Prevent body scroll when drawer open
  React.useEffect(() => {
    document.body.style.overflow = drawerOpen ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [drawerOpen])

  const currentLabel = ALL_ITEMS.find(i => location.startsWith(i.href))?.label ?? "Trang quản trị"
  const totalPending = counts.delivery + counts.warranty + counts.syncRobot

  // Intercept logout clicks bubbling from SidebarContent
  const handleSidebarNav = React.useCallback((e?: React.MouseEvent) => {
    closeDrawer()
  }, [closeDrawer])

  const handleSidebarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest("[data-logout]")) {
      handleLogoutClick()
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-[100dvh] bg-background" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>

        {/* ── DESKTOP SIDEBAR ── */}
        <aside
          className={[
            "hidden md:flex flex-col border-r border-border bg-sidebar flex-shrink-0 transition-all duration-200",
            collapsed ? "w-16" : "w-60",
          ].join(" ")}
          onClick={handleSidebarClick}
        >
          <SidebarContent
            collapsed={collapsed}
            onCollapse={handleCollapse}
            onNavigate={closeDrawer}
            location={location}
            counts={counts}
          />
        </aside>

        {/* ── MOBILE BACKDROP ── */}
        {drawerOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden backdrop-blur-[1px]"
            onClick={closeDrawer}
            aria-hidden="true"
          />
        )}

        {/* ── MOBILE DRAWER ── */}
        <aside
          className={[
            "fixed inset-y-0 left-0 z-50 bg-sidebar flex flex-col md:hidden",
            "w-[84vw] max-w-[340px]",
            "transform transition-transform duration-300 ease-in-out",
            drawerOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
          ].join(" ")}
          style={{ paddingTop: "env(safe-area-inset-top)" }}
          aria-label="Menu điều hướng"
          onClick={handleSidebarClick}
        >
          {/* Close button */}
          <button
            onClick={closeDrawer}
            className="absolute top-3 right-3 z-10 p-2 rounded-full bg-sidebar-accent/60 text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
            aria-label="Đóng menu"
            style={{ top: "calc(0.75rem + env(safe-area-inset-top))" }}
          >
            <X className="h-5 w-5" />
          </button>
          <SidebarContent
            collapsed={false}
            onCollapse={() => {}}
            onNavigate={closeDrawer}
            location={location}
            counts={counts}
          />
        </aside>

        {/* ── MAIN ── */}
        <main className="flex-1 flex flex-col min-w-0 w-full overflow-hidden">

          {/* Header */}
          <header
            className="border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-30 flex-shrink-0"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="h-14 md:h-[52px] flex items-center gap-3 px-4 md:px-6">
              {/* Hamburger — mobile only */}
              <div className="relative md:hidden">
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="p-2 -ml-1 rounded-md text-foreground/60 hover:text-foreground hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                  aria-label="Mở menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                {totalPending > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[17px] text-center pointer-events-none">
                    {totalPending > 99 ? "99+" : totalPending}
                  </span>
                )}
              </div>

              <h2 className="font-semibold text-base text-foreground truncate flex-1">
                {currentLabel}
              </h2>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
