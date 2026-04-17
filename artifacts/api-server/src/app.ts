import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { initializeScrapeStatus, runScrape } from "./lib/scraper";
import { seedDefaultSources } from "./lib/seed-sources";
import { db, articlesTable } from "@workspace/db";
import { gte, count } from "drizzle-orm";

const app: Express = express();

// Start cron scheduler for daily scrapes
startScheduler();

// Startup initialization: seed sources → initialize scrape status → auto-scrape if needed.
// Auto-scrape only fires when there are no articles in the last 24 hours, so a restart
// or redeploy never wipes the visible dashboard — existing data stays displayed immediately.
seedDefaultSources()
  .then(() => initializeScrapeStatus())
  .then(async () => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [{ recentCount }] = await db
      .select({ recentCount: count() })
      .from(articlesTable)
      .where(gte(articlesTable.scrapedAt, twentyFourHoursAgo));

    if (recentCount === 0) {
      logger.info("No articles in the last 24 hours — triggering automatic startup scrape");
      runScrape().catch((err) => logger.error({ err }, "Startup scrape failed"));
    } else {
      logger.info({ recentCount }, "Recent articles found — skipping startup scrape, dashboard ready");
    }
  })
  .catch((err) => logger.error({ err }, "Startup initialization failed"));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
