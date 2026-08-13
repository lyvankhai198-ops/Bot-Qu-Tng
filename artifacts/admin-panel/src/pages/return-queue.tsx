import { useGetReturnQueue, useApproveReturnEntry, useRejectReturnEntry, getGetReturnQueueQueryKey } from "@workspace/api-client-react"
import { useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { formatDistanceToNow } from "date-fns"
import { vi } from "date-fns/locale"
import { RotateCcw, CheckCircle2, XCircle, Clock, ArrowLeftRight, Package } from "lucide-react"

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <Badge className="bg-green-100 text-green-800 border-green-300">✅ Đã duyệt</Badge>
  if (status === "rejected") return <Badge className="bg-red-100 text-red-800 border-red-300">❌ Đã từ chối</Badge>
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">⏳ Chờ duyệt</Badge>
}

export default function ReturnQueue() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data: entries, isLoading } = useGetReturnQueue({ query: { queryKey: getGetReturnQueueQueryKey() } })
  const approve = useApproveReturnEntry()
  const reject  = useRejectReturnEntry()

  const pending  = entries?.filter(e => e.notifyStatus === "pending").length ?? 0
  const approved = entries?.filter(e => e.notifyStatus === "approved").length ?? 0
  const rejected = entries?.filter(e => e.notifyStatus === "rejected").length ?? 0

  const handleApprove = async (id: string) => {
    try {
      await approve.mutateAsync({ id })
      toast({ title: "✅ Đã duyệt", description: "Đã xếp hàng thông báo tới người chưa nhận quà" })
      queryClient.invalidateQueries({ queryKey: getGetReturnQueueQueryKey() })
    } catch {
      toast({ title: "Lỗi", description: "Không thể duyệt", variant: "destructive" })
    }
  }

  const handleReject = async (id: string) => {
    try {
      await reject.mutateAsync({ id })
      toast({ title: "Đã từ chối", description: "Không gửi thông báo cho người dùng" })
      queryClient.invalidateQueries({ queryKey: getGetReturnQueueQueryKey() })
    } catch {
      toast({ title: "Lỗi", description: "Không thể từ chối", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight flex items-center gap-2">
          <ArrowLeftRight className="h-6 w-6" /> Nhường quà
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Quản lý quà được người dùng trả lại — duyệt để thông báo người dùng khác
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="h-6 w-6 mx-auto mb-1 text-yellow-500" />
            <div className="text-2xl font-bold">{isLoading ? "—" : pending}</div>
            <div className="text-xs text-muted-foreground">Chờ duyệt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-1 text-green-500" />
            <div className="text-2xl font-bold">{isLoading ? "—" : approved}</div>
            <div className="text-xs text-muted-foreground">Đã duyệt</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <XCircle className="h-6 w-6 mx-auto mb-1 text-red-500" />
            <div className="text-2xl font-bold">{isLoading ? "—" : rejected}</div>
            <div className="text-xs text-muted-foreground">Từ chối</div>
          </CardContent>
        </Card>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-300 flex gap-3">
        <RotateCcw className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold mb-1">Cách hoạt động</p>
          <ul className="list-disc pl-4 space-y-1 text-xs">
            <li>Người dùng nhận quà nhưng không dùng → bấm nút <b>Nhường lại</b> trong vòng 24h</li>
            <li>Tài khoản được trả về kho, user được reset để nhận lại bình thường</li>
            <li>Bạn duyệt ở đây → bot tự động broadcast cho người chưa nhận quà</li>
            <li>Từ chối → không gửi thông báo, tài khoản vẫn về kho</li>
          </ul>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {isLoading ? (
          Array(3).fill(0).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-4 bg-muted animate-pulse rounded w-1/2 mb-2" />
                <div className="h-3 bg-muted animate-pulse rounded w-1/3" />
              </CardContent>
            </Card>
          ))
        ) : !entries || entries.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Chưa có quà nào được nhường lại.</p>
            </CardContent>
          </Card>
        ) : (
          entries.map(entry => (
            <Card key={entry.id} className={entry.notifyStatus === "pending" ? "border-yellow-300 dark:border-yellow-700" : ""}>
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={entry.notifyStatus} />
                      <span className="text-xs text-muted-foreground font-mono">#{entry.id}</span>
                    </div>
                    <div className="font-medium text-sm">
                      {entry.firstName || "—"}
                      {entry.username && <span className="text-muted-foreground font-normal ml-1">@{entry.username}</span>}
                      <span className="text-muted-foreground font-mono text-xs ml-2">({entry.userId})</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Package className="h-3 w-3" />
                      <code className="break-all">{entry.accountEmail}</code>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Nhường lúc{" "}
                      {formatDistanceToNow(new Date(entry.returnedAt), { addSuffix: true, locale: vi })}
                      {entry.claimTime && (
                        <> · Nhận lúc {formatDistanceToNow(new Date(entry.claimTime), { addSuffix: true, locale: vi })}</>
                      )}
                    </div>
                  </div>

                  {entry.notifyStatus === "pending" && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700 text-white gap-1"
                        onClick={() => handleApprove(entry.id)}
                        disabled={approve.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Duyệt &amp; Thông báo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1"
                        onClick={() => handleReject(entry.id)}
                        disabled={reject.isPending}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Từ chối
                      </Button>
                    </div>
                  )}

                  {entry.notifyStatus === "approved" && entry.approvedAt && (
                    <div className="text-xs text-muted-foreground shrink-0">
                      Duyệt {formatDistanceToNow(new Date(entry.approvedAt), { addSuffix: true, locale: vi })}
                    </div>
                  )}
                  {entry.notifyStatus === "rejected" && entry.rejectedAt && (
                    <div className="text-xs text-muted-foreground shrink-0">
                      Từ chối {formatDistanceToNow(new Date(entry.rejectedAt), { addSuffix: true, locale: vi })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
