import type { Article, DigestArticle, Settings, Source } from "@workspace/db";
import { createHash } from "node:crypto";
import { getFirebaseBundle, isFirestoreTemporarilyDegraded, withFirestoreRetry, withTimeout } from "./firebase";
import { listFirestoreSources } from "./firestore-sources";
import { logger } from "./logger";
import { articleRecommendedFor } from "./rgi-relevance";
import {
  createLocalArticle,
  createLocalDigest,
  deleteLocalArticle,
  deleteLocalDigest,
  getLocalArticle,
  getLocalArticleByUrl,
  getLocalDigest,
  getLocalSettings,
  listLocalArticles,
  listLocalDigests,
  localFallback,
  localFallbackEnabled,
  localStoreModeEnabled,
  updateLocalArticle,
  updateLocalArticles,
  updateLocalDigest,
  upsertLocalSettings,
} from "./local-store";

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  relevancyThreshold: 7,
  scrapeIntervalHours: 24,
  scrapeTimeUtc: "11:00",
};

let lastGoodArticles: { items: Article[]; loadedAt: Date } | null = null;
let lastGoodDigests: { items: DigestArticle[]; loadedAt: Date } | null = null;

export function useFirestoreData(): boolean {
  return true;
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function nums(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];
}

function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

function normalizeDigestStatus(value: unknown): DigestArticle["status"] {
  const raw = String(value ?? "pending_review").toLowerCase().trim();
  if (raw === "pending") return "pending_review";
  if (raw === "published") return "approved";
  if (["draft", "pending_review", "approved", "rejected", "regenerating"].includes(raw)) {
    return raw as DigestArticle["status"];
  }
  return "pending_review";
}

function normalizeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|cmpid$|cid$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\?$/, "");
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function titleFingerprint(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeId(value: unknown): string {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 48);
}

async function nextNumericId(collection: string): Promise<number> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection("_meta").doc("counters");
  const value = await withTimeout(`Next Firestore numeric id for ${collection}`, db.runTransaction(async (tx: any) => {
    const snapshot = await tx.get(ref);
    const current = Number(snapshot.data?.()?.[collection] ?? 0);
    const next = current + 1;
    tx.set(ref, { [collection]: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  }), 6000);
  return Number(value);
}

function articleFromDoc(doc: any): Article {
  const data = doc.data?.() ?? doc;
  return {
    id: Number(data.id ?? doc.id),
    headline: String(data.headline ?? ""),
    url: String(data.url ?? ""),
    sourceName: String(data.sourceName ?? ""),
    sourceUrl: typeof data.sourceUrl === "string" ? data.sourceUrl : null,
    author: typeof data.author === "string" ? data.author : null,
    authorType: typeof data.authorType === "string" ? data.authorType : null,
    platform: (data.platform === "twitter" || data.platform === "linkedin" ? data.platform : "news") as Article["platform"],
    isEmergingSignal: Boolean(data.isEmergingSignal),
    isPrimarySignal: Boolean(data.isPrimarySignal),
    relevancyScore: Number(data.relevancyScore ?? 0),
    authenticityScore: Number(data.authenticityScore ?? 5),
    viewpoint: typeof data.viewpoint === "string" ? data.viewpoint : null,
    topicTags: arr(data.topicTags),
    teaserSummary: typeof data.teaserSummary === "string" ? data.teaserSummary : null,
    publishedAt: dateOrNull(data.publishedAt),
    scrapedAt: dateOrNull(data.scrapedAt) ?? new Date(0),
    content: typeof data.content === "string" ? data.content : null,
    status: (data.status === "selected" || data.status === "dismissed" ? data.status : "pending") as Article["status"],
    disciplineAlignment: typeof data.disciplineAlignment === "string" ? data.disciplineAlignment : null,
    scoreExplanation: typeof data.scoreExplanation === "string" ? data.scoreExplanation : null,
    scoreBreakdown: data.scoreBreakdown && typeof data.scoreBreakdown === "object" ? data.scoreBreakdown : null,
    recencyScore: data.recencyScore == null ? null : Number(data.recencyScore),
    sourceAuthorityScore: data.sourceAuthorityScore == null ? null : Number(data.sourceAuthorityScore),
    strategicImpactScore: data.strategicImpactScore == null ? null : Number(data.strategicImpactScore),
    executiveRelevanceScore: data.executiveRelevanceScore == null ? null : Number(data.executiveRelevanceScore),
    recommendedUse: typeof data.recommendedUse === "string" ? data.recommendedUse : null,
    reasonForAcceptance: typeof data.reasonForAcceptance === "string" ? data.reasonForAcceptance : null,
    reasonForRejection: typeof data.reasonForRejection === "string" ? data.reasonForRejection : null,
    rgiProfileVersion: typeof data.rgiProfileVersion === "string" ? data.rgiProfileVersion : null,
    moderationNote: typeof data.moderationNote === "string" ? data.moderationNote : null,
    moderatedAt: dateOrNull(data.moderatedAt),
    moderatedBy: typeof data.moderatedBy === "string" ? data.moderatedBy : null,
  } as Article & {
    scoreExplanation?: string | null;
    scoreBreakdown?: Record<string, unknown> | null;
    moderationNote?: string | null;
    moderatedAt?: Date | null;
    moderatedBy?: string | null;
  };
}

function articleToDoc(article: Partial<Article>): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(article)) {
    if (value !== undefined) doc[key] = value;
  }
  if (article.url !== undefined) doc.normalizedUrl = normalizeUrl(article.url);
  if (article.headline !== undefined) doc.titleFingerprint = titleFingerprint(article.headline);
  doc.payloadQuality = "valid";
  return doc;
}

function digestFromDoc(doc: any): DigestArticle {
  const data = doc.data?.() ?? doc;
  return {
    id: Number(data.id ?? doc.id),
    articleType: String(data.articleType ?? "topic_article") as DigestArticle["articleType"],
    headline: String(data.headline ?? ""),
    body: String(data.body ?? ""),
    executiveSummary: arr(data.executiveSummary),
    rgiTake: String(data.rgiTake ?? ""),
    keyTakeaways: arr(data.keyTakeaways),
    implificationsForLeaders: arr(data.implificationsForLeaders),
    whatMostAreMissing: typeof data.whatMostAreMissing === "string" ? data.whatMostAreMissing : null,
    mechanism: arr(data.mechanism),
    constraintsAndRisks: arr(data.constraintsAndRisks),
    whatChangedSinceYesterday: arr(data.whatChangedSinceYesterday),
    whatToWatch: arr(data.whatToWatch),
    summaryTakeaways: arr(data.summaryTakeaways),
    topicTags: arr(data.topicTags),
    sourceArticleIds: nums(data.sourceArticleIds),
    relevancyScore: data.relevancyScore == null ? null : Number(data.relevancyScore),
    status: normalizeDigestStatus(data.status),
    editorNotes: typeof data.editorNotes === "string" ? data.editorNotes : null,
    publishedAt: dateOrNull(data.publishedAt),
    discipline: typeof data.discipline === "string" ? data.discipline : null,
    newsletterSentAt: dateOrNull(data.newsletterSentAt),
    newsletterSentCount: data.newsletterSentCount == null ? null : Number(data.newsletterSentCount),
    createdAt: dateOrNull(data.createdAt) ?? new Date(0),
    updatedAt: dateOrNull(data.updatedAt) ?? new Date(0),
    approvedAt: dateOrNull(data.approvedAt),
    rejectedAt: dateOrNull(data.rejectedAt),
    generationMode: data.generationMode === "fallback" ? "fallback" : data.generationMode === "ai" ? "ai" : undefined,
    fallbackReason: typeof data.fallbackReason === "string" ? data.fallbackReason : null,
  } as DigestArticle & {
    approvedAt?: Date | null;
    rejectedAt?: Date | null;
    generationMode?: "ai" | "fallback";
    fallbackReason?: string | null;
  };
}

function digestToDoc(article: Partial<DigestArticle>, includeDefaults = false): Record<string, unknown> {
  const extended = article as Partial<DigestArticle> & {
    approvedAt?: Date | string | null;
    rejectedAt?: Date | string | null;
    generationMode?: "ai" | "fallback";
    fallbackReason?: string | null;
  };
  const doc: Record<string, unknown> = {
    articleType: article.articleType,
    headline: article.headline,
    body: article.body,
    executiveSummary: article.executiveSummary ?? (includeDefaults ? [] : undefined),
    rgiTake: article.rgiTake ?? (includeDefaults ? "" : undefined),
    keyTakeaways: article.keyTakeaways ?? (includeDefaults ? [] : undefined),
    implificationsForLeaders: article.implificationsForLeaders ?? (includeDefaults ? [] : undefined),
    whatMostAreMissing: article.whatMostAreMissing,
    mechanism: article.mechanism ?? (includeDefaults ? [] : undefined),
    constraintsAndRisks: article.constraintsAndRisks ?? (includeDefaults ? [] : undefined),
    whatChangedSinceYesterday: article.whatChangedSinceYesterday ?? (includeDefaults ? [] : undefined),
    whatToWatch: article.whatToWatch ?? (includeDefaults ? [] : undefined),
    summaryTakeaways: article.summaryTakeaways ?? (includeDefaults ? [] : undefined),
    topicTags: article.topicTags ?? (includeDefaults ? [] : undefined),
    sourceArticleIds: article.sourceArticleIds ?? (includeDefaults ? [] : undefined),
    relevancyScore: article.relevancyScore,
    status: article.status ? normalizeDigestStatus(article.status) : undefined,
    editorNotes: article.editorNotes,
    publishedAt: article.publishedAt,
    discipline: article.discipline,
    newsletterSentAt: article.newsletterSentAt,
    newsletterSentCount: article.newsletterSentCount,
    approvedAt: extended.approvedAt,
    rejectedAt: extended.rejectedAt,
    generationMode: extended.generationMode,
    fallbackReason: extended.fallbackReason,
  };
  return Object.fromEntries(Object.entries(doc).filter(([, value]) => value !== undefined));
}

function settingsFromDoc(doc: any): Settings {
  const data = doc.data?.() ?? doc;
  return {
    id: 1,
    relevancyThreshold: Number(data.relevancyThreshold ?? 7),
    scrapeIntervalHours: Number(data.scrapeIntervalHours ?? 24),
    scrapeTimeUtc: String(data.scrapeTimeUtc ?? "11:00"),
  };
}

export async function listFirestoreArticles(query: {
  status?: string;
  minScore?: number;
  topicTag?: string;
  source?: string;
  platform?: string;
  search?: string;
  sortBy?: string;
  limit?: number;
} = {}): Promise<Article[]> {
  let articles: Article[];
  if (localStoreModeEnabled()) {
    articles = await listLocalArticles({ status: query.status, limit: query.limit ?? 1000 });
  } else try {
    const { db } = await getFirebaseBundle();
    let ref: any = db.collection("articles");
    if (query.status) ref = ref.where("status", "==", query.status);
    if (query.source) ref = ref.where("sourceName", "==", query.source);
    if (query.platform) ref = ref.where("platform", "==", query.platform);
    if (query.sortBy === "time") ref = ref.orderBy("publishedAt", "desc");
    const snapshot: any = await withFirestoreRetry("List Firestore articles", () =>
      ref.limit(Math.min(query.limit ?? 200, 2000)).get()
    );
    articles = snapshot.docs.map(articleFromDoc);
    lastGoodArticles = { items: articles, loadedAt: new Date() };
  } catch (error) {
    if (localFallbackEnabled() && lastGoodArticles?.items.length) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          count: lastGoodArticles.items.length,
          loadedAt: lastGoodArticles.loadedAt.toISOString(),
        },
        "Firestore articles unavailable; serving last-known-good Firestore articles"
      );
      articles = lastGoodArticles.items;
    } else {
      articles = await localFallback("list articles", error, () => listLocalArticles({ status: query.status, limit: query.limit ?? 1000 }));
    }
  }
  if (query.minScore !== undefined) articles = articles.filter((a: Article) => a.relevancyScore >= query.minScore!);
  if (query.topicTag) articles = articles.filter((a: Article) => (Array.isArray(a.topicTags) ? a.topicTags : []).includes(query.topicTag!));
  if (query.search?.trim()) {
    const q = query.search.toLowerCase().trim();
    articles = articles.filter((a: Article) => {
      const text = [
        a.headline,
        a.sourceName,
        a.author,
        a.teaserSummary,
        a.content,
        ...(Array.isArray(a.topicTags) ? a.topicTags : []),
      ].join(" ").toLowerCase();
      return text.includes(q);
    });
  }
  articles.sort((a: Article, b: Article) => {
    if (query.sortBy === "time") return Number(b.publishedAt ?? b.scrapedAt) - Number(a.publishedAt ?? a.scrapedAt);
    if (query.sortBy === "source") return a.sourceName.localeCompare(b.sourceName) || b.relevancyScore - a.relevancyScore;
    return b.relevancyScore - a.relevancyScore || Number(b.scrapedAt) - Number(a.scrapedAt);
  });
  return articles.slice(0, query.limit ?? 200);
}

export async function listFirestoreArticlesPage(query: {
  status?: string;
  minScore?: number;
  topicTag?: string;
  source?: string;
  platform?: string;
  search?: string;
  sortBy?: string;
  limit?: number;
  cursor?: string;
  includeArchive?: boolean;
} = {}): Promise<{ items: Article[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
  if (localStoreModeEnabled()) {
    const articles = await listFirestoreArticles({ ...query, limit: 1000 });
    return { items: articles.slice(0, limit), nextCursor: null, hasMore: articles.length > limit };
  }
  try {
    const scanLimit = Math.min(Math.max(limit * 8, 120), 250);
    let articles = await listFirestoreArticles({
      status: query.status,
      minScore: query.minScore,
      topicTag: query.topicTag,
      source: query.source,
      platform: query.platform,
      search: query.search,
      sortBy: query.sortBy === "source" ? "source" : "time",
      limit: scanLimit,
    });
    if (!query.includeArchive && !query.status) {
      articles = articles.filter((article: Article) => articleRecommendedFor(article as Article & Record<string, unknown>, "feed"));
    }

    const cursorIndex = query.cursor ? articles.findIndex((article) => String(article.id) === String(query.cursor)) : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const pageItems = articles.slice(start, start + limit);
    const nextCursor = pageItems.length > 0 && start + pageItems.length < articles.length
      ? String(pageItems[pageItems.length - 1].id)
      : null;
    return {
      items: pageItems,
      nextCursor,
      hasMore: Boolean(nextCursor),
    };
  } catch (error) {
    if (localFallbackEnabled() && lastGoodArticles?.items.length) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          count: lastGoodArticles.items.length,
          loadedAt: lastGoodArticles.loadedAt.toISOString(),
        },
        "Firestore article page unavailable; serving last-known-good Firestore articles"
      );
      let articles = lastGoodArticles.items;
      if (query.status) articles = articles.filter((a: Article) => a.status === query.status);
      if (query.minScore !== undefined) articles = articles.filter((a: Article) => a.relevancyScore >= query.minScore!);
      if (query.topicTag) articles = articles.filter((a: Article) => (Array.isArray(a.topicTags) ? a.topicTags : []).includes(query.topicTag!));
      if (query.source) articles = articles.filter((a: Article) => a.sourceName === query.source);
      if (query.platform) articles = articles.filter((a: Article) => a.platform === query.platform);
      if (query.search?.trim()) {
        const q = query.search.toLowerCase().trim();
        articles = articles.filter((a: Article) => [
          a.headline,
          a.sourceName,
          a.author,
          a.teaserSummary,
          a.content,
          ...(Array.isArray(a.topicTags) ? a.topicTags : []),
        ].join(" ").toLowerCase().includes(q));
      }
      if (!query.includeArchive && !query.status) {
        articles = articles.filter((article: Article) => articleRecommendedFor(article as Article & Record<string, unknown>, "feed"));
      }
      articles.sort((a: Article, b: Article) => {
        if (query.sortBy === "time") return Number(b.publishedAt ?? b.scrapedAt) - Number(a.publishedAt ?? a.scrapedAt);
        if (query.sortBy === "source") return a.sourceName.localeCompare(b.sourceName) || b.relevancyScore - a.relevancyScore;
        return b.relevancyScore - a.relevancyScore || Number(b.scrapedAt) - Number(a.scrapedAt);
      });
      return { items: articles.slice(0, limit), nextCursor: null, hasMore: articles.length > limit };
    }
    const items = await localFallback("list articles page", error, () => listLocalArticles({ status: query.status, limit }));
    return { items, nextCursor: null, hasMore: false };
  }
}

export async function countFirestoreArticles(query: { status?: string } = {}): Promise<number> {
  return (await listFirestoreArticles({ status: query.status, limit: 1000 })).length;
}

export async function getFirestoreArticle(id: number): Promise<Article | null> {
  if (localStoreModeEnabled()) return getLocalArticle(id);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withTimeout("Get Firestore article", db.collection("articles").doc(String(id)).get());
    return snapshot.exists ? articleFromDoc(snapshot) : null;
  } catch (error) {
    return localFallback("get article", error, () => getLocalArticle(id));
  }
}

export async function getFirestoreArticleByUrl(url: string): Promise<Article | null> {
  if (localStoreModeEnabled()) return getLocalArticleByUrl(url);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const normalizedUrl = normalizeUrl(url);
    const snapshot: any = await withTimeout("Get Firestore article by normalized URL", db.collection("articles").where("normalizedUrl", "==", normalizedUrl).limit(1).get(), 5000);
    if (!snapshot.empty) return articleFromDoc(snapshot.docs[0]);
    const exact: any = await withTimeout("Get Firestore article by URL", db.collection("articles").where("url", "==", url).limit(1).get(), 5000);
    return exact.empty ? null : articleFromDoc(exact.docs[0]);
  } catch (error) {
    return localFallback("get article by URL", error, () => getLocalArticleByUrl(url));
  }
}

export async function createFirestoreArticle(article: Partial<Article>): Promise<Article> {
  if (localStoreModeEnabled()) return createLocalArticle(article);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const normalizedUrl = normalizeUrl(article.url);
    const fingerprint = titleFingerprint(article.headline);
    const urlMarker = normalizedUrl ? db.collection("_article_dedupe").doc(`url_${dedupeId(normalizedUrl)}`) : null;
    const titleMarker = fingerprint ? db.collection("_article_dedupe").doc(`title_${dedupeId(fingerprint)}`) : null;
    const counterRef = db.collection("_meta").doc("counters");

    const id = await withTimeout("Create Firestore article transaction", db.runTransaction(async (tx: any) => {
      if (urlMarker) {
        const existing = await tx.get(urlMarker);
        const existingId = Number(existing.data?.()?.articleId);
        if (existing.exists && Number.isFinite(existingId)) return existingId;
      }
      if (titleMarker) {
        const existing = await tx.get(titleMarker);
        const existingId = Number(existing.data?.()?.articleId);
        if (existing.exists && Number.isFinite(existingId)) return existingId;
      }

      const counterSnapshot = await tx.get(counterRef);
      const next = Number(counterSnapshot.data?.()?.articles ?? 0) + 1;
      const articleRef = db.collection("articles").doc(String(next));
      const now = FieldValue.serverTimestamp();
      tx.set(counterRef, { articles: next, updatedAt: now }, { merge: true });
      tx.set(articleRef, {
        ...articleToDoc(article),
        id: next,
        scrapedAt: article.scrapedAt ?? new Date(),
        createdAt: now,
        updatedAt: now,
      });
      const markerPayload = {
        articleId: next,
        normalizedUrl,
        titleFingerprint: fingerprint,
        sourceName: article.sourceName ?? null,
        createdAt: now,
      };
      if (urlMarker) tx.set(urlMarker, markerPayload, { merge: true });
      if (titleMarker) tx.set(titleMarker, markerPayload, { merge: true });
      return next;
    }), 8000);

    const snapshot: any = await withTimeout("Read created Firestore article", db.collection("articles").doc(String(id)).get(), 5000);
    if (!snapshot.exists) {
      throw new Error(`Firestore article dedupe marker pointed to missing article ${id}`);
    }
    return articleFromDoc(snapshot);
  } catch (error) {
    return localFallback("create article", error, () => createLocalArticle(article));
  }
}

export async function updateFirestoreArticles(ids: number[], patch: Partial<Article>): Promise<void> {
  if (!ids.length) return;
  if (localStoreModeEnabled()) return updateLocalArticles(ids, patch);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const batch = db.batch();
    for (const id of ids) {
      batch.set(db.collection("articles").doc(String(id)), {
        ...articleToDoc(patch),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await withTimeout("Update Firestore articles", batch.commit(), 8000);
  } catch (error) {
    return localFallback("update articles", error, () => updateLocalArticles(ids, patch));
  }
}

export async function updateFirestoreArticle(id: number, patch: Partial<Article> & Record<string, unknown>): Promise<Article | null> {
  if (localStoreModeEnabled()) return updateLocalArticle(id, patch);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const ref = db.collection("articles").doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore article before update", ref.get());
    if (!snapshot.exists) return null;
    await withTimeout("Update Firestore article", ref.set({
      ...articleToDoc(patch),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    return articleFromDoc(await withTimeout("Read updated Firestore article", ref.get()));
  } catch (error) {
    return localFallback("update article", error, () => updateLocalArticle(id, patch));
  }
}

export async function deleteFirestoreArticle(id: number): Promise<boolean> {
  if (localStoreModeEnabled()) return deleteLocalArticle(id);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const ref = db.collection("articles").doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore article before delete", ref.get());
    if (!snapshot.exists) return false;
    await withTimeout("Delete Firestore article", ref.delete());
    return true;
  } catch (error) {
    return localFallback("delete article", error, () => deleteLocalArticle(id));
  }
}

export async function latestFirestoreScrapedAt(): Promise<Date | null> {
  const articles = await listFirestoreArticles({ sortBy: "time", limit: 1 });
  return articles[0]?.scrapedAt ?? null;
}

export async function listActiveFirestoreSources(): Promise<Source[]> {
  const sources = await listFirestoreSources();
  const activeSources = sources.filter((source) => source.isActive);
  logger.info(
    {
      totalSources: sources.length,
      activeSources: activeSources.length,
      inactiveSources: sources.length - activeSources.length,
    },
    "Loaded active Firestore sources for scrape"
  );
  return activeSources;
}

export async function listFirestoreDigests(query: { status?: string; limit?: number } = {}): Promise<DigestArticle[]> {
  if (localStoreModeEnabled()) return listLocalDigests(query);
  try {
    const { db } = await getFirebaseBundle();
    let ref: any = db.collection("digest_articles");
    if (query.status) ref = ref.where("status", "==", normalizeDigestStatus(query.status));
    const snapshot: any = await withFirestoreRetry("List Firestore digests", () =>
      ref.limit(Math.min(query.limit ?? 50, 500)).get()
    );
    const digests = snapshot.docs
      .map(digestFromDoc)
      .sort((a: DigestArticle, b: DigestArticle) => Number(b.createdAt) - Number(a.createdAt));
    lastGoodDigests = { items: digests, loadedAt: new Date() };
    return digests;
  } catch (error) {
    if (lastGoodDigests?.items.length) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          count: lastGoodDigests.items.length,
          loadedAt: lastGoodDigests.loadedAt.toISOString(),
        },
        "Firestore digests unavailable; serving last-known-good Firestore digests"
      );
      const status = query.status ? normalizeDigestStatus(query.status) : null;
      const filtered = status ? lastGoodDigests.items.filter((digest) => digest.status === status) : lastGoodDigests.items;
      return filtered.slice(0, query.limit ?? 50);
    }
    return localFallback("list digests", error, () => listLocalDigests(query));
  }
}

export async function countFirestoreDigests(query: { status?: string } = {}): Promise<number> {
  return (await listFirestoreDigests({ status: query.status, limit: 500 })).length;
}

export async function getFirestoreDigest(id: number): Promise<DigestArticle | null> {
  if (localStoreModeEnabled()) return getLocalDigest(id);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withTimeout("Get Firestore digest", db.collection("digest_articles").doc(String(id)).get());
    return snapshot.exists ? digestFromDoc(snapshot) : null;
  } catch (error) {
    return localFallback("get digest", error, () => getLocalDigest(id));
  }
}

export async function createFirestoreDigest(article: Partial<DigestArticle>): Promise<DigestArticle> {
  if (localStoreModeEnabled()) return createLocalDigest(article);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const id = await nextNumericId("digest_articles");
    const ref = db.collection("digest_articles").doc(String(id));
    await withTimeout("Create Firestore digest", ref.set({
      ...digestToDoc(article, true),
      id,
      status: normalizeDigestStatus(article.status),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }), 8000);
    return digestFromDoc(await withTimeout("Read created Firestore digest", ref.get()));
  } catch (error) {
    return localFallback("create digest", error, () => createLocalDigest(article));
  }
}

export async function updateFirestoreDigest(id: number, patch: Partial<DigestArticle>): Promise<DigestArticle | null> {
  if (localStoreModeEnabled()) return updateLocalDigest(id, patch);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const ref = db.collection("digest_articles").doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore digest before update", ref.get());
    if (!snapshot.exists) return null;
    await withTimeout("Update Firestore digest", ref.set({
      ...digestToDoc(patch),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    return digestFromDoc(await withTimeout("Read updated Firestore digest", ref.get()));
  } catch (error) {
    return localFallback("update digest", error, () => updateLocalDigest(id, patch));
  }
}

export async function deleteFirestoreDigest(id: number): Promise<boolean> {
  if (localStoreModeEnabled()) return deleteLocalDigest(id);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const ref = db.collection("digest_articles").doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore digest before delete", ref.get());
    if (!snapshot.exists) return false;
    await withTimeout("Delete Firestore digest", ref.delete());
    return true;
  } catch (error) {
    return localFallback("delete digest", error, () => deleteLocalDigest(id));
  }
}

export async function enrichFirestoreDigest(article: DigestArticle): Promise<DigestArticle & { sourceArticles: Article[] }> {
  const sourceArticles = article.sourceArticleIds.length > 0
    ? (await Promise.all(article.sourceArticleIds.map(getFirestoreArticle))).filter(Boolean) as Article[]
    : [];
  return { ...article, sourceArticles };
}

export async function getFirestoreSettings(): Promise<Settings> {
  if (localStoreModeEnabled()) return getLocalSettings();
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withTimeout("Get Firestore settings", db.collection("settings").doc("app").get());
    return snapshot.exists ? settingsFromDoc(snapshot) : DEFAULT_SETTINGS;
  } catch (error) {
    return localFallback("get settings", error, getLocalSettings);
  }
}

export async function upsertFirestoreSettings(patch: Partial<Settings>): Promise<Settings> {
  if (localStoreModeEnabled()) return upsertLocalSettings(patch);
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    await withTimeout("Upsert Firestore settings", db.collection("settings").doc("app").set({
      relevancyThreshold: patch.relevancyThreshold ?? DEFAULT_SETTINGS.relevancyThreshold,
      scrapeIntervalHours: patch.scrapeIntervalHours ?? DEFAULT_SETTINGS.scrapeIntervalHours,
      scrapeTimeUtc: patch.scrapeTimeUtc ?? DEFAULT_SETTINGS.scrapeTimeUtc,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }));
    return getFirestoreSettings();
  } catch (error) {
    return localFallback("upsert settings", error, () => upsertLocalSettings(patch));
  }
}
