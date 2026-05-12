import cron from "node-cron";
import { logger } from "./logger";
import { enqueueUniqueJob } from "./job-queue";
import { executeDurableJob } from "./job-handlers";

/**
 * Run a scrape with a single automatic retry on failure.
 * Logs start time, sources processed, new articles added, and any errors.
 */
async function runScrapeWithRetry(context: string): Promise<void> {
  const startedAt = new Date().toISOString();
  logger.info({ context, startedAt }, "Scrape job starting");

  try {
    const job = await enqueueUniqueJob("scrape", `${context} scrape`, `${context}-scrape`, executeDurableJob, {
      maxAttempts: 2,
      handler: "manual-scrape",
      payload: { requestedBy: context },
    });
    logger.info({ context, jobId: job.id, status: job.status }, "Scrape job queued");
    return;
  } catch (err) {
    logger.error({ context, err }, "Scrape job queueing failed — retrying in 60 seconds");
  }

  // Retry once
  await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
  try {
    const job = await enqueueUniqueJob("scrape", `${context} scrape retry`, `${context}-scrape`, executeDurableJob, {
      maxAttempts: 2,
      handler: "manual-scrape",
      payload: { requestedBy: `${context}-retry` },
    });
    logger.info({ context, jobId: job.id, status: job.status }, "Scrape job retry queued");
  } catch (err) {
    logger.error({ context, err }, "Scrape job retry queueing also failed — will try again next hour");
  }
}

async function queueDailyBrief(context: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const job = await enqueueUniqueJob("generation", `${context} daily brief`, `${context}-daily-brief:${day}`, executeDurableJob, {
    maxAttempts: 1,
    handler: "generate-daily-brief",
    payload: { articleIds: null, editorNotes: `Scheduled ${context} daily brief`, excludedTopics: [] },
  });
  logger.info({ context, jobId: job.id, status: job.status }, "Daily brief job queued");
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

    // Generate and persist today's daily brief through the same queue path used by the UI.
    await queueDailyBrief("daily-pipeline");
  });

  logger.info(
    "Scheduler started — hourly scrape at :00 each hour, daily brief at 11:00 UTC (6:00 AM EST)"
  );
}
