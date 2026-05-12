import type { Article, DigestArticle, Settings, Source } from "@workspace/db";
import { listSupabaseSources } from "./supabase-sources";
import {
  countFirestoreArticles,
  countFirestoreDigests,
  createFirestoreArticle,
  createFirestoreDigest,
  deleteFirestoreArticle,
  deleteFirestoreDigest,
  enrichFirestoreDigest,
  getFirestoreArticle,
  getFirestoreArticleByUrl,
  getFirestoreDigest,
  getFirestoreSettings,
  latestFirestoreScrapedAt,
  listActiveFirestoreSources,
  listFirestoreArticles,
  listFirestoreDigests,
  updateFirestoreArticles,
  updateFirestoreDigest,
  upsertFirestoreSettings,
  useFirestoreData,
} from "./firestore-data";

export { listSupabaseSources };

type Json = Record<string, unknown>;
let cachedArticleHardeningColumns: boolean | null = null;
let cachedDigestWorkflowColumns: Set<string> | null = null;

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  relevancyThreshold: 7,
  scrapeIntervalHours: 24,
  scrapeTimeUtc: "11:00",
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  return { url, anonKey };
}

function headers(extra?: Record<string, string>) {
  const { anonKey } = config();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function supabaseRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: headers(init?.headers as Record<string, string> | undefined),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}) ${path}: ${body}`);
  }

  if (response.status === 204) return [] as T;
  return (await response.json()) as T;
}

async function supabaseCount(path: string): Promise<number> {
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "HEAD",
    headers: headers({ Prefer: "count=exact" }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase count failed (${response.status}) ${path}: ${body}`);
  }

  const range = response.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

function isMissingSupabaseTable(error: unknown): boolean {
  return error instanceof Error && error.message.includes("PGRST205");
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function nums(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [];
}

function dateOrNull(value: unknown): Date | null {
  return typeof value === "string" && value ? new Date(value) : null;
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

async function getDigestWorkflowColumns(): Promise<Set<string>> {
  if (cachedDigestWorkflowColumns) return cachedDigestWorkflowColumns;
  const columns = new Set<string>();
  for (const column of ["approved_at", "rejected_at", "generation_mode", "fallback_reason"]) {
    try {
      await supabaseRequest<Json[]>(`digest_articles?select=${column}&limit=1`);
      columns.add(column);
    } catch {
      // Column is optional until the Supabase migration is applied.
    }
  }
  cachedDigestWorkflowColumns = columns;
  return columns;
}

function rowToArticle(row: Json): Article {
  return {
    id: Number(row.id),
    headline: String(row.headline ?? ""),
    url: String(row.url ?? ""),
    sourceName: String(row.source_name ?? row.sourceName ?? ""),
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    author: typeof row.author === "string" ? row.author : null,
    authorType: typeof row.author_type === "string" ? row.author_type : null,
    platform: (row.platform === "twitter" || row.platform === "linkedin" ? row.platform : "news") as Article["platform"],
    isEmergingSignal: Boolean(row.is_emerging_signal),
    isPrimarySignal: Boolean(row.is_primary_signal),
    relevancyScore: Number(row.relevancy_score ?? 0),
    authenticityScore: Number(row.authenticity_score ?? 5),
    viewpoint: typeof row.viewpoint === "string" ? row.viewpoint : null,
    topicTags: arr(row.topic_tags),
    teaserSummary: typeof row.teaser_summary === "string" ? row.teaser_summary : null,
    publishedAt: dateOrNull(row.published_at),
    scrapedAt: dateOrNull(row.scraped_at) ?? new Date(0),
    content: typeof row.content === "string" ? row.content : null,
    status: (row.status === "selected" || row.status === "dismissed" ? row.status : "pending") as Article["status"],
    disciplineAlignment: typeof row.discipline_alignment === "string" ? row.discipline_alignment : null,
  };
}

async function supportsArticleHardeningColumns(): Promise<boolean> {
  if (cachedArticleHardeningColumns !== null) return cachedArticleHardeningColumns;
  try {
    await supabaseRequest<Json[]>("articles?select=normalized_url,title_fingerprint,payload_quality&limit=1");
    cachedArticleHardeningColumns = true;
  } catch {
    cachedArticleHardeningColumns = false;
  }
  return cachedArticleHardeningColumns;
}

function normalizeUrlForRow(value: unknown): string {
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

function titleFingerprintForRow(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleToRow(article: Partial<Article>, includeHardeningColumns = false): Json {
  const row: Json = {
    headline: article.headline,
    url: article.url,
    source_name: article.sourceName,
    source_url: article.sourceUrl,
    author: article.author,
    author_type: article.authorType,
    platform: article.platform,
    is_emerging_signal: article.isEmergingSignal,
    is_primary_signal: article.isPrimarySignal,
    relevancy_score: article.relevancyScore,
    authenticity_score: article.authenticityScore,
    viewpoint: article.viewpoint,
    topic_tags: article.topicTags ?? [],
    teaser_summary: article.teaserSummary,
    published_at: article.publishedAt instanceof Date ? article.publishedAt.toISOString() : article.publishedAt,
    content: article.content,
    status: article.status,
    discipline_alignment: article.disciplineAlignment,
  };
  if (includeHardeningColumns && article.url) {
    const extended = article as Partial<Article> & { normalizedUrl?: string; titleFingerprint?: string; payloadQuality?: string };
    row.normalized_url = extended.normalizedUrl ?? normalizeUrlForRow(article.url);
    row.title_fingerprint = extended.titleFingerprint ?? titleFingerprintForRow(article.headline);
    row.payload_quality = extended.payloadQuality ?? "valid";
  }
  return row;
}

function rowToDigest(row: Json): DigestArticle {
  const digest = {
    id: Number(row.id),
    articleType: String(row.article_type ?? "topic_article") as DigestArticle["articleType"],
    headline: String(row.headline ?? ""),
    body: String(row.body ?? ""),
    executiveSummary: arr(row.executive_summary),
    rgiTake: String(row.rgi_take ?? ""),
    keyTakeaways: arr(row.key_takeaways),
    implificationsForLeaders: arr(row.implifications_for_leaders),
    whatMostAreMissing: typeof row.what_most_are_missing === "string" ? row.what_most_are_missing : null,
    mechanism: arr(row.mechanism),
    constraintsAndRisks: arr(row.constraints_and_risks),
    whatChangedSinceYesterday: arr(row.what_changed_since_yesterday),
    whatToWatch: arr(row.what_to_watch),
    summaryTakeaways: arr(row.summary_takeaways),
    topicTags: arr(row.topic_tags),
    sourceArticleIds: nums(row.source_article_ids),
    relevancyScore: row.relevancy_score == null ? null : Number(row.relevancy_score),
    status: normalizeDigestStatus(row.status),
    editorNotes: typeof row.editor_notes === "string" ? row.editor_notes : null,
    publishedAt: dateOrNull(row.published_at),
    discipline: typeof row.discipline === "string" ? row.discipline : null,
    newsletterSentAt: dateOrNull(row.newsletter_sent_at),
    newsletterSentCount: row.newsletter_sent_count == null ? null : Number(row.newsletter_sent_count),
    createdAt: dateOrNull(row.created_at) ?? new Date(0),
    updatedAt: dateOrNull(row.updated_at) ?? new Date(0),
  } as DigestArticle;

  return {
    ...digest,
    approvedAt: dateOrNull(row.approved_at),
    rejectedAt: dateOrNull(row.rejected_at),
    generationMode: row.generation_mode === "fallback" ? "fallback" : row.generation_mode === "ai" ? "ai" : undefined,
    fallbackReason: typeof row.fallback_reason === "string" ? row.fallback_reason : null,
  } as DigestArticle & {
    approvedAt?: Date | null;
    rejectedAt?: Date | null;
    generationMode?: "ai" | "fallback";
    fallbackReason?: string | null;
  };
}

function digestToRow(article: Partial<DigestArticle>, workflowColumns: Set<string> = new Set(), includeDefaults = false): Json {
  const extended = article as Partial<DigestArticle> & {
    approvedAt?: Date | string | null;
    rejectedAt?: Date | string | null;
    generationMode?: "ai" | "fallback";
    fallbackReason?: string | null;
  };
  const row: Json = {
    article_type: article.articleType,
    headline: article.headline,
    body: article.body,
    executive_summary: article.executiveSummary ?? (includeDefaults ? [] : undefined),
    rgi_take: article.rgiTake ?? (includeDefaults ? "" : undefined),
    key_takeaways: article.keyTakeaways ?? (includeDefaults ? [] : undefined),
    implifications_for_leaders: article.implificationsForLeaders ?? (includeDefaults ? [] : undefined),
    what_most_are_missing: article.whatMostAreMissing,
    mechanism: article.mechanism ?? (includeDefaults ? [] : undefined),
    constraints_and_risks: article.constraintsAndRisks ?? (includeDefaults ? [] : undefined),
    what_changed_since_yesterday: article.whatChangedSinceYesterday ?? (includeDefaults ? [] : undefined),
    what_to_watch: article.whatToWatch ?? (includeDefaults ? [] : undefined),
    summary_takeaways: article.summaryTakeaways ?? (includeDefaults ? [] : undefined),
    topic_tags: article.topicTags ?? (includeDefaults ? [] : undefined),
    source_article_ids: article.sourceArticleIds ?? (includeDefaults ? [] : undefined),
    relevancy_score: article.relevancyScore,
    status: article.status ? normalizeDigestStatus(article.status) : undefined,
    editor_notes: article.editorNotes,
    published_at: article.publishedAt instanceof Date ? article.publishedAt.toISOString() : article.publishedAt,
    discipline: article.discipline,
    newsletter_sent_at: article.newsletterSentAt instanceof Date ? article.newsletterSentAt.toISOString() : article.newsletterSentAt,
    newsletter_sent_count: article.newsletterSentCount,
  };
  if (workflowColumns.has("approved_at") && extended.approvedAt !== undefined) {
    row.approved_at = extended.approvedAt instanceof Date ? extended.approvedAt.toISOString() : extended.approvedAt;
  }
  if (workflowColumns.has("rejected_at") && extended.rejectedAt !== undefined) {
    row.rejected_at = extended.rejectedAt instanceof Date ? extended.rejectedAt.toISOString() : extended.rejectedAt;
  }
  if (workflowColumns.has("generation_mode") && extended.generationMode !== undefined) {
    row.generation_mode = extended.generationMode;
  }
  if (workflowColumns.has("fallback_reason") && extended.fallbackReason !== undefined) {
    row.fallback_reason = extended.fallbackReason;
  }
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function settingsFromRow(row: Json): Settings {
  return {
    id: Number(row.id ?? 1),
    relevancyThreshold: Number(row.relevancy_threshold ?? 7),
    scrapeIntervalHours: Number(row.scrape_interval_hours ?? 24),
    scrapeTimeUtc: String(row.scrape_time_utc ?? "11:00"),
  };
}

function andFilters(filters: string[]): string {
  return filters.length ? `&${filters.join("&")}` : "";
}

export function useSupabaseData(): boolean {
  return useFirestoreData() || Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export async function listSupabaseArticles(query: {
  status?: string;
  minScore?: number;
  topicTag?: string;
  source?: string;
  platform?: string;
  sortBy?: string;
  limit?: number;
} = {}): Promise<Article[]> {
  if (useFirestoreData()) return listFirestoreArticles(query);
  const filters: string[] = [];
  if (query.status) filters.push(`status=eq.${encodeURIComponent(query.status)}`);
  if (query.minScore !== undefined) filters.push(`relevancy_score=gte.${query.minScore}`);
  if (query.source) filters.push(`source_name=eq.${encodeURIComponent(query.source)}`);
  if (query.platform) filters.push(`platform=eq.${encodeURIComponent(query.platform)}`);

  const order =
    query.sortBy === "time"
      ? "published_at.desc.nullslast,scraped_at.desc"
      : query.sortBy === "source"
        ? "source_name.asc,relevancy_score.desc"
        : "relevancy_score.desc,scraped_at.desc";
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>(
      `articles?select=*&order=${encodeURIComponent(order)}&limit=${query.limit ?? 200}${andFilters(filters)}`
    );
  } catch (error) {
    if (isMissingSupabaseTable(error)) return [];
    throw error;
  }
  const articles = rows.map(rowToArticle);
  return query.topicTag
    ? articles.filter((a) => (Array.isArray(a.topicTags) ? a.topicTags : []).includes(query.topicTag!))
    : articles;
}

export async function countSupabaseArticles(query: { status?: string } = {}): Promise<number> {
  if (useFirestoreData()) return countFirestoreArticles(query);
  const filters = query.status ? `&status=eq.${encodeURIComponent(query.status)}` : "";
  try {
    return await supabaseCount(`articles?select=id${filters}`);
  } catch (error) {
    if (isMissingSupabaseTable(error)) return 0;
    throw error;
  }
}

export async function getSupabaseArticle(id: number): Promise<Article | null> {
  if (useFirestoreData()) return getFirestoreArticle(id);
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>(`articles?select=*&id=eq.${id}&limit=1`);
  } catch (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }
  return rows[0] ? rowToArticle(rows[0]) : null;
}

export async function getSupabaseArticleByUrl(url: string): Promise<Article | null> {
  if (useFirestoreData()) return getFirestoreArticleByUrl(url);
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>(`articles?select=*&url=eq.${encodeURIComponent(url)}&limit=1`);
  } catch (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }
  return rows[0] ? rowToArticle(rows[0]) : null;
}

export async function createSupabaseArticle(article: Partial<Article>): Promise<Article> {
  if (useFirestoreData()) return createFirestoreArticle(article);
  const includeHardeningColumns = await supportsArticleHardeningColumns();
  const rows = await supabaseRequest<Json[]>("articles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(articleToRow(article, includeHardeningColumns)),
  });
  if (!rows[0]) throw new Error("Supabase did not return inserted article.");
  return rowToArticle(rows[0]);
}

export async function updateSupabaseArticles(ids: number[], patch: Partial<Article>): Promise<void> {
  if (useFirestoreData()) return updateFirestoreArticles(ids, patch);
  if (ids.length === 0) return;
  const includeHardeningColumns = await supportsArticleHardeningColumns();
  await supabaseRequest<Json[]>(`articles?id=in.(${ids.join(",")})`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(articleToRow(patch, includeHardeningColumns)),
  });
}

export async function deleteSupabaseArticle(id: number): Promise<boolean> {
  if (useFirestoreData()) return deleteFirestoreArticle(id);
  const rows = await supabaseRequest<Json[]>(`articles?id=eq.${id}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return rows.length > 0;
}

export async function latestSupabaseScrapedAt(): Promise<Date | null> {
  if (useFirestoreData()) return latestFirestoreScrapedAt();
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>("articles?select=scraped_at&order=scraped_at.desc&limit=1");
  } catch (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }
  return dateOrNull(rows[0]?.scraped_at);
}

export async function listActiveSupabaseSources(): Promise<Source[]> {
  if (useFirestoreData()) return listActiveFirestoreSources();
  return (await listSupabaseSources()).filter((s) => s.isActive);
}

export async function listSupabaseDigests(query: { status?: string; limit?: number } = {}): Promise<DigestArticle[]> {
  if (useFirestoreData()) return listFirestoreDigests(query);
  const status = query.status ? normalizeDigestStatus(query.status) : undefined;
  const filters = status ? `&status=eq.${encodeURIComponent(status)}` : "";
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>(
      `digest_articles?select=*&order=created_at.desc&limit=${query.limit ?? 50}${filters}`
    );
  } catch (error) {
    if (isMissingSupabaseTable(error)) return [];
    throw error;
  }
  return rows.map(rowToDigest);
}

export async function countSupabaseDigests(query: { status?: string } = {}): Promise<number> {
  if (useFirestoreData()) return countFirestoreDigests(query);
  const status = query.status ? normalizeDigestStatus(query.status) : undefined;
  const filters = status ? `&status=eq.${encodeURIComponent(status)}` : "";
  try {
    return await supabaseCount(`digest_articles?select=id${filters}`);
  } catch (error) {
    if (isMissingSupabaseTable(error)) return 0;
    throw error;
  }
}

export async function getSupabaseDigest(id: number): Promise<DigestArticle | null> {
  if (useFirestoreData()) return getFirestoreDigest(id);
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>(`digest_articles?select=*&id=eq.${id}&limit=1`);
  } catch (error) {
    if (isMissingSupabaseTable(error)) return null;
    throw error;
  }
  return rows[0] ? rowToDigest(rows[0]) : null;
}

export async function createSupabaseDigest(article: Partial<DigestArticle>): Promise<DigestArticle> {
  if (useFirestoreData()) return createFirestoreDigest(article);
  const workflowColumns = await getDigestWorkflowColumns();
  const rows = await supabaseRequest<Json[]>("digest_articles", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(digestToRow(article, workflowColumns, true)),
  });
  if (!rows[0]) throw new Error("Supabase did not return inserted digest article.");
  return rowToDigest(rows[0]);
}

export async function updateSupabaseDigest(id: number, patch: Partial<DigestArticle>): Promise<DigestArticle | null> {
  if (useFirestoreData()) return updateFirestoreDigest(id, patch);
  const workflowColumns = await getDigestWorkflowColumns();
  const rows = await supabaseRequest<Json[]>(`digest_articles?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(digestToRow({ ...patch, updatedAt: new Date() }, workflowColumns)),
  });
  return rows[0] ? rowToDigest(rows[0]) : null;
}

export async function deleteSupabaseDigest(id: number): Promise<boolean> {
  if (useFirestoreData()) return deleteFirestoreDigest(id);
  const rows = await supabaseRequest<Json[]>(`digest_articles?id=eq.${id}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return rows.length > 0;
}

export async function enrichSupabaseDigest(article: DigestArticle): Promise<DigestArticle & { sourceArticles: Article[] }> {
  if (useFirestoreData()) return enrichFirestoreDigest(article);
  const sourceArticles = article.sourceArticleIds.length > 0
    ? (await Promise.all(article.sourceArticleIds.map(getSupabaseArticle))).filter(Boolean) as Article[]
    : [];
  return { ...article, sourceArticles };
}

export async function getSupabaseSettings(): Promise<Settings> {
  if (useFirestoreData()) return getFirestoreSettings();
  let rows: Json[] = [];
  try {
    rows = await supabaseRequest<Json[]>("settings?select=*&id=eq.1&limit=1");
  } catch (error) {
    if (isMissingSupabaseTable(error)) return DEFAULT_SETTINGS;
    throw error;
  }
  return rows[0] ? settingsFromRow(rows[0]) : DEFAULT_SETTINGS;
}

export async function upsertSupabaseSettings(patch: Partial<Settings>): Promise<Settings> {
  if (useFirestoreData()) return upsertFirestoreSettings(patch);
  const body = {
    id: 1,
    relevancy_threshold: patch.relevancyThreshold ?? DEFAULT_SETTINGS.relevancyThreshold,
    scrape_interval_hours: patch.scrapeIntervalHours ?? DEFAULT_SETTINGS.scrapeIntervalHours,
    scrape_time_utc: patch.scrapeTimeUtc ?? DEFAULT_SETTINGS.scrapeTimeUtc,
  };
  const rows = await supabaseRequest<Json[]>("settings", {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  return rows[0] ? settingsFromRow(rows[0]) : DEFAULT_SETTINGS;
}
