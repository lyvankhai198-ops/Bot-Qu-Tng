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
  Bot
} from "lucide-react"
import { Button } from "./ui/button"

const navItems = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/accounts", label: "Kho tài khoản", icon: Package },
  { href: "/users", label: "Người dùng", icon: Users },
  { href: "/orders", label: "Đơn hàng", icon: ShoppingCart },
  { href: "/warranty", label: "Bảo hành", icon: ShieldAlert },
  { href: "/broadcast", label: "Gửi tin nhắn", icon: Send },
  { href: "/intro", label: "Cấu hình Intro", icon: FileText },
  { href: "/receivers", label: "Đã nhận quà", icon: Gift },
  { href: "/logs", label: "Lịch sử hệ thống", icon: Activity },
  { href: "/settings", label: "Cài đặt", icon: SettingsIcon },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation()

  const handleLogout = () => {
    localStorage.removeItem("admin_token")
    setLocation("/login")
  }

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border bg-sidebar-primary text-sidebar-primary-foreground">
          <Bot className="h-6 w-6 mr-3" />
          <h1 className="font-bold text-lg tracking-tight">Bot Quà Tặng AI</h1>
        </div>
        
        <nav className="flex-1 py-4 flex flex-col gap-1 px-3 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href)
            return (
              <Link key={item.href} href={item.href} className={
                `flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium
                ${isActive 
                  ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"}`
              }>
                <item.icon className={`h-4 w-4 ${isActive ? "text-primary" : "opacity-70"}`} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50" 
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4 mr-2 opacity-70" />
            Đăng xuất
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-card/50 flex items-center px-8 backdrop-blur-sm sticky top-0 z-10">
          <h2 className="font-semibold text-lg text-foreground">
            {navItems.find(i => location.startsWith(i.href))?.label || "Trang quản trị"}
          </h2>
        </header>
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  )
}
