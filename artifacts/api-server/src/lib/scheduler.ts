import cron from "node-cron";
import { runScrape } from "./scraper";
import { logger } from "./logger";

export function startScheduler(): void {
  // Run daily at 6:00 AM EST (11:00 UTC)
  cron.schedule("0 11 * * *", async () => {
    logger.info("Scheduled daily scrape starting");
    try {
      const result = await runScrape();
      logger.info(result, "Scheduled scrape completed");
    } catch (err) {
      logger.error({ err }, "Scheduled scrape failed");
    }
  });

  logger.info("Scheduler started — daily scrape at 11:00 UTC (6:00 AM EST)");
}
