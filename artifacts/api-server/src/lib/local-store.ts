import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Article, DigestArticle, Settings, Source } from "@workspace/db";
import { logger } from "./logger";

const STORE_PATH = path.resolve(process.cwd(), "../../.local-run/rgi-local-db.json");

type LocalDb = {
  counters: Record<string, number>;
  sources: Source[];
  articles: Article[];
  digest_articles: DigestArticle[];
  settings: Settings;
};

const DEFAULT_SETTINGS: Settings = {
  id: 1,
  relevancyThreshold: 6,
  scrapeIntervalHours: 24,
  scrapeTimeUtc: "11:00",
};

const DEFAULT_SOURCES: Source[] = [
  { id: "reuters-world" as any, name: "Reuters World", url: "https://www.reutersagency.com/feed/?best-topics=world&post_type=best", type: "rss", tier: 1, isActive: true, authorName: null, authorType: "Institutional", authorityLevel: 9, description: "Reuters global affairs feed", weight: 1.5, createdAt: new Date(0) },
  { id: "bbc-world" as any, name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", type: "rss", tier: 1, isActive: true, authorName: null, authorType: "Institutional", authorityLevel: 8, description: "BBC world news", weight: 1.25, createdAt: new Date(0) },
  { id: "cfr" as any, name: "Council on Foreign Relations", url: "https://www.cfr.org/rss.xml", type: "rss", tier: 1, isActive: true, authorName: null, authorType: "Think Tank", authorityLevel: 9, description: "Foreign policy analysis", weight: 1.35, createdAt: new Date(0) },
  { id: "ft-world" as any, name: "Financial Times World", url: "https://www.ft.com/world?format=rss", type: "rss", tier: 1, isActive: true, authorName: null, authorType: "Institutional", authorityLevel: 9, description: "Financial Times world coverage", weight: 1.4, createdAt: new Date(0) },
  { id: "ap-world" as any, name: "Associated Press World", url: "https://apnews.com/hub/world-news?output=rss", type: "rss", tier: 1, isActive: true, authorName: null, authorType: "Institutional", authorityLevel: 8, description: "AP world news", weight: 1.2, createdAt: new Date(0) },
];

function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reviveDates) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = /(?:At|Date|createdAt|updatedAt)$/i.test(key) && typeof item === "string" ? new Date(item) : reviveDates(item);
    }
    return out as T;
  }
  return value;
}

function normalizeStatus(value: unknown): DigestArticle["status"] {
  const raw = String(value ?? "pending_review").toLowerCase().trim();
  if (raw === "published") return "approved";
  if (raw === "pending") return "pending_review";
  return ["draft", "pending_review", "approved", "rejected", "regenerating"].includes(raw)
    ? raw as DigestArticle["status"]
    : "pending_review";
}

async function loadDb(): Promise<LocalDb> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  if (!existsSync(STORE_PATH)) {
    const fresh: LocalDb = {
      counters: { articles: 0, digest_articles: 0 },
      sources: DEFAULT_SOURCES,
      articles: [],
      digest_articles: [],
      settings: DEFAULT_SETTINGS,
    };
    await saveDb(fresh);
    return fresh;
  }
  const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as LocalDb;
  return {
    counters: parsed.counters ?? { articles: 0, digest_articles: 0 },
    sources: reviveDates(parsed.sources?.length ? parsed.sources : DEFAULT_SOURCES),
    articles: reviveDates(parsed.articles ?? []),
    digest_articles: reviveDates(parsed.digest_articles ?? []),
    settings: reviveDates(parsed.settings ?? DEFAULT_SETTINGS),
  };
}

async function saveDb(db: LocalDb): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(db, null, 2));
}

export function localStorePath(): string {
  return STORE_PATH;
}

export async function listLocalSources(): Promise<Source[]> {
  return (await loadDb()).sources.sort((a, b) => Number(a.tier) - Number(b.tier) || a.name.localeCompare(b.name));
}

export async function createLocalSource(source: Partial<Source>): Promise<Source> {
  const db = await loadDb();
  const saved = {
    id: String(source.id ?? `local-source-${Date.now()}`) as any,
    name: String(source.name ?? "Untitled Source"),
    url: String(source.url ?? ""),
    type: (source.type ?? "rss") as Source["type"],
    tier: Number(source.tier ?? 2),
    isActive: source.isActive !== false,
    authorName: source.authorName ?? null,
    authorType: source.authorType ?? null,
    authorityLevel: Number(source.authorityLevel ?? 5),
    description: source.description ?? null,
    weight: Number(source.weight ?? 1),
    createdAt: new Date(),
  } as Source;
  db.sources.push(saved);
  await saveDb(db);
  return saved;
}

export async function updateLocalSource(id: number | string, patch: Partial<Source>): Promise<Source | null> {
  const db = await loadDb();
  const index = db.sources.findIndex((s) => String(s.id) === String(id));
  if (index < 0) return null;
  db.sources[index] = { ...db.sources[index], ...patch } as Source;
  await saveDb(db);
  return db.sources[index];
}

export async function deleteLocalSource(id: number | string): Promise<boolean> {
  const db = await loadDb();
  const before = db.sources.length;
  db.sources = db.sources.filter((s) => String(s.id) !== String(id));
  await saveDb(db);
  return db.sources.length !== before;
}

export async function listLocalArticles(query: { status?: string; limit?: number } = {}): Promise<Article[]> {
  const db = await loadDb();
  let articles = db.articles;
  if (query.status) articles = articles.filter((a) => a.status === query.status);
  return [...articles]
    .sort((a, b) => Number(b.relevancyScore ?? 0) - Number(a.relevancyScore ?? 0) || Number(b.scrapedAt) - Number(a.scrapedAt))
    .slice(0, query.limit ?? 200);
}

export async function getLocalArticle(id: number): Promise<Article | null> {
  return (await loadDb()).articles.find((a) => Number(a.id) === Number(id)) ?? null;
}

export async function getLocalArticleByUrl(url: string): Promise<Article | null> {
  return (await loadDb()).articles.find((a) => a.url === url) ?? null;
}

export async function createLocalArticle(article: Partial<Article>): Promise<Article> {
  const db = await loadDb();
  const existing = db.articles.find((a) => a.url === article.url || a.headline.toLowerCase().trim() === String(article.headline ?? "").toLowerCase().trim());
  if (existing) return existing;
  const id = (db.counters.articles ?? 0) + 1;
  db.counters.articles = id;
  const saved = {
    id,
    headline: String(article.headline ?? ""),
    url: String(article.url ?? ""),
    sourceName: String(article.sourceName ?? ""),
    sourceUrl: article.sourceUrl ?? null,
    author: article.author ?? null,
    authorType: article.authorType ?? null,
    platform: article.platform ?? "news",
    isEmergingSignal: Boolean(article.isEmergingSignal),
    isPrimarySignal: Boolean(article.isPrimarySignal),
    relevancyScore: Number(article.relevancyScore ?? 5),
    authenticityScore: Number(article.authenticityScore ?? 5),
    viewpoint: article.viewpoint ?? null,
    topicTags: Array.isArray(article.topicTags) ? article.topicTags : [],
    teaserSummary: article.teaserSummary ?? null,
    publishedAt: article.publishedAt ?? null,
    scrapedAt: article.scrapedAt ?? new Date(),
    content: article.content ?? null,
    status: article.status ?? "pending",
    disciplineAlignment: article.disciplineAlignment ?? null,
  } as Article;
  db.articles.push(saved);
  await saveDb(db);
  return saved;
}

export async function updateLocalArticles(ids: number[], patch: Partial<Article>): Promise<void> {
  const db = await loadDb();
  const wanted = new Set(ids.map(Number));
  db.articles = db.articles.map((article) => wanted.has(Number(article.id)) ? { ...article, ...patch } as Article : article);
  await saveDb(db);
}

export async function updateLocalArticle(id: number, patch: Partial<Article>): Promise<Article | null> {
  const db = await loadDb();
  const index = db.articles.findIndex((a) => Number(a.id) === Number(id));
  if (index < 0) return null;
  db.articles[index] = { ...db.articles[index], ...patch } as Article;
  await saveDb(db);
  return db.articles[index];
}

export async function deleteLocalArticle(id: number): Promise<boolean> {
  const db = await loadDb();
  const before = db.articles.length;
  db.articles = db.articles.filter((a) => Number(a.id) !== Number(id));
  await saveDb(db);
  return before !== db.articles.length;
}

export async function listLocalDigests(query: { status?: string; limit?: number } = {}): Promise<DigestArticle[]> {
  const db = await loadDb();
  let digests = db.digest_articles;
  if (query.status) digests = digests.filter((d) => normalizeStatus(d.status) === normalizeStatus(query.status));
  return [...digests].sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, query.limit ?? 50);
}

export async function getLocalDigest(id: number): Promise<DigestArticle | null> {
  return (await loadDb()).digest_articles.find((d) => Number(d.id) === Number(id)) ?? null;
}

export async function createLocalDigest(article: Partial<DigestArticle>): Promise<DigestArticle> {
  const db = await loadDb();
  const id = (db.counters.digest_articles ?? 0) + 1;
  db.counters.digest_articles = id;
  const now = new Date();
  const saved = {
    id,
    articleType: article.articleType ?? "daily_brief",
    headline: article.headline ?? "RGI Daily Intelligence Brief",
    body: article.body ?? "",
    executiveSummary: article.executiveSummary ?? [],
    rgiTake: article.rgiTake ?? "",
    keyTakeaways: article.keyTakeaways ?? [],
    implificationsForLeaders: article.implificationsForLeaders ?? [],
    whatMostAreMissing: article.whatMostAreMissing ?? null,
    mechanism: article.mechanism ?? [],
    constraintsAndRisks: article.constraintsAndRisks ?? [],
    whatChangedSinceYesterday: article.whatChangedSinceYesterday ?? [],
    whatToWatch: article.whatToWatch ?? [],
    summaryTakeaways: article.summaryTakeaways ?? [],
    topicTags: article.topicTags ?? [],
    sourceArticleIds: article.sourceArticleIds ?? [],
    relevancyScore: article.relevancyScore ?? null,
    status: normalizeStatus(article.status),
    editorNotes: article.editorNotes ?? null,
    publishedAt: article.publishedAt ?? null,
    discipline: article.discipline ?? null,
    newsletterSentAt: article.newsletterSentAt ?? null,
    newsletterSentCount: article.newsletterSentCount ?? null,
    createdAt: now,
    updatedAt: now,
  } as DigestArticle;
  db.digest_articles.push(saved);
  await saveDb(db);
  return saved;
}

export async function updateLocalDigest(id: number, patch: Partial<DigestArticle>): Promise<DigestArticle | null> {
  const db = await loadDb();
  const index = db.digest_articles.findIndex((d) => Number(d.id) === Number(id));
  if (index < 0) return null;
  db.digest_articles[index] = { ...db.digest_articles[index], ...patch, updatedAt: new Date() } as DigestArticle;
  await saveDb(db);
  return db.digest_articles[index];
}

export async function deleteLocalDigest(id: number): Promise<boolean> {
  const db = await loadDb();
  const before = db.digest_articles.length;
  db.digest_articles = db.digest_articles.filter((d) => Number(d.id) !== Number(id));
  await saveDb(db);
  return before !== db.digest_articles.length;
}

export async function getLocalSettings(): Promise<Settings> {
  return (await loadDb()).settings;
}

export async function upsertLocalSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = await loadDb();
  db.settings = { ...db.settings, ...patch };
  await saveDb(db);
  return db.settings;
}

export async function localFallback<T>(label: string, error: unknown, fallback: () => Promise<T>): Promise<T> {
  if (process.env.RGI_ALLOW_LOCAL_FALLBACK !== "true") {
    logger.error(
      { label, error: error instanceof Error ? error.message : String(error), store: STORE_PATH },
      "Firestore unavailable; local fallback disabled"
    );
    throw error instanceof Error ? error : new Error(String(error));
  }
  logger.warn({ label, error: error instanceof Error ? error.message : String(error), store: STORE_PATH }, "Firestore unavailable; using local operational store");
  return fallback();
}
