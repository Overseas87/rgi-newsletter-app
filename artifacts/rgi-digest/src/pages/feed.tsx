import { useState, useMemo } from "react";
import { useListArticles, useGenerateDigestArticle, Article } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArticleCard } from "@/components/article-card";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Wand2,
  Newspaper,
  Twitter,
  Linkedin,
  SortDesc,
  Clock,
  BarChart2,
  AlignLeft,
  Zap,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

type Platform = "all" | "news" | "twitter" | "linkedin";
type SortMode = "relevance" | "time" | "source";

const SORT_LABELS: Record<SortMode, { label: string; icon: typeof SortDesc }> = {
  relevance: { label: "By Relevance", icon: BarChart2 },
  time: { label: "By Time", icon: Clock },
  source: { label: "By Source", icon: AlignLeft },
};

export default function Feed() {
  const [platform, setPlatform] = useState<Platform>("all");
  const [sort, setSort] = useState<SortMode>("relevance");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [editorNotes, setEditorNotes] = useState("");

  const { data: articles = [], isLoading } = useListArticles({
    status: "pending",
    limit: 300,
  });
  const generateDigest = useGenerateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Filter and sort
  const filtered = useMemo(() => {
    let result = articles as Article[];

    if (platform !== "all") {
      result = result.filter((a) => (a.platform ?? "news") === platform);
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
    }
    // relevance is already the default sort from the API

    return result;
  }, [articles, platform, sort, search]);

  const emergingSignals = filtered.filter((a) => a.isEmergingSignal);
  const counts = {
    all: articles.length,
    news: articles.filter((a) => !a.platform || a.platform === "news").length,
    twitter: articles.filter((a) => a.platform === "twitter").length,
    linkedin: articles.filter((a) => a.platform === "linkedin").length,
  };

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif tracking-tight text-foreground">Intelligence Feed</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {articles.length} articles pending review
            {emergingSignals.length > 0 && (
              <> — <span className="text-amber-400 font-medium">{emergingSignals.length} emerging signal{emergingSignals.length !== 1 ? "s" : ""}</span></>
            )}
          </p>
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 pl-4 border-l border-border">
            <span className="text-sm text-muted-foreground font-medium">
              {selected.size} selected
            </span>
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="gap-2"
              data-testid="btn-generate-brief"
            >
              <Wand2 className="h-4 w-4" />
              {generating ? "Generating..." : "Generate Brief"}
            </Button>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Platform tabs */}
        <div className="flex items-center gap-1 p-1 rounded-lg border border-border bg-card">
          {(["all", "news", "twitter", "linkedin"] as Platform[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlatform(p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                platform === p
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              data-testid={`filter-platform-${p}`}
            >
              {p === "twitter" && <Twitter className="h-3 w-3" />}
              {p === "linkedin" && <Linkedin className="h-3 w-3" />}
              {p === "news" && <Newspaper className="h-3 w-3" />}
              <span className="capitalize">{p === "all" ? "All Sources" : p === "twitter" ? "X / Twitter" : p === "linkedin" ? "LinkedIn" : "News"}</span>
              <span className={`text-[10px] tabular-nums ${platform === p ? "opacity-70" : "opacity-50"}`}>
                {counts[p]}
              </span>
            </button>
          ))}
        </div>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" data-testid="btn-sort">
              <SortIcon className="h-3.5 w-3.5" />
              {SORT_LABELS[sort].label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(Object.entries(SORT_LABELS) as [SortMode, typeof SORT_LABELS[SortMode]][]).map(([key, val]) => (
              <DropdownMenuItem key={key} onClick={() => setSort(key)} data-testid={`sort-${key}`}>
                <val.icon className="h-3.5 w-3.5 mr-2" />
                {val.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Search */}
        <Input
          placeholder="Filter by keyword, source, author..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 h-9 text-sm"
          data-testid="input-feed-search"
        />

        <div className="ml-auto flex items-center gap-3">
          {filtered.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              className="text-xs"
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
            placeholder="Optional editor notes or synthesis direction for the AI..."
            value={editorNotes}
            onChange={(e) => setEditorNotes(e.target.value)}
            className="text-sm bg-background"
            data-testid="input-editor-notes"
          />
        </div>
      )}

      {/* Emerging Signals Banner */}
      {emergingSignals.length > 0 && platform === "all" && !search && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-400">
              {emergingSignals.length} Emerging Signal{emergingSignals.length !== 1 ? "s" : ""} Detected
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            High-relevance items flagged as potential weak signals worth tracking for strategic implications.
          </p>
        </div>
      )}

      {/* Feed */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-base font-medium mb-1">No articles match your filters</p>
          <p className="text-sm">Try adjusting the platform filter or search query.</p>
        </div>
      ) : (
        <div className="space-y-3">
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
