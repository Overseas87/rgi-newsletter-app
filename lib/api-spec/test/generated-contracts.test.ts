import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  GetDashboardSummaryResponse,
  GetCurrentStoryOpportunityWindowResponse,
  ListArticlesResponse,
  ListDigestArticlesResponse,
  ListProfessorProfilesResponse,
  ListSourcesResponse,
  SelectStoryOpportunityProfessorBody,
  UpdateDigestArticleBody,
  UpdateSourceBody,
} from "../../api-zod/src/generated/api";

const article = {
  id: 101,
  headline: "A leadership signal",
  url: "https://example.com/article",
  sourceName: "Example",
  isEmergingSignal: false,
  isPrimarySignal: true,
  relevancyScore: 8.4,
  topicTags: ["Leadership & Organizations"],
  scrapedAt: "2026-07-20T08:00:00.000Z",
  status: "pending" as const,
  scoreExplanation: "Strong executive relevance.",
  scoreBreakdown: { leadershipRelevance: 9 },
  recencyScore: 9.5,
  sourceAuthorityScore: 8,
  strategicImpactScore: 8.7,
  executiveRelevanceScore: 9,
  recommendedUse: "dashboard" as const,
  reasonForAcceptance: "Fresh and strategically relevant.",
  reasonForRejection: null,
  rgiProfileVersion: "rgi-v1",
  moderationNote: null,
  moderatedAt: null,
  moderatedBy: null,
};

test("internal editor operations declare Firebase editor and server-only service authorization", () => {
  const openapi = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
  for (const operationId of [
    "getProfessorLibraryConfig",
    "listProfessorProfiles",
    "createProfessorProfile",
    "getProfessorProfile",
    "updateProfessorProfile",
    "getStoryOpportunityConfig",
    "listStoryOpportunityWindows",
    "getCurrentStoryOpportunityWindow",
    "calculateStoryOpportunityWindow",
    "listStoryOpportunitiesForWindow",
    "getStoryOpportunity",
    "listStoryOpportunityProfessorMatches",
    "selectStoryOpportunityProfessor",
    "clearStoryOpportunityProfessor",
    "updateStoryOpportunityAngle",
    "closeStoryOpportunity",
    "reopenStoryOpportunity",
  ]) {
    assert.match(
      openapi,
      new RegExp(
        `operationId: ${operationId}[\\s\\S]{0,260}security:\\n\\s+- FirebaseEditorAuth: \\[\\]\\n\\s+- InternalServiceKey: \\[\\]`,
      ),
    );
  }
  assert.doesNotMatch(openapi, /^\s+InternalEditorAuth:/m);
  assert.doesNotMatch(openapi, /VITE_ADMIN_API_KEY/);
  assert.match(openapi, /name: x-admin-api-key/);
  assert.match(openapi, /bearerFormat: Firebase ID token/);
  assert.match(openapi, /InternalEditorAuthUnavailable/);
});

test("generated Story Opportunity response validators use declaration-safe reproducible annotations", () => {
  const generated = readFileSync(new URL("../../api-zod/src/generated/api.ts", import.meta.url), "utf8");
  for (const schema of ["GetCurrentStoryOpportunityWindowResponse", "GetStoryOpportunityResponse", "SelectStoryOpportunityProfessorResponse"]) {
    assert.ok(generated.includes(`export const ${schema}: zod.ZodTypeAny = zod.object(`));
  }
});

test("generated article contracts retain backend scoring metadata", () => {
  const parsed = ListArticlesResponse.parse([article]);

  assert.equal(parsed[0]?.scoreExplanation, "Strong executive relevance.");
  assert.deepEqual(parsed[0]?.scoreBreakdown, { leadershipRelevance: 9 });
  assert.equal(parsed[0]?.recommendedUse, "dashboard");
});

test("generated digest contracts retain normalized content and supported edits", () => {
  const parsed = ListDigestArticlesResponse.parse([{
    id: 11,
    articleType: "topic_article",
    headline: "A contract-complete brief",
    body: "Body",
    executiveSummary: ["Summary"],
    rgiTake: "RGI take",
    keyTakeaways: ["Takeaway"],
    implificationsForLeaders: ["Implication"],
    whatMostAreMissing: "A missing perspective",
    mechanism: ["Mechanism"],
    constraintsAndRisks: ["Risk"],
    whatChangedSinceYesterday: [],
    whatToWatch: ["Watch"],
    summaryTakeaways: ["Summary takeaway"],
    topicTags: ["Leadership & Organizations"],
    sourceArticleIds: [101],
    status: "pending_review",
    createdAt: "2026-07-20T08:00:00.000Z",
    updatedAt: "2026-07-20T08:00:00.000Z",
    generationMode: "ai",
    fallbackReason: null,
    strategicPlan: { framing: "Leadership" },
  }]);

  assert.deepEqual(parsed[0]?.implificationsForLeaders, ["Implication"]);
  assert.deepEqual(parsed[0]?.mechanism, ["Mechanism"]);
  assert.deepEqual(parsed[0]?.whatToWatch, ["Watch"]);
  assert.deepEqual(parsed[0]?.strategicPlan, { framing: "Leadership" });

  const edit = UpdateDigestArticleBody.parse({
    executiveSummary: ["Updated summary"],
    keyTakeaways: ["Updated takeaway"],
    implificationsForLeaders: ["Updated implication"],
  });
  assert.deepEqual(edit.implificationsForLeaders, ["Updated implication"]);
});

test("generated source contracts retain Firestore IDs and bounded weight", () => {
  const parsed = ListSourcesResponse.parse([{
    id: "source-auto-id",
    name: "Example Source",
    url: "https://example.com/feed",
    type: "rss",
    tier: 1,
    isActive: true,
    weight: 1.25,
    createdAt: "2026-07-20T08:00:00.000Z",
  }]);

  assert.equal(parsed[0]?.id, "source-auto-id");
  assert.equal(parsed[0]?.weight, 1.25);
  assert.equal(UpdateSourceBody.parse({ weight: 1.5 }).weight, 1.5);
  assert.equal(UpdateSourceBody.safeParse({ weight: 2.5 }).success, false);
});

test("generated Professor Profile contract exposes only approved matching intelligence and a revision", () => {
  const parsed = ListProfessorProfilesResponse.parse({
    items: [
      {
        id: "prof_contract_01",
        fullName: "Professor Contract",
        academicTitle: "Professor",
        department: "Management",
        coursesTaught: ["Leadership"],
        expertiseTags: ["leadership"],
        researchInterests: ["organizations"],
        professionalExperienceTags: ["board advisory"],
        academicExperienceTags: ["business education"],
        industries: ["higher education"],
        topicInterests: ["corporate governance"],
        regions: ["north america"],
        affiliations: ["RGI University"],
        professionalBackground: "Approved background.",
        approvedBio: "Approved bio.",
        publications: ["Approved citation"],
        publicationTopicTags: ["leadership"],
        recurringThemes: ["institutional trust"],
        contactableTopics: ["leadership"],
        restrictedTopics: ["active litigation"],
        doNotContactTopics: ["personal matters"],
        institutionalConflicts: ["Example Corporation"],
        affiliationConcerns: ["Example Foundation"],
        status: "active",
        schemaVersion: 2,
        profileRevision: 3,
        createdAt: "2026-07-20T08:00:00.000Z",
        updatedAt: "2026-07-20T09:00:00.000Z",
      },
    ],
    total: 1,
    writesEnabled: false,
  });
  assert.equal(parsed.items[0]?.profileRevision, 3);
  assert.deepEqual(parsed.items[0]?.publicationTopicTags, ["leadership"]);
  assert.equal("availability" in parsed.items[0]!, false);
  assert.equal("workload" in parsed.items[0]!, false);
});

test("generated dashboard contract matches emitted fields without topPicks", () => {
  const parsed = GetDashboardSummaryResponse.parse({
    totalArticlesToday: 12,
    pendingReview: 2,
    approvedToday: 1,
    rejectedToday: 0,
    topArticles: [],
    lastScrapeAt: null,
    articlesByTag: [{ tag: "Leadership & Organizations", count: 4 }],
    topicIntelligence: [{
      topic: "Leadership & Organizations",
      articleCount: 4,
      avgRelevancyScore: 8.2,
      importanceScore: 8.7,
      significance: "Four sources show a leadership signal.",
      discipline: "System Vitality",
      hasEmergingSignal: false,
    }],
    totalSources: 32,
    activeSources: 30,
    socialSignalsCount: 0,
    emergingSignalsCount: 1,
    contentWindowStart: "2026-07-20T00:00:00.000Z",
    minTopicScore: 7,
    signalClusters: [{
      topic: "Leadership & Organizations",
      articleCount: 4,
      sourceCount: 3,
      avgRelevancyScore: 8.2,
      strategicImpactScore: 8.4,
      momentumScore: 7.5,
      convergenceScore: 8,
      institutionalRiskScore: 6.5,
      contradictionSignal: false,
      signalStrength: 8,
      narrative: "A cross-source leadership signal.",
    }],
    sectionErrors: [],
    degraded: false,
  });

  assert.equal(parsed.minTopicScore, 7);
  assert.equal(parsed.contentWindowStart, "2026-07-20T00:00:00.000Z");
  assert.equal(parsed.topicIntelligence[0]?.avgRelevancyScore, 8.2);
  assert.equal(parsed.signalClusters?.[0]?.sourceCount, 3);
  assert.equal("topPicks" in parsed, false);
});

test("generated Story Opportunity contracts retain frozen scores, match evidence, and separate coverage", () => {
  const timestamp = "2026-07-20T10:00:00.000Z";
  const window = {
    id: "window_20260720T100000000Z_story-opportunities-v1_r1",
    snapshotRevision: 1,
    asOf: "2026-07-20T15:00:00.000Z",
    windowStart: "2026-07-19T10:00:00.000Z",
    windowEnd: timestamp,
    operationalTimezone: "America/New_York",
    localCutoff: "06:00",
    calculatedAt: "2026-07-20T12:00:00.000Z",
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
    totalArticlesConsidered: 20,
    eligibleArticleCount: 18,
    qualifyingArticleCount: 12,
    opportunityCount: 1,
    fallbackTimestampCount: 0,
  };
  const dimensions = [
    ["core_expertise", "Core expertise", 30],
    ["research_and_teaching", "Research interests and teaching", 15],
    ["experience_and_industries", "Professional/academic experience and industries", 15],
    ["topic_interests", "Topic interests and contactable topics", 15],
    ["publications_and_themes", "Past-publication topics and recurring themes", 15],
    ["regions_and_affiliations", "Regions and affiliations", 10],
  ].map(([dimension, label, weight], index) => ({
    dimension,
    label,
    weight,
    dimensionScore: index === 0 ? 100 : 0,
    weightedContribution: index === 0 ? 30 : 0,
    matchType: index === 0 ? "exact" : "none",
    opportunityConcept: index === 0 ? "leadership-organizations" : null,
    opportunityLabel: index === 0 ? "Leadership & Organizations" : null,
    professorField: index === 0 ? "expertiseTags" : null,
    professorValue: index === 0 ? "Leadership & Organizations" : null,
  }));
  const opportunity = {
    id: "opp_contract_01",
    revision: 1,
    windowId: window.id,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    operationalTimezone: window.operationalTimezone,
    primaryArticleId: 101,
    primaryEvidence: {
      articleId: 101,
      headline: "A leadership signal",
      canonicalUrl: "https://example.com/article",
      sourceName: "Example",
      sourceUrl: "https://example.com",
      author: null,
      excerpt: "Bounded evidence.",
      publishedAt: "2026-07-20T09:00:00.000Z",
      scrapedAt: "2026-07-20T09:05:00.000Z",
      effectivePublishedAt: "2026-07-20T09:00:00.000Z",
      timestampSource: "publishedAt",
      timestampFallback: false,
      capturedAt: window.calculatedAt,
      contentHash: "a".repeat(64),
    },
    supportingEvidence: [],
    sourceName: "Example",
    canonicalUrl: "https://example.com/article",
    effectivePublishedAt: "2026-07-20T09:00:00.000Z",
    timestampSource: "publishedAt",
    timestampFallback: false,
    originalRgiRelevanceScore: 8.4,
    originalRgiRelevanceScale: "1-10",
    originalRgiRelevanceField: "relevancyScore",
    normalizedRgiRelevanceScore: 84,
    relevanceExplanation: "Strong executive relevance.",
    relevanceComponents: { sourceAuthority: 8 },
    relevanceScoringVersion: "rgi-v1",
    relevanceNormalizationVersion: window.normalizationVersion,
    sourceAuthorityScore: 8,
    primaryTopic: "leadership-organizations",
    primaryTopicLabel: "Leadership & Organizations",
    normalizedTopics: ["leadership-and-organizations"],
    unknownTaxonomyTerms: [],
    discipline: "System Vitality",
    industries: [],
    regions: [],
    entities: [],
    recommendedAngle: "What leaders should understand.",
    shortlistPosition: 1,
    selectionConfiguration: {
      minimumNormalizedRelevance: 60,
      maximumOpportunities: 15,
      maximumPerSource: 2,
      maximumPerPrimaryTopic: 3,
      selectionAlgorithmVersion: window.selectionAlgorithmVersion,
    },
    professorMatches: [
      {
        professorId: "prof_contract_01",
        professorName: "Professor Contract",
        profileRevision: 2,
        rank: 1,
        totalFitScore: 30,
        label: "weak",
        dimensions,
        profileCoverage: 30,
        coveredDimensions: ["core_expertise"],
        missingDimensions: ["research_and_teaching", "experience_and_industries", "topic_interests", "publications_and_themes", "regions_and_affiliations"],
        taxonomyVersion: window.taxonomyVersion,
        matchingAlgorithmVersion: window.matchingAlgorithmVersion,
        coverageCalculationVersion: window.coverageCalculationVersion,
        exclusions: [],
        warnings: ["Low profile coverage"],
        rationale: "Weak match with transparent evidence.",
      },
    ],
    selectedProfessor: null,
    selectionHistory: [],
    workflowState: "shortlisted",
    createdAt: window.calculatedAt,
    updatedAt: window.calculatedAt,
    configurationVersion: window.configurationVersion,
    taxonomyVersion: window.taxonomyVersion,
    matchingAlgorithmVersion: window.matchingAlgorithmVersion,
  };
  const parsed = GetCurrentStoryOpportunityWindowResponse.parse({
    window,
    items: [opportunity],
    total: 1,
    readsEnabled: true,
    writesEnabled: false,
  });

  assert.ok(parsed.window?.windowEnd instanceof Date);
  assert.equal(parsed.items[0]?.normalizedRgiRelevanceScore, 84);
  assert.equal(parsed.items[0]?.professorMatches[0]?.profileCoverage, 30);
  assert.equal(parsed.items[0]?.professorMatches[0]?.dimensions.length, 6);
  assert.equal(parsed.items[0]?.professorMatches[0]?.dimensions[0]?.professorField, "expertiseTags");
  assert.equal(
    GetCurrentStoryOpportunityWindowResponse.safeParse({
      window,
      items: [
        {
          ...opportunity,
          professorMatches: [
            {
              ...opportunity.professorMatches[0],
              dimensions: dimensions.slice(0, 5),
            },
          ],
        },
      ],
      total: 1,
      readsEnabled: true,
      writesEnabled: false,
    }).success,
    false,
  );
  assert.equal(
    SelectStoryOpportunityProfessorBody.parse({
      professorId: "prof_contract_01",
      expectedRevision: 1,
    }).expectedRevision,
    1,
  );
  assert.equal(
    SelectStoryOpportunityProfessorBody.safeParse({
      professorId: "bad",
      expectedRevision: 1,
    }).success,
    false,
  );
});
