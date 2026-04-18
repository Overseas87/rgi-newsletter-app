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
  Info,
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
  { path: "/about", label: "About RGI", icon: Info },
];

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
    <nav className="flex flex-col gap-0.5 mt-3 px-3">
      <button
        onClick={() => { setGenerateOpen(true); onClose?.(); }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-semibold mb-2 transition-colors"
        style={{ backgroundColor: "#C09A3A", color: "#0B1F3A" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#D4AF4E")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#C09A3A")}
        data-testid="nav-generate-brief"
      >
        <Wand2 className="h-4 w-4 shrink-0" />
        Generate Brief
      </button>

      <div className="h-px my-1 mx-1" style={{ backgroundColor: "rgba(255,255,255,0.08)" }} />

      {NAV_ITEMS.map((item) => {
        const isActive = location === item.path;
        return (
          <Link
            key={item.path}
            href={item.path}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-all text-sm font-medium border-l-2 ${
              isActive
                ? "bg-white/10 text-white"
                : "border-l-transparent text-white/60 hover:bg-white/5 hover:text-white/90"
            }`}
            style={isActive ? { borderLeftColor: "#C09A3A" } : {}}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            onClick={() => onClose?.()}
          >
            <item.icon
              className="h-4 w-4 shrink-0"
              style={{ color: isActive ? "#C09A3A" : "rgba(255,255,255,0.35)" }}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background text-foreground">
      <GenerateModal open={generateOpen} onOpenChange={setGenerateOpen} />

      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-sidebar-border bg-sidebar dark">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/rgi-logo-transparent.png" alt="RGI" className="h-8 w-auto object-contain" />
          <span className="text-white font-semibold text-sm">Rick Goings Institute</span>
        </Link>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white/70 hover:text-white" data-testid="btn-mobile-menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-sidebar border-sidebar-border dark">
            <div
              className="flex flex-col items-center justify-center gap-2 py-5"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
            >
              <img
                src="/rgi-logo-transparent.png"
                alt="RGI"
                className="h-10 w-10 object-contain"
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.25em]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  Rick Goings Institute
                </span>
                <span className="text-[11px] font-semibold uppercase" style={{ color: "#C09A3A", letterSpacing: "0.18em" }}>
                  Intelligence
                </span>
              </div>
            </div>
            <NavLinks onClose={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex flex-col w-60 bg-sidebar shrink-0 dark"
        style={{ borderRight: "1px solid rgba(255,255,255,0.08)" }}
      >
        {/* Brand */}
        <Link href="/">
          <div
            className="flex flex-col items-center justify-center gap-2 py-5 cursor-pointer"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
          >
            <img
              src="/rgi-logo-transparent.png"
              alt="RGI"
              className="h-10 w-10 object-contain"
              style={{ filter: "brightness(0) invert(1)" }}
            />
            <div className="flex flex-col items-center gap-0.5">
              <span
                className="text-[9px] font-bold uppercase tracking-[0.25em]"
                style={{ color: "rgba(255,255,255,0.35)" }}
              >
                Rick Goings Institute
              </span>
              <span
                className="text-[11px] font-semibold tracking-widest uppercase"
                style={{ color: "#C09A3A", letterSpacing: "0.18em" }}
              >
                Intelligence
              </span>
            </div>
          </div>
        </Link>

        <div className="flex-1 overflow-y-auto py-2">
          <NavLinks />
        </div>

        {/* Bottom: scrape status */}
        <div className="p-4 space-y-2.5" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>
              Last Scraped
            </p>
            <p className="text-xs font-medium" style={{ color: "rgba(255,255,255,0.45)" }}>
              {scrapeStatus?.lastScrapeAt
                ? format(new Date(scrapeStatus.lastScrapeAt), "MMM d 'at' h:mm a")
                : "Never"}
            </p>
          </div>
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            size="sm"
            className="w-full justify-start gap-2 text-xs border-0"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.65)" }}
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
              style={{ backgroundColor: "#C09A3A", color: "#0B1F3A" }}
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
        <div className="p-6 md:p-8">{children}</div>
      </main>
    </div>
  );
}
