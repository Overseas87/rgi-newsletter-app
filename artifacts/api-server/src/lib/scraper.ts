import { db, sourcesTable, articlesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "./logger";

export interface ScrapedItem {
  headline: string;
  url: string;
  sourceName: string;
  sourceUrl?: string;
  content?: string;
  publishedAt?: Date;
  teaserSummary?: string;
}

const RGI_RELEVANCY_PROMPT = `You are an editorial AI for the Rick Goings Institute (RGI) at Rollins College. RGI equips leaders to build organizations that last, contribute, and stay vital in demanding times.

RGI's three core disciplines:
1. Strategic Foresight — AI acceleration, geopolitical volatility, market transitions, weak signals, pattern recognition
2. System Vitality — organizational culture, leadership, human energy, trust, institutional health
3. Civic Stewardship — corporate responsibility, civic institutions, community impact, legitimacy of firms in society

Analyze the following article and return a JSON object with:
- relevancyScore: number 1-10 (how relevant to RGI's disciplines)
- topicTags: array of strings from: ["AI", "Leadership", "Geopolitics", "Finance", "Environmental Health", "Central Florida", "Strategy", "Culture", "Technology", "Policy", "Education", "Economy", "Innovation", "Governance", "Health"]
- teaserSummary: one sentence teaser (max 150 chars)
- disciplineAlignment: which discipline(s) it aligns with: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple"

Return ONLY valid JSON. No explanation.

Article:
Title: {TITLE}
Content: {CONTENT}`;

async function scoreArticle(
  headline: string,
  content: string,
  sourceTier: number
): Promise<{
  relevancyScore: number;
  topicTags: string[];
  teaserSummary: string;
  disciplineAlignment: string;
}> {
  const prompt = RGI_RELEVANCY_PROMPT.replace("{TITLE}", headline).replace(
    "{CONTENT}",
    content.slice(0, 2000)
  );

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  let result = {
    relevancyScore: 5,
    topicTags: ["General"],
    teaserSummary: headline.slice(0, 150),
    disciplineAlignment: "Multiple",
  };

  try {
    const parsed = JSON.parse(text.trim());
    result = { ...result, ...parsed };

    // Apply source tier bonus
    const tierBonus = sourceTier === 1 ? 0.5 : sourceTier === 2 ? 0.2 : 0;
    result.relevancyScore = Math.min(10, result.relevancyScore + tierBonus);
  } catch (e) {
    logger.warn({ err: e, text }, "Failed to parse AI scoring response");
  }

  return result;
}

async function fetchRssItems(url: string): Promise<ScrapedItem[]> {
  const axios = (await import("axios")).default;
  const cheerio = (await import("cheerio")).load;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: { "User-Agent": "RGI-Digest-Bot/1.0" },
    });

    const $ = cheerio(response.data, { xmlMode: true });
    const items: ScrapedItem[] = [];

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
        $el.find("content").first().text().trim();
      const pubDateStr =
        $el.find("pubDate").first().text().trim() ||
        $el.find("published").first().text().trim() ||
        $el.find("updated").first().text().trim();

      if (headline && link) {
        const pubDate = pubDateStr ? new Date(pubDateStr) : undefined;
        // Only include articles from the last 24 hours
        if (!pubDate || Date.now() - pubDate.getTime() < 24 * 60 * 60 * 1000) {
          items.push({
            headline,
            url: link,
            sourceName: url,
            content: description,
            publishedAt: pubDate,
            teaserSummary: description?.slice(0, 200),
          });
        }
      }
    });

    return items.slice(0, 20);
  } catch (e) {
    logger.warn({ err: e, url }, "Failed to fetch RSS feed");
    return [];
  }
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

export async function runScrape(): Promise<{
  articlesFound: number;
  articlesAdded: number;
}> {
  if (scrapeInProgress) {
    return { articlesFound: 0, articlesAdded: 0 };
  }

  scrapeInProgress = true;
  logger.info("Starting scrape run");

  let articlesFound = 0;
  let articlesAdded = 0;

  try {
    const sources = await db
      .select()
      .from(sourcesTable)
      .where(eq(sourcesTable.isActive, true));

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    for (const source of sources) {
      let items: ScrapedItem[] = [];

      if (source.type === "rss") {
        items = await fetchRssItems(source.url);
      } else {
        logger.info({ sourceType: source.type }, "Skipping non-RSS source for now");
        continue;
      }

      articlesFound += items.length;

      for (const item of items) {
        // Check if article already exists
        const existing = await db
          .select({ id: articlesTable.id })
          .from(articlesTable)
          .where(eq(articlesTable.url, item.url))
          .limit(1);

        if (existing.length > 0) continue;

        try {
          const content = item.content || item.headline;
          const scored = await scoreArticle(item.headline, content, source.tier);

          await db.insert(articlesTable).values({
            headline: item.headline,
            url: item.url,
            sourceName: source.name,
            sourceUrl: source.url,
            relevancyScore: scored.relevancyScore,
            topicTags: scored.topicTags,
            teaserSummary: scored.teaserSummary,
            publishedAt: item.publishedAt,
            content: item.content,
            status: "pending",
            disciplineAlignment: scored.disciplineAlignment,
          });

          articlesAdded++;
        } catch (e) {
          logger.error({ err: e, url: item.url }, "Failed to process article");
        }
      }
    }

    lastScrapeAt = new Date();
    lastScrapeArticlesFound = articlesFound;
    logger.info({ articlesFound, articlesAdded }, "Scrape run complete");
  } catch (e) {
    logger.error({ err: e }, "Scrape run failed");
  } finally {
    scrapeInProgress = false;
  }

  return { articlesFound, articlesAdded };
}
