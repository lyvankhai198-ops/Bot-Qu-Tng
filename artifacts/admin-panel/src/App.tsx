import { useEffect } from "react";
import { Switch, Route, useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import { Layout } from "@/components/layout";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Accounts from "@/pages/accounts";
import Users from "@/pages/users";
import Orders from "@/pages/orders";
import Warranty from "@/pages/warranty";
import Broadcast from "@/pages/broadcast";
import Settings from "@/pages/settings";
import Receivers from "@/pages/receivers";
import Intro from "@/pages/intro";
import Logs from "@/pages/logs";
import RefundHistory from "@/pages/refund-history";
import SyncRobot from "@/pages/sync-robot";
import Checkin from "@/pages/checkin";
import SecretCodes from "@/pages/secret-codes";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

setAuthTokenGetter(() => localStorage.getItem("admin_token"));

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const [location, setLocation] = useLocation();
  const token = localStorage.getItem("admin_token");

  useEffect(() => {
    if (!token) {
      setLocation("/login");
    }
  }, [token, location, setLocation]);

  if (!token) return null;

  return (
    <Layout>
      <Component />
    </Layout>
  );
}

function Router() {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (location === "/") {
      setLocation("/dashboard");
    }
  }, [location, setLocation]);

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/accounts"><ProtectedRoute component={Accounts} /></Route>
      <Route path="/users"><ProtectedRoute component={Users} /></Route>
      <Route path="/orders"><ProtectedRoute component={Orders} /></Route>
      <Route path="/warranty"><ProtectedRoute component={Warranty} /></Route>
      <Route path="/broadcast"><ProtectedRoute component={Broadcast} /></Route>
      <Route path="/settings"><ProtectedRoute component={Settings} /></Route>
      <Route path="/intro"><ProtectedRoute component={Intro} /></Route>
      <Route path="/receivers"><ProtectedRoute component={Receivers} /></Route>
      <Route path="/logs"><ProtectedRoute component={Logs} /></Route>
      <Route path="/refund-history"><ProtectedRoute component={RefundHistory} /></Route>
      <Route path="/sync-robot"><ProtectedRoute component={SyncRobot} /></Route>
      <Route path="/checkin"><ProtectedRoute component={Checkin} /></Route>
      <Route path="/secret-codes"><ProtectedRoute component={SecretCodes} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
