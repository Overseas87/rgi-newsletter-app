import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  getGetCurrentStoryOpportunityWindowQueryKey,
  getGetStoryOpportunityQueryKey,
  useClearStoryOpportunityProfessor,
  useCloseStoryOpportunity,
  useGetStoryOpportunity,
  useReopenStoryOpportunity,
  useSelectStoryOpportunityProfessor,
  useUpdateStoryOpportunityAngle,
  type ProfessorMatch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  LockKeyhole,
  Pencil,
  RotateCcw,
  Save,
  XCircle,
} from "lucide-react";
import { ProfessorMatchCard } from "@/components/professor-match-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { userSafeErrorMessage } from "@/lib/api-error";

function eastern(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function scoreText(value: number): string {
  return String(Math.floor(value * 100) / 100);
}

export default function OpportunityDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const detail = useGetStoryOpportunity(id);
  const selectProfessor = useSelectStoryOpportunityProfessor({
    mutation: { retry: false },
  });
  const clearProfessor = useClearStoryOpportunityProfessor({
    mutation: { retry: false },
  });
  const updateAngle = useUpdateStoryOpportunityAngle({
    mutation: { retry: false },
  });
  const closeOpportunity = useCloseStoryOpportunity({
    mutation: { retry: false },
  });
  const reopenOpportunity = useReopenStoryOpportunity({
    mutation: { retry: false },
  });
  const opportunity = detail.data?.opportunity;
  const [selectionTarget, setSelectionTarget] = useState<ProfessorMatch | null>(
    null,
  );
  const [selectionReason, setSelectionReason] = useState("");
  const [angle, setAngle] = useState("");

  useEffect(() => {
    if (opportunity) setAngle(opportunity.recommendedAngle);
  }, [opportunity?.id, opportunity?.recommendedAngle]);

  const pending =
    selectProfessor.isPending ||
    clearProfessor.isPending ||
    updateAngle.isPending ||
    closeOpportunity.isPending ||
    reopenOpportunity.isPending;
  const selectable = useMemo(
    () =>
      opportunity?.professorMatches.filter(
        (match) => match.rank !== null && match.exclusions.length === 0,
      ) ?? [],
    [opportunity],
  );

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getGetStoryOpportunityQueryKey(id),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetCurrentStoryOpportunityWindowQueryKey(),
      }),
    ]);
  };

  const mutationError =
    (title: string, fallback: string) => (error: unknown) => {
      toast({
        title,
        description: userSafeErrorMessage(error, fallback),
        variant: "destructive",
      });
    };

  if (detail.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (detail.isError || !opportunity) {
    const status = Number(
      (detail.error as { status?: unknown } | null)?.status,
    );
    return (
      <div className="space-y-4 py-16 text-center">
        {status === 401 || status === 403 || status === 503 ? (
          <LockKeyhole className="mx-auto h-10 w-10 text-destructive/70" />
        ) : (
          <AlertCircle className="mx-auto h-10 w-10 text-destructive/70" />
        )}
        <div>
          <h1 className="text-xl font-semibold">
            {status === 404
              ? "Story Opportunity not found"
              : "Opportunity Workbench unavailable"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {status === 404
              ? "The frozen opportunity may no longer be available."
              : "Authorization, feature configuration, or the API connection may need attention."}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate("/opportunities")}>
            Back to opportunities
          </Button>
          <Button variant="outline" onClick={() => void detail.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const writesEnabled = detail.data?.writesEnabled === true;
  const closed = opportunity.workflowState === "closed";
  const needsReason = selectionTarget?.label === "weak";
  const angleDirty =
    angle.trim().replace(/\s+/g, " ") !== opportunity.recommendedAngle;

  const confirmSelection = () => {
    if (!selectionTarget) return;
    if (needsReason && !selectionReason.trim()) {
      toast({
        title: "Override reason required",
        description: "Explain why this weak match is the editorial choice.",
        variant: "destructive",
      });
      return;
    }
    selectProfessor.mutate(
      {
        id: opportunity.id,
        data: {
          professorId: selectionTarget.professorId,
          expectedRevision: opportunity.revision,
          ...(selectionReason.trim() ? { reason: selectionReason.trim() } : {}),
        },
      },
      {
        onSuccess: async () => {
          setSelectionTarget(null);
          setSelectionReason("");
          await refresh();
          toast({
            title: "Professor selected",
            description:
              "The selection is preserved. Intake and outreach are not included in Milestone 1.",
          });
        },
        onError: mutationError(
          "Selection failed",
          "The professor selection was not changed.",
        ),
      },
    );
  };

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/opportunities")}
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to Daily Opportunities
      </Button>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">#{opportunity.shortlistPosition}</Badge>
            <Badge variant="secondary">{opportunity.primaryTopicLabel}</Badge>
            <Badge>{opportunity.workflowState.replace("_", " ")}</Badge>
            {opportunity.timestampFallback ? (
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-50 text-amber-800"
              >
                Scraped-time fallback
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="font-serif text-3xl leading-tight">
                {opportunity.primaryEvidence.headline}
              </CardTitle>
              <p className="mt-2 text-sm text-muted-foreground">
                Frozen window {eastern(opportunity.windowStart)} –{" "}
                {eastern(opportunity.windowEnd)} ET
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border bg-slate-50 px-4 py-3">
                <p className="text-2xl font-semibold">
                  {scoreText(opportunity.normalizedRgiRelevanceScore)}
                </p>
                <p className="text-[10px] uppercase text-muted-foreground">
                  RGI relevance
                </p>
              </div>
              <div className="rounded-lg border px-4 py-3">
                <p className="text-2xl font-semibold">
                  {selectable[0] ? scoreText(selectable[0].totalFitScore) : "—"}
                </p>
                <p className="text-[10px] uppercase text-muted-foreground">
                  Top professor fit
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Why shortlisted
              </p>
              <p className="mt-1 text-sm">
                {opportunity.relevanceExplanation ||
                  "The canonical stored score met the frozen shortlist threshold."}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Original {opportunity.originalRgiRelevanceScore}/10 · normalized
                by {opportunity.relevanceNormalizationVersion} · source
                authority {opportunity.sourceAuthorityScore}
              </p>
            </div>
            <div>
              <Label htmlFor="recommended-angle">Recommended angle</Label>
              <Textarea
                id="recommended-angle"
                value={angle}
                onChange={(event) => setAngle(event.target.value)}
                disabled={!writesEnabled || closed || pending}
                maxLength={500}
              />
              <Button
                size="sm"
                className="mt-2"
                disabled={
                  !writesEnabled ||
                  closed ||
                  pending ||
                  !angleDirty ||
                  !angle.trim()
                }
                onClick={() =>
                  updateAngle.mutate(
                    {
                      id: opportunity.id,
                      data: { angle, expectedRevision: opportunity.revision },
                    },
                    {
                      onSuccess: async () => {
                        await refresh();
                        toast({ title: "Angle updated" });
                      },
                      onError: mutationError(
                        "Angle update failed",
                        "The recommended angle was not changed.",
                      ),
                    },
                  )
                }
              >
                <Save className="mr-2 h-4 w-4" />
                Save angle
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              Workflow state changes are validated by the server. Calculated
              rankings never change after selection.
            </p>
            {closed ? (
              <Button
                variant="outline"
                disabled={!writesEnabled || pending}
                onClick={() =>
                  reopenOpportunity.mutate(
                    {
                      id: opportunity.id,
                      data: { expectedRevision: opportunity.revision },
                    },
                    {
                      onSuccess: refresh,
                      onError: mutationError(
                        "Reopen failed",
                        "The opportunity remains closed.",
                      ),
                    },
                  )
                }
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reopen
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={!writesEnabled || pending}
                onClick={() =>
                  closeOpportunity.mutate(
                    {
                      id: opportunity.id,
                      data: { expectedRevision: opportunity.revision },
                    },
                    {
                      onSuccess: refresh,
                      onError: mutationError(
                        "Close failed",
                        "The opportunity remains open.",
                      ),
                    },
                  )
                }
              >
                <XCircle className="mr-2 h-4 w-4" />
                Close opportunity
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Evidence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium">
                  Primary source · {opportunity.primaryEvidence.sourceName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Effective publication:{" "}
                  {eastern(opportunity.primaryEvidence.effectivePublishedAt)} ET
                  · captured {eastern(opportunity.primaryEvidence.capturedAt)}{" "}
                  ET
                </p>
                {opportunity.primaryEvidence.timestampFallback ? (
                  <p className="mt-1 text-xs font-medium text-amber-700">
                    publishedAt was unavailable; the frozen snapshot used
                    scrapedAt.
                  </p>
                ) : null}
              </div>
              {opportunity.primaryEvidence.canonicalUrl ? (
                <Button asChild variant="outline" size="sm">
                  <a
                    href={opportunity.primaryEvidence.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open original <ExternalLink className="ml-2 h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Original unavailable
                </Button>
              )}
            </div>
            {opportunity.primaryEvidence.excerpt ? (
              <blockquote className="mt-4 border-l-2 pl-3 text-sm text-muted-foreground">
                {opportunity.primaryEvidence.excerpt}
              </blockquote>
            ) : null}
            <p className="mt-3 break-all font-mono text-[10px] text-muted-foreground">
              Evidence hash: {opportunity.primaryEvidence.contentHash}
            </p>
          </div>
          {opportunity.supportingEvidence.length ? (
            opportunity.supportingEvidence.map((evidence) => (
              <div
                key={evidence.articleId}
                className="rounded-md border p-3 text-sm"
              >
                Supporting evidence: {evidence.headline}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No editor-confirmed supporting articles. Milestone 1 does not
              merge related stories automatically.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Professor Matches</h2>
            <p className="text-sm text-muted-foreground">
              Deterministic Professor Fit is separate from RGI relevance. The
              editor always selects manually.
            </p>
          </div>
          {opportunity.selectedProfessor ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Selected:{" "}
              <strong>{opportunity.selectedProfessor.professorName}</strong>
            </div>
          ) : null}
        </div>

        {selectionTarget ? (
          <Card
            className="border-blue-300"
            data-testid="professor-selection-confirmation"
          >
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="font-semibold">
                  Select {selectionTarget.professorName}?
                </p>
                <p className="text-sm text-muted-foreground">
                  Fit {scoreText(selectionTarget.totalFitScore)}/100 · rank #
                  {selectionTarget.rank}.{" "}
                  {needsReason
                    ? "This weak match requires an override reason."
                    : selectionTarget.rank !== 1
                      ? "A reason is optional for this lower-ranked plausible or strong match."
                      : "No override reason is required."}
                </p>
              </div>
              <div>
                <Label htmlFor="selection-reason">
                  Editor selection reason{" "}
                  {needsReason ? "(required)" : "(optional)"}
                </Label>
                <Textarea
                  id="selection-reason"
                  value={selectionReason}
                  onChange={(event) => setSelectionReason(event.target.value)}
                  maxLength={1000}
                  data-testid="selection-override-reason"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelectionTarget(null);
                    setSelectionReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={confirmSelection}
                  disabled={pending || (needsReason && !selectionReason.trim())}
                  data-testid="confirm-professor-selection"
                >
                  Confirm manual selection
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {opportunity.professorMatches.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center">
              <p className="font-medium">
                No Professor Profiles were available
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The story remains shortlisted, but no fit scores could be
                calculated for this frozen snapshot.
              </p>
              <Button asChild variant="outline" className="mt-3">
                <Link href="/professors">Open Professor Library</Link>
              </Button>
            </CardContent>
          </Card>
        ) : selectable.length === 0 ? (
          <Card className="border-red-200 bg-red-50/40">
            <CardContent className="py-10 text-center">
              <p className="font-medium text-red-900">
                All evaluated professors are hard-excluded
              </p>
              <p className="mt-1 text-sm text-red-800">
                An ordinary selection override cannot bypass a hard exclusion.
                An authorized editor must correct the approved profile first.
              </p>
              <Button asChild variant="outline" className="mt-3">
                <Link href="/professors">Open Professor Library</Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {opportunity.professorMatches.map((match) => (
          <ProfessorMatchCard
            key={match.professorId}
            match={match}
            selected={
              opportunity.selectedProfessor?.professorId === match.professorId
            }
            disabled={!writesEnabled || closed}
            pending={pending}
            onSelect={() => {
              setSelectionTarget(match);
              setSelectionReason("");
            }}
          />
        ))}

        {opportunity.selectedProfessor ? (
          <Button
            variant="outline"
            disabled={!writesEnabled || closed || pending}
            onClick={() =>
              clearProfessor.mutate(
                {
                  id: opportunity.id,
                  data: { expectedRevision: opportunity.revision },
                },
                {
                  onSuccess: async () => {
                    await refresh();
                    toast({
                      title: "Professor selection cleared",
                      description:
                        "The opportunity returned to shortlisted; selection history was preserved.",
                    });
                  },
                  onError: mutationError(
                    "Clear failed",
                    "The professor selection was not changed.",
                  ),
                },
              )
            }
          >
            Clear professor selection
          </Button>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Selection History</CardTitle>
        </CardHeader>
        <CardContent>
          {opportunity.selectionHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No professor has been selected. Matching recommendations do not
              assign anyone automatically.
            </p>
          ) : (
            <ol className="space-y-3">
              {[...opportunity.selectionHistory].reverse().map((entry) => (
                <li key={entry.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium capitalize">
                      {entry.action}:{" "}
                      {entry.professorName ?? "selection cleared"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {eastern(entry.occurredAt)} ET
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Actor: {entry.actorId} · profile revision{" "}
                    {entry.selectedProfileRevision ?? "n/a"}
                  </p>
                  {entry.reason ? (
                    <p className="mt-2">Reason: {entry.reason}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {!writesEnabled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <Pencil className="mr-2 inline h-4 w-4" />
          Story Opportunity writes are disabled. This workbench is read-only.
        </div>
      ) : null}
    </div>
  );
}
