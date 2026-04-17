import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Article } from "@workspace/api-client-react";
import { format } from "date-fns";
import { ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

interface ArticleCardProps {
  article: Article;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (checked: boolean) => void;
}

export function getScoreColor(score: number) {
  if (score >= 9) return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
  if (score >= 7) return "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20";
  return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
}

export function ArticleCard({ article, selectable, selected, onSelect }: ArticleCardProps) {
  return (
    <Card className={`transition-all ${selected ? 'border-primary shadow-sm' : ''}`}>
      <CardHeader className="pb-3 flex flex-row items-start space-y-0 gap-4">
        {selectable && (
          <div className="pt-1">
            <Checkbox 
              checked={selected} 
              onCheckedChange={onSelect}
              data-testid={`checkbox-article-${article.id}`}
            />
          </div>
        )}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {article.sourceName}
              </span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(article.publishedAt || article.scrapedAt), "MMM d, yyyy")}
              </span>
            </div>
            <Badge variant="outline" className={getScoreColor(article.relevancyScore)}>
              Score: {article.relevancyScore}
            </Badge>
          </div>
          <CardTitle className="text-lg leading-tight">
            <a 
              href={article.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:underline flex items-start gap-1.5 group"
              data-testid={`link-article-${article.id}`}
            >
              {article.headline}
              <ExternalLink className="h-3 w-3 mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
            </a>
          </CardTitle>
          {article.disciplineAlignment && (
            <CardDescription className="text-xs font-medium text-primary/80">
              Alignment: {article.disciplineAlignment}
            </CardDescription>
          )}
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground leading-relaxed">
        <p className="line-clamp-3">{article.teaserSummary || article.content?.substring(0, 200) + '...'}</p>
      </CardContent>
      {article.topicTags && article.topicTags.length > 0 && (
        <CardFooter className="pt-0 flex flex-wrap gap-1.5">
          {article.topicTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs font-normal">
              {tag}
            </Badge>
          ))}
        </CardFooter>
      )}
    </Card>
  );
}
