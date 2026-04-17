import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Rss,
  Tag,
  CheckCircle,
  Archive,
  XCircle,
  Database,
  Settings as SettingsIcon,
  RefreshCw,
  Menu,
  Wand2,
} from "lucide-react";
import { useGetScrapeStatus, useTriggerScrape, getGetScrapeStatusQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { GenerateModal } from "@/components/generate-modal";

const NAV_ITEMS = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/feed", label: "Intelligence Feed", icon: Rss },
  { path: "/topics", label: "Today's Topics", icon: Tag },
  { path: "/review", label: "Pending Review", icon: CheckCircle },
  { path: "/published", label: "Published", icon: Archive },
  { path: "/rejected", label: "Rejected", icon: XCircle },
  { path: "/sources", label: "Sources", icon: Database },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
];

function RGILogo({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="RGI Logo"
    >
      <path d="M20 20 C16 13, 9 9, 20 3 C27 0, 25 9, 20 20Z" fill="#C9A227"/>
      <path d="M20 20 C27 16, 31 9, 37 20 C40 27, 31 25, 20 20Z" fill="#C9A227"/>
      <path d="M20 20 C24 27, 31 31, 20 37 C13 40, 15 31, 20 20Z" fill="#C9A227"/>
      <path d="M20 20 C13 24, 9 31, 3 20 C0 13, 9 15, 20 20Z" fill="#C9A227"/>
    </svg>
  );
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { data: scrapeStatus } = useGetScrapeStatus();
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
        setTimeout(() => queryClient.invalidateQueries(), 6000);
      },
    });
  };

  const NavLinks = ({ onClose }: { onClose?: () => void }) => (
    <nav className="flex flex-col gap-0.5 mt-4 px-3">
      {/* Generate Brief — primary action */}
      <button
        onClick={() => { setGenerateOpen(true); onClose?.(); }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold mb-2 transition-all bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
        data-testid="nav-generate-brief"
      >
        <Wand2 className="h-4 w-4 shrink-0" />
        Generate Brief
      </button>

      {NAV_ITEMS.map((item) => {
        const isActive = location === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`flex items-center gap-3 px-3 py-2 rounded-md transition-all text-sm font-medium border-l-2 ${
              isActive
                ? "bg-primary/10 text-primary border-l-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground border-l-transparent"
            }`}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => onClose?.()}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground dark">
      <GenerateModal open={generateOpen} onOpenChange={setGenerateOpen} />

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-sidebar-border bg-sidebar">
        <Link href="/" className="flex items-center gap-2.5">
          <RGILogo size={24} />
          <div>
            <span className="font-serif font-bold text-base text-primary tracking-tight leading-none">Rick Goings Institute</span>
          </div>
        </Link>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="btn-mobile-menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border">
            <div className="px-5 py-6 border-b border-sidebar-border">
              <Link href="/" onClick={() => setMobileOpen(false)}>
                <div className="flex items-center gap-3 mb-2">
                  <RGILogo size={28} />
                  <div>
                    <p className="font-serif font-bold text-lg text-primary leading-tight">Rick Goings Institute</p>
                  </div>
                </div>
              </Link>
              <p className="text-[10px] text-sidebar-foreground/40 uppercase tracking-widest font-semibold pl-1">
                Strategic Intelligence Brief
              </p>
            </div>
            <NavLinks onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-60 border-r border-sidebar-border bg-sidebar shrink-0">
        {/* Brand mark */}
        <Link href="/">
          <div className="px-5 pt-7 pb-5 border-b border-sidebar-border cursor-pointer">
            <div className="flex items-center gap-3 mb-2">
              <RGILogo size={30} />
              <div className="min-w-0">
                <p className="font-serif font-bold text-[15px] text-primary leading-tight tracking-tight">
                  Rick Goings<br />Institute
                </p>
              </div>
            </div>
            <p className="text-[9px] text-sidebar-foreground/40 uppercase tracking-widest font-bold pl-0.5">
              Strategic Intelligence Brief
            </p>
          </div>
        </Link>

        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks />
        </div>

        {/* Bottom scrape status */}
        <div className="p-4 border-t border-sidebar-border space-y-2.5">
          <div>
            <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider font-semibold mb-0.5">Last Scraped</p>
            <p className="text-xs font-medium text-muted-foreground">
              {scrapeStatus?.lastScrapeAt
                ? format(new Date(scrapeStatus.lastScrapeAt), "MMM d 'at' h:mm a")
                : "Never"}
            </p>
          </div>
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            className="w-full justify-start gap-2"
            variant="secondary"
            size="sm"
            data-testid="btn-trigger-scrape"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scrapeStatus?.isRunning ? "animate-spin" : ""}`} />
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
            <span className="font-medium text-xs">
              {scrapeStatus?.lastScrapeAt
                ? format(new Date(scrapeStatus.lastScrapeAt), "MMM d, h:mm a")
                : "Never"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setGenerateOpen(true)}
              size="sm"
              className="gap-1.5"
              data-testid="btn-generate-mobile"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Generate
            </Button>
            <Button
              onClick={handleScrape}
              disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
              size="sm"
              variant="secondary"
              data-testid="btn-trigger-scrape-mobile"
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${scrapeStatus?.isRunning ? "animate-spin" : ""}`} />
              {scrapeStatus?.isRunning ? "Scraping" : "Scrape"}
            </Button>
          </div>
        </div>
        <div className="p-6 md:p-10 max-w-5xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
