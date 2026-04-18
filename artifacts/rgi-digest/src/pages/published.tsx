import { useListDigestArticles, DigestArticle } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format, formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { ExternalLink, Globe, Tag, Download, FileDown } from "lucide-react";
import { stripMarkdown } from "@/lib/utils";

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

// Full article reading dialog
function ArticleDialog({ article, open, onClose }: { article: DigestArticle | null; open: boolean; onClose: () => void }) {
  if (!article) return null;
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
            <div className="ml-auto flex items-center gap-3">
              <a
                href={`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/digest/${article.id}/pdf`}
                download
              >
                <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
                  <Download className="h-3 w-3" />
                  Download PDF
                </Button>
              </a>
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-medium">RGI generated:</span> {format(new Date(article.createdAt), "MMMM d, yyyy")} — {format(new Date(article.createdAt), "HH:mm")}
                  {" "}
                  <span className="text-muted-foreground/50">({formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })})</span>
                </span>
                {article.publishedAt && (
                  <span className="text-[11px] text-muted-foreground/60">
                    <span className="font-medium">Approved:</span> {format(new Date(article.publishedAt), "MMMM d, yyyy")} — {format(new Date(article.publishedAt), "HH:mm")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogTitle className="text-2xl font-serif leading-tight text-left">{article.headline}</DialogTitle>
        </DialogHeader>
        {(() => {
          const isStructured = article.whatToWatch && article.whatToWatch.length > 0;
          const keyDevelopments = isStructured ? article.body.split("\n").filter(Boolean) : null;
          return (
            <div className="space-y-5 mt-2">
              {/* Executive Summary */}
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

              {/* Key Developments or prose body */}
              {isStructured && keyDevelopments && keyDevelopments.length > 0 ? (
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-3">Key Developments</p>
                  <ul className="space-y-2">
                    {keyDevelopments.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-foreground/30" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  {article.body.split("\n\n").filter(Boolean).map((para, i) => (
                    <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-4">{stripMarkdown(para)}</p>
                  ))}
                </div>
              )}

              {/* Why It Matters or Key Takeaways */}
              {article.keyTakeaways && article.keyTakeaways.length > 0 && (
                <div className="rounded-xl border border-amber-200/60 bg-amber-50/40 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-amber-700 mb-3">
                    {isStructured ? "Why It Matters" : "Key Takeaways"}
                  </p>
                  <ul className="space-y-2">
                    {article.keyTakeaways.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* RGI Take */}
              {article.rgiTake && (
                <div className="border-l-4 border-primary/60 pl-5 py-2 bg-primary/5 rounded-r-md">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-2">RGI Take</p>
                  <p className="text-sm italic text-foreground/80 leading-relaxed">{article.rgiTake}</p>
                </div>
              )}

              {/* What to Watch */}
              {isStructured && article.whatToWatch && article.whatToWatch.length > 0 && (
                <div className="rounded-xl border border-blue-200/60 bg-blue-50/40 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-3">What to Watch</p>
                  <ul className="space-y-2">
                    {article.whatToWatch.map((item, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90">
                        <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
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
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

export default function Published() {
  const { data: articles = [], isLoading } = useListDigestArticles({ status: "approved" });
  const [selectedRead, setSelectedRead] = useState<DigestArticle | null>(null);

  const dailyBriefs = (articles as DigestArticle[]).filter((a) => a.articleType === "daily_brief");
  const topicArticles = (articles as DigestArticle[]).filter((a) => a.articleType === "topic_article");

  const combinedPdfUrl = articles.length > 0
    ? `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/digest/pdf/combined?ids=${articles.map((a) => a.id).join(",")}`
    : null;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif tracking-tight text-foreground">Published Archive</h1>
          <p className="text-muted-foreground mt-1 text-sm">All approved strategic intelligence briefs and topic articles.</p>
        </div>
        {combinedPdfUrl && (
          <a href={combinedPdfUrl} download>
            <Button variant="outline" className="gap-2 shrink-0">
              <FileDown className="h-4 w-4" />
              Download All as PDF
            </Button>
          </a>
        )}
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
                {dailyBriefs.map((article) => (
                    <Card
                      key={article.id}
                      className="border-blue-200/60 bg-blue-500/[0.02] hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                      data-testid={`published-card-${article.id}`}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("a") || target.closest("button")) return;
                        setSelectedRead(article);
                      }}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ArticleTypeBadge articleType="daily_brief" />
                              {article.discipline && (
                                <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                              )}
                              <div className="ml-auto flex flex-col items-end gap-0.5">
                                <span className="text-[11px] text-muted-foreground">
                                  <span className="font-medium">Generated:</span> {format(new Date(article.createdAt), "MMM d, yyyy")} — {format(new Date(article.createdAt), "HH:mm")}
                                  {" "}<span className="text-muted-foreground/50">({formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })})</span>
                                </span>
                                {article.publishedAt && (
                                  <span className="text-[10px] text-muted-foreground/55">
                                    <span className="font-medium">Approved:</span> {format(new Date(article.publishedAt), "MMM d, yyyy")} — {format(new Date(article.publishedAt), "HH:mm")}
                                  </span>
                                )}
                              </div>
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
                        <div className="pt-1">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-xs text-primary/70"
                            onClick={() => setSelectedRead(article)}
                          >
                            Read full brief
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
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
                {topicArticles.map((article) => (
                    <Card
                      key={article.id}
                      className="hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                      data-testid={`published-card-${article.id}`}
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("a") || target.closest("button")) return;
                        setSelectedRead(article);
                      }}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <ArticleTypeBadge articleType="topic_article" />
                              {article.discipline && (
                                <Badge variant="outline" className="text-xs">{article.discipline}</Badge>
                              )}
                              <div className="ml-auto flex flex-col items-end gap-0.5">
                                <span className="text-[11px] text-muted-foreground">
                                  <span className="font-medium">Generated:</span> {format(new Date(article.createdAt), "MMM d, yyyy")} — {format(new Date(article.createdAt), "HH:mm")}
                                  {" "}<span className="text-muted-foreground/50">({formatDistanceToNow(new Date(article.createdAt), { addSuffix: true })})</span>
                                </span>
                                {article.publishedAt && (
                                  <span className="text-[10px] text-muted-foreground/55">
                                    <span className="font-medium">Approved:</span> {format(new Date(article.publishedAt), "MMM d, yyyy")} — {format(new Date(article.publishedAt), "HH:mm")}
                                  </span>
                                )}
                              </div>
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
                        <div className="pt-1">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 h-auto text-xs text-primary/70"
                            onClick={() => setSelectedRead(article)}
                          >
                            Read full article
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
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
    </div>
  );
}
