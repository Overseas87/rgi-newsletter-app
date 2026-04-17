import { useState, useMemo } from "react";
import { useListArticles, useGenerateDigestArticle, Article } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArticleCard } from "@/components/article-card";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wand2,
  Newspaper,
  Twitter,
  Linkedin,
  BookOpen,
  Building2,
  TrendingUp,
  Globe,
  BarChart2,
  Clock,
  AlignLeft,
  Zap,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type SourceFilter = "all" | "news" | "twitter" | "linkedin" | "institutional" | "corporate" | "market";
type SortMode = "relevance" | "time" | "source";

const SOURCE_TABS: { value: SourceFilter; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All Sources", icon: Globe },
  { value: "news", label: "News", icon: Newspaper },
  { value: "twitter", label: "X / Twitter", icon: Twitter },
  { value: "linkedin", label: "LinkedIn", icon: Linkedin },
  { value: "institutional", label: "Institutional", icon: BookOpen },
  { value: "corporate", label: "Corporate", icon: Building2 },
  { value: "market", label: "Market", icon: TrendingUp },
];

const SORT_LABELS: Record<SortMode, { label: string; icon: React.ElementType }> = {
  relevance: { label: "By Relevance", icon: BarChart2 },
  time: { label: "By Time", icon: Clock },
  source: { label: "By Source", icon: AlignLeft },
};

export default function Feed() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SortMode>("relevance");
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState("0");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [editorNotes, setEditorNotes] = useState("");

  // Fetch all articles (no status filter) with a high limit — show today's intelligence board
  const {
    data: articles = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useListArticles({ limit: 400 });

  const generateDigest = useGenerateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Per-tab counts
  const counts = useMemo(() => {
    const a = articles as Article[];
    const result: Record<SourceFilter, number> = {
      all: a.length,
      news: a.filter((x) => !x.platform || x.platform === "news").length,
      twitter: a.filter((x) => x.platform === "twitter").length,
      linkedin: a.filter((x) => x.platform === "linkedin").length,
      institutional: a.filter((x) => x.platform === "institutional").length,
      corporate: a.filter((x) => x.platform === "corporate").length,
      market: a.filter((x) => x.platform === "market").length,
    };
    return result;
  }, [articles]);

  // Filter + sort
  const filtered = useMemo(() => {
    let result = articles as Article[];
    const minS = parseFloat(minScore) || 0;

    if (sourceFilter !== "all") {
      if (sourceFilter === "news") {
        result = result.filter((a) => !a.platform || a.platform === "news");
      } else {
        result = result.filter((a) => a.platform === sourceFilter);
      }
    }

    if (minS > 0) {
      result = result.filter((a) => a.relevancyScore >= minS);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          a.headline.toLowerCase().includes(q) ||
          a.sourceName.toLowerCase().includes(q) ||
          (a.author ?? "").toLowerCase().includes(q) ||
          a.topicTags.some((t) => t.toLowerCase().includes(q))
      );
    }

    if (sort === "time") {
      result = [...result].sort((a, b) => {
        const ta = new Date(a.publishedAt ?? a.scrapedAt).getTime();
        const tb = new Date(b.publishedAt ?? b.scrapedAt).getTime();
        return tb - ta;
      });
    } else if (sort === "source") {
      result = [...result].sort(
        (a, b) => a.sourceName.localeCompare(b.sourceName) || b.relevancyScore - a.relevancyScore
      );
    } else {
      result = [...result].sort((a, b) => b.relevancyScore - a.relevancyScore);
    }

    return result;
  }, [articles, sourceFilter, sort, search, minScore]);

  const emergingSignals = (articles as Article[]).filter((a) => a.isEmergingSignal);

  const toggleSelect = (id: number, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((a) => a.id)));
    }
  };

  const handleGenerate = async () => {
    const ids = Array.from(selected);
    if (ids.length < 2) {
      toast({ title: "Select at least 2 articles", description: "A brief requires multiple sources for synthesis.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      await new Promise<void>((resolve, reject) => {
        generateDigest.mutate(
          { data: { articleIds: ids, editorNotes: editorNotes || null } },
          {
            onSuccess: () => {
              toast({ title: "Strategic Brief generated", description: "The brief is now in Pending Review." });
              setSelected(new Set());
              setEditorNotes("");
              queryClient.invalidateQueries();
              resolve();
            },
            onError: (e) => {
              toast({ title: "Generation failed", description: String(e), variant: "destructive" });
              reject(e);
            },
          }
        );
      });
    } finally {
      setGenerating(false);
    }
  };

  const SortIcon = SORT_LABELS[sort].icon;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Intelligence Feed</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {articles.length} signals across all sources
            {emergingSignals.length > 0 && (
              <> · <span className="text-amber-700 font-medium">{emergingSignals.length} emerging signal{emergingSignals.length !== 1 ? "s" : ""}</span></>

            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button onClick={handleGenerate} disabled={generating} className="gap-2" data-testid="btn-generate-brief">
              <Wand2 className="h-4 w-4" />
              {generating ? "Generating..." : `Generate Brief (${selected.size})`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="gap-2"
            data-testid="btn-refresh-feed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Source type tabs */}
      <div className="flex flex-wrap gap-1 p-1 rounded-xl border border-border bg-card w-fit">
        {SOURCE_TABS.filter((tab) => tab.value === "all" || counts[tab.value] > 0).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.value}
              onClick={() => setSourceFilter(tab.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                sourceFilter === tab.value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              data-testid={`filter-source-${tab.value}`}
            >
              <Icon className="h-3 w-3" />
              {tab.label}
              <span className={`tabular-nums text-[10px] ${sourceFilter === tab.value ? "opacity-70" : "opacity-50"}`}>
                {counts[tab.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 h-9" data-testid="btn-sort">
              <SortIcon className="h-3.5 w-3.5" />
              {SORT_LABELS[sort].label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(Object.entries(SORT_LABELS) as [SortMode, typeof SORT_LABELS[SortMode]][]).map(([key, val]) => (
              <DropdownMenuItem key={key} onClick={() => setSort(key)} data-testid={`sort-${key}`}>
                <val.icon className="h-3.5 w-3.5 mr-2" />
                {val.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Min score filter */}
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
          </SelectContent>
        </Select>

        {/* Search */}
        <Input
          placeholder="Filter by keyword, source, author..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 h-9 text-sm"
          data-testid="input-feed-search"
        />

        <div className="ml-auto flex items-center gap-2">
          {filtered.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              className="text-xs h-9"
              data-testid="btn-select-all"
            >
              {selected.size === filtered.length ? "Deselect All" : `Select All (${filtered.length})`}
            </Button>
          )}
        </div>
      </div>

      {/* Editor Notes (shown when items selected) */}
      {selected.size >= 2 && (
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">
            {selected.size} articles selected — ready to synthesize
          </p>
          <Input
            placeholder="Optional editor notes or synthesis direction for Claude..."
            value={editorNotes}
            onChange={(e) => setEditorNotes(e.target.value)}
            className="text-sm bg-background"
            data-testid="input-editor-notes"
          />
        </div>
      )}

      {/* Emerging Signals Banner */}
      {emergingSignals.length > 0 && sourceFilter === "all" && !search && (
        <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 flex items-start gap-3">
          <Zap className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-700 mb-0.5">
              {emergingSignals.length} Emerging Signal{emergingSignals.length !== 1 ? "s" : ""} Detected
            </p>
            <p className="text-xs text-muted-foreground">
              High-relevance items flagged as potential weak signals worth monitoring for strategic implications.
            </p>
          </div>
        </div>
      )}

      {/* Feed content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : isError ? (
        <div className="py-16 text-center text-muted-foreground space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive/60" />
          <p className="font-medium">Unable to load the intelligence feed</p>
          <p className="text-sm">Check that the API server is running, then try refreshing.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Retry
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground space-y-2">
          {articles.length === 0 ? (
            <>
              <p className="text-base font-medium">No intelligence in the feed yet</p>
              <p className="text-sm">Run a scrape from the Dashboard to populate today's articles across all sources.</p>
            </>
          ) : (
            <>
              <p className="text-base font-medium">No articles match your filters</p>
              <p className="text-sm">Try adjusting the source filter, minimum score, or search query.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {articles.length} articles
            {sourceFilter !== "all" && <> in <span className="font-medium text-foreground">{SOURCE_TABS.find((t) => t.value === sourceFilter)?.label}</span></>}
          </p>
          {filtered.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              selectable
              selected={selected.has(article.id)}
              onSelect={(checked) => toggleSelect(article.id, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
