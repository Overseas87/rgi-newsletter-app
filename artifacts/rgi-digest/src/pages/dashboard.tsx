import { useState, useMemo } from "react";
import { useGetDashboardSummary, useGetScrapeStatus, useTriggerScrape, useListArticles, type Article } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, formatDistanceToNow } from "date-fns";
import {
  FileText,
  CheckCircle,
  Database,
  Clock,
  RefreshCw,
  Zap,
  AlertCircle,
  ChevronRight,
  Globe,
  Tag,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Star,
  Sparkles,
} from "lucide-react";
import { GenerateModal } from "@/components/generate-modal";
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
  const color = score >= 8 ? "bg-amber-500" : score >= 6.5 ? "bg-primary" : "bg-slate-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

type TopArticle = {
  id: number;
  headline: string;
  url: string;
  sourceName: string;
  author?: string | null;
  publishedAt?: string | null;
  teaserSummary?: string | null;
  relevancyScore: number;
  topicTags: string[];
  disciplineAlignment?: string | null;
  isEmergingSignal?: boolean | null;
  content?: string | null;
};

function TopStoryModal({ article, open, onClose }: { article: TopArticle | null; open: boolean; onClose: () => void }) {
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);

  const loadExplanation = async (id: number) => {
    if (explanation) return;
    setExplanationLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/articles/${id}/explain`);
      if (res.ok) {
        const data = await res.json();
        setExplanation(data.explanation ?? null);
      }
    } catch {
      // silent
    } finally {
      setExplanationLoading(false);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) { onClose(); setExplanation(null); }
    else if (article) loadExplanation(article.id);
  };

  if (!article) return null;

  const discipline = article.disciplineAlignment ?? "";
  const disciplineColor = DISCIPLINE_COLORS[discipline] ?? "bg-muted text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {article.topicTags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">{t}</Badge>
            ))}
            {discipline && (
              <Badge variant="outline" className={`text-[10px] ml-auto ${disciplineColor}`}>{discipline}</Badge>
            )}
          </div>
          <DialogTitle className="text-xl font-serif leading-snug">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors inline-flex items-start gap-2 group"
            >
              {article.headline}
              <ExternalLink className="h-4 w-4 mt-1 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          </DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
            <span className="font-semibold text-foreground">{article.sourceName}</span>
            {article.author && <span>by {article.author}</span>}
            {article.publishedAt && (
              <span>
                {format(new Date(article.publishedAt), "MMM d 'at' h:mm a")}
                <span className="text-muted-foreground/50"> · </span>
                {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
              </span>
            )}
            <div className={`ml-auto flex items-center gap-1 text-xs font-bold ${article.relevancyScore >= 8 ? "text-amber-400" : article.relevancyScore >= 6.5 ? "text-primary" : "text-slate-400"}`}>
              RGI Score: {article.relevancyScore.toFixed(1)}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {article.teaserSummary && (
            <div className="rounded-lg bg-muted/50 border border-border p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Strategic Summary</p>
              <p className="text-sm leading-relaxed">{article.teaserSummary}</p>
            </div>
          )}

          {/* RGI Relevance Explanation */}
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-bold uppercase tracking-widest text-primary">RGI Relevance</p>
            </div>
            {explanationLoading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            ) : explanation ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{explanation}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">No explanation available.</p>
            )}
          </div>

          {article.content && article.content.length > 80 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Article Preview</p>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6">{article.content}</p>
            </div>
          )}

          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Read original article
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TopStoriesSection({ articles, onNavigateFeed }: { articles: TopArticle[]; onNavigateFeed: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<TopArticle | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const displayed = showAll ? articles.slice(0, 10) : articles.slice(0, 5);

  const open = (article: TopArticle) => { setSelected(article); setModalOpen(true); };

  return (
    <>
      <TopStoryModal article={selected} open={modalOpen} onClose={() => setModalOpen(false)} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" />
              <CardTitle>Top Stories Today</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs"
              onClick={onNavigateFeed}
              data-testid="btn-go-to-feed-2"
            >
              Full feed <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          <CardDescription>Highest-scoring articles from today's scrape, filtered through the RGI strategic lens</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 p-3 pt-0">
          {articles.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <p className="text-base font-medium mb-1">No articles yet</p>
              <p>Click "Scrape Now" to fetch today's intelligence feed.</p>
            </div>
          ) : (
            <>
              {displayed.map((article, i) => {
                const rank = i + 1;
                const isHigh = article.relevancyScore >= 8;
                const isMid = article.relevancyScore >= 6.5;
                return (
                  <div
                    key={article.id}
                    className="rounded-lg border border-border bg-background/50 hover:bg-muted/50 hover:border-primary/30 transition-all p-4 group"
                  >
                    <div className="flex items-start gap-4">
                      {/* Rank */}
                      <span className={`shrink-0 text-2xl font-bold tabular-nums w-7 text-right leading-none mt-0.5 ${rank === 1 ? "text-primary" : "text-muted-foreground/30"}`}>
                        {rank}
                      </span>

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-start gap-2 flex-wrap">
                          {article.isEmergingSignal && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wide shrink-0">
                              <Zap className="h-2.5 w-2.5" />Signal
                            </span>
                          )}
                          {article.topicTags.slice(0, 2).map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0.5 h-auto shrink-0">{t}</Badge>
                          ))}
                        </div>

                        {/* Headline — primary click = open source URL */}
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-sm leading-snug hover:text-primary transition-colors flex items-start gap-1.5 group/link"
                        >
                          {article.headline}
                          <ExternalLink className="h-3 w-3 mt-0.5 shrink-0 opacity-0 group-hover/link:opacity-60 transition-opacity text-muted-foreground" />
                        </a>

                        {article.teaserSummary && (
                          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{article.teaserSummary}</p>
                        )}

                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                          <span className="font-medium text-foreground/70">{article.sourceName}</span>
                          {article.author && <span>· {article.author}</span>}
                          {article.publishedAt && (
                            <span>
                              · {format(new Date(article.publishedAt), "h:mm a")}
                              <span className="text-muted-foreground/40"> · </span>
                              {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                            </span>
                          )}
                          {/* RGI Analysis button */}
                          <button
                            onClick={() => open(article)}
                            className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-primary/50 hover:text-primary transition-colors"
                            title="View RGI analysis"
                          >
                            <BookOpen className="h-3 w-3" />
                            RGI Analysis
                          </button>
                        </div>
                      </div>

                      {/* Score ring */}
                      <div className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center text-[11px] font-bold tabular-nums mt-0.5 ${isHigh ? "text-amber-400 border-amber-500/40" : isMid ? "text-primary border-primary/40" : "text-slate-400 border-slate-500/20"}`}>
                        {article.relevancyScore.toFixed(1)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {articles.length > 5 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full gap-2 text-xs mt-1"
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? (
                    <><ChevronUp className="h-3.5 w-3.5" />Show fewer</>
                  ) : (
                    <><ChevronDown className="h-3.5 w-3.5" />Show top 10</>
                  )}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TopicArticlesModal({
  topic,
  open,
  onClose,
}: {
  topic: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const { data: allArticles = [], isLoading } = useListArticles(
    topic ? { topicTag: topic, limit: 100 } : {},
    { query: { enabled: open && !!topic } }
  );

  // Filter to today only on the client side
  const articles = useMemo(() => {
    return (allArticles as Article[])
      .filter((a) => {
        const ref = a.publishedAt ? new Date(a.publishedAt) : new Date(a.scrapedAt);
        return ref >= today;
      })
      .sort((a, b) => b.relevancyScore - a.relevancyScore);
  }, [allArticles, today]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs font-semibold uppercase tracking-wide">{topic}</Badge>
            <span className="text-muted-foreground text-xs">· Today's articles</span>
          </div>
          <DialogTitle className="text-lg font-serif">
            {topic} Intelligence
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 mt-2 pr-1">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => <Skeleton key={n} className="h-20 w-full" />)}
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm font-medium text-muted-foreground">No articles found for {topic} today.</p>
              <p className="text-xs text-muted-foreground mt-1">Try scraping again or check back later.</p>
            </div>
          ) : (
            articles.map((article) => {
              const isHigh = article.relevancyScore >= 8;
              const isMid = article.relevancyScore >= 6.5;
              const pubDate = article.publishedAt ? new Date(article.publishedAt) : null;
              return (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg border border-border bg-background/50 hover:bg-muted/40 hover:border-primary/30 transition-all p-3 group"
                >
                  {/* Score */}
                  <div className={`shrink-0 w-10 h-10 rounded-full border-2 flex items-center justify-center text-[11px] font-bold tabular-nums ${isHigh ? "text-amber-400 border-amber-500/40" : isMid ? "text-primary border-primary/40" : "text-slate-400 border-slate-500/20"}`}>
                    {article.relevancyScore.toFixed(1)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors">
                      {article.headline}
                      <ExternalLink className="inline-block h-3 w-3 ml-1.5 mb-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </p>
                    {article.teaserSummary && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{article.teaserSummary}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground/60">{article.sourceName}</span>
                      {pubDate && (
                        <span>
                          · {format(pubDate, "h:mm a")}
                          <span className="text-muted-foreground/40"> · </span>
                          {formatDistanceToNow(pubDate, { addSuffix: true })}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getPickScoreStyle(score: number) {
  if (score >= 9) return { ring: "border-amber-500/60 text-amber-400", bar: "bg-amber-500", label: "Landmark" };
  if (score >= 7.5) return { ring: "border-primary/50 text-primary", bar: "bg-primary", label: "High" };
  if (score >= 6) return { ring: "border-slate-500/40 text-slate-400", bar: "bg-slate-500", label: "Solid" };
  return { ring: "border-muted text-muted-foreground", bar: "bg-muted-foreground/40", label: "Low" };
}

function TopPicksSection({
  picks,
  onGenerated,
}: {
  picks: TopArticle[];
  onGenerated: () => void;
}) {
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const handleGenerate = async (article: TopArticle) => {
    setGeneratingId(article.id);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/digest/topic-article`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleIds: [article.id], editorNotes: "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Generation failed");
      }
      toast({
        title: "Brief generated",
        description: `Article drafted from "${article.headline.slice(0, 60)}…". Review it now.`,
      });
      onGenerated();
      navigate("/review");
    } catch (e) {
      toast({
        title: "Generation failed",
        description: String(e instanceof Error ? e.message : e),
        variant: "destructive",
      });
    } finally {
      setGeneratingId(null);
    }
  };

  if (!picks || picks.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-2">
          <Star className="h-4 w-4 text-amber-400 fill-amber-400/30" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-foreground/80">Today's Top Picks</h2>
          <span className="text-[10px] text-muted-foreground ml-1">Best candidates for publication</span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {picks.map((article) => {
          const style = getPickScoreStyle(article.relevancyScore);
          const isGenerating = generatingId === article.id;
          return (
            <div
              key={article.id}
              className="flex flex-col rounded-xl border border-border bg-card hover:border-primary/30 transition-colors p-4 gap-3"
            >
              {/* Score + tags */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                  {article.topicTags.slice(0, 2).map((t) => (
                    <Badge key={t} variant="outline" className="text-[10px] px-1.5 h-4">{t}</Badge>
                  ))}
                </div>
                <div className={`shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center text-[11px] font-bold tabular-nums ${style.ring}`}>
                  {article.relevancyScore.toFixed(1)}
                </div>
              </div>

              {/* Headline */}
              <p className="text-sm font-semibold leading-snug flex-1 line-clamp-3">{article.headline}</p>

              {/* Teaser */}
              {article.teaserSummary && (
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">{article.teaserSummary}</p>
              )}

              {/* Source + date */}
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-foreground/60">{article.sourceName}</span>
                {article.publishedAt && (
                  <span>
                    · {format(new Date(article.publishedAt), "h:mm a")}
                    <span className="text-muted-foreground/40"> · </span>
                    {formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })}
                  </span>
                )}
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-0.5 text-primary/60 hover:text-primary transition-colors"
                  title="Open source article"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {/* Action */}
              <Button
                size="sm"
                className="w-full h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white mt-auto"
                onClick={() => handleGenerate(article)}
                disabled={isGenerating || generatingId !== null}
              >
                {isGenerating ? (
                  <><Loader2 className="h-3 w-3 animate-spin" />Generating…</>
                ) : (
                  <><Sparkles className="h-3 w-3" />Generate Brief</>
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [briefLoading, setBriefLoading] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [topicArticlesOpen, setTopicArticlesOpen] = useState(false);
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
      <div className="space-y-5">
        <Skeleton className="h-14 w-full" />
        <div className="grid gap-5 lg:grid-cols-5">
          <div className="lg:col-span-3"><Skeleton className="h-[480px] w-full" /></div>
          <div className="lg:col-span-2"><Skeleton className="h-[480px] w-full" /></div>
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!summary) return null;

  const hasArticles = summary.totalArticlesToday > 0;

  const handleTopicClick = (topic: string) => {
    setSelectedTopic(topic);
    setTopicArticlesOpen(true);
  };

  return (
    <div className="space-y-5">
      <GenerateModal open={topicModalOpen} onOpenChange={setTopicModalOpen} initialMode="topic_article" />
      <TopicArticlesModal
        topic={selectedTopic}
        open={topicArticlesOpen}
        onClose={() => { setTopicArticlesOpen(false); setSelectedTopic(null); }}
      />

      {/* ── Action Bar ── */}
      <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-serif font-semibold text-foreground leading-none">Intelligence Dashboard</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {scrapeStatus?.lastScrapeAt ? (
              <>Last scraped: <span className="font-medium text-foreground/70">{format(new Date(scrapeStatus.lastScrapeAt), "MMM d, yyyy 'at' h:mm a")}</span></>
            ) : (
              <span className="italic">No scrape has run yet</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            onClick={handleScrape}
            disabled={triggerScrape.isPending || scrapeStatus?.isRunning}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8"
            data-testid="btn-trigger-scrape-dashboard"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scrapeStatus?.isRunning || triggerScrape.isPending ? "animate-spin" : ""}`} />
            {scrapeStatus?.isRunning ? "Scraping..." : triggerScrape.isPending ? "Starting..." : "Scrape Now"}
          </Button>

          <div className="w-px h-5 bg-border shrink-0" />

          <Button
            onClick={handleGenerateDailyBrief}
            disabled={briefLoading || !hasArticles}
            size="sm"
            className="gap-1.5 text-xs h-8 bg-blue-600 hover:bg-blue-700 text-white"
            data-testid="btn-generate-daily-brief"
          >
            {briefLoading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Generating…</>
            ) : (
              <><Globe className="h-3.5 w-3.5" />Daily Brief</>
            )}
          </Button>

          <Button
            onClick={() => setTopicModalOpen(true)}
            disabled={!hasArticles}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            data-testid="btn-generate-topic-article"
          >
            <Tag className="h-3.5 w-3.5" />
            Topic Article
          </Button>
        </div>
      </div>

      {/* ── Main Grid: Top Stories (left) + What Matters Today (right) ── */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Top Stories — dominant */}
        <div className="lg:col-span-3">
          <TopStoriesSection
            articles={(summary.topArticles ?? []) as TopArticle[]}
            onNavigateFeed={() => navigate("/feed")}
          />
        </div>

        {/* What Matters Today — sidebar */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-primary" />
                  <CardTitle className="text-base">What Matters Today</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-xs h-7 px-2"
                  onClick={() => navigate("/topics")}
                  data-testid="btn-go-to-topics"
                >
                  Topics <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
              <CardDescription className="text-[11px]">Topics ranked by strategic importance</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {summary.topicIntelligence && summary.topicIntelligence.length > 0 ? (
                summary.topicIntelligence.slice(0, 8).map((ti, i) => (
                  <button
                    key={ti.topic}
                    onClick={() => handleTopicClick(ti.topic)}
                    className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border bg-background/50 hover:bg-muted/30 hover:border-primary/20 transition-colors group cursor-pointer"
                  >
                    <span className="text-base font-bold text-muted-foreground/25 w-5 text-right shrink-0 tabular-nums leading-snug mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-sm leading-none group-hover:text-primary transition-colors">{ti.topic}</span>
                        {ti.hasEmergingSignal && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wide">
                            <Zap className="h-2 w-2" />Signal
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1.5 h-4 ml-auto ${DISCIPLINE_COLORS[ti.discipline] ?? "bg-muted text-muted-foreground"}`}
                        >
                          {ti.discipline}
                        </Badge>
                        <ChevronRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-primary/60 transition-colors" />
                      </div>
                      <ImportanceBar score={ti.importanceScore} />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 flex-1">{ti.significance}</p>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-bold tabular-nums">{ti.importanceScore.toFixed(1)}</p>
                          <p className="text-[9px] text-muted-foreground">{ti.articleCount} art.</p>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <p className="text-sm font-medium mb-1">No data yet</p>
                  <p className="text-xs">Scrape articles to see today's topic intelligence.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Today's Top Picks ── */}
      {summary.topPicks && summary.topPicks.length > 0 && (
        <TopPicksSection
          picks={(summary.topPicks ?? []) as TopArticle[]}
          onGenerated={() => queryClient.invalidateQueries()}
        />
      )}

      {/* ── Compact Stats Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Scraped Today", value: summary.totalArticlesToday, sub: "articles fetched", icon: <FileText className="h-3.5 w-3.5" /> },
          { label: "Pending Review", value: summary.pendingReview, sub: "drafts awaiting approval", icon: <Clock className="h-3.5 w-3.5" /> },
          { label: "Approved Today", value: summary.approvedToday, sub: "ready for publication", icon: <CheckCircle className="h-3.5 w-3.5" /> },
          { label: "Active Sources", value: summary.activeSources, sub: `of ${summary.totalSources} total`, icon: <Database className="h-3.5 w-3.5" /> },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="text-muted-foreground shrink-0">{s.icon}</div>
            <div className="min-w-0">
              <p className="text-lg font-bold tabular-nums leading-none">{s.value}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
