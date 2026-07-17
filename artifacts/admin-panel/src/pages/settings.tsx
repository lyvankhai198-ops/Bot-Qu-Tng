import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { 
  useGetBotSettings, 
  useUpdateBotSettings, 
  useNewRound,
  getGetBotSettingsQueryKey,
  getGetBotStatsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw, Settings as SettingsIcon, Clock, Link as LinkIcon, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

interface SettingsFormValues {
  shopLink: string;
  shopUsername: string;
  supportUsername: string;
  cooldownHours: number;
}

export default function Settings() {
  const { data: settings, isLoading } = useGetBotSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<SettingsFormValues>({
    defaultValues: {
      shopLink: "",
      shopUsername: "",
      supportUsername: "",
      cooldownHours: 24,
    }
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        shopLink: settings.shopLink,
        shopUsername: settings.shopUsername,
        supportUsername: settings.supportUsername,
        cooldownHours: settings.cooldownHours,
      });
    }
  }, [settings, form]);

  const updateSettingsMutation = useUpdateBotSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "Settings Saved", description: "Bot settings have been updated." });
        queryClient.invalidateQueries({ queryKey: getGetBotSettingsQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
      }
    }
  });

  const newRoundMutation = useNewRound({
    mutation: {
      onSuccess: () => {
        toast({ title: "New Round Started", description: "Claim history cleared and round ID updated." });
        queryClient.invalidateQueries({ queryKey: getGetBotSettingsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetBotStatsQueryKey() });
      }
    }
  });

  const onSubmit = (data: SettingsFormValues) => {
    updateSettingsMutation.mutate({ data });
  };

  const handleNewRound = () => {
    const roundId = prompt("Enter a unique identifier for the new round (e.g. ROUND_2, TET_2025):");
    if (roundId && roundId.trim()) {
      newRoundMutation.mutate({ data: { roundId: roundId.trim() } });
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <SettingsIcon className="w-8 h-8 text-primary" />
            System Configuration
          </h1>
          <p className="text-muted-foreground mt-1">Configure bot behavior and links.</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-card px-4 py-2 border border-border rounded-lg text-sm font-mono flex items-center gap-2 shadow-sm">
            Current Round: <span className="text-primary font-bold">{settings?.roundId || "..."}</span>
          </div>
          <Button 
            variant="outline" 
            className="border-primary text-primary hover:bg-primary/10"
            onClick={handleNewRound}
            disabled={newRoundMutation.isPending}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Start New Round
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-muted-foreground">Loading settings...</div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Links & References</h3>
                  
                  <FormField
                    control={form.control}
                    name="shopLink"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <LinkIcon className="w-4 h-4 text-muted-foreground" /> Channel / Shop Link
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="https://t.me/yourchannel" className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="shopUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" /> Channel Username
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="@yourchannel" className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="supportUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" /> Support Username
                        </FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="@yoursupport" className="bg-background" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-6">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Mechanics</h3>
                  
                  <FormField
                    control={form.control}
                    name="cooldownHours"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-muted-foreground" /> Claim Cooldown (Hours)
                        </FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            {...field} 
                            onChange={e => field.onChange(Number(e.target.value))}
                            className="bg-background" 
                          />
                        </FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground mt-2">
                          How long a user must wait before claiming another gift in the same round.
                        </p>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-border flex justify-end">
                <Button 
                  type="submit" 
                  size="lg" 
                  className="px-8"
                  disabled={updateSettingsMutation.isPending}
                >
                  <Save className="w-5 h-5 mr-2" />
                  {updateSettingsMutation.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}
