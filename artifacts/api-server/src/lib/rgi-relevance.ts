import type { Article } from "@workspace/db";

export type RgiRecommendedUse = "feed" | "dashboard" | "daily_brief" | "reject" | "needs_review";

export const RGI_PROFILE = {
  name: "RGI Strategic Intelligence Analyst Profile",
  freshWindowHours: 24,
  ingestionThreshold: 4.0,
  feedThreshold: 4.0,
  dashboardThreshold: 5.5,
  dailyBriefThreshold: 7.0,
  scoreScale: {
    irrelevant: "1-3",
    potentiallyRelevant: "4-5",
    important: "6-7",
    highlyImportant: "8-9",
    majorStrategicDevelopment: "10",
  },
  dailyBriefRankingPriorities: [
    "strategic relevance",
    "executive relevance",
    "geopolitical significance",
    "macroeconomic significance",
    "recency",
    "source quality",
  ],
  priorities: [
    "geopolitical risk",
    "global leadership",
    "governance and institutions",
    "strategic foresight",
    "macroeconomic risk",
    "business leadership",
    "supply chains",
    "energy and commodities",
    "technology, AI, and innovation",
    "international conflict and security",
    "market-moving events",
    "policy and regulation",
    "organizational resilience",
    "executive decision-making implications",
  ],
} as const;

export function dateFromUnknown(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export function hoursSince(value: unknown, now = new Date()): number | null {
  const date = dateFromUnknown(value);
  if (!date) return null;
  return (now.getTime() - date.getTime()) / (60 * 60 * 1000);
}

export function isWithinFreshWindow(value: unknown, now = new Date()): boolean {
  const ageHours = hoursSince(value, now);
  return ageHours !== null && ageHours >= 0 && ageHours <= RGI_PROFILE.freshWindowHours;
}

export function recencyScoreForPublishedAt(value: unknown, now = new Date()): number {
  const ageHours = hoursSince(value, now);
  if (ageHours === null || ageHours < 0) return 0;
  if (ageHours <= 6) return 10;
  if (ageHours <= 12) return 8;
  if (ageHours <= 24) return 6;
  if (ageHours <= 48) return 2;
  return 0;
}

export function recommendedUseForScores(input: {
  publishedAt?: unknown;
  relevancyScore: number;
  sourceAuthorityScore?: number;
  strategicImpactScore?: number;
  executiveRelevanceScore?: number;
  now?: Date;
}): {
  recommendedUse: RgiRecommendedUse;
  recencyScore: number;
  reasonForAcceptance: string | null;
  reasonForRejection: string | null;
} {
  const now = input.now ?? new Date();
  const recencyScore = recencyScoreForPublishedAt(input.publishedAt, now);
  const published = dateFromUnknown(input.publishedAt);
  const score = Number(input.relevancyScore ?? 0);
  const strategic = Number(input.strategicImpactScore ?? score);
  const executive = Number(input.executiveRelevanceScore ?? score);

  if (!published) {
    return {
      recommendedUse: "needs_review",
      recencyScore,
      reasonForAcceptance: null,
      reasonForRejection: "Publication date missing or unreliable; held for analyst review instead of normal feed/brief use.",
    };
  }

  if (!isWithinFreshWindow(published, now)) {
    return {
      recommendedUse: "reject",
      recencyScore,
      reasonForAcceptance: null,
      reasonForRejection: `Published outside the ${RGI_PROFILE.freshWindowHours}-hour RGI intelligence window.`,
    };
  }

  if (score < RGI_PROFILE.ingestionThreshold) {
    return {
      recommendedUse: "reject",
      recencyScore,
      reasonForAcceptance: null,
      reasonForRejection: `RGI relevance ${score.toFixed(1)} is below ingestion threshold ${RGI_PROFILE.ingestionThreshold.toFixed(1)}.`,
    };
  }

  if (score >= RGI_PROFILE.dailyBriefThreshold) {
    return {
      recommendedUse: "daily_brief",
      recencyScore,
      reasonForAcceptance: "Fresh, high-relevance strategic signal suitable for Daily Brief consideration.",
      reasonForRejection: null,
    };
  }

  if (score >= RGI_PROFILE.dashboardThreshold) {
    return {
      recommendedUse: "dashboard",
      recencyScore,
      reasonForAcceptance: "Fresh strategic signal suitable for dashboard visibility.",
      reasonForRejection: null,
    };
  }

  return {
    recommendedUse: "feed",
    recencyScore,
    reasonForAcceptance: "Fresh article with enough RGI relevance for the Intelligence Feed.",
    reasonForRejection: null,
  };
}

export function articleIsFreshForNormalUse(article: Article & Record<string, unknown>, now = new Date()): boolean {
  return isWithinFreshWindow(article.publishedAt, now);
}

export function articleRecommendedFor(article: Article & Record<string, unknown>, use: "feed" | "dashboard" | "daily_brief", now = new Date()): boolean {
  if (!articleIsFreshForNormalUse(article, now)) return false;
  const recommendedUse = String(article.recommendedUse ?? "");
  const score = Number(article.relevancyScore ?? 0);
  if (recommendedUse === "reject" || recommendedUse === "needs_review") return false;
  if (use === "daily_brief") return recommendedUse === "daily_brief" || score >= RGI_PROFILE.dailyBriefThreshold;
  if (use === "dashboard") return ["dashboard", "daily_brief"].includes(recommendedUse) || score >= RGI_PROFILE.dashboardThreshold;
  return ["feed", "dashboard", "daily_brief", ""].includes(recommendedUse) && score >= RGI_PROFILE.feedThreshold;
}
