import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  getGetCurrentStoryOpportunityWindowQueryKey,
  useCalculateStoryOpportunityWindow,
  useGetCurrentStoryOpportunityWindow,
  useGetStoryOpportunityConfig,
  type StoryOpportunity,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CalendarClock,
  Filter,
  LockKeyhole,
  RefreshCw,
  Snowflake,
} from "lucide-react";
import { OpportunityCard } from "@/components/opportunity-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { userSafeErrorMessage } from "@/lib/api-error";

type StateFilter = "all" | StoryOpportunity["workflowState"];

function eastern(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function defaultAsOf(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function errorStatus(error: unknown): number | null {
  const value =
    typeof error === "object" && error !== null
      ? Number((error as { status?: unknown }).status)
      : Number.NaN;
  return Number.isInteger(value) ? value : null;
}

function errorCode(error: unknown): string | null {
  const value =
    typeof error === "object" && error !== null
      ? (error as { data?: { code?: unknown } }).data?.code
      : null;
  return typeof value === "string" ? value : null;
}

export default function Opportunities() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [asOf, setAsOf] = useState(defaultAsOf);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const current = useGetCurrentStoryOpportunityWindow();
  const config = useGetStoryOpportunityConfig();
  const calculate = useCalculateStoryOpportunityWindow({
    mutation: { retry: false },
  });
  const items = current.data?.items ?? [];
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((opportunity) => {
      if (stateFilter !== "all" && opportunity.workflowState !== stateFilter)
        return false;
      if (!query) return true;
      return [
        opportunity.primaryEvidence.headline,
        opportunity.sourceName,
        opportunity.primaryTopicLabel,
        opportunity.recommendedAngle,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [items, search, stateFilter]);

  const calculateWindow = () => {
    const date = new Date(asOf);
    if (!Number.isFinite(date.getTime())) {
      toast({
        title: "Invalid calculation time",
        description: "Choose a valid as-of date and time.",
        variant: "destructive",
      });
      return;
    }
    calculate.mutate(
      { data: { asOf: date.toISOString() } },
      {
        onSuccess: async (result) => {
          await queryClient.invalidateQueries({
            queryKey: getGetCurrentStoryOpportunityWindowQueryKey(),
          });
          toast({
            title: result.created
              ? "Frozen opportunity window created"
              : "Existing frozen window loaded",
            description: `${result.opportunities.length} opportunities in the snapshot.`,
          });
        },
        onError: (error) =>
          toast({
            title: "Window calculation failed",
            description: userSafeErrorMessage(
              error,
              "The frozen window could not be calculated.",
            ),
            variant: "destructive",
          }),
      },
    );
  };

  if (current.isLoading || config.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-28 w-full" />
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-72 w-full" />
        ))}
      </div>
    );
  }

  if (current.isError || config.isError) {
    const loadError = current.error ?? config.error;
    const status = errorStatus(loadError);
    const code = errorCode(loadError);
    const title =
      status === 401
        ? "Internal editor authorization required"
        : code === "STORY_OPPORTUNITIES_READS_DISABLED"
          ? "Daily Opportunities reads are disabled"
          : status === 503 && code === "INTERNAL_EDITOR_AUTH_UNCONFIGURED"
            ? "Internal editor authorization is not configured"
            : "Daily Opportunities are unavailable";
    const explanation =
      status === 401
        ? "Provide a valid internal-editor credential before opening this protected workflow."
        : code === "STORY_OPPORTUNITIES_READS_DISABLED"
          ? "An operator must explicitly enable protected Story Opportunity reads for this environment."
          : "Authorization, feature configuration, or the API connection may need attention.";
    return (
      <div className="space-y-4 py-16 text-center">
        <LockKeyhole className="mx-auto h-10 w-10 text-destructive/70" />
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{explanation}</p>
        </div>
        <p className="mx-auto max-w-xl text-xs text-muted-foreground">
          {userSafeErrorMessage(
            loadError,
            "The internal opportunity workflow could not be loaded.",
          )}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void current.refetch();
            void config.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  const window = current.data?.window;
  const writesEnabled =
    config.data?.writesEnabled === true && current.data?.writesEnabled === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Snowflake className="h-5 w-5 text-blue-700" />
            <span className="text-xs font-semibold uppercase tracking-widest text-blue-700">
              Frozen editorial snapshot
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-serif tracking-tight">
            Daily Story Opportunities
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Up to 15 high-relevance stories, ranked independently from
            transparent Professor Fit.
          </p>
        </div>
        <Card className="w-full xl:max-w-xl">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="opportunity-as-of"
                className="text-xs font-medium"
              >
                Calculate selected as-of time
              </label>
              <Input
                id="opportunity-as-of"
                type="datetime-local"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                disabled={!writesEnabled || calculate.isPending}
              />
            </div>
            <Button
              onClick={calculateWindow}
              disabled={!writesEnabled || calculate.isPending}
              data-testid="calculate-opportunity-window"
            >
              <CalendarClock className="mr-2 h-4 w-4" />
              {calculate.isPending ? "Calculating…" : "Calculate window"}
            </Button>
          </CardContent>
          {!writesEnabled ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Calculation and selection writes are disabled in this environment.
              Existing frozen snapshots remain read-only.
            </p>
          ) : null}
        </Card>
      </div>

      {!window ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <CalendarClock className="mx-auto h-10 w-10 text-muted-foreground/60" />
            <h2 className="mt-3 font-semibold">
              No calculated opportunity window
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              An authorized editor can explicitly calculate a selected as-of
              window when Story Opportunity writes are enabled. Calculation
              never triggers scraping.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/feed">Review the live Intelligence Feed</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card
            className="border-blue-200 bg-blue-50/40"
            data-testid="frozen-window-summary"
          >
            <CardContent className="grid gap-4 p-4 md:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Window · {window.status}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {eastern(window.windowStart)} – {eastern(window.windowEnd)} ET
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Policy
                </p>
                <p className="mt-1 text-sm font-medium">
                  ≥ {window.minimumNormalizedRelevance}/100 · max{" "}
                  {window.maximumOpportunities}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Shortlist
                </p>
                <p className="mt-1 text-sm font-medium">
                  {window.opportunityCount}{" "}
                  {window.opportunityCount < 15
                    ? "qualifying stories (not padded)"
                    : "opportunities"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Versions
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {window.selectionAlgorithmVersion}
                  <br />
                  {window.taxonomyVersion}
                </p>
              </div>
            </CardContent>
          </Card>

          {items.length > 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Filter className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Filter headline, source, topic, or angle"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Select
                value={stateFilter}
                onValueChange={(value) => setStateFilter(value as StateFilter)}
              >
                <SelectTrigger className="sm:w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflow states</SelectItem>
                  <SelectItem value="shortlisted">Shortlisted</SelectItem>
                  <SelectItem value="professor_selected">
                    Professor selected
                  </SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {items.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <AlertCircle className="mx-auto h-9 w-9 text-muted-foreground/60" />
                <h2 className="mt-3 font-semibold">No stories qualified</h2>
                <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                  This is a valid frozen window. No article met the 60/100
                  relevance threshold after source and primary-topic diversity
                  rules; the list was not padded.
                </p>
              </CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No opportunities match the current search or workflow-state
                filter.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {filtered.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
