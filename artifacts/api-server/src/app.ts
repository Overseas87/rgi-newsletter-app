import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { initializeScrapeStatus, runScrape } from "./lib/scraper";
import { runDailyBriefJob } from "./lib/daily-brief-scheduler";
import { seedDefaultSources } from "./lib/seed-sources";
import { seedProductionData } from "./lib/seed-production-data";
import { db, articlesTable } from "@workspace/db";
import { sourcesTable, digestArticlesTable as digestTable } from "@workspace/db/schema";
import { gte, count, sql } from "drizzle-orm";

const app: Express = express();

// Start cron scheduler for daily scrapes
startScheduler();

// Startup initialization: verify DB → seed sources → initialize scrape status → auto-scrape if needed.
// ── Persistence guarantee ────────────────────────────────────────────────────────────────────────
//  1. Database connectivity is verified before anything else. If the DB is unreachable the process
//     will log a hard error rather than silently continuing with an empty state.
//  2. Seeding only runs when the sources table is completely empty (fresh deployment). Existing
//     sources, weights, and credibility data are never overwritten.
//  3. Auto-scrape only fires when no articles exist from the last 24 h, so a restart or redeploy
//     never wipes the visible dashboard — existing data is served immediately.
//  4. A persistence audit log is emitted at startup so operators can confirm data was loaded.
async function initializeApp() {
  // Step 1 — verify database connectivity
  try {
    await db.execute(sql`SELECT 1`);
    logger.info("Database connectivity verified");
  } catch (err) {
    logger.error({ err }, "FATAL: Cannot connect to database — server will start but data will be unavailable");
    // Do not throw — let the health endpoint surface the error to the load balancer
    return;
  }

  // Step 2 — persistence audit: log current data state so operators can confirm no data was lost
  try {
    const [{ sourcesCount }] = await db.select({ sourcesCount: count() }).from(sourcesTable);
    const [{ articlesCount }] = await db.select({ articlesCount: count() }).from(articlesTable);
    const [{ digestsCount }] = await db.select({ digestsCount: count() }).from(digestTable);
    logger.info(
      { sourcesCount, articlesCount, digestsCount },
      "Persistence audit — data loaded from database"
    );
  } catch (err) {
    logger.warn({ err }, "Could not run persistence audit — continuing startup");
  }

  // Step 3 — seed all production data (articles, digest_articles, sources, settings)
  // on first run of a fresh database. No-op if any data already exists.
  await seedProductionData();

  // Step 3b — seed default sources only if the table is still empty
  // (covers the case where seedProductionData was skipped and only sources are needed)
  await seedDefaultSources();

  // Step 4 — restore in-memory scrape state from DB timestamps
  await initializeScrapeStatus();

  // Step 5 — auto-scrape fallback: if no articles in the last 60 minutes, trigger a scrape.
  // Covers the case where the hourly scheduler missed a run (e.g. after a restart between cron ticks).
  const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ recentCount }] = await db
    .select({ recentCount: count() })
    .from(articlesTable)
    .where(gte(articlesTable.scrapedAt, sixtyMinutesAgo));

  if (recentCount === 0) {
    logger.info("No articles in the last 60 minutes — triggering automatic startup scrape");
    runScrape().catch((err) => logger.error({ err }, "Startup scrape failed"));
  } else {
    logger.info({ recentCount }, "Recent articles found — skipping startup scrape, dashboard ready");
  }

  // Step 6 — daily brief catch-up: if the server starts after 11:00 UTC (6 AM EST) and no brief
  // exists yet for today, generate one now. This covers the common case where the Replit dev
  // environment was paused when the cron fired. runDailyBriefJob() is internally duplicate-guarded,
  // so it silently skips if a brief was already generated today.
  const utcHour = new Date().getUTCHours();
  if (utcHour >= 11) {
    logger.info({ utcHour }, "Past 11:00 UTC on startup — checking for missed daily brief");
    runDailyBriefJob().catch((err) => logger.error({ err }, "Startup daily brief catch-up failed"));
  }
}

initializeApp().catch((err) => logger.error({ err }, "Startup initialization failed"));

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
