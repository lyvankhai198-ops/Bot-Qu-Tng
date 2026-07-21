import * as React from "react"
import { useLocation, Link } from "wouter"
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  ShieldAlert,
  Send,
  Settings as SettingsIcon,
  FileText,
  Gift,
  Activity,
  LogOut,
  Bot,
  Menu,
  X,
  Wallet,
  RefreshCw,
  CalendarCheck,
  Target,
  Truck,
} from "lucide-react"
import { Button } from "./ui/button"

// ── Pending counts types ──────────────────────────────────────────────────────
interface PendingCounts {
  delivery: number
  warranty: number
  syncRobot: number
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("admin_token") ?? ""}` }
}

function usePendingCounts(): PendingCounts {
  const [counts, setCounts] = React.useState<PendingCounts>({ delivery: 0, warranty: 0, syncRobot: 0 })

  const fetchCounts = React.useCallback(async () => {
    const token = localStorage.getItem("admin_token")
    if (!token) return
    try {
      const res = await fetch("/api/bot/pending-counts", { headers: authHeader() })
      if (res.ok) setCounts(await res.json())
    } catch {
      // silently ignore — badge is non-critical
    }
  }, [])

  React.useEffect(() => {
    fetchCounts()
    const id = setInterval(fetchCounts, 30_000)
    return () => clearInterval(id)
  }, [fetchCounts])

  return counts
}

// ── Nav items (static) ────────────────────────────────────────────────────────
const navItems = [
  { href: "/dashboard",      label: "Tổng quan",          icon: LayoutDashboard },
  { href: "/accounts",       label: "Kho tài khoản",       icon: Package },
  { href: "/users",          label: "Người dùng",           icon: Users },
  { href: "/orders",         label: "Đơn hàng",             icon: ShoppingCart },
  { href: "/warranty",       label: "Bảo hành",             icon: ShieldAlert,  badgeKey: "warranty" },
  { href: "/delivery",       label: "Giao tài khoản",       icon: Truck,         badgeKey: "delivery" },
  { href: "/broadcast",      label: "Gửi tin nhắn",         icon: Send },
  { href: "/intro",          label: "Cấu hình Intro",       icon: FileText },
  { href: "/receivers",      label: "Đã nhận quà",          icon: Gift },
  { href: "/refund-history", label: "Lịch sử hoàn tiền",   icon: Wallet },
  { href: "/checkin",        label: "Điểm danh",            icon: CalendarCheck },
  { href: "/gift-boxes",     label: "Ô Quà Bí Mật",         icon: Gift },
  { href: "/secret-codes",   label: "Săn mã bí mật",        icon: Target },
  { href: "/sync-robot",     label: "Robot Đồng Bộ",        icon: RefreshCw,     badgeKey: "syncRobot" },
  { href: "/logs",           label: "Lịch sử hệ thống",    icon: Activity },
  { href: "/settings",       label: "Cài đặt",              icon: SettingsIcon },
] as const

type BadgeKey = "delivery" | "warranty" | "syncRobot"

// ── Badge bubble ──────────────────────────────────────────────────────────────
function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span className="ml-auto flex-shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-5 text-center tabular-nums shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const counts = usePendingCounts()

  const handleLogout = () => {
    localStorage.removeItem("admin_token")
    setLocation("/login")
  }

  const closeDrawer = () => setDrawerOpen(false)

  // Close drawer on route change
  React.useEffect(() => {
    closeDrawer()
  }, [location])

  // Prevent body scroll when drawer open
  React.useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [drawerOpen])

  const currentLabel = navItems.find(i => location.startsWith(i.href))?.label || "Trang quản trị"

  // Total pending for mobile header indicator
  const totalPending = counts.delivery + counts.warranty + counts.syncRobot

  const NavContent = () => (
    <>
      {/* Brand header */}
      <div className="h-16 flex items-center px-5 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground flex-shrink-0">
        <Bot className="h-5 w-5 mr-3 flex-shrink-0" />
        <h1 className="font-bold text-base tracking-tight truncate">Bot Quà Tặng AI</h1>
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 flex flex-col gap-0.5 px-2 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.startsWith(item.href)
          const badgeCount = "badgeKey" in item ? counts[item.badgeKey as BadgeKey] ?? 0 : 0
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={closeDrawer}
              className={
                `flex items-center gap-3 px-3 py-3 rounded-md transition-colors text-sm font-medium min-h-[44px]
                ${isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`
              }
            >
              <item.icon className={`h-4 w-4 flex-shrink-0 ${isActive ? "text-primary" : "opacity-70"}`} />
              <span className="flex-1 truncate">{item.label}</span>
              <NavBadge count={badgeCount} />
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-sidebar-border flex-shrink-0">
        <Button
          variant="ghost"
          className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 min-h-[44px]"
          onClick={() => { closeDrawer(); handleLogout() }}
        >
          <LogOut className="h-4 w-4 mr-2 opacity-70" />
          Đăng xuất
        </Button>
      </div>
    </>
  )

  return (
    <div className="flex min-h-[100dvh] bg-background">

      {/* ── DESKTOP SIDEBAR (md+) ── */}
      <aside className="hidden md:flex w-64 border-r border-border bg-sidebar flex-shrink-0 flex-col">
        <NavContent />
      </aside>

      {/* ── MOBILE DRAWER BACKDROP ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* ── MOBILE DRAWER PANEL ── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sidebar flex flex-col
          transform transition-transform duration-300 ease-in-out md:hidden
          ${drawerOpen ? "translate-x-0" : "-translate-x-full"}
        `}
        aria-label="Navigation menu"
      >
        {/* Close button inside drawer */}
        <button
          onClick={closeDrawer}
          className="absolute top-3 right-3 p-2 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label="Đóng menu"
        >
          <X className="h-5 w-5" />
        </button>
        <NavContent />
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 flex flex-col min-w-0 w-full">

        {/* Top header */}
        <header className="h-14 md:h-16 border-b border-border bg-card/50 flex items-center gap-3 px-4 md:px-8 backdrop-blur-sm sticky top-0 z-30">
          {/* Hamburger — mobile only, with total-pending dot */}
          <div className="relative md:hidden">
            <button
              onClick={() => setDrawerOpen(true)}
              className="p-2 -ml-1 rounded-md text-foreground/70 hover:text-foreground hover:bg-muted transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Mở menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            {totalPending > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center pointer-events-none shadow-sm">
                {totalPending > 99 ? "99+" : totalPending}
              </span>
            )}
          </div>

          <h2 className="font-semibold text-base md:text-lg text-foreground truncate">
            {currentLabel}
          </h2>
        </header>

        {/* Page content */}
        <div className="flex-1 p-4 md:p-8 overflow-y-auto overflow-x-hidden">
          <div className="max-w-6xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
