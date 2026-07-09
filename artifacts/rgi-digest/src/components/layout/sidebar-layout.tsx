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
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { GenerateModal } from "@/components/generate-modal";
import { asArray, safeDate } from "@/lib/arrays";
import { useToast } from "@/hooks/use-toast";
import { userSafeErrorMessage } from "@/lib/api-error";

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

type RuntimeHealth = {
  status?: string;
  database?: string;
  errorCategory?: string;
  safeError?: { message?: string };
  runtime?: {
    firestoreProjectId?: string | null;
    firestoreEmulatorActive?: boolean;
    localStoreMode?: boolean;
    localFallbackEnabled?: boolean;
    mockDataMode?: boolean;
  };
};

type ScrapeSummaryLite = {
  finishedAt?: string | null;
  articlesSaved?: number;
  articlesAlreadyExisting?: number;
  lowScoreSkipped?: number;
  duplicatesSkipped?: number;
  failedFeeds?: number;
  firestoreWriteFailures?: number;
};

async function fetchRuntimeHealth(): Promise<RuntimeHealth> {
  const base = import.meta.env.VITE_API_BASE_URL || "";
  const response = await fetch(`${base}/api/health`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Health check failed (${response.status})`);
  return response.json();
}

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const { data: scrapeStatus, isError: scrapeStatusError, refetch: refetchScrapeStatus } = useGetScrapeStatus({
    query: {
      queryKey: getGetScrapeStatusQueryKey(),
      refetchInterval: 4000,
      refetchIntervalInBackground: true,
    },
  });
  const { data: runtimeHealth, isError: runtimeHealthError } = useQuery({
    queryKey: ["/api/health"],
    queryFn: fetchRuntimeHealth,
    refetchInterval: 15000,
    retry: 1,
  });
  const { data: pendingArticles = [] } = useListDigestArticles({ status: "pending_review" });
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeScrapeStartedAtRef = useRef<string | null>(null);
  const notifiedScrapeFinishedAtRef = useRef<string | null>(null);

  const pendingCount = asArray<{ id: number }>(pendingArticles).length;
  const scrapeStatusRecord = scrapeStatus as (typeof scrapeStatus & {
    state?: unknown;
    message?: unknown;
    startedAt?: unknown;
    staleAfterMs?: unknown;
    lastScrapeFailures?: unknown;
    lastScrapeSummary?: ScrapeSummaryLite;
  }) | undefined;
  const scrapeState = typeof scrapeStatusRecord?.state === "string" ? scrapeStatusRecord.state : undefined;
  const scrapeMessage = typeof scrapeStatusRecord?.message === "string" ? scrapeStatusRecord.message : undefined;
  const scrapeSummary = scrapeStatusRecord?.lastScrapeSummary;
  const scrapeStartedAt = typeof scrapeStatusRecord?.startedAt === "string"
    ? scrapeStatusRecord.startedAt
    : null;
  const scrapeStartedMs = scrapeStartedAt ? safeDate(scrapeStartedAt).getTime() : 0;
  const scrapeStaleAfterMs = Number(scrapeStatusRecord?.staleAfterMs ?? 15 * 60 * 1000);
  const isScrapeStale = Boolean(scrapeStatus?.isRunning && scrapeStartedMs && Date.now() - scrapeStartedMs > scrapeStaleAfterMs);
  const scrapeRunning = Boolean(scrapeStatus?.isRunning && !isScrapeStale);
  const latestScrapeFailure = scrapeState === "failed" || scrapeState === "partial" || scrapeState === "stale"
    ? scrapeMessage ?? asArray<{ message?: string }>(scrapeStatusRecord?.lastScrapeFailures)[0]?.message
    : asArray<{ message?: string }>(scrapeStatusRecord?.lastScrapeFailures)[0]?.message;
  const runtime = runtimeHealth?.runtime;
  const databaseUnavailable = runtimeHealth?.status === "degraded" || runtimeHealth?.database === "unverified" || runtimeHealth?.database === "unreachable";
  const runtimeModeLabel = runtime?.mockDataMode
    ? "Mock data"
    : runtime?.localStoreMode
      ? "Local JSON"
      : runtime?.firestoreEmulatorActive
        ? "Firestore emulator"
        : runtimeHealth?.database === "firestore"
          ? "Firestore"
          : runtimeHealth?.database ?? "Database";
  const runtimeModeVariant = databaseUnavailable ? "destructive" : runtime?.localStoreMode || runtime?.mockDataMode || runtime?.localFallbackEnabled ? "outline" : "secondary";
  const runtimeModeMessage = runtimeHealthError
    ? "Runtime status unavailable."
    : runtimeHealth?.errorCategory === "firestore_quota_exceeded"
      ? "Firestore quota exceeded. Live data is unavailable."
      : databaseUnavailable
        ? runtimeHealth?.safeError?.message ?? "Database is temporarily unavailable."
        : runtime?.localStoreMode || runtime?.mockDataMode
          ? "Development data is active. This is not the live Firestore dataset."
          : runtime?.localFallbackEnabled
            ? "Local fallback is enabled. Confirm whether data is live before reviewing counts."
            : null;
  const lastScrapeLabel = scrapeStatusError
    ? "Scrape status unavailable"
    : scrapeRunning && scrapeStartedAt
      ? <>
          Running since {format(safeDate(scrapeStartedAt), "h:mm a")}
          {scrapeMessage ? <span className="text-gray-400"> · {scrapeMessage}</span> : null}
        </>
      : isScrapeStale
        ? "Previous scrape timed out"
        : scrapeStatus?.lastScrapeAt
          ? <>
              {format(safeDate(scrapeStatus.lastScrapeAt), "MMM d 'at' h:mm a")}
              <span className="text-gray-400"> · {formatDistanceToNow(safeDate(scrapeStatus.lastScrapeAt), { addSuffix: true })}</span>
            </>
          : "Never scraped";

  useEffect(() => {
    const activeStartedAt = activeScrapeStartedAtRef.current;
    const finishedAt = scrapeSummary?.finishedAt ?? null;
    if (!activeStartedAt || scrapeStatus?.isRunning || !finishedAt) return;
    if (scrapeStartedAt !== activeStartedAt) return;
    if (notifiedScrapeFinishedAtRef.current === finishedAt) return;

    notifiedScrapeFinishedAtRef.current = finishedAt;
    activeScrapeStartedAtRef.current = null;

    const saved = Number(scrapeSummary?.articlesSaved ?? 0);
    const existing = Number(scrapeSummary?.articlesAlreadyExisting ?? 0);
    const lowScore = Number(scrapeSummary?.lowScoreSkipped ?? 0);
    const duplicate = Number(scrapeSummary?.duplicatesSkipped ?? 0);
    const failedFeeds = Number(scrapeSummary?.failedFeeds ?? 0);
    const writeFailures = Number(scrapeSummary?.firestoreWriteFailures ?? 0);
    const failed = scrapeState === "failed";
    const partial = scrapeState === "partial" || failedFeeds > 0 || writeFailures > 0;

    toast({
      title: failed
        ? "Scrape failed"
        : partial
          ? `Scrape completed with partial failures`
          : saved > 0
            ? `Scrape saved ${saved} new article${saved === 1 ? "" : "s"}`
            : "Scrape completed: no new articles saved",
      description: failed
        ? scrapeMessage ?? "The scrape did not complete. Check backend logs."
        : [
            saved > 0 ? `${saved} saved` : null,
            existing > 0 ? `${existing} already existed` : null,
            duplicate > 0 ? `${duplicate} duplicate${duplicate === 1 ? "" : "s"}` : null,
            lowScore > 0 ? `${lowScore} below RGI threshold` : null,
            failedFeeds > 0 ? `${failedFeeds} feed${failedFeeds === 1 ? "" : "s"} failed` : null,
            writeFailures > 0 ? `${writeFailures} write failure${writeFailures === 1 ? "" : "s"}` : null,
          ].filter(Boolean).join(" · ") || scrapeMessage || "Scrape completed.",
      variant: failed ? "destructive" : undefined,
    });

    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
    queryClient.invalidateQueries({ queryKey: ["/api/articles/page"] });
    queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
  }, [
    queryClient,
    scrapeMessage,
    scrapeStartedAt,
    scrapeState,
    scrapeStatus?.isRunning,
    scrapeSummary?.articlesAlreadyExisting,
    scrapeSummary?.articlesSaved,
    scrapeSummary?.duplicatesSkipped,
    scrapeSummary?.failedFeeds,
    scrapeSummary?.finishedAt,
    scrapeSummary?.firestoreWriteFailures,
    scrapeSummary?.lowScoreSkipped,
    toast,
  ]);

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: (result: unknown) => {
        const payload = result && typeof result === "object" ? result as {
          status?: string;
          message?: string;
          articlesFound?: number;
          articlesAdded?: number;
          summary?: {
            articlesSaved?: number;
            articlesAlreadyExisting?: number;
            lowScoreSkipped?: number;
            duplicatesSkipped?: number;
            failedFeeds?: number;
          };
          startedAt?: string;
          lastScrapeSummary?: ScrapeSummaryLite;
        } : {};

        if (payload.status === "already_running") {
          activeScrapeStartedAtRef.current = typeof payload.startedAt === "string" ? payload.startedAt : null;
          toast({
            title: "Scrape already running",
            description: "The existing scrape is still active. This panel will update when it finishes.",
          });
          queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
          return;
        }

        if (payload.status === "running" || payload.message?.toLowerCase().includes("started")) {
          activeScrapeStartedAtRef.current = typeof payload.startedAt === "string" ? payload.startedAt : null;
          notifiedScrapeFinishedAtRef.current = null;
          toast({
            title: "Scrape started",
            description: "The scraper is running in the background. This panel will update automatically.",
          });
          queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
          return;
        }

        const summary = payload.summary ?? {};
        const saved = Number(summary.articlesSaved ?? payload.articlesAdded ?? 0);
        const existing = Number(summary.articlesAlreadyExisting ?? 0);
        const lowScore = Number(summary.lowScoreSkipped ?? 0);
        const failedFeeds = Number(summary.failedFeeds ?? 0);
        toast({
          title: saved > 0 ? `Scrape saved ${saved} new article${saved === 1 ? "" : "s"}` : "Scrape completed: no new articles saved",
          description: [
            existing > 0 ? `${existing} already existed` : null,
            lowScore > 0 ? `${lowScore} below RGI threshold` : null,
            failedFeeds > 0 ? `${failedFeeds} feed${failedFeeds === 1 ? "" : "s"} failed` : null,
          ].filter(Boolean).join(" · ") || "No new qualifying articles were found.",
        });
        queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/articles"] });
        queryClient.invalidateQueries({ queryKey: ["/api/articles/page"] });
        setTimeout(() => queryClient.invalidateQueries(), 1500);
      },
      onError: (error) => {
        toast({
          title: "Scrape failed",
          description: userSafeErrorMessage(error, "The scraper could not complete. Check backend logs."),
          variant: "destructive",
        });
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetScrapeStatusQueryKey() });
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
        <div className="mb-3 rounded-md border border-gray-100 bg-gray-50 px-2 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Runtime</span>
            <Badge variant={runtimeModeVariant} className="h-5 px-1.5 text-[10px]">
              {runtimeModeLabel}
            </Badge>
          </div>
          {runtime?.firestoreProjectId ? (
            <p className="mt-1 truncate text-[10px] text-gray-500">{runtime.firestoreProjectId}</p>
          ) : null}
          {runtimeModeMessage ? (
            <p className={`mt-1 text-[10px] leading-snug ${databaseUnavailable || runtimeHealthError ? "text-red-700" : "text-amber-700"}`}>
              {runtimeModeMessage}
            </p>
          ) : null}
        </div>
        <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wider font-semibold">
          Last Scraped
        </div>
        <div className="text-xs text-gray-500 mb-2">
          {lastScrapeLabel}
        </div>
        {(scrapeStatusError || isScrapeStale || latestScrapeFailure) ? (
          <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800">
            {scrapeStatusError
              ? "Scrape status failed to load."
              : isScrapeStale
                ? "Scrape lock looked stale and can be retried."
                : latestScrapeFailure ?? "Last scrape had feed failures."}
          </div>
        ) : null}
        <button
          onClick={() => {
            if (scrapeStatusError) {
              void refetchScrapeStatus();
              return;
            }
            handleScrape();
          }}
          disabled={triggerScrape.isPending || scrapeRunning || databaseUnavailable}
          className="w-full flex items-center justify-center gap-1.5 text-xs font-medium py-1.5 rounded-md border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800 transition-colors disabled:opacity-50"
          data-testid="btn-trigger-scrape"
        >
          <RefreshCw className={`h-3 w-3 ${scrapeRunning || triggerScrape.isPending ? "animate-spin" : ""}`} />
          {databaseUnavailable ? "Scrape Unavailable" : scrapeStatusError ? "Retry Status" : scrapeRunning ? "Scraping…" : triggerScrape.isPending ? "Starting…" : isScrapeStale ? "Retry Scrape" : "Scrape Now"}
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
