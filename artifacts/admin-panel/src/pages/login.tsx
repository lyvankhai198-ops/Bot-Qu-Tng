import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useBotLogin } from "@workspace/api-client-react";
import { Bot, Lock, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [password, setPassword] = useState("");
  
  const loginMutation = useBotLogin({
    mutation: {
      onSuccess: (data) => {
        localStorage.setItem("admin_token", data.token);
        setLocation("/dashboard");
      },
      onError: () => {
        toast({
          title: "Access Denied",
          description: "Invalid password provided.",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    loginMutation.mutate({ data: { password } });
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-accent/10 rounded-full blur-3xl pointer-events-none" />
      
      <div className="w-full max-w-md relative">
        <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden backdrop-blur-xl">
          <div className="p-8 text-center space-y-2 border-b border-border bg-muted/30">
            <div className="mx-auto w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-4">
              <Bot className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Control Center</h1>
            <p className="text-sm text-muted-foreground font-mono">AUTHENTICATION REQUIRED</p>
          </div>
          
          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground/80 flex items-center gap-2">
                  <Lock className="w-4 h-4" /> System Password
                </label>
                <Input
                  type="password"
                  placeholder="Enter password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono bg-background/50 h-12 border-muted-foreground/20 focus:border-primary/50 focus:ring-primary/20 transition-all"
                  autoFocus
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 font-medium text-base group"
                disabled={loginMutation.isPending || !password}
              >
                {loginMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Initialize Session
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>
        
        <div className="mt-8 text-center text-xs text-muted-foreground font-mono opacity-50">
          SECURE CONNECTION • BOT QUÀ TẶNG AI
        </div>
      </div>
    </div>
  );
}
