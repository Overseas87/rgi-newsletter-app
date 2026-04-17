import { useListDigestArticles, DigestArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

export default function Published() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "published" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Published Archive</h1>
        <p className="text-muted-foreground mt-1">All approved and published digest entries.</p>
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
          {articles.map((article: DigestArticle) => (
            <Card key={article.id} data-testid={`published-card-${article.id}`}>
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
              <CardContent className="space-y-4">
                <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{article.body}</p>
                {article.rgiTake && (
                  <div className="border-l-2 border-primary/40 pl-4">
                    <p className="text-xs font-medium text-primary/80 uppercase tracking-wider mb-1">RGI Take</p>
                    <p className="text-sm italic text-muted-foreground">{article.rgiTake}</p>
                  </div>
                )}
                {article.topicTags && (
                  <div className="flex flex-wrap gap-1.5">
                    {article.topicTags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
