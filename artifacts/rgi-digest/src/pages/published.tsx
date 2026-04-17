import { useListDigestArticles, DigestArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { useState } from "react";
import { ExternalLink, Globe, Tag, Send, CheckCircle, Users, AlertCircle, Mail } from "lucide-react";
import { stripMarkdown } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

// Extend DigestArticle with newsletter fields returned by the backend
type DigestArticleWithNewsletter = DigestArticle & {
  newsletterSentAt?: string | null;
  newsletterSentCount?: number | null;
};

function ArticleTypeBadge({ articleType }: { articleType: string }) {
  if (articleType === "daily_brief") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wide">
        <Globe className="h-2.5 w-2.5" />Daily Brief
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wide">
      <Tag className="h-2.5 w-2.5" />Topic Article
    </span>
  );
}

function SentBadge({ sentAt, count }: { sentAt: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200 uppercase tracking-wide">
      <CheckCircle className="h-2.5 w-2.5" />
      Distributed · {count} recipient{count !== 1 ? "s" : ""}
    </span>
  );
}

// Full article reading dialog
function ArticleDialog({ article, open, onClose }: { article: DigestArticleWithNewsletter | null; open: boolean; onClose: () => void }) {
  if (!article) return null;
  const isDailyBrief = article.articleType === "daily_brief";
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <ArticleTypeBadge articleType={article.articleType} />
            <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
            <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
              Score: {article.relevancyScore}
            </Badge>
            <span className="text-xs text-muted-foreground ml-auto">
              Published {format(new Date(article.updatedAt), "MMMM d, yyyy")}
            </span>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{article.headline}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 mt-2">
          {isDailyBrief && article.executiveSummary && article.executiveSummary.length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-primary mb-3">Executive Summary</p>
              <ul className="space-y-2">
                {article.executiveSummary.map((bullet, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
                    <span className="text-primary font-bold mt-0.5 shrink-0">•</span>
                    {bullet}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          {article.keyTakeaways && article.keyTakeaways.length > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Key Takeaways</p>
              <ul className="space-y-2">
                {article.keyTakeaways.map((item, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    {item}
                  </li>
                ))}
              </ul>
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

// Newsletter send confirmation + result dialog
function SendNewsletterDialog({
  article,
  open,
  onClose,
  onSent,
}: {
  article: DigestArticleWithNewsletter | null;
  open: boolean;
  onClose: () => void;
  onSent: (result: SendResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setResult(null);
    setError(null);
    onClose();
  };

  const handleSend = async () => {
    if (!article) return;
    setLoading(true);
    setError(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
      const resp = await fetch(`${base}/api/digest/${article.id}/send-newsletter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Send failed. Please try again.");
        return;
      }
      setResult(data as SendResult);
      onSent(data as SendResult);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!article) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-serif">
            <Mail className="h-5 w-5 text-primary" />
            Send as Newsletter
          </DialogTitle>
        </DialogHeader>

        {!result ? (
          <>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Article</p>
                <p className="font-serif text-base font-semibold leading-snug">{article.headline}</p>
                <div className="flex items-center gap-2 mt-2">
                  <ArticleTypeBadge articleType={article.articleType} />
                  {article.discipline && (
                    <span className="text-xs text-muted-foreground">{article.discipline}</span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
                <Users className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-900">This article will be distributed to all active subscribers.</p>
                  <p className="text-xs text-blue-700 mt-0.5">Subscriber count is shown on send. Manage subscribers via the Weekly Digest settings.</p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-red-200 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
              <Button onClick={handleSend} disabled={loading} className="gap-2">
                <Send className="h-4 w-4" />
                {loading ? "Sending..." : "Send Newsletter"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 p-4 rounded-lg border border-emerald-200 bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  {result.sent ? (
                    <>
                      <p className="text-sm font-semibold text-emerald-900">Newsletter delivered successfully</p>
                      <p className="text-xs text-emerald-700 mt-0.5">Sent to {result.subscriberCount} subscriber{result.subscriberCount !== 1 ? "s" : ""}.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-emerald-900">Distribution recorded</p>
                      <p className="text-xs text-emerald-700 mt-0.5">
                        {result.subscriberCount} subscriber{result.subscriberCount !== 1 ? "s" : ""} logged.
                        {result.emailPreview && " SMTP is not configured — configure SMTP_HOST, SMTP_USER, and SMTP_PASS environment variables to enable actual email delivery."}
                      </p>
                    </>
                  )}
                </div>
              </div>

              {result.warning && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-800">{result.warning}</p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type SendResult = {
  sent: boolean;
  emailPreview: boolean;
  subscriberCount: number;
  subject: string;
  warning?: string;
};

export default function Published() {
  const queryClient = useQueryClient();
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "approved" });
  const [selectedRead, setSelectedRead] = useState<DigestArticleWithNewsletter | null>(null);
  const [selectedSend, setSelectedSend] = useState<DigestArticleWithNewsletter | null>(null);
  // Track local sent state per article id (in case the list isn't refetched immediately)
  const [localSentMap, setLocalSentMap] = useState<Record<number, { sentAt: string; count: number }>>({});

  const enriched = (articles as DigestArticleWithNewsletter[]);
  const dailyBriefs = enriched.filter((a) => a.articleType === "daily_brief");
  const topicArticles = enriched.filter((a) => a.articleType === "topic_article");

  const handleSent = (article: DigestArticleWithNewsletter, result: SendResult) => {
    setLocalSentMap((prev) => ({
      ...prev,
      [article.id]: { sentAt: new Date().toISOString(), count: result.subscriberCount },
    }));
    // Refetch so the list reflects the updated newsletterSentAt
    queryClient.invalidateQueries({ queryKey: ["listDigestArticles"] });
  };

  const isSent = (article: DigestArticleWithNewsletter) =>
    !!(localSentMap[article.id] || article.newsletterSentAt);

  const sentInfo = (article: DigestArticleWithNewsletter) =>
    localSentMap[article.id] ?? (article.newsletterSentAt
      ? { sentAt: article.newsletterSentAt, count: article.newsletterSentCount ?? 0 }
      : null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-serif tracking-tight text-foreground">Published Archive</h1>
        <p className="text-muted-foreground mt-1 text-sm">All approved intelligence ready for distribution. Use "Send as Newsletter" to distribute to subscribers.</p>
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
        <>
          {/* Section 1: Daily Intelligence Briefs */}
          {dailyBriefs.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Daily Intelligence Briefs
                </h2>
                <Badge variant="outline" className="text-xs">{dailyBriefs.length}</Badge>
              </div>
              <div className="space-y-3">
                {dailyBriefs.map((article) => {
                  const sent = isSent(article);
                  const info = sentInfo(article);
                  return (
                    <Card
                      key={article.id}
                      className="border-blue-200/60 bg-blue-500/[0.02] hover:border-blue-300 transition-colors"
                      data-testid={`published-card-${article.id}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ArticleTypeBadge articleType="daily_brief" />
                              {article.discipline && (
                                <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                              )}
                              {sent && info && (
                                <SentBadge sentAt={info.sentAt} count={info.count} />
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {format(new Date(article.updatedAt), "MMMM d, yyyy")}
                              </span>
                            </div>
                            <CardTitle className="text-xl font-serif leading-snug">{article.headline}</CardTitle>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {article.executiveSummary && article.executiveSummary.length > 0 ? (
                          <ul className="space-y-1">
                            {article.executiveSummary.slice(0, 3).map((bullet, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <span className="text-primary/60 font-bold mt-0.5 shrink-0">•</span>
                                {bullet}
                              </li>
                            ))}
                            {article.executiveSummary.length > 3 && (
                              <li className="text-xs text-primary/60 pl-4">
                                +{article.executiveSummary.length - 3} more points
                              </li>
                            )}
                          </ul>
                        ) : (
                          <p className="text-sm leading-relaxed text-foreground/80 line-clamp-3">{article.body}</p>
                        )}
                        <div className="flex items-center gap-3 pt-1">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-xs text-primary/70"
                            onClick={() => setSelectedRead(article)}
                          >
                            Read full brief
                          </Button>
                          <span className="text-muted-foreground/40 text-xs">·</span>
                          <Button
                            variant={sent ? "outline" : "default"}
                            size="sm"
                            className={`h-7 text-xs gap-1.5 ${sent ? "text-muted-foreground border-border" : ""}`}
                            onClick={(e) => { e.stopPropagation(); setSelectedSend(article); }}
                          >
                            {sent ? (
                              <><CheckCircle className="h-3 w-3" />Resend</>
                            ) : (
                              <><Send className="h-3 w-3" />Send as Newsletter</>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* Section 2: Topic Articles */}
          {topicArticles.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-3">
                <Tag className="h-4 w-4 text-emerald-600" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Topic Articles
                </h2>
                <Badge variant="outline" className="text-xs">{topicArticles.length}</Badge>
              </div>
              <div className="space-y-3">
                {topicArticles.map((article) => {
                  const sent = isSent(article);
                  const info = sentInfo(article);
                  return (
                    <Card
                      key={article.id}
                      className="hover:border-primary/40 transition-colors"
                      data-testid={`published-card-${article.id}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ArticleTypeBadge articleType="topic_article" />
                              {article.discipline && (
                                <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                              )}
                              {sent && info && (
                                <SentBadge sentAt={info.sentAt} count={info.count} />
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {format(new Date(article.updatedAt), "MMMM d, yyyy")}
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
                            {article.topicTags.slice(0, 5).map((tag) => (
                              <Badge key={tag} variant="secondary" className="text-xs font-normal">{tag}</Badge>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-3 pt-1">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-xs text-primary/70"
                            onClick={() => setSelectedRead(article)}
                          >
                            Read full article
                          </Button>
                          <span className="text-muted-foreground/40 text-xs">·</span>
                          <Button
                            variant={sent ? "outline" : "default"}
                            size="sm"
                            className={`h-7 text-xs gap-1.5 ${sent ? "text-muted-foreground border-border" : ""}`}
                            onClick={(e) => { e.stopPropagation(); setSelectedSend(article); }}
                          >
                            {sent ? (
                              <><CheckCircle className="h-3 w-3" />Resend</>
                            ) : (
                              <><Send className="h-3 w-3" />Send as Newsletter</>
                            )}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <ArticleDialog
        article={selectedRead}
        open={!!selectedRead}
        onClose={() => setSelectedRead(null)}
      />

      <SendNewsletterDialog
        article={selectedSend}
        open={!!selectedSend}
        onClose={() => setSelectedSend(null)}
        onSent={(result) => {
          if (selectedSend) handleSent(selectedSend, result);
          setSelectedSend(null);
        }}
      />
    </div>
  );
}
