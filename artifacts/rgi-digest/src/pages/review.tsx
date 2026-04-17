import { useState } from "react";
import {
  useListDigestArticles,
  useApproveDigestArticle,
  useRejectDigestArticle,
  useRegenerateDigestArticle,
  useUpdateDigestArticle,
  DigestArticle,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, XCircle, RefreshCw, Edit3, Save, X } from "lucide-react";

function DigestCard({ article }: { article: DigestArticle }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedHeadline, setEditedHeadline] = useState(article.headline);
  const [editedBody, setEditedBody] = useState(article.body);
  const [editedTake, setEditedTake] = useState(article.rgiTake ?? "");

  const approve = useApproveDigestArticle();
  const reject = useRejectDigestArticle();
  const regenerate = useRegenerateDigestArticle();
  const update = useUpdateDigestArticle();
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
  };

  const handleSave = () => {
    update.mutate(
      {
        id: article.id,
        data: { headline: editedHeadline, body: editedBody, rgiTake: editedTake },
      },
      { onSuccess: () => { setIsEditing(false); invalidate(); } }
    );
  };

  return (
    <Card className="relative" data-testid={`digest-card-${article.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {article.discipline}
              </Badge>
              {article.topicTags?.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
              ))}
            </div>
            {isEditing ? (
              <Input
                value={editedHeadline}
                onChange={(e) => setEditedHeadline(e.target.value)}
                className="text-lg font-semibold"
                data-testid="input-headline"
              />
            ) : (
              <CardTitle className="text-xl font-serif leading-snug">{article.headline}</CardTitle>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {isEditing ? (
              <>
                <Button size="sm" onClick={handleSave} disabled={update.isPending} data-testid="btn-save">
                  <Save className="h-4 w-4 mr-1" /> Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} data-testid="btn-cancel">
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)} data-testid="btn-edit">
                <Edit3 className="h-4 w-4 mr-1" /> Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Article Body</p>
          {isEditing ? (
            <Textarea
              value={editedBody}
              onChange={(e) => setEditedBody(e.target.value)}
              className="min-h-[200px] text-sm leading-relaxed"
              data-testid="textarea-body"
            />
          ) : (
            <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {article.body}
            </div>
          )}
        </div>

        {(article.rgiTake || isEditing) && (
          <div className="border-l-2 border-primary/40 pl-4">
            <p className="text-xs font-medium text-primary/80 uppercase tracking-wider mb-2">RGI Take</p>
            {isEditing ? (
              <Textarea
                value={editedTake}
                onChange={(e) => setEditedTake(e.target.value)}
                className="min-h-[80px] text-sm"
                placeholder="The RGI editorial perspective..."
                data-testid="textarea-rgi-take"
              />
            ) : (
              <p className="text-sm italic text-muted-foreground leading-relaxed">{article.rgiTake}</p>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-3 pt-4 border-t">
        <Button
          size="sm"
          onClick={() => approve.mutate({ id: article.id }, { onSuccess: invalidate })}
          disabled={approve.isPending}
          data-testid="btn-approve"
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <CheckCircle className="h-4 w-4 mr-1" /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => regenerate.mutate({ id: article.id, data: {} }, { onSuccess: invalidate })}
          disabled={regenerate.isPending}
          data-testid="btn-regenerate"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
          {regenerate.isPending ? "Regenerating..." : "Regenerate"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => reject.mutate({ id: article.id }, { onSuccess: invalidate })}
          disabled={reject.isPending}
          className="text-destructive border-destructive/30 hover:bg-destructive/5 ml-auto"
          data-testid="btn-reject"
        >
          <XCircle className="h-4 w-4 mr-1" /> Reject
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function Review() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "pending_review" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Pending Review</h1>
        <p className="text-muted-foreground mt-1">
          Approve, edit, or reject AI-written digest entries before publication.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No items pending review</p>
          <p className="text-sm mt-1">Select articles from Today's Topics and generate digest entries to begin.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Badge variant="outline">{articles.length} pending</Badge>
          {articles.map((article) => (
            <DigestCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
