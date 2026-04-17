import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { initializeScrapeStatus, runScrape } from "./lib/scraper";
import { db, articlesTable } from "@workspace/db";
import { gte, count } from "drizzle-orm";

const app: Express = express();

// Start cron scheduler for daily scrapes
startScheduler();

// Initialize scrape status from DB so "Last Scraped" is never blank after restart
initializeScrapeStatus().then(async () => {
  // Auto-trigger a scrape if no articles have been fetched today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [{ todayCount }] = await db
    .select({ todayCount: count() })
    .from(articlesTable)
    .where(gte(articlesTable.scrapedAt, today));

  if (todayCount === 0) {
    logger.info("No articles for today — triggering automatic startup scrape");
    runScrape().catch((err) => logger.error({ err }, "Startup scrape failed"));
  }
}).catch((err) => logger.error({ err }, "Startup initialization failed"));

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
