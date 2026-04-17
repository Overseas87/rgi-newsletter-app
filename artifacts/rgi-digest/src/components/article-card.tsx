import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Article } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ExternalLink, Zap, Twitter, Linkedin, Newspaper } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface ArticleCardProps {
  article: Article;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}

export function getScoreColor(score: number) {
  if (score >= 9) return "bg-red-500/10 text-red-500 border-red-500/30";
  if (score >= 7.5) return "bg-orange-500/10 text-orange-400 border-orange-500/30";
  if (score >= 6) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function PlatformBadge({ platform }: { platform?: string | null }) {
  if (platform === "twitter") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
        <Twitter className="h-2.5 w-2.5" />X
      </span>
    );
  }
  if (platform === "linkedin") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-600/10 text-blue-400 border border-blue-600/20">
        <Linkedin className="h-2.5 w-2.5" />LinkedIn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      <Newspaper className="h-2.5 w-2.5" />News
    </span>
  );
}

export function ArticleCard({ article, selectable, selected, onSelect }: ArticleCardProps) {
  const publishTime = article.publishedAt || article.scrapedAt;

  return (
    <Card
      className={`transition-all cursor-default ${
        selected ? "border-primary shadow-sm shadow-primary/10" : ""
      } ${article.isEmergingSignal ? "border-amber-500/30" : ""}`}
      data-testid={`article-card-${article.id}`}
    >
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-3">
          {selectable && (
            <div className="pt-0.5 shrink-0">
              <Checkbox
                checked={selected}
                onCheckedChange={onSelect}
                data-testid={`checkbox-article-${article.id}`}
              />
            </div>
          )}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Top meta row */}
            <div className="flex items-center gap-2 flex-wrap">
              <PlatformBadge platform={article.platform} />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {article.sourceName}
              </span>
              {article.author && (
                <>
                  <span className="text-muted-foreground/40 text-xs">·</span>
                  <span className="text-xs text-muted-foreground">{article.author}</span>
                  {article.authorType && (
                    <span className="text-[10px] text-muted-foreground/60 italic">{article.authorType}</span>
                  )}
                </>
              )}
              <span className="text-muted-foreground/40 text-xs">·</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(publishTime), "MMM d, h:mm a")}
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                {article.isEmergingSignal && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wide">
                    <Zap className="h-2.5 w-2.5" />Signal
                  </span>
                )}
                <Badge variant="outline" className={`text-xs ${getScoreColor(article.relevancyScore)}`}>
                  {article.relevancyScore.toFixed(1)}
                </Badge>
              </div>
            </div>

            {/* Headline */}
            <CardTitle className="text-base leading-snug font-semibold">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors flex items-start gap-1.5 group"
                data-testid={`link-article-${article.id}`}
              >
                {article.headline}
                <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground" />
              </a>
            </CardTitle>

            {/* Discipline alignment */}
            {article.disciplineAlignment && (
              <p className="text-xs font-medium text-primary/70">
                {article.disciplineAlignment}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      {(article.teaserSummary || article.content) && (
        <CardContent className="px-4 pb-2">
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 ml-7">
            {article.teaserSummary || article.content?.substring(0, 200)}
          </p>
        </CardContent>
      )}

      {article.topicTags && article.topicTags.length > 0 && (
        <CardFooter className="px-4 pb-3 pt-0 flex flex-wrap gap-1 ml-7">
          {article.topicTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] font-normal h-5">
              {tag}
            </Badge>
          ))}
        </CardFooter>
      )}
    </Card>
  );
}
