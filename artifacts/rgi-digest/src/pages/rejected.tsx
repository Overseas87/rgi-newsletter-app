import { useState } from "react";
import {
  useListDigestArticles,
  useUpdateDigestArticle,
  useDeleteDigestArticle,
  DigestArticle,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink, Edit3, Save, X, Eye, RotateCcw, Trash2, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { asArray, asNumber, asString, asStringArray, safeDate, safeTextBlocks } from "@/lib/arrays";
import { useToast } from "@/hooks/use-toast";
import { stripMarkdown } from "@/lib/utils";

const DISCIPLINE_BADGE: Record<string, string> = {
  "Strategic Foresight": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "System Vitality": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "Civic Stewardship": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "Multiple": "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

interface ConfirmDeleteDialogProps {
  open: boolean;
  headline: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function ConfirmDeleteDialog({ open, headline, onConfirm, onCancel, deleting }: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-serif">Delete permanently?</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed">
            This will permanently remove <span className="font-medium text-foreground">"{headline}"</span> from the system. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 mt-2">
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={deleting}
            className="gap-2"
          >
            <Trash2 className="h-4 w-4" />
            {deleting ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FullArticleDialogProps {
  article: DigestArticle | null;
  open: boolean;
  onClose: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
  restoring?: boolean;
}

function FullArticleDialog({ article, open, onClose, onRestore, onDelete, restoring }: FullArticleDialogProps) {
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
              Score {asNumber(article.relevancyScore).toFixed(1)}/10
            </Badge>
            <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
              Rejected
            </Badge>
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-medium">Generated:</span>
                {format(safeDate(article.createdAt, new Date()), "MMMM d, yyyy")} — {format(safeDate(article.createdAt, new Date()), "HH:mm")}
                <span className="text-muted-foreground/50">({formatDistanceToNow(safeDate(article.createdAt, new Date()), { addSuffix: true })})</span>
              </span>
            </div>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{asString(article.headline, "Untitled brief")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          <div>
            {safeTextBlocks(article.body).map((para, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-4">{stripMarkdown(para)}</p>
            ))}
          </div>

          {asString(article.rgiTake).length > 0 && (
            <div className="border-l-4 border-primary/60 pl-5 py-2 bg-primary/5 rounded-r-md">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">RGI Editorial</p>
              <p className="text-sm italic text-foreground/80 leading-relaxed">{asString(article.rgiTake)}</p>
            </div>
          )}

          {asStringArray(article.topicTags).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {asStringArray(article.topicTags).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
              ))}
            </div>
          )}

          {asArray<{ id: number; url: string; headline: string; sourceName?: string | null }>(article.sourceArticles).length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Sources ({asArray<{ id: number; url: string; headline: string; sourceName?: string | null }>(article.sourceArticles).length})
              </p>
              <div className="space-y-1">
                {asArray<{ id: number; url: string; headline: string; sourceName?: string | null }>(article.sourceArticles).map((src) => (
                  <a
                    key={src.id}
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <span className="font-medium">{asString(src.sourceName, "Source")}:</span> {asString(src.headline, "Untitled article")}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="border-t pt-4 flex gap-2 flex-wrap">
            {onRestore && (
              <Button onClick={onRestore} disabled={restoring} variant="outline" className="gap-2">
                <RotateCcw className="h-4 w-4" />
                {restoring ? "Restoring..." : "Restore to Review"}
              </Button>
            )}
            {onDelete && (
              <Button
                onClick={onDelete}
                variant="destructive"
                className="gap-2 ml-auto"
              >
                <Trash2 className="h-4 w-4" />
                Delete permanently
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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedHeadline, setEditedHeadline] = useState(asString(article.headline));
  const [editedBody, setEditedBody] = useState(asString(article.body));
  const [editedTake, setEditedTake] = useState(asString(article.rgiTake));

  const update = useUpdateDigestArticle();
  const deleteArticle = useDeleteDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/digest"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/summary"] });
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

  const handleDeleteConfirm = () => {
    deleteArticle.mutate(
      { id: article.id },
      {
        onSuccess: () => {
          setConfirmDeleteOpen(false);
          setViewOpen(false);
          invalidate();
          toast({ title: "Article deleted", description: "The article has been permanently removed." });
        },
        onError: () => toast({ title: "Delete failed", variant: "destructive" }),
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
                  Score {asNumber(article.relevancyScore).toFixed(1)}/10
                </Badge>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="font-medium">Generated:</span>
                  {format(safeDate(article.createdAt, new Date()), "MMM d, yyyy")} — {format(safeDate(article.createdAt, new Date()), "HH:mm")}
                  <span className="text-muted-foreground/40">({formatDistanceToNow(safeDate(article.createdAt, new Date()), { addSuffix: true })})</span>
                </span>
              </div>
              {isEditing ? (
                <Input
                  value={editedHeadline}
                  onChange={(e) => setEditedHeadline(e.target.value)}
                  className="text-base font-semibold"
                />
              ) : (
                <CardTitle className="text-lg font-serif leading-snug">{asString(article.headline, "Untitled brief")}</CardTitle>
              )}
            </div>
            <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
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
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={deleteArticle.isPending}
                data-testid="btn-delete-rejected"
                title="Delete permanently"
              >
                <Trash2 className="h-3.5 w-3.5" />
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">RGI Editorial</p>
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

          {asStringArray(article.topicTags).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {asStringArray(article.topicTags).map((tag) => (
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
        onDelete={() => { setViewOpen(false); setConfirmDeleteOpen(true); }}
        restoring={update.isPending}
      />

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        headline={article.headline}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        deleting={deleteArticle.isPending}
      />
    </>
  );
}

export default function Rejected() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "rejected" });
  const safeArticles = asArray<DigestArticle>(articles);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Rejected</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {safeArticles.length > 0
            ? `${safeArticles.length} rejected ${safeArticles.length === 1 ? "entry" : "entries"} — restore to review or delete permanently`
            : "Digest entries that were rejected during review."}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : safeArticles.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          <p className="text-lg font-medium">No rejected entries</p>
          <p className="text-sm mt-1">Items rejected during review will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {safeArticles.map((article) => (
            <RejectedCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
