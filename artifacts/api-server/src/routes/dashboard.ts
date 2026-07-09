import { Router, type IRouter } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { DASHBOARD_SIGNAL_SCORE_THRESHOLD, getScrapeStatus } from "../lib/scraper";
import {
  getFirestoreSettings,
  listFirestoreArticles,
  listFirestoreDigests,
  upsertFirestoreSettings,
} from "../lib/firestore-data";
import { listFirestoreSources } from "../lib/firestore-sources";
import { buildSignalClusters } from "../lib/signal-intelligence";
import { articleRecommendedFor } from "../lib/rgi-relevance";
import { getErrorMessage, sendApiError, withApiTimeout } from "../lib/api-errors";

const DASHBOARD_ARTICLE_SCAN_LIMIT = 120;
const DASHBOARD_DIGEST_SCAN_LIMIT = 120;
const DASHBOARD_SECTION_TIMEOUT_MS = 8000;

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
  req.log.info("Dashboard summary fetch started");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Adaptive lookback: today → last 7 days → all-time most recent, so the
  // dashboard is never empty after a restart, redeploy, or gap in scraping.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  try {
      const [articlesResult, digestArticlesResult, sourcesResult] = await Promise.allSettled([
        withApiTimeout(
          "Dashboard articles Firestore read",
          listFirestoreArticles({ limit: DASHBOARD_ARTICLE_SCAN_LIMIT, sortBy: "time", summaryOnly: true }),
          DASHBOARD_SECTION_TIMEOUT_MS,
        ),
        withApiTimeout(
          "Dashboard digest Firestore read",
          listFirestoreDigests({ limit: DASHBOARD_DIGEST_SCAN_LIMIT }),
          DASHBOARD_SECTION_TIMEOUT_MS,
        ),
        withApiTimeout(
          "Dashboard sources Firestore read",
          listFirestoreSources(),
          DASHBOARD_SECTION_TIMEOUT_MS,
        ),
      ]);

      const sectionErrors: Array<{ section: string; message: string }> = [];
      const articles = articlesResult.status === "fulfilled" ? articlesResult.value : [];
      const digestArticles = digestArticlesResult.status === "fulfilled" ? digestArticlesResult.value : [];
      const sources = sourcesResult.status === "fulfilled" ? sourcesResult.value : [];

      if (articlesResult.status === "rejected") {
        const message = getErrorMessage(articlesResult.reason);
        sectionErrors.push({ section: "topArticles", message });
        req.log.warn({ err: articlesResult.reason }, "Dashboard articles section failed");
      }
      if (digestArticlesResult.status === "rejected") {
        const message = getErrorMessage(digestArticlesResult.reason);
        sectionErrors.push({ section: "reviewCounts", message });
        req.log.warn({ err: digestArticlesResult.reason }, "Dashboard digest section failed");
      }
      if (sourcesResult.status === "rejected") {
        const message = getErrorMessage(sourcesResult.reason);
        sectionErrors.push({ section: "sourceCounts", message });
        req.log.warn({ err: sourcesResult.reason }, "Dashboard sources section failed");
      }

      if (
        articlesResult.status === "rejected" &&
        digestArticlesResult.status === "rejected" &&
        sourcesResult.status === "rejected"
      ) {
        throw articlesResult.reason;
      }

      const todayArticles = articles.filter((a) => articleRecommendedFor(a as typeof a & Record<string, unknown>, "feed"));
      const contentWindow = todayArticles.length >= 15 ? today : sevenDaysAgo;
      const windowArticles = articles.filter((a) =>
        articleRecommendedFor(a as typeof a & Record<string, unknown>, "feed") ||
        (todayArticles.length < 15 && new Date(a.scrapedAt).getTime() >= contentWindow.getTime())
      );
      const topArticlePool = todayArticles.length > 0 ? todayArticles : windowArticles;
      const sortByFreshSignal = (a: typeof articles[number], b: typeof articles[number]) => {
        const ageA = Math.max(0, Date.now() - new Date(a.scrapedAt).getTime());
        const ageB = Math.max(0, Date.now() - new Date(b.scrapedAt).getTime());
        const recencyA = Math.max(0, 1 - ageA / (7 * 24 * 60 * 60 * 1000));
        const recencyB = Math.max(0, 1 - ageB / (7 * 24 * 60 * 60 * 1000));
        const rankA = Number(a.relevancyScore ?? 0) + recencyA * 1.5;
        const rankB = Number(b.relevancyScore ?? 0) + recencyB * 1.5;
        return rankB - rankA || new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime();
      };
      let topArticles = topArticlePool
        .filter((a) => articleRecommendedFor(a as typeof a & Record<string, unknown>, "dashboard") && Number(a.relevancyScore ?? 0) >= DASHBOARD_SIGNAL_SCORE_THRESHOLD)
        .sort(sortByFreshSignal)
        .slice(0, 10);
      if (topArticles.length === 0 && todayArticles.length > 0) {
        topArticles = todayArticles
          .sort(sortByFreshSignal)
          .slice(0, 10);
      }
      const signalClusters = buildSignalClusters(windowArticles, 12);

      const tagData: Record<string, { count: number; totalScore: number; hasEmergingSignal: boolean }> = {};
      let socialSignalsCount = 0;
      let emergingSignalsCount = 0;
      for (const article of windowArticles) {
        if (article.platform === "twitter" || article.platform === "linkedin") socialSignalsCount++;
        if (article.isEmergingSignal) emergingSignalsCount++;
        if (Number(article.relevancyScore ?? 0) < DASHBOARD_SIGNAL_SCORE_THRESHOLD) continue;
        for (const tag of Array.isArray(article.topicTags) ? article.topicTags : []) {
          if (!tagData[tag]) tagData[tag] = { count: 0, totalScore: 0, hasEmergingSignal: false };
          tagData[tag].count++;
          tagData[tag].totalScore += Number(article.relevancyScore ?? 0);
          if (article.isEmergingSignal) tagData[tag].hasEmergingSignal = true;
        }
      }

      const articlesByTag = Object.entries(tagData)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([tag, data]) => ({ tag, count: data.count }));

      const topicIntelligence = Object.entries(tagData)
        .map(([topic, data]) => {
          const avgScore = data.count > 0 ? data.totalScore / data.count : 0;
          const importanceScore = 5 + Math.min(avgScore / 10, 1) * 3 + Math.min(Math.log(data.count + 1) / Math.log(12), 1) * 1.5;
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

      const scrapeStatus = getScrapeStatus();
      req.log.info(
        {
          articleCount: articles.length,
          digestCount: digestArticles.length,
          sourceCount: sources.length,
          sectionErrors,
        },
        sectionErrors.length > 0 ? "Dashboard summary fetch succeeded with degraded sections" : "Dashboard summary fetch succeeded"
      );
      res.json({
        totalArticlesToday: todayArticles.length,
        pendingReview: digestArticles.filter((a) => a.status === "pending_review").length,
        approvedToday: digestArticles.filter((a) => a.status === "approved" && new Date(a.updatedAt).getTime() >= today.getTime()).length,
        rejectedToday: digestArticles.filter((a) => a.status === "rejected" && new Date(a.updatedAt).getTime() >= today.getTime()).length,
        topArticles,
        lastScrapeAt: scrapeStatus.lastScrapeAt,
        articlesByTag,
        topicIntelligence,
        signalClusters,
        totalSources: sources.length,
        activeSources: sources.filter((s) => s.isActive).length,
        socialSignalsCount,
        emergingSignalsCount,
        contentWindowStart: contentWindow.toISOString(),
        minTopicScore: DASHBOARD_SIGNAL_SCORE_THRESHOLD,
        sectionErrors,
        degraded: sectionErrors.length > 0,
      });
      return;
  } catch (e) {
      req.log.error({ err: e }, "Failed to build Firestore dashboard summary");
      sendApiError(res, e, "Dashboard load failed. Retry after the database is available.");
      return;
  }
});
router.get("/topics", async (req, res): Promise<void> => {
  try {
    const articles = await listFirestoreArticles({ limit: 500 });

    const tagData: Record<string, { count: number; totalScore: number; hasEmergingSignal: boolean }> = {};
    for (const article of articles) {
      if ((article.relevancyScore ?? 0) < DASHBOARD_SIGNAL_SCORE_THRESHOLD) continue;
      for (const tag of Array.isArray(article.topicTags) ? article.topicTags : []) {
        if (!tagData[tag]) tagData[tag] = { count: 0, totalScore: 0, hasEmergingSignal: false };
        tagData[tag].count++;
        tagData[tag].totalScore += article.relevancyScore ?? 0;
        if (article.isEmergingSignal) tagData[tag].hasEmergingSignal = true;
      }
    }

    res.json(Object.entries(tagData)
      .map(([topic, data]) => ({
        topic,
        articleCount: data.count,
        avgRelevancyScore: Math.round((data.totalScore / Math.max(1, data.count)) * 10) / 10,
        discipline: inferDiscipline([topic]),
        hasEmergingSignal: data.hasEmergingSignal,
      }))
      .sort((a, b) => b.articleCount - a.articleCount));
  } catch (e) {
    req.log.error({ err: e }, "Failed to list topics");
    sendApiError(res, e, "Topics failed to load. Retry after the database is available.");
  }
});

router.get("/dashboard/settings", async (req, res): Promise<void> => {
  res.json(await getFirestoreSettings());
});

router.patch("/dashboard/settings", async (req, res): Promise<void> => {
  const body = UpdateSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  res.json(await upsertFirestoreSettings(body.data));
});

export default router;
