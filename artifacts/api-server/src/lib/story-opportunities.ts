import { createHash } from "node:crypto";
import type { Article } from "@workspace/db";
import type { ProfessorProfile } from "@workspace/api-zod";
import {
  STORY_MATCHING_TAXONOMY_VERSION,
  normalizeTaxonomyTerm,
  resolveTaxonomyTerm,
  taxonomyLabel,
  taxonomyTopicsRelated,
  type ResolvedTaxonomyTerm,
} from "./story-opportunity-taxonomy";

export const STORY_OPPORTUNITY_CONFIGURATION_VERSION = "story-opportunities-v1";
export const STORY_OPPORTUNITY_WINDOW_ALGORITHM_VERSION =
  "eastern-cutoff-24h-v1";
export const STORY_OPPORTUNITY_SELECTION_ALGORITHM_VERSION =
  "rgi-shortlist-diversity-v1";
export const RGI_RELEVANCE_NORMALIZATION_VERSION =
  "stored-relevancy-1-to-10-x10-v1";
export const PROFESSOR_MATCHING_ALGORITHM_VERSION =
  "deterministic-six-dimension-v1";
export const PROFILE_COVERAGE_VERSION = "weighted-dimension-presence-v1";
export const OPERATIONAL_TIMEZONE = "America/New_York";
export const OPERATIONAL_CUTOFF = "06:00";
export const MINIMUM_NORMALIZED_RELEVANCE = 60;
export const MAX_STORY_OPPORTUNITIES = 15;
export const MAX_PER_SOURCE = 2;
export const MAX_PER_PRIMARY_TOPIC = 3;
export const LOW_PROFILE_COVERAGE_THRESHOLD = 50;

export type StoryOpportunityState =
  | "shortlisted"
  | "professor_selected"
  | "closed";
export type MatchType = "exact" | "alias" | "parent_child" | "none";
export type MatchLabel = "strong" | "plausible" | "weak";
export type MatchDimensionKey =
  | "core_expertise"
  | "research_and_teaching"
  | "experience_and_industries"
  | "topic_interests"
  | "publications_and_themes"
  | "regions_and_affiliations";

export const MATCH_DIMENSIONS: readonly {
  key: MatchDimensionKey;
  label: string;
  weight: number;
  fields: readonly (keyof ProfessorProfile)[];
}[] = [
  {
    key: "core_expertise",
    label: "Core expertise",
    weight: 30,
    fields: ["expertiseTags"],
  },
  {
    key: "research_and_teaching",
    label: "Research interests and teaching",
    weight: 15,
    fields: ["researchInterests", "coursesTaught"],
  },
  {
    key: "experience_and_industries",
    label: "Professional/academic experience and industries",
    weight: 15,
    fields: [
      "professionalExperienceTags",
      "academicExperienceTags",
      "industries",
    ],
  },
  {
    key: "topic_interests",
    label: "Topic interests and contactable topics",
    weight: 15,
    fields: ["topicInterests", "contactableTopics"],
  },
  {
    key: "publications_and_themes",
    label: "Past-publication topics and recurring themes",
    weight: 15,
    fields: ["publicationTopicTags", "recurringThemes"],
  },
  {
    key: "regions_and_affiliations",
    label: "Regions and affiliations",
    weight: 10,
    fields: ["regions", "affiliations"],
  },
] as const;

export type StoryOpportunityWindow = {
  id: string;
  snapshotRevision: number;
  asOf: string;
  windowStart: string;
  windowEnd: string;
  operationalTimezone: string;
  localCutoff: string;
  calculatedAt: string;
  status: "completed";
  configurationVersion: string;
  windowAlgorithmVersion: string;
  selectionAlgorithmVersion: string;
  scoringVersion: string;
  normalizationVersion: string;
  taxonomyVersion: string;
  matchingAlgorithmVersion: string;
  coverageCalculationVersion: string;
  minimumNormalizedRelevance: number;
  maximumOpportunities: number;
  maximumPerSource: number;
  maximumPerPrimaryTopic: number;
  lowCoverageWarningThreshold: number;
  totalArticlesConsidered: number;
  eligibleArticleCount: number;
  qualifyingArticleCount: number;
  opportunityCount: number;
  fallbackTimestampCount: number;
};

export type SourceEvidenceSnapshot = {
  articleId: number;
  headline: string;
  canonicalUrl: string;
  sourceName: string;
  sourceUrl: string | null;
  author: string | null;
  excerpt: string | null;
  publishedAt: string | null;
  scrapedAt: string | null;
  effectivePublishedAt: string;
  timestampSource: "publishedAt" | "scrapedAt";
  timestampFallback: boolean;
  capturedAt: string;
  contentHash: string;
};

export type ProfessorDimensionMatch = {
  dimension: MatchDimensionKey;
  label: string;
  weight: number;
  dimensionScore: number;
  weightedContribution: number;
  matchType: MatchType;
  opportunityConcept: string | null;
  opportunityLabel: string | null;
  professorField: string | null;
  professorValue: string | null;
};

export type ProfessorMatch = {
  professorId: string;
  professorName: string;
  profileRevision: number;
  rank: number | null;
  totalFitScore: number;
  label: MatchLabel;
  dimensions: ProfessorDimensionMatch[];
  profileCoverage: number;
  coveredDimensions: MatchDimensionKey[];
  missingDimensions: MatchDimensionKey[];
  taxonomyVersion: string;
  matchingAlgorithmVersion: string;
  coverageCalculationVersion: string;
  exclusions: string[];
  warnings: string[];
  rationale: string;
};

export type ProfessorSelection = {
  professorId: string;
  professorName: string;
  selectedProfileRevision: number;
  selectedMatchRank: number;
  selectedFitScore: number;
  reason: string | null;
  selectedBy: string;
  selectedAt: string;
};

export type ProfessorSelectionHistoryEntry = {
  id: string;
  action: "selected" | "changed" | "cleared";
  professorId: string | null;
  professorName: string | null;
  previousProfessorId: string | null;
  selectedProfileRevision: number | null;
  reason: string | null;
  actorId: string;
  occurredAt: string;
};

export type StoryOpportunity = {
  id: string;
  revision: number;
  windowId: string;
  windowStart: string;
  windowEnd: string;
  operationalTimezone: string;
  primaryArticleId: number;
  primaryEvidence: SourceEvidenceSnapshot;
  supportingEvidence: SourceEvidenceSnapshot[];
  sourceName: string;
  canonicalUrl: string;
  effectivePublishedAt: string;
  timestampSource: "publishedAt" | "scrapedAt";
  timestampFallback: boolean;
  originalRgiRelevanceScore: number;
  originalRgiRelevanceScale: "1-10";
  originalRgiRelevanceField: "relevancyScore";
  normalizedRgiRelevanceScore: number;
  relevanceExplanation: string | null;
  relevanceComponents: Record<string, unknown> | null;
  relevanceScoringVersion: string;
  relevanceNormalizationVersion: string;
  sourceAuthorityScore: number;
  primaryTopic: string;
  primaryTopicLabel: string;
  normalizedTopics: string[];
  unknownTaxonomyTerms: string[];
  discipline: string | null;
  industries: string[];
  regions: string[];
  entities: string[];
  recommendedAngle: string;
  shortlistPosition: number;
  selectionConfiguration: {
    minimumNormalizedRelevance: number;
    maximumOpportunities: number;
    maximumPerSource: number;
    maximumPerPrimaryTopic: number;
    selectionAlgorithmVersion: string;
  };
  professorMatches: ProfessorMatch[];
  selectedProfessor: ProfessorSelection | null;
  selectionHistory: ProfessorSelectionHistoryEntry[];
  workflowState: StoryOpportunityState;
  createdAt: string;
  updatedAt: string;
  configurationVersion: string;
  taxonomyVersion: string;
  matchingAlgorithmVersion: string;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const easternFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: OPERATIONAL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function zonedParts(date: Date): ZonedParts {
  const values = Object.fromEntries(
    easternFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return values as ZonedParts;
}

function utcForEasternLocal(parts: ZonedParts): Date {
  const desiredAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let instant = desiredAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(instant));
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const adjustment = desiredAsUtc - actualAsUtc;
    instant += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(instant);
}

function previousCalendarDay(parts: ZonedParts): ZonedParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day - 1));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function calculateOpportunityWindowBounds(asOf: Date): {
  windowStart: Date;
  windowEnd: Date;
} {
  if (!Number.isFinite(asOf.getTime()))
    throw new Error("asOf must be a valid date-time");
  const local = zonedParts(asOf);
  let cutoffParts: ZonedParts = { ...local, hour: 6, minute: 0, second: 0 };
  if (local.hour < 6) cutoffParts = previousCalendarDay(cutoffParts);
  const windowEnd = utcForEasternLocal(cutoffParts);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);
  return { windowStart, windowEnd };
}

function stableTimestamp(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

export function effectiveArticleTimestamp(article: Article): {
  timestamp: Date | null;
  source: "publishedAt" | "scrapedAt" | null;
  fallback: boolean;
} {
  const publishedAt = stableTimestamp(article.publishedAt);
  if (publishedAt)
    return { timestamp: publishedAt, source: "publishedAt", fallback: false };
  const scrapedAt = stableTimestamp(article.scrapedAt);
  if (scrapedAt)
    return { timestamp: scrapedAt, source: "scrapedAt", fallback: true };
  return { timestamp: null, source: null, fallback: false };
}

export function normalizeRgiRelevance(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.min(100, Math.max(0, score * 10));
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maximum) : null;
}

function articleTopics(article: Article): {
  primaryTopic: string;
  primaryTopicLabel: string;
  normalizedTopics: string[];
  unknownTaxonomyTerms: string[];
} {
  const raw = [
    ...(Array.isArray(article.topicTags) ? article.topicTags : []),
    ...(article.disciplineAlignment ? [article.disciplineAlignment] : []),
  ].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  const resolved = raw.map(resolveTaxonomyTerm);
  // Preserve the normalized source term so exact-versus-alias evidence remains
  // auditable. Canonical slugs are still used for primary-topic diversity.
  const normalizedTopics = [
    ...new Set(resolved.map((term) => term.normalized).filter(Boolean)),
  ];
  const unknownTaxonomyTerms = [
    ...new Set(
      resolved
        .filter((term) => term.resolution === "unknown")
        .map((term) => term.original.trim()),
    ),
  ];
  const primary = resolved[0];
  return {
    primaryTopic: primary?.canonicalSlug ?? primary?.normalized ?? "untagged",
    primaryTopicLabel: primary?.displayLabel ?? "Untagged",
    normalizedTopics,
    unknownTaxonomyTerms,
  };
}

function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function makeEvidence(
  article: Article,
  effective: Date,
  timestampSource: "publishedAt" | "scrapedAt",
  capturedAt: string,
): SourceEvidenceSnapshot {
  const excerpt =
    boundedText(article.teaserSummary, 1000) ??
    boundedText(article.content, 1000);
  const snapshot = {
    articleId: Number(article.id),
    headline: String(article.headline),
    canonicalUrl: String(article.url),
    sourceName: String(article.sourceName),
    sourceUrl: typeof article.sourceUrl === "string" ? article.sourceUrl : null,
    author: typeof article.author === "string" ? article.author : null,
    excerpt,
    publishedAt: stableTimestamp(article.publishedAt)?.toISOString() ?? null,
    scrapedAt: stableTimestamp(article.scrapedAt)?.toISOString() ?? null,
    effectivePublishedAt: effective.toISOString(),
    timestampSource,
    timestampFallback: timestampSource === "scrapedAt",
    capturedAt,
  };
  return { ...snapshot, contentHash: contentHash(snapshot) };
}

function articleScoringVersion(article: Article): string {
  const extended = article as Article & { rgiProfileVersion?: unknown };
  return typeof extended.rgiProfileVersion === "string" &&
    extended.rgiProfileVersion.trim()
    ? extended.rgiProfileVersion.trim()
    : "legacy-stored-relevancy-score";
}

type EligibleArticle = {
  article: Article;
  effectiveTimestamp: Date;
  timestampSource: "publishedAt" | "scrapedAt";
  normalizedScore: number;
  primaryTopic: string;
  primaryTopicLabel: string;
  normalizedTopics: string[];
  unknownTaxonomyTerms: string[];
  sourceAuthorityScore: number;
};

export function shortlistArticles(
  articles: Article[],
  bounds: { windowStart: Date; windowEnd: Date },
): {
  eligible: EligibleArticle[];
  qualifying: EligibleArticle[];
  shortlisted: EligibleArticle[];
} {
  const eligible = articles.flatMap((article): EligibleArticle[] => {
    const effective = effectiveArticleTimestamp(article);
    if (!effective.timestamp || !effective.source) return [];
    if (
      effective.timestamp < bounds.windowStart ||
      effective.timestamp >= bounds.windowEnd
    )
      return [];
    const topics = articleTopics(article);
    return [
      {
        article,
        effectiveTimestamp: effective.timestamp,
        timestampSource: effective.source,
        normalizedScore: normalizeRgiRelevance(Number(article.relevancyScore)),
        ...topics,
        sourceAuthorityScore: Number.isFinite(
          Number(
            (article as Article & { sourceAuthorityScore?: unknown })
              .sourceAuthorityScore,
          ),
        )
          ? Number(
              (article as Article & { sourceAuthorityScore?: unknown })
                .sourceAuthorityScore,
            )
          : 0,
      },
    ];
  });
  const qualifying = eligible.filter(
    (candidate) => candidate.normalizedScore >= MINIMUM_NORMALIZED_RELEVANCE,
  );
  qualifying.sort(
    (left, right) =>
      right.normalizedScore - left.normalizedScore ||
      right.effectiveTimestamp.getTime() - left.effectiveTimestamp.getTime() ||
      right.sourceAuthorityScore - left.sourceAuthorityScore ||
      Number(left.article.id) - Number(right.article.id),
  );

  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  const shortlisted: EligibleArticle[] = [];
  for (const candidate of qualifying) {
    const source = candidate.article.sourceName.trim().toLowerCase();
    if ((sourceCounts.get(source) ?? 0) >= MAX_PER_SOURCE) continue;
    if ((topicCounts.get(candidate.primaryTopic) ?? 0) >= MAX_PER_PRIMARY_TOPIC)
      continue;
    shortlisted.push(candidate);
    sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    topicCounts.set(
      candidate.primaryTopic,
      (topicCounts.get(candidate.primaryTopic) ?? 0) + 1,
    );
    if (shortlisted.length >= MAX_STORY_OPPORTUNITIES) break;
  }
  return { eligible, qualifying, shortlisted };
}

function stringValues(
  profile: ProfessorProfile,
  fields: readonly (keyof ProfessorProfile)[],
): { field: string; value: string }[] {
  return fields.flatMap((field) => {
    const value = profile[field];
    return Array.isArray(value)
      ? value
          .filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
          .map((item) => ({ field: String(field), value: item }))
      : [];
  });
}

function stableTextCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareApprovedTerms(
  opportunity: ResolvedTaxonomyTerm,
  profileValue: string,
): { score: number; type: MatchType } {
  const profile = resolveTaxonomyTerm(profileValue);
  if (!opportunity.canonicalSlug || !profile.canonicalSlug)
    return { score: 0, type: "none" };
  if (
    opportunity.normalized === profile.normalized &&
    opportunity.canonicalSlug === profile.canonicalSlug
  )
    return { score: 100, type: "exact" };
  if (opportunity.canonicalSlug === profile.canonicalSlug)
    return { score: 80, type: "alias" };
  if (taxonomyTopicsRelated(opportunity.canonicalSlug, profile.canonicalSlug))
    return { score: 50, type: "parent_child" };
  return { score: 0, type: "none" };
}

function compareForHardTopicExclusion(
  opportunity: ResolvedTaxonomyTerm,
  profileValue: string,
): MatchType {
  const profile = resolveTaxonomyTerm(profileValue);
  if (!opportunity.canonicalSlug || !profile.canonicalSlug) return "none";
  if (opportunity.normalized && opportunity.normalized === profile.normalized)
    return "exact";
  if (opportunity.canonicalSlug === profile.canonicalSlug) return "alias";
  return "none";
}

function bestDimensionMatch(
  dimension: (typeof MATCH_DIMENSIONS)[number],
  opportunityTerms: ResolvedTaxonomyTerm[],
  profile: ProfessorProfile,
): ProfessorDimensionMatch {
  const candidates = stringValues(profile, dimension.fields)
    .flatMap(({ field, value }) =>
      opportunityTerms.map((opportunity) => ({
        field,
        value,
        opportunity,
        ...compareApprovedTerms(opportunity, value),
      })),
    )
    .filter((candidate) => candidate.score > 0);
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      stableTextCompare(
        left.opportunity.canonicalSlug ?? left.opportunity.normalized,
        right.opportunity.canonicalSlug ?? right.opportunity.normalized,
      ) ||
      stableTextCompare(left.field, right.field) ||
      stableTextCompare(
        normalizeTaxonomyTerm(left.value),
        normalizeTaxonomyTerm(right.value),
      ),
  );
  const best = candidates[0];
  const dimensionScore = best?.score ?? 0;
  return {
    dimension: dimension.key,
    label: dimension.label,
    weight: dimension.weight,
    dimensionScore,
    weightedContribution: Math.round(dimensionScore * dimension.weight) / 100,
    matchType: best?.type ?? "none",
    opportunityConcept: best
      ? (best.opportunity.canonicalSlug ?? best.opportunity.normalized)
      : null,
    opportunityLabel: best ? best.opportunity.displayLabel : null,
    professorField: best?.field ?? null,
    professorValue: best?.value ?? null,
  };
}

export function professorMatchLabel(score: number): MatchLabel {
  if (score >= 70) return "strong";
  if (score >= 50) return "plausible";
  return "weak";
}

export function calculateProfileCoverage(profile: ProfessorProfile): {
  coverage: number;
  coveredDimensions: MatchDimensionKey[];
  missingDimensions: MatchDimensionKey[];
} {
  const coveredDimensions = MATCH_DIMENSIONS.filter((dimension) =>
    stringValues(profile, dimension.fields).some(
      ({ value }) => resolveTaxonomyTerm(value).canonicalSlug !== null,
    ),
  ).map((dimension) => dimension.key);
  const covered = new Set(coveredDimensions);
  const missingDimensions = MATCH_DIMENSIONS.filter(
    (dimension) => !covered.has(dimension.key),
  ).map((dimension) => dimension.key);
  const coverage = MATCH_DIMENSIONS.filter((dimension) =>
    covered.has(dimension.key),
  ).reduce((sum, dimension) => sum + dimension.weight, 0);
  return { coverage, coveredDimensions, missingDimensions };
}

function institutionalCandidates(
  opportunity: Pick<
    StoryOpportunity,
    "sourceName" | "canonicalUrl" | "entities"
  >,
): string[] {
  let hostname = "";
  try {
    hostname = new URL(opportunity.canonicalUrl).hostname.replace(/^www\./, "");
  } catch {
    /* malformed URL remains visible elsewhere */
  }
  return [opportunity.sourceName, hostname, ...opportunity.entities]
    .map(normalizeTaxonomyTerm)
    .filter(Boolean);
}

export function professorHardExclusionsForOpportunity(
  opportunity: Pick<
    StoryOpportunity,
    | "normalizedTopics"
    | "sourceName"
    | "canonicalUrl"
    | "entities"
  >,
  profile: ProfessorProfile,
): string[] {
  const exclusions: string[] = [];
  const opportunityTerms = opportunity.normalizedTopics.map((term) =>
    resolveTaxonomyTerm(term),
  );
  const restrictedValues = [
    ...profile.restrictedTopics,
    ...profile.doNotContactTopics,
  ];
  const restrictedMatch = restrictedValues
    .flatMap((value) =>
      opportunityTerms.map((term) => ({
        value,
        term,
        type: compareForHardTopicExclusion(term, value),
      })),
    )
    .find(
      (candidate) => candidate.type === "exact" || candidate.type === "alias",
    );
  if (restrictedMatch) {
    exclusions.push(
      `Hard restricted topic: “${restrictedMatch.value}” ${restrictedMatch.type === "exact" ? "exactly matches" : "is an approved alias of"} “${restrictedMatch.term.displayLabel}”.`,
    );
  }

  const institutionTerms = institutionalCandidates(opportunity);
  const hardConflict = profile.institutionalConflicts.find((value) =>
    institutionTerms.includes(normalizeTaxonomyTerm(value)),
  );
  if (hardConflict) {
    exclusions.push(
      `Hard institutional conflict: “${hardConflict}” matches the story source or named entity.`,
    );
  }
  return exclusions;
}

function exclusionAndWarnings(
  opportunity: StoryOpportunity,
  profile: ProfessorProfile,
  coverage: number,
  label: MatchLabel,
): { exclusions: string[]; warnings: string[] } {
  const exclusions: string[] = [];
  const warnings: string[] = [];
  if (profile.status !== "active")
    exclusions.push(
      "Professor Profile is inactive and excluded from matching.",
    );
  exclusions.push(...professorHardExclusionsForOpportunity(opportunity, profile));
  const institutionTerms = institutionalCandidates(opportunity);
  const softConflict = profile.affiliationConcerns.find((value) =>
    institutionTerms.includes(normalizeTaxonomyTerm(value)),
  );
  if (softConflict)
    warnings.push(
      `Affiliation/conflict concern: “${softConflict}” matches the story source or named entity.`,
    );
  if (coverage < LOW_PROFILE_COVERAGE_THRESHOLD)
    warnings.push(
      `Low profile coverage: ${coverage}% is below the ${LOW_PROFILE_COVERAGE_THRESHOLD}% review threshold.`,
    );
  if (label === "weak")
    warnings.push(
      "Weak professor fit: selection requires an editor override reason.",
    );
  const unknownProfileAttributes = MATCH_DIMENSIONS.flatMap((dimension) =>
    stringValues(profile, dimension.fields)
      .filter(({ value }) => resolveTaxonomyTerm(value).canonicalSlug === null)
      .map(({ field, value }) => `${field}: “${value}”`),
  );
  if (unknownProfileAttributes.length) {
    warnings.push(
      `Professor Profile taxonomy review needed for: ${unknownProfileAttributes.join(", ")}.`,
    );
  }
  if (opportunity.unknownTaxonomyTerms.length)
    warnings.push(
      `Taxonomy review needed for: ${opportunity.unknownTaxonomyTerms.join(", ")}.`,
    );
  return { exclusions, warnings };
}

function rationaleForMatch(
  match: Omit<ProfessorMatch, "rationale" | "rank">,
): string {
  const matched = match.dimensions.filter(
    (dimension) => dimension.matchType !== "none",
  );
  const unmatched = match.dimensions
    .filter((dimension) => dimension.matchType === "none")
    .map((dimension) => dimension.label);
  const evidence = matched.length
    ? matched
        .map(
          (dimension) =>
            `${dimension.label} ${dimension.matchType.replace("_", "/")} matched “${dimension.professorValue}” to “${dimension.opportunityLabel}” (${dimension.dimensionScore}/100)`,
        )
        .join("; ")
    : "No approved taxonomy matches were found";
  const gaps = unmatched.length
    ? ` No story match in: ${unmatched.join(", ")}.`
    : " All six dimensions matched.";
  const missing = match.missingDimensions.length
    ? ` No approved taxonomy-covered profile attributes in: ${match.missingDimensions.map((key) => MATCH_DIMENSIONS.find((dimension) => dimension.key === key)?.label ?? key).join(", ")}.`
    : " Profile information covers all six dimensions.";
  const excluded = match.exclusions.length
    ? ` Excluded: ${match.exclusions.join(" ")}`
    : "";
  return `${match.label[0].toUpperCase()}${match.label.slice(1)} match (${match.totalFitScore}/100). ${evidence}.${gaps} Profile coverage is ${match.profileCoverage}%.${missing}${excluded}`;
}

export function matchProfessors(
  opportunity: StoryOpportunity,
  profiles: ProfessorProfile[],
): ProfessorMatch[] {
  const opportunityTerms = opportunity.normalizedTopics.map((term) =>
    resolveTaxonomyTerm(term),
  );
  const matches = profiles.map((profile): ProfessorMatch => {
    const dimensions = MATCH_DIMENSIONS.map((dimension) =>
      bestDimensionMatch(dimension, opportunityTerms, profile),
    );
    const totalFitScore =
      Math.round(
        dimensions.reduce(
          (sum, dimension) => sum + dimension.weightedContribution,
          0,
        ) * 100,
      ) / 100;
    const label = professorMatchLabel(totalFitScore);
    const coverage = calculateProfileCoverage(profile);
    const { exclusions, warnings } = exclusionAndWarnings(
      opportunity,
      profile,
      coverage.coverage,
      label,
    );
    const base = {
      professorId: profile.id,
      professorName: profile.fullName,
      profileRevision: profile.profileRevision,
      totalFitScore,
      label,
      dimensions,
      profileCoverage: coverage.coverage,
      coveredDimensions: coverage.coveredDimensions,
      missingDimensions: coverage.missingDimensions,
      taxonomyVersion: STORY_MATCHING_TAXONOMY_VERSION,
      matchingAlgorithmVersion: PROFESSOR_MATCHING_ALGORITHM_VERSION,
      coverageCalculationVersion: PROFILE_COVERAGE_VERSION,
      exclusions,
      warnings,
    };
    return { ...base, rank: null, rationale: rationaleForMatch(base) };
  });
  matches.sort(
    (left, right) =>
      Number(left.exclusions.length > 0) -
        Number(right.exclusions.length > 0) ||
      right.totalFitScore - left.totalFitScore ||
      stableTextCompare(left.professorName, right.professorName) ||
      stableTextCompare(left.professorId, right.professorId),
  );
  let rank = 0;
  return matches.map((match) =>
    match.exclusions.length ? match : { ...match, rank: ++rank },
  );
}

function deterministicWindowId(
  windowEnd: Date,
  snapshotRevision: number,
): string {
  const end = windowEnd.toISOString().replace(/[-:.]/g, "");
  return `window_${end}_${STORY_OPPORTUNITY_CONFIGURATION_VERSION}_r${snapshotRevision}`;
}

function deterministicOpportunityId(
  windowId: string,
  articleId: number,
): string {
  return `opp_${createHash("sha256").update(`${windowId}:${articleId}`).digest("hex").slice(0, 24)}`;
}

export function buildFrozenOpportunityWindow(input: {
  articles: Article[];
  professorProfiles: ProfessorProfile[];
  asOf: Date;
  calculatedAt?: Date;
  snapshotRevision?: number;
}): { window: StoryOpportunityWindow; opportunities: StoryOpportunity[] } {
  const calculatedAt = (input.calculatedAt ?? new Date()).toISOString();
  const snapshotRevision = input.snapshotRevision ?? 1;
  if (!Number.isInteger(snapshotRevision) || snapshotRevision < 1)
    throw new Error("snapshotRevision must be a positive integer");
  const bounds = calculateOpportunityWindowBounds(input.asOf);
  const candidates = shortlistArticles(input.articles, bounds);
  const windowId = deterministicWindowId(bounds.windowEnd, snapshotRevision);
  const opportunities = candidates.shortlisted.map(
    (candidate, index): StoryOpportunity => {
      const extended = candidate.article as Article & {
        scoreExplanation?: unknown;
        scoreBreakdown?: unknown;
        reasonForAcceptance?: unknown;
      };
      const evidence = makeEvidence(
        candidate.article,
        candidate.effectiveTimestamp,
        candidate.timestampSource,
        calculatedAt,
      );
      const opportunity: StoryOpportunity = {
        id: deterministicOpportunityId(windowId, Number(candidate.article.id)),
        revision: 1,
        windowId,
        windowStart: bounds.windowStart.toISOString(),
        windowEnd: bounds.windowEnd.toISOString(),
        operationalTimezone: OPERATIONAL_TIMEZONE,
        primaryArticleId: Number(candidate.article.id),
        primaryEvidence: evidence,
        supportingEvidence: [],
        sourceName: candidate.article.sourceName,
        canonicalUrl: candidate.article.url,
        effectivePublishedAt: candidate.effectiveTimestamp.toISOString(),
        timestampSource: candidate.timestampSource,
        timestampFallback: candidate.timestampSource === "scrapedAt",
        originalRgiRelevanceScore: Number(candidate.article.relevancyScore),
        originalRgiRelevanceScale: "1-10",
        originalRgiRelevanceField: "relevancyScore",
        normalizedRgiRelevanceScore: candidate.normalizedScore,
        relevanceExplanation: boundedText(extended.scoreExplanation, 1000),
        relevanceComponents:
          extended.scoreBreakdown && typeof extended.scoreBreakdown === "object"
            ? (extended.scoreBreakdown as Record<string, unknown>)
            : null,
        relevanceScoringVersion: articleScoringVersion(candidate.article),
        relevanceNormalizationVersion: RGI_RELEVANCE_NORMALIZATION_VERSION,
        sourceAuthorityScore: candidate.sourceAuthorityScore,
        primaryTopic: candidate.primaryTopic,
        primaryTopicLabel: candidate.primaryTopicLabel,
        normalizedTopics: candidate.normalizedTopics,
        unknownTaxonomyTerms: candidate.unknownTaxonomyTerms,
        discipline: candidate.article.disciplineAlignment ?? null,
        industries: [],
        regions: [],
        entities: [],
        recommendedAngle:
          boundedText(extended.reasonForAcceptance, 500) ??
          boundedText(extended.scoreExplanation, 500) ??
          "Explore the RGI implications of this development.",
        shortlistPosition: index + 1,
        selectionConfiguration: {
          minimumNormalizedRelevance: MINIMUM_NORMALIZED_RELEVANCE,
          maximumOpportunities: MAX_STORY_OPPORTUNITIES,
          maximumPerSource: MAX_PER_SOURCE,
          maximumPerPrimaryTopic: MAX_PER_PRIMARY_TOPIC,
          selectionAlgorithmVersion:
            STORY_OPPORTUNITY_SELECTION_ALGORITHM_VERSION,
        },
        professorMatches: [],
        selectedProfessor: null,
        selectionHistory: [],
        workflowState: "shortlisted",
        createdAt: calculatedAt,
        updatedAt: calculatedAt,
        configurationVersion: STORY_OPPORTUNITY_CONFIGURATION_VERSION,
        taxonomyVersion: STORY_MATCHING_TAXONOMY_VERSION,
        matchingAlgorithmVersion: PROFESSOR_MATCHING_ALGORITHM_VERSION,
      };
      opportunity.professorMatches = matchProfessors(
        opportunity,
        input.professorProfiles,
      );
      return opportunity;
    },
  );
  const window: StoryOpportunityWindow = {
    id: windowId,
    snapshotRevision,
    asOf: input.asOf.toISOString(),
    windowStart: bounds.windowStart.toISOString(),
    windowEnd: bounds.windowEnd.toISOString(),
    operationalTimezone: OPERATIONAL_TIMEZONE,
    localCutoff: OPERATIONAL_CUTOFF,
    calculatedAt,
    status: "completed",
    configurationVersion: STORY_OPPORTUNITY_CONFIGURATION_VERSION,
    windowAlgorithmVersion: STORY_OPPORTUNITY_WINDOW_ALGORITHM_VERSION,
    selectionAlgorithmVersion: STORY_OPPORTUNITY_SELECTION_ALGORITHM_VERSION,
    scoringVersion: "stored-canonical-rgi-relevance",
    normalizationVersion: RGI_RELEVANCE_NORMALIZATION_VERSION,
    taxonomyVersion: STORY_MATCHING_TAXONOMY_VERSION,
    matchingAlgorithmVersion: PROFESSOR_MATCHING_ALGORITHM_VERSION,
    coverageCalculationVersion: PROFILE_COVERAGE_VERSION,
    minimumNormalizedRelevance: MINIMUM_NORMALIZED_RELEVANCE,
    maximumOpportunities: MAX_STORY_OPPORTUNITIES,
    maximumPerSource: MAX_PER_SOURCE,
    maximumPerPrimaryTopic: MAX_PER_PRIMARY_TOPIC,
    lowCoverageWarningThreshold: LOW_PROFILE_COVERAGE_THRESHOLD,
    totalArticlesConsidered: input.articles.length,
    eligibleArticleCount: candidates.eligible.length,
    qualifyingArticleCount: candidates.qualifying.length,
    opportunityCount: opportunities.length,
    fallbackTimestampCount: opportunities.filter(
      (opportunity) => opportunity.timestampFallback,
    ).length,
  };
  return { window, opportunities };
}

export class OpportunityCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function historyId(
  opportunityId: string,
  revision: number,
  action: string,
): string {
  return createHash("sha256")
    .update(`${opportunityId}:${revision}:${action}`)
    .digest("hex")
    .slice(0, 20);
}

export function selectProfessorForOpportunity(input: {
  opportunity: StoryOpportunity;
  professorId: string;
  reason?: string | null;
  actorId: string;
  occurredAt: string;
}): StoryOpportunity {
  const reason = input.reason?.trim() || null;
  const match = input.opportunity.professorMatches.find(
    (candidate) => candidate.professorId === input.professorId,
  );
  if (!match)
    throw new OpportunityCommandError(
      "PROFESSOR_MATCH_NOT_FOUND",
      "Professor was not evaluated for this frozen opportunity.",
      404,
    );
  if (input.opportunity.workflowState === "closed")
    throw new OpportunityCommandError(
      "OPPORTUNITY_CLOSED",
      "Closed opportunities must be reopened before selecting a professor.",
      409,
    );
  if (match.exclusions.length)
    throw new OpportunityCommandError(
      "PROFESSOR_HARD_EXCLUDED",
      match.exclusions.join(" "),
      409,
    );
  if (match.rank === null)
    throw new OpportunityCommandError(
      "PROFESSOR_NOT_SELECTABLE",
      "Professor is not selectable for this opportunity.",
      409,
    );
  if (match.label === "weak" && !reason)
    throw new OpportunityCommandError(
      "WEAK_MATCH_REASON_REQUIRED",
      "A reason is required to select a weak professor match.",
      400,
    );
  const current = input.opportunity.selectedProfessor;
  if (current?.professorId === match.professorId && current.reason === reason)
    return input.opportunity;
  const revision = input.opportunity.revision + 1;
  const action = current ? "changed" : "selected";
  const selection: ProfessorSelection = {
    professorId: match.professorId,
    professorName: match.professorName,
    selectedProfileRevision: match.profileRevision,
    selectedMatchRank: match.rank,
    selectedFitScore: match.totalFitScore,
    reason,
    selectedBy: input.actorId,
    selectedAt: input.occurredAt,
  };
  return {
    ...input.opportunity,
    revision,
    selectedProfessor: selection,
    selectionHistory: [
      ...input.opportunity.selectionHistory,
      {
        id: historyId(input.opportunity.id, revision, action),
        action,
        professorId: match.professorId,
        professorName: match.professorName,
        previousProfessorId: current?.professorId ?? null,
        selectedProfileRevision: match.profileRevision,
        reason,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
      },
    ],
    workflowState: "professor_selected",
    updatedAt: input.occurredAt,
  };
}

export function clearProfessorSelection(input: {
  opportunity: StoryOpportunity;
  reason?: string | null;
  actorId: string;
  occurredAt: string;
}): StoryOpportunity {
  if (input.opportunity.workflowState === "closed")
    throw new OpportunityCommandError(
      "OPPORTUNITY_CLOSED",
      "Closed opportunities must be reopened before clearing a professor.",
      409,
    );
  const current = input.opportunity.selectedProfessor;
  if (!current) return input.opportunity;
  const revision = input.opportunity.revision + 1;
  return {
    ...input.opportunity,
    revision,
    selectedProfessor: null,
    selectionHistory: [
      ...input.opportunity.selectionHistory,
      {
        id: historyId(input.opportunity.id, revision, "cleared"),
        action: "cleared",
        professorId: null,
        professorName: null,
        previousProfessorId: current.professorId,
        selectedProfileRevision: null,
        reason: input.reason?.trim() || null,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
      },
    ],
    workflowState: "shortlisted",
    updatedAt: input.occurredAt,
  };
}

export function closeOpportunity(
  opportunity: StoryOpportunity,
  occurredAt: string,
): StoryOpportunity {
  if (opportunity.workflowState === "closed") return opportunity;
  return {
    ...opportunity,
    revision: opportunity.revision + 1,
    workflowState: "closed",
    updatedAt: occurredAt,
  };
}

export function reopenOpportunity(
  opportunity: StoryOpportunity,
  occurredAt: string,
): StoryOpportunity {
  if (opportunity.workflowState !== "closed") return opportunity;
  return {
    ...opportunity,
    revision: opportunity.revision + 1,
    workflowState: opportunity.selectedProfessor
      ? "professor_selected"
      : "shortlisted",
    updatedAt: occurredAt,
  };
}

export function updateOpportunityAngle(
  opportunity: StoryOpportunity,
  angle: string,
  occurredAt: string,
): StoryOpportunity {
  const normalized = angle.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 500)
    throw new OpportunityCommandError(
      "INVALID_RECOMMENDED_ANGLE",
      "Recommended angle must contain 1 to 500 characters.",
      400,
    );
  if (opportunity.workflowState === "closed")
    throw new OpportunityCommandError(
      "OPPORTUNITY_CLOSED",
      "Closed opportunities must be reopened before editing the angle.",
      409,
    );
  if (opportunity.recommendedAngle === normalized) return opportunity;
  return {
    ...opportunity,
    revision: opportunity.revision + 1,
    recommendedAngle: normalized,
    updatedAt: occurredAt,
  };
}

export function assertExpectedRevision(
  opportunity: StoryOpportunity,
  expectedRevision: number,
): void {
  if (opportunity.revision !== expectedRevision) {
    throw new OpportunityCommandError(
      "OPPORTUNITY_REVISION_CONFLICT",
      `Opportunity revision ${expectedRevision} is stale; current revision is ${opportunity.revision}.`,
      409,
    );
  }
}

export function opportunityTopicLabel(slug: string): string {
  return taxonomyLabel(slug);
}
