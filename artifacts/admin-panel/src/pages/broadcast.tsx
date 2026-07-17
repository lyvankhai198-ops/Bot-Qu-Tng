import { useState } from "react";
import { useQueueBroadcast } from "@workspace/api-client-react";
import { Radio, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useGetBotStats } from "@workspace/api-client-react";

export default function Broadcast() {
  const [message, setMessage] = useState("");
  const { toast } = useToast();
  const { data: stats } = useGetBotStats();

  const broadcastMutation = useQueueBroadcast({
    mutation: {
      onSuccess: () => {
        toast({ title: "Broadcast Queued", description: "The message is being sent to all users." });
        setMessage("");
      },
      onError: () => {
        toast({ title: "Broadcast Failed", description: "Could not queue the broadcast.", variant: "destructive" });
      }
    }
  });

  const handleSend = () => {
    if (!message.trim()) return;
    if (confirm("Are you sure you want to broadcast this message to ALL active users?")) {
      broadcastMutation.mutate({ data: { message } });
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Radio className="w-8 h-8 text-primary" />
          Broadcast Message
        </h1>
        <p className="text-muted-foreground mt-1">Send a mass message to all bot users.</p>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border bg-muted/20">
          <div className="flex items-center gap-4 text-sm font-medium">
            <div className="bg-primary/10 text-primary px-3 py-1.5 rounded-lg flex items-center gap-2">
              <Users className="w-4 h-4" />
              Target Audience: {stats?.totalUsers ? `${stats.totalUsers} Users` : "Loading..."}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">Message Content</label>
            <p className="text-xs text-muted-foreground">
              Telegram markdown and emojis are supported.
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your broadcast message here..."
              className="w-full min-h-[250px] p-4 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y"
            />
          </div>

          <div className="flex justify-end">
            <Button 
              size="lg" 
              className="gap-2 px-8"
              onClick={handleSend}
              disabled={!message.trim() || broadcastMutation.isPending}
            >
              <Send className="w-5 h-5" />
              {broadcastMutation.isPending ? "Queueing..." : "Send Broadcast"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
