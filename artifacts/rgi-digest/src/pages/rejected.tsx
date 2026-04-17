import { useState } from "react";
import {
  useListDigestArticles,
  useUpdateDigestArticle,
  DigestArticle,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { ExternalLink, Edit3, Save, X, Eye, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { stripMarkdown } from "@/lib/utils";

const DISCIPLINE_BADGE: Record<string, string> = {
  "Strategic Foresight": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "System Vitality": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Civic Stewardship": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Multiple": "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

interface FullArticleDialogProps {
  article: DigestArticle | null;
  open: boolean;
  onClose: () => void;
  onRestore?: () => void;
  restoring?: boolean;
}

function FullArticleDialog({ article, open, onClose, onRestore, restoring }: FullArticleDialogProps) {
  if (!article) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <Badge variant="outline" className={`text-xs ${DISCIPLINE_BADGE[article.discipline ?? ""] ?? ""}`}>
              {article.discipline}
            </Badge>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              Score {article.relevancyScore}
            </Badge>
            <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
              Rejected
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              {format(new Date(article.updatedAt), "MMMM d, yyyy")}
            </span>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{article.headline}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          <div>
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
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Sources ({article.sourceArticles.length})
              </p>
              <div className="space-y-1">
                {article.sourceArticles.map((src) => (
                  <a
                    key={src.id}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <span className="font-medium">{src.sourceName}:</span> {src.headline}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-4 flex gap-2">
            {onRestore && (
              <Button onClick={onRestore} disabled={restoring} variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {restoring ? "Restoring..." : "Restore to Review"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RejectedCard({ article }: { article: DigestArticle }) {
  const [viewOpen, setViewOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedHeadline, setEditedHeadline] = useState(article.headline);
  const [editedBody, setEditedBody] = useState(article.body);
  const [editedTake, setEditedTake] = useState(article.rgiTake ?? "");

  const update = useUpdateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
    queryClient.invalidateQueries({ queryKey: ["getDashboardSummary"] });
  };

  const handleSave = () => {
    update.mutate(
      { id: article.id, data: { headline: editedHeadline, body: editedBody, rgiTake: editedTake } },
      {
        onSuccess: () => {
          setIsEditing(false);
          invalidate();
          toast({ title: "Changes saved" });
        },
        onError: () => toast({ title: "Save failed", variant: "destructive" }),
      }
    );
  };

  const handleRestore = () => {
    update.mutate(
      { id: article.id, data: { status: "pending_review" } },
      {
        onSuccess: () => {
          setViewOpen(false);
          invalidate();
          toast({ title: "Restored to review", description: "Article moved back to Pending Review." });
        },
        onError: () => toast({ title: "Restore failed", variant: "destructive" }),
      }
    );
  };

  return (
    <>
      <Card
        className="border-destructive/10 bg-card/60 opacity-80 hover:opacity-100 transition-opacity"
        data-testid={`rejected-card-${article.id}`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="outline"
                  className={`text-xs ${DISCIPLINE_BADGE[article.discipline ?? ""] ?? ""}`}
                >
                  {article.discipline}
                </Badge>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Score {article.relevancyScore}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(article.updatedAt), "MMM d, yyyy")}
                </span>
              </div>
              {isEditing ? (
                <Input
                  value={editedHeadline}
                  onChange={(e) => setEditedHeadline(e.target.value)}
                  className="text-base font-semibold"
                />
              ) : (
                <CardTitle className="text-lg font-serif leading-snug">{article.headline}</CardTitle>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => setViewOpen(true)}
                data-testid="btn-view-rejected"
              >
                <Eye className="h-3.5 w-3.5" />
              </Button>
              {isEditing ? (
                <>
                  <Button size="sm" onClick={handleSave} disabled={update.isPending} className="h-8">
                    <Save className="h-3.5 w-3.5 mr-1" /> Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setIsEditing(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="outline" className="h-8" onClick={() => setIsEditing(true)}>
                  <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 text-xs"
                onClick={handleRestore}
                disabled={update.isPending}
                data-testid="btn-restore-rejected"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restore
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {isEditing ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Body</p>
                <Textarea
                  value={editedBody}
                  onChange={(e) => setEditedBody(e.target.value)}
                  className="min-h-[140px] text-sm leading-relaxed"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">RGI Take</p>
                <Textarea
                  value={editedTake}
                  onChange={(e) => setEditedTake(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
              {stripMarkdown(article.body).slice(0, 300)}
              {article.body.length > 300 && (
                <button
                  className="ml-1 text-primary/60 hover:text-primary text-xs underline-offset-2 underline"
                  onClick={() => setViewOpen(true)}
                >
                  read more
                </button>
              )}
            </p>
          )}

          {article.topicTags && article.topicTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {article.topicTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px] font-normal h-5">{tag}</Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <FullArticleDialog
        article={article}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        onRestore={handleRestore}
        restoring={update.isPending}
      />
    </>
  );
}

export default function Rejected() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "rejected" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Rejected</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {articles.length > 0
            ? `${articles.length} rejected ${articles.length === 1 ? "entry" : "entries"} — click to read in full or restore to review`
            : "Digest entries that were rejected during review."}
        </p>
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
          {(articles as DigestArticle[]).map((article) => (
            <RejectedCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
