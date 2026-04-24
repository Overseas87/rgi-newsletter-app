import { Router, type IRouter } from "express";
import { db, digestArticlesTable, articlesTable, newsletterSubscribersTable } from "@workspace/db";
import { eq, inArray, desc, and, gte, lt } from "drizzle-orm";
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
import { generateDigestArticle, generateDailyBrief, refineArticle, regenerateSelectionText } from "../lib/ai-writer";
import { generateArticlePdf, type ArticleWithSources } from "../lib/pdf-generator";
import { logger } from "../lib/logger";

async function getYesterdayBriefContext(): Promise<string | null> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);

  const rows = await db
    .select()
    .from(digestArticlesTable)
    .where(
      and(
        eq(digestArticlesTable.articleType, "daily_brief"),
        gte(digestArticlesTable.createdAt, yesterdayStart),
        lt(digestArticlesTable.createdAt, todayStart)
      )
    )
    .orderBy(desc(digestArticlesTable.createdAt))
    .limit(1);

  const prev = rows[0];
  if (!prev) return null;

  const keyDevs = prev.body.split("\n").filter(Boolean);
  const lines: string[] = [
    `Headline: ${prev.headline}`,
    `Key Developments:\n${keyDevs.map((d) => `- ${d}`).join("\n")}`,
  ];
  if (prev.keyTakeaways?.length) {
    lines.push(`Why It Matters:\n${prev.keyTakeaways.map((t) => `- ${t}`).join("\n")}`);
  }
  if (prev.rgiTake) lines.push(`RGI Take: ${prev.rgiTake}`);
  return lines.join("\n\n");
}

function pdfToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

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

  const requestedIds = [...body.data.articleIds].sort((a, b) => a - b);
  const idKey = requestedIds.join(",");
  req.log.info({ articleIds: requestedIds }, "Generating digest article");

  try {
    // ── Dedup check (24-hour window, all articles regardless of editor notes) ─
    // Never create a second article from the same source-ID set within 24 hours.
    // Exception: if the existing article was rejected, allow regeneration.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentArticles = await db
      .select()
      .from(digestArticlesTable)
      .where(
        and(
          gte(digestArticlesTable.createdAt, twentyFourHoursAgo),
          eq(digestArticlesTable.articleType, "topic_article")
        )
      )
      .orderBy(desc(digestArticlesTable.createdAt))
      .limit(50);

    const dedupMatch = recentArticles.find(
      (a) =>
        [...a.sourceArticleIds].sort((x, y) => x - y).join(",") === idKey &&
        a.status !== "rejected"
    );

    if (dedupMatch) {
      req.log.info({ id: dedupMatch.id, status: dedupMatch.status }, "Dedup: returning existing article with same source IDs");
      const enriched = await enrichDigestArticle(dedupMatch);
      res.status(200).json({ ...enriched, fromCache: true });
      return;
    }

    // ── Generate (or return in-memory cached) ─────────────────────────────────
    const generated = await generateDigestArticle(
      body.data.articleIds,
      body.data.editorNotes
    );

    // If served from in-memory cache, match to a DB row to avoid a duplicate insert.
    if (generated.fromCache) {
      const cacheMatch = recentArticles.find(
        (a) => [...a.sourceArticleIds].sort((x, y) => x - y).join(",") === idKey
      );
      if (cacheMatch) {
        req.log.info({ id: cacheMatch.id }, "Returning in-memory cached article matched to DB");
        const enriched = await enrichDigestArticle(cacheMatch);
        res.status(200).json({ ...enriched, fromCache: true });
        return;
      }
    }

    const [digestArticle] = await db
      .insert(digestArticlesTable)
      .values({
        articleType: "topic_article",
        headline: generated.headline,
        body: generated.body,
        executiveSummary: generated.executiveSummary,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        whatToWatch: generated.whatToWatch,
        whatMostAreMissing: generated.whatMostAreMissing ?? null,
        mechanism: generated.mechanism ?? [],
        constraintsAndRisks: generated.constraintsAndRisks ?? [],
        implificationsForLeaders: generated.implificationsForLeaders ?? [],
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
    res.status(201).json({ ...enriched, fromCache: generated.fromCache });
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
  const excludedTopics: string[] = Array.isArray(req.body?.excludedTopics)
    ? req.body.excludedTopics.filter((t: unknown) => typeof t === "string")
    : [];
  req.log.info({ articleIds, auto: !articleIds, hasNotes: !!editorNotes, excludedTopics }, "Generating daily intelligence brief");

  try {
    // ── Daily brief dedup: one per UTC day ────────────────────────────────────
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

    const existingToday = await db
      .select()
      .from(digestArticlesTable)
      .where(
        and(
          eq(digestArticlesTable.articleType, "daily_brief"),
          gte(digestArticlesTable.createdAt, todayStart),
          lt(digestArticlesTable.createdAt, todayEnd)
        )
      )
      .orderBy(desc(digestArticlesTable.createdAt))
      .limit(1);

    if (existingToday.length > 0 && existingToday[0].status !== "rejected") {
      req.log.info({ id: existingToday[0].id }, "Dedup: daily brief already exists for today, returning existing");
      const enriched = await enrichDigestArticle(existingToday[0]);
      res.status(200).json({ ...enriched, fromCache: true });
      return;
    }

    const previousBriefContext = await getYesterdayBriefContext();
    const generated = await generateDailyBrief(articleIds, editorNotes, excludedTopics.length > 0 ? excludedTopics : undefined, previousBriefContext);

    const [digestArticle] = await db
      .insert(digestArticlesTable)
      .values({
        articleType: "daily_brief",
        headline: generated.headline,
        body: generated.body,
        executiveSummary: generated.executiveSummary,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        implificationsForLeaders: generated.implificationsForLeaders,
        whatMostAreMissing: generated.whatMostAreMissing ?? null,
        mechanism: generated.mechanism ?? [],
        constraintsAndRisks: generated.constraintsAndRisks ?? [],
        whatChangedSinceYesterday: generated.whatChangedSinceYesterday,
        whatToWatch: generated.whatToWatch,
        summaryTakeaways: generated.summaryTakeaways,
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
          executiveSummary: generated.executiveSummary,
          rgiTake: generated.rgiTake,
          keyTakeaways: generated.keyTakeaways,
          whatToWatch: generated.whatToWatch,
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
        executiveSummary: generated.executiveSummary,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        whatToWatch: generated.whatToWatch,
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

// ── PDF export helpers ─────────────────────────────────────────────────────────
async function fetchArticleWithSources(id: number): Promise<ArticleWithSources | null> {
  const [article] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, id));
  if (!article) return null;

  const srcIds = Array.isArray(article.sourceArticleIds) ? (article.sourceArticleIds as number[]) : [];
  const sourceArticles = srcIds.length > 0
    ? await db.select().from(articlesTable).where(inArray(articlesTable.id, srcIds))
    : [];

  return { ...article, sourceArticles };
}

function slugify(headline: string): string {
  return headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

// GET /api/digest/:id/pdf — download single article as PDF
router.get("/digest/:id/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }

  try {
    const article = await fetchArticleWithSources(id);
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const filename = `rgi-brief-${slugify(article.headline)}.pdf`;

    const doc = generateArticlePdf([article]);
    const buffer = await pdfToBuffer(doc);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
  } catch (err) {
    logger.error({ err }, "PDF generation failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// GET /api/digest/pdf/combined?ids=1,2,3 — download multiple articles as one PDF
router.get("/digest/pdf/combined", async (req, res): Promise<void> => {
  const rawIds = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = rawIds.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    res.status(400).json({ error: "Provide at least one article ID via ?ids=1,2,3" });
    return;
  }
  if (ids.length > 20) {
    res.status(400).json({ error: "Maximum 20 articles per combined PDF" });
    return;
  }

  try {
    const articles = await Promise.all(ids.map(fetchArticleWithSources));
    const valid = articles.filter(Boolean) as ArticleWithSources[];

    if (valid.length === 0) {
      res.status(404).json({ error: "No articles found for the provided IDs" });
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const filename = `rgi-intelligence-${date}.pdf`;

    const doc = generateArticlePdf(valid, { combined: true });
    const buffer = await pdfToBuffer(doc);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-store");
    res.end(buffer);
  } catch (err) {
    logger.error({ err }, "Combined PDF generation failed");
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate combined PDF" });
  }
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
        executiveSummary: generated.executiveSummary,
        rgiTake: generated.rgiTake,
        keyTakeaways: generated.keyTakeaways,
        whatToWatch: generated.whatToWatch,
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

router.post("/digest/:id/send-newsletter", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }

  const [article] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, id));

  if (!article) {
    res.status(404).json({ error: "Digest article not found" });
    return;
  }

  if (article.status !== "approved") {
    res.status(422).json({ error: "Only approved articles can be sent as newsletters" });
    return;
  }

  const subscribers = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.isActive, true));

  if (subscribers.length === 0) {
    res.status(422).json({ error: "No active subscribers found. Add subscribers via the newsletter settings first." });
    return;
  }

  // Format HTML email
  const bulletList = (items: string[]) =>
    items.map((b) => `<li style="margin-bottom:8px;">${b}</li>`).join("");

  const emailHtml = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${article.headline}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #e4e4e7;">
        <!-- Header -->
        <tr><td style="background:#1a365d;padding:28px 40px;">
          <p style="margin:0;color:#93c5fd;font-family:Arial,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;font-weight:700;">The Rick Goings Institute · Strategic Intelligence</p>
          <h1 style="margin:12px 0 0;color:#ffffff;font-size:22px;font-weight:700;line-height:1.3;">${article.headline}</h1>
        </td></tr>
        <!-- Meta -->
        <tr><td style="background:#f8fafc;padding:14px 40px;border-bottom:1px solid #e4e4e7;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#64748b;letter-spacing:1px;text-transform:uppercase;">
            ${article.articleType === "daily_brief" ? "Daily Intelligence Brief" : "Topic Analysis"} &nbsp;·&nbsp; ${article.discipline ?? "Strategic Intelligence"} &nbsp;·&nbsp; ${new Date(article.publishedAt ?? article.updatedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </td></tr>
        <!-- Executive Summary -->
        ${article.executiveSummary && article.executiveSummary.length > 0 ? `
        <tr><td style="padding:32px 40px 0;">
          <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a365d;">Executive Summary</p>
          <ul style="margin:0;padding-left:20px;color:#374151;font-size:15px;line-height:1.7;">${bulletList(article.executiveSummary)}</ul>
        </td></tr>` : ""}
        <!-- Key Developments or Body -->
        ${(() => {
          const isStructured = article.whatToWatch && article.whatToWatch.length > 0;
          const keyDevelopments = isStructured ? article.body.split("\n").filter(Boolean) : null;
          if (isStructured && keyDevelopments && keyDevelopments.length > 0) {
            return `<tr><td style="padding:28px 40px 0;">
              <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#374151;">Key Developments</p>
              <ul style="margin:0;padding-left:20px;color:#374151;font-size:15px;line-height:1.7;">${bulletList(keyDevelopments)}</ul>
            </td></tr>`;
          }
          return `<tr><td style="padding:28px 40px 0;">
            ${article.body.split("\n\n").filter(Boolean).map((p) => `<p style="margin:0 0 18px;color:#1f2937;font-size:16px;line-height:1.75;">${p.replace(/\*\*/g, "").replace(/\*/g, "").trim()}</p>`).join("")}
          </td></tr>`;
        })()}
        <!-- Why It Matters / Key Takeaways -->
        ${article.keyTakeaways && article.keyTakeaways.length > 0 ? `
        <tr><td style="padding:24px 40px 0;">
          <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:20px;">
            <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#92400e;">${article.whatToWatch && article.whatToWatch.length > 0 ? "Why It Matters" : "Key Takeaways"}</p>
            <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.7;">${bulletList(article.keyTakeaways)}</ul>
          </div>
        </td></tr>` : ""}
        <!-- RGI Take -->
        ${article.rgiTake ? `
        <tr><td style="padding:24px 40px 0;">
          <div style="border-left:4px solid #1a365d;padding:16px 20px;background:#eff6ff;margin-top:8px;">
            <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1a365d;">RGI Take</p>
            <p style="margin:0;color:#1e40af;font-size:15px;font-style:italic;line-height:1.7;">${article.rgiTake}</p>
          </div>
        </td></tr>` : ""}
        <!-- What to Watch -->
        ${article.whatToWatch && article.whatToWatch.length > 0 ? `
        <tr><td style="padding:24px 40px 32px;">
          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:20px;">
            <p style="margin:0 0 14px;font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#1e40af;">What to Watch</p>
            <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.7;">${bulletList(article.whatToWatch)}</ul>
          </div>
        </td></tr>` : ""}
        <!-- Footer -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e4e4e7;padding:20px 40px;">
          <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">Rick Goings Institute for Leadership &amp; Global Affairs · Rollins College</p>
          <p style="margin:6px 0 0;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center;">You are receiving this because you subscribed to RGI Strategic Intelligence.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const emailSubject = `RGI Intelligence: ${article.headline}`;
  let sent = false;
  let sendError: string | null = null;

  // Attempt real delivery if SMTP is configured
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser || "noreply@rollins.edu";

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await Promise.all(
        subscribers.map((sub) =>
          transporter.sendMail({
            from: `"Rick Goings Institute" <${smtpFrom}>`,
            to: sub.email,
            subject: emailSubject,
            html: emailHtml,
          })
        )
      );
      sent = true;
    } catch (err) {
      req.log.error({ err }, "SMTP send failed");
      sendError = err instanceof Error ? err.message : "SMTP delivery failed";
    }
  }

  // Record the distribution regardless (preview mode if no SMTP)
  const [updated] = await db
    .update(digestArticlesTable)
    .set({
      newsletterSentAt: new Date(),
      newsletterSentCount: subscribers.length,
    })
    .where(eq(digestArticlesTable.id, id))
    .returning();

  res.json({
    success: true,
    sent,
    emailPreview: !sent,
    subscriberCount: subscribers.length,
    subject: emailSubject,
    htmlPreview: emailHtml,
    article: updated,
    ...(sendError ? { warning: sendError } : {}),
  });
});

router.post("/digest/:id/regenerate-selection", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid article ID" });
    return;
  }

  const { selectedText, field, instructions } = req.body;

  if (!selectedText || typeof selectedText !== "string" || !selectedText.trim()) {
    res.status(400).json({ error: "selectedText is required" });
    return;
  }
  if (!instructions || typeof instructions !== "string" || !instructions.trim()) {
    res.status(400).json({ error: "instructions are required" });
    return;
  }
  if (!["body", "rgiTake"].includes(field)) {
    res.status(400).json({ error: "field must be 'body' or 'rgiTake'" });
    return;
  }

  try {
    const [article] = await db
      .select()
      .from(digestArticlesTable)
      .where(eq(digestArticlesTable.id, id))
      .limit(1);

    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const result = await regenerateSelectionText({
      selectedText,
      field: field as "body" | "rgiTake",
      instructions,
      article: {
        headline: article.headline,
        body: article.body,
        rgiTake: article.rgiTake || "",
      },
    });

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Selection regeneration failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
});

export default router;
