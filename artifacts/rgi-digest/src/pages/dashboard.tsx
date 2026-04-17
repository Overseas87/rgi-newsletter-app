import { useState } from "react";
import { useGetDashboardSummary, useGetScrapeStatus, useTriggerScrape } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  BarChart3,
  FileText,
  CheckCircle,
  Database,
  Clock,
  RefreshCw,
  TrendingUp,
  Zap,
  Twitter,
  AlertCircle,
  Wand2,
  ChevronRight,
  Globe,
  Tag,
  Loader2,
} from "lucide-react";
import { GenerateModal } from "@/components/generate-modal";
import { ArticleCard } from "@/components/article-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const DISCIPLINE_COLORS: Record<string, string> = {
  "Strategic Foresight": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "System Vitality": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Civic Stewardship": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

function ImportanceBar({ score }: { score: number }) {
  const pct = Math.min(100, (score / 10) * 100);
  const color = score >= 8 ? "bg-red-500" : score >= 6.5 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Dashboard() {
  const [briefLoading, setBriefLoading] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: scrapeStatus } = useGetScrapeStatus();
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Scrape started", description: "Fetching articles from all active sources. Check back in a moment." });
        setTimeout(() => queryClient.invalidateQueries(), 5000);
      },
      onError: () => {
        toast({ title: "Scrape failed", description: "Could not trigger a scrape. Please try again.", variant: "destructive" });
      },
    });
  };

  const handleGenerateDailyBrief = async () => {
    setBriefLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/digest/daily-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      toast({ title: "Daily Intelligence Brief generated", description: "The comprehensive brief is now in Pending Review." });
      queryClient.invalidateQueries();
      navigate("/review");
    } catch (e) {
      toast({ title: "Brief generation failed", description: String(e instanceof Error ? e.message : e), variant: "destructive" });
    } finally {
      setBriefLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const hasArticles = summary.totalArticlesToday > 0;

  return (
    <div className="space-y-8">
      <GenerateModal open={topicModalOpen} onOpenChange={setTopicModalOpen} initialMode="topic_article" />

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-serif tracking-tight text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {scrapeStatus?.lastScrapeAt ? (
                <>Last scraped: <span className="font-medium text-foreground">{format(new Date(scrapeStatus.lastScrapeAt), "MMMM d, yyyy 'at' h:mm a")}</span></>
              ) : "No scrape has run yet."}
            </p>
          </div>
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            variant="outline"
            size="sm"
            className="gap-2 shrink-0"
            data-testid="btn-trigger-scrape-dashboard"
          >
            <RefreshCw className={`h-4 w-4 ${scrapeStatus?.isRunning || triggerScrape.isPending ? "animate-spin" : ""}`} />
            {scrapeStatus?.isRunning ? "Scraping..." : triggerScrape.isPending ? "Starting..." : "Scrape Now"}
          </Button>
        </div>

        {/* Generation Controls — Two distinct sections */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Section 1: Daily Brief */}
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.04] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-400" />
              <p className="text-sm font-bold text-blue-400 uppercase tracking-wider">Daily Intelligence Brief</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Synthesizes all of today's top articles into one authoritative macro document — executive summary, dominant narrative, cross-theme intelligence, RGI perspective.
            </p>
            <Button
              onClick={handleGenerateDailyBrief}
              disabled={briefLoading || !hasArticles}
              className="w-full gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              data-testid="btn-generate-daily-brief"
            >
              {briefLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Generating Brief…</>
              ) : (
                <><Globe className="h-4 w-4" />Generate Daily Brief</>
              )}
            </Button>
          </div>

          {/* Section 2: Topic Article */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-emerald-400" />
              <p className="text-sm font-bold text-emerald-400 uppercase tracking-wider">Topic Article</p>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Deep-dive analysis on a specific topic. Select themes from the intelligence feed — the system finds relevant articles and synthesizes one focused strategic brief.
            </p>
            <Button
              onClick={() => setTopicModalOpen(true)}
              disabled={!hasArticles}
              variant="outline"
              className="w-full gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
              data-testid="btn-generate-topic-article"
            >
              <Tag className="h-4 w-4" />
              Generate Topic Article
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Scraped Today</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalArticlesToday}</div>
            <p className="text-xs text-muted-foreground">articles fetched today</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Review</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.pendingReview}</div>
            <p className="text-xs text-muted-foreground">digest drafts awaiting approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved Today</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.approvedToday}</div>
            <p className="text-xs text-muted-foreground">ready for publication</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sources</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.activeSources}</div>
            <p className="text-xs text-muted-foreground">out of {summary.totalSources} total</p>
          </CardContent>
        </Card>
      </div>

      {/* Signal Bars */}
      {hasArticles && (summary.socialSignalsCount > 0 || summary.emergingSignalsCount > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {summary.socialSignalsCount > 0 && (
            <Card className="border-sky-500/20">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-sky-500/10 flex items-center justify-center shrink-0">
                    <Twitter className="h-5 w-5 text-sky-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-sky-400 text-lg leading-none">{summary.socialSignalsCount}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Social media signals in today's feed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {summary.emergingSignalsCount > 0 && (
            <Card className="border-amber-500/30">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <Zap className="h-5 w-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="font-semibold text-amber-400 text-lg leading-none">{summary.emergingSignalsCount}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Emerging signals flagged for attention</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* What Matters Today — Topic Intelligence */}
      {summary.topicIntelligence && summary.topicIntelligence.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-primary" />
                <CardTitle>What Matters Today</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-xs"
                onClick={() => navigate("/feed")}
                data-testid="btn-go-to-feed"
              >
                Intelligence Feed <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <CardDescription>Topics ranked by strategic importance, based on coverage volume and relevancy scores</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {summary.topicIntelligence.map((ti, i) => (
                <div key={ti.topic} className="flex items-center gap-4 p-3 rounded-lg border border-border bg-background/50">
                  <span className="text-xl font-bold text-muted-foreground/30 w-7 text-right shrink-0 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{ti.topic}</span>
                      {ti.hasEmergingSignal && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wide">
                          <Zap className="h-2.5 w-2.5" />Signal
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] ml-auto ${DISCIPLINE_COLORS[ti.discipline] ?? "bg-muted text-muted-foreground"}`}
                      >
                        {ti.discipline}
                      </Badge>
                    </div>
                    <ImportanceBar score={ti.importanceScore} />
                    <p className="text-xs text-muted-foreground">{ti.significance}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold">{ti.importanceScore.toFixed(1)}</p>
                    <p className="text-[10px] text-muted-foreground">{ti.articleCount} src</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trending Topics Tags */}
      {summary.articlesByTag && summary.articlesByTag.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle>Coverage by Topic</CardTitle>
            </div>
            <CardDescription>Article volume across all sources today</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {summary.articlesByTag.slice(0, 9).map((tagCount, i) => (
                <div key={tagCount.tag} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/50">
                  <span className="text-2xl font-bold text-muted-foreground/40 w-8 text-right shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{tagCount.tag}</p>
                    <p className="text-xs text-muted-foreground">{tagCount.count} article{tagCount.count !== 1 ? "s" : ""}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Articles */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              <CardTitle>Top Articles by Relevancy</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={() => navigate("/feed")}
              data-testid="btn-go-to-feed-2"
            >
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <CardDescription>Highest-scoring items from the latest scrapes, aligned to RGI disciplines</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {summary.topArticles?.length > 0 ? (
              summary.topArticles.map((article) => (
                <ArticleCard key={article.id} article={article} />
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <p className="text-base font-medium mb-1">No articles yet</p>
                <p>Click "Scrape Now" to fetch today's content, or "Generate Daily Brief" after scraping.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
