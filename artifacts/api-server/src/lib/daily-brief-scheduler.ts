import { db, digestArticlesTable, articlesTable } from "@workspace/db";
import { eq, gte, lt, desc, and, count } from "drizzle-orm";
import { logger } from "./logger";
import { generateDailyBrief } from "./ai-writer";
import { runScrape } from "./scraper";

/** Returns today's UTC midnight and tomorrow's UTC midnight */
function getTodayBounds(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Returns true if a daily_brief already exists with createdAt in today's UTC window */
async function dailyBriefExistsForToday(): Promise<boolean> {
  const { start, end } = getTodayBounds();
  const rows = await db
    .select({ n: count() })
    .from(digestArticlesTable)
    .where(
      and(
        eq(digestArticlesTable.articleType, "daily_brief"),
        gte(digestArticlesTable.createdAt, start),
        lt(digestArticlesTable.createdAt, end)
      )
    );
  return (rows[0]?.n ?? 0) > 0;
}

/** Returns the number of articles scraped within the last hoursBack hours */
async function recentArticleCount(hoursBack: number): Promise<number> {
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  const rows = await db
    .select({ n: count() })
    .from(articlesTable)
    .where(gte(articlesTable.scrapedAt, cutoff));
  return rows[0]?.n ?? 0;
}

/**
 * One generation attempt: call generateDailyBrief, fall back to recent 7-day
 * articles if today's window is empty, then persist to digest_articles.
 * Returns true on success, false on any error.
 */
async function attemptBriefGeneration(
  editorNotes?: string
): Promise<boolean> {
  try {
    let brief: Awaited<ReturnType<typeof generateDailyBrief>>;
    let usedFallback = false;

    try {
      brief = await generateDailyBrief(undefined, editorNotes ?? null);
    } catch (primaryErr) {
      // Today's window empty or below quality threshold — try last 7 days
      logger.warn(
        { err: primaryErr },
        "No qualifying articles from today — using 7-day fallback"
      );

      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const fallbackRows = await db
        .select({ id: articlesTable.id })
        .from(articlesTable)
        .where(gte(articlesTable.scrapedAt, cutoff))
        .orderBy(desc(articlesTable.relevancyScore))
        .limit(7);

      if (fallbackRows.length === 0) {
        throw new Error("No articles available for brief generation");
      }

      const fallbackIds = fallbackRows.map((r) => r.id);
      const fallbackNote =
        (editorNotes ? editorNotes + "\n\n" : "") +
        "NOTE: Limited recent content — brief synthesises the most relevant intelligence available across the past several days.";

      brief = await generateDailyBrief(fallbackIds, fallbackNote);
      usedFallback = true;
    }

    await db.insert(digestArticlesTable).values({
      articleType: "daily_brief",
      headline: brief.headline,
      body: brief.body,
      executiveSummary: brief.executiveSummary,
      rgiTake: brief.rgiTake,
      keyTakeaways: brief.keyTakeaways,
      whatToWatch: brief.whatToWatch,
      topicTags: brief.topicTags,
      sourceArticleIds: brief.sourceArticleIds,
      relevancyScore: brief.relevancyScore,
      discipline: brief.discipline,
      status: "pending_review",
      editorNotes: usedFallback
        ? "Auto-generated daily brief (limited recent articles — multi-day synthesis)"
        : "Auto-generated daily brief",
    });

    logger.info(
      {
        headline: brief.headline,
        usedFallback,
        sourceCount: brief.sourceArticleIds.length,
      },
      "Daily brief auto-generated and saved as pending_review"
    );
    return true;
  } catch (err) {
    logger.error({ err }, "Daily brief generation attempt failed");
    return false;
  }
}

/**
 * Full daily brief job:
 * 1. Skip if today's brief already exists (duplicate guard)
 * 2. Trigger lightweight scrape if no recent articles
 * 3. Generate and save brief
 * 4. Retry once after 60 s on failure
 */
export async function runDailyBriefJob(): Promise<void> {
  logger.info("Daily brief job starting");

  // Duplicate guard
  try {
    if (await dailyBriefExistsForToday()) {
      logger.info("Daily brief already exists for today — skipping");
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Could not check for existing brief — proceeding");
  }

  // Pre-scrape if inbox is empty
  const recent = await recentArticleCount(6).catch(() => -1);
  if (recent === 0) {
    logger.info("No articles in the last 6 hours — triggering pre-brief scrape");
    try {
      await runScrape();
      logger.info("Pre-brief scrape completed");
    } catch (err) {
      logger.warn({ err }, "Pre-brief scrape failed — proceeding with existing articles");
    }
  }

  // First attempt
  const success = await attemptBriefGeneration();
  if (success) return;

  // Retry once after a short delay
  logger.warn("Daily brief first attempt failed — retrying in 60 seconds");
  await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
  const retrySuccess = await attemptBriefGeneration();
  if (!retrySuccess) {
    logger.error(
      "Daily brief generation failed after retry — manual intervention may be needed"
    );
  }
}
