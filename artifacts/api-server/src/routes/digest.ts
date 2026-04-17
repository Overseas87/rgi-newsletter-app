import { Router, type IRouter } from "express";
import { db, digestArticlesTable, articlesTable } from "@workspace/db";
import { eq, inArray, desc, and, gte } from "drizzle-orm";
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
import { generateDigestArticle, generateDailyBrief, refineArticle } from "../lib/ai-writer";
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
        articleType: "topic_article",
        headline: generated.headline,
        body: generated.body,
        executiveSummary: [],
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
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

// Daily brief: auto-selects today's top articles and generates a comprehensive brief
router.post("/digest/daily-brief", async (req, res): Promise<void> => {
  const articleIds: number[] | undefined = Array.isArray(req.body?.articleIds)
    ? req.body.articleIds
    : undefined;
  const editorNotes: string | null = req.body?.editorNotes || null;

  req.log.info({ articleIds, auto: !articleIds, hasNotes: !!editorNotes }, "Generating daily intelligence brief");

  try {
    const generated = await generateDailyBrief(articleIds, editorNotes);

    const [digestArticle] = await db
      .insert(digestArticlesTable)
      .values({
        articleType: "daily_brief",
        headline: generated.headline,
        body: generated.body,
        executiveSummary: generated.executiveSummary,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        topicTags: generated.topicTags,
        sourceArticleIds: generated.sourceArticleIds,
        relevancyScore: generated.relevancyScore,
        discipline: generated.discipline,
        status: "pending_review",
      })
      .returning();

    // Mark source articles as selected
    if (generated.sourceArticleIds.length > 0) {
      await db
        .update(articlesTable)
        .set({ status: "selected" })
        .where(inArray(articlesTable.id, generated.sourceArticleIds));
    }

    const enriched = await enrichDigestArticle(digestArticle);
    res.status(201).json(enriched);
  } catch (e) {
    req.log.error({ err: e }, "Failed to generate daily brief");
    res.status(500).json({ error: String(e instanceof Error ? e.message : "Failed to generate daily brief") });
  }
});

// On-demand generation: editor picks topics, system finds matching articles and synthesizes
router.post("/digest/generate-on-demand", async (req, res): Promise<void> => {
  const topics: string[] = Array.isArray(req.body?.topics) ? req.body.topics : [];
  const editorNotes: string | null = req.body?.editorNotes || null;
  const minScore: number = typeof req.body?.minScore === "number" ? req.body.minScore : 6.0;

  if (topics.length === 0) {
    res.status(400).json({ error: "At least one topic is required" });
    return;
  }

  req.log.info({ topics, editorNotes }, "On-demand brief generation requested");

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch all today's articles above the minimum score
    const candidates = await db
      .select()
      .from(articlesTable)
      .where(
        and(
          gte(articlesTable.scrapedAt, today),
          gte(articlesTable.relevancyScore, minScore)
        )
      )
      .orderBy(desc(articlesTable.relevancyScore))
      .limit(80);

    // Filter to articles matching at least one selected topic
    const matching = candidates.filter((a) =>
      topics.some((t) => a.topicTags.includes(t))
    );

    if (matching.length < 2) {
      // Fallback: take top scoring articles regardless of topic filter
      const fallback = candidates.slice(0, 10);
      if (fallback.length < 2) {
        res.status(422).json({
          error: "Not enough articles found today for the selected topics. Try running a scrape first.",
        });
        return;
      }
      req.log.warn({ topics, found: fallback.length }, "Not enough topic-matched articles, using top articles as fallback");
      const selectedIds = fallback.slice(0, 10).map((a) => a.id);
      const generated = await generateDigestArticle(selectedIds, editorNotes);
      const [digestArticle] = await db
        .insert(digestArticlesTable)
        .values({
          articleType: "topic_article",
          headline: generated.headline,
          body: generated.body,
          executiveSummary: [],
          rgiTake: generated.rgiTake,
          keyTakeaways: generated.keyTakeaways,
          topicTags: generated.topicTags,
          sourceArticleIds: selectedIds,
          relevancyScore: generated.relevancyScore,
          discipline: generated.discipline,
          status: "pending_review",
          editorNotes,
        })
        .returning();
      await db.update(articlesTable).set({ status: "selected" }).where(inArray(articlesTable.id, selectedIds));
      const enriched = await enrichDigestArticle(digestArticle);
      return void res.status(201).json(enriched);
    }

    // Take top 12 topic-matched articles
    const selectedIds = matching.slice(0, 12).map((a) => a.id);

    const topicsNote = `Focus: ${topics.join(", ")}${editorNotes ? `. Editor direction: ${editorNotes}` : ""}`;
    const generated = await generateDigestArticle(selectedIds, topicsNote);

    const [digestArticle] = await db
      .insert(digestArticlesTable)
      .values({
        articleType: "topic_article",
        headline: generated.headline,
        body: generated.body,
        executiveSummary: [],
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        topicTags: generated.topicTags,
        sourceArticleIds: selectedIds,
        relevancyScore: generated.relevancyScore,
        discipline: generated.discipline,
        status: "pending_review",
        editorNotes: topicsNote,
      })
      .returning();

    await db.update(articlesTable).set({ status: "selected" }).where(inArray(articlesTable.id, selectedIds));

    const enriched = await enrichDigestArticle(digestArticle);
    res.status(201).json(enriched);
  } catch (e) {
    req.log.error({ err: e }, "On-demand generation failed");
    res.status(500).json({ error: String(e instanceof Error ? e.message : "Failed to generate brief") });
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

router.post("/digest/:id/refine", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }
  const { instruction } = req.body;
  if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
    res.status(400).json({ error: "Refinement instruction is required" });
    return;
  }
  try {
    const refined = await refineArticle(id, instruction);
    res.json(refined);
  } catch (err) {
    logger.error({ err }, "Article refinement failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Refinement failed" });
  }
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

  try {
    const generated = await generateDigestArticle(
      existing.sourceArticleIds,
      body.data.editorNotes
    );

    const [updated] = await db
      .update(digestArticlesTable)
      .set({
        headline: generated.headline,
        body: generated.body,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        topicTags: generated.topicTags,
        relevancyScore: generated.relevancyScore,
        discipline: generated.discipline,
        status: "pending_review",
        editorNotes: body.data.editorNotes ?? existing.editorNotes,
      })
      .where(eq(digestArticlesTable.id, params.data.id))
      .returning();

    const enriched = await enrichDigestArticle(updated);
    res.json(enriched);
  } catch (err) {
    logger.error({ err }, "Regeneration failed");
    res.status(500).json({ error: "Failed to regenerate article" });
  }
});

export default router;
