import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Article } from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";
import { ExternalLink, Zap, Twitter, Linkedin, Newspaper, BookOpen, Building2, TrendingUp, Globe, ChevronDown, ChevronUp, Compass, Shield, Cpu, Loader2, Radio, ShieldCheck, ShieldAlert, ShieldQuestion } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface ArticleCardProps {
  article: Article;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
  onTopicClick?: (topic: string) => void;
}

export function getScoreColor(score: number) {
  if (score >= 9) return "bg-amber-50 text-amber-700 border-amber-300";
  if (score >= 7.5) return "bg-blue-50 text-blue-700 border-blue-200";
  if (score >= 6) return "bg-slate-100 text-slate-600 border-slate-300";
  return "bg-muted text-muted-foreground border-border";
}

function AuthenticityBadge({ score }: { score?: number | null }) {
  if (score == null) return null;
  let icon: React.ReactNode;
  let cls: string;
  let label: string;
  if (score >= 8) {
    icon = <ShieldCheck className="h-2.5 w-2.5" />;
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
    label = `Auth ${score.toFixed(1)}`;
  } else if (score >= 5.5) {
    icon = <ShieldQuestion className="h-2.5 w-2.5" />;
    cls = "bg-slate-100 text-slate-600 border-slate-300";
    label = `Auth ${score.toFixed(1)}`;
  } else {
    icon = <ShieldAlert className="h-2.5 w-2.5" />;
    cls = "bg-orange-50 text-orange-700 border-orange-200";
    label = `Auth ${score.toFixed(1)}`;
  }
  return (
    <span title={`Authenticity / Credibility: ${score}/10`} className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums ${cls}`}>
      {icon}{label}
    </span>
  );
}

const DISCIPLINE_COLORS: Record<string, string> = {
  "Strategic Foresight": "text-blue-700",
  "System Vitality": "text-amber-700",
  "Civic Stewardship": "text-emerald-700",
  "Multiple": "text-violet-700",
};

function DisciplineIcon({ discipline }: { discipline?: string | null }) {
  if (discipline === "Strategic Foresight") return <Compass className="h-3 w-3" />;
  if (discipline === "System Vitality") return <Zap className="h-3 w-3" />;
  if (discipline === "Civic Stewardship") return <Shield className="h-3 w-3" />;
  return <Cpu className="h-3 w-3" />;
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
  if (platform === "institutional") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
        <BookOpen className="h-2.5 w-2.5" />Institutional
      </span>
    );
  }
  if (platform === "corporate") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
        <Building2 className="h-2.5 w-2.5" />Corporate
      </span>
    );
  }
  if (platform === "market") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
        <TrendingUp className="h-2.5 w-2.5" />Market
      </span>
    );
  }
  if (platform === "website") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
        <Globe className="h-2.5 w-2.5" />Web
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
      <Newspaper className="h-2.5 w-2.5" />News
    </span>
  );
}

function RgiExplanationPanel({ articleId, discipline }: { articleId: number; discipline?: string | null }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (explanation) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}/explain`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setExplanation(data.explanation);
    } catch {
      setError("Unable to generate explanation. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const disciplineColor = DISCIPLINE_COLORS[discipline ?? ""] ?? "text-primary";

  return (
    <div className="ml-7 mt-1">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 text-[11px] font-medium text-primary/60 hover:text-primary/90 transition-colors group"
        data-testid={`btn-explain-${articleId}`}
      >
        <DisciplineIcon discipline={discipline} />
        <span>Why this matters to RGI</span>
        {open ? <ChevronUp className="h-3 w-3 opacity-60" /> : <ChevronDown className="h-3 w-3 opacity-60" />}
      </button>

      {open && (
        <div className="mt-2 p-3 rounded-lg border border-primary/15 bg-primary/5 space-y-1">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing through the RGI lens...
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          {explanation && (
            <>
              {discipline && (
                <p className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 ${disciplineColor}`}>
                  {discipline}
                </p>
              )}
              <p className="text-xs text-foreground/80 leading-relaxed">{explanation}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ArticleCard({ article, selectable, selected, onSelect, onTopicClick }: ArticleCardProps) {
  const publishTime = article.publishedAt || article.scrapedAt;
  const showExplain = article.relevancyScore >= 6.5;

  return (
    <Card
      className={`transition-all cursor-default ${
        selected ? "border-primary shadow-sm shadow-primary/10" : ""
      } ${article.isPrimarySignal ? "border-violet-500/40 bg-violet-500/[0.02]" : article.isEmergingSignal ? "border-amber-500/30" : ""}`}
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
              <span className="text-xs text-muted-foreground" title={format(new Date(publishTime), "MMMM d, yyyy 'at' h:mm a")}>
                {format(new Date(publishTime), "MMM d, yyyy")}
                <span className="text-muted-foreground/50"> — </span>
                {format(new Date(publishTime), "h:mm a")}
                <span className="text-muted-foreground/50"> · </span>
                {formatDistanceToNow(new Date(publishTime), { addSuffix: true })}
              </span>
              <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
                {article.isPrimarySignal && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 uppercase tracking-wide">
                    <Radio className="h-2.5 w-2.5" />Primary Signal
                  </span>
                )}
                {article.isEmergingSignal && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-300 uppercase tracking-wide">
                    <Zap className="h-2.5 w-2.5" />Signal
                  </span>
                )}
                <AuthenticityBadge score={article.authenticityScore} />
                <Badge variant="outline" className={`text-xs font-bold tabular-nums ${getScoreColor(article.relevancyScore)}`}>
                  {article.relevancyScore.toFixed(1)}<span className="font-normal opacity-60"> Rel</span>
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
          </div>
        </div>
      </CardHeader>

      {(article.teaserSummary || article.content || article.viewpoint) && (
        <CardContent className="px-4 pb-2 space-y-1.5">
          {(article.teaserSummary || article.content) && (
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 ml-7">
              {article.teaserSummary || article.content?.substring(0, 200)}
            </p>
          )}
          {article.viewpoint && (
            <div className="ml-7 flex items-start gap-1.5 text-[11px] leading-snug border-l-2 border-primary/25 pl-2.5 py-0.5">
              <span className="text-foreground/75 leading-relaxed">{article.viewpoint}</span>
            </div>
          )}
        </CardContent>
      )}

      {/* Topic tags */}
      {article.topicTags && article.topicTags.length > 0 && (
        <CardFooter className="px-4 pb-2 pt-0 flex flex-wrap gap-1 ml-7">
          {article.topicTags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className={`text-[10px] font-normal h-5 ${onTopicClick ? "cursor-pointer hover:bg-primary/20 hover:text-primary transition-colors" : ""}`}
              onClick={onTopicClick ? () => onTopicClick(tag) : undefined}
            >
              {tag}
            </Badge>
          ))}
        </CardFooter>
      )}

      {/* RGI explanation panel */}
      {showExplain && (
        <div className="px-4 pb-3">
          <RgiExplanationPanel articleId={article.id} discipline={article.disciplineAlignment} />
        </div>
      )}
    </Card>
  );
}
