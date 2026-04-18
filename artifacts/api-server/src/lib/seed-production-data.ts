import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pool } from "@workspace/db";
import { db } from "@workspace/db";
import { sourcesTable, articlesTable } from "@workspace/db/schema";
import { count } from "drizzle-orm";
import { logger } from "./logger";

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
