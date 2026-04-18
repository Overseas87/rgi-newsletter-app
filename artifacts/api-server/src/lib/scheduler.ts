import cron from "node-cron";
import { runScrape } from "./scraper";
import { runDailyBriefJob } from "./daily-brief-scheduler";
import { logger } from "./logger";

/**
 * Run a scrape with a single automatic retry on failure.
 * Logs start time, sources processed, new articles added, and any errors.
 */
async function runScrapeWithRetry(context: string): Promise<void> {
  const startedAt = new Date().toISOString();
  logger.info({ context, startedAt }, "Scrape job starting");

  try {
    const result = await runScrape();
    logger.info({ context, ...result }, "Scrape job completed");
    return;
  } catch (err) {
    logger.error({ context, err }, "Scrape job failed — retrying in 60 seconds");
  }

  // Retry once
  await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
  try {
    const result = await runScrape();
    logger.info({ context, ...result }, "Scrape job retry completed");
  } catch (err) {
    logger.error({ context, err }, "Scrape job retry also failed — will try again next hour");
  }
}

export function startScheduler(): void {
  // ── Hourly scrape — runs at :00 of every hour ────────────────────────────────
  // Keeps the intelligence feed continuously current without manual intervention.
  // At 11:00 UTC the daily pipeline below also fires; the scraper's 12-minute
  // source cache prevents double-fetching at that overlap.
  cron.schedule("0 * * * *", async () => {
    const hour = new Date().toUTCString();
    logger.info({ hour }, "Hourly scrape starting");
    await runScrapeWithRetry("hourly");
  });

  // ── Daily pipeline — runs at 6:00 AM EST (11:00 UTC) ─────────────────────────
  // Step 1: scrape (gets latest content; cache deduplicates with the hourly run)
  // Step 2: auto-generate today's daily brief and save as pending_review
  cron.schedule("0 11 * * *", async () => {
    logger.info("Daily pipeline starting (scrape → daily brief)");

    await runScrapeWithRetry("daily-pipeline");

    // Generate and persist today's daily brief (duplicate-guarded)
    await runDailyBriefJob();
  });

  logger.info(
    "Scheduler started — hourly scrape at :00 each hour, daily brief at 11:00 UTC (6:00 AM EST)"
  );
}
