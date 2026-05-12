import { useState, useMemo } from "react";
import {
  useListArticles,
  useGetDashboardSummary,
  useGenerateDigestArticle,
  Article,
  TopicIntelligence,
} from "@workspace/api-client-react";
import { ArticleCard } from "@/components/article-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { asArray, asNumber, asString, safeDate } from "@/lib/arrays";
import {
  ArrowLeft,
  Compass,
  Zap,
  Shield,
  Search,
  BarChart2,
  Clock,
  AlignLeft,
  TrendingUp,
  Cpu,
  ChevronDown,
  ChevronUp,
  Info,
} from "lucide-react";

// ─── Discipline mapping (single source of truth, mirrors dashboard.ts) ─────────
const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  "Strategic Foresight": [
    // Canonical tags (new articles)
    "Technology & AI", "Innovation & Digital Transformation", "Geopolitics & Global Power",
    "Economics & Macroeconomics", "Supply Chains & Global Trade", "Future of Work & Society",
    "Wars, Conflict & Security", "Defense & Military", "Currency & Monetary Policy",
    "Trade & Tariffs", "Cybersecurity", "Robotics & Automation", "Industrial Policy",
    // Legacy / informal tags (existing articles in DB)
    "Geopolitics", "Global Politics", "Wars & Crisis", "Macroeconomics",
    "AI & Artificial Intelligence", "Future of Work", "Supply Chains & Trade",
    "Defense & Security", "Trade", "Technology", "Cybersecurity & Digital Security",
  ],
  "System Vitality": [
    // Canonical tags
    "Business Strategy & Corporations", "Leadership & Organizations",
    "Finance & Markets", "Energy & Resources", "Banking & Credit", "Oil & Gas",
    "Commodities", "Operations & Manufacturing", "Corporate Governance",
    "Venture & Startups", "Labor Markets", "Real Estate",
    // Legacy / informal tags
    "Energy & Oil", "Energy", "Finance", "Banking", "Business Strategy",
    "Leadership", "Organizations", "Manufacturing", "Startups & Venture",
  ],
  "Civic Stewardship": [
    // Canonical tags
    "Policy, Regulation & Governance", "Climate & Environmental Systems",
    "Public Health", "Education", "Agriculture & Food Systems", "Mobility & Infrastructure",
    // Legacy / informal tags
    "Policy & Regulation", "Climate & Environmental Health", "Climate Change",
    "Governance", "Regulation", "Sustainability", "Environmental",
    "Health", "Infrastructure",
  ],
};

function inferDiscipline(tag: string): string {
  for (const [disc, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
    if (keywords.some((k) => tag.toLowerCase() === k.toLowerCase())) return disc;
  }
  return "Strategic Foresight";
}

const DISC_ICON: Record<string, React.ElementType> = {
  "Strategic Foresight": Compass,
  "System Vitality": Zap,
  "Civic Stewardship": Shield,
  "Multiple": Cpu,
};

const DISC_COLOR: Record<string, string> = {
  "Strategic Foresight": "text-blue-700 border-blue-200 bg-blue-50",
  "System Vitality": "text-amber-700 border-amber-200 bg-amber-50",
  "Civic Stewardship": "text-emerald-700 border-emerald-200 bg-emerald-50",
  "Multiple": "text-violet-700 border-violet-200 bg-violet-50",
};

const DISC_BADGE: Record<string, string> = {
  "Strategic Foresight": "bg-blue-50 text-blue-700 border-blue-200",
  "System Vitality": "bg-amber-50 text-amber-700 border-amber-200",
  "Civic Stewardship": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Multiple": "bg-violet-50 text-violet-700 border-violet-200",
};

// ─── Score threshold: must match MIN_TOPIC_SCORE in dashboard.ts ──────────────
const MIN_TOPIC_SCORE = 7.0;

// ─── Sort types ────────────────────────────────────────────────────────────────
type SortMode = "relevance" | "newest" | "source";

// ─── Topic Card ───────────────────────────────────────────────────────────────
interface TopicCardProps {
  topic: string;
  count: number;
  importanceScore: number;
  avgRelevancyScore?: number;
  hasEmergingSignal: boolean;
  discipline: string;
  significance: string;
  rank: number;
  featured?: boolean;
  onClick: () => void;
}

function TopicCard({
  topic, count, importanceScore, avgRelevancyScore, discipline, rank, featured, onClick,
}: TopicCardProps) {
  const disc = discipline in DISC_COLOR ? discipline : inferDiscipline(topic);
  const colorClass = DISC_COLOR[disc] ?? DISC_COLOR["Strategic Foresight"];
  const Icon = DISC_ICON[disc] ?? Compass;

  if (featured) {
    return (
      <button
        onClick={onClick}
        className={`w-full text-left p-5 rounded-xl border-2 transition-all hover:scale-[1.01] hover:shadow-lg active:scale-[0.99] ${colorClass}`}
        data-testid={`topic-card-${topic.replace(/\s+/g, "-")}`}
      >
        <div className="flex items-start gap-3">
          <span className="text-3xl font-black opacity-15 leading-none w-8 shrink-0 text-right tabular-nums">
            {rank}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Icon className="h-4 w-4 shrink-0" />
              <span className="font-bold text-base">{topic}</span>
            </div>
            <Badge variant="outline" className={`text-[10px] mb-2.5 ${DISC_BADGE[disc] ?? ""}`}>
              {disc}
            </Badge>
            <div className="flex items-center gap-3 text-xs opacity-70 flex-wrap">
              <span className="font-semibold">{count} source{count !== 1 ? "s" : ""}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                {importanceScore.toFixed(1)}
              </span>
              {avgRelevancyScore != null && (
                <>
                  <span>·</span>
                  <span>avg {avgRelevancyScore.toFixed(1)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-xl border transition-all hover:scale-[1.01] hover:shadow-md active:scale-[0.99] ${colorClass}`}
      data-testid={`topic-card-${topic.replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl font-black opacity-20 leading-none w-7 shrink-0 text-right tabular-nums">
          {rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="font-bold text-sm">{topic}</span>
          </div>
          <Badge variant="outline" className={`text-[10px] mb-2 ${DISC_BADGE[disc] ?? ""}`}>
            {disc}
          </Badge>
          <div className="flex items-center gap-3 text-xs opacity-70 flex-wrap">
            <span>{count} source{count !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {importanceScore.toFixed(1)}
            </span>
            {avgRelevancyScore != null && (
              <>
                <span>·</span>
                <span>avg {avgRelevancyScore.toFixed(1)}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Article Drill-Down ───────────────────────────────────────────────────────
interface TopicDrillDownProps {
  topic: string;
  dashboardCount: number;
  contentWindowStart?: string;
  onBack: () => void;
}

function TopicDrillDown({ topic, dashboardCount, contentWindowStart, onBack }: TopicDrillDownProps) {
  const [sort, setSort] = useState<SortMode>("relevance");
  // Default to MIN_TOPIC_SCORE so this view matches the dashboard count exactly.
  const [minScore, setMinScore] = useState(String(MIN_TOPIC_SCORE));
  const [sourceType, setSourceType] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  // When true, restricts to the same time window as the dashboard for exact count matching.
  const [restrictWindow, setRestrictWindow] = useState(true);

  // Fetch ALL articles for this topic (no score filter at API level) so the user
  // can freely change the score threshold locally without re-fetching.
  const { data: articles = [], isLoading, isError, refetch } = useListArticles({
    topicTag: topic,
    limit: 500,
  });

  const generate = useGenerateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const safeArticles = useMemo(() => asArray<Article>(articles), [articles]);

  const disc = inferDiscipline(topic);
  const Icon = DISC_ICON[disc] ?? Compass;

  const windowCutoff = contentWindowStart ? new Date(contentWindowStart).getTime() : 0;

  // Count articles matching the exact dashboard criteria (time window + score threshold).
  const dashboardThresholdCount = safeArticles.filter((a) => {
    const scorePasses = asNumber(a.relevancyScore) >= MIN_TOPIC_SCORE;
    const timePasses = windowCutoff === 0 || safeDate(a.scrapedAt).getTime() >= windowCutoff;
    return scorePasses && timePasses;
  }).length;

  const filtered = useMemo(() => {
    let items = safeArticles;
    const minS = parseFloat(minScore) || 0;
    if (minS > 0) items = items.filter((a) => asNumber(a.relevancyScore) >= minS);
    if (restrictWindow && windowCutoff > 0) {
      items = items.filter((a) => safeDate(a.scrapedAt).getTime() >= windowCutoff);
    }
    if (sourceType !== "all") items = items.filter((a) => (a.platform ?? "news") === sourceType);

    if (sort === "newest") {
      items = [...items].sort((a, b) => {
        const ta = safeDate(a.publishedAt ?? a.scrapedAt).getTime();
        const tb = safeDate(b.publishedAt ?? b.scrapedAt).getTime();
        return tb - ta;
      });
    } else if (sort === "source") {
      items = [...items].sort((a, b) => asString(a.sourceName).localeCompare(asString(b.sourceName)));
    } else {
      items = [...items].sort((a, b) => asNumber(b.relevancyScore) - asNumber(a.relevancyScore));
    }

    return items;
  }, [safeArticles, sort, minScore, sourceType, restrictWindow, windowCutoff]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  };

  const handleGenerate = () => {
    if (selectedIds.length < 2) {
      toast({ title: "Select at least 2 articles", description: "A brief requires multiple sources.", variant: "destructive" });
      return;
    }
    generate.mutate(
      { data: { articleIds: selectedIds } },
      {
        onSuccess: () => {
          setSelectedIds([]);
          queryClient.invalidateQueries();
          toast({ title: "Strategic Brief generated", description: "Now in Pending Review." });
        },
        onError: () => toast({ title: "Generation failed", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          All Topics
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Icon className={`h-5 w-5 ${DISC_COLOR[disc]?.split(" ")[0] ?? "text-primary"}`} />
            <h1 className="text-3xl font-serif tracking-tight">{topic}</h1>
          </div>
          <Badge variant="outline" className={`text-xs ${DISC_BADGE[disc] ?? ""}`}>{disc}</Badge>

          {!isLoading && (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{filtered.length}</span>
                {" "}article{filtered.length !== 1 ? "s" : ""} shown
                {parseFloat(minScore) > 0 && (
                  <span className="text-xs ml-1">(score {minScore}+)</span>
                )}
                {selectedIds.length > 0 && (
                  <> · <span className="text-primary font-medium">{selectedIds.length} selected</span></>
                )}
              </p>
              {/* Transparency note comparing to the topic card's count */}
              {!isLoading && dashboardCount > 0 && dashboardThresholdCount !== dashboardCount && parseFloat(minScore) === MIN_TOPIC_SCORE && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  Topic card showed {dashboardCount} — counts update live; new articles may have arrived.
                </p>
              )}
              {!isLoading && dashboardCount > 0 && dashboardThresholdCount === dashboardCount && parseFloat(minScore) === MIN_TOPIC_SCORE && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <Info className="h-3 w-3 shrink-0" />
                  Matches topic count exactly — both use score {MIN_TOPIC_SCORE}+ threshold.
                </p>
              )}
            </div>
          )}
        </div>

        {selectedIds.length >= 2 && (
          <Button onClick={handleGenerate} disabled={generate.isPending} data-testid="btn-generate-topic-brief">
            {generate.isPending ? "Generating..." : `Generate Brief (${selectedIds.length})`}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 p-1 rounded-lg border border-border bg-card">
          {([
            { value: "relevance", icon: BarChart2, label: "Relevance" },
            { value: "newest", icon: Clock, label: "Newest" },
            { value: "source", icon: AlignLeft, label: "Source" },
          ] as const).map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setSort(value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                sort === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              data-testid={`sort-${value}`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          ))}
        </div>

        <Select value={minScore} onValueChange={setMinScore}>
          <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="select-min-score">
            <SelectValue placeholder="Min score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">All scores</SelectItem>
            <SelectItem value="5">Score 5+</SelectItem>
            <SelectItem value="6">Score 6+</SelectItem>
            <SelectItem value="7">Score 7+ (dashboard)</SelectItem>
            <SelectItem value="8">Score 8+</SelectItem>
            <SelectItem value="9">Score 9+</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sourceType} onValueChange={setSourceType}>
          <SelectTrigger className="w-[160px] h-9 text-xs" data-testid="select-source-type">
            <SelectValue placeholder="Source type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="news">News</SelectItem>
            <SelectItem value="twitter">X / Twitter</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="institutional">Institutional</SelectItem>
            <SelectItem value="corporate">Corporate</SelectItem>
            <SelectItem value="market">Market</SelectItem>
          </SelectContent>
        </Select>

        {contentWindowStart && (
          <button
            onClick={() => setRestrictWindow((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
              restrictWindow
                ? "bg-primary/10 text-primary border-primary/30"
                : "text-muted-foreground border-border hover:text-foreground"
            }`}
            title={restrictWindow ? "Showing only articles from the dashboard time window" : "Showing all historical articles"}
          >
            <Clock className="h-3 w-3" />
            {restrictWindow ? "Window" : "All history"}
          </button>
        )}

        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="font-medium mb-1">Failed to load articles</p>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="text-base font-medium mb-1">No articles match your filters</p>
          <p className="text-sm">
                          {safeArticles.length === 0
              ? "No articles tagged with this topic. Run a scrape to fetch new content."
              : "Try lowering the minimum score or changing the source filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              selectable
              selected={selectedIds.includes(article.id)}
              onSelect={() => toggleSelect(article.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Topics() {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [activeTopicCount, setActiveTopicCount] = useState(0);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const { data: summary, isLoading, isError, refetch } = useGetDashboardSummary();

  const topicIntelligence = asArray<TopicIntelligence>(summary?.topicIntelligence);
  const contentWindowStart = summary?.contentWindowStart;

  const handleSelectTopic = (topic: string, count: number) => {
    setActiveTopic(topic);
    setActiveTopicCount(count);
  };

  if (activeTopic) {
    return (
      <TopicDrillDown
        topic={activeTopic}
        dashboardCount={activeTopicCount}
        contentWindowStart={contentWindowStart}
        onBack={() => { setActiveTopic(null); setActiveTopicCount(0); }}
      />
    );
  }

  const filtered = search.trim()
    ? topicIntelligence.filter((t) => asString(t.topic).toLowerCase().includes(search.toLowerCase()))
    : topicIntelligence;

  const topFive = filtered.slice(0, 5);
  const remaining = filtered.slice(5);
  const totalArticles = topicIntelligence.reduce((sum, t) => sum + asNumber(t.articleCount), 0);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <div className="h-8 w-48 bg-muted rounded animate-pulse mb-2" />
          <div className="h-4 w-72 bg-muted rounded animate-pulse" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="font-medium mb-2">Failed to load topics</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Today's Topics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {topicIntelligence.length} active topic{topicIntelligence.length !== 1 ? "s" : ""}
            {" "}across {totalArticles} high-relevance source{totalArticles !== 1 ? "s" : ""}
            {" "}— click any topic to explore
          </p>
        </div>
      </div>

      {/* Discipline legend */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(DISC_BADGE).map(([disc, cls]) => {
          const Icon = DISC_ICON[disc] ?? Compass;
          return (
            <span key={disc} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${cls}`}>
              <Icon className="h-3 w-3" />{disc}
            </span>
          );
        })}
      </div>

      {/* Search — show when there are enough topics to warrant it */}
      {topicIntelligence.length > 6 && (
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter topics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
      )}

      {topicIntelligence.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <p className="text-base font-medium mb-1">No topic data yet</p>
          <p className="text-sm">Run a scrape from the Dashboard to populate today's intelligence.</p>
        </div>
      ) : (
        <>
          {/* ── Top 5 Topics ───────────────────────────────────────────── */}
          {!search && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Top {Math.min(5, topFive.length)} Topics Today
              </p>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {topFive.map((t, i) => (
                  <TopicCard
                    key={t.topic}
                    topic={asString(t.topic, "Untitled Topic")}
                    count={asNumber(t.articleCount)}
                    importanceScore={asNumber(t.importanceScore)}
                    avgRelevancyScore={asNumber(t.avgRelevancyScore)}
                    hasEmergingSignal={Boolean(t.hasEmergingSignal)}
                    discipline={asString(t.discipline, "Strategic Foresight")}
                    significance={asString(t.significance)}
                    rank={i + 1}
                    featured
                    onClick={() => handleSelectTopic(asString(t.topic, "Untitled Topic"), asNumber(t.articleCount))}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Search results ─────────────────────────────────────────── */}
          {search && filtered.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((t, i) => (
                <TopicCard
                  key={asString(t.topic, `topic-${i}`)}
                  topic={asString(t.topic, "Untitled Topic")}
                  count={asNumber(t.articleCount)}
                  importanceScore={asNumber(t.importanceScore)}
                  avgRelevancyScore={asNumber(t.avgRelevancyScore)}
                  hasEmergingSignal={Boolean(t.hasEmergingSignal)}
                  discipline={asString(t.discipline, "Strategic Foresight")}
                  significance={asString(t.significance)}
                  rank={i + 1}
                  onClick={() => handleSelectTopic(asString(t.topic, "Untitled Topic"), asNumber(t.articleCount))}
                />
              ))}
            </div>
          )}

          {search && filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">No topics match "{search}"</p>
          )}

          {/* ── All Topics toggle ──────────────────────────────────────── */}
          {!search && remaining.length > 0 && (
            <div>
              <button
                onClick={() => setShowAll((v) => !v)}
                className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors mb-3"
              >
                {showAll ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {showAll ? "Hide" : "Show all"} {remaining.length} more topic{remaining.length !== 1 ? "s" : ""}
              </button>

              {showAll && (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {remaining.map((t, i) => (
                    <TopicCard
                      key={asString(t.topic, `topic-${i + 6}`)}
                      topic={asString(t.topic, "Untitled Topic")}
                      count={asNumber(t.articleCount)}
                      importanceScore={asNumber(t.importanceScore)}
                      avgRelevancyScore={asNumber(t.avgRelevancyScore)}
                      hasEmergingSignal={Boolean(t.hasEmergingSignal)}
                      discipline={asString(t.discipline, "Strategic Foresight")}
                      significance={asString(t.significance)}
                      rank={i + 6}
                      onClick={() => handleSelectTopic(asString(t.topic, "Untitled Topic"), asNumber(t.articleCount))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Scoring note ───────────────────────────────────────────── */}
          {!search && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
              <Info className="h-3 w-3 shrink-0" />
              Counts reflect high-relevance sources (score {MIN_TOPIC_SCORE}+) only.
              Clicking a topic defaults to the same threshold so counts always match.
            </p>
          )}
        </>
      )}
    </div>
  );
}
