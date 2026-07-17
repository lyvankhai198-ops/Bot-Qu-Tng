import { useState } from "react";
import { useGetReceivers } from "@workspace/api-client-react";
import { Gift, Search, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Receivers() {
  const { data: receivers, isLoading } = useGetReceivers();
  const [search, setSearch] = useState("");

  const filtered = receivers?.filter(r => 
    r.username?.toLowerCase().includes(search.toLowerCase()) || 
    r.firstName?.toLowerCase().includes(search.toLowerCase()) ||
    r.accountEmail?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const exportCSV = () => {
    if (!receivers || receivers.length === 0) return;
    const header = "User ID,First Name,Username,Claim Time,Account Email,Round ID\n";
    const rows = receivers.map(r => 
      `${r.userId},"${r.firstName || ''}","${r.username || ''}",${r.claimTime},${r.accountEmail},${r.roundId}`
    ).join("\n");
    
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receivers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Gift Receivers</h1>
          <p className="text-muted-foreground mt-1">Users who successfully claimed an account.</p>
        </div>
        
        <Button variant="outline" onClick={exportCSV} disabled={!receivers || receivers.length === 0}>
          <Download className="w-4 h-4 mr-2" /> Export CSV
        </Button>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-muted/20">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by name, username, email..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
          <div className="text-sm font-medium text-muted-foreground ml-auto">
            {receivers?.length || 0} Claims
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Claim Time</th>
                <th className="px-6 py-4 font-medium">User</th>
                <th className="px-6 py-4 font-medium">Received Account</th>
                <th className="px-6 py-4 font-medium">Round ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading claim records...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <Gift className="w-12 h-12 mb-4 opacity-20" />
                      <p>No claims recorded.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((record, idx) => (
                  <tr key={idx} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-muted-foreground">
                      {new Date(record.claimTime).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium">{record.firstName}</div>
                      <div className="text-xs text-primary mt-0.5">
                        {record.username ? `@${record.username}` : record.userId}
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">
                      {record.accountEmail}
                    </td>
                    <td className="px-6 py-4">
                      <span className="bg-secondary text-secondary-foreground px-2 py-1 rounded text-xs font-mono">
                        {record.roundId}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
