import { useState } from "react";
import { useListArticles, useGenerateDigestArticle, useGetDashboardSummary } from "@workspace/api-client-react";
import { ArticleCard } from "@/components/article-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CheckSquare, Square, Search, TrendingUp, Zap, Shield, Compass } from "lucide-react";

const DISCIPLINES = ["All", "Strategic Foresight", "System Vitality", "Civic Stewardship"];

const DISCIPLINE_ICONS: Record<string, React.ReactNode> = {
  "Strategic Foresight": <Compass className="h-4 w-4 text-blue-400" />,
  "System Vitality": <Zap className="h-4 w-4 text-amber-400" />,
  "Civic Stewardship": <Shield className="h-4 w-4 text-emerald-400" />,
};

const DISCIPLINE_COLORS: Record<string, string> = {
  "Strategic Foresight": "border-blue-500/20 bg-blue-500/5",
  "System Vitality": "border-amber-500/20 bg-amber-500/5",
  "Civic Stewardship": "border-emerald-500/20 bg-emerald-500/5",
};

const DISCIPLINE_BADGE: Record<string, string> = {
  "Strategic Foresight": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "System Vitality": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Civic Stewardship": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

// Map topics to the most relevant RGI discipline
function inferDiscipline(tag: string): string {
  const sf = ["AI", "Technology", "Innovation", "Geopolitics", "Strategy", "Future of Work", "Economy", "Finance"];
  const sv = ["Leadership", "Culture", "Health", "Education", "Governance", "Sustainability"];
  const cs = ["Policy", "Democracy", "Environment", "Environmental Health", "Central Florida", "Governance", "Civic"];
  if (sf.some(t => tag.toLowerCase().includes(t.toLowerCase()))) return "Strategic Foresight";
  if (sv.some(t => tag.toLowerCase().includes(t.toLowerCase()))) return "System Vitality";
  if (cs.some(t => tag.toLowerCase().includes(t.toLowerCase()))) return "Civic Stewardship";
  return "Strategic Foresight";
}

function TopicRankingSection() {
  const { data: summary } = useGetDashboardSummary();

  if (!summary?.articlesByTag || summary.articlesByTag.length === 0) return null;

  const topTopics = summary.articlesByTag.slice(0, 6);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-serif font-semibold">Today's Topic Rankings</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        The biggest stories today ranked by coverage across all sources, framed through RGI's disciplines.
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {topTopics.map((tagCount, i) => {
          const discipline = inferDiscipline(tagCount.tag);
          return (
            <Card
              key={tagCount.tag}
              className={`border ${DISCIPLINE_COLORS[discipline] ?? ""}`}
              data-testid={`topic-rank-${i}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-3xl font-black text-muted-foreground/20 leading-none w-8 shrink-0 text-right">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {DISCIPLINE_ICONS[discipline]}
                      <span className="text-sm font-bold">{tagCount.tag}</span>
                    </div>
                    <Badge variant="outline" className={`text-xs mb-2 ${DISCIPLINE_BADGE[discipline] ?? ""}`}>
                      {discipline}
                    </Badge>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {tagCount.count} article{tagCount.count !== 1 ? "s" : ""} published today across monitored sources.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default function Topics() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("All");

  const { data: articles = [], isLoading } = useListArticles({ status: "pending", limit: 200 });
  const generate = useGenerateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const filtered = (articles as any[]).filter((a) => {
    const matchesDiscipline = discipline === "All" || a.disciplineAlignment === discipline;
    const matchesSearch =
      !search ||
      a.headline.toLowerCase().includes(search.toLowerCase()) ||
      (a.sourceName?.toLowerCase() ?? "").includes(search.toLowerCase());
    return matchesDiscipline && matchesSearch;
  });

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((a) => a.id));
    }
  };

  const handleGenerate = () => {
    if (selectedIds.length === 0) return;
    generate.mutate(
      { data: { articleIds: selectedIds } },
      {
        onSuccess: () => {
          setSelectedIds([]);
          queryClient.invalidateQueries({ queryKey: ["listArticles"] });
          queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
          queryClient.invalidateQueries({ queryKey: ["getDashboardSummary"] });
          toast({ title: "Digest entry generated", description: "Claude has written a new entry. Review it in Pending Review." });
        },
        onError: () => {
          toast({ title: "Generation failed", description: "Could not generate the digest entry. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Today's Topics</h1>
          <p className="text-muted-foreground mt-1">
            Review AI-scored articles and select items to generate digest entries.
          </p>
        </div>
        {selectedIds.length > 0 && (
          <Button
            onClick={handleGenerate}
            disabled={generate.isPending}
            size="lg"
            data-testid="btn-generate-selected"
          >
            {generate.isPending ? (
              <><span className="animate-pulse">Claude is writing...</span></>
            ) : (
              `Generate ${selectedIds.length} Digest ${selectedIds.length === 1 ? "Entry" : "Entries"}`
            )}
          </Button>
        )}
      </div>

      {/* Topic Rankings */}
      <TopicRankingSection />

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search headlines or sources..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
        <Select value={discipline} onValueChange={setDiscipline}>
          <SelectTrigger className="w-[220px]" data-testid="select-discipline">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DISCIPLINES.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={toggleAll} className="flex items-center gap-2" data-testid="btn-toggle-all">
          {selectedIds.length === filtered.length && filtered.length > 0 ? (
            <><CheckSquare className="h-4 w-4" /> Deselect All</>
          ) : (
            <><Square className="h-4 w-4" /> Select All</>
          )}
        </Button>
      </div>

      {/* Article List */}
      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No articles found</p>
          <p className="text-sm mt-1">Trigger a scrape from the dashboard to fetch today's content.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{filtered.length} articles</Badge>
            {selectedIds.length > 0 && (
              <Badge>{selectedIds.length} selected</Badge>
            )}
          </div>
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
