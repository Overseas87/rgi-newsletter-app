import cron from "node-cron";
import { runScrape } from "./scraper";
import { runDailyBriefJob } from "./daily-brief-scheduler";
import { logger } from "./logger";

export function startScheduler(): void {
  // Run daily at 6:00 AM EST (11:00 UTC)
  // Step 1 — scrape the latest intelligence
  // Step 2 — auto-generate and save the daily brief (pending_review)
  cron.schedule("0 11 * * *", async () => {
    logger.info("Scheduled daily pipeline starting (scrape → daily brief)");

    // Scrape first so the brief has fresh material
    try {
      const result = await runScrape();
      logger.info(result, "Scheduled scrape completed");
    } catch (err) {
      logger.error({ err }, "Scheduled scrape failed — proceeding to brief with existing articles");
    }

    // Generate and persist today's daily brief
    await runDailyBriefJob();
  });

  logger.info("Scheduler started — daily pipeline at 11:00 UTC (6:00 AM EST)");
}
