import { useLocation } from "wouter"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Bot, Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useBotLogin } from "@workspace/api-client-react"
import { useToast } from "@/hooks/use-toast"

const formSchema = z.object({
  password: z.string().min(1, "Vui lòng nhập mật khẩu"),
})

export default function Login() {
  const [, setLocation] = useLocation()
  const { toast } = useToast()
  
  const loginMutation = useBotLogin({
    mutation: {
      onSuccess: (data) => {
        localStorage.setItem("admin_token", data.token)
        toast({
          title: "Đăng nhập thành công",
        })
        setLocation("/dashboard")
      },
      onError: () => {
        toast({
          title: "Đăng nhập thất bại",
          description: "Mật khẩu không chính xác",
          variant: "destructive",
        })
      }
    }
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    loginMutation.mutate({ data: values })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[40%] h-[40%] rounded-full bg-accent/10 blur-[100px]" />
      </div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Bot Quà Tặng AI
          </h1>
          <p className="text-muted-foreground mt-2">
            Hệ thống quản lý Admin
          </p>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-xl">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mật khẩu quản trị</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input 
                          type="password" 
                          placeholder="••••••••" 
                          className="pl-9"
                          {...field} 
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Đang đăng nhập..." : "Đăng nhập"}
              </Button>
            </form>
          </Form>
        </div>
      </div>
    </div>
  )
}
