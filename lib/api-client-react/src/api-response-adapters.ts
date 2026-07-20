import {
  customFetch,
  type BodyType as CustomFetchBodyType,
  type CustomFetchOptions,
  type ErrorType as CustomFetchErrorType,
} from "./custom-fetch";

export type BodyType<T> = CustomFetchBodyType<T>;
export type ErrorType<T = unknown> = CustomFetchErrorType<T>;

const ARRAY_ENVELOPE_KEYS = [
  "data",
  "items",
  "results",
  "articles",
  "sources",
  "digests",
] as const;

export function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  for (const key of ARRAY_ENVELOPE_KEYS) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }

  return [];
}

export function safeDashboardSummary(value: unknown): Record<string, unknown> {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    totalArticlesToday: Number(record.totalArticlesToday ?? 0),
    pendingReview: Number(record.pendingReview ?? 0),
    approvedToday: Number(record.approvedToday ?? 0),
    rejectedToday: Number(record.rejectedToday ?? 0),
    topArticles: ensureArray(record.topArticles),
    lastScrapeAt: typeof record.lastScrapeAt === "string" ? record.lastScrapeAt : null,
    articlesByTag: ensureArray(record.articlesByTag),
    topicIntelligence: ensureArray(record.topicIntelligence),
    totalSources: Number(record.totalSources ?? 0),
    activeSources: Number(record.activeSources ?? 0),
    socialSignalsCount: Number(record.socialSignalsCount ?? 0),
    emergingSignalsCount: Number(record.emergingSignalsCount ?? 0),
    contentWindowStart: typeof record.contentWindowStart === "string"
      ? record.contentWindowStart
      : undefined,
    minTopicScore: typeof record.minTopicScore === "number" ? record.minTopicScore : undefined,
    signalClusters: ensureArray(record.signalClusters),
    sectionErrors: ensureArray(record.sectionErrors),
    degraded: typeof record.degraded === "boolean" ? record.degraded : false,
  };
}

export async function arrayResponseFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  const value = await customFetch<unknown>(input, options);
  return ensureArray(value) as T;
}

export async function sourceListFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  return arrayResponseFetch<T>(input, {
    ...options,
    cache: "no-store",
    responseType: "json",
  });
}

export async function dashboardSummaryFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  const value = await customFetch<unknown>(input, options);
  return safeDashboardSummary(value) as T;
}
