import { Router, type IRouter } from "express";
import { db, articlesTable } from "@workspace/db";
import { eq, and, gte, desc, asc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
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

  const { status, minScore, topicTag, source, platform, sortBy, limit } = query.data;

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
  if (platform) {
    conditions.push(eq(articlesTable.platform, platform as "news" | "twitter" | "linkedin"));
  }

  if (conditions.length > 0) {
    dbQuery = dbQuery.where(and(...conditions));
  }

  // Apply sort order
  if (sortBy === "time") {
    dbQuery = dbQuery.orderBy(desc(articlesTable.publishedAt), desc(articlesTable.scrapedAt));
  } else if (sortBy === "source") {
    dbQuery = dbQuery.orderBy(asc(articlesTable.sourceName), desc(articlesTable.relevancyScore));
  } else {
    // Default: by relevance
    dbQuery = dbQuery.orderBy(desc(articlesTable.relevancyScore), desc(articlesTable.scrapedAt));
  }

  dbQuery = dbQuery.limit(limit ?? 200);

  let articles = await dbQuery;

  if (topicTag) {
    articles = articles.filter((a) => a.topicTags.includes(topicTag));
  }

  res.json(articles);
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

// RGI relevance explanation — explains WHY this article scored highly through the RGI lens
router.get("/articles/:id/explain", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, id));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const RGI_DISCIPLINES = `
1. Strategic Foresight — anticipating change, reading signals, positioning organizations for futures not yet visible. Covers AI, geopolitics, market transitions, weak signals.
2. System Vitality — organizational energy, resilience, and adaptive capacity. Leadership effectiveness, culture, trust, institutional health, future of work.
3. Civic Stewardship — the responsibility leaders bear to communities and institutions. Corporate citizenship, democratic institutions, civic impact, long-term community wellbeing.`;

  const prompt = `You are the senior editorial analyst for the Rick Goings Institute (RGI) at Rollins College.

RGI's three disciplines:${RGI_DISCIPLINES}

An article has been scored for relevance to RGI's mission. Explain in 4-6 sentences WHY this article matters to RGI and why it received a score of ${article.relevancyScore}/10.

Be specific — reference the actual content of the article, name the relevant discipline(s) explicitly, and explain the strategic significance for the leaders RGI serves. Do NOT be generic.

Article details:
Headline: ${article.headline}
Source: ${article.sourceName}
Score: ${article.relevancyScore}/10
Discipline: ${article.disciplineAlignment}
Topics: ${article.topicTags.join(", ")}
Summary: ${article.teaserSummary || article.content?.slice(0, 500) || "(no summary available)"}

Write the explanation as 4-6 crisp, analytical sentences. No bullet points. No preamble. No "This article..." opener — start with the substantive observation.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const explanation = block.type === "text" ? block.text.trim() : "Unable to generate explanation.";
    res.json({ explanation, discipline: article.disciplineAlignment, score: article.relevancyScore });
  } catch (e) {
    res.status(500).json({ error: "Failed to generate explanation" });
  }
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
