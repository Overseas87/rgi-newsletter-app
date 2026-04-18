import { useState, useEffect } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { stripMarkdown } from "@/lib/utils";
import { CheckCircle, XCircle, RefreshCw, Edit3, Save, X, Eye, ExternalLink, Globe, Tag, Clock, Download } from "lucide-react";
import { SelectionRegenerateTextarea } from "@/components/selection-regenerate-textarea";
import { format, formatDistanceToNow } from "date-fns";

function ArticleTypeBadge({ articleType }: { articleType: string }) {
  if (articleType === "daily_brief") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wide">
        <Globe className="h-2.5 w-2.5" />Daily Brief
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-wide">
      <Tag className="h-2.5 w-2.5" />Topic Article
    </span>
  );
}

function BulletList({ items, dotColor = "text-primary" }: { items: string[]; dotColor?: string }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
          <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-current ${dotColor}`} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function FullArticleDialog({ article, open, onClose }: { article: DigestArticle | null; open: boolean; onClose: () => void }) {
  if (!article) return null;
  const isStructured = article.whatToWatch && article.whatToWatch.length > 0;
  const keyDevelopments = isStructured ? article.body.split("\n").filter(Boolean) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <ArticleTypeBadge articleType={article.articleType} />
            <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              Score: {article.relevancyScore?.toFixed(1)}/10
            </Badge>
            <a
              href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/digest/${article.id}/pdf`}
              download
              className="ml-auto"
            >
              <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                <Download className="h-3 w-3" />
                Download PDF
              </Button>
            </a>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{article.headline}</DialogTitle>
          <div className="flex items-center gap-4 pt-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span className="font-medium">RGI generated:</span>
              {format(new Date(article.createdAt), "MMMM d, yyyy")}
              {" — "}
              {format(new Date(article.createdAt), "HH:mm")}
              <span className="text-muted-foreground/50">({formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })})</span>
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Executive Summary — shown for all articles when present */}
          {article.executiveSummary && article.executiveSummary.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Executive Summary</p>
              <div className="space-y-1.5">
                {article.executiveSummary.map((s, i) => (
                  <p key={i} className="text-sm text-foreground/90 leading-relaxed">{s}</p>
                ))}
              </div>
            </div>
          )}

          {/* Key Developments (new format) OR prose body (legacy) */}
          {isStructured && keyDevelopments && keyDevelopments.length > 0 ? (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Key Developments</p>
              <BulletList items={keyDevelopments} dotColor="text-foreground/40" />
            </div>
          ) : (
            <div>
              {article.body.split("\n\n").filter(Boolean).map((para, i) => (
                <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-4">{stripMarkdown(para)}</p>
              ))}
            </div>
          )}

          {/* Why It Matters (new) / Key Takeaways (legacy) */}
          {article.keyTakeaways && article.keyTakeaways.length > 0 && (
            <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
                {isStructured ? "Why It Matters" : "Key Takeaways"}
              </p>
              <BulletList items={article.keyTakeaways} dotColor="text-amber-500" />
            </div>
          )}

          {/* RGI Take */}
          {article.rgiTake && (
            <div className="border-l-4 border-primary/60 pl-5 py-2 bg-primary/5 rounded-r-md">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">RGI Take</p>
              <p className="text-sm italic text-foreground/80 leading-relaxed">{article.rgiTake}</p>
            </div>
          )}

          {/* What to Watch (new format only) */}
          {isStructured && article.whatToWatch && article.whatToWatch.length > 0 && (
            <div className="rounded-xl border border-blue-200/60 bg-blue-50/40 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3">What to Watch</p>
              <BulletList items={article.whatToWatch} dotColor="text-blue-500" />
            </div>
          )}

          {/* Topic tags */}
          {article.topicTags && article.topicTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {article.topicTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
              ))}
            </div>
          )}

          {/* Sources */}
          {article.sourceArticles && article.sourceArticles.length > 0 && (
            <div className="border-t pt-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Sources</p>
              {article.sourceArticles.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline mb-1"
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

function DigestCard({ article }: { article: DigestArticle }) {
  const [isEditing, setIsEditing] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editedHeadline, setEditedHeadline] = useState(article.headline);
  const [editedBody, setEditedBody] = useState(article.body);
  const [editedTake, setEditedTake] = useState(article.rgiTake ?? "");

  // Sync local edit state when the article prop updates (e.g. after a save or regenerate)
  useEffect(() => {
    if (!isEditing) {
      setEditedHeadline(article.headline);
      setEditedBody(article.body);
      setEditedTake(article.rgiTake ?? "");
    }
  }, [article.headline, article.body, article.rgiTake, isEditing]);

  const approve = useApproveDigestArticle();
  const reject = useRejectDigestArticle();
  const regenerate = useRegenerateDigestArticle();
  const update = useUpdateDigestArticle();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
    queryClient.invalidateQueries({ queryKey: ["getDashboardSummary"] });
  };

  const handleSave = () => {
    update.mutate(
      {
        id: article.id,
        data: { headline: editedHeadline, body: editedBody, rgiTake: editedTake },
      },
      {
        onSuccess: () => {
          setIsEditing(false);
          invalidate();
          toast({ title: "Changes saved", description: "Your edits have been saved successfully." });
        },
        onError: () => {
          toast({ title: "Save failed", description: "Could not save your changes. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleApprove = () => {
    approve.mutate(
      { id: article.id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Article approved", description: "The article has been published to the archive." });
        },
        onError: () => {
          toast({ title: "Approval failed", description: "Could not approve the article. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  const handleReject = () => {
    reject.mutate(
      { id: article.id, data: {} },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Article rejected", description: "The article has been moved to Rejected." });
        },
        onError: () => {
          toast({ title: "Rejection failed", description: "Could not reject the article.", variant: "destructive" });
        },
      }
    );
  };

  const handleRegenerate = () => {
    regenerate.mutate(
      { id: article.id, data: {} },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Article regenerated", description: "Claude has written a new version of this article." });
        },
        onError: () => {
          toast({ title: "Regeneration failed", description: "Could not regenerate the article. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <>
      <Card className="relative" data-testid={`digest-card-${article.id}`}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <ArticleTypeBadge articleType={article.articleType} />
                <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Score: {article.relevancyScore?.toFixed(1)}/10
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
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 pt-0.5">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="font-medium">RGI generated:</span>
                <span>{format(new Date(article.createdAt), "MMMM d, yyyy")} — {format(new Date(article.createdAt), "HH:mm")}</span>
                <span className="text-muted-foreground/40">({formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })})</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="ghost" onClick={() => setViewOpen(true)} data-testid="btn-preview">
                <Eye className="h-4 w-4" />
              </Button>
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
          {(() => {
            const isStructured = article.whatToWatch && article.whatToWatch.length > 0;
            const keyDevelopments = isStructured ? article.body.split("\n").filter(Boolean) : null;
            return (
              <>
                {/* Executive Summary */}
                {article.executiveSummary && article.executiveSummary.length > 0 && (
                  <div className="text-sm text-foreground/80 leading-relaxed space-y-1">
                    {article.executiveSummary.map((s, i) => <p key={i}>{s}</p>)}
                  </div>
                )}

                {/* Key Developments or prose body */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    {isStructured ? "Key Developments" : "Article Body"}
                  </p>
                  {isEditing ? (
                    <SelectionRegenerateTextarea
                      value={editedBody}
                      onChange={setEditedBody}
                      articleId={article.id}
                      articleContext={{ headline: editedHeadline, body: editedBody, rgiTake: editedTake }}
                      field="body"
                      className="text-sm leading-relaxed"
                      minHeight="180px"
                      data-testid="textarea-body"
                    />
                  ) : isStructured && keyDevelopments ? (
                    <ul className="space-y-1.5">
                      {keyDevelopments.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                          <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-foreground/30" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm leading-relaxed text-foreground/90">
                      {article.body.split("\n\n").filter(Boolean).map((para, i) => (
                        <p key={i} className="mb-3">{stripMarkdown(para)}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Why It Matters (new) or Key Takeaways (legacy) */}
                {!isEditing && article.keyTakeaways && article.keyTakeaways.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-700 uppercase tracking-wider mb-2">
                      {isStructured ? "Why It Matters" : "Key Takeaways"}
                    </p>
                    <ul className="space-y-1.5">
                      {article.keyTakeaways.map((item, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                          <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            );
          })()}

          <div className="border-l-2 border-primary/40 pl-4">
            <p className="text-xs font-medium text-primary/80 uppercase tracking-wider mb-2">RGI Take</p>
            {isEditing ? (
              <SelectionRegenerateTextarea
                value={editedTake}
                onChange={setEditedTake}
                articleId={article.id}
                articleContext={{ headline: editedHeadline, body: editedBody, rgiTake: editedTake }}
                field="rgiTake"
                className="text-sm"
                minHeight="80px"
                placeholder="The RGI editorial perspective..."
                data-testid="textarea-rgi-take"
              />
            ) : (
              <p className="text-sm italic text-muted-foreground leading-relaxed">
                {article.rgiTake || "No RGI Take provided."}
              </p>
            )}
          </div>

          {/* What to Watch */}
          {!isEditing && article.whatToWatch && article.whatToWatch.length > 0 && (
            <div>
              <p className="text-xs font-medium text-blue-700 uppercase tracking-wider mb-2">What to Watch</p>
              <ul className="space-y-1.5">
                {article.whatToWatch.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                    <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {article.sourceArticles && article.sourceArticles.length > 0 && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">Source: </span>
              {article.sourceArticles.map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary/70 hover:underline inline-flex items-center gap-0.5"
                >
                  {src.sourceName}
                  <ExternalLink className="h-3 w-3 ml-0.5" />
                </a>
              ))}
            </div>
          )}
        </CardContent>

        <CardFooter className="flex gap-3 pt-4 border-t">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={approve.isPending}
            data-testid="btn-approve"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {approve.isPending ? "Approving..." : "Approve"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            data-testid="btn-regenerate"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
            {regenerate.isPending ? "Regenerating with Claude..." : "Regenerate"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReject}
            disabled={reject.isPending}
            className="text-destructive border-destructive/30 hover:bg-destructive/5 ml-auto"
            data-testid="btn-reject"
          >
            <XCircle className="h-4 w-4 mr-1" />
            {reject.isPending ? "Rejecting..." : "Reject"}
          </Button>
        </CardFooter>
      </Card>

      <FullArticleDialog article={article} open={viewOpen} onClose={() => setViewOpen(false)} />
    </>
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
          <Badge variant="outline">{(articles as DigestArticle[]).length} pending</Badge>
          {(articles as DigestArticle[]).map((article) => (
            <DigestCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}
