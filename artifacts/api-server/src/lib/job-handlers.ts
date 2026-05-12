import type { Article, DigestArticle } from "@workspace/db";
import { generateDailyBrief, generateDigestArticle } from "./ai-writer";
import { logger } from "./logger";
import { runScrape } from "./scraper";
import {
  createSupabaseDigest,
  enrichSupabaseDigest,
  updateSupabaseArticles,
} from "./supabase-data";
import type { JobRecord } from "./job-queue";

type JobPayload = Record<string, unknown>;

function payload(job: JobRecord): JobPayload {
  return typeof job.payload === "object" && job.payload !== null ? job.payload as JobPayload : {};
}

function numericIds(value: unknown): number[] {
  return Array.isArray(value) ? value.map(Number).filter((id) => Number.isFinite(id)) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function maybeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function persistStrategicBrief(job: JobRecord): Promise<DigestArticle & { sourceArticles?: Article[] }> {
  const data = payload(job);
  const articleIds = numericIds(data.articleIds);
  const editorNotes = maybeString(data.editorNotes);
  const generated = await generateDigestArticle(articleIds, editorNotes);

  const digest = await createSupabaseDigest({
    articleType: "topic_article",
    headline: generated.headline,
    body: generated.body,
    executiveSummary: generated.executiveSummary,
    rgiTake: generated.rgiTake,
    keyTakeaways: generated.keyTakeaways,
    whatToWatch: generated.whatToWatch,
    whatMostAreMissing: generated.whatMostAreMissing ?? null,
    mechanism: generated.mechanism ?? [],
    constraintsAndRisks: generated.constraintsAndRisks ?? [],
    implificationsForLeaders: generated.implificationsForLeaders ?? [],
    topicTags: generated.topicTags,
    sourceArticleIds: articleIds,
    relevancyScore: generated.relevancyScore,
    discipline: generated.discipline,
    status: "pending_review",
    editorNotes,
    generationMode: generated.generationMode ?? "ai",
    fallbackReason: generated.fallbackReason ?? null,
  } as Partial<DigestArticle>);

  if (articleIds.length) await updateSupabaseArticles(articleIds, { status: "selected" });
  return enrichSupabaseDigest(digest);
}

async function persistDailyBrief(job: JobRecord): Promise<DigestArticle & { sourceArticles?: Article[] }> {
  const data = payload(job);
  const articleIds = numericIds(data.articleIds);
  const editorNotes = maybeString(data.editorNotes);
  const excludedTopics = strings(data.excludedTopics);
  const requestId = maybeString(data.requestId) ?? `worker-daily-${Date.now()}`;
  logger.info({ requestId, handler: "persistDailyBrief", dbContentReused: false }, "[daily-brief-trace] Durable daily brief handler generating fresh content");
  console.log(`[daily-brief-trace:${requestId}] durable handler: persistDailyBrief`);
  console.log(`[daily-brief-trace:${requestId}] cached DB content reused: false`);
  const generated = await generateDailyBrief(articleIds.length ? articleIds : undefined, editorNotes, excludedTopics.length ? excludedTopics : undefined, null, { requestId });

  const digest = await createSupabaseDigest({
    articleType: "daily_brief",
    headline: generated.headline,
    body: generated.body,
    executiveSummary: generated.executiveSummary,
    rgiTake: generated.rgiTake,
    keyTakeaways: generated.keyTakeaways,
    implificationsForLeaders: generated.implificationsForLeaders,
    whatMostAreMissing: generated.whatMostAreMissing ?? null,
    mechanism: generated.mechanism ?? [],
    constraintsAndRisks: generated.constraintsAndRisks ?? [],
    whatChangedSinceYesterday: generated.whatChangedSinceYesterday,
    whatToWatch: generated.whatToWatch,
    summaryTakeaways: generated.summaryTakeaways,
    topicTags: generated.topicTags,
    sourceArticleIds: generated.sourceArticleIds,
    relevancyScore: generated.relevancyScore,
    discipline: generated.discipline,
    status: "pending_review",
    editorNotes,
    generationMode: generated.generationMode ?? "ai",
    fallbackReason: generated.fallbackReason ?? null,
  } as Partial<DigestArticle>);

  if (generated.sourceArticleIds.length) await updateSupabaseArticles(generated.sourceArticleIds, { status: "selected" });
  return enrichSupabaseDigest(digest);
}

export async function executeDurableJob(job: JobRecord): Promise<unknown> {
  logger.info({ jobId: job.id, handler: job.handler }, "Executing durable job handler");
  if (job.handler === "manual-scrape") return runScrape();
  if (job.handler === "generate-strategic-brief") return persistStrategicBrief(job);
  if (job.handler === "generate-daily-brief") return persistDailyBrief(job);
  throw new Error(`No durable handler registered for ${job.handler || "unknown job"}`);
}
