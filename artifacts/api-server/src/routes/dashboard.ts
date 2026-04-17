import { Router, type IRouter } from "express";
import { db, articlesTable, digestArticlesTable, sourcesTable, settingsTable } from "@workspace/db";
import { eq, gte, sql, desc, count, and } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { getScrapeStatus } from "../lib/scraper";

const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  "Strategic Foresight": [
    "AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics",
    "Global Politics", "Wars & Crisis", "Macroeconomics", "Supply Chains & Trade", "Future of Work",
  ],
  "System Vitality": [
    "Business & Strategy", "Leadership & Organizations", "Finance & Markets",
    "Fintech", "Energy & Oil",
  ],
  "Civic Stewardship": [
    "Policy & Regulation", "Climate & Environmental Health",
  ],
};

function inferDiscipline(tags: string[]): string {
  const scores: Record<string, number> = {
    "Strategic Foresight": 0,
    "System Vitality": 0,
    "Civic Stewardship": 0,
  };

  for (const tag of tags) {
    for (const [discipline, keywords] of Object.entries(DISCIPLINE_KEYWORDS)) {
      if (keywords.includes(tag)) scores[discipline]++;
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "Strategic Foresight";
}

function describeSignificance(topic: string, count: number, avgScore: number): string {
  const level = avgScore >= 8.5 ? "high" : avgScore >= 7 ? "moderate" : "emerging";
  return `${count} source${count !== 1 ? "s" : ""} covering this topic with ${level} strategic relevance`;
}

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Adaptive lookback: today → last 7 days → all-time most recent, so the
  // dashboard is never empty after a restart, redeploy, or gap in scraping.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalArticlesResult, totalRecentResult, pendingReviewResult, approvedTodayResult, rejectedTodayResult] =
    await Promise.all([
      db.select({ count: count() }).from(articlesTable).where(gte(articlesTable.scrapedAt, today)),
      db.select({ count: count() }).from(articlesTable).where(gte(articlesTable.scrapedAt, sevenDaysAgo)),
      db
        .select({ count: count() })
        .from(digestArticlesTable)
        .where(eq(digestArticlesTable.status, "pending_review")),
      db
        .select({ count: count() })
        .from(digestArticlesTable)
        .where(
          and(
            eq(digestArticlesTable.status, "approved"),
            gte(digestArticlesTable.updatedAt, today)
          )
        ),
      db
        .select({ count: count() })
        .from(digestArticlesTable)
        .where(
          and(
            eq(digestArticlesTable.status, "rejected"),
            gte(digestArticlesTable.updatedAt, today)
          )
        ),
    ]);

  const todayCount = totalArticlesResult[0]?.count ?? 0;
  const recentCount = totalRecentResult[0]?.count ?? 0;

  // Tiered content window: prefer today, fall back to 7 days, then all-time.
  // This guarantees the dashboard always shows the best available historical data
  // immediately after a restart or redeploy — never requiring a fresh scrape first.
  const contentWindow = todayCount >= 5 ? today : sevenDaysAgo;

  const [topArticles, allArticlesWindow, sourcesResult, activeSourcesResult] = await Promise.all([
    // Top Stories: articles scoring 7.0+ ranked strictly by relevancyScore descending.
    // authenticityScore is used only as a tiebreaker when two articles share the same relevancy score.
    // No other factor may override rank — higher relevancy score always means higher position.
    db
      .select()
      .from(articlesTable)
      .where(and(
        gte(articlesTable.scrapedAt, contentWindow),
        gte(articlesTable.relevancyScore, 7.0)
      ))
      .orderBy(
        desc(articlesTable.relevancyScore),
        desc(sql`COALESCE(${articlesTable.authenticityScore}, 5.0)`),
        desc(articlesTable.publishedAt)
      )
      .limit(10),
    db
      .select({
        topicTags: articlesTable.topicTags,
        relevancyScore: articlesTable.relevancyScore,
        platform: articlesTable.platform,
        isEmergingSignal: articlesTable.isEmergingSignal,
      })
      .from(articlesTable)
      .where(gte(articlesTable.scrapedAt, contentWindow)),
    db.select({ count: count() }).from(sourcesTable),
    db.select({ count: count() }).from(sourcesTable).where(eq(sourcesTable.isActive, true)),
  ]);

  const allArticlesToday = allArticlesWindow;

  // Build a set of tags that appear in Top Stories for weighted ranking
  const topStoryTagCounts: Record<string, number> = {};
  for (const article of topArticles) {
    for (const tag of article.topicTags) {
      topStoryTagCounts[tag] = (topStoryTagCounts[tag] ?? 0) + 1;
    }
  }

  // Tag counts and scores for trending topics — only count articles scoring >= 6.5
  // to ensure topics reflect genuinely relevant intelligence (not noise)
  const MIN_TOPIC_SCORE = 6.5;
  const tagData: Record<string, { count: number; totalScore: number; hasEmergingSignal: boolean }> = {};
  let socialSignalsCount = 0;
  let emergingSignalsCount = 0;

  for (const article of allArticlesToday) {
    if (article.platform === "twitter" || article.platform === "linkedin") {
      socialSignalsCount++;
    }
    if (article.isEmergingSignal) {
      emergingSignalsCount++;
    }
    // Only count high-relevance articles for topic intelligence
    if (article.relevancyScore < MIN_TOPIC_SCORE) continue;
    for (const tag of article.topicTags) {
      if (!tagData[tag]) tagData[tag] = { count: 0, totalScore: 0, hasEmergingSignal: false };
      tagData[tag].count++;
      tagData[tag].totalScore += article.relevancyScore;
      if (article.isEmergingSignal) tagData[tag].hasEmergingSignal = true;
    }
  }

  const articlesByTag = Object.entries(tagData)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([tag, data]) => ({ tag, count: data.count }));

  // Topic Intelligence: normalized multi-factor ranking designed to produce a realistic
  // spread of scores (roughly 5.0–9.5) so editors can distinguish importance at a glance.
  //
  //   avgRelevance   (60%) — how strong are the underlying articles?
  //   volumeFactor   (25%) — how many high-quality sources cover this topic? (log scale, cap ~10)
  //   topStoryFactor (15%) — does this topic appear in the very top-ranked stories?
  //
  // Topics with fewer than 2 high-relevance articles are filtered out (single-source noise).
  const topicIntelligence = Object.entries(tagData)
    .filter(([, data]) => data.count >= 2)
    .map(([topic, data]) => {
      const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
      const topStoriesAppearances = topStoryTagCounts[topic] ?? 0;

      // Normalize each factor to 0–1 range before combining
      const avgRelevance   = Math.min(avgScore / 10, 1);
      const volumeFactor   = Math.log(data.count + 1) / Math.log(12); // saturates around 11 articles
      const topStoryFactor = Math.min(topStoriesAppearances / 4, 1);  // saturates at 4 top-story hits

      const rawScore =
        avgRelevance   * 0.60 +
        volumeFactor   * 0.25 +
        topStoryFactor * 0.15;

      // Map to a 5.0–9.5 display range so scores feel intentional and differentiated
      const importanceScore = 5.0 + rawScore * 4.5;

      return {
        topic,
        articleCount: data.count,
        importanceScore: Math.round(importanceScore * 10) / 10,
        significance: describeSignificance(topic, data.count, avgScore),
        discipline: inferDiscipline([topic]),
        hasEmergingSignal: data.hasEmergingSignal,
      };
    })
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, 5); // limit to top 5 for a clean, focused panel

  const scrapeStatus = getScrapeStatus();

  res.json({
    totalArticlesToday: totalArticlesResult[0]?.count ?? 0,
    pendingReview: pendingReviewResult[0]?.count ?? 0,
    approvedToday: approvedTodayResult[0]?.count ?? 0,
    rejectedToday: rejectedTodayResult[0]?.count ?? 0,
    topArticles,
    lastScrapeAt: scrapeStatus.lastScrapeAt,
    articlesByTag,
    topicIntelligence,
    totalSources: sourcesResult[0]?.count ?? 0,
    activeSources: activeSourcesResult[0]?.count ?? 0,
    socialSignalsCount,
    emergingSignalsCount,
  });
});

router.get("/dashboard/settings", async (req, res): Promise<void> => {
  let [settings] = await db.select().from(settingsTable).limit(1);

  if (!settings) {
    [settings] = await db
      .insert(settingsTable)
      .values({ relevancyThreshold: 7.0, scrapeIntervalHours: 24, scrapeTimeUtc: "11:00" })
      .returning();
  }

  res.json(settings);
});

router.patch("/dashboard/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  let [existing] = await db.select().from(settingsTable).limit(1);

  if (!existing) {
    const [created] = await db
      .insert(settingsTable)
      .values({ relevancyThreshold: 7.0, scrapeIntervalHours: 24, scrapeTimeUtc: "11:00", ...body.data })
      .returning();
    res.json(created);
    return;
  }

  const updateData: Partial<typeof settingsTable.$inferInsert> = {};
  if (body.data.relevancyThreshold !== undefined) updateData.relevancyThreshold = body.data.relevancyThreshold;
  if (body.data.scrapeIntervalHours !== undefined) updateData.scrapeIntervalHours = body.data.scrapeIntervalHours;
  if (body.data.scrapeTimeUtc !== undefined) updateData.scrapeTimeUtc = body.data.scrapeTimeUtc;

  const [updated] = await db
    .update(settingsTable)
    .set(updateData)
    .where(eq(settingsTable.id, existing.id))
    .returning();

  res.json(updated);
});

export default router;
