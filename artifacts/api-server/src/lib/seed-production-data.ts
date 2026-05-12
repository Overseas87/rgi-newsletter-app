import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool } from "@workspace/db";
import { db } from "@workspace/db";
import { sourcesTable, articlesTable } from "@workspace/db/schema";
import { count, sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * All canonical sources. Upserted on every startup so newly added sources
 * are automatically provisioned in production without requiring a fresh database.
 */
const CANONICAL_SOURCES = [
  { id: 1,  name: "New York Times",               url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",        type: "rss", tier: 1, authorityLevel: 3 },
  { id: 2,  name: "Wall Street Journal",          url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",                      type: "rss", tier: 1, authorityLevel: 3 },
  { id: 3,  name: "Financial Times",              url: "https://www.ft.com/rss/home/us",                                   type: "rss", tier: 1, authorityLevel: 3 },
  { id: 4,  name: "Reuters",                      url: "https://feeds.reuters.com/reuters/topNews",                         type: "rss", tier: 1, authorityLevel: 3 },
  { id: 5,  name: "Bloomberg",                    url: "https://feeds.bloomberg.com/markets/news.rss",                      type: "rss", tier: 1, authorityLevel: 3 },
  { id: 6,  name: "The Economist",                url: "https://www.economist.com/the-world-this-week/rss.xml",             type: "rss", tier: 1, authorityLevel: 3 },
  { id: 7,  name: "Politico",                     url: "https://rss.politico.com/politics-news.xml",                       type: "rss", tier: 1, authorityLevel: 3 },
  { id: 8,  name: "MIT Technology Review",        url: "https://www.technologyreview.com/feed/",                            type: "rss", tier: 1, authorityLevel: 3 },
  { id: 9,  name: "Harvard Business Review",      url: "https://feeds.hbr.org/harvardbusiness",                             type: "rss", tier: 1, authorityLevel: 3 },
  { id: 10, name: "Axios",                        url: "https://api.axios.com/feed/",                                       type: "rss", tier: 2, authorityLevel: 3 },
  { id: 11, name: "The Atlantic",                 url: "https://feeds.feedburner.com/TheAtlantic",                          type: "rss", tier: 2, authorityLevel: 3 },
  { id: 12, name: "Stanford Social Innovation Review", url: "https://ssir.org/articles/feed",                               type: "rss", tier: 2, authorityLevel: 3 },
  { id: 13, name: "McKinsey Insights",            url: "https://www.mckinsey.com/rss/latest.xml",                           type: "rss", tier: 2, authorityLevel: 3 },
  { id: 14, name: "Fast Company",                 url: "https://www.fastcompany.com/latest/rss",                            type: "rss", tier: 2, authorityLevel: 3 },
  { id: 15, name: "Wired",                        url: "https://www.wired.com/feed/rss",                                    type: "rss", tier: 1, authorityLevel: 3 },
  { id: 16, name: "TechCrunch",                   url: "https://techcrunch.com/feed/",                                      type: "rss", tier: 1, authorityLevel: 3 },
  { id: 17, name: "The Verge",                    url: "https://www.theverge.com/rss/index.xml",                            type: "rss", tier: 2, authorityLevel: 3 },
  { id: 18, name: "VentureBeat",                  url: "https://feeds.feedburner.com/venturebeat/SZYF",                     type: "rss", tier: 2, authorityLevel: 3 },
  { id: 19, name: "Ars Technica",                 url: "https://feeds.arstechnica.com/arstechnica/index",                   type: "rss", tier: 2, authorityLevel: 3 },
  { id: 20, name: "IEEE Spectrum",                url: "https://spectrum.ieee.org/feeds/feed.rss",                          type: "rss", tier: 2, authorityLevel: 3 },
  { id: 21, name: "Stanford HAI",                 url: "https://hai.stanford.edu/news/rss.xml",                             type: "rss", tier: 1, authorityLevel: 3 },
  { id: 22, name: "OpenAI Blog",                  url: "https://openai.com/blog/rss/",                                      type: "rss", tier: 1, authorityLevel: 3 },
  { id: 23, name: "Korn Ferry Insights",          url: "https://www.kornferry.com/insights/rss",                            type: "rss", tier: 2, authorityLevel: 3 },
  { id: 24, name: "Deloitte Insights",            url: "https://www2.deloitte.com/us/en/insights/rss.html",                 type: "rss", tier: 2, authorityLevel: 3 },
  { id: 25, name: "Forbes Leadership",            url: "https://www.forbes.com/leadership/feed/",                           type: "rss", tier: 2, authorityLevel: 3 },
  { id: 26, name: "McKinsey Quarterly",           url: "https://www.mckinsey.com/quarterly/rss.xml",                        type: "rss", tier: 1, authorityLevel: 3 },
  { id: 27, name: "Foreign Affairs",              url: "https://www.foreignaffairs.com/rss.xml",                            type: "rss", tier: 1, authorityLevel: 3 },
  { id: 28, name: "Foreign Policy",               url: "https://foreignpolicy.com/feed/",                                   type: "rss", tier: 1, authorityLevel: 3 },
  { id: 29, name: "The Atlantic",                 url: "https://www.theatlantic.com/feed/all/",                             type: "rss", tier: 1, authorityLevel: 3 },
  { id: 30, name: "Al Jazeera English",           url: "https://www.aljazeera.com/xml/rss/all.xml",                         type: "rss", tier: 2, authorityLevel: 3 },
  { id: 31, name: "BBC News",                     url: "http://feeds.bbci.co.uk/news/rss.xml",                              type: "rss", tier: 1, authorityLevel: 3 },
  { id: 32, name: "The Guardian",                 url: "https://www.theguardian.com/world/rss",                             type: "rss", tier: 1, authorityLevel: 3 },
  { id: 33, name: "Council on Foreign Relations", url: "https://www.cfr.org/rss.xml",                                       type: "rss", tier: 1, authorityLevel: 3 },
  { id: 34, name: "MarketWatch",                  url: "https://feeds.marketwatch.com/marketwatch/topstories/",             type: "rss", tier: 2, authorityLevel: 3 },
  { id: 35, name: "Barron's",                     url: "https://www.barrons.com/xml/rss/3_7011.xml",                        type: "rss", tier: 2, authorityLevel: 3 },
  { id: 36, name: "Nature",                       url: "https://www.nature.com/nature.rss",                                 type: "rss", tier: 1, authorityLevel: 3 },
  { id: 37, name: "National Geographic",          url: "https://www.nationalgeographic.com/rss/",                           type: "rss", tier: 2, authorityLevel: 3 },
  { id: 38, name: "Stanford Social Innovation Review", url: "https://ssir.org/articles/feed",                               type: "rss", tier: 1, authorityLevel: 3 },
  { id: 39, name: "Brookings Institution",        url: "https://www.brookings.edu/feed/",                                   type: "rss", tier: 1, authorityLevel: 3 },
  { id: 40, name: "Aspen Institute",              url: "https://www.aspeninstitute.org/feed/",                              type: "rss", tier: 2, authorityLevel: 3 },
  { id: 41, name: "Inc. Magazine",                url: "https://www.inc.com/rss",                                           type: "rss", tier: 2, authorityLevel: 3 },
  { id: 42, name: "Quartz",                       url: "https://qz.com/feed",                                               type: "rss", tier: 2, authorityLevel: 3 },
  { id: 43, name: "Strategy+Business",            url: "https://www.strategy-business.com/rss/sb_all_articles.rss",         type: "rss", tier: 2, authorityLevel: 3 },
  { id: 44, name: "Orlando Business Journal",     url: "https://www.bizjournals.com/orlando/stories/rss/",                  type: "rss", tier: 2, authorityLevel: 3 },
  { id: 45, name: "Tampa Bay Times",              url: "https://www.tampabay.com/feed/",                                    type: "rss", tier: 3, authorityLevel: 3 },
] as const;

/**
 * Upserts the full canonical source list on every startup.
 * Only inserts rows that don't already exist (by id) — never overwrites
 * name, url, tier, or weight that the user may have customised in the app.
 */
export async function upsertCanonicalSources(): Promise<void> {
  try {
    const [{ existing }] = await db.select({ existing: count() }).from(sourcesTable);

    if (existing >= CANONICAL_SOURCES.length) {
      logger.info({ existing }, "All canonical sources present — skipping upsert");
      return;
    }

    logger.info({ existing, total: CANONICAL_SOURCES.length }, "Upserting missing canonical sources");

    for (const src of CANONICAL_SOURCES) {
      await db.execute(sql`
        INSERT INTO sources (id, name, url, type, tier, is_active, authority_level, weight)
        VALUES (${src.id}, ${src.name}, ${src.url}, ${src.type}, ${src.tier}, true, ${src.authorityLevel}, 1)
        ON CONFLICT (id) DO NOTHING
      `);
    }

    // Advance the sequence so new sources added via UI don't collide
    await db.execute(sql`SELECT setval('sources_id_seq', (SELECT MAX(id) FROM sources))`);

    const [{ after }] = await db.select({ after: count() }).from(sourcesTable);
    logger.info({ before: existing, after }, "Canonical source upsert complete");
  } catch (err) {
    logger.warn({ err }, "Canonical source upsert failed — continuing startup");
  }
}

/**
 * Seeds production data on the very first run (empty database only).
 *
 * The seed SQL file is generated from the development database with pg_dump
 * and covers: sources (45), articles (727), digest_articles (22), settings (1).
 *
 * This function is a no-op if either sources or articles already exist.
 */
export async function seedProductionData(): Promise<void> {
  try {
    const [{ sourcesCount }] = await db
      .select({ sourcesCount: count() })
      .from(sourcesTable);
    const [{ articlesCount }] = await db
      .select({ articlesCount: count() })
      .from(articlesTable);

    if (sourcesCount > 0 || articlesCount > 0) {
      logger.info(
        { sourcesCount, articlesCount },
        "Production data already exists — skipping seed"
      );
      return;
    }
  } catch (err) {
    logger.warn({ err }, "Could not check table counts — skipping seed");
    return;
  }

  logger.info("Fresh database detected — running production data seed (this may take a moment)");

  // Locate the SQL file next to the compiled binary (copied there by build.mjs)
  let sqlPath: string;
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    sqlPath = resolve(__dirname, "seed-production.sql");
  } catch {
    // Fallback for environments where import.meta.url is not available
    sqlPath = resolve(process.cwd(), "dist", "seed-production.sql");
  }

  let seedSql: string;
  try {
    seedSql = readFileSync(sqlPath, "utf-8");
  } catch (err) {
    logger.error({ err, sqlPath }, "Could not read seed SQL file — skipping seed");
    return;
  }

  // Execute the full dump inside a single transaction using the pg pool directly
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(seedSql);
    await client.query("COMMIT");
    logger.info("Production data seed completed successfully");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    logger.error({ err }, "Production data seed failed — rolled back");
  } finally {
    client.release();
  }
}
