import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  List,
  CheckCircle,
  Archive,
  XCircle,
  Database,
  Settings as SettingsIcon,
  RefreshCw,
  Menu,
} from "lucide-react";
import { useGetScrapeStatus, useTriggerScrape, getGetScrapeStatusQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/topics", label: "Today's Topics", icon: List },
  { path: "/review", label: "Pending Review", icon: CheckCircle },
  { path: "/published", label: "Published Archive", icon: Archive },
  { path: "/rejected", label: "Rejected", icon: XCircle },
  { path: "/sources", label: "Source Management", icon: Database },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: scrapeStatus } = useGetScrapeStatus();
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
      },
    });
  };

  const NavLinks = () => (
    <nav className="flex flex-col gap-2 mt-8 px-4">
      {NAV_ITEMS.map((item) => {
        const isActive = location === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => setMobileOpen(false)}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground dark">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card">
        <div className="font-serif font-bold text-lg text-primary tracking-tight">RGI Digest</div>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="btn-mobile-menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
            <div className="p-6 border-b border-sidebar-border">
              <h2 className="font-serif font-bold text-xl text-primary tracking-tight">RGI Digest</h2>
            </div>
            <NavLinks />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-sidebar-border bg-sidebar shrink-0">
        <div className="p-6 border-b border-sidebar-border">
          <h2 className="font-serif font-bold text-2xl text-primary tracking-tight">RGI Digest</h2>
          <p className="text-xs text-sidebar-foreground/60 mt-1 uppercase tracking-wider font-semibold">
            Daily Intelligence
          </p>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <div className="p-4 border-t border-sidebar-border">
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1">Last Scraped</p>
            <p className="text-sm font-medium">
              {scrapeStatus?.lastScrapeAt
                ? format(new Date(scrapeStatus.lastScrapeAt), "MMM d, h:mm a")
                : "Never"}
            </p>
          </div>
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            className="w-full justify-start gap-2"
            variant="secondary"
            data-testid="btn-trigger-scrape"
          >
            <RefreshCw className={`h-4 w-4 ${scrapeStatus?.isRunning ? "animate-spin" : ""}`} />
            {scrapeStatus?.isRunning ? "Scraping..." : "Scrape Now"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-background">
        {/* Mobile Scrape Info */}
        <div className="md:hidden p-4 border-b border-border bg-card flex items-center justify-between">
          <div className="text-sm">
            <span className="text-muted-foreground">Last Scraped: </span>
            <span className="font-medium">
              {scrapeStatus?.lastScrapeAt
                ? format(new Date(scrapeStatus.lastScrapeAt), "MMM d, h:mm a")
                : "Never"}
            </span>
          </div>
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            size="sm"
            variant="secondary"
            data-testid="btn-trigger-scrape-mobile"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${scrapeStatus?.isRunning ? "animate-spin" : ""}`} />
            {scrapeStatus?.isRunning ? "Scraping" : "Scrape"}
          </Button>
        </div>
        <div className="p-6 md:p-10 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
