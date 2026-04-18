import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Rss,
  Tag,
  Clock,
  Archive,
  XCircle,
  Database,
  Settings as SettingsIcon,
  RefreshCw,
  Menu,
  Wand2,
  Info,
  ChevronRight,
} from "lucide-react";
import {
  useGetScrapeStatus,
  useTriggerScrape,
  useListDigestArticles,
  getGetScrapeStatusQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { GenerateModal } from "@/components/generate-modal";

const NAV_GROUPS = [
  {
    label: "Intelligence",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/feed", label: "Intelligence Feed", icon: Rss },
      { path: "/topics", label: "Today's Topics", icon: Tag },
    ],
  },
  {
    label: "Editorial",
    items: [
      { path: "/review", label: "Pending Review", icon: Clock, badge: true },
      { path: "/published", label: "Published", icon: Archive },
      { path: "/rejected", label: "Rejected", icon: XCircle },
    ],
  },
  {
    label: "Administration",
    items: [
      { path: "/sources", label: "Sources", icon: Database },
      { path: "/settings", label: "Settings", icon: SettingsIcon },
      { path: "/about", label: "About RGI", icon: Info },
    ],
  },
];

const NAVY = "#0B1F3B";
const GOLD = "#C9A227";

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { data: scrapeStatus } = useGetScrapeStatus();
  const { data: pendingArticles = [] } = useListDigestArticles({ status: "pending_review" });
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();

  const pendingCount = (pendingArticles as { id: number }[]).length;

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
        setTimeout(() => queryClient.invalidateQueries(), 6000);
      },
    });
  };

  const SidebarNav = ({ onClose }: { onClose?: () => void }) => (
    <div className="flex flex-col h-full">
      {/* Generate CTA */}
      <div className="p-3">
        <button
          onClick={() => { setGenerateOpen(true); onClose?.(); }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
          style={{ backgroundColor: NAVY, color: "white" }}
          data-testid="nav-generate-brief"
        >
          <Wand2 className="h-4 w-4" />
          Generate Brief
        </button>
      </div>

      {/* Nav Groups */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="pt-3">
            <p
              className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{ color: "#9CA3AF" }}
            >
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = location === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  onClick={() => onClose?.()}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all mb-0.5 ${
                    isActive
                      ? "text-foreground"
                      : "text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                  }`}
                  style={isActive ? { backgroundColor: `${NAVY}0D`, color: NAVY } : {}}
                >
                  <item.icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: isActive ? NAVY : "#9CA3AF" }}
                  />
                  <span className="flex-1">{item.label}</span>
                  {"badge" in item && item.badge && pendingCount > 0 && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                      style={{ backgroundColor: GOLD, color: NAVY }}
                    >
                      {pendingCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Scrape status footer */}
      <div className="p-3 border-t border-gray-100">
        <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider font-semibold">
          Last Scraped
        </div>
        <div className="text-xs text-gray-500 mb-2">
          {scrapeStatus?.lastScrapeAt
            ? <>
                {format(new Date(scrapeStatus.lastScrapeAt), "MMM d 'at' h:mm a")}
                <span className="text-gray-400"> · {formatDistanceToNow(new Date(scrapeStatus.lastScrapeAt), { addSuffix: true })}</span>
              </>
            : "Never scraped"}
        </div>
        <button
          onClick={handleScrape}
          disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-colors disabled:opacity-50"
          data-testid="btn-trigger-scrape"
        >
          <RefreshCw className={`h-3 w-3 ${scrapeStatus?.isRunning || triggerScrape.isPending ? "animate-spin" : ""}`} />
          {scrapeStatus?.isRunning ? "Scraping…" : triggerScrape.isPending ? "Starting…" : "Scrape Now"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <GenerateModal open={generateOpen} onOpenChange={setGenerateOpen} />

      {/* ── TOP BAR ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 bg-white flex items-center"
        style={{ borderBottom: "1px solid #E5E7EB" }}
      >
        {/* Brand section — aligns with sidebar width */}
        <Link href="/">
          <div
            className="flex items-center gap-2.5 h-14 px-4 w-56 shrink-0 cursor-pointer hover:bg-gray-50 transition-colors"
            style={{ borderRight: "1px solid #E5E7EB" }}
          >
            <img
              src="/rgi-logo-mark.png"
              alt="RGI"
              className="h-8 w-8 object-contain shrink-0"
              style={{
                filter:
                  "brightness(0) saturate(100%) invert(11%) sepia(46%) saturate(900%) hue-rotate(183deg) brightness(97%) contrast(105%)",
              }}
            />
            <div className="min-w-0">
              <p className="text-[12px] font-bold leading-snug truncate" style={{ color: NAVY }}>
                Rick Goings Institute
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.1em] leading-tight whitespace-nowrap" style={{ color: GOLD }}>
                Newsletter Generator
              </p>
            </div>
          </div>
        </Link>

        {/* Center / right area */}
        <div className="flex-1 flex items-center justify-between px-6">
          <div className="hidden md:flex items-center gap-1 text-sm text-gray-400">
            {/* Breadcrumb placeholder — could show current page */}
          </div>

          {/* Mobile menu trigger */}
          <div className="md:hidden">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="btn-mobile-menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0 bg-white border-r border-gray-100">
                <div
                  className="flex items-center gap-2.5 h-14 px-4"
                  style={{ borderBottom: "1px solid #E5E7EB" }}
                >
                  <img
                    src="/rgi-logo-mark.png"
                    alt="RGI"
                    className="h-8 w-8 object-contain shrink-0"
                    style={{
                      filter:
                        "brightness(0) saturate(100%) invert(11%) sepia(46%) saturate(900%) hue-rotate(183deg) brightness(97%) contrast(105%)",
                    }}
                  />
                  <div>
                    <p className="text-[12px] font-bold leading-snug" style={{ color: NAVY }}>Rick Goings Institute</p>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.18em] leading-tight" style={{ color: GOLD }}>Newsletter Generator</p>
                  </div>
                </div>
                <SidebarNav onClose={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      {/* ── BODY (below top bar) ── */}
      <div className="flex pt-14 min-h-[100dvh]">

        {/* ── SIDEBAR ── */}
        <aside
          className="hidden md:flex flex-col fixed left-0 top-14 bottom-0 w-56 bg-white overflow-hidden"
          style={{ borderRight: "1px solid #E5E7EB" }}
        >
          <SidebarNav />
        </aside>

        {/* ── MAIN CONTENT ── */}
        <main className="flex-1 md:ml-56 min-h-full">
          <div className="p-6 md:p-8 max-w-[1400px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
