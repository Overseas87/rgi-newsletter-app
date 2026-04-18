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

const RGI_RELEVANCY_PROMPT = `You are a structured scoring AI for the Rick Goings Institute (RGI) at Rollins College. RGI serves senior leaders — CEOs, board members, policymakers, institutional executives. You evaluate articles using a fixed five-component formula that always produces a deterministic, transparent score.

RGI's three core disciplines:
1. Strategic Foresight — AI acceleration, geopolitical volatility, market transitions, weak signals, long-range pattern recognition
2. System Vitality — organizational culture, leadership effectiveness, human energy, trust, institutional health, future of work
3. Civic Stewardship — corporate responsibility, civic institutions, community impact, legitimacy of firms in society, democracy, policy reform

═══════════════════════════════════════════════════════
SCORING FORMULA — five components, summed for final score (0–10 total)
═══════════════════════════════════════════════════════

COMPONENT 1 — STRATEGIC IMPACT (0 to 3)
How consequential is this development for global systems, markets, geopolitics, or major technological change?
  3: Historic or market-moving. Affects global systems, geopolitical stability, or reshapes a major industry. Rare.
  2: Significant. Meaningful shift in a major economy, sector, or policy environment affecting many organizations.
  1: Moderate. Relevant development with limited scope — affects one sector, one country, or is incremental in nature.
  0: Minimal. Routine announcement, local story, or development with no strategic implications.

COMPONENT 2 — RGI RELEVANCE (0 to 2)
How directly does this topic align with RGI's core focus areas: business strategy, finance and markets, AI and technology, geopolitics and global governance, leadership, and systems thinking?
  2: Primary alignment — the article's core subject IS one of RGI's domains.
  1: Partial alignment — the article touches RGI domains but its primary focus is adjacent or tangential.
  0: No alignment — lifestyle, entertainment, consumer, local, or purely technical content with no leadership angle.

COMPONENT 3 — CROSS-DOMAIN INFLUENCE (0 to 2)
Does this development create ripple effects across multiple industries, sectors, or domains? Does it sit at the intersection of several systems?
  2: High cross-domain impact — affects at least three distinct sectors or creates cascading effects (e.g., a geopolitical event that simultaneously affects energy, markets, and supply chains).
  1: Some cross-domain influence — affects two sectors or has clear second-order effects in an adjacent domain.
  0: Single-domain — contained within one industry or sector with no meaningful spillover.

COMPONENT 4 — SOURCE AUTHORITY (0 to 2)
How credible and authoritative is the source of this information?
  2: Primary source — official government statement, direct executive communication, central bank announcement, peer-reviewed research, or Tier-1 outlet (NYT, WSJ, FT, Bloomberg, Reuters, The Economist) with named expert sources.
  1: Credible secondary — reputable Tier-2 publication, named expert author, corroborated reporting, trade publication with strong editorial standards.
  0: Weak sourcing — unnamed sources, speculative analysis, single-source claim, known low-credibility outlet, or unverifiable content.

COMPONENT 5 — RECENCY SIGNAL (0 to 1)
Does the timing of this article matter? Is it reporting on something that is actively unfolding or just concluded?
  1: Active and time-sensitive — the development is currently unfolding, a decision is imminent, or this is breaking news that leaders must act on now.
  0: Not time-sensitive — analysis of past events, background reporting, evergreen content, or developments that concluded more than a week ago.

═══════════════════════════════════════════════════════
SCORING DISCIPLINE
═══════════════════════════════════════════════════════
- A perfect 10 requires: Strategic Impact 3 + RGI Relevance 2 + Cross-Domain 2 + Source Authority 2 + Recency 1. Reserve for historic, system-level events only.
- A score of 7 (e.g., 2+2+1+2+0) is correct for a solid, relevant article from a major outlet.
- Most articles should score between 4 and 7. Scores of 8+ should represent the top ~10% of content.
- Do NOT inflate scores. An article that is merely interesting but not strategically consequential must not exceed 5.

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

TOPIC TAGS — choose only from this exact list (12 topics):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets",
"Technology & AI", "Innovation & Digital Transformation", "Business Strategy & Corporations",
"Leadership & Organizations", "Energy & Resources", "Supply Chains & Global Trade",
"Policy, Regulation & Governance", "Climate & Environmental Systems", "Future of Work & Society"

TAGGING RULES:
1. 1-3 tags maximum — be selective based on PRIMARY content focus, never tag tangentially
2. "Technology & AI" → for AI breakthroughs, AI policy, semiconductor geopolitics, cybersecurity; "Innovation & Digital Transformation" → for digital strategy, fintech, crypto, startups, tech-driven business change
3. "Geopolitics & Global Power" covers wars, sanctions, great-power competition, international relations
4. "Economics & Macroeconomics" covers GDP, inflation, central banks, trade balances; "Finance & Markets" covers equities, bonds, commodities, banking
5. AI regulation → "Technology & AI" + "Policy, Regulation & Governance"; climate policy → "Climate & Environmental Systems" + "Policy, Regulation & Governance"
6. NEVER use "Business Strategy & Corporations" or "Leadership & Organizations" as catch-alls — only when corporate strategy or leadership is the PRIMARY story focus
7. Use the full tag string exactly as listed above — no abbreviations or partial matches

Return ONLY valid JSON with exactly these keys:
- strategicImpact: integer 0-3
- rgiRelevance: integer 0-2
- crossDomainInfluence: integer 0-2
- sourceAuthority: integer 0-2
- recency: integer 0-1
- scoreExplanation: string — one sentence naming the two factors that most drove the score up or down (e.g. "High strategic impact from global market disruption, but single-domain with no cross-sector ripple effects.")
- authenticityScore: number 1-10
- viewpoint: string — RGI 2-sentence position ("RGI [agrees/partially agrees/disagrees]: [reason]. [Forward implication]." — or for scores 0-3 total: "RGI notes this item falls outside the core strategic lens — limited implications for senior leadership.")
- topicTags: string array (1-3 tags from the list below)
- teaserSummary: string — 1-2 sentence factual summary of the article's core claim
- disciplineAlignment: string — one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", "Multiple"
- isPrimarySignal: boolean

No explanation, no markdown, no preamble. ONLY the JSON object.

Article:
Title: {TITLE}
Source: {SOURCE}
Content: {CONTENT}`;

async function scoreArticle(
  headline: string,
  content: string,
  sourceName: string,
  sourceTier: number,
  authorityLevel: number,
  sourceWeight: number = 1.0
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
    max_tokens: 700,
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

    // Clamp each component to its allowed range
    const si  = Math.min(3, Math.max(0, Math.round(parsed.strategicImpact        ?? 1)));
    const rr  = Math.min(2, Math.max(0, Math.round(parsed.rgiRelevance           ?? 1)));
    const cd  = Math.min(2, Math.max(0, Math.round(parsed.crossDomainInfluence   ?? 0)));
    const sa  = Math.min(2, Math.max(0, Math.round(parsed.sourceAuthority        ?? 1)));
    const rec = Math.min(1, Math.max(0, Math.round(parsed.recency                ?? 0)));

    // Apply source weight to the Source Authority component.
    // Weight 1.0 = unchanged; weight 2.0 can boost SA contribution up to 3 (one extra point);
    // weight 0.5 halves the SA contribution. Total is capped at 10.
    const clampedWeight = Math.max(0.5, Math.min(2.0, sourceWeight));
    const weightedSA = Math.min(3, Math.max(0, Math.round(sa * clampedWeight * 10) / 10));
    const computedScore = Math.min(10, Math.max(0, si + rr + cd + weightedSA + rec));

    // Build a concise score breakdown appended to the viewpoint for transparency
    const weightLabel = clampedWeight !== 1.0 ? ` ×${clampedWeight.toFixed(1)} wt` : "";
    const breakdown = `Impact ${si}/3 · Relevance ${rr}/2 · Cross-domain ${cd}/2 · Authority ${sa}/2${weightLabel} · Recency ${rec}/1`;
    const explanation = parsed.scoreExplanation ? `${parsed.scoreExplanation}` : "";
    const rgiViewpoint = parsed.viewpoint ?? "";
    const fullViewpoint = rgiViewpoint
      ? `${rgiViewpoint}\n\n[Score: ${breakdown}${explanation ? ` — ${explanation}` : ""}]`
      : `[Score: ${breakdown}${explanation ? ` — ${explanation}` : ""}]`;

    result = {
      relevancyScore: computedScore,
      authenticityScore: parsed.authenticityScore ?? 5,
      viewpoint: fullViewpoint,
      topicTags: Array.isArray(parsed.topicTags) ? parsed.topicTags : [],
      teaserSummary: parsed.teaserSummary ?? headline.slice(0, 200),
      disciplineAlignment: parsed.disciplineAlignment ?? "Multiple",
      isPrimarySignal: parsed.isPrimarySignal ?? false,
    };

    // Authenticity: apply a small tier floor boost + weight influence (separate from relevancy)
    const authTierBonus = sourceTier === 1 ? 0.5 : sourceTier === 2 ? 0.2 : 0;
    const authWeightBonus = (clampedWeight - 1.0) * 0.5; // weight 2.0 → +0.5, weight 0.5 → -0.25
    result.authenticityScore = Math.min(10, Math.max(1, result.authenticityScore + authTierBonus + authWeightBonus));
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
          source.authorityLevel ?? 3,
          source.weight ?? 1.0
        );

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

    // ── Multi-source story confidence boost ────────────────────────────────────
    // If multiple sources independently cover the same story (same topic tags),
    // the story is validated by corroboration. The top-scored article in each
    // cluster receives +0.4 per extra source, capped at +1.0.
    type ArticleToInsert = {
      headline: string; url: string; sourceName: string; sourceUrl: string;
      author: string | null; authorType: string | null;
      platform: "news" | "twitter" | "linkedin" | "feed";
      isEmergingSignal: boolean; isPrimarySignal: boolean;
      relevancyScore: number; authenticityScore: number;
      viewpoint: string | null; topicTags: string[];
      teaserSummary: string; publishedAt: Date | null | undefined;
      content: string | null | undefined;
      status: "pending"; disciplineAlignment: string;
    };
    const validArticles: ArticleToInsert[] = [];
    for (const r of scoringResults) {
      if (r.status === "fulfilled" && r.value !== null && r.value.relevancyScore >= 4.5) {
        validArticles.push(r.value as ArticleToInsert);
      }
    }

    // Group by leading tag to detect coverage clusters
    const clusterMap = new Map<string, ArticleToInsert[]>();
    for (const article of validArticles) {
      if (!article.topicTags?.length) continue;
      const key = article.topicTags.slice().sort().join("|");
      if (!clusterMap.has(key)) clusterMap.set(key, []);
      clusterMap.get(key)!.push(article);
    }

    // Build a set of URLs that earn a multi-source boost
    const boostMap = new Map<string, number>(); // url → boost delta
    for (const [, cluster] of clusterMap) {
      // Only clusters with 2+ different source URLs qualify
      const uniqueSources = new Set(cluster.map((a) => a.sourceUrl));
      if (uniqueSources.size < 2) continue;

      // Sort by score descending — boost the top article
      cluster.sort((a, b) => b.relevancyScore - a.relevancyScore);
      const boost = Math.min(1.0, (uniqueSources.size - 1) * 0.4);
      boostMap.set(cluster[0].url, boost);
      logger.info(
        { headline: cluster[0].headline, sources: uniqueSources.size, boost },
        "Multi-source story boost applied"
      );
    }

    // Insert new articles — skip low-relevance content (score < 4.5 is noise, not signal)
    for (const article of validArticles) {
      const multiSourceBoost = boostMap.get(article.url) ?? 0;
      const boostedScore = Math.min(10, Math.round((article.relevancyScore + multiSourceBoost) * 10) / 10);

      try {
        await db.insert(articlesTable).values({
          ...article,
          relevancyScore: boostedScore,
          isEmergingSignal: multiSourceBoost > 0 ? true : article.isEmergingSignal,
        });
        articlesAdded++;
      } catch (e) {
        logger.warn({ err: e }, "Failed to insert article (likely duplicate)");
      }
    }

    // Also skip any scored articles that were below threshold (the validArticles filter above handles this)
    for (const result of scoringResults) {
      if (result.status === "fulfilled" && result.value !== null && result.value.relevancyScore < 4.5) {
        logger.debug({ headline: result.value.headline, score: result.value.relevancyScore }, "Skipping low-relevance article");
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
