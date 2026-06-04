import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarLayout } from "@/components/layout/sidebar-layout";
import { ErrorBoundary } from "@/components/error-boundary";
import type { ReactNode } from "react";

import Dashboard from "@/pages/dashboard";
import Feed from "@/pages/feed";
import ArticleDetail from "@/pages/article-detail";
import Topics from "@/pages/topics";
import Review from "@/pages/review";
import Published from "@/pages/published";
import Rejected from "@/pages/rejected";
import Sources from "@/pages/sources";
import Settings from "@/pages/settings";
import About from "@/pages/about";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
    mutations: {
      retry: 1,
    },
  },
});

function SafeRoute({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallbackTitle="This page hit a recoverable error">{children}</ErrorBoundary>;
}

function Router() {
  return (
    <SidebarLayout>
      <ErrorBoundary fallbackTitle="Navigation hit a recoverable error">
        <Switch>
          <Route path="/"><SafeRoute><Dashboard /></SafeRoute></Route>
          <Route path="/feed"><SafeRoute><Feed /></SafeRoute></Route>
          <Route path="/articles/:id"><SafeRoute><ArticleDetail /></SafeRoute></Route>
          <Route path="/topics"><SafeRoute><Topics /></SafeRoute></Route>
          <Route path="/review"><SafeRoute><Review /></SafeRoute></Route>
          <Route path="/published"><SafeRoute><Published /></SafeRoute></Route>
          <Route path="/rejected"><SafeRoute><Rejected /></SafeRoute></Route>
          <Route path="/sources"><SafeRoute><Sources /></SafeRoute></Route>
          <Route path="/settings"><SafeRoute><Settings /></SafeRoute></Route>
          <Route path="/about"><SafeRoute><About /></SafeRoute></Route>
          <Route><SafeRoute><NotFound /></SafeRoute></Route>
        </Switch>
      </ErrorBoundary>
    </SidebarLayout>
  );
}

function App() {
  return (
    <ErrorBoundary fallbackTitle="The app hit a recoverable error">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
