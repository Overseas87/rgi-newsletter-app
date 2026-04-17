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

const RGI_RELEVANCY_PROMPT = `You are a ruthlessly selective editorial AI for the Rick Goings Institute (RGI) at Rollins College. RGI serves senior leaders — CEOs, board members, policymakers, institutional executives. Your job is to filter for strategic signal and discard everything else.

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

HIGH SCORES (8-10) REQUIRE ALL of the following:
- Systemic or market-level shifts (not one company's quarterly result)
- Geopolitical developments affecting global business or security
- Major AI, technology, or regulatory developments with broad leadership implications
- Leadership or governance crises/breakthroughs that reshape how institutions operate
- Economic inflection points (rate changes, recession signals, major policy shifts)
- Primary signals from heads of state, Fortune 500 CEOs, central bank governors, major institutional leaders

MULTI-FACTOR SCORING — evaluate each factor and combine:
1. Strategic Importance (40%): How fundamentally does this reshape leadership, markets, or governance? Minor update = 1-3. Industry-shifting development = 8-10.
2. Impact Scope (25%): Local/individual = low. National = mid. Global/systemic = high.
3. Source Authority (20%): Anonymous/minor outlet = low. Major publication = mid. Direct primary signal from a CEO, head of state, central bank, or major institution = high bonus (+1 to +2 points).
4. Innovation/Disruption Level (15%): Incremental = low. Paradigm-shifting = high.

PRIMARY SIGNAL BONUS: If a high-authority figure (Fortune 500 CEO, head of state, central bank governor, major institution) directly communicates something significant — add up to +2 points on top of the base multi-factor score. Primary signals that arrive before press coverage deserve the highest possible scores.

RECENCY RULE: Do NOT adjust the score based on how recently an article was published. Score every article purely on its strategic merit — importance, impact, authority, and disruption level. Recency is handled separately by the system and must NOT influence your score. An article from 20 hours ago with major strategic importance must receive a higher score than a low-impact article from 20 minutes ago.

Analyze the following article and return a JSON object with these exact fields:
- relevancyScore: number 1-10 — be decisive. Most articles should score 4-6. Fewer than 10% deserve 8+. Articles outside RGI's scope score 1-3.
- topicTags: array of 1-3 SPECIFIC strings chosen ONLY from the permitted list below
- teaserSummary: 1-2 sentence analytical summary (max 220 chars) that highlights STRATEGIC SIGNIFICANCE — never just restate the headline. Ask: what does this mean for leaders and how does it connect to the broader strategic picture?
- disciplineAlignment: the single best-matching discipline: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple" (only if truly 2+ disciplines equally central)
- isPrimarySignal: boolean — true ONLY if this is a DIRECT, ORIGINAL communication (executive's own post, official company announcement, government statement, press release). False for news REPORTING on those events.

TOPIC TAGS — choose only from this list, only where article's PRIMARY focus matches:
- "AI" — artificial intelligence, machine learning, automation, foundation models
- "Technology" — software, hardware, platforms, digital transformation (not AI)
- "Innovation" — R&D, new business models, product breakthroughs
- "Geopolitics" — international relations, trade wars, sanctions, diplomacy, military/security
- "Leadership" — how leaders lead: executive decisions, CEO/board dynamics, leadership development (NOT just about a company doing something)
- "Strategy" — corporate strategy, competitive positioning, M&A, organizational design (NOT a catch-all)
- "Culture" — organizational culture, values, DEI, employee experience, trust
- "Future of Work" — remote/hybrid work, workforce transformation, labor markets
- "Finance" — corporate finance, investment, capital markets, private equity, banking
- "Economy" — macroeconomics, GDP, inflation, recession, central banking, trade
- "Policy" — government regulation, legislation, regulatory change affecting business
- "Governance" — corporate governance, institutional accountability, ESG, board oversight
- "Democracy" — democratic institutions, elections, rule of law, civil society
- "Education" — higher education, workforce training, learning & development
- "Health" — public health, healthcare systems, employee wellbeing
- "Sustainability" — climate commitments, ESG, net zero, carbon markets
- "Environmental Health" — environmental policy, pollution, ecological systems
- "Central Florida" — regional news directly affecting Rollins College or Central Florida business

TAGGING RULES:
1. 1-3 tags maximum — be selective, never tag tangentially
2. NEVER use "Leadership" or "Strategy" as catch-alls — only if the PRIMARY focus is leadership/strategy itself
3. AI regulation → "AI" + "Policy" only; not also "Leadership", "Strategy", "Governance"

Scoring reference:
- 9-10: Major strategic inflection point — reshapes markets, policy, or leadership practice at a systemic level
- 7-8: High relevance — illuminates a critical trend or decision that senior leaders must understand NOW
- 5-6: Useful context — informative background with some strategic value, not urgent
- 3-4: Marginal — peripheral to RGI's focus, minor or local developments
- 1-2: Not relevant — entertainment, lifestyle, local noise, routine updates

Return ONLY valid JSON with keys: relevancyScore, topicTags, teaserSummary, disciplineAlignment, isPrimarySignal. No explanation.

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
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  let result = {
    relevancyScore: 5,
    topicTags: [] as string[],
    teaserSummary: headline.slice(0, 200),
    disciplineAlignment: "Multiple",
    isPrimarySignal: false,
  };

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);
    result = { ...result, ...parsed };

    // Apply tier + authority bonus
    const tierBonus = sourceTier === 1 ? 0.5 : sourceTier === 2 ? 0.2 : 0;
    const authorityBonus = (authorityLevel - 3) * 0.3; // authority 1-5, baseline 3
    result.relevancyScore = Math.min(10, Math.max(1, result.relevancyScore + tierBonus + authorityBonus));
    result.relevancyScore = Math.round(result.relevancyScore * 10) / 10;
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
      timeout: 15000,
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

    return items.slice(0, 25);
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
          return { source, items: [] };
        }

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

        // Apply a small programmatic recency bonus (max +0.2) based on publish time.
        // This ensures recency is a secondary tiebreaker only — never a primary driver.
        // A 9.2 article from 20 hours ago always beats a 5.5 article from 1 minute ago.
        const hoursOld = item.publishedAt
          ? (Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60)
          : 12;
        const recencyBonus = hoursOld <= 12
          ? Math.round(0.2 * (1 - hoursOld / 12) * 10) / 10
          : 0;
        const finalScore = Math.min(10, Math.round((scored.relevancyScore + recencyBonus) * 10) / 10);

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
          topicTags: scored.topicTags,
          teaserSummary: scored.teaserSummary,
          publishedAt: item.publishedAt,
          content: item.content,
          status: "pending" as const,
          disciplineAlignment: scored.disciplineAlignment,
        };
      })
    );

    // Insert new articles
    for (const result of scoringResults) {
      if (result.status === "fulfilled" && result.value !== null) {
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
