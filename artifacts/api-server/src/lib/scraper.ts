import { db, sourcesTable, articlesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { logger } from "./logger";

export interface ScrapedItem {
  headline: string;
  url: string;
  sourceName: string;
  sourceUrl?: string;
  author?: string;
  authorType?: string;
  platform?: "news" | "twitter" | "linkedin";
  content?: string;
  publishedAt?: Date;
  teaserSummary?: string;
}

// Keywords that suggest a breaking/high-signal story
const SIGNAL_KEYWORDS = [
  "announces", "launches", "breaks", "urgent", "exclusive", "first",
  "major", "historic", "unprecedented", "crisis", "breakthrough",
  "collapse", "warning", "alert", "confirmed", "reveals", "admits",
  "resigns", "appointed", "banned", "sanctions", "emergency",
];

function detectEmergingSignal(headline: string, score: number): boolean {
  if (score >= 8.5) return true;
  const lower = headline.toLowerCase();
  return SIGNAL_KEYWORDS.some((kw) => lower.includes(kw)) && score >= 7;
}

const RGI_RELEVANCY_PROMPT = `You are a ruthlessly selective editorial AI for the Rick Goings Institute (RGI) at Rollins College. RGI serves senior leaders — CEOs, board members, policymakers, institutional executives. Your job is to filter for strategic signal and evaluate both relevance AND credibility.

RGI's three core disciplines:
1. Strategic Foresight — AI acceleration, geopolitical volatility, market transitions, weak signals, long-range pattern recognition
2. System Vitality — organizational culture, leadership effectiveness, human energy, trust, institutional health, future of work
3. Civic Stewardship — corporate responsibility, civic institutions, community impact, legitimacy of firms in society, democracy, policy reform

THE GOVERNING QUESTION: Does this article materially affect how leaders, organizations, or systems operate? If the honest answer is NO — score it 1-3.

AUTOMATIC LOW SCORES (1-3) — these content types are ALWAYS low relevance regardless of source:
- Entertainment, celebrity, sports, lifestyle content
- Local school board issues, neighborhood disputes, minor municipal news
- Human-interest stories without systemic implications
- Consumer product reviews, travel guides, food/culture coverage
- Crime reports without systemic/policy significance
- Routine earnings beats with no strategic signal
- Press releases announcing minor hires or product updates with no market significance

SCORING DISTRIBUTION — you must use the full 1-10 range with realistic spread. The expected distribution across any batch of articles is approximately:
- Scores 1-4 (noise/low relevance): ~20% of articles — routine developments with no strategic signal
- Scores 4.5-6.4 (moderate interest): ~45% of articles — solid reporting on relevant topics but incremental in nature
- Scores 6.5-7.9 (notable): ~25% of articles — meaningful developments with real leadership implications, worth reading
- Scores 8.0-8.9 (significant): ~8% of articles — major systemic shifts, important geopolitical/economic developments, primary signals
- Scores 9.0-10.0 (exceptional): ~2% of articles — RARE. Reserve for historic events, major market-moving announcements, extraordinary primary signals from the world's most consequential leaders
If you find yourself assigning 8+ to more than 1 in 8 articles, recalibrate downward. A score of 7.5 on a solid, relevant article is correct.

HIGH SCORES (8-10) REQUIRE ALL of the following:
- Systemic or market-level shifts (not one company's quarterly result)
- Geopolitical developments affecting global business or security
- Major AI, technology, or regulatory developments with broad leadership implications
- Leadership or governance crises/breakthroughs that reshape how institutions operate
- Economic inflection points (rate changes, recession signals, major policy shifts)
- Primary signals from heads of state, Fortune 500 CEOs, central bank governors, major institutional leaders

MULTI-FACTOR RELEVANCY SCORING — evaluate each factor:
1. Strategic Importance (40%): How fundamentally does this reshape leadership, markets, or governance?
2. Impact Scope (25%): Local/individual = low. National = mid. Global/systemic = high.
3. Source Authority (20%): Anonymous/minor outlet = low. Major publication = mid. Direct primary signal = high.
4. Innovation/Disruption Level (15%): Incremental = low. Paradigm-shifting = high.

RECENCY RULE: Do NOT adjust relevancyScore based on publication date. Score purely on strategic merit.

AUTHENTICITY SCORING (1-10) — evaluate separately from relevancy:
Score how credible and trustworthy this source/article is:
- 9-10: Primary source document, official government or institutional statement, direct CEO/executive post, peer-reviewed research, well-established Tier-1 outlet (NYT, WSJ, FT, Reuters, Bloomberg, The Economist) with named expert sources
- 7-8: Reputable Tier-2 publication, named expert author, based on primary source material, corroborated by multiple sources
- 5-6: Standard reporting, single-source claims, opinion piece from credible outlet, trade publication
- 3-4: Unnamed sources, speculative analysis, secondary aggregation without original reporting, partisan outlet
- 1-2: Anonymous blog, unverifiable claim, highly speculative, known low-credibility source, sensationalist content

RGI TAKE — write an evaluative 2-sentence RGI position on this article:
Sentence 1: State whether RGI agrees, partially agrees, or disagrees with the article's central claim — and name the specific reason. Be direct.
Sentence 2: State one concrete forward-looking implication for senior leaders. Use declarative language, not hedging. Max 220 chars total.
Format: "RGI [agrees/partially agrees/disagrees]: [reason]. [Forward implication for leaders]."
If the article is low-relevance (score 1-4), write: "RGI notes this item falls outside the core strategic lens — limited implications for senior leadership."

TOPIC TAGS — choose only from this exact list:
"AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics", "Global Politics",
"Wars & Crisis", "Finance & Markets", "Fintech", "Macroeconomics", "Business & Strategy",
"Leadership & Organizations", "Energy & Oil", "Climate & Environmental Health",
"Supply Chains & Trade", "Policy & Regulation", "Future of Work"

TAGGING RULES:
1. 1-3 tags maximum — be selective based on PRIMARY content focus, never tag tangentially
2. NEVER use "Business & Strategy" or "Leadership & Organizations" as catch-alls — only if the PRIMARY focus is strategy/leadership itself
3. AI regulation articles → "AI & Artificial Intelligence" + "Policy & Regulation" only
4. Economic policy → "Macroeconomics" + "Policy & Regulation"; climate policy → "Climate & Environmental Health" + "Policy & Regulation"
5. Use the full tag string exactly as listed above — no abbreviations or partial matches

Return ONLY valid JSON with keys: relevancyScore, authenticityScore, viewpoint, topicTags, teaserSummary, disciplineAlignment, isPrimarySignal. No explanation.

Article:
Title: {TITLE}
Source: {SOURCE}
Content: {CONTENT}`;

async function scoreArticle(
  headline: string,
  content: string,
  sourceName: string,
  sourceTier: number,
  authorityLevel: number
): Promise<{
  relevancyScore: number;
  authenticityScore: number;
  viewpoint: string;
  topicTags: string[];
  teaserSummary: string;
  disciplineAlignment: string;
  isPrimarySignal: boolean;
}> {
  const prompt = RGI_RELEVANCY_PROMPT
    .replace("{TITLE}", headline)
    .replace("{SOURCE}", sourceName)
    .replace("{CONTENT}", content.slice(0, 2500));

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  let result = {
    relevancyScore: 5,
    authenticityScore: 5,
    viewpoint: "",
    topicTags: [] as string[],
    teaserSummary: headline.slice(0, 200),
    disciplineAlignment: "Multiple",
    isPrimarySignal: false,
  };

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);
    result = { ...result, ...parsed };

    // Small tier + authority nudge — kept conservative so the AI's own distribution guidance drives scores
    const tierBonus = sourceTier === 1 ? 0.2 : sourceTier === 2 ? 0.1 : 0;
    const authorityBonus = (authorityLevel - 3) * 0.1; // authority 1-5, baseline 3; max ±0.2
    result.relevancyScore = Math.min(10, Math.max(1, result.relevancyScore + tierBonus + authorityBonus));
    result.relevancyScore = Math.round(result.relevancyScore * 10) / 10;

    // Apply tier bonus to authenticity (tier 1 sources get +0.5 credibility floor boost)
    const authTierBonus = sourceTier === 1 ? 0.5 : sourceTier === 2 ? 0.2 : 0;
    result.authenticityScore = Math.min(10, Math.max(1, result.authenticityScore + authTierBonus));
    result.authenticityScore = Math.round(result.authenticityScore * 10) / 10;
  } catch (e) {
    logger.warn({ err: e, text }, "Failed to parse AI scoring response");
  }

  return result;
}

async function fetchRssItems(source: {
  url: string;
  name: string;
  authorName?: string | null;
  authorType?: string | null;
}): Promise<ScrapedItem[]> {
  const axios = (await import("axios")).default;
  const cheerio = (await import("cheerio")).load;

  try {
    const response = await axios.get(source.url, {
      timeout: 5000,
      headers: {
        "User-Agent": "RGI-Intelligence-Bot/2.0",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
    });

    const $ = cheerio(response.data, { xmlMode: true });
    const items: ScrapedItem[] = [];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    $("item, entry").each((_, el) => {
      const $el = $(el);

      const headline =
        $el.find("title").first().text().trim() ||
        $el.children("title").first().text().trim();

      const link =
        $el.find("link").first().attr("href") ||
        $el.find("link").first().text().trim() ||
        $el.children("link").first().attr("href") ||
        $el.children("link").first().text().trim();

      const description =
        $el.find("description").first().text().trim() ||
        $el.find("summary").first().text().trim() ||
        $el.find("content\\:encoded, encoded").first().text().trim() ||
        $el.find("content").first().text().trim();

      const pubDateStr =
        $el.find("pubDate").first().text().trim() ||
        $el.find("published").first().text().trim() ||
        $el.find("updated").first().text().trim() ||
        $el.find("dc\\:date, date").first().text().trim();

      // Extract author from multiple possible fields
      const articleAuthor =
        $el.find("author name").first().text().trim() ||
        $el.find("dc\\:creator, creator").first().text().trim() ||
        $el.find("author").first().text().trim() ||
        source.authorName ||
        "";

      if (!headline || !link) return;

      const pubDate = pubDateStr ? new Date(pubDateStr) : undefined;
      // Include articles from last 24 hours, or those without a date (assume recent)
      if (pubDate && !isNaN(pubDate.getTime()) && pubDate.getTime() < cutoff) return;

      // Clean HTML from description
      const cleanDesc = description
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);

      items.push({
        headline,
        url: link,
        sourceName: source.name,
        author: articleAuthor || undefined,
        authorType: source.authorType || undefined,
        platform: "news",
        content: cleanDesc,
        publishedAt: pubDate,
        teaserSummary: cleanDesc?.slice(0, 200),
      });
    });

    return items.slice(0, 5);
  } catch (e) {
    logger.warn({ err: e, url: source.url }, "Failed to fetch RSS feed");
    return [];
  }
}

async function fetchNitterItems(source: {
  url: string;
  name: string;
  authorName?: string | null;
  authorType?: string | null;
}): Promise<ScrapedItem[]> {
  // Twitter sources use Nitter RSS format: handle stored as nitter URL or @handle
  // The URL should be a Nitter RSS URL like https://nitter.net/{handle}/rss
  const items = await fetchRssItems(source);
  return items.map((item) => ({
    ...item,
    platform: "twitter" as const,
    author: source.authorName || item.author,
    authorType: source.authorType || "Social",
  }));
}

let scrapeInProgress = false;
let lastScrapeAt: Date | null = null;
let lastScrapeArticlesFound = 0;

// Per-source cache: tracks last successful fetch time so recently-scraped sources are skipped
const sourceLastFetched = new Map<string, number>(); // source URL → timestamp ms
const SOURCE_CACHE_TTL_MS = 12 * 60 * 1000; // 12 minutes

export function getScrapeStatus() {
  return {
    isRunning: scrapeInProgress,
    lastScrapeAt: lastScrapeAt?.toISOString() ?? null,
    lastScrapeArticlesFound,
  };
}

// Initialize lastScrapeAt from the database on startup so it is never null
// if any data has ever been scraped.
export async function initializeScrapeStatus(): Promise<void> {
  try {
    const [latest] = await db
      .select({ scrapedAt: articlesTable.scrapedAt })
      .from(articlesTable)
      .orderBy(desc(articlesTable.scrapedAt))
      .limit(1);
    if (latest?.scrapedAt) {
      lastScrapeAt = new Date(latest.scrapedAt);
    }
  } catch (err) {
    logger.error({ err }, "Failed to initialize scrape status from DB");
  }
}

export async function runScrape(): Promise<{
  articlesFound: number;
  articlesAdded: number;
}> {
  if (scrapeInProgress) {
    return { articlesFound: 0, articlesAdded: 0 };
  }

  scrapeInProgress = true;
  logger.info("Starting parallel scrape run");

  let articlesFound = 0;
  let articlesAdded = 0;

  try {
    const sources = await db
      .select()
      .from(sourcesTable)
      .where(eq(sourcesTable.isActive, true));

    // PARALLEL: fetch all sources simultaneously
    logger.info({ count: sources.length }, "Fetching sources in parallel");
    const fetchResults = await Promise.allSettled(
      sources.map(async (source) => {
        // Skip recently-cached sources
        const lastFetched = sourceLastFetched.get(source.url);
        if (lastFetched && Date.now() - lastFetched < SOURCE_CACHE_TTL_MS) {
          logger.debug({ source: source.name }, "Source recently fetched — using cache, skipping");
          return { source, items: [] as ScrapedItem[] };
        }

        let items: ScrapedItem[] = [];

        if (source.type === "rss" || source.type === "website") {
          items = await fetchRssItems({
            url: source.url,
            name: source.name,
            authorName: source.authorName,
            authorType: source.authorType,
          });
        } else if (source.type === "twitter") {
          // Twitter via Nitter RSS
          items = await fetchNitterItems({
            url: source.url,
            name: source.name,
            authorName: source.authorName,
            authorType: source.authorType,
          });
        } else if (source.type === "linkedin") {
          // LinkedIn sources — log as needing configuration
          logger.info({ source: source.name }, "LinkedIn source requires API configuration — skipping");
          return { source, items: [] as ScrapedItem[] };
        }

        // Mark this source as freshly fetched
        sourceLastFetched.set(source.url, Date.now());
        return { source, items };
      })
    );

    // Collect all items
    const allItems: Array<{ source: typeof sources[0]; item: ScrapedItem }> = [];
    for (const result of fetchResults) {
      if (result.status === "fulfilled") {
        const { source, items } = result.value;
        for (const item of items) {
          allItems.push({ source, item });
        }
      }
    }

    articlesFound = allItems.length;
    logger.info({ articlesFound }, "All sources fetched — scoring articles");

    // PARALLEL: score all articles simultaneously (Claude Haiku is fast)
    const scoringResults = await Promise.allSettled(
      allItems.map(async ({ source, item }) => {
        // Check if article already exists
        const existing = await db
          .select({ id: articlesTable.id })
          .from(articlesTable)
          .where(eq(articlesTable.url, item.url))
          .limit(1);

        if (existing.length > 0) return null;

        const content = item.content || item.headline;
        const scored = await scoreArticle(
          item.headline,
          content,
          source.name,
          source.tier,
          source.authorityLevel ?? 3
        );

        // Score is set purely by the AI's multi-factor strategic assessment.
        // No programmatic adjustments after scoring — the score must reflect strategic merit only.
        const finalScore = scored.relevancyScore;

        const isSignal = detectEmergingSignal(item.headline, finalScore);

        return {
          headline: item.headline,
          url: item.url,
          sourceName: source.name,
          sourceUrl: source.url,
          author: item.author || null,
          authorType: item.authorType || source.authorType || null,
          platform: item.platform || "news" as const,
          isEmergingSignal: isSignal,
          isPrimarySignal: scored.isPrimarySignal ?? false,
          relevancyScore: finalScore,
          authenticityScore: scored.authenticityScore,
          viewpoint: scored.viewpoint || null,
          topicTags: scored.topicTags,
          teaserSummary: scored.teaserSummary,
          publishedAt: item.publishedAt,
          content: item.content,
          status: "pending" as const,
          disciplineAlignment: scored.disciplineAlignment,
        };
      })
    );

    // Insert new articles — skip low-relevance content (score < 4.5 is noise, not signal)
    for (const result of scoringResults) {
      if (result.status === "fulfilled" && result.value !== null) {
        if (result.value.relevancyScore < 4.5) {
          logger.debug({ headline: result.value.headline, score: result.value.relevancyScore }, "Skipping low-relevance article");
          continue;
        }
        try {
          await db.insert(articlesTable).values(result.value);
          articlesAdded++;
        } catch (e) {
          logger.warn({ err: e }, "Failed to insert article (likely duplicate)");
        }
      }
    }

    lastScrapeAt = new Date();
    lastScrapeArticlesFound = articlesFound;
    logger.info({ articlesFound, articlesAdded }, "Parallel scrape run complete");
  } catch (e) {
    logger.error({ err: e }, "Scrape run failed");
  } finally {
    scrapeInProgress = false;
  }

  return { articlesFound, articlesAdded };
}
