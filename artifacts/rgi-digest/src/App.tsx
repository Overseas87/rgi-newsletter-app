import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarLayout } from "@/components/layout/sidebar-layout";

import Dashboard from "@/pages/dashboard";
import Feed from "@/pages/feed";
import Topics from "@/pages/topics";
import Review from "@/pages/review";
import Published from "@/pages/published";
import Rejected from "@/pages/rejected";
import Sources from "@/pages/sources";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <SidebarLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/feed" component={Feed} />
        <Route path="/topics" component={Topics} />
        <Route path="/review" component={Review} />
        <Route path="/published" component={Published} />
        <Route path="/rejected" component={Rejected} />
        <Route path="/sources" component={Sources} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </SidebarLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
