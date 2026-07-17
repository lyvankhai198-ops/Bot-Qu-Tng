import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="bg-destructive/10 text-destructive w-20 h-20 rounded-full flex items-center justify-center mx-auto">
          <AlertCircle className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">404 Not Found</h1>
          <p className="text-muted-foreground">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <Link href="/dashboard">
          <Button size="lg" className="w-full sm:w-auto">
            Return to Dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
