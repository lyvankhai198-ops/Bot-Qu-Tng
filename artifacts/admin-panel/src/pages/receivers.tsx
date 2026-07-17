import { useState, useMemo } from "react"
import { useGetReceivers, getGetReceiversQueryKey } from "@workspace/api-client-react"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Search, Gift, Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function Receivers() {
  const { data: receivers, isLoading } = useGetReceivers({ query: { queryKey: getGetReceiversQueryKey() } })
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!receivers) return []
    return receivers.filter(r => 
      (r.username || "").toLowerCase().includes(search.toLowerCase()) || 
      (r.accountEmail || "").toLowerCase().includes(search.toLowerCase()) ||
      r.userId.toString().includes(search)
    )
  }, [receivers, search])

  const handleExport = () => {
    if (!receivers || receivers.length === 0) return
    
    const csvHeader = "ID,Username,Name,Thời gian nhận,Tài khoản đã nhận,Đợt(Round)\n"
    const csvContent = receivers.map(r => 
      `${r.userId},${r.username || ''},"${r.firstName || ''}",${r.claimTime},${r.accountEmail},${r.roundId}`
    ).join("\n")
    
    const blob = new Blob([csvHeader + csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)
    link.setAttribute("href", url)
    link.setAttribute("download", `danh_sach_nhan_qua_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Lịch sử phát quà</h1>
          <p className="text-muted-foreground mt-1">Danh sách người dùng đã nhận quà trong đợt hiện tại</p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!receivers || receivers.length === 0}>
          <Download className="w-4 h-4 mr-2" /> Xuất CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm user ID, username hoặc email đã nhận..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-12"><Gift className="w-4 h-4" /></TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Người nhận</TableHead>
                  <TableHead>Tài khoản được cấp</TableHead>
                  <TableHead>Đợt (Round)</TableHead>
                  <TableHead className="text-right">Thời gian</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6} className="h-14">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filtered.length > 0 ? (
                  filtered.map((record, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-primary"><Gift className="w-4 h-4" /></TableCell>
                      <TableCell className="font-mono text-xs">{record.userId}</TableCell>
                      <TableCell>
                        <div className="font-medium text-sm">{record.firstName}</div>
                        {record.username && <div className="text-xs text-muted-foreground">@{record.username}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{record.accountEmail}</TableCell>
                      <TableCell><span className="bg-muted px-2 py-1 rounded text-xs">{record.roundId}</span></TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {new Date(record.claimTime).toLocaleString('vi-VN')}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Không có bản ghi nào.
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