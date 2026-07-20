import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GetDashboardSummaryResponse,
  ListArticlesResponse,
  ListDigestArticlesResponse,
  ListSourcesResponse,
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
