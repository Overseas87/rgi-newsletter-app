import { db, digestArticlesTable, articlesTable } from "@workspace/db";
import { eq, gte, lt, desc, and, count } from "drizzle-orm";
import { logger } from "./logger";
import { generateDailyBrief } from "./ai-writer";
import { runScrape } from "./scraper";

/** Fetches yesterday's daily_brief and formats it as context for "What Changed Since Yesterday". */
async function getYesterdayBriefContext(): Promise<string | null> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  const rows = await db
    .select()
    .from(digestArticlesTable)
    .where(
      and(
        eq(digestArticlesTable.articleType, "daily_brief"),
        gte(digestArticlesTable.createdAt, yesterdayStart),
        lt(digestArticlesTable.createdAt, todayStart)
      )
    )
    .orderBy(desc(digestArticlesTable.createdAt))
    .limit(1);

  const prev = rows[0];
  if (!prev) return null;

  const keyDevs = prev.body.split("\n").filter(Boolean);
  const lines: string[] = [
    `Headline: ${prev.headline}`,
    `Key Developments:\n${keyDevs.map((d) => `- ${d}`).join("\n")}`,
  ];
  if (prev.keyTakeaways?.length) {
    lines.push(`Why It Matters:\n${prev.keyTakeaways.map((t) => `- ${t}`).join("\n")}`);
  }
  if (prev.rgiTake) lines.push(`RGI Take: ${prev.rgiTake}`);
  return lines.join("\n\n");
}

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
    const previousBriefContext = await getYesterdayBriefContext();
    if (previousBriefContext) {
      logger.info("Found yesterday's brief — including as context for 'What Changed Since Yesterday'");
    }

    let brief: Awaited<ReturnType<typeof generateDailyBrief>>;
    let usedFallback = false;

    try {
      brief = await generateDailyBrief(undefined, editorNotes ?? null, undefined, previousBriefContext);
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

      brief = await generateDailyBrief(fallbackIds, fallbackNote, undefined, previousBriefContext);
      usedFallback = true;
    }

    await db.insert(digestArticlesTable).values({
      articleType: "daily_brief",
      headline: brief.headline,
      body: brief.body,
      executiveSummary: brief.executiveSummary,
      rgiTake: brief.rgiTake,
      keyTakeaways: brief.keyTakeaways,
      implificationsForLeaders: brief.implificationsForLeaders,
      whatChangedSinceYesterday: brief.whatChangedSinceYesterday,
      whatToWatch: brief.whatToWatch,
      summaryTakeaways: brief.summaryTakeaways,
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
