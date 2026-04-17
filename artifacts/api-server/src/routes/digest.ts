import { Router, type IRouter } from "express";
import { db, digestArticlesTable, articlesTable } from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";
import {
  ListDigestArticlesQueryParams,
  GenerateDigestArticleBody,
  GetDigestArticleParams,
  UpdateDigestArticleParams,
  UpdateDigestArticleBody,
  DeleteDigestArticleParams,
  ApproveDigestArticleParams,
  RejectDigestArticleParams,
  RejectDigestArticleBody,
  RegenerateDigestArticleParams,
  RegenerateDigestArticleBody,
} from "@workspace/api-zod";
import { generateDigestArticle } from "../lib/ai-writer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function enrichDigestArticle(article: typeof digestArticlesTable.$inferSelect) {
  const sourceArticles =
    article.sourceArticleIds.length > 0
      ? await db
          .select()
          .from(articlesTable)
          .where(inArray(articlesTable.id, article.sourceArticleIds))
      : [];

  return { ...article, sourceArticles };
}

router.get("/digest", async (req, res): Promise<void> => {
  const query = ListDigestArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, limit } = query.data;

  let dbQuery = db.select().from(digestArticlesTable).$dynamic();

  if (status) {
    dbQuery = dbQuery.where(eq(digestArticlesTable.status, status as any));
  }

  const articles = await dbQuery
    .orderBy(desc(digestArticlesTable.createdAt))
    .limit(limit ?? 50);

  const enriched = await Promise.all(articles.map(enrichDigestArticle));
  res.json(enriched);
});

router.post("/digest/generate", async (req, res): Promise<void> => {
  const body = GenerateDigestArticleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  req.log.info({ articleIds: body.data.articleIds }, "Generating digest article");

  try {
    const generated = await generateDigestArticle(
      body.data.articleIds,
      body.data.editorNotes
    );

    const [digestArticle] = await db
      .insert(digestArticlesTable)
      .values({
        headline: generated.headline,
        body: generated.body,
        rgiTake: generated.rgiTake,
        topicTags: generated.topicTags,
        sourceArticleIds: body.data.articleIds,
        relevancyScore: generated.relevancyScore,
        discipline: generated.discipline,
        status: "pending_review",
      })
      .returning();

    // Mark source articles as selected
    await db
      .update(articlesTable)
      .set({ status: "selected" })
      .where(inArray(articlesTable.id, body.data.articleIds));

    const enriched = await enrichDigestArticle(digestArticle);
    res.status(201).json(enriched);
  } catch (e) {
    req.log.error({ err: e }, "Failed to generate digest article");
    res.status(500).json({ error: "Failed to generate article" });
  }
});

router.get("/digest/:id", async (req, res): Promise<void> => {
  const params = GetDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [article] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, params.data.id));

  if (!article) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  const enriched = await enrichDigestArticle(article);
  res.json(enriched);
});

router.patch("/digest/:id", async (req, res): Promise<void> => {
  const params = UpdateDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateDigestArticleBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updateData: Partial<typeof digestArticlesTable.$inferInsert> = {};
  if (body.data.headline !== undefined) updateData.headline = body.data.headline;
  if (body.data.body !== undefined) updateData.body = body.data.body;
  if (body.data.rgiTake !== undefined) updateData.rgiTake = body.data.rgiTake;
  if (body.data.topicTags !== undefined) updateData.topicTags = body.data.topicTags;
  if (body.data.editorNotes !== undefined) updateData.editorNotes = body.data.editorNotes;
  if (body.data.status !== undefined) updateData.status = body.data.status as any;

  const [updated] = await db
    .update(digestArticlesTable)
    .set(updateData)
    .where(eq(digestArticlesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  const enriched = await enrichDigestArticle(updated);
  res.json(enriched);
});

router.delete("/digest/:id", async (req, res): Promise<void> => {
  const params = DeleteDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(digestArticlesTable)
    .where(eq(digestArticlesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/digest/:id/approve", async (req, res): Promise<void> => {
  const params = ApproveDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [updated] = await db
    .update(digestArticlesTable)
    .set({ status: "approved", publishedAt: new Date() })
    .where(eq(digestArticlesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  const enriched = await enrichDigestArticle(updated);
  res.json(enriched);
});

router.post("/digest/:id/reject", async (req, res): Promise<void> => {
  const params = RejectDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = RejectDigestArticleBody.safeParse(req.body || {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [updated] = await db
    .update(digestArticlesTable)
    .set({
      status: "rejected",
      editorNotes: body.data.reason ?? null,
    })
    .where(eq(digestArticlesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  const enriched = await enrichDigestArticle(updated);
  res.json(enriched);
});

router.post("/digest/:id/regenerate", async (req, res): Promise<void> => {
  const params = RegenerateDigestArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = RegenerateDigestArticleBody.safeParse(req.body || {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, params.data.id));

  if (!existing) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  // Set to regenerating
  await db
    .update(digestArticlesTable)
    .set({ status: "regenerating" })
    .where(eq(digestArticlesTable.id, params.data.id));

  // Regenerate in background
  generateDigestArticle(existing.sourceArticleIds, body.data.editorNotes)
    .then(async (generated) => {
      await db
        .update(digestArticlesTable)
        .set({
          headline: generated.headline,
          body: generated.body,
          rgiTake: generated.rgiTake,
          topicTags: generated.topicTags,
          relevancyScore: generated.relevancyScore,
          discipline: generated.discipline,
          status: "pending_review",
          editorNotes: body.data.editorNotes ?? null,
        })
        .where(eq(digestArticlesTable.id, params.data.id));
    })
    .catch((err) => {
      logger.error({ err }, "Regeneration failed");
      db.update(digestArticlesTable)
        .set({ status: "pending_review" })
        .where(eq(digestArticlesTable.id, params.data.id));
    });

  const [updated] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, params.data.id));

  const enriched = await enrichDigestArticle(updated);
  res.json(enriched);
});

export default router;
