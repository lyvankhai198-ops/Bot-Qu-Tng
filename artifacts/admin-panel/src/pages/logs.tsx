import { useState } from "react"
import { useGetBotLogs, getGetBotLogsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Activity, Clock, User, Shield } from "lucide-react"

export default function Logs() {
  const [limit, setLimit] = useState(50)
  const { data: logs, isLoading } = useGetBotLogs({ limit }, { query: { queryKey: getGetBotLogsQueryKey({ limit }) } })

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Lịch sử hệ thống</h1>
          <p className="text-muted-foreground mt-1 text-sm">Ghi log các hoạt động và thao tác của bot & admin</p>
        </div>
        <div className="w-full sm:w-44">
          <Select value={limit.toString()} onValueChange={v => setLimit(Number(v))}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue placeholder="Số lượng hiển thị" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20 bản ghi</SelectItem>
              <SelectItem value="50">50 bản ghi</SelectItem>
              <SelectItem value="100">100 bản ghi</SelectItem>
              <SelectItem value="500">500 bản ghi</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/50">
            {isLoading ? (
              Array(6).fill(0).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/3" />
                </div>
              ))
            ) : logs && logs.length > 0 ? (
              logs.map((log, idx) => (
                <div key={idx} className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <Activity className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="font-medium text-sm leading-snug">{log.action}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(log.time).toLocaleString('vi-VN')}
                    </span>
                    {log.user && (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <code className="font-mono">{log.user}</code>
                      </span>
                    )}
                    {log.admin && (
                      <span className="flex items-center gap-1">
                        <Shield className="w-3 h-3 text-orange-500" />
                        <span className="bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded font-mono">
                          {log.admin}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Không có lịch sử hoạt động.
              </div>
            )}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[180px]">Thời gian</TableHead>
                  <TableHead>Hành động</TableHead>
                  <TableHead>User bị tác động</TableHead>
                  <TableHead>Người thực hiện (Admin)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(10).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={4} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : logs && logs.length > 0 ? (
                  logs.map((log, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5" />
                          {new Date(log.time).toLocaleString('vi-VN')}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-primary shrink-0" />
                          {log.action}
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.user ? (
                          <div className="flex items-center gap-2 text-sm font-mono">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                            {log.user}
                          </div>
                        ) : "-"}
                      </TableCell>
                      <TableCell>
                        {log.admin ? (
                          <div className="flex items-center gap-2 text-sm">
                            <Shield className="w-3.5 h-3.5 text-orange-500" />
                            <span className="bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded font-mono text-xs">
                              {log.admin}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground italic text-xs">Hệ thống</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                      Không có lịch sử hoạt động.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
