import { Router, type IRouter } from "express";
import { db, articlesTable, digestArticlesTable, sourcesTable, settingsTable } from "@workspace/db";
import { eq, gte, sql, desc, count, and } from "drizzle-orm";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { getScrapeStatus } from "../lib/scraper";

const DISCIPLINE_KEYWORDS: Record<string, string[]> = {
  "Strategic Foresight": [
    // Canonical tags (new articles)
    "Technology & AI", "Innovation & Digital Transformation", "Geopolitics & Global Power",
    "Economics & Macroeconomics", "Supply Chains & Global Trade", "Future of Work & Society",
    "Wars, Conflict & Security", "Defense & Military", "Currency & Monetary Policy",
    "Trade & Tariffs", "Cybersecurity", "Robotics & Automation", "Industrial Policy",
    // Legacy / informal tags (existing articles in DB)
    "Geopolitics", "Global Politics", "Wars & Crisis", "Macroeconomics",
    "AI & Artificial Intelligence", "Future of Work", "Supply Chains & Trade",
    "Defense & Security", "Trade", "Technology", "Cybersecurity & Digital Security",
  ],
  "System Vitality": [
    // Canonical tags
    "Business Strategy & Corporations", "Leadership & Organizations",
    "Finance & Markets", "Energy & Resources", "Banking & Credit", "Oil & Gas",
    "Commodities", "Operations & Manufacturing", "Corporate Governance",
    "Venture & Startups", "Labor Markets", "Real Estate",
    // Legacy / informal tags
    "Energy & Oil", "Energy", "Finance", "Banking", "Business Strategy",
    "Leadership", "Organizations", "Manufacturing", "Startups & Venture",
  ],
  "Civic Stewardship": [
    // Canonical tags
    "Policy, Regulation & Governance", "Climate & Environmental Systems",
    "Public Health", "Education", "Agriculture & Food Systems", "Mobility & Infrastructure",
    // Legacy / informal tags
    "Policy & Regulation", "Climate & Environmental Health", "Climate Change",
    "Governance", "Regulation", "Sustainability", "Environmental",
    "Health", "Infrastructure",
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

  const [topCandidates, allArticlesWindow, sourcesResult, activeSourcesResult] = await Promise.all([
    // Top Stories candidates: fetch a larger pool so the diversity algorithm has
    // enough options to fill every topic's proportional slot allocation.
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
      .limit(50),
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

  // ── Topic Domain Diversity ───────────────────────────────────────────────────
  // Goal: ensure each distinct domain of news (Geopolitics, AI, Finance, etc.)
  // gets visible representation in the top 5 stories rather than one dominant
  // domain sweeping all visible slots.
  //
  // Key insight: raw topic tags from the scraper contain many variant spellings
  // of the same domain (e.g. "Geopolitics" and "Geopolitics & Global Power" are
  // the same domain). We first normalize to a canonical set, then round-robin
  // through domains so each gets at least one slot in the visible top 5.
  //
  // Algorithm:
  //   1. Normalize each article's primary tag to a canonical domain bucket.
  //   2. Group the top-scored candidates by domain, preserving score order.
  //   3. Order domains by the score of their best available article (best domain first).
  //   4. Round-robin: pick one article from each domain in turn, cycling until
  //      all 10 return slots are filled.  No single domain can take more than
  //      ceil(10 / numDomains) consecutive slots before other domains get a turn.
  //   5. Remaining slots go to the next highest-scored candidates overall.
  //
  // Result: the top 5 visible slots cover ≥3 different domains by default.
  // ────────────────────────────────────────────────────────────────────────────
  const TOP_STORY_SLOTS = 10;

  // Canonical domain map — variants of the same domain collapse into one bucket.
  const DOMAIN_MAP: Record<string, string> = {
    "Geopolitics & Global Power":          "Geopolitics",
    "Wars, Conflict & Security":           "Geopolitics",
    "Defense & Military":                  "Geopolitics",
    "AI & Artificial Intelligence":        "AI & Technology",
    "Technology & AI":                     "AI & Technology",
    "AI":                                  "AI & Technology",
    "Innovation & Digital Transformation": "AI & Technology",
    "Cybersecurity":                       "AI & Technology",
    "Policy & Regulation":                 "Policy & Governance",
    "Policy, Regulation & Governance":     "Policy & Governance",
    "Governance":                          "Policy & Governance",
    "Macroeconomics":                      "Finance & Economics",
    "Currency & Monetary Policy":          "Finance & Economics",
    "Finance & Markets":                   "Finance & Economics",
    "Energy & Oil":                        "Energy & Resources",
    "Climate & Environmental Systems":     "Climate & Environment",
    "Public Health":                       "Health & Science",
    "Life Sciences":                       "Health & Science",
    "Leadership":                          "Leadership & Strategy",
    "Strategy":                            "Leadership & Strategy",
  };

  const normalizeDomain = (tag: string): string => DOMAIN_MAP[tag] ?? tag;

  // Group candidates by canonical domain (each list is already score-sorted)
  const domainBuckets = new Map<string, typeof topCandidates>();
  for (const article of topCandidates) {
    const domain = normalizeDomain(article.topicTags?.[0] ?? "General");
    if (!domainBuckets.has(domain)) domainBuckets.set(domain, []);
    domainBuckets.get(domain)!.push(article);
  }

  // Order domains by their best article's score (most newsworthy domain first)
  const orderedDomains = [...domainBuckets.entries()]
    .sort((a, b) => (b[1][0]?.relevancyScore ?? 0) - (a[1][0]?.relevancyScore ?? 0));

  // Round-robin pick: one article per domain per pass, until slots filled
  const pickedIds = new Set<number>();
  const topArticles: typeof topCandidates = [];
  const domainPointers = new Map<string, number>(orderedDomains.map(([d]) => [d, 0]));

  let pass = 0;
  while (topArticles.length < TOP_STORY_SLOTS && pass < 10) {
    let addedThisPass = 0;
    for (const [domain, bucket] of orderedDomains) {
      if (topArticles.length >= TOP_STORY_SLOTS) break;
      const ptr = domainPointers.get(domain) ?? 0;
      // Find the next unpicked article in this domain's bucket
      let found = false;
      for (let i = ptr; i < bucket.length; i++) {
        if (!pickedIds.has(bucket[i].id)) {
          topArticles.push(bucket[i]);
          pickedIds.add(bucket[i].id);
          domainPointers.set(domain, i + 1);
          addedThisPass++;
          found = true;
          break;
        }
      }
      if (!found) domainPointers.set(domain, bucket.length); // domain exhausted
    }
    if (addedThisPass === 0) break; // all domains exhausted
    pass++;
  }

  // Fallback: fill any remaining slots from the highest-scored unpicked candidates
  for (const article of topCandidates) {
    if (topArticles.length >= TOP_STORY_SLOTS) break;
    if (!pickedIds.has(article.id)) {
      topArticles.push(article);
      pickedIds.add(article.id);
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Build a set of tags that appear in Top Stories for weighted ranking
  const topStoryTagCounts: Record<string, number> = {};
  for (const article of topArticles) {
    for (const tag of article.topicTags) {
      topStoryTagCounts[tag] = (topStoryTagCounts[tag] ?? 0) + 1;
    }
  }

  // Tag counts and scores for trending topics — only count articles scoring >= 6.5
  // to ensure topics reflect genuinely relevant intelligence (not noise)
  const MIN_TOPIC_SCORE = 7.0;
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
        avgRelevancyScore: Math.round(avgScore * 10) / 10,
        importanceScore: Math.round(importanceScore * 10) / 10,
        significance: describeSignificance(topic, data.count, avgScore),
        discipline: inferDiscipline([topic]),
        hasEmergingSignal: data.hasEmergingSignal,
      };
    })
    .sort((a, b) => b.importanceScore - a.importanceScore);
  // All active topics are returned; consumers decide how many to display

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
    // Expose the time window start so the topic drill-down can apply the same filter,
    // ensuring the article count in the drill-down always matches the topic card count.
    contentWindowStart: contentWindow.toISOString(),
    minTopicScore: MIN_TOPIC_SCORE,
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
