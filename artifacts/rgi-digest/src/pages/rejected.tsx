import { useListDigestArticles, DigestArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

export default function Rejected() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "rejected" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Rejected</h1>
        <p className="text-muted-foreground mt-1">Digest entries that were rejected during review.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No rejected entries</p>
          <p className="text-sm mt-1">Items rejected during review will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Badge variant="outline">{articles.length} rejected</Badge>
          {articles.map((article: DigestArticle) => (
            <Card key={article.id} className="opacity-70" data-testid={`rejected-card-${article.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(article.updatedAt), "MMMM d, yyyy")}
                  </span>
                </div>
                <CardTitle className="text-lg font-serif">{article.headline}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">{article.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
