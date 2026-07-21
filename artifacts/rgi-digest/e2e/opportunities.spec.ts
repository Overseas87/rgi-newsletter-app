import { expect, test, type Page, type Route } from "@playwright/test";

const calculatedAt = "2026-07-20T12:00:00.000Z";
const windowSnapshot = {
  id: "window_20260720T100000000Z_story-opportunities-v1_r1",
  snapshotRevision: 1,
  asOf: "2026-07-20T15:00:00.000Z",
  windowStart: "2026-07-19T10:00:00.000Z",
  windowEnd: "2026-07-20T10:00:00.000Z",
  operationalTimezone: "America/New_York",
  localCutoff: "06:00",
  calculatedAt,
  status: "completed",
  configurationVersion: "story-opportunities-v1",
  windowAlgorithmVersion: "eastern-cutoff-24h-v1",
  selectionAlgorithmVersion: "rgi-shortlist-diversity-v1",
  scoringVersion: "stored-canonical-rgi-relevance",
  normalizationVersion: "stored-relevancy-1-to-10-x10-v1",
  taxonomyVersion: "rgi-story-topics-v1",
  matchingAlgorithmVersion: "deterministic-six-dimension-v1",
  coverageCalculationVersion: "weighted-dimension-presence-v1",
  minimumNormalizedRelevance: 60,
  maximumOpportunities: 15,
  maximumPerSource: 2,
  maximumPerPrimaryTopic: 3,
  lowCoverageWarningThreshold: 50,
  totalArticlesConsidered: 42,
  eligibleArticleCount: 30,
  qualifyingArticleCount: 12,
  opportunityCount: 2,
  fallbackTimestampCount: 1,
};

const dimensionNames = [
  ["core_expertise", "Core expertise", 30],
  ["research_and_teaching", "Research interests and teaching", 15],
  [
    "experience_and_industries",
    "Professional/academic experience and industries",
    15,
  ],
  ["topic_interests", "Topic interests and contactable topics", 15],
  [
    "publications_and_themes",
    "Past-publication topics and recurring themes",
    15,
  ],
  ["regions_and_affiliations", "Regions and affiliations", 10],
] as const;

function professorMatch(
  id: string,
  name: string,
  score: number,
  rank: number | null,
  label: "strong" | "plausible" | "weak",
  excluded = false,
) {
  const dimensionScore = score >= 70 ? 80 : score >= 50 ? 50 : 0;
  return {
    professorId: id,
    professorName: name,
    profileRevision: 2,
    rank,
    totalFitScore: score,
    label,
    dimensions: dimensionNames.map(
      ([dimension, dimensionLabel, weight], index) => ({
        dimension,
        label: dimensionLabel,
        weight,
        dimensionScore:
          index === 0
            ? score >= 70
              ? 100
              : score >= 50
                ? 80
                : score > 0
                  ? 100
                  : 0
            : dimensionScore,
        weightedContribution: index === 0 ? Math.min(30, score) : 0,
        matchType: index === 0 ? "exact" : dimensionScore ? "alias" : "none",
        opportunityConcept:
          dimensionScore || index === 0 ? "leadership-organizations" : null,
        opportunityLabel:
          dimensionScore || index === 0 ? "Leadership & Organizations" : null,
        professorField:
          dimensionScore || index === 0
            ? index === 0
              ? "expertiseTags"
              : dimension
            : null,
        professorValue:
          dimensionScore || index === 0 ? "Leadership & Organizations" : null,
      }),
    ),
    profileCoverage: score >= 50 ? 85 : 30,
    coveredDimensions:
      score >= 50
        ? dimensionNames.slice(0, 5).map(([key]) => key)
        : ["core_expertise"],
    missingDimensions:
      score >= 50
        ? ["regions_and_affiliations"]
        : dimensionNames.slice(1).map(([key]) => key),
    taxonomyVersion: "rgi-story-topics-v1",
    matchingAlgorithmVersion: "deterministic-six-dimension-v1",
    coverageCalculationVersion: "weighted-dimension-presence-v1",
    exclusions: excluded ? ["Hard restricted topic: leadership."] : [],
    warnings:
      label === "weak"
        ? [
            "Weak professor fit: selection requires an editor override reason.",
            "Low profile coverage: 30% is below the 50% review threshold.",
          ]
        : [],
    rationale: `${label[0].toUpperCase()}${label.slice(1)} match (${score}/100). Core expertise matched approved leadership evidence.`,
  };
}

const matches = [
  professorMatch("prof_alpha_01", "Professor Alpha", 82, 1, "strong"),
  professorMatch("prof_beta_001", "Professor Beta", 61, 2, "plausible"),
  professorMatch("prof_gamma_01", "Professor Gamma", 30, 3, "weak"),
  professorMatch("prof_delta_01", "Professor Delta", 75, null, "strong", true),
];

function opportunity(id: string, position: number, fallback = false) {
  return {
    id,
    revision: 1,
    windowId: windowSnapshot.id,
    windowStart: windowSnapshot.windowStart,
    windowEnd: windowSnapshot.windowEnd,
    operationalTimezone: "America/New_York",
    primaryArticleId: 100 + position,
    primaryEvidence: {
      articleId: 100 + position,
      headline:
        position === 1
          ? "Leadership systems face a new test"
          : "Universities rethink executive education",
      canonicalUrl: `https://example.com/story-${position}`,
      sourceName: position === 1 ? "Example News" : "Campus Journal",
      sourceUrl: "https://example.com",
      author: "Reporter",
      excerpt: "A bounded source-evidence excerpt for editor review.",
      publishedAt: fallback ? null : "2026-07-20T09:00:00.000Z",
      scrapedAt: "2026-07-20T09:05:00.000Z",
      effectivePublishedAt: "2026-07-20T09:00:00.000Z",
      timestampSource: fallback ? "scrapedAt" : "publishedAt",
      timestampFallback: fallback,
      capturedAt: calculatedAt,
      contentHash: "a".repeat(64),
    },
    supportingEvidence: [],
    sourceName: position === 1 ? "Example News" : "Campus Journal",
    canonicalUrl: `https://example.com/story-${position}`,
    effectivePublishedAt: "2026-07-20T09:00:00.000Z",
    timestampSource: fallback ? "scrapedAt" : "publishedAt",
    timestampFallback: fallback,
    originalRgiRelevanceScore: position === 1 ? 8.4 : 7.7,
    originalRgiRelevanceScale: "1-10",
    originalRgiRelevanceField: "relevancyScore",
    normalizedRgiRelevanceScore: position === 1 ? 84 : 77,
    relevanceExplanation:
      "The stored RGI score identifies a timely leadership implication.",
    relevanceComponents: { sourceAuthority: 8 },
    relevanceScoringVersion: "rgi-v1",
    relevanceNormalizationVersion: "stored-relevancy-1-to-10-x10-v1",
    sourceAuthorityScore: 8,
    primaryTopic: position === 1 ? "leadership-organizations" : "education",
    primaryTopicLabel:
      position === 1 ? "Leadership & Organizations" : "Education",
    normalizedTopics:
      position === 1 ? ["leadership-and-organizations"] : ["education"],
    unknownTaxonomyTerms: [],
    discipline: "System Vitality",
    industries: [],
    regions: [],
    entities: [],
    recommendedAngle: "What institutional leaders should understand now.",
    shortlistPosition: position,
    selectionConfiguration: {
      minimumNormalizedRelevance: 60,
      maximumOpportunities: 15,
      maximumPerSource: 2,
      maximumPerPrimaryTopic: 3,
      selectionAlgorithmVersion: "rgi-shortlist-diversity-v1",
    },
    professorMatches: matches,
    selectedProfessor: null,
    selectionHistory: [],
    workflowState: "shortlisted",
    createdAt: calculatedAt,
    updatedAt: calculatedAt,
    configurationVersion: "story-opportunities-v1",
    taxonomyVersion: "rgi-story-topics-v1",
    matchingAlgorithmVersion: "deterministic-six-dimension-v1",
  };
}

const opportunities = [
  opportunity("opp_browser_01", 1),
  opportunity("opp_browser_02", 2, true),
];

async function fulfillJson(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

async function mockApi(
  page: Page,
  mode:
    | "normal"
    | "no-window"
    | "empty"
    | "unauthorized"
    | "reads-disabled" = "normal",
) {
  let currentOpportunity = structuredClone(opportunities[0]);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/health")
      return fulfillJson(route, { status: "ok", runtime: {} });
    if (path === "/api/scrape/status")
      return fulfillJson(route, { isRunning: false });
    if (path === "/api/digest") return fulfillJson(route, []);
    if (
      mode === "unauthorized" &&
      path.startsWith("/api/opportunity-windows")
    ) {
      return fulfillJson(
        route,
        { error: "Unauthorized", code: "UNAUTHORIZED" },
        401,
      );
    }
    if (path === "/api/opportunity-windows/config")
      return fulfillJson(route, { readsEnabled: true, writesEnabled: true });
    if (path === "/api/opportunity-windows/current") {
      if (mode === "reads-disabled")
        return fulfillJson(
          route,
          {
            error: "Story Opportunity reads are disabled",
            code: "STORY_OPPORTUNITIES_READS_DISABLED",
          },
          403,
        );
      if (mode === "no-window")
        return fulfillJson(route, {
          window: null,
          items: [],
          total: 0,
          readsEnabled: true,
          writesEnabled: true,
        });
      if (mode === "empty")
        return fulfillJson(route, {
          window: { ...windowSnapshot, opportunityCount: 0 },
          items: [],
          total: 0,
          readsEnabled: true,
          writesEnabled: true,
        });
      return fulfillJson(route, {
        window: windowSnapshot,
        items: opportunities,
        total: opportunities.length,
        readsEnabled: true,
        writesEnabled: true,
      });
    }
    if (
      path === `/api/story-opportunities/${currentOpportunity.id}` &&
      request.method() === "GET"
    ) {
      return fulfillJson(route, {
        opportunity: currentOpportunity,
        readsEnabled: true,
        writesEnabled: true,
      });
    }
    if (path.endsWith("/select-professor") && request.method() === "POST") {
      const body = request.postDataJSON() as {
        professorId: string;
        reason?: string;
        expectedRevision: number;
      };
      const match = matches.find(
        (candidate) => candidate.professorId === body.professorId,
      )!;
      currentOpportunity = {
        ...currentOpportunity,
        revision: currentOpportunity.revision + 1,
        workflowState: "professor_selected",
        selectedProfessor: {
          professorId: match.professorId,
          professorName: match.professorName,
          selectedProfileRevision: match.profileRevision,
          selectedMatchRank: match.rank!,
          selectedFitScore: match.totalFitScore,
          reason: body.reason ?? null,
          selectedBy: "browser-fixture-editor",
          selectedAt: calculatedAt,
        },
        selectionHistory: [
          {
            id: "history-browser-01",
            action: "selected",
            professorId: match.professorId,
            professorName: match.professorName,
            previousProfessorId: null,
            selectedProfileRevision: match.profileRevision,
            reason: body.reason ?? null,
            actorId: "browser-fixture-editor",
            occurredAt: calculatedAt,
          },
        ],
      };
      return fulfillJson(route, {
        opportunity: currentOpportunity,
        readsEnabled: true,
        writesEnabled: true,
      });
    }
    return fulfillJson(route, {});
  });
}

test("editor reviews a frozen shortlist and completes a manual professor selection", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/opportunities");
  await expect(
    page.getByText("Frozen editorial snapshot", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("rgi-relevance-opp_browser_01")).toContainText(
    "84",
  );
  await expect(
    page.getByTestId("opportunity-card-opp_browser_02"),
  ).toContainText("Scraped-time fallback");
  await expect(
    page.getByTestId("opportunity-card-opp_browser_01"),
  ).toContainText("Top professor fit");

  await page.getByTestId("open-opportunity-opp_browser_01").click();
  await expect(page).toHaveURL(/\/opportunities\/opp_browser_01$/);
  await expect(page.getByText("Evidence", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Professor Matches" }),
  ).toBeVisible();
  await expect(
    page.getByText("Selection History", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("RGI relevance", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Professor fit", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByTestId("professor-match-prof_alpha_01")).toContainText(
    "Weight 30% · contribution 30 points",
  );
  await expect(page.getByTestId("professor-match-prof_alpha_01")).toContainText(
    "matched “Leadership & Organizations”",
  );
  await expect(page.getByTestId("professor-match-prof_alpha_01")).toContainText(
    "Strong match (82/100)",
  );
  await expect(
    page.getByTestId("select-professor-prof_delta_01"),
  ).toBeDisabled();
  await expect(page.getByText("No professor has been selected")).toBeVisible();

  await page.getByTestId("select-professor-prof_alpha_01").click();
  await expect(
    page.getByTestId("professor-selection-confirmation"),
  ).toContainText("No override reason is required");
  await page.getByTestId("confirm-professor-selection").click();
  await expect(
    page.getByText("Selected: Professor Alpha", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Actor: browser-fixture-editor/)).toBeVisible();
  await expect(page.getByText("Intake", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Draft", { exact: true })).toHaveCount(0);
});

test("weak selection requires a substantive editor reason", async ({
  page,
}) => {
  await mockApi(page);
  await page.goto("/opportunities/opp_browser_01");
  await page.getByTestId("select-professor-prof_gamma_01").click();
  await expect(
    page.getByTestId("professor-selection-confirmation"),
  ).toContainText("requires an override reason");
  await expect(page.getByTestId("confirm-professor-selection")).toBeDisabled();
  await page
    .getByTestId("selection-override-reason")
    .fill("Distinct practitioner experience relevant to the angle");
  await expect(page.getByTestId("confirm-professor-selection")).toBeEnabled();
  await page.getByTestId("confirm-professor-selection").click();
  await expect(
    page.getByText("Selected: Professor Gamma", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Reason: Distinct practitioner experience relevant to the angle",
      { exact: true },
    ),
  ).toBeVisible();
});

test("no-window, empty-window, and authorization states remain distinguishable", async ({
  page,
}) => {
  await mockApi(page, "no-window");
  await page.goto("/opportunities");
  await expect(
    page.getByText("No calculated opportunity window"),
  ).toBeVisible();

  await page.unrouteAll();
  await mockApi(page, "empty");
  await page.reload();
  await expect(page.getByText("No stories qualified")).toBeVisible();

  await page.unrouteAll();
  await mockApi(page, "unauthorized");
  await page.reload();
  await expect(
    page.getByText("Internal editor authorization required"),
  ).toBeVisible();

  await page.unrouteAll();
  await mockApi(page, "reads-disabled");
  await page.reload();
  await expect(
    page.getByText("Daily Opportunities reads are disabled"),
  ).toBeVisible();
});
