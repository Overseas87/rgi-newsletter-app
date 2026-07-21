import type { ProfessorMatch } from "@workspace/api-client-react";
import { AlertTriangle, Ban, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

function labelClass(label: ProfessorMatch["label"]): string {
  if (label === "strong")
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (label === "plausible") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function scoreText(value: number): string {
  return String(Math.floor(value * 100) / 100);
}

export function ProfessorMatchCard({
  match,
  selected,
  disabled,
  pending,
  onSelect,
}: {
  match: ProfessorMatch;
  selected: boolean;
  disabled: boolean;
  pending: boolean;
  onSelect: () => void;
}) {
  const excluded = match.exclusions.length > 0;
  return (
    <Card
      className={selected ? "border-emerald-400 ring-1 ring-emerald-200" : ""}
      data-testid={`professor-match-${match.professorId}`}
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{match.professorName}</h3>
              {match.rank !== null ? (
                <Badge variant="outline">Rank #{match.rank}</Badge>
              ) : (
                <Badge variant="outline">
                  <Ban className="mr-1 h-3 w-3" />
                  Excluded
                </Badge>
              )}
              <span
                className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${labelClass(match.label)}`}
              >
                {match.label}
              </span>
              {selected ? (
                <Badge className="bg-emerald-700">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Selected
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {match.rationale}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 text-center">
            <div className="rounded-md border p-2">
              <p className="text-xl font-semibold">
                {scoreText(match.totalFitScore)}
              </p>
              <p className="text-[10px] uppercase text-muted-foreground">
                Professor fit
              </p>
            </div>
            <div className="rounded-md border p-2">
              <p className="text-xl font-semibold">
                {scoreText(match.profileCoverage)}%
              </p>
              <p className="text-[10px] uppercase text-muted-foreground">
                Profile coverage
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          {match.dimensions.map((dimension) => (
            <div
              key={dimension.dimension}
              className="grid gap-1 text-xs md:grid-cols-[220px_1fr_70px] md:items-center"
            >
              <span className="font-medium">{dimension.label}</span>
              <div>
                <Progress value={dimension.dimensionScore} className="h-1.5" />
                {dimension.matchType !== "none" ? (
                  <p className="mt-1 text-muted-foreground">
                    {dimension.matchType.replace("_", "/")}: “
                    {dimension.professorValue}” via {dimension.professorField}{" "}
                    matched “
                    {dimension.opportunityLabel ?? dimension.opportunityConcept}
                    ”
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    No approved match
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  Weight {dimension.weight}% · contribution{" "}
                  {scoreText(dimension.weightedContribution)} points
                </p>
              </div>
              <span className="text-right font-mono">
                {scoreText(dimension.dimensionScore)}/100
              </span>
            </div>
          ))}
        </div>

        {match.warnings.length ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="mb-1 flex items-center gap-1 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5" />
              Warnings
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {match.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {match.exclusions.length ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <p className="mb-1 flex items-center gap-1 font-semibold">
              <Ban className="h-3.5 w-3.5" />
              Hard exclusion
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {match.exclusions.map((exclusion) => (
                <li key={exclusion}>{exclusion}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-t pt-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            Missing profile dimensions:{" "}
            {match.missingDimensions.length
              ? match.missingDimensions.join(", ").replaceAll("_", " ")
              : "none"}
          </span>
          <Button
            size="sm"
            disabled={disabled || excluded || pending || selected}
            onClick={onSelect}
            data-testid={`select-professor-${match.professorId}`}
          >
            {selected
              ? "Selected"
              : excluded
                ? "Not selectable"
                : "Select professor"}
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Version details</summary>
          <p className="mt-2">
            Profile revision {match.profileRevision} · taxonomy{" "}
            {match.taxonomyVersion} · algorithm {match.matchingAlgorithmVersion}{" "}
            · coverage {match.coverageCalculationVersion}
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
