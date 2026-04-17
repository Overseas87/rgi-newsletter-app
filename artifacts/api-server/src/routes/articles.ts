import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import {
  ListArticlesQueryParams,
  GetArticleParams,
  DeleteArticleParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/articles", async (req, res): Promise<void> => {
  const query = ListArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, minScore, topicTag, source, limit } = query.data;

  let dbQuery = db.select().from(articlesTable).$dynamic();

  const conditions = [];

  if (status) {
    conditions.push(eq(articlesTable.status, status as "pending" | "selected" | "dismissed"));
  }
  if (minScore) {
    conditions.push(gte(articlesTable.relevancyScore, minScore));
  }
  if (source) {
    conditions.push(eq(articlesTable.sourceName, source));
  }

  if (conditions.length > 0) {
    dbQuery = dbQuery.where(and(...conditions));
  }

  const articles = await dbQuery
    .orderBy(desc(articlesTable.relevancyScore), desc(articlesTable.scrapedAt))
    .limit(limit ?? 50);

  let filtered = articles;
  if (topicTag) {
    filtered = articles.filter((a) => a.topicTags.includes(topicTag));
  }

  res.json(filtered);
});

router.get("/articles/:id", async (req, res): Promise<void> => {
  const params = GetArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(eq(articlesTable.id, params.data.id));

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.json(article);
});

router.delete("/articles/:id", async (req, res): Promise<void> => {
  const params = DeleteArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(articlesTable)
    .where(eq(articlesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
