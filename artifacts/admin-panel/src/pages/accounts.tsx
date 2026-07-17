import { useState } from "react";
import { useListAccounts, useAddAccounts, useDeleteAccount, getListAccountsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, KeyRound, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function Accounts() {
  const { data: accounts, isLoading } = useListAccounts();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [bulkData, setBulkData] = useState("");
  const [search, setSearch] = useState("");

  const addMutation = useAddAccounts({
    mutation: {
      onSuccess: (res) => {
        toast({ title: "Accounts Added", description: `Added ${res.added} out of ${res.total} accounts.` });
        setIsAddOpen(false);
        setBulkData("");
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to add accounts.", variant: "destructive" });
      }
    }
  });

  const deleteMutation = useDeleteAccount({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account Deleted" });
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      }
    }
  });

  const handleBulkAdd = () => {
    const lines = bulkData.split("\n").filter(l => l.trim().length > 0);
    const parsedAccounts = lines.map(line => {
      const [email, ...pwParts] = line.split(":");
      return { email: email.trim(), password: pwParts.join(":").trim() };
    }).filter(a => a.email && a.password);

    if (parsedAccounts.length === 0) {
      toast({ title: "Invalid Format", description: "Please enter email:password per line.", variant: "destructive" });
      return;
    }

    addMutation.mutate({ data: { accounts: parsedAccounts } });
  };

  const filteredAccounts = accounts?.filter(a => a.email.toLowerCase().includes(search.toLowerCase())) || [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Account Stock</h1>
          <p className="text-muted-foreground mt-1">Manage AI accounts available for the giveaway.</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" /> Add Accounts
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Bulk Add Accounts</DialogTitle>
              <DialogDescription>
                Paste accounts in <code>email:password</code> format, one per line.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <textarea
                className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono"
                placeholder="email1@example.com:pass123&#10;email2@example.com:pass456"
                value={bulkData}
                onChange={(e) => setBulkData(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button disabled={addMutation.isPending} onClick={handleBulkAdd}>
                {addMutation.isPending ? "Adding..." : "Import Accounts"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-muted/20">
          <div className="relative flex-1 max-w-sm">
            <Input 
              placeholder="Search by email..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="text-sm text-muted-foreground ml-auto">
            {accounts?.length || 0} Total in Stock
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground bg-muted/30 uppercase">
              <tr>
                <th className="px-6 py-4 font-medium">Email</th>
                <th className="px-6 py-4 font-medium">Password</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-muted-foreground">Loading accounts...</td>
                </tr>
              ) : filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-muted-foreground">
                      <FileText className="w-12 h-12 mb-4 opacity-20" />
                      <p>No accounts found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAccounts.map((account, idx) => (
                  <tr key={idx} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4 font-medium">{account.email}</td>
                    <td className="px-6 py-4 font-mono text-muted-foreground">
                      {account.password}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (confirm(`Delete ${account.email}?`)) {
                            deleteMutation.mutate({ email: account.email });
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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
