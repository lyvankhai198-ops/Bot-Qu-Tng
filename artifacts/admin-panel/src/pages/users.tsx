import { useState } from "react";
import { useListUsers, useBanUser, useUnbanUser, getListUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, ShieldAlert, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Users() {
  const { data: users, isLoading } = useListUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const banMutation = useBanUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "User Banned", variant: "destructive" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      }
    }
  });

  const unbanMutation = useUnbanUser({
    mutation: {
      onSuccess: () => {
        toast({ title: "User Unbanned" });
        queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
      }
    }
  });

  const filteredUsers = users?.filter(u => 
    u.userId.includes(search) || 
    u.username?.toLowerCase().includes(search.toLowerCase()) || 
    u.firstName?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Bot Users</h1>
        <p className="text-muted-foreground mt-1">Manage users who have interacted with the bot.</p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-4 bg-muted/20">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by ID, username, or name..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-background"
            />
          </div>
          <div className="flex items-center text-sm font-medium gap-4 ml-auto">
            <span className="text-muted-foreground">Total: {users?.length || 0}</span>
            <span className="text-destructive">Banned: {users?.filter(u => u.banned).length || 0}</span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">User ID</th>
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Username</th>
                <th className="px-6 py-4 font-medium">Started At</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading users...</td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <User className="w-12 h-12 mb-4 opacity-20" />
                      <p>No users found matching "{search}".</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.userId} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 font-mono text-muted-foreground">{user.userId}</td>
                    <td className="px-6 py-4 font-medium">{user.firstName}</td>
                    <td className="px-6 py-4 text-primary">
                      {user.username ? `@${user.username}` : <span className="text-muted-foreground italic">none</span>}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {new Date(user.startedAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      {user.banned ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                          <ShieldAlert className="w-3.5 h-3.5" /> Banned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-500">
                          <ShieldCheck className="w-3.5 h-3.5" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.banned ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unbanMutation.mutate({ userId: user.userId })}
                          disabled={unbanMutation.isPending}
                        >
                          Unban
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => banMutation.mutate({ userId: user.userId })}
                          disabled={banMutation.isPending}
                        >
                          Ban
                        </Button>
                      )}
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
