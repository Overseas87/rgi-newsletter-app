import { useGetDashboardSummary, useGetScrapeStatus, useTriggerScrape, getGetScrapeStatusQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { BarChart3, FileText, CheckCircle, Database, Clock, RefreshCw, TrendingUp } from "lucide-react";
import { ArticleCard } from "@/components/article-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const DISCIPLINE_COLORS: Record<string, string> = {
  "Strategic Foresight": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "System Vitality": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Civic Stewardship": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: scrapeStatus, refetch: refetchStatus } = useGetScrapeStatus();
  const triggerScrape = useTriggerScrape();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleScrape = () => {
    triggerScrape.mutate(undefined, {
      onSuccess: () => {
        toast({ title: "Scrape started", description: "Fetching articles from all active sources. Check back in a moment." });
        setTimeout(() => {
          queryClient.invalidateQueries();
        }, 5000);
      },
      onError: () => {
        toast({ title: "Scrape failed", description: "Could not trigger a scrape. Please try again.", variant: "destructive" });
      },
    });
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

  return (
    <div className="space-y-8">
      {/* Scrape Banner */}
      <div className="flex items-center justify-between gap-6 p-5 rounded-xl border border-border bg-card">
        <div>
          <h1 className="text-2xl font-serif tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {scrapeStatus?.lastScrapeAt ? (
              <>Last scraped: <span className="font-medium text-foreground">{format(new Date(scrapeStatus.lastScrapeAt), "MMMM d, yyyy 'at' h:mm a")}</span></>
            ) : (
              "No scrape has run yet."
            )}
          </p>
        </div>
        <Button
          onClick={handleScrape}
          disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
          className="shrink-0 gap-2"
          data-testid="btn-trigger-scrape-dashboard"
          size="lg"
        >
          <RefreshCw className={`h-4 w-4 ${scrapeStatus?.isRunning || triggerScrape.isPending ? "animate-spin" : ""}`} />
          {scrapeStatus?.isRunning ? "Scraping..." : triggerScrape.isPending ? "Starting..." : "Scrape Now"}
        </Button>
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
            <p className="text-xs text-muted-foreground">out of {summary.totalSources} total sources</p>
          </CardContent>
        </Card>
      </div>

      {/* Trending Topics */}
      {summary.articlesByTag && summary.articlesByTag.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <CardTitle>Trending Topics</CardTitle>
            </div>
            <CardDescription>Topics driving the most coverage today across all sources</CardDescription>
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
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <CardTitle>Top Articles by Relevancy</CardTitle>
          </div>
          <CardDescription>Highest-scoring items from the latest scrapes, aligned to RGI disciplines</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {summary.topArticles?.length > 0 ? (
              summary.topArticles.map(article => (
                <ArticleCard key={article.id} article={article} />
              ))
            ) : (
              <div className="text-center py-12 text-muted-foreground text-sm">
                <p className="text-base font-medium mb-1">No articles yet</p>
                <p>Click "Scrape Now" above to fetch today's content from all active sources.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
