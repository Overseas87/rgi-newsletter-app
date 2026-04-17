import { useState, useMemo } from "react";
import {
  useListArticles,
  useGetDashboardSummary,
  useGenerateDigestArticle,
  Article,
} from "@workspace/api-client-react";
import { ArticleCard } from "@/components/article-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
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
} from "lucide-react";

// ─── Discipline mapping ────────────────────────────────────────────────────────
const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  "Strategic Foresight": [
    "AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics",
    "Global Politics", "Wars & Crisis", "Macroeconomics", "Supply Chains & Trade", "Future of Work",
  ],
  "System Vitality": [
    "Business & Strategy", "Leadership & Organizations", "Finance & Markets",
    "Fintech", "Energy & Oil",
  ],
  "Civic Stewardship": [
    "Policy & Regulation", "Climate & Environmental Health",
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

// ─── Sort types ────────────────────────────────────────────────────────────────
type SortMode = "relevance" | "newest" | "source";

// ─── Topic Grid ───────────────────────────────────────────────────────────────
interface TopicCardProps {
  topic: string;
  count: number;
  importanceScore: number;
  hasEmergingSignal: boolean;
  discipline: string;
  significance: string;
  rank: number;
  onClick: () => void;
}

function TopicCard({ topic, count, importanceScore, discipline, rank, onClick }: TopicCardProps) {
  const disc = discipline in DISC_COLOR ? discipline : inferDiscipline(topic);
  const colorClass = DISC_COLOR[disc] ?? DISC_COLOR["Strategic Foresight"];
  const Icon = DISC_ICON[disc] ?? Compass;

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
          <div className="flex items-center gap-3 text-xs opacity-70 mt-1">
            <span>{count} article{count !== 1 ? "s" : ""} today</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {importanceScore.toFixed(1)} importance
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── Article Drill-Down ───────────────────────────────────────────────────────
interface TopicDrillDownProps {
  topic: string;
  onBack: () => void;
}

function TopicDrillDown({ topic, onBack }: TopicDrillDownProps) {
  const [sort, setSort] = useState<SortMode>("relevance");
  const [minScore, setMinScore] = useState("0");
  const [sourceType, setSourceType] = useState("all");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const { data: articles = [], isLoading, isError, refetch } = useListArticles({
    topicTag: topic,
    limit: 200,
  });

  const generate = useGenerateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const disc = inferDiscipline(topic);
  const Icon = DISC_ICON[disc] ?? Compass;

  const filtered = useMemo(() => {
    let items = articles as Article[];
    const minS = parseFloat(minScore) || 0;
    if (minS > 0) items = items.filter((a) => a.relevancyScore >= minS);
    if (sourceType !== "all") items = items.filter((a) => (a.platform ?? "news") === sourceType);

    if (sort === "newest") {
      items = [...items].sort((a, b) => {
        const ta = new Date(a.publishedAt ?? a.scrapedAt).getTime();
        const tb = new Date(b.publishedAt ?? b.scrapedAt).getTime();
        return tb - ta;
      });
    } else if (sort === "source") {
      items = [...items].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
    } else {
      items = [...items].sort((a, b) => b.relevancyScore - a.relevancyScore);
    }

    return items;
  }, [articles, sort, minScore, sourceType]);

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
      {/* Back + Header */}
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
            <p className="text-sm text-muted-foreground mt-2">
              {filtered.length} article{filtered.length !== 1 ? "s" : ""} today
              {selectedIds.length > 0 && <> · <span className="text-primary font-medium">{selectedIds.length} selected</span></>}
            </p>
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
        {/* Sort */}
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

        {/* Min score */}
        <Select value={minScore} onValueChange={setMinScore}>
          <SelectTrigger className="w-[150px] h-9 text-xs" data-testid="select-min-score">
            <SelectValue placeholder="Min score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">All scores</SelectItem>
            <SelectItem value="5">Score 5+</SelectItem>
            <SelectItem value="6">Score 6+</SelectItem>
            <SelectItem value="7">Score 7+</SelectItem>
            <SelectItem value="8">Score 8+</SelectItem>
            <SelectItem value="9">Score 9+</SelectItem>
          </SelectContent>
        </Select>

        {/* Source type */}
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

        <Button variant="outline" size="sm" className="h-9 text-xs" onClick={() => refetch()}>
          Refresh
        </Button>
      </div>

      {/* Article list */}
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
            {(articles as Article[]).length === 0
              ? "No articles tagged with this topic today. Run a scrape to fetch new content."
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

// ─── Topic Overview Grid ──────────────────────────────────────────────────────
function TopicOverview({ onSelectTopic }: { onSelectTopic: (topic: string) => void }) {
  const { data: summary, isLoading, isError, refetch } = useGetDashboardSummary();

  const topicIntelligence = summary?.topicIntelligence ?? [];
  const articlesByTag = summary?.articlesByTag ?? [];

  // Build display list: use topicIntelligence for ranked topics, fall back to articlesByTag
  const displayTopics = topicIntelligence.length > 0
    ? topicIntelligence
    : articlesByTag.slice(0, 12).map((t, i) => ({
        topic: t.tag,
        articleCount: t.count,
        importanceScore: t.count * 2,
        discipline: inferDiscipline(t.tag),
        significance: `${t.count} articles today`,
        hasEmergingSignal: false,
      }));

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
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

  if (displayTopics.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground">
        <p className="text-base font-medium mb-1">No topic data yet</p>
        <p className="text-sm">Run a scrape from the Dashboard to populate today's intelligence.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {displayTopics.map((t, i) => (
        <TopicCard
          key={t.topic}
          topic={t.topic}
          count={t.articleCount}
          importanceScore={t.importanceScore}
          hasEmergingSignal={t.hasEmergingSignal}
          discipline={t.discipline}
          significance={t.significance}
          rank={i + 1}
          onClick={() => onSelectTopic(t.topic)}
        />
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Topics() {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: summary } = useGetDashboardSummary();

  if (activeTopic) {
    return <TopicDrillDown topic={activeTopic} onBack={() => setActiveTopic(null)} />;
  }

  const topicIntelligence = summary?.topicIntelligence ?? [];
  const totalArticles = topicIntelligence.reduce((sum, t) => sum + t.articleCount, 0);

  const filtered = search.trim()
    ? topicIntelligence.filter((t) => t.topic.toLowerCase().includes(search.toLowerCase()))
    : topicIntelligence;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Today's Topics</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {topicIntelligence.length} topic areas across {totalArticles} articles — click any topic to explore
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

      {/* Search */}
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

      {/* Topic grid */}
      {filtered.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t, i) => (
            <TopicCard
              key={t.topic}
              topic={t.topic}
              count={t.articleCount}
              importanceScore={t.importanceScore}
              hasEmergingSignal={t.hasEmergingSignal}
              discipline={t.discipline}
              significance={t.significance}
              rank={i + 1}
              onClick={() => setActiveTopic(t.topic)}
            />
          ))}
        </div>
      ) : (
        <TopicOverview onSelectTopic={setActiveTopic} />
      )}
    </div>
  );
}
