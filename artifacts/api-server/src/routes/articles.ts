import { Router, type IRouter } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  getFirestoreArticle,
  deleteFirestoreArticle,
  listFirestoreArticles,
  listFirestoreArticlesPage,
  updateFirestoreArticle,
} from "../lib/firestore-data";
import {
  ListArticlesQueryParams,
  GetArticleParams,
  DeleteArticleParams,
} from "@workspace/api-zod";
import { getErrorMessage, sendApiError, withApiTimeout } from "../lib/api-errors";

const router: IRouter = Router();

type ArticleRecord = NonNullable<Awaited<ReturnType<typeof getFirestoreArticle>>>;

type OptionalArticleScoring = {
  scoreExplanation?: unknown;
};

function compactText(value: unknown, maxLength = 240): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function parseExplanationText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { explanation?: unknown };
    return typeof parsed.explanation === "string" && parsed.explanation.trim()
      ? parsed.explanation.trim()
      : null;
  } catch {
    return trimmed;
  }
}

function extractProviderMessageText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const textBlocks = content
    .map((block) => {
      if (typeof block !== "object" || block === null) return "";
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string"
        ? candidate.text.trim()
        : "";
    })
    .filter(Boolean);
  return textBlocks.join("\n").trim();
}

function fallbackExplanation(article: ArticleRecord): string {
  const topics = Array.isArray(article.topicTags) && article.topicTags.length > 0
    ? article.topicTags.slice(0, 3).join(", ")
    : "strategic leadership";
  const discipline = compactText(article.disciplineAlignment, 80) || "Strategic Foresight";
  const summary = compactText(article.teaserSummary || article.content, 260);
  const source = compactText(article.sourceName, 80) || "the source";
  const score = Number.isFinite(Number(article.relevancyScore))
    ? `${Number(article.relevancyScore).toFixed(1)}/10`
    : "the stored RGI score";
  const scoreExplanation = compactText((article as OptionalArticleScoring).scoreExplanation, 260);

  const summarySentence = summary
    ? `The source summary says: ${summary}`
    : "The stored article metadata does not include a detailed source summary, so editors should verify the causal mechanism before relying on it.";
  const scoreSentence = scoreExplanation
    ? scoreExplanation
    : `The stored RGI score places this item in the ${discipline} lane because it connects ${topics} to executive judgment.`;

  return [
    `${article.headline} matters to RGI because it connects ${topics} to decisions senior leaders may need to make before the full consequence is visible.`,
    summarySentence,
    `${source} gives this signal enough source authority to warrant review, but the key question is not the headline itself; it is which assumptions, timing decisions, or governance responsibilities the story may pressure next.`,
    `${scoreSentence}`,
    `Based on the stored article metadata, this item currently carries a relevance score of ${score} and should be treated as a candidate for editorial judgment rather than a finished conclusion.`,
  ].join(" ");
}

router.get("/articles/page", async (req, res): Promise<void> => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 100);
  const minScore = req.query.minScore == null ? undefined : Number(req.query.minScore);
  const topicTag = typeof req.query.topicTag === "string" ? req.query.topicTag : undefined;
  const source = typeof req.query.source === "string" ? req.query.source : undefined;
  const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "relevance";
  const includeArchive = req.query.includeArchive === "true";

  try {
    req.log.info({ route: "/api/articles/page", filters: { status, minScore, topicTag, source, platform, search, sortBy } }, "Article page fetch started");
    const page = await withApiTimeout("Article page Firestore read", listFirestoreArticlesPage({
      status,
      minScore: Number.isFinite(minScore) ? minScore : undefined,
      topicTag,
      source,
      platform,
      search,
      sortBy,
      limit,
      cursor,
      includeArchive,
    }));
    req.log.info({ route: "/api/articles/page", count: page.items.length, hasMore: page.hasMore, filters: { status, minScore, topicTag, source, platform, search, sortBy } }, "Listed article page");
    res.json(page);
  } catch (e) {
    req.log.error({ err: e }, "Failed to list paginated Firestore articles");
    sendApiError(res, e, "News articles failed to load. Retry after the database is available.");
  }
});

router.get("/articles", async (req, res): Promise<void> => {
  const query = ListArticlesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { status, minScore, topicTag, source, platform, sortBy, limit } = query.data;
  const search = typeof req.query.search === "string" ? req.query.search : undefined;

  try {
    req.log.info({ route: "/api/articles", filters: { status, minScore, topicTag, source, platform, search, sortBy, limit } }, "Article list fetch started");
    const articles = await withApiTimeout("Article list Firestore read", listFirestoreArticles({ status, minScore, topicTag, source, platform, search, sortBy, limit }));
    req.log.info({ route: "/api/articles", count: Array.isArray(articles) ? articles.length : 0 }, "Article list fetch succeeded");
    res.json(Array.isArray(articles) ? articles : []);
  } catch (e) {
    req.log.error({ err: e }, "Failed to list Firestore articles");
    sendApiError(res, e, "News articles failed to load. Retry after the database is available.");
  }
});

router.patch("/articles/:id/moderation", async (req, res): Promise<void> => {
  const params = GetArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const status = String(req.body?.status ?? "").trim();
  if (!["pending", "selected", "dismissed"].includes(status)) {
    res.status(400).json({ error: "status must be pending, selected, or dismissed" });
    return;
  }

  const moderationNote = typeof req.body?.moderationNote === "string"
    ? req.body.moderationNote.slice(0, 500)
    : null;

  try {
    const article = await updateFirestoreArticle(params.data.id, {
      status: status as any,
      moderationNote,
      moderatedAt: new Date(),
      moderatedBy: "local-admin",
    } as any);
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    req.log.info({ articleId: params.data.id, status, moderationNote: Boolean(moderationNote) }, "Article moderation status updated");
    res.json(article);
  } catch (e) {
    req.log.error({ err: e, articleId: params.data.id, status }, "Failed to update article moderation status");
    res.status(500).json({ error: "Failed to update article moderation status" });
  }
});

router.get("/articles/:id", async (req, res): Promise<void> => {
  const params = GetArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const article = await getFirestoreArticle(params.data.id);
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.json(article);
  } catch (e) {
    req.log.error({ err: e }, "Failed to get Firestore article");
    res.status(500).json({ error: "Failed to get article" });
  }
});

// RGI relevance explanation — explains WHY this article scored highly through the RGI lens
router.get("/articles/:id/explain", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }

  const article = await getFirestoreArticle(id);
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
Topics: ${(Array.isArray(article.topicTags) ? article.topicTags : []).join(", ")}
Summary: ${article.teaserSummary || article.content?.slice(0, 500) || "(no summary available)"}

Write the explanation as 4-6 crisp, analytical sentences. No bullet points. No preamble. No "This article..." opener — start with the substantive observation.

Return ONLY valid JSON in this exact shape:
{"explanation":"the explanation text"}`;

  try {
    const message = await withApiTimeout(
      "Article explanation provider call",
      Promise.resolve(
        anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        })
      ),
      12000
    );
    const parsedExplanation = parseExplanationText(extractProviderMessageText(message));
    const explanation = parsedExplanation ?? fallbackExplanation(article);
    res.json({ explanation, discipline: article.disciplineAlignment, score: article.relevancyScore, fallback: !parsedExplanation });
  } catch (e) {
    req.log.warn(
      { err: e, articleId: id, reason: getErrorMessage(e) },
      "Provider-backed article explanation failed; returning stored metadata fallback"
    );
    res.json({
      explanation: fallbackExplanation(article),
      discipline: article.disciplineAlignment,
      score: article.relevancyScore,
      fallback: true,
    });
  }
});

router.delete("/articles/:id", async (req, res): Promise<void> => {
  const params = DeleteArticleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const deleted = await deleteFirestoreArticle(params.data.id);
    if (!deleted) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.sendStatus(204);
  } catch (e) {
    req.log.error({ err: e }, "Failed to delete Firestore article");
    res.status(500).json({ error: "Failed to delete article" });
  }
});

export default router;
