import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Article } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Archive, ArrowLeft, ExternalLink, RotateCcw, ShieldCheck, TrendingUp } from "lucide-react";
import { asNumber, asString, asStringArray, safeDate } from "@/lib/arrays";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

async function fetchArticle(id: string): Promise<Article> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/articles/${id}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Article request failed (${res.status})`);
  return res.json();
}

export default function ArticleDetail() {
  const params = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const id = params.id ?? "";
  const { toast } = useToast();
  const { data: article, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["article-detail", id],
    queryFn: () => fetchArticle(id),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !article) {
    return (
      <div className="py-16 text-center text-muted-foreground space-y-3">
        <AlertCircle className="h-8 w-8 mx-auto text-destructive/60" />
        <p className="font-medium">Unable to load article analysis</p>
        <p className="text-sm">The article may have been removed or the API is temporarily unavailable.</p>
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/feed")}>Back to Feed</Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>Retry</Button>
        </div>
      </div>
    );
  }

  const publishedAt = article.publishedAt ? safeDate(article.publishedAt) : null;
  const scrapedAt = safeDate(article.scrapedAt, new Date());
  const tags = asStringArray(article.topicTags);
  const score = asNumber(article.relevancyScore);
  const auth = article.authenticityScore == null ? null : asNumber(article.authenticityScore);
  const extended = article as Article & {
    scoreExplanation?: string | null;
    scoreBreakdown?: Record<string, number> | null;
    status?: string | null;
  };

  const moderateArticle = async (status: "pending" | "dismissed") => {
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/articles/${article.id}/moderation`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`Moderation failed (${res.status})`);
      toast({
        title: status === "dismissed" ? "Article dismissed" : "Article restored",
        description: status === "dismissed" ? "The item has been removed from the active feed." : "The item is back in the active feed.",
      });
      await refetch();
    } catch (error) {
      toast({ title: "Moderation failed", description: String(error), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="gap-2" onClick={() => navigate("/feed")}>
        <ArrowLeft className="h-4 w-4" />
        Back to Feed
      </Button>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{asString(article.sourceName, "Unknown source")}</Badge>
            <Badge variant="secondary" className="gap-1">
              <TrendingUp className="h-3 w-3" />
              {score.toFixed(1)} relevance
            </Badge>
            {auth != null && (
              <Badge variant="secondary" className="gap-1">
                <ShieldCheck className="h-3 w-3" />
                {auth.toFixed(1)} credibility
              </Badge>
            )}
          </div>
          <CardTitle className="text-2xl md:text-3xl leading-tight font-serif">
            {asString(article.headline, "Untitled article")}
          </CardTitle>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
            {publishedAt && <span>Published {format(publishedAt, "MMM d, yyyy h:mm a")}</span>}
            <span>Ingested {format(scrapedAt, "MMM d, yyyy h:mm a")}</span>
            {article.author && <span>By {asString(article.author)}</span>}
          </div>
          {article.url && (
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline w-fit">
              Open original article
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <div className="flex flex-wrap gap-2">
            {extended.status === "dismissed" ? (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => moderateArticle("pending")}>
                <RotateCcw className="h-3.5 w-3.5" />
                Restore to Feed
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => moderateArticle("dismissed")}>
                <Archive className="h-3.5 w-3.5" />
                Dismiss from Feed
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {article.teaserSummary && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Summary</h2>
              <p className="text-base leading-relaxed">{article.teaserSummary}</p>
            </section>
          )}
          {article.viewpoint && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">RGI Scoring Rationale</h2>
              <p className="text-sm leading-relaxed border-l-2 border-primary/30 pl-3">{article.viewpoint}</p>
            </section>
          )}
          {(extended.scoreExplanation || extended.scoreBreakdown) && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Score Explainability</h2>
              {extended.scoreExplanation && (
                <p className="text-sm leading-relaxed">{extended.scoreExplanation}</p>
              )}
              {extended.scoreBreakdown && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {Object.entries(extended.scoreBreakdown).map(([key, value]) => (
                    <div key={key} className="rounded-md border bg-muted/30 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</p>
                      <p className="text-sm font-semibold">{Number(value).toFixed(1)}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {article.content && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Extracted Text</h2>
              <p className="text-sm leading-7 whitespace-pre-wrap text-foreground/85">{article.content}</p>
            </section>
          )}
          {tags.length > 0 && (
            <section className="flex flex-wrap gap-2">
              {tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
