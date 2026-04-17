import { useListDigestArticles, DigestArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { stripMarkdown } from "@/lib/utils";

function ArticleDialog({ article, open, onClose }: { article: DigestArticle | null; open: boolean; onClose: () => void }) {
  if (!article) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              Score: {article.relevancyScore}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Published {format(new Date(article.updatedAt), "MMMM d, yyyy")}
            </span>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{article.headline}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 mt-2">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {article.body.split("\n\n").filter(Boolean).map((para, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-4">{stripMarkdown(para)}</p>
            ))}
          </div>
          {article.rgiTake && (
            <div className="border-l-4 border-primary/60 pl-5 py-2 bg-primary/5 rounded-r-md">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">RGI Take</p>
              <p className="text-sm italic text-foreground/80 leading-relaxed">{article.rgiTake}</p>
            </div>
          )}
          {article.topicTags && article.topicTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {article.topicTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
              ))}
            </div>
          )}
          {article.sourceArticles && article.sourceArticles.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Source</p>
              {article.sourceArticles.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {src.sourceName}: {src.headline}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Published() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "approved" });
  const [selected, setSelected] = useState<DigestArticle | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Published Archive</h1>
        <p className="text-muted-foreground mt-1">All approved and published digest entries. Click any entry to read the full article.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No published entries yet</p>
          <p className="text-sm mt-1">Approve items from Pending Review to populate the archive.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Badge variant="outline">{articles.length} published</Badge>
          {(articles as DigestArticle[]).map((article) => (
            <Card
              key={article.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelected(article)}
              data-testid={`published-card-${article.id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Published {format(new Date(article.updatedAt), "MMMM d, yyyy")}
                      </span>
                    </div>
                    <CardTitle className="text-xl font-serif leading-snug">{article.headline}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm leading-relaxed text-foreground/80 line-clamp-3">{article.body}</p>
                {article.topicTags && (
                  <div className="flex flex-wrap gap-1.5">
                    {article.topicTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
                    ))}
                  </div>
                )}
                <Button variant="link" size="sm" className="p-0 h-auto text-xs text-primary/70">
                  Read full article
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ArticleDialog article={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
