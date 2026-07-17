import { useGetBotStats, useGetBotSettings, useHealthCheck, useGetBotLogs, getGetBotLogsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Users, Package, Gift, Ban, ShoppingCart, ShieldAlert, Activity, ShieldCheck, ShieldX, ServerCrash, Clock, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { format } from "date-fns"

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetBotStats()
  const { data: settings, isLoading: settingsLoading } = useGetBotSettings()
  const { data: health } = useHealthCheck()
  const { data: logs, isLoading: logsLoading } = useGetBotLogs({ limit: 10 })

  const statCards = [
    { title: "Tổng người dùng", value: stats?.totalUsers, icon: Users, color: "text-blue-500" },
    { title: "Kho tài khoản", value: stats?.stock, icon: Package, color: "text-green-500" },
    { title: "Đã phát", value: stats?.claimed, icon: Gift, color: "text-purple-500" },
    { title: "Đã cấm", value: stats?.banned, icon: Ban, color: "text-red-500" },
    { title: "Tổng đơn hàng", value: stats?.totalOrders, icon: ShoppingCart, color: "text-orange-500" },
    { title: "Yêu cầu bảo hành", value: stats?.warrantyPending, icon: ShieldAlert, color: "text-yellow-500" },
  ]

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tổng quan</h1>
          <p className="text-muted-foreground mt-1">Thông số và trạng thái hoạt động của Bot</p>
        </div>
        {health && (
          <Badge variant={health.status === "ok" ? "default" : "destructive"} className="px-3 py-1 text-sm">
            {health.status === "ok" ? <><Activity className="w-4 h-4 mr-2" /> Đang hoạt động</> : <><ServerCrash className="w-4 h-4 mr-2" /> Lỗi hệ thống</>}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((card, i) => (
          <Card key={i}>
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{card.title}</p>
                {statsLoading ? (
                  <div className="h-8 w-16 bg-muted animate-pulse rounded" />
                ) : (
                  <h3 className="text-3xl font-bold">{card.value?.toLocaleString() || 0}</h3>
                )}
              </div>
              <div className={`p-4 rounded-xl bg-muted/50 ${card.color}`}>
                <card.icon className="w-6 h-6" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Hoạt động gần đây</CardTitle>
            <CardDescription>Các thao tác mới nhất trên hệ thống</CardDescription>
          </CardHeader>
          <CardContent>
            {logsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
              </div>
            ) : logs && logs.length > 0 ? (
              <div className="space-y-4">
                {logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-4 p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="p-2 bg-primary/10 text-primary rounded-full mt-0.5">
                      <Activity className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{log.action}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(log.time).toLocaleString('vi-VN')}</span>
                        <span className="flex items-center gap-1"><User className="w-3 h-3" /> {log.user}</span>
                        {log.admin && <span className="flex items-center gap-1 font-mono bg-muted px-1.5 py-0.5 rounded text-[10px]">Admin: {log.admin}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">Không có hoạt động nào gần đây</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trạng thái cấu hình</CardTitle>
            <CardDescription>Các cài đặt hiện tại</CardDescription>
          </CardHeader>
          <CardContent>
            {settingsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded" />)}
              </div>
            ) : settings ? (
              <div className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-sm font-medium">Trạng thái phát quà</span>
                  <Badge variant={settings.giftEnabled ? "default" : "secondary"}>
                    {settings.giftEnabled ? "Đang bật" : "Đang tắt"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-sm font-medium">Bảo trì hệ thống</span>
                  <Badge variant={settings.maintenanceMode ? "destructive" : "secondary"}>
                    {settings.maintenanceMode ? "Đang bảo trì" : "Bình thường"}
                  </Badge>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-sm font-medium">Round hiện tại</span>
                  <span className="font-mono text-sm bg-muted px-2 py-1 rounded">{settings.roundId || "Chưa có"}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-border/50">
                  <span className="text-sm font-medium">Hỗ trợ</span>
                  <Badge variant={settings.supportEnabled ? "default" : "secondary"}>
                    {settings.supportEnabled ? "Đang bật" : "Đang tắt"}
                  </Badge>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
