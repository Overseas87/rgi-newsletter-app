import { db, sourcesTable, articlesTable } from "@workspace/db";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { logger } from "./logger";
import {
  createSupabaseArticle,
  getSupabaseArticleByUrl,
  latestSupabaseScrapedAt,
  listSupabaseArticles,
  listActiveSupabaseSources,
  useSupabaseData,
} from "./supabase-data";
import { updateSupabaseSourceHealth } from "./supabase-sources";

// Some feed/parser dependencies assume the browser File API exists. Node provides
// Blob, but older runtimes do not expose File globally, which can break RSS parsing.
if (typeof globalThis.File === "undefined" && typeof globalThis.Blob !== "undefined") {
  class NodeFile extends Blob {
    readonly name: string;
    readonly lastModified: number;

    constructor(parts: ConstructorParameters<typeof Blob>[0], name: string, options: ConstructorParameters<typeof Blob>[1] & { lastModified?: number } = {}) {
      super(parts, options);
      this.name = String(name);
      this.lastModified = Number(options.lastModified ?? Date.now());
    }
  }

  (globalThis as typeof globalThis & { File: typeof File }).File = NodeFile as unknown as typeof File;
}

type ScrapeFailure = {
  source: string;
  url: string;
  message: string;
  code?: string;
  status?: number;
  attempts: number;
};

type ScrapeFeedResult = {
  sourceId: number | string;
  source: string;
  url: string;
  status: "success" | "empty" | "failed";
  articlesCollected: number;
  articlesAccepted: number;
  articlesSaved: number;
  articlesSkipped: number;
  error?: string | null;
  lastScrapeAt: string;
};

type ScrapeSummary = {
  startedAt: string | null;
  finishedAt: string | null;
  totalFeeds: number;
  successfulFeeds: number;
  emptyFeeds: number;
  failedFeeds: number;
  articlesCollected: number;
  articlesAccepted: number;
  articlesSaved: number;
  duplicatesSkipped: number;
  malformedSkipped: number;
  lowScoreSkipped: number;
  feedResults: ScrapeFeedResult[];
};

type ValidScrapedItem = ScrapedItem & {
  headline: string;
  url: string;
  normalizedUrl: string;
  titleFingerprint: string;
  content: string;
};

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

const FALLBACK_TOPIC_RULES: Array<{
  tag: string;
  discipline: "Strategic Foresight" | "System Vitality" | "Civic Stewardship" | "Multiple";
  patterns: RegExp[];
}> = [
  { tag: "Geopolitics & Global Power", discipline: "Strategic Foresight", patterns: [/china|russia|iran|israel|ukraine|nato|sanction|diplomacy|geopolitic|taiwan|gaza|european union/] },
  { tag: "Wars, Conflict & Security", discipline: "Strategic Foresight", patterns: [/war|military|missile|defense|terror|ceasefire|attack|security|army|navy|air force/] },
  { tag: "Technology & AI", discipline: "Strategic Foresight", patterns: [/\bai\b|artificial intelligence|chip|semiconductor|model|openai|anthropic|automation|data center|compute/] },
  { tag: "Cybersecurity", discipline: "Strategic Foresight", patterns: [/cyber|hack|ransomware|data breach|malware|security flaw/] },
  { tag: "Finance & Markets", discipline: "System Vitality", patterns: [/market|stock|bond|yield|ipo|valuation|investor|earnings|shares|equity|wall street/] },
  { tag: "Economics & Macroeconomics", discipline: "Strategic Foresight", patterns: [/inflation|recession|growth|gdp|fed|central bank|rates|employment|tariff|economy/] },
  { tag: "Banking & Credit", discipline: "System Vitality", patterns: [/bank|credit|loan|lending|debt|default|mortgage/] },
  { tag: "Supply Chains & Global Trade", discipline: "Strategic Foresight", patterns: [/supply chain|shipping|logistics|port|trade|export|import|tariff|container/] },
  { tag: "Energy & Resources", discipline: "System Vitality", patterns: [/energy|oil|gas|grid|electricity|power plant|renewable|solar|wind|nuclear/] },
  { tag: "Policy, Regulation & Governance", discipline: "Civic Stewardship", patterns: [/regulat|policy|court|law|lawsuit|government|congress|senate|ministry|rule|ban|election|parliament|prime minister|president|labour|conservative|democrat|republican|campaign|vote|ballot/] },
  { tag: "Business Strategy & Corporations", discipline: "System Vitality", patterns: [/company|ceo|corporate|merger|acquisition|strategy|business|board|startup/] },
  { tag: "Leadership & Organizations", discipline: "System Vitality", patterns: [/leadership|workforce|culture|layoff|talent|employee|management|organization/] },
  { tag: "Climate & Environmental Systems", discipline: "Civic Stewardship", patterns: [/climate|carbon|emissions|flood|wildfire|heat|environment|sustainability/] },
  { tag: "Education", discipline: "Civic Stewardship", patterns: [/school|university|student|education|college|learning/] },
  { tag: "Public Health", discipline: "Civic Stewardship", patterns: [/health|hospital|disease|drug|pharma|medical|pandemic/] },
];

function detectEmergingSignal(headline: string, score: number): boolean {
  if (score >= 8.5) return true;
  const lower = headline.toLowerCase();
  return SIGNAL_KEYWORDS.some((kw) => lower.includes(kw)) && score >= 7;
}

function fallbackTopicAnalysis(headline: string, content: string, sourceName: string): {
  topicTags: string[];
  disciplineAlignment: "Strategic Foresight" | "System Vitality" | "Civic Stewardship" | "Multiple";
  teaserSummary: string;
  scoreBoost: number;
} {
  const haystack = `${headline} ${content} ${sourceName}`.toLowerCase();
  const matches = FALLBACK_TOPIC_RULES
    .map((rule) => ({
      ...rule,
      hits: rule.patterns.reduce((sum, pattern) => sum + (pattern.test(haystack) ? 1 : 0), 0),
    }))
    .filter((rule) => rule.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const topicTags = matches.length
    ? matches.slice(0, 3).map((rule) => rule.tag)
    : ["Policy, Regulation & Governance"];
  const disciplineAlignment = matches[0]?.discipline ?? "Strategic Foresight";
  const signalDensity = Math.min(1.5, matches.reduce((sum, rule) => sum + rule.hits, 0) * 0.25);
  const clean = cleanText(content || headline, 260);
  return {
    topicTags,
    disciplineAlignment,
    teaserSummary: clean || headline,
    scoreBoost: signalDensity,
  };
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

TOPIC TAGS — choose only from this exact canonical list (31 topics):

GEOPOLITICS & POWER: "Geopolitics & Global Power", "Wars, Conflict & Security", "Defense & Military"
POLICY & GOVERNANCE: "Policy, Regulation & Governance", "Industrial Policy"
ECONOMICS: "Economics & Macroeconomics", "Currency & Monetary Policy", "Trade & Tariffs"
FINANCE: "Finance & Markets", "Banking & Credit"
BUSINESS: "Business Strategy & Corporations", "Leadership & Organizations", "Corporate Governance", "Operations & Manufacturing", "Venture & Startups"
SUPPLY CHAIN: "Supply Chains & Global Trade"
ENERGY & RESOURCES: "Energy & Resources", "Oil & Gas", "Commodities"
CLIMATE: "Climate & Environmental Systems"
TECHNOLOGY: "Technology & AI", "Cybersecurity", "Innovation & Digital Transformation", "Robotics & Automation"
SOCIETY: "Future of Work & Society", "Labor Markets", "Public Health", "Education", "Real Estate", "Agriculture & Food Systems", "Mobility & Infrastructure"

TAGGING RULES — be precise, never tag tangentially:
1. 1-3 tags maximum, chosen by PRIMARY content focus only
2. "Geopolitics & Global Power" → great-power competition, sanctions, diplomatic relations; "Wars, Conflict & Security" → active armed conflicts, military operations, terrorism; "Defense & Military" → defense budgets, weapons systems, military strategy
3. "Technology & AI" → AI breakthroughs, AI policy, semiconductors, LLMs; "Cybersecurity" → attacks, data breaches, digital warfare, security standards; "Robotics & Automation" → physical automation, manufacturing robots, autonomous systems; "Innovation & Digital Transformation" → digital strategy, fintech, crypto, startups, tech-driven business change
4. "Economics & Macroeconomics" → GDP, inflation, central bank policy, trade balances; "Finance & Markets" → equities, bonds, asset prices, investment flows; "Banking & Credit" → banks, lending, credit conditions, financial stability; "Currency & Monetary Policy" → exchange rates, Fed policy, dollar system, interest rates; "Trade & Tariffs" → tariffs, trade agreements, import/export policy
5. "Energy & Resources" → energy markets and transition broadly; "Oil & Gas" → petroleum specifically; "Commodities" → metals, grains, raw materials pricing
6. "Supply Chains & Global Trade" → logistics networks, sourcing strategy, trade flows; distinct from "Trade & Tariffs" (policy)
7. "Business Strategy & Corporations" → only when corporate strategy IS the primary story; "Leadership & Organizations" → only when leadership effectiveness or organizational culture is primary; "Corporate Governance" → board decisions, executive accountability, shareholder activism; "Operations & Manufacturing" → factory operations, industrial production; "Industrial Policy" → government-driven industrial programs (chips act, subsidies)
8. "Venture & Startups" → VC funding, startup ecosystem, entrepreneurship; "Labor Markets" → employment data, wages, workforce trends
9. "Future of Work & Society" → broad workforce transformation, automation impact on jobs; "Public Health" → disease, healthcare systems, pharmaceutical policy; "Education" → universities, skills training, learning systems; "Real Estate" → property markets, housing policy, commercial real estate; "Agriculture & Food Systems" → farming, food supply, agricultural policy; "Mobility & Infrastructure" → transportation, logistics infrastructure, urban mobility
10. Use the EXACT tag string — no abbreviations, no partial matches, no invented tags

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

  let text = "{}";
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    text = block.type === "text" ? block.text : "{}";
  } catch (e) {
    logger.warn({ error: summarizeHttpError(e) }, "AI scoring unavailable; using fallback article scoring");
    const tierBoost = sourceTier === 1 ? 1.5 : sourceTier === 2 ? 0.75 : 0;
    const authorityBoost = Math.max(0, Math.min(2, authorityLevel / 5));
    const keywordBoost = SIGNAL_KEYWORDS.some((kw) => headline.toLowerCase().includes(kw)) ? 1 : 0;
    const fallback = fallbackTopicAnalysis(headline, content, sourceName);
    const fallbackScore = Math.min(8.8, Math.max(4.5, 4.5 + tierBoost + authorityBoost + keywordBoost + fallback.scoreBoost));
    return {
      relevancyScore: Math.round(fallbackScore * 10) / 10,
      authenticityScore: Math.min(10, Math.max(1, authorityLevel || 5)),
      viewpoint: `RGI notes this item carries ${fallback.topicTags[0].toLowerCase()} significance based on deterministic source and content scoring. Editors should verify the causal mechanism before publication.`,
      topicTags: fallback.topicTags,
      teaserSummary: fallback.teaserSummary,
      disciplineAlignment: fallback.disciplineAlignment,
      isPrimarySignal: fallbackScore >= 7.5,
    };
  }

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
  let responseData: unknown;
  let lastError: unknown;
  let fetchedUrl = source.url;

  try {
    const axios = (await import("axios")).default;
    const cheerio = (await import("cheerio")).load;

    const candidates = feedCandidateUrls(source.url);
    for (const candidateUrl of candidates) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const response = await axios.get(candidateUrl, {
            timeout: attempt === 1 ? 5000 : 9000,
            maxRedirects: 5,
            headers: {
              "User-Agent": "Mozilla/5.0 (compatible; RGI-Intelligence-Bot/2.0; +https://rgi.rollins.edu)",
              "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
            },
            validateStatus: (status: number) => status >= 200 && status < 400,
          });
          responseData = response.data;
          fetchedUrl = candidateUrl;
          if (attempt > 1 || candidateUrl !== source.url) {
            logger.info({ source: source.name, configuredUrl: source.url, fetchedUrl, attempt }, "RSS feed recovered via retry or alternate endpoint");
          }
          break;
        } catch (e) {
          lastError = e;
          const summary = summarizeHttpError(e);
          logger.warn({ source: source.name, url: candidateUrl, attempt, ...summary }, "RSS feed fetch attempt failed");
          if (attempt < 2) await sleep(retryDelayMs(attempt));
        }
      }
      if (responseData !== undefined) break;
    }

    if (responseData === undefined) {
      const summary = summarizeHttpError(lastError);
      lastScrapeFailures.push({ source: source.name, url: source.url, attempts: candidates.length * 2, ...summary });
      logger.warn({ source: source.name, url: source.url, ...summary }, "RSS feed skipped after retries");
      return [];
    }

    const $ = cheerio(String(responseData), { xmlMode: true });
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

      const cleanDesc = cleanText(description, 3000);

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

    if (items.length === 0) {
      const html = cheerio(String(responseData));
      const seen = new Set<string>();
      html("article a[href], main a[href], a[href]").each((_, el) => {
        const $el = html(el);
        const href = $el.attr("href");
        const headline = cleanText($el.text() || $el.attr("title") || "", 220);
        if (!href || headline.length < 18) return;
        const absolute = resolveUrl(href, fetchedUrl);
        if (!absolute || seen.has(absolute)) return;
        if (!isLikelyArticleUrl(absolute, headline)) return;
        seen.add(absolute);
        items.push({
          headline,
          url: absolute,
          sourceName: source.name,
          author: source.authorName || undefined,
          authorType: source.authorType || undefined,
          platform: "news",
          content: headline,
          teaserSummary: headline,
        });
      });
    }

    return items.slice(0, 12);
  } catch (e) {
    const summary = summarizeHttpError(e);
    lastScrapeFailures.push({ source: source.name, url: source.url, attempts: 3, ...summary });
    logger.warn({ source: source.name, url: source.url, ...summary }, "Failed to parse RSS feed");
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
let lastScrapeFailures: ScrapeFailure[] = [];
let lastScrapeSummary: ScrapeSummary = {
  startedAt: null,
  finishedAt: null,
  totalFeeds: 0,
  successfulFeeds: 0,
  emptyFeeds: 0,
  failedFeeds: 0,
  articlesCollected: 0,
  articlesAccepted: 0,
  articlesSaved: 0,
  duplicatesSkipped: 0,
  malformedSkipped: 0,
  lowScoreSkipped: 0,
  feedResults: [],
};
const sourceFailureCounts = new Map<string, number>();

// Per-source cache: tracks last successful fetch time so recently-scraped sources are skipped
const sourceLastFetched = new Map<string, number>(); // source URL → timestamp ms
const SOURCE_CACHE_TTL_MS = 12 * 60 * 1000; // 12 minutes

export function getScrapeStatus() {
  return {
    isRunning: scrapeInProgress,
    lastScrapeAt: lastScrapeAt?.toISOString() ?? null,
    lastScrapeArticlesFound,
    lastScrapeFailures,
    lastScrapeSummary,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number): number {
  const base = 600 * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(5000, base + jitter);
}

function feedCandidateUrls(rawUrl: string): string[] {
  const candidates = new Set<string>([rawUrl]);
  try {
    const parsed = new URL(rawUrl);
    const origin = parsed.origin;
    if (/openai\.com$/i.test(parsed.hostname)) candidates.add(`${origin}/news/rss.xml`);
    candidates.add(`${origin}/feed/`);
    candidates.add(`${origin}/rss.xml`);
    candidates.add(`${origin}/rss`);
    candidates.add(`${origin}/atom.xml`);
  } catch {
    // Keep original only.
  }
  return [...candidates].slice(0, 5);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await mapper(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));

  return results;
}

function summarizeHttpError(err: unknown): { message: string; code?: string; status?: number } {
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    const response = record.response as Record<string, unknown> | undefined;
    return {
      message: err instanceof Error ? err.message : "Feed request failed",
      code: typeof record.code === "string" ? record.code : undefined,
      status: typeof response?.status === "number" ? response.status : undefined,
    };
  }
  return { message: String(err || "Feed request failed") };
}

function normalizeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|cmpid$|cid$)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\?$/, "");
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

function titleFingerprint(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|to|of|and|or|in|on|for|with|at|by|from|as|is|are|be)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const left = new Set(a.split(" ").filter((word) => word.length > 2));
  const right = new Set(b.split(" ").filter((word) => word.length > 2));
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((word) => right.has(word)).length;
  return (2 * intersection) / (left.size + right.size);
}

function cleanText(value: unknown, max = 3000): string {
  return String(value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function resolveUrl(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

function isLikelyArticleUrl(url: string, headline: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip)$/i.test(url)) return false;
  if (/\/(tag|category|author|about|contact|privacy|terms|subscribe|newsletter|login|account)(\/|$)/i.test(url)) return false;
  if (headline.split(/\s+/).length < 4) return false;
  return /\/20\d{2}\/|\/news\/|\/article\/|\/story\/|\/world\/|\/business\/|\/technology\/|\/markets\/|\/politics\/|\/economy\/|\/[a-z0-9-]{24,}/i.test(url);
}

function validateScrapedItem(item: ScrapedItem): { ok: true; item: ValidScrapedItem } | { ok: false; reason: string } {
  const headline = cleanText(item.headline, 240);
  const url = String(item.url ?? "").trim();
  const normalized = normalizeUrl(url);
  const content = cleanText(item.content || item.teaserSummary || headline, 3000);

  if (headline.length < 12) return { ok: false, reason: "headline_too_short" };
  if (!normalized || !/^https?:\/\//i.test(normalized)) return { ok: false, reason: "invalid_url" };
  if (content.length < 20) return { ok: false, reason: "content_too_short" };

  return {
    ok: true,
    item: {
      ...item,
      headline,
      url,
      normalizedUrl: normalized,
      titleFingerprint: titleFingerprint(headline),
      content,
      teaserSummary: cleanText(item.teaserSummary || content, 260),
    },
  };
}

function isTitleDuplicate(fingerprint: string, existingFingerprints: Set<string>): boolean {
  if (!fingerprint) return false;
  if (existingFingerprints.has(fingerprint)) return true;
  for (const existing of existingFingerprints) {
    if (titleSimilarity(fingerprint, existing) >= 0.86) return true;
  }
  return false;
}

// Initialize lastScrapeAt from the database on startup so it is never null
// if any data has ever been scraped.
export async function initializeScrapeStatus(): Promise<void> {
  try {
    if (useSupabaseData()) {
      const latest = await latestSupabaseScrapedAt();
      if (latest) lastScrapeAt = latest;
      return;
    }

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
  summary?: ScrapeSummary;
}> {
  if (scrapeInProgress) {
    return { articlesFound: 0, articlesAdded: 0 };
  }

  scrapeInProgress = true;
  logger.info("Starting parallel scrape run");

  let articlesFound = 0;
  let articlesAdded = 0;
  let malformedSkipped = 0;
  let duplicatesSkipped = 0;
  let lowScoreSkipped = 0;
  const startedAt = new Date();
  lastScrapeFailures = [];
  lastScrapeSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    totalFeeds: 0,
    successfulFeeds: 0,
    emptyFeeds: 0,
    failedFeeds: 0,
    articlesCollected: 0,
    articlesAccepted: 0,
    articlesSaved: 0,
    duplicatesSkipped: 0,
    malformedSkipped: 0,
    lowScoreSkipped: 0,
    feedResults: [],
  };

  try {
    const sources = useSupabaseData()
      ? await listActiveSupabaseSources()
      : await db
          .select()
          .from(sourcesTable)
          .where(eq(sourcesTable.isActive, true));

    lastScrapeSummary.totalFeeds = sources.length;

    const existingArticles = useSupabaseData() ? await listSupabaseArticles({ limit: 1000 }) : [];
    const existingUrls = new Set(existingArticles.map((article) => normalizeUrl(article.url)).filter(Boolean));
    const existingTitles = new Set(existingArticles.map((article) => titleFingerprint(article.headline)).filter(Boolean));
    const batchUrls = new Set<string>();
    const batchTitles = new Set<string>();

    // Bounded concurrency keeps scraping from starving UI/API requests during slow feed runs.
    logger.info({ count: sources.length, concurrency: 6 }, "Fetching sources with bounded concurrency");
    const fetchResults = await mapWithConcurrency(
      sources,
      6,
      async (source) => {
        try {
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
            logger.info({ source: source.name }, "LinkedIn source requires API configuration — skipping");
            return { source, items: [] as ScrapedItem[] };
          }

          if (items.length > 0) sourceLastFetched.set(source.url, Date.now());
          return { source, items };
        } catch (e) {
          const summary = summarizeHttpError(e);
          lastScrapeFailures.push({ source: source.name, url: source.url, attempts: 1, ...summary });
          logger.warn({ source: source.name, url: source.url, ...summary }, "Source scrape failed unexpectedly");
          return { source, items: [] as ScrapedItem[] };
        }
      }
    );

    // Collect all items
    const allItems: Array<{ source: typeof sources[0]; item: ValidScrapedItem }> = [];
    for (const result of fetchResults) {
      if (result.status === "fulfilled") {
        const { source, items } = result.value;
        const sourceStartedFailures = lastScrapeFailures.filter((failure) => failure.url === source.url);
        let accepted = 0;
        let skipped = 0;

        for (const item of items) {
          const validated = validateScrapedItem(item);
          if (!validated.ok) {
            malformedSkipped++;
            skipped++;
            logger.warn({ source: source.name, url: item.url, reason: validated.reason }, "Skipping malformed scraped item");
            continue;
          }

          const normalized = validated.item.normalizedUrl;
          const fingerprint = validated.item.titleFingerprint;
          if (
            existingUrls.has(normalized) ||
            batchUrls.has(normalized) ||
            isTitleDuplicate(fingerprint, existingTitles) ||
            isTitleDuplicate(fingerprint, batchTitles)
          ) {
            duplicatesSkipped++;
            skipped++;
            logger.debug({ source: source.name, headline: validated.item.headline, url: normalized }, "Skipping duplicate scraped item");
            continue;
          }

          batchUrls.add(normalized);
          batchTitles.add(fingerprint);
          allItems.push({ source, item: validated.item });
          accepted++;
        }

        const hasFailure = sourceStartedFailures.length > 0;
        const status: ScrapeFeedResult["status"] = hasFailure && items.length === 0 ? "failed" : accepted > 0 ? "success" : "empty";
        const lastError = sourceStartedFailures[sourceStartedFailures.length - 1]?.message ?? null;
        const failureKey = String(source.id);
        const previousFailures = sourceFailureCounts.get(failureKey) ?? 0;
        const nextFailures = status === "success" ? 0 : previousFailures + 1;
        sourceFailureCounts.set(failureKey, nextFailures);

        lastScrapeSummary.feedResults.push({
          sourceId: source.id,
          source: source.name,
          url: source.url,
          status,
          articlesCollected: items.length,
          articlesAccepted: accepted,
          articlesSaved: 0,
          articlesSkipped: skipped,
          error: lastError,
          lastScrapeAt: new Date().toISOString(),
        });

        if (useSupabaseData()) {
          await updateSupabaseSourceHealth(source.id, {
            status: status === "success" ? "healthy" : nextFailures >= 3 ? "failed" : "warning",
            lastScrapeAt: new Date(),
            lastSuccessAt: status === "success" ? new Date() : null,
            lastError,
            consecutiveFailures: nextFailures,
          }).catch((err) => logger.debug({ err, source: source.name }, "Source health update skipped"));
        }
      } else {
        const summary = summarizeHttpError(result.reason);
        lastScrapeFailures.push({ source: "unknown", url: "unknown", attempts: 1, ...summary });
      }
    }

    articlesFound = allItems.length;
    lastScrapeSummary.articlesCollected = fetchResults
      .filter((result): result is PromiseFulfilledResult<{ source: typeof sources[0]; items: ScrapedItem[] }> => result.status === "fulfilled")
      .reduce((sum, result) => sum + result.value.items.length, 0);
    lastScrapeSummary.articlesAccepted = articlesFound;
    lastScrapeSummary.malformedSkipped = malformedSkipped;
    lastScrapeSummary.duplicatesSkipped = duplicatesSkipped;
    lastScrapeSummary.successfulFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "success").length;
    lastScrapeSummary.emptyFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "empty").length;
    lastScrapeSummary.failedFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "failed").length;
    logger.info({ articlesFound, summary: lastScrapeSummary }, "All sources fetched — scoring articles");

    // Scoring is also bounded so provider/network stalls cannot monopolize the server.
    const scoringResults = await mapWithConcurrency(
      allItems,
      8,
      async ({ source, item }) => {
        // Check if article already exists
        if (useSupabaseData()) {
          const existing = await getSupabaseArticleByUrl(item.url);
          if (existing) return null;
        } else {
          const existing = await db
            .select({ id: articlesTable.id })
            .from(articlesTable)
            .where(eq(articlesTable.url, item.url))
            .limit(1);

          if (existing.length > 0) return null;
        }

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
      }
    );

    // ── Multi-source story confidence boost ────────────────────────────────────
    // If multiple sources independently cover the same story (same topic tags),
    // the story is validated by corroboration. The top-scored article in each
    // cluster receives +0.4 per extra source, capped at +1.0.
    type ArticleToInsert = {
      headline: string; url: string; sourceName: string; sourceUrl: string;
      author: string | null; authorType: string | null;
      platform: "news" | "twitter" | "linkedin";
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
      } else if (r.status === "fulfilled" && r.value !== null) {
        lowScoreSkipped++;
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
        if (useSupabaseData()) {
          await createSupabaseArticle({
            ...article,
            relevancyScore: boostedScore,
            isEmergingSignal: multiSourceBoost > 0 ? true : article.isEmergingSignal,
          });
        } else {
          await db.insert(articlesTable).values({
            ...article,
            relevancyScore: boostedScore,
            isEmergingSignal: multiSourceBoost > 0 ? true : article.isEmergingSignal,
          });
        }
        articlesAdded++;
        const feed = lastScrapeSummary.feedResults.find((result) => result.url === article.sourceUrl);
        if (feed) feed.articlesSaved++;
      } catch (e) {
        duplicatesSkipped++;
        logger.warn({ error: summarizeHttpError(e), url: article.url, headline: article.headline }, "Failed to insert article");
      }
    }

    if (useSupabaseData()) {
      await Promise.allSettled(lastScrapeSummary.feedResults.map((feed) => {
        const previousFailures = sourceFailureCounts.get(String(feed.sourceId)) ?? 0;
        return updateSupabaseSourceHealth(feed.sourceId, {
          status: feed.status === "success" ? "healthy" : previousFailures >= 3 ? "failed" : "warning",
          lastScrapeAt: new Date(feed.lastScrapeAt),
          lastSuccessAt: feed.status === "success" ? new Date(feed.lastScrapeAt) : null,
          lastError: feed.error ?? null,
          consecutiveFailures: previousFailures,
          articlesCollected: feed.articlesCollected,
          articlesSaved: feed.articlesSaved,
        });
      }));
    }

    // Also skip any scored articles that were below threshold (the validArticles filter above handles this)
    for (const result of scoringResults) {
      if (result.status === "fulfilled" && result.value !== null && result.value.relevancyScore < 4.5) {
        logger.debug({ headline: result.value.headline, score: result.value.relevancyScore }, "Skipping low-relevance article");
      }
    }

    lastScrapeAt = new Date();
    lastScrapeArticlesFound = articlesFound;
    lastScrapeSummary.finishedAt = lastScrapeAt.toISOString();
    lastScrapeSummary.articlesSaved = articlesAdded;
    lastScrapeSummary.duplicatesSkipped = duplicatesSkipped;
    lastScrapeSummary.malformedSkipped = malformedSkipped;
    lastScrapeSummary.lowScoreSkipped = lowScoreSkipped;
    logger.info({ articlesFound, articlesAdded, feedFailures: lastScrapeFailures.length, summary: lastScrapeSummary }, "Parallel scrape run complete");
  } catch (e) {
    logger.error({ error: summarizeHttpError(e) }, "Scrape run failed");
  } finally {
    scrapeInProgress = false;
    if (!lastScrapeSummary.finishedAt) lastScrapeSummary.finishedAt = new Date().toISOString();
  }

  return { articlesFound, articlesAdded, summary: lastScrapeSummary };
}
