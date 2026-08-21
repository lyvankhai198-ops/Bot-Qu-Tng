/**
 * AI Usage — quản lý daily token budget per user
 */
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API  = `${BASE}/api`;

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("admin_token") ?? "";
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

interface UserRow {
  uid:          string;
  tokens:       number;
  requests:     number;
  tokenLimit:   number;
  requestLimit: number;
  status:       "OK" | "OVER";
}

interface UsageData {
  today:        string;
  tokenLimit:   number;
  requestLimit: number;
  users:        UserRow[];
}

export default function AiUsage() {
  const [data,         setData]         = useState<UsageData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [tokenLimit,   setTokenLimit]   = useState("");
  const [requestLimit, setRequestLimit] = useState("");
  const [saving,       setSaving]       = useState(false);
  const [resetting,    setResetting]    = useState<string | null>(null);
  const [saveMsg,      setSaveMsg]      = useState<string | null>(null);

  const fetch_data = useCallback(async () => {
    try {
      const r = await fetch(`${API}/ai/usage`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: UsageData = await r.json();
      setData(d);
      setTokenLimit(String(d.tokenLimit));
      setRequestLimit(String(d.requestLimit));
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Lỗi tải dữ liệu");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_data();
    const id = setInterval(fetch_data, 30_000);
    return () => clearInterval(id);
  }, [fetch_data]);

  const saveBudget = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await fetch(`${API}/ai/budget`, {
        method:  "PUT",
        headers: authHeaders(),
        body:    JSON.stringify({
          tokenLimit:   Number(tokenLimit),
          requestLimit: Number(requestLimit),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Lỗi lưu");
      setSaveMsg("✅ Đã lưu budget!");
      fetch_data();
    } catch (e: any) {
      setSaveMsg(`❌ ${e.message}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  const resetUser = async (uid: string) => {
    setResetting(uid);
    try {
      await fetch(`${API}/ai/usage/${encodeURIComponent(uid)}`, {
        method:  "DELETE",
        headers: authHeaders(),
      });
      fetch_data();
    } finally {
      setResetting(null);
    }
  };

  const resetAll = async () => {
    if (!window.confirm("Reset usage của TẤT CẢ user hôm nay?")) return;
    setResetting("__all__");
    try {
      await fetch(`${API}/ai/usage`, { method: "DELETE", headers: authHeaders() });
      fetch_data();
    } finally {
      setResetting(null);
    }
  };

  const overCount = data?.users.filter(u => u.status === "OVER").length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">🤖 AI Usage / Budget</h1>
          <p className="text-sm text-muted-foreground">
            Hôm nay ({data?.today ?? "…"}) · {data?.users.length ?? 0} user · {overCount > 0 && <span className="text-red-500 font-medium">{overCount} OVER</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetch_data}>🔄 Làm mới</Button>
      </div>

      {/* ── Budget Settings ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">⚙️ Budget mặc định / ngày / user</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="tok">Token limit / ngày</Label>
              <Input
                id="tok"
                type="number"
                min={1}
                value={tokenLimit}
                onChange={e => setTokenLimit(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="req">Request limit / ngày</Label>
              <Input
                id="req"
                type="number"
                min={1}
                value={requestLimit}
                onChange={e => setRequestLimit(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={saveBudget} disabled={saving} size="sm">
              {saving ? "Đang lưu…" : "💾 Lưu budget"}
            </Button>
            {saveMsg && <span className="text-sm">{saveMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Áp dụng ngay — không cần restart bot. Reset tự động theo ngày UTC.
          </p>
        </CardContent>
      </Card>

      {/* ── Usage Table ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">📊 Usage hôm nay</CardTitle>
            {(data?.users.length ?? 0) > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={resetAll}
                disabled={resetting === "__all__"}
              >
                {resetting === "__all__" ? "Đang reset…" : "🗑 Reset tất cả"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
          {error   && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && (data?.users.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Chưa có user nào dùng AI hôm nay.</p>
          )}
          {(data?.users.length ?? 0) > 0 && (
            <div className="space-y-2">
              {data!.users.map(u => {
                const tokPct = Math.min(100, Math.round((u.tokens / u.tokenLimit) * 100));
                const reqPct = Math.min(100, Math.round((u.requests / u.requestLimit) * 100));
                return (
                  <div
                    key={u.uid}
                    className={`rounded-lg border p-3 ${u.status === "OVER" ? "border-red-300 bg-red-50 dark:bg-red-950/20" : "border-border"}`}
                  >
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{u.uid}</code>
                        <Badge
                          variant={u.status === "OVER" ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {u.status}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={resetting === u.uid}
                        onClick={() => resetUser(u.uid)}
                      >
                        {resetting === u.uid ? "…" : "🔄 Reset"}
                      </Button>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Tokens: </span>
                        <span className={u.tokens >= u.tokenLimit ? "text-red-600 font-semibold" : ""}>
                          {u.tokens.toLocaleString()}
                        </span>
                        <span className="text-muted-foreground text-xs"> / {u.tokenLimit.toLocaleString()} ({tokPct}%)</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Requests: </span>
                        <span className={u.requests >= u.requestLimit ? "text-red-600 font-semibold" : ""}>
                          {u.requests}
                        </span>
                        <span className="text-muted-foreground text-xs"> / {u.requestLimit} ({reqPct}%)</span>
                      </div>
                    </div>

                    {/* Token progress bar */}
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${tokPct >= 100 ? "bg-red-500" : tokPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                        style={{ width: `${tokPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Dữ liệu đọc từ <code>data/ai_usage.json</code> · Budget từ <code>chat_ai_settings.json</code> · Tự làm mới mỗi 30 giây.
      </p>
    </div>
  );
}
