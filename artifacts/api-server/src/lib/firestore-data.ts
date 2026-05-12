import type { Article, DigestArticle, Settings, Source } from "@workspace/db";
import { getFirebaseBundle, isFirebaseConfigured } from "./firebase";
import { listFirestoreSources } from "./firestore-sources";

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  relevancyThreshold: 7,
  scrapeIntervalHours: 24,
  scrapeTimeUtc: "11:00",
};

export function useFirestoreData(): boolean {
  return process.env.DATABASE_PROVIDER === "firestore" && isFirebaseConfigured();
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

async function nextNumericId(collection: string): Promise<number> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection("_meta").doc("counters");
  const value = await db.runTransaction(async (tx: any) => {
    const snapshot = await tx.get(ref);
    const current = Number(snapshot.data?.()?.[collection] ?? 0);
    const next = current + 1;
    tx.set(ref, { [collection]: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
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
  sortBy?: string;
  limit?: number;
} = {}): Promise<Article[]> {
  const { db } = await getFirebaseBundle();
  let ref: any = db.collection("articles");
  if (query.status) ref = ref.where("status", "==", query.status);
  if (query.source) ref = ref.where("sourceName", "==", query.source);
  if (query.platform) ref = ref.where("platform", "==", query.platform);
  const snapshot = await ref.limit(Math.min(query.limit ?? 200, 1000)).get();
  let articles = snapshot.docs.map(articleFromDoc);
  if (query.minScore !== undefined) articles = articles.filter((a: Article) => a.relevancyScore >= query.minScore!);
  if (query.topicTag) articles = articles.filter((a: Article) => (Array.isArray(a.topicTags) ? a.topicTags : []).includes(query.topicTag!));
  articles.sort((a: Article, b: Article) => {
    if (query.sortBy === "time") return Number(b.publishedAt ?? b.scrapedAt) - Number(a.publishedAt ?? a.scrapedAt);
    if (query.sortBy === "source") return a.sourceName.localeCompare(b.sourceName) || b.relevancyScore - a.relevancyScore;
    return b.relevancyScore - a.relevancyScore || Number(b.scrapedAt) - Number(a.scrapedAt);
  });
  return articles.slice(0, query.limit ?? 200);
}

export async function countFirestoreArticles(query: { status?: string } = {}): Promise<number> {
  return (await listFirestoreArticles({ status: query.status, limit: 1000 })).length;
}

export async function getFirestoreArticle(id: number): Promise<Article | null> {
  const { db } = await getFirebaseBundle();
  const snapshot = await db.collection("articles").doc(String(id)).get();
  return snapshot.exists ? articleFromDoc(snapshot) : null;
}

export async function getFirestoreArticleByUrl(url: string): Promise<Article | null> {
  const { db } = await getFirebaseBundle();
  const normalizedUrl = normalizeUrl(url);
  const snapshot = await db.collection("articles").where("normalizedUrl", "==", normalizedUrl).limit(1).get();
  if (!snapshot.empty) return articleFromDoc(snapshot.docs[0]);
  const exact = await db.collection("articles").where("url", "==", url).limit(1).get();
  return exact.empty ? null : articleFromDoc(exact.docs[0]);
}

export async function createFirestoreArticle(article: Partial<Article>): Promise<Article> {
  const { db, FieldValue } = await getFirebaseBundle();
  const id = await nextNumericId("articles");
  const ref = db.collection("articles").doc(String(id));
  await ref.set({
    ...articleToDoc(article),
    id,
    scrapedAt: article.scrapedAt ?? new Date(),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return articleFromDoc(await ref.get());
}

export async function updateFirestoreArticles(ids: number[], patch: Partial<Article>): Promise<void> {
  if (!ids.length) return;
  const { db, FieldValue } = await getFirebaseBundle();
  const batch = db.batch();
  for (const id of ids) {
    batch.set(db.collection("articles").doc(String(id)), {
      ...articleToDoc(patch),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export async function deleteFirestoreArticle(id: number): Promise<boolean> {
  const { db } = await getFirebaseBundle();
  const ref = db.collection("articles").doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

export async function latestFirestoreScrapedAt(): Promise<Date | null> {
  const articles = await listFirestoreArticles({ sortBy: "time", limit: 1 });
  return articles[0]?.scrapedAt ?? null;
}

export async function listActiveFirestoreSources(): Promise<Source[]> {
  return (await listFirestoreSources()).filter((s) => s.isActive);
}

export async function listFirestoreDigests(query: { status?: string; limit?: number } = {}): Promise<DigestArticle[]> {
  const { db } = await getFirebaseBundle();
  let ref: any = db.collection("digest_articles");
  if (query.status) ref = ref.where("status", "==", normalizeDigestStatus(query.status));
  const snapshot = await ref.limit(Math.min(query.limit ?? 50, 500)).get();
  return snapshot.docs
    .map(digestFromDoc)
    .sort((a: DigestArticle, b: DigestArticle) => Number(b.createdAt) - Number(a.createdAt));
}

export async function countFirestoreDigests(query: { status?: string } = {}): Promise<number> {
  return (await listFirestoreDigests({ status: query.status, limit: 500 })).length;
}

export async function getFirestoreDigest(id: number): Promise<DigestArticle | null> {
  const { db } = await getFirebaseBundle();
  const snapshot = await db.collection("digest_articles").doc(String(id)).get();
  return snapshot.exists ? digestFromDoc(snapshot) : null;
}

export async function createFirestoreDigest(article: Partial<DigestArticle>): Promise<DigestArticle> {
  const { db, FieldValue } = await getFirebaseBundle();
  const id = await nextNumericId("digest_articles");
  const ref = db.collection("digest_articles").doc(String(id));
  await ref.set({
    ...digestToDoc(article, true),
    id,
    status: normalizeDigestStatus(article.status),
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return digestFromDoc(await ref.get());
}

export async function updateFirestoreDigest(id: number, patch: Partial<DigestArticle>): Promise<DigestArticle | null> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection("digest_articles").doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.set({
    ...digestToDoc(patch),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return digestFromDoc(await ref.get());
}

export async function deleteFirestoreDigest(id: number): Promise<boolean> {
  const { db } = await getFirebaseBundle();
  const ref = db.collection("digest_articles").doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

export async function enrichFirestoreDigest(article: DigestArticle): Promise<DigestArticle & { sourceArticles: Article[] }> {
  const sourceArticles = article.sourceArticleIds.length > 0
    ? (await Promise.all(article.sourceArticleIds.map(getFirestoreArticle))).filter(Boolean) as Article[]
    : [];
  return { ...article, sourceArticles };
}

export async function getFirestoreSettings(): Promise<Settings> {
  const { db } = await getFirebaseBundle();
  const snapshot = await db.collection("settings").doc("app").get();
  return snapshot.exists ? settingsFromDoc(snapshot) : DEFAULT_SETTINGS;
}

export async function upsertFirestoreSettings(patch: Partial<Settings>): Promise<Settings> {
  const { db, FieldValue } = await getFirebaseBundle();
  await db.collection("settings").doc("app").set({
    relevancyThreshold: patch.relevancyThreshold ?? DEFAULT_SETTINGS.relevancyThreshold,
    scrapeIntervalHours: patch.scrapeIntervalHours ?? DEFAULT_SETTINGS.scrapeIntervalHours,
    scrapeTimeUtc: patch.scrapeTimeUtc ?? DEFAULT_SETTINGS.scrapeTimeUtc,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return getFirestoreSettings();
}
