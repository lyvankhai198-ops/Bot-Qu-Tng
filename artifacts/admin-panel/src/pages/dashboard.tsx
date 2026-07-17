import { useGetBotStats, useGetBotLogs, getGetBotStatsQueryKey } from "@workspace/api-client-react";
import { Users, KeyRound, Gift, ShieldAlert, Activity, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useGetBotStats();
  const { data: logs, isLoading: logsLoading } = useGetBotLogs({ limit: 50 });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetBotStatsQueryKey() });
  };

  const statCards = [
    { label: "Total Users", value: stats?.totalUsers, icon: Users, color: "text-blue-500", bg: "bg-blue-500/10" },
    { label: "Accounts in Stock", value: stats?.stock, icon: KeyRound, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    { label: "Claimed Gifts", value: stats?.claimed, icon: Gift, color: "text-amber-500", bg: "bg-amber-500/10" },
    { label: "Banned Users", value: stats?.banned, icon: ShieldAlert, color: "text-rose-500", bg: "bg-rose-500/10" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
          <p className="text-muted-foreground mt-1">Live metrics and system status.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-muted px-4 py-2 rounded-lg font-mono text-sm border border-border">
            ROUND ID: <span className="text-primary font-bold">{stats?.roundId || "---"}</span>
          </div>
          <button 
            onClick={refresh}
            className="p-2 bg-card border border-border rounded-lg hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <div key={i} className="bg-card border border-border rounded-xl p-6 shadow-sm flex items-start gap-4">
            <div className={`p-4 rounded-xl ${card.bg} ${card.color}`}>
              <card.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <h3 className="text-3xl font-bold mt-1 tracking-tight">
                {statsLoading ? <span className="opacity-50">--</span> : card.value}
              </h3>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col h-[500px]">
        <div className="p-6 border-b border-border bg-muted/20 flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h2 className="font-semibold">Recent System Activity</h2>
        </div>
        <div className="flex-1 overflow-auto p-0">
          {logsLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading logs...</div>
          ) : logs && logs.length > 0 ? (
            <div className="divide-y divide-border">
              {logs.map((log, i) => (
                <div key={i} className="p-4 hover:bg-muted/50 transition-colors flex items-center gap-4 text-sm">
                  <div className="font-mono text-muted-foreground whitespace-nowrap text-xs bg-muted px-2 py-1 rounded">
                    {new Date(log.time).toLocaleString()}
                  </div>
                  <div className="flex-1">
                    <span className="font-semibold text-foreground">{log.action}</span>
                  </div>
                  <div className="text-muted-foreground truncate max-w-[200px]" title={log.user}>
                    {log.user}
                  </div>
                  {log.admin && (
                    <div className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-mono font-medium">
                      ADMIN
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">No recent activity.</div>
          )}
        </div>
      </div>
    </div>
  );
}
