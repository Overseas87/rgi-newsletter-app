import { useState, useMemo } from "react";
import { useGetDashboardSummary, useGetScrapeStatus, useListArticles, type Article, type TopicIntelligence } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, formatDistanceToNow } from "date-fns";
import {
  FileText,
  CheckCircle,
  Database,
  Clock,
  Zap,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  BookOpen,
  MessageSquareQuote,
  BarChart2,
  ArrowRight,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { asArray, asNumber, asString, asStringArray, safeDate } from "@/lib/arrays";
import { userSafeErrorMessage } from "@/lib/api-error";

const DISCIPLINE_COLORS: Record<string, string> = {
  "Strategic Foresight": "bg-blue-50 text-blue-700 border-blue-200",
  "System Vitality": "bg-amber-50 text-amber-700 border-amber-200",
  "Civic Stewardship": "bg-emerald-50 text-emerald-700 border-emerald-200",
};

function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const safeScore = asNumber(score);
  const isHigh = safeScore >= 8;
  const isMid = safeScore >= 6.5;

  if (isHigh) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded font-bold tabular-nums leading-none shrink-0 ${
          size === "sm" ? "text-[10px] px-1.5 py-0.5 min-w-[3.4rem]" : "text-xs px-2.5 py-1 min-w-[4rem]"
        }`}
        style={{ backgroundColor: "#C9A227", color: "#0B1F3B" }}
      >
        {safeScore.toFixed(1)}<span className="opacity-50 font-normal ml-0.5">/10</span>
      </span>
    );
  }

  const colorClass = isMid
    ? "bg-blue-50 text-blue-800 border-blue-200 border"
    : "bg-slate-100 text-slate-600 border-slate-200 border";
  const sizeClass = size === "sm"
    ? "text-[10px] px-1.5 py-0.5 min-w-[3.4rem]"
    : "text-xs px-2.5 py-1 min-w-[4rem]";
  return (
    <span className={`inline-flex items-center justify-center rounded font-semibold tabular-nums leading-none shrink-0 ${colorClass} ${sizeClass}`}>
      {safeScore.toFixed(1)}<span className="opacity-50 font-normal ml-0.5">/10</span>
    </span>
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
  authenticityScore?: number | null;
  viewpoint?: string | null;
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
    else if (article) loadExplanation(asNumber(article.id));
  };

  if (!article) return null;

  const discipline = asString(article.disciplineAlignment);
  const disciplineColor = DISCIPLINE_COLORS[discipline] ?? "bg-muted text-muted-foreground";
  const publishedAt = article.publishedAt ? safeDate(article.publishedAt) : null;
  const articleScore = asNumber(article.relevancyScore);
  const authScore = article.authenticityScore == null ? null : asNumber(article.authenticityScore);
  const articleUrl = asString(article.url).trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {asStringArray(article.topicTags).map((t) => (
              <Badge key={t} variant="outline" className="text-[10px] font-semibold uppercase tracking-wide">{t}</Badge>
            ))}
            {discipline && (
              <Badge variant="outline" className={`text-[10px] ml-auto ${disciplineColor}`}>{discipline}</Badge>
            )}
          </div>
          <DialogTitle className="text-xl font-serif leading-snug">
            <a
              href={articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors inline-flex items-start gap-2 group"
            >
              {asString(article.headline, "Untitled article")}
              <ExternalLink className="h-4 w-4 mt-1 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
            </a>
          </DialogTitle>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2 flex-wrap">
            <span className="font-semibold text-foreground">{asString(article.sourceName, "Unknown source")}</span>
            {article.author && <span>by {asString(article.author)}</span>}
            {publishedAt && (
              <span>
                {format(publishedAt, "MMM d 'at' h:mm a")}
                <span className="text-muted-foreground/50"> · </span>
                {formatDistanceToNow(publishedAt, { addSuffix: true })}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              {authScore != null && (
                <span className={`text-xs font-semibold ${authScore >= 8 ? "text-emerald-700" : authScore >= 5.5 ? "text-slate-600" : "text-orange-700"}`}>
                  Auth {authScore.toFixed(1)}
                </span>
              )}
              <div className={`text-xs font-bold ${articleScore >= 8 ? "text-amber-700" : articleScore >= 6.5 ? "text-primary" : "text-slate-600"}`}>
                Rel {articleScore.toFixed(1)}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {asString(article.teaserSummary).length > 0 && (
            <div className="rounded-lg bg-muted/50 border border-border p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1.5">Strategic Summary</p>
              <p className="text-sm leading-relaxed">{asString(article.teaserSummary)}</p>
            </div>
          )}

          {asString(article.viewpoint).length > 0 && (() => {
            const viewpoint = asString(article.viewpoint);
            const scoreIdx = viewpoint.indexOf("\n\n[Score:");
            const rgiTake = scoreIdx !== -1 ? viewpoint.slice(0, scoreIdx) : viewpoint;
            const scoreBreakdown = scoreIdx !== -1 ? viewpoint.slice(scoreIdx + 2).replace(/^\[Score:\s*/, "").replace(/\]$/, "") : null;
            return (
              <div className="space-y-2">
                {rgiTake && (
                  <div className="rounded-lg bg-muted/30 border border-border p-4 flex items-start gap-3">
                    <MessageSquareQuote className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">RGI Position</p>
                      <p className="text-sm italic text-foreground/70 leading-relaxed">{rgiTake}</p>
                    </div>
                  </div>
                )}
                {scoreBreakdown && (
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 flex items-start gap-2">
                    <BarChart2 className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-slate-500 leading-relaxed">{scoreBreakdown}</p>
                  </div>
                )}
              </div>
            );
          })()}

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

          {asString(article.content).length > 80 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Article Preview</p>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6">{asString(article.content)}</p>
            </div>
          )}

          <a
            href={articleUrl}
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

      {/* Section Header */}
      <div className="flex items-center justify-between pb-3 mb-2" style={{ borderBottom: "1px solid #F0F0F0" }}>
        <h2 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          Top Stories Today
        </h2>
        <button
          className="text-xs font-medium text-primary flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={onNavigateFeed}
          data-testid="btn-go-to-feed-2"
        >
          Full feed <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-5">
        Highest-scoring articles from today's scrape, filtered through the RGI strategic lens
      </p>

      {articles.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-base font-medium mb-1">No articles yet</p>
          <p className="text-sm">Automated scraping will populate the intelligence feed as new signals arrive.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {displayed.map((article, i) => {
            const rank = i + 1;
            return (
              <div
                key={asNumber(article.id)}
                className="group flex gap-5 py-7 transition-colors -mx-2 px-2 rounded-lg hover:bg-muted/30 cursor-pointer"
                style={{ borderBottom: "1px solid #F0F0F0" }}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("a") || target.closest("button")) return;
                  const url = asString(article.url).trim();
                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                }}
              >
                {/* Rank */}
                <div
                  className="shrink-0 w-10 pt-1 text-3xl font-light tabular-nums font-serif leading-none text-right"
                  style={{ color: "#E5E7EB" }}
                >
                  {rank}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {/* Tags + Signal */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {Boolean(article.isEmergingSignal) && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0"
                        style={{ backgroundColor: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" }}
                      >
                        <Zap className="h-2.5 w-2.5" />Signal
                      </span>
                    )}
                    {asStringArray(article.topicTags).slice(0, 2).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-2 py-0.5 rounded font-medium"
                        style={{ border: "1px solid #E5E7EB", color: "#6B7280" }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>

                  {/* Headline + Score in same row */}
                  <div className="flex items-start justify-between gap-4">
                    <a
                      href={asString(article.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-serif font-bold text-xl leading-snug text-foreground hover:text-primary transition-colors group/link"
                    >
                      {asString(article.headline, "Untitled article")}
                    </a>
                    <div className="shrink-0 mt-0.5">
                      <ScoreBadge score={asNumber(article.relevancyScore)} />
                    </div>
                  </div>

                  {/* Source + time */}
                  <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground/75 uppercase tracking-wider text-[10px]">
                      {asString(article.sourceName, "Unknown source")}
                    </span>
                    {article.author && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
                        <span>{asString(article.author)}</span>
                      </>
                    )}
                    {article.publishedAt && (
                      <>
                        <span className="w-0.5 h-0.5 rounded-full bg-muted-foreground/30" />
                        <span>{format(safeDate(article.publishedAt), "h:mm a")}</span>
                        <span className="text-muted-foreground/40">·</span>
                        <span>{formatDistanceToNow(safeDate(article.publishedAt), { addSuffix: true })}</span>
                      </>
                    )}
                  </div>

                  {/* Summary */}
                  {asString(article.teaserSummary).length > 0 && (
                    <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
                      {asString(article.teaserSummary)}
                    </p>
                  )}

                  {/* RGI viewpoint teaser */}
                  {asString(article.viewpoint).length > 0 && (
                    <p className="flex items-start gap-1 text-[11px] text-muted-foreground/55 italic leading-snug">
                      <MessageSquareQuote className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground/30" />
                      <span className="line-clamp-1">{asString(article.viewpoint)}</span>
                    </p>
                  )}

                  {/* RGI Analysis link */}
                  <div className="flex justify-end mt-1">
                    <button
                      onClick={() => open(article)}
                      className="text-[11px] font-medium flex items-center gap-1 transition-colors"
                      style={{ color: "rgba(11,31,58,0.45)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#C9A227")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(11,31,58,0.45)")}
                      title="View RGI analysis"
                    >
                      <BookOpen className="h-3 w-3" />
                      RGI Analysis <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {articles.length > 5 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full gap-2 text-xs mt-3"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? (
                <><ChevronUp className="h-3.5 w-3.5" />Show fewer</>
              ) : (
                <><ChevronDown className="h-3.5 w-3.5" />Show top 10</>
              )}
            </Button>
          )}
        </div>
      )}
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
    { query: { enabled: open && !!topic } as any }
  );

  const articles = useMemo(() => {
    return asArray<Article>(allArticles)
      .filter((a) => {
        const ref = a.publishedAt ? safeDate(a.publishedAt) : safeDate(a.scrapedAt);
        return ref >= today;
      })
      .sort((a, b) => asNumber(b.relevancyScore) - asNumber(a.relevancyScore));
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
              const pubDate = article.publishedAt ? safeDate(article.publishedAt) : null;
              return (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-lg border border-border bg-background/50 hover:bg-muted/40 hover:border-primary/30 transition-all p-3 group"
                >
                  <div className="shrink-0 mt-1">
                    <ScoreBadge score={article.relevancyScore} size="sm" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-semibold text-sm leading-snug group-hover:text-primary transition-colors">
                      {asString(article.headline, "Untitled article")}
                      <ExternalLink className="inline-block h-3 w-3 ml-1.5 mb-0.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </p>
                    {asString(article.teaserSummary).length > 0 && (
                      <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{asString(article.teaserSummary)}</p>
                    )}
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground flex-wrap">
                      <span className="font-medium text-foreground/60">{asString(article.sourceName, "Unknown source")}</span>
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

function WhatMattersTodayPanel({
  topicIntelligence,
  onTopicClick,
  onViewAll,
}: {
  topicIntelligence: TopicIntelligence[];
  onTopicClick: (topic: string) => void;
  onViewAll: () => void;
}) {
  const [allTopicsOpen, setAllTopicsOpen] = useState(false);
  const safeTopics = asArray<TopicIntelligence>(topicIntelligence);
  const top5 = safeTopics.slice(0, 5);
  const rest = safeTopics.slice(5);

  return (
    <div
      className="w-72 shrink-0 flex flex-col gap-4 pl-8"
      style={{ borderLeft: "2px solid #C9A227" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between" style={{ borderBottom: "1px solid #F0F0F0", paddingBottom: "12px" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          What Matters Today
        </h2>
        <button
          className="text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
          onClick={onViewAll}
          data-testid="btn-go-to-topics"
        >
          All Topics <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed -mt-1">
        Top themes clustering across high-reliability sources in the past 24 hours.
      </p>

      {/* Top 5 */}
      <div className="flex flex-col gap-0.5">
        {top5.length > 0 ? (
          top5.map((ti, i) => (
            <button
              key={asString(ti.topic)}
              onClick={() => onTopicClick(asString(ti.topic))}
              className="w-full text-left flex items-center gap-3 px-3 py-3 rounded-lg transition-all group hover:bg-muted/30 border border-transparent hover:border-border"
            >
              <span
                className="text-sm font-black w-5 text-right shrink-0 tabular-nums leading-none"
                style={{ color: "#C9A227" }}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-[13px] leading-snug group-hover:text-primary transition-colors">
                    {asString(ti.topic, "Untitled Topic")}
                  </span>
                  {ti.hasEmergingSignal && (
                    <Zap className="h-2.5 w-2.5 shrink-0" style={{ color: "#C9A227" }} />
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {asNumber(ti.articleCount)} {asNumber(ti.articleCount) === 1 ? "article" : "articles"}
                  {ti.avgRelevancyScore != null && (
                    <> · avg {asNumber(ti.avgRelevancyScore).toFixed(1)}</>
                  )}
                </p>
              </div>
              <ScoreBadge score={asNumber(ti.importanceScore)} size="sm" />
            </button>
          ))
        ) : (
          <div className="text-center py-8 text-muted-foreground text-xs">
            <p className="font-medium mb-0.5">No data yet</p>
            <p>Scrape to populate.</p>
          </div>
        )}
      </div>

      {/* All Active Topics (expandable) */}
      {rest.length > 0 && (
        <div style={{ borderTop: "1px solid #F0F0F0" }} className="pt-3">
          <button
            onClick={() => setAllTopicsOpen((v) => !v)}
            className="w-full flex items-center justify-between text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors py-1 mb-2"
          >
            <span className="uppercase tracking-wider">All Active Topics</span>
            <span className="flex items-center gap-1">
              <span className="tabular-nums">{rest.length} more</span>
              {allTopicsOpen
                ? <ChevronUp className="h-3 w-3" />
                : <ChevronDown className="h-3 w-3" />}
            </span>
          </button>

          {allTopicsOpen && (
            <div className="flex flex-col gap-0.5">
              {rest.map((ti, i) => (
                <button
                  key={asString(ti.topic)}
                  onClick={() => onTopicClick(asString(ti.topic))}
                  className="w-full text-left flex items-center gap-2.5 px-2.5 py-2 rounded-md transition-all group hover:bg-muted/30 border border-transparent hover:border-border/50"
                >
                  <span className="text-[10px] font-bold w-4 text-right shrink-0 tabular-nums text-muted-foreground/50">
                    {i + 6}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-medium group-hover:text-primary transition-colors leading-snug">
                      {asString(ti.topic, "Untitled Topic")}
                    </span>
                    <p className="text-[9px] text-muted-foreground/50 mt-0.5">
                      {asNumber(ti.articleCount)} {asNumber(ti.articleCount) === 1 ? "article" : "articles"}
                      {ti.avgRelevancyScore != null && (
                        <> · avg {asNumber(ti.avgRelevancyScore).toFixed(1)}</>
                      )}
                    </p>
                  </div>
                  <span
                    className="text-[10px] font-semibold tabular-nums shrink-0"
                    style={{ color: asNumber(ti.importanceScore) >= 8 ? "#C9A227" : asNumber(ti.importanceScore) >= 6.5 ? "#3B82F6" : "#9CA3AF" }}
                  >
                    {asNumber(ti.importanceScore).toFixed(1)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [topicArticlesOpen, setTopicArticlesOpen] = useState(false);
  const { data: summary, isLoading, isError, error, refetch } = useGetDashboardSummary();
  const { data: scrapeStatus } = useGetScrapeStatus();
  const [, navigate] = useLocation();

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-14 w-full" />
        <div className="flex gap-8">
          <div className="flex-1"><Skeleton className="h-[480px] w-full" /></div>
          <div className="w-80"><Skeleton className="h-[480px] w-full" /></div>
        </div>
      </div>
    );
  }

  if (isError || !summary) {
    return (
      <div className="py-16 text-center text-muted-foreground space-y-3">
        <AlertCircle className="h-8 w-8 mx-auto text-destructive/60" />
        <p className="font-medium mb-1">Dashboard load failed</p>
        <p className="text-sm">{userSafeErrorMessage(error, "Try refreshing after the database is available.")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const handleTopicClick = (topic: string) => {
    setSelectedTopic(topic);
    setTopicArticlesOpen(true);
  };

  return (
    <div className="space-y-8">
      <TopicArticlesModal
        topic={selectedTopic}
        open={topicArticlesOpen}
        onClose={() => { setTopicArticlesOpen(false); setSelectedTopic(null); }}
      />

      {/* ── Page Header ── */}
      <div
        className="flex items-start justify-between gap-4 flex-wrap pb-6"
        style={{ borderBottom: "1px solid #F0F0F0" }}
      >
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground leading-tight">
            Intelligence Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wider">
            {scrapeStatus?.lastScrapeAt
              ? <>Last scraped: <span className="font-semibold text-foreground/60">{format(safeDate(scrapeStatus.lastScrapeAt), "MMM d, yyyy 'at' h:mm a")}</span></>
              : <span className="italic">No scrape has run yet</span>
            }
          </p>
        </div>

      </div>

      {/* ── Main: Top Stories + What Matters Today ── */}
      <div className="flex gap-10 items-start">

        {/* Left: Top Stories */}
        <div className="flex-1 min-w-0">
          <TopStoriesSection
            articles={asArray<TopArticle>(summary.topArticles)}
            onNavigateFeed={() => navigate("/feed")}
          />
        </div>

        {/* Right: What Matters Today */}
        <WhatMattersTodayPanel
          topicIntelligence={asArray<TopicIntelligence>(summary.topicIntelligence)}
          onTopicClick={handleTopicClick}
          onViewAll={() => navigate("/topics")}
        />
      </div>

      {/* ── Compact Stats Strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2" style={{ borderTop: "1px solid #F0F0F0" }}>
        {[
          { label: "Scraped Today", value: asNumber(summary.totalArticlesToday), sub: "articles fetched", icon: <FileText className="h-3.5 w-3.5" /> },
          { label: "Pending Review", value: asNumber(summary.pendingReview), sub: "drafts awaiting approval", icon: <Clock className="h-3.5 w-3.5" /> },
          { label: "Approved Today", value: asNumber(summary.approvedToday), sub: "ready for publication", icon: <CheckCircle className="h-3.5 w-3.5" /> },
          { label: "Active Sources", value: asNumber(summary.activeSources), sub: `of ${asNumber(summary.totalSources)} total`, icon: <Database className="h-3.5 w-3.5" /> },
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
