import { useState } from "react";
import { useListArticles, useGenerateDigestArticle } from "@workspace/api-client-react";
import { ArticleCard } from "@/components/article-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Square, Search } from "lucide-react";

const DISCIPLINES = ["All", "Strategic Foresight", "System Vitality", "Civic Stewardship"];

export default function Topics() {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [discipline, setDiscipline] = useState("All");

  const { data: articles = [], isLoading } = useListArticles({ status: "pending", limit: 100 });
  const generate = useGenerateDigestArticle();
  const queryClient = useQueryClient();

  const filtered = articles.filter((a) => {
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
    generate.mutate(
      { data: { articleIds: selectedIds } },
      {
        onSuccess: () => {
          setSelectedIds([]);
          queryClient.invalidateQueries({ queryKey: ["listArticles"] });
          queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
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
            data-testid="btn-generate-selected"
          >
            {generate.isPending ? "Generating..." : `Generate ${selectedIds.length} Digest ${selectedIds.length === 1 ? "Entry" : "Entries"}`}
          </Button>
        )}
      </div>

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

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No articles found</p>
          <p className="text-sm mt-1">Trigger a scrape from the sidebar to fetch today's content.</p>
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
