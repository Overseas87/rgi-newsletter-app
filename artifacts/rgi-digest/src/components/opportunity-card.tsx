import { Link } from "wouter";
import type { StoryOpportunity } from "@workspace/api-client-react";
import { AlertTriangle, ArrowRight, Clock3, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function easternTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function stateLabel(state: StoryOpportunity["workflowState"]): string {
  if (state === "professor_selected") return "Professor selected";
  if (state === "closed") return "Closed";
  return "Shortlisted";
}

function scoreText(value: number): string {
  return String(Math.floor(value * 100) / 100);
}

export function OpportunityCard({
  opportunity,
}: {
  opportunity: StoryOpportunity;
}) {
  const selectableMatches = opportunity.professorMatches.filter(
    (match) => match.rank !== null,
  );
  const topMatches = selectableMatches.slice(0, 3);
  const hasStrongMatch = topMatches.some((match) => match.label === "strong");

  return (
    <Card data-testid={`opportunity-card-${opportunity.id}`}>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">#{opportunity.shortlistPosition}</Badge>
              <Badge variant="secondary">{opportunity.primaryTopicLabel}</Badge>
              <Badge
                variant={
                  opportunity.workflowState === "closed" ? "outline" : "default"
                }
              >
                {stateLabel(opportunity.workflowState)}
              </Badge>
              {opportunity.timestampFallback ? (
                <Badge
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-800"
                  data-testid={`timestamp-fallback-${opportunity.id}`}
                >
                  Scraped-time fallback
                </Badge>
              ) : null}
            </div>
            <h2 className="font-serif text-xl leading-snug text-foreground">
              {opportunity.primaryEvidence.headline}
            </h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{opportunity.sourceName}</span>
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3 w-3" />
                {easternTime(opportunity.effectivePublishedAt)}
              </span>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-center">
            <div
              className="rounded-lg border bg-slate-50 px-4 py-3"
              data-testid={`rgi-relevance-${opportunity.id}`}
            >
              <p className="text-2xl font-semibold text-slate-900">
                {scoreText(opportunity.normalizedRgiRelevanceScore)}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                RGI relevance
              </p>
            </div>
            <div className="rounded-lg border bg-white px-4 py-3">
              <p className="text-2xl font-semibold text-slate-900">
                {topMatches[0] ? scoreText(topMatches[0].totalFitScore) : "—"}
              </p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Top professor fit
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border bg-slate-50/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Why shortlisted
            </p>
            <p className="mt-1 text-sm text-foreground">
              {opportunity.relevanceExplanation ||
                "The stored RGI relevance score met the frozen shortlist policy."}
            </p>
          </div>
          <div className="rounded-md border bg-slate-50/60 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Recommended angle
            </p>
            <p className="mt-1 text-sm text-foreground">
              {opportunity.recommendedAngle}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {opportunity.professorMatches.length === 0 ? (
              <p className="inline-flex items-center gap-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                No Professor Profiles were available for this frozen window.
              </p>
            ) : topMatches.length === 0 ? (
              <p className="inline-flex items-center gap-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                All evaluated professors are excluded.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                {topMatches.map((match) => (
                  <span
                    key={match.professorId}
                    className="rounded-full border px-2 py-1"
                  >
                    {match.professorName} · {scoreText(match.totalFitScore)} (
                    {match.label})
                  </span>
                ))}
                {!hasStrongMatch ? (
                  <span className="text-xs text-amber-700">
                    No strong match
                  </span>
                ) : null}
              </div>
            )}
          </div>
          <Button asChild variant="outline" size="sm">
            <Link
              href={`/opportunities/${opportunity.id}`}
              data-testid={`open-opportunity-${opportunity.id}`}
            >
              Open opportunity <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
