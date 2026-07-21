import assert from "node:assert/strict";
import test from "node:test";
import type { Article } from "@workspace/db";
import {
  ProfessorProfileSchema,
  type ProfessorProfile,
} from "@workspace/api-zod";
import {
  LOW_PROFILE_COVERAGE_THRESHOLD,
  MATCH_DIMENSIONS,
  OpportunityCommandError,
  PROFILE_COVERAGE_VERSION,
  PROFESSOR_MATCHING_ALGORITHM_VERSION,
  RGI_RELEVANCE_NORMALIZATION_VERSION,
  STORY_OPPORTUNITY_SELECTION_ALGORITHM_VERSION,
  assertExpectedRevision,
  buildFrozenOpportunityWindow,
  calculateOpportunityWindowBounds,
  calculateProfileCoverage,
  clearProfessorSelection,
  closeOpportunity,
  matchProfessors,
  normalizeRgiRelevance,
  professorMatchLabel,
  reopenOpportunity,
  selectProfessorForOpportunity,
  shortlistArticles,
  type StoryOpportunity,
} from "../lib/story-opportunities";
import {
  MemoryStoryOpportunityRepository,
  listOpportunityCandidateArticlesFromDb,
} from "../lib/story-opportunity-repository";
import { StoryOpportunityService } from "../lib/story-opportunity-service";
import {
  resolveTaxonomyTerm,
  STORY_MATCHING_TAXONOMY_VERSION,
  taxonomyTopicsRelated,
} from "../lib/story-opportunity-taxonomy";

const NOW = new Date("2026-07-20T12:00:00.000Z");
const AS_OF = new Date("2026-07-20T15:00:00.000Z");

function article(
  id: number,
  patch: Partial<Article & Record<string, unknown>> = {},
): Article {
  return {
    id,
    headline: `Story ${id}`,
    url: `https://example.com/${id}`,
    sourceName: `Source ${id}`,
    sourceUrl: "https://example.com",
    author: "Reporter",
    authorType: "Journalist",
    platform: "news",
    isEmergingSignal: false,
    isPrimarySignal: true,
    relevancyScore: 8,
    authenticityScore: 8,
    viewpoint: null,
    topicTags: ["Leadership & Organizations"],
    teaserSummary: `Summary ${id}`,
    publishedAt: new Date("2026-07-20T09:00:00.000Z"),
    scrapedAt: new Date("2026-07-20T09:30:00.000Z"),
    content: `Body ${id}`,
    status: "pending",
    disciplineAlignment: "System Vitality",
    scoreExplanation: "Strong leadership implications.",
    scoreBreakdown: { sourceAuthority: 8 },
    sourceAuthorityScore: 8,
    rgiProfileVersion: "rgi-v1",
    ...patch,
  } as Article;
}

function profile(
  id: string,
  patch: Partial<ProfessorProfile> = {},
): ProfessorProfile {
  return ProfessorProfileSchema.parse({
    id,
    fullName: `Professor ${id}`,
    academicTitle: "Professor",
    department: "Management",
    coursesTaught: [],
    expertiseTags: [],
    researchInterests: [],
    professionalExperienceTags: [],
    academicExperienceTags: [],
    industries: [],
    topicInterests: [],
    regions: [],
    affiliations: [],
    professionalBackground: "",
    approvedBio: "",
    publications: [],
    publicationTopicTags: [],
    recurringThemes: [],
    contactableTopics: [],
    restrictedTopics: [],
    doNotContactTopics: [],
    institutionalConflicts: [],
    affiliationConcerns: [],
    status: "active",
    schemaVersion: 2,
    profileRevision: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  });
}

function build(
  articles: Article[],
  profiles: ProfessorProfile[] = [],
  snapshotRevision = 1,
) {
  return buildFrozenOpportunityWindow({
    articles,
    professorProfiles: profiles,
    asOf: AS_OF,
    calculatedAt: NOW,
    snapshotRevision,
  });
}

test("daily window uses the most recent 06:00 Eastern cutoff and 24 elapsed hours", () => {
  const normal = calculateOpportunityWindowBounds(
    new Date("2026-07-20T15:00:00.000Z"),
  );
  assert.equal(normal.windowEnd.toISOString(), "2026-07-20T10:00:00.000Z");
  assert.equal(normal.windowStart.toISOString(), "2026-07-19T10:00:00.000Z");
  const beforeCutoff = calculateOpportunityWindowBounds(
    new Date("2026-07-20T09:59:59.000Z"),
  );
  assert.equal(
    beforeCutoff.windowEnd.toISOString(),
    "2026-07-19T10:00:00.000Z",
  );
});

test("daily window preserves 24 elapsed hours across both daylight-saving transitions", () => {
  const spring = calculateOpportunityWindowBounds(
    new Date("2026-03-08T15:00:00.000Z"),
  );
  assert.equal(spring.windowEnd.toISOString(), "2026-03-08T10:00:00.000Z");
  assert.equal(spring.windowStart.toISOString(), "2026-03-07T10:00:00.000Z");
  assert.equal(
    spring.windowEnd.getTime() - spring.windowStart.getTime(),
    86_400_000,
  );
  const fall = calculateOpportunityWindowBounds(
    new Date("2026-11-01T15:00:00.000Z"),
  );
  assert.equal(fall.windowEnd.toISOString(), "2026-11-01T11:00:00.000Z");
  assert.equal(fall.windowStart.toISOString(), "2026-10-31T11:00:00.000Z");
  assert.equal(
    fall.windowEnd.getTime() - fall.windowStart.getTime(),
    86_400_000,
  );
});

test("eligibility is inclusive-start/exclusive-end and only falls back when publishedAt is unusable", () => {
  const bounds = calculateOpportunityWindowBounds(AS_OF);
  const result = shortlistArticles(
    [
      article(1, { publishedAt: new Date(bounds.windowStart) }),
      article(2, { publishedAt: new Date(bounds.windowEnd) }),
      article(3, {
        publishedAt: null,
        scrapedAt: new Date("2026-07-20T08:00:00.000Z"),
      }),
      article(4, {
        publishedAt: new Date("2026-07-20T11:00:00.000Z"),
        scrapedAt: new Date("2026-07-20T08:00:00.000Z"),
      }),
      article(5, { publishedAt: null, scrapedAt: new Date(Number.NaN) }),
    ],
    bounds,
  );
  assert.deepEqual(
    result.eligible.map((candidate) => candidate.article.id),
    [1, 3],
  );
  assert.equal(result.eligible[1]?.timestampSource, "scrapedAt");
});

test("production candidate loading uses only bounded publishedAt and scrapedAt Firestore queries", async () => {
  const bounds = calculateOpportunityWindowBounds(AS_OF);
  const queryCalls: { field: string; operator: string; value: Date }[][] = [];
  const raw = (id: number, patch: Record<string, unknown> = {}) => ({
    id,
    headline: `Story ${id}`,
    url: `https://example.com/${id}`,
    sourceName: `Source ${id}`,
    relevancyScore: 8,
    topicTags: ["Leadership & Organizations"],
    publishedAt: new Date("2026-07-20T09:00:00.000Z"),
    scrapedAt: new Date("2026-07-20T09:05:00.000Z"),
    ...patch,
  });
  const publishedDocs = [{ id: "1", data: () => raw(1) }];
  const scrapedDocs = [
    { id: "1", data: () => raw(1) },
    { id: "2", data: () => raw(2, { publishedAt: null }) },
    {
      id: "3",
      data: () => raw(3, { publishedAt: new Date("2026-07-20T11:00:00.000Z") }),
    },
  ];
  const db = {
    collection(name: string) {
      assert.equal(name, "articles");
      const clauses: { field: string; operator: string; value: Date }[] = [];
      const query = {
        where(field: string, operator: string, value: Date) {
          clauses.push({ field, operator, value });
          return query;
        },
        async get() {
          queryCalls.push(clauses);
          return {
            docs:
              clauses[0]?.field === "publishedAt" ? publishedDocs : scrapedDocs,
          };
        },
      };
      return query;
    },
  };

  const loaded = await listOpportunityCandidateArticlesFromDb(
    db,
    bounds.windowStart,
    bounds.windowEnd,
  );
  assert.deepEqual(
    loaded.map((item) => item.id),
    [1, 2],
  );
  assert.deepEqual(
    queryCalls.map((clauses) =>
      clauses.map(({ field, operator }) => [field, operator]),
    ),
    [
      [
        ["publishedAt", ">="],
        ["publishedAt", "<"],
      ],
      [
        ["scrapedAt", ">="],
        ["scrapedAt", "<"],
      ],
    ],
  );
  assert.equal(queryCalls[0]?.[0]?.value, bounds.windowStart);
  assert.equal(queryCalls[1]?.[1]?.value, bounds.windowEnd);
});

test("normalization reuses the stored 1-10 score without a second relevance model", () => {
  assert.equal(normalizeRgiRelevance(6), 60);
  assert.equal(normalizeRgiRelevance(8.45), 84.5);
  assert.equal(normalizeRgiRelevance(12), 100);
  assert.equal(normalizeRgiRelevance(Number.NaN), 0);
});

test("shortlist enforces threshold, source/topic caps, maximum 15, and stable tie-breaking", () => {
  const candidates = Array.from({ length: 25 }, (_, index) =>
    article(index + 1, {
      sourceName: index < 4 ? "Crowded Source" : `Source ${index}`,
      topicTags:
        index < 6
          ? ["Leadership & Organizations"]
          : [index % 2 ? "Technology & AI" : "Education"],
      relevancyScore: index === 24 ? 5.9 : 8,
      publishedAt: new Date(
        `2026-07-20T${String(9 - (index % 5)).padStart(2, "0")}:00:00.000Z`,
      ),
      sourceAuthorityScore: index % 3,
    }),
  );
  const result = shortlistArticles(
    candidates,
    calculateOpportunityWindowBounds(AS_OF),
  );
  assert.ok(result.shortlisted.length <= 15);
  assert.equal(
    result.qualifying.some((candidate) => candidate.article.id === 25),
    false,
  );
  const sourceCounts = result.shortlisted.filter(
    (candidate) => candidate.article.sourceName === "Crowded Source",
  ).length;
  const topicCounts = result.shortlisted.filter(
    (candidate) => candidate.primaryTopic === "leadership-organizations",
  ).length;
  assert.ok(sourceCounts <= 2);
  assert.ok(topicCounts <= 3);
  const exactTie = shortlistArticles(
    [
      article(11, {
        headline: "B",
        sourceName: "B",
        publishedAt: new Date("2026-07-20T08:00:00Z"),
        sourceAuthorityScore: 7,
      }),
      article(10, {
        headline: "A",
        sourceName: "A",
        publishedAt: new Date("2026-07-20T08:00:00Z"),
        sourceAuthorityScore: 7,
      }),
    ],
    calculateOpportunityWindowBounds(AS_OF),
  );
  assert.deepEqual(
    exactTie.shortlisted.map((candidate) => candidate.article.id),
    [10, 11],
  );
});

test("shortlist includes exactly 60, caps at exactly 15, and applies every ordering tier", () => {
  const bounds = calculateOpportunityWindowBounds(AS_OF);
  const boundary = shortlistArticles(
    [
      article(1, { relevancyScore: 6, topicTags: ["boundary-one"] }),
      article(2, { relevancyScore: 5.999, topicTags: ["boundary-two"] }),
    ],
    bounds,
  );
  assert.deepEqual(
    boundary.qualifying.map((candidate) => candidate.article.id),
    [1],
  );

  const uncapped = Array.from({ length: 18 }, (_, index) =>
    article(index + 10, {
      sourceName: `Distinct Source ${index}`,
      topicTags: [`distinct-topic-${index}`],
    }),
  );
  assert.equal(shortlistArticles(uncapped, bounds).shortlisted.length, 15);

  const ordered = shortlistArticles(
    [
      article(101, {
        relevancyScore: 7,
        publishedAt: new Date("2026-07-20T09:30:00Z"),
        sourceAuthorityScore: 10,
        topicTags: ["order-a"],
      }),
      article(102, {
        relevancyScore: 8,
        publishedAt: new Date("2026-07-20T08:00:00Z"),
        sourceAuthorityScore: 1,
        topicTags: ["order-b"],
      }),
      article(103, {
        relevancyScore: 8,
        publishedAt: new Date("2026-07-20T09:00:00Z"),
        sourceAuthorityScore: 1,
        topicTags: ["order-c"],
      }),
      article(104, {
        relevancyScore: 8,
        publishedAt: new Date("2026-07-20T09:00:00Z"),
        sourceAuthorityScore: 9,
        topicTags: ["order-d"],
      }),
      article(106, {
        relevancyScore: 8,
        publishedAt: new Date("2026-07-20T09:00:00Z"),
        sourceAuthorityScore: 9,
        topicTags: ["order-e"],
      }),
      article(105, {
        relevancyScore: 8,
        publishedAt: new Date("2026-07-20T09:00:00Z"),
        sourceAuthorityScore: 9,
        topicTags: ["order-f"],
      }),
    ],
    bounds,
  );
  assert.deepEqual(
    ordered.shortlisted.map((candidate) => candidate.article.id),
    [104, 105, 106, 103, 102, 101],
  );
});

test("fewer than 15 qualifying stories are returned without padding and frozen evidence preserves scores", () => {
  const snapshot = build([
    article(1, { relevancyScore: 6.2 }),
    article(2, { relevancyScore: 5.9 }),
  ]);
  assert.equal(snapshot.opportunities.length, 1);
  const opportunity = snapshot.opportunities[0]!;
  assert.equal(opportunity.originalRgiRelevanceScore, 6.2);
  assert.equal(opportunity.normalizedRgiRelevanceScore, 62);
  assert.equal(
    opportunity.relevanceNormalizationVersion,
    RGI_RELEVANCE_NORMALIZATION_VERSION,
  );
  assert.equal(opportunity.supportingEvidence.length, 0);
  assert.equal(opportunity.primaryEvidence.contentHash.length, 64);
  assert.equal(
    snapshot.window.selectionAlgorithmVersion,
    STORY_OPPORTUNITY_SELECTION_ALGORITHM_VERSION,
  );
});

test("taxonomy distinguishes canonical, alias, parent-child, and unknown terms", () => {
  assert.equal(
    resolveTaxonomyTerm("Leadership & Organizations").canonicalSlug,
    "leadership-organizations",
  );
  assert.equal(resolveTaxonomyTerm("management").resolution, "alias");
  assert.equal(taxonomyTopicsRelated("technology-ai", "cybersecurity"), true);
  assert.equal(
    resolveTaxonomyTerm("unapproved niche term").resolution,
    "unknown",
  );
});

test("matching applies exact, alias, parent-child, and strongest-match-only scores", () => {
  const opportunity = build([article(1)]).opportunities[0]!;
  const exact = profile("prof_exact_01", {
    expertiseTags: ["Leadership & Organizations", "leadership"],
  });
  const alias = profile("prof_alias_01", { expertiseTags: ["management"] });
  const parent = profile("prof_parent_01", {
    expertiseTags: ["Business Strategy & Corporations"],
  });
  const unknown = profile("prof_unknown_01", {
    expertiseTags: ["unapproved niche term"],
  });
  const matches = matchProfessors(opportunity, [exact, alias, parent, unknown]);
  const byId = new Map(matches.map((match) => [match.professorId, match]));
  assert.equal(byId.get(exact.id)?.dimensions[0]?.dimensionScore, 100);
  assert.equal(byId.get(alias.id)?.dimensions[0]?.dimensionScore, 80);
  assert.equal(byId.get(parent.id)?.dimensions[0]?.dimensionScore, 50);
  assert.equal(byId.get(unknown.id)?.dimensions[0]?.dimensionScore, 0);
  assert.equal(byId.get(exact.id)?.totalFitScore, 30);
});

test("all six dimensions use approved weights without tag-count inflation", () => {
  assert.equal(
    MATCH_DIMENSIONS.reduce((sum, dimension) => sum + dimension.weight, 0),
    100,
  );
  const fullyMatched = profile("prof_full_01", {
    expertiseTags: ["Leadership & Organizations", "leadership", "management"],
    researchInterests: ["Leadership & Organizations"],
    professionalExperienceTags: ["Leadership & Organizations"],
    topicInterests: ["Leadership & Organizations"],
    publicationTopicTags: ["Leadership & Organizations"],
    affiliations: ["Leadership & Organizations"],
  });
  const match = build([article(1)], [fullyMatched]).opportunities[0]!
    .professorMatches[0]!;
  assert.equal(match.totalFitScore, 100);
  assert.deepEqual(
    match.dimensions.map((dimension) => dimension.weightedContribution),
    [30, 15, 15, 15, 15, 10],
  );
  assert.equal(match.profileCoverage, 100);
  assert.equal(match.taxonomyVersion, STORY_MATCHING_TAXONOMY_VERSION);
  assert.equal(
    match.matchingAlgorithmVersion,
    PROFESSOR_MATCHING_ALGORITHM_VERSION,
  );
});

test("supporting evidence cannot change relevance, shortlist rank, or professor fit", () => {
  const professor = profile("prof_support_01", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const opportunity = build([article(1)], [professor]).opportunities[0]!;
  const withSupportingEvidence: StoryOpportunity = {
    ...opportunity,
    supportingEvidence: [
      {
        ...opportunity.primaryEvidence,
        articleId: 999,
        headline: "Supporting story",
      },
    ],
  };
  const recalculatedMatches = matchProfessors(withSupportingEvidence, [
    professor,
  ]);
  assert.equal(
    withSupportingEvidence.normalizedRgiRelevanceScore,
    opportunity.normalizedRgiRelevanceScore,
  );
  assert.equal(
    withSupportingEvidence.shortlistPosition,
    opportunity.shortlistPosition,
  );
  assert.equal(
    recalculatedMatches[0]?.totalFitScore,
    opportunity.professorMatches[0]?.totalFitScore,
  );
});

test("profile coverage is weighted presence and remains separate from fit", () => {
  const coreOnly = profile("prof_core_01", {
    expertiseTags: ["Technology & AI"],
  });
  const coverage = calculateProfileCoverage(coreOnly);
  assert.equal(coverage.coverage, 30);
  assert.deepEqual(coverage.coveredDimensions, ["core_expertise"]);
  assert.equal(coverage.missingDimensions.length, 5);
  const match = build([article(1)], [coreOnly]).opportunities[0]!
    .professorMatches[0]!;
  assert.equal(match.totalFitScore, 0);
  assert.equal(match.profileCoverage, 30);
  assert.equal(match.coverageCalculationVersion, PROFILE_COVERAGE_VERSION);
  assert.ok(
    match.warnings.some((warning) =>
      warning.includes(`${LOW_PROFILE_COVERAGE_THRESHOLD}%`),
    ),
  );

  const unknownOnly = calculateProfileCoverage(
    profile("prof_unknown_coverage", {
      expertiseTags: ["unapproved niche term"],
    }),
  );
  assert.equal(unknownOnly.coverage, 0);
  assert.equal(unknownOnly.missingDimensions.length, 6);
});

test("match labels use exact approved boundaries", () => {
  assert.equal(professorMatchLabel(70), "strong");
  assert.equal(professorMatchLabel(69.999), "plausible");
  assert.equal(professorMatchLabel(50), "plausible");
  assert.equal(professorMatchLabel(49.999), "weak");
});

test("equal professor-fit scores use deterministic name and id tie-breaking", () => {
  const profiles = [
    profile("prof_equal_03", {
      fullName: "Professor Beta",
      expertiseTags: ["Leadership & Organizations"],
    }),
    profile("prof_equal_02", {
      fullName: "Professor Alpha",
      expertiseTags: ["Leadership & Organizations"],
    }),
    profile("prof_equal_01", {
      fullName: "Professor Alpha",
      expertiseTags: ["Leadership & Organizations"],
    }),
  ];
  const matches = build([article(1)], profiles).opportunities[0]!
    .professorMatches;
  assert.deepEqual(
    matches.map((match) => match.professorId),
    ["prof_equal_01", "prof_equal_02", "prof_equal_03"],
  );
  assert.deepEqual(
    matches.map((match) => match.rank),
    [1, 2, 3],
  );
});

test("exclusions and warnings preserve precedence without parent-child hard exclusions", () => {
  const inactive = profile("prof_inactive_01", {
    status: "inactive",
    restrictedTopics: ["leadership"],
  });
  const restricted = profile("prof_restrict_01", {
    restrictedTopics: ["management"],
  });
  const parentOnly = profile("prof_parentok_01", {
    restrictedTopics: ["Business Strategy & Corporations"],
  });
  const conflict = profile("prof_conflict_01", {
    institutionalConflicts: ["Source 1"],
  });
  const soft = profile("prof_softwarn_01", {
    affiliationConcerns: ["Source 1"],
  });
  const matches = build(
    [article(1)],
    [inactive, restricted, parentOnly, conflict, soft],
  ).opportunities[0]!.professorMatches;
  const byId = new Map(matches.map((match) => [match.professorId, match]));
  assert.match(byId.get(inactive.id)?.exclusions[0] ?? "", /inactive/);
  assert.ok(
    byId
      .get(inactive.id)
      ?.exclusions.some((value) => value.includes("restricted topic")),
  );
  assert.ok(
    byId
      .get(restricted.id)
      ?.exclusions.some((value) => value.includes("restricted topic")),
  );
  assert.equal(byId.get(parentOnly.id)?.exclusions.length, 0);
  assert.ok(
    byId
      .get(conflict.id)
      ?.exclusions.some((value) => value.includes("institutional conflict")),
  );
  assert.ok(
    byId
      .get(soft.id)
      ?.warnings.some((value) => value.includes("Affiliation/conflict")),
  );

  const unknownOpportunity = build(
    [
      article(2, {
        topicTags: ["unapproved niche term"],
        disciplineAlignment: null,
      }),
    ],
    [
      profile("prof_unknown_restriction", {
        restrictedTopics: ["unapproved niche term"],
      }),
    ],
  ).opportunities[0]!;
  assert.equal(unknownOpportunity.professorMatches[0]?.exclusions.length, 0);
  assert.ok(
    unknownOpportunity.unknownTaxonomyTerms.includes("unapproved niche term"),
  );
});

test("manual selection rejects exclusions and requires a reason for weak fit", () => {
  const strong = profile("prof_strong_01", {
    expertiseTags: ["Leadership & Organizations"],
    researchInterests: ["Leadership & Organizations"],
    professionalExperienceTags: ["Leadership & Organizations"],
    topicInterests: ["Leadership & Organizations"],
    publicationTopicTags: ["Leadership & Organizations"],
  });
  const weak = profile("prof_weak_001", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const excluded = profile("prof_block_001", {
    doNotContactTopics: ["Leadership & Organizations"],
  });
  const inactive = profile("prof_inactive_select", {
    status: "inactive",
    expertiseTags: ["Leadership & Organizations"],
  });
  const opportunity = build([article(1)], [strong, weak, excluded, inactive])
    .opportunities[0]!;
  assert.throws(
    () =>
      selectProfessorForOpportunity({
        opportunity,
        professorId: weak.id,
        actorId: "editor-test",
        occurredAt: NOW.toISOString(),
      }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "WEAK_MATCH_REASON_REQUIRED",
  );
  assert.throws(
    () =>
      selectProfessorForOpportunity({
        opportunity,
        professorId: excluded.id,
        reason: "Override",
        actorId: "editor-test",
        occurredAt: NOW.toISOString(),
      }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_HARD_EXCLUDED",
  );
  assert.throws(
    () =>
      selectProfessorForOpportunity({
        opportunity,
        professorId: inactive.id,
        reason: "Override",
        actorId: "editor-test",
        occurredAt: NOW.toISOString(),
      }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_HARD_EXCLUDED",
  );
  const selected = selectProfessorForOpportunity({
    opportunity,
    professorId: strong.id,
    actorId: "editor-test",
    occurredAt: NOW.toISOString(),
  });
  assert.equal(selected.workflowState, "professor_selected");
  assert.equal(selected.selectedProfessor?.professorId, strong.id);
  assert.equal(selected.selectionHistory.length, 1);
  assert.deepEqual(selected.professorMatches, opportunity.professorMatches);
  const changed = selectProfessorForOpportunity({
    opportunity: selected,
    professorId: weak.id,
    reason: "Distinct regional perspective",
    actorId: "editor-test",
    occurredAt: "2026-07-20T12:01:00Z",
  });
  assert.equal(changed.selectionHistory[1]?.action, "changed");
  const cleared = clearProfessorSelection({
    opportunity: changed,
    actorId: "editor-test",
    occurredAt: "2026-07-20T12:02:00Z",
  });
  assert.equal(cleared.workflowState, "shortlisted");
  assert.equal(cleared.selectedProfessor, null);
  assert.equal(cleared.selectionHistory[2]?.action, "cleared");
});

test("close and reopen preserve selection while closed opportunities reject selection changes", () => {
  const professor = profile("prof_state_0001", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const opportunity = build([article(1)], [professor]).opportunities[0]!;
  const selected = selectProfessorForOpportunity({
    opportunity,
    professorId: professor.id,
    reason: "Approved weak override",
    actorId: "editor",
    occurredAt: NOW.toISOString(),
  });
  const closed = closeOpportunity(selected, "2026-07-20T12:01:00.000Z");
  assert.equal(closed.workflowState, "closed");
  assert.equal(closed.selectedProfessor?.professorId, professor.id);
  assert.throws(
    () =>
      clearProfessorSelection({
        opportunity: closed,
        actorId: "editor",
        occurredAt: "2026-07-20T12:02:00.000Z",
      }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "OPPORTUNITY_CLOSED",
  );
  const reopened = reopenOpportunity(closed, "2026-07-20T12:03:00.000Z");
  assert.equal(reopened.workflowState, "professor_selected");
  assert.equal(reopened.selectedProfessor?.professorId, professor.id);
});

test("revision checks reject conflicts and identical selection commands are idempotent", () => {
  const professor = profile("prof_idem_0001", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const opportunity = build([article(1)], [professor]).opportunities[0]!;
  assert.throws(
    () => assertExpectedRevision(opportunity, 2),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "OPPORTUNITY_REVISION_CONFLICT",
  );
  const selected = selectProfessorForOpportunity({
    opportunity,
    professorId: professor.id,
    reason: "Editorial override",
    actorId: "editor",
    occurredAt: NOW.toISOString(),
  });
  const repeated = selectProfessorForOpportunity({
    opportunity: selected,
    professorId: professor.id,
    reason: "Editorial override",
    actorId: "editor",
    occurredAt: "2026-07-20T12:01:00Z",
  });
  assert.equal(repeated, selected);
});

test("selection rejects a Professor Profile that became inactive or changed after the frozen match", async () => {
  let currentProfile = profile("prof_current_01", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const repository = new MemoryStoryOpportunityRepository((professorId) =>
    professorId === currentProfile.id ? currentProfile : null,
  );
  const service = new StoryOpportunityService({
    repository,
    loadArticles: async () => [article(1)],
    loadProfessorProfiles: async () => [currentProfile],
    now: () => NOW,
  });
  const created = await service.calculateWindow(AS_OF);
  const opportunity = created.opportunities[0]!;

  currentProfile = { ...currentProfile, status: "inactive" };
  await assert.rejects(
    service.selectProfessor({
      id: opportunity.id,
      professorId: currentProfile.id,
      reason: "Editorial override",
      expectedRevision: 1,
      actorId: "editor",
    }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_PROFILE_INACTIVE",
  );

  currentProfile = {
    ...currentProfile,
    status: "active",
    restrictedTopics: ["Leadership & Organizations"],
  };
  await assert.rejects(
    service.selectProfessor({
      id: opportunity.id,
      professorId: currentProfile.id,
      reason: "Editorial override",
      expectedRevision: 1,
      actorId: "editor",
    }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_HARD_EXCLUDED",
  );

  currentProfile = {
    ...currentProfile,
    restrictedTopics: [],
    institutionalConflicts: ["Source 1"],
  };
  await assert.rejects(
    service.selectProfessor({
      id: opportunity.id,
      professorId: currentProfile.id,
      reason: "Editorial override",
      expectedRevision: 1,
      actorId: "editor",
    }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_HARD_EXCLUDED",
  );

  currentProfile = {
    ...currentProfile,
    restrictedTopics: [],
    institutionalConflicts: [],
    profileRevision: 2,
  };
  await assert.rejects(
    service.selectProfessor({
      id: opportunity.id,
      professorId: currentProfile.id,
      reason: "Editorial override",
      expectedRevision: 1,
      actorId: "editor",
    }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_PROFILE_REVISION_CONFLICT" &&
      error.status === 409,
  );

  const persisted = await repository.getOpportunity(opportunity.id);
  assert.equal(persisted?.revision, 1);
  assert.equal(persisted?.selectedProfessor, null);
  assert.deepEqual(persisted?.selectionHistory, []);
});

test("an identical selection retry cannot bypass current Professor Profile validation", async () => {
  let currentProfile = profile("prof_retry_0001", {
    expertiseTags: ["Leadership & Organizations"],
  });
  const repository = new MemoryStoryOpportunityRepository((professorId) =>
    professorId === currentProfile.id ? currentProfile : null,
  );
  const service = new StoryOpportunityService({
    repository,
    loadArticles: async () => [article(1)],
    loadProfessorProfiles: async () => [currentProfile],
    now: () => NOW,
  });
  const opportunity = (await service.calculateWindow(AS_OF)).opportunities[0]!;
  const selected = await service.selectProfessor({
    id: opportunity.id,
    professorId: currentProfile.id,
    reason: "Editorial override",
    expectedRevision: opportunity.revision,
    actorId: "editor",
  });
  assert.equal(selected?.revision, 2);

  currentProfile = { ...currentProfile, profileRevision: 2 };
  await assert.rejects(
    service.selectProfessor({
      id: opportunity.id,
      professorId: currentProfile.id,
      reason: "Editorial override",
      expectedRevision: opportunity.revision,
      actorId: "editor",
    }),
    (error: unknown) =>
      error instanceof OpportunityCommandError &&
      error.code === "PROFESSOR_PROFILE_REVISION_CONFLICT",
  );
  const persisted = await repository.getOpportunity(opportunity.id);
  assert.equal(persisted?.revision, 2);
  assert.equal(persisted?.selectionHistory.length, 1);
});

test("deterministic snapshot creation is idempotent and never mutates the frozen first result", async () => {
  const repository = new MemoryStoryOpportunityRepository();
  const first = build([article(1)]);
  const created = await repository.createFrozenSnapshot(
    first.window,
    first.opportunities,
  );
  assert.equal(created.created, true);
  const changedInput = build([
    article(1, { headline: "Later title", relevancyScore: 10 }),
  ]);
  const repeated = await repository.createFrozenSnapshot(
    changedInput.window,
    changedInput.opportunities,
  );
  assert.equal(repeated.created, false);
  assert.equal(repeated.opportunities[0]?.primaryEvidence.headline, "Story 1");
  assert.equal(repeated.opportunities[0]?.normalizedRgiRelevanceScore, 80);

  const explicitlyRecalculated = build(
    [article(1, { headline: "Versioned title" })],
    [],
    2,
  );
  const versioned = await repository.createFrozenSnapshot(
    explicitlyRecalculated.window,
    explicitlyRecalculated.opportunities,
  );
  assert.equal(versioned.created, true);
  assert.equal(versioned.window.snapshotRevision, 2);
  assert.notEqual(versioned.window.id, created.window.id);
  assert.equal(
    (await repository.getWindow(created.window.id))?.snapshotRevision,
    1,
  );
});
