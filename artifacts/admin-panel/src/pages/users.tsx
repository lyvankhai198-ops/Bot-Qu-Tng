import { useState, useMemo } from "react"
import { useListUsers, useBanUser, useUnbanUser, useResetUserGift, getListUsersQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, Ban, Unlock, RotateCcw, MoreHorizontal, User } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatDistanceToNow } from "date-fns"
import { vi } from "date-fns/locale"

export default function Users() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  
  const { data: users, isLoading } = useListUsers({ query: { queryKey: getListUsersQueryKey() } })
  const banUser = useBanUser()
  const unbanUser = useUnbanUser()
  const resetGift = useResetUserGift()

  const [search, setSearch] = useState("")

  const filteredUsers = useMemo(() => {
    if (!users) return []
    return users
      .filter(u =>
        (u.username || "").toLowerCase().includes(search.toLowerCase()) ||
        (u.firstName || "").toLowerCase().includes(search.toLowerCase()) ||
        u.userId.toString().includes(search)
      )
      .sort((a, b) => {
        const ta = a.lastSeen ? new Date(a.lastSeen).getTime() : 0
        const tb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0
        return tb - ta
      })
  }, [users, search])

  const handleAction = async (action: 'ban' | 'unban' | 'reset', userId: string) => {
    try {
      if (action === 'ban') {
        await banUser.mutateAsync({ userId })
        toast({ title: "Thành công", description: "Đã cấm người dùng" })
      } else if (action === 'unban') {
        await unbanUser.mutateAsync({ userId })
        toast({ title: "Thành công", description: "Đã bỏ cấm người dùng" })
      } else if (action === 'reset') {
        await resetGift.mutateAsync({ userId })
        toast({ title: "Thành công", description: "Đã reset lượt nhận quà" })
      }
      queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
    } catch (e) {
      toast({ title: "Lỗi", description: "Không thể thực hiện thao tác", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">Người dùng</h1>
        <p className="text-muted-foreground mt-1 text-sm">Quản lý người dùng bot Telegram</p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-border/50 bg-muted/20">
            <div className="relative w-full">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm ID, username hoặc tên..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background min-h-[44px]"
              />
            </div>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y divide-border/50">
            {isLoading ? (
              Array(4).fill(0).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
                  <div className="h-3 bg-muted animate-pulse rounded w-1/3" />
                </div>
              ))
            ) : filteredUsers.length > 0 ? (
              filteredUsers.map(user => (
                <div key={user.userId} className={`p-4 space-y-2 ${user.banned ? "opacity-60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{user.firstName}</div>
                        {user.username && <div className="text-xs text-muted-foreground">@{user.username}</div>}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-10 w-10 p-0 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleAction('reset', user.userId)}>
                          <RotateCcw className="h-4 w-4 mr-2" /> Reset quà
                        </DropdownMenuItem>
                        {user.banned ? (
                          <DropdownMenuItem onClick={() => handleAction('unban', user.userId)}>
                            <Unlock className="h-4 w-4 mr-2" /> Bỏ cấm
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleAction('ban', user.userId)}>
                            <Ban className="h-4 w-4 mr-2" /> Cấm user
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-12">
                    <code className="text-xs text-muted-foreground font-mono">{user.userId}</code>
                    <Badge variant={user.hasReceivedGift ? "default" : "outline"} className="font-normal text-xs">
                      {user.hasReceivedGift ? "Đã nhận quà" : "Chưa nhận quà"}
                    </Badge>
                    {user.banned && <Badge variant="destructive" className="text-xs">Đã cấm</Badge>}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground pl-12">
                    <span>Dùng: {user.usageCount || 0} lần</span>
                    {user.lastActive && (
                      <span>{formatDistanceToNow(new Date(user.lastActive), { addSuffix: true, locale: vi })}</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Không tìm thấy người dùng nào.
              </div>
            )}
          </div>

          {/* Desktop table view */}
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>User ID</TableHead>
                  <TableHead>Thông tin</TableHead>
                  <TableHead>Lượt dùng</TableHead>
                  <TableHead>Tình trạng quà</TableHead>
                  <TableHead>Hoạt động</TableHead>
                  <TableHead className="text-right">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6} className="h-16">
                        <div className="h-4 bg-muted animate-pulse rounded w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredUsers.length > 0 ? (
                  filteredUsers.map(user => (
                    <TableRow key={user.userId} className={user.banned ? "opacity-60" : ""}>
                      <TableCell className="font-mono text-xs">{user.userId}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <div className="font-medium text-sm">{user.firstName}</div>
                            {user.username && <div className="text-xs text-muted-foreground">@{user.username}</div>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{user.usageCount || 0}</TableCell>
                      <TableCell>
                        <Badge variant={user.hasReceivedGift ? "default" : "outline"} className="font-normal text-xs">
                          {user.hasReceivedGift ? "Đã nhận" : "Chưa nhận"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {user.lastActive ? (
                          formatDistanceToNow(new Date(user.lastActive), { addSuffix: true, locale: vi })
                        ) : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleAction('reset', user.userId)}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Reset quà
                            </DropdownMenuItem>
                            {user.banned ? (
                              <DropdownMenuItem onClick={() => handleAction('unban', user.userId)}>
                                <Unlock className="h-4 w-4 mr-2" /> Bỏ cấm
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleAction('ban', user.userId)}>
                                <Ban className="h-4 w-4 mr-2" /> Cấm user
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Không tìm thấy người dùng nào.
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
