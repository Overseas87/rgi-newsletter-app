import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sourcesTable, articlesTable, digestArticlesTable as digestTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    // Verify database connectivity with a lightweight query
    await db.execute(sql`SELECT 1`);

    // Fetch record counts to confirm data is loaded — fail-fast if DB is empty on
    // a deployment where data should exist (allows operators to catch accidental resets)
    const [sourceCount] = await db.select({ count: sql<number>`count(*)::int` }).from(sourcesTable);
    const [articleCount] = await db.select({ count: sql<number>`count(*)::int` }).from(articlesTable);
    const [digestCount] = await db.select({ count: sql<number>`count(*)::int` }).from(digestTable);

    res.json({
      status: "ok",
      database: "connected",
      data: {
        sources: sourceCount.count,
        articles: articleCount.count,
        digests: digestCount.count,
      },
    });
  } catch (err) {
    res.status(503).json({
      status: "error",
      database: "unreachable",
      message: err instanceof Error ? err.message : "Database connectivity check failed",
    });
  }
});

export default router;
