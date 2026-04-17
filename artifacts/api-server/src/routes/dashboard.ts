import { Router, type IRouter } from "express";
import { db, articlesTable, digestArticlesTable, sourcesTable, settingsTable } from "@workspace/db";
import { eq, gte, sql, desc, count, and, ne } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { getScrapeStatus } from "../lib/scraper";

const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  "Strategic Foresight": ["AI", "Technology", "Geopolitics", "Strategy", "Innovation", "Future of Work", "Policy"],
  "System Vitality": ["Leadership", "Culture", "Economy", "Finance", "Health", "Education"],
  "Civic Stewardship": ["Governance", "Democracy", "Sustainability", "Environmental Health", "Central Florida"],
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

  // Adaptive lookback: start with today, expand to 48h if content is sparse
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const [totalArticlesResult, pendingReviewResult, approvedTodayResult, rejectedTodayResult] =
    await Promise.all([
      db.select({ count: count() }).from(articlesTable).where(gte(articlesTable.scrapedAt, today)),
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

  // If today has fewer than 5 articles, expand the window to 48 hours so the
  // dashboard is never empty — editors always see content immediately on load.
  const contentWindow = todayCount >= 5 ? today : fortyEightHoursAgo;

  const [topArticles, topPicks, allArticlesWindow, sourcesResult, activeSourcesResult] = await Promise.all([
    // Top Stories: ranked by composite score — 65% relevancy + 35% authenticity
    // This ensures high-relevance but low-credibility sources don't dominate
    db
      .select()
      .from(articlesTable)
      .where(gte(articlesTable.scrapedAt, contentWindow))
      .orderBy(desc(sql`${articlesTable.relevancyScore} * 0.65 + COALESCE(${articlesTable.authenticityScore}, 5.0) * 0.35`))
      .limit(10),
    // Top Picks: highest-scoring articles in the window NOT yet selected for generation
    db
      .select()
      .from(articlesTable)
      .where(and(
        gte(articlesTable.scrapedAt, contentWindow),
        ne(articlesTable.status, "selected")
      ))
      .orderBy(desc(sql`${articlesTable.relevancyScore} * 0.65 + COALESCE(${articlesTable.authenticityScore}, 5.0) * 0.35`))
      .limit(4),
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

  // Topic Intelligence: ranked by composite score that weights Top Stories membership.
  // A topic that dominates Top Stories must rank above topics with many lower-quality articles.
  //   base      = avgScore * volume_bonus (log scale)
  //   topBoost  = 0.6 per Top Story appearance in this topic (uncapped — important topics float up)
  // Topics with fewer than 2 high-relevance articles are filtered out to avoid single-source noise.
  const topicIntelligence = Object.entries(tagData)
    .filter(([, data]) => data.count >= 2)
    .map(([topic, data]) => {
      const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
      const volumeBonus = 1 + Math.log(data.count + 1) * 0.12;
      const base = avgScore * volumeBonus;
      const topStoriesAppearances = topStoryTagCounts[topic] ?? 0;
      const topBoost = topStoriesAppearances * 0.6;
      const importanceScore = Math.min(10, base + topBoost);
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
    .slice(0, 8);

  const scrapeStatus = getScrapeStatus();

  res.json({
    totalArticlesToday: totalArticlesResult[0]?.count ?? 0,
    pendingReview: pendingReviewResult[0]?.count ?? 0,
    approvedToday: approvedTodayResult[0]?.count ?? 0,
    rejectedToday: rejectedTodayResult[0]?.count ?? 0,
    topArticles,
    topPicks,
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
