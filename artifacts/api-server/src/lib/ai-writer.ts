import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Article } from "@workspace/db";
import { logger } from "./logger";
import { getFirestoreArticle, getFirestoreDigest, listFirestoreArticles, listFirestoreDigests, updateFirestoreDigest } from "./firestore-data";
import { listFirestoreNewsletterSubscribers } from "./firestore-newsletter";
import { BRIEF_CANDIDATE_SCORE_THRESHOLD, DASHBOARD_SIGNAL_SCORE_THRESHOLD, runScrape } from "./scraper";
import { articleRecommendedFor } from "./rgi-relevance";
import { applyBrandComplianceToBrief, applyRgiBrandComplianceToText, RGI_BRAND_VOICE_SYSTEM_PROMPT } from "./brand-voice";

// Topic article: Key: sorted article IDs + editorNotes → cached result + timestamp
interface CachedArticle {
  result: {
    headline: string; body: string; executiveSummary: string[]; rgiTake: string;
    keyTakeaways: string[]; whatToWatch: string[]; topicTags: string[]; discipline: string; relevancyScore: number;
    generationMode?: "ai" | "fallback"; fallbackReason?: string;
  };
  generatedAt: number;
}
const topicArticleCache = new Map<string, CachedArticle>();
const TOPIC_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const GENERATION_FORMAT_VERSION = "rgi-foresight-one-page-v1";

function topicArticleCacheKey(articleIds: number[], editorNotes?: string | null): string {
  return `${GENERATION_FORMAT_VERSION}:${[...articleIds].sort((a, b) => a - b).join(",")}:${editorNotes?.trim() || ""}`;
}

interface DailyBriefResult {
  headline: string; executiveSummary: string[]; body: string;
  rgiTake: string; keyTakeaways: string[];
  implificationsForLeaders: string[]; whatChangedSinceYesterday: string[];
  whatToWatch: string[]; summaryTakeaways: string[];
  whatMostAreMissing: string | null; mechanism: string[]; constraintsAndRisks: string[];
  topicTags: string[]; discipline: string; relevancyScore: number; sourceArticleIds: number[];
  generationMode?: "ai" | "fallback"; fallbackReason?: string;
}

// Compact source format — headline + viewpoint + short summary (no full content dump)
// 350-char cap per source keeps prompt tight and generation fast without losing analytical value
function compactSource(a: Record<string, unknown>, i: number): string {
  const isPrimary = a.isPrimarySignal as boolean | undefined;
  const auth = (a.authenticityScore as number | null | undefined) ?? 5;
  const credLabel = auth >= 8 ? "HIGH" : auth >= 6 ? "MED" : "LOW";
  const signalTag = isPrimary ? " [PRIMARY SIGNAL]" : "";
  const viewpoint = sanitizePromptViewpoint((a.viewpoint as string | null | undefined) || "");
  const summary = ((a.teaserSummary || a.content || a.headline) as string).slice(0, 350);
  return [
    `S${i + 1}${signalTag}: ${a.headline}`,
    `Source: ${a.sourceName}${a.author ? ` · ${a.author}` : ""} | Relevancy: ${a.relevancyScore}/10 | Auth: ${auth}/10 (${credLabel})`,
    viewpoint ? `RGI viewpoint: ${viewpoint}` : null,
    `Summary: ${summary}`,
  ].filter(Boolean).join("\n");
}

function sanitizePromptViewpoint(value: string): string {
  return applyRgiBrandComplianceToText(value).text;
}

function cleanSnippet(value: unknown, max = 240): string {
  return stripEmDash(String(value ?? ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function uniqueStrings(values: unknown[], fallback: string[] = []): string[] {
  const output = [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()))];
  return output.length > 0 ? output : fallback;
}

function articleSourceLine(article: Record<string, unknown>): string {
  const source = cleanSnippet(article.sourceName, 80) || "Source";
  const headline = cleanSnippet(article.headline, 160) || "Untitled signal";
  const summary = cleanSnippet(article.teaserSummary || article.content, 220);
  return summary ? `${source}: ${headline}. ${summary}` : `${source}: ${headline}`;
}

function clampScore(value: unknown, fallback = 7): number {
  const score = Number(value);
  if (!Number.isFinite(score)) return fallback;
  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
}

function averageScore(articles: Array<Record<string, unknown>>): number {
  const scores = articles.map((a) => Number(a.relevancyScore ?? 6)).filter(Number.isFinite);
  if (scores.length === 0) return 7;
  return clampScore(scores.reduce((sum, score) => sum + score, 0) / scores.length, 7);
}

function articleTime(article: Article): number {
  const published = article.publishedAt instanceof Date ? article.publishedAt.getTime() : 0;
  const scraped = article.scrapedAt instanceof Date ? article.scrapedAt.getTime() : 0;
  return Math.max(published || 0, scraped || 0);
}

function articlePublishedTime(article: Article): number {
  return article.publishedAt instanceof Date ? article.publishedAt.getTime() : 0;
}

function applyExcludedTopics(articles: Article[], excludedTopics?: string[]): Article[] {
  if (!excludedTopics?.length) return articles;
  const excluded = new Set(excludedTopics);
  return articles.filter((article) => {
    const tags = Array.isArray(article.topicTags) ? article.topicTags : [];
    return tags.length === 0 || tags.some((tag) => !excluded.has(tag));
  });
}

function rankDailyBriefArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    const rank = (article: Article & Record<string, unknown>) => {
      const ageHours = Math.max(0, (Date.now() - articlePublishedTime(article)) / (60 * 60 * 1000));
      const recency = articlePublishedTime(article) ? Math.max(0, 10 - ageHours / 2.4) : 0;
      return (
        Number(article.relevancyScore ?? 0) * 0.46 +
        Number(article.executiveRelevanceScore ?? article.relevancyScore ?? 0) * 0.2 +
        Number(article.strategicImpactScore ?? article.relevancyScore ?? 0) * 0.16 +
        Number(article.sourceAuthorityScore ?? article.authenticityScore ?? 0) * 0.1 +
        recency * 0.08
      );
    };
    const scoreDelta = rank(b as Article & Record<string, unknown>) - rank(a as Article & Record<string, unknown>);
    if (Math.abs(scoreDelta) > 0.01) return scoreDelta;
    return articleTime(b) - articleTime(a);
  });
}

type BriefClusterProfile = {
  name: string;
  thesis: string;
  tags: string[];
  boundary: ThesisBoundary;
  primaryPatterns: RegExp[];
  patterns: RegExp[];
};

type ThesisBoundary = {
  coreIssue: string;
  allowedGeography: string[];
  allowedPolicyDomain: string[];
  allowedMarketDomain: string[];
  allowedInstitutions: string[];
  allowedStrategicConsequences: string[];
  forbiddenTopics: string[];
  forbiddenPatterns: RegExp[];
};

const BRIEF_CLUSTER_PROFILES: BriefClusterProfile[] = [
  {
    name: "geopolitics-energy-security",
    thesis: "Security guarantees, energy chokepoints, and regional bargaining are moving faster than institutional planning assumptions.",
    tags: ["Geopolitics & Global Power", "Energy & Resources", "Supply Chains & Global Trade", "Wars, Conflict & Security"],
    boundary: {
      coreIssue: "Gulf realignment is eroding predictable energy-security assumptions.",
      allowedGeography: ["Iran", "Gulf states", "Strait of Hormuz", "Israel", "Lebanon", "Middle East", "shipping corridors"],
      allowedPolicyDomain: ["US-Iran diplomacy", "military escalation", "regional alliances", "security guarantees", "sanctions"],
      allowedMarketDomain: ["oil", "LNG", "energy flows", "shipping insurance", "commodity exposure", "supply continuity"],
      allowedInstitutions: ["executive teams", "boards", "energy firms", "insurers", "logistics operators", "policymakers", "security agencies"],
      allowedStrategicConsequences: ["weaker deterrence assumptions", "chokepoint bargaining", "supply-chain exposure", "capital and insurance repricing", "institutional planning stress"],
      forbiddenTopics: ["memory chip valuations", "Korean equities", "general AI market rallies", "unrelated technology capital flows", "unrelated US domestic policy", "unrelated corporate earnings"],
      forbiddenPatterns: [/memory chip|chipmaker|semiconductor|korean equities|sk hynix|micron|nvidia|nasdaq|technology stock|tech stock|ai rally|ai-driven demand|data center|compute|artificial intelligence|digital asset|crypto|ipo|earnings/i],
    },
    primaryPatterns: [/iran|gulf|hormuz|oil|energy|shipping|lng|israel|hezbollah|ceasefire|sanction|security guarantee|regional alliance|middle east|strait/i],
    patterns: [/iran|gulf|hormuz|oil|energy|shipping|lng|israel|hezbollah|ceasefire|sanction|security guarantee|regional alliance|middle east|strait/i],
  },
  {
    name: "ai-institutional-trust",
    thesis: "AI adoption is becoming a test of institutional judgment because capability is advancing faster than governance, verification, and accountability.",
    tags: ["Technology & AI", "Innovation & Digital Transformation", "Policy, Regulation & Governance", "Leadership & Organizations"],
    boundary: {
      coreIssue: "AI capability is advancing faster than governance, verification, and accountability.",
      allowedGeography: ["United States", "Europe", "China", "global technology markets", "digital infrastructure jurisdictions"],
      allowedPolicyDomain: ["AI regulation", "technology governance", "digital sovereignty", "cybersecurity", "privacy", "public accountability"],
      allowedMarketDomain: ["AI infrastructure", "semiconductors", "data centers", "cloud infrastructure", "capital allocation tied to AI"],
      allowedInstitutions: ["boards", "executive teams", "technology firms", "regulators", "public agencies", "civil society"],
      allowedStrategicConsequences: ["verification gaps", "legitimacy risk", "public backlash", "concentrated infrastructure exposure", "governance lag"],
      forbiddenTopics: ["Gulf security guarantees", "Strait of Hormuz", "oil chokepoint risk", "unrelated military escalation", "unrelated domestic election politics", "sports or culture items"],
      forbiddenPatterns: [/hormuz|gulf states|oil shipment|lng shipment|iran war|hezbollah|israel strike|ceasefire|ukraine war|russia war|nato defense spending|basketball|sports/i],
    },
    primaryPatterns: [/\bai\b|artificial intelligence|ai agent|agentic|foundation model|large language model|machine learning|automation|semiconductor|memory chip|chipmaker|data center|compute|cybersecurity|cyber attack|digital infrastructure/i],
    patterns: [/\bai\b|artificial intelligence|ai agent|agentic|foundation model|large language model|machine learning|automation|semiconductor|memory chip|chipmaker|cybersecurity|cyber attack|data center|compute|digital infrastructure|privacy|verification/i],
  },
  {
    name: "markets-policy-risk",
    thesis: "Markets are pricing relief before policy, capital, and institutional conditions have become durable enough to justify it.",
    tags: ["Finance & Markets", "Economics & Macroeconomics", "Policy, Regulation & Governance", "Business Strategy & Corporations"],
    boundary: {
      coreIssue: "Markets are repricing relief before policy and institutional conditions are durable.",
      allowedGeography: ["United States", "Europe", "Asia", "global markets"],
      allowedPolicyDomain: ["monetary policy", "fiscal policy", "trade policy", "tariffs", "central-bank decisions", "regulatory action"],
      allowedMarketDomain: ["stocks", "bonds", "currencies", "inflation", "rates", "capital markets", "credit", "commodities when tied to market pricing"],
      allowedInstitutions: ["central banks", "finance ministries", "boards", "investors", "asset managers", "corporate treasury teams"],
      allowedStrategicConsequences: ["capital mispricing", "policy credibility risk", "liquidity exposure", "cost-of-capital shifts", "risk model failure"],
      forbiddenTopics: ["unrelated AI governance", "unrelated military operations", "sports or entertainment", "general culture stories"],
      forbiddenPatterns: [/ai criticism|ai agent|data center protest|basketball|sports|movie|celebrity|reality tv|rape allegations|hezbollah strike/i],
    },
    primaryPatterns: [/market|stock|bond|currency|inflation|central bank|fed|ecb|rates|capital|valuation|tariff|trade|fiscal|debt/i],
    patterns: [/market|stock|bond|currency|inflation|central bank|fed|ecb|rates|capital|valuation|tariff|trade|fiscal|debt/i],
  },
  {
    name: "governance-leadership-instability",
    thesis: "Institutional credibility is being tested as formal authority struggles to keep pace with political pressure, public trust, and leadership accountability.",
    tags: ["Policy, Regulation & Governance", "Leadership & Organizations", "Geopolitics & Global Power", "Future of Work & Society"],
    boundary: {
      coreIssue: "Institutional authority is being tested by trust, legitimacy, and executive accountability.",
      allowedGeography: ["United States", "Europe", "United Kingdom", "major public institutions"],
      allowedPolicyDomain: ["rule of law", "executive power", "elections", "regulation", "institutional trust", "public legitimacy"],
      allowedMarketDomain: ["policy-sensitive capital allocation", "regulatory exposure", "public-sector operating risk"],
      allowedInstitutions: ["governments", "courts", "regulators", "boards", "public agencies", "civic institutions"],
      allowedStrategicConsequences: ["legitimacy erosion", "accountability failure", "policy volatility", "governance drift", "trust loss"],
      forbiddenTopics: ["memory chip valuations", "unrelated AI product launches", "oil shipment logistics", "sports or entertainment"],
      forbiddenPatterns: [/memory chip|semiconductor|sk hynix|micron|ai agent|data center|oil shipment|lng shipment|basketball|sports/i],
    },
    primaryPatterns: [/government|court|election|minister|president|regulation|law|trust|legitimacy|resign|scandal|protest/i],
    patterns: [/government|court|election|minister|president|regulation|law|trust|legitimacy|leadership|resign|scandal|protest|institution/i],
  },
  {
    name: "supply-chain-strategic-exposure",
    thesis: "Operational systems are becoming strategic liabilities as supply chains, resource access, and policy leverage converge.",
    tags: ["Supply Chains & Global Trade", "Energy & Resources", "Technology & AI", "Business Strategy & Corporations"],
    boundary: {
      coreIssue: "Operational dependencies are becoming strategic exposure.",
      allowedGeography: ["global supply chains", "shipping corridors", "manufacturing hubs", "critical minerals regions", "energy corridors"],
      allowedPolicyDomain: ["export controls", "industrial policy", "trade restrictions", "resource security", "procurement rules"],
      allowedMarketDomain: ["logistics", "commodities", "critical minerals", "manufacturing capacity", "inventory", "procurement", "energy inputs"],
      allowedInstitutions: ["manufacturers", "logistics operators", "boards", "procurement teams", "policymakers", "energy firms"],
      allowedStrategicConsequences: ["operational fragility", "resource leverage", "inventory risk", "supplier concentration", "resilience cost"],
      forbiddenTopics: ["unrelated electoral politics", "unrelated AI governance", "sports or entertainment", "general market commentary not tied to supply chains"],
      forbiddenPatterns: [/election|senate primary|ai criticism|ai agent|basketball|sports|reality tv|celebrity/i],
    },
    primaryPatterns: [/supply chain|logistics|shipping|port|critical mineral|commodity|export control|factory|manufacturing|inventory|procurement|semiconductor/i],
    patterns: [/supply chain|logistics|shipping|port|critical mineral|commodity|export control|factory|manufacturing|inventory|procurement|semiconductor/i],
  },
];

type DailyBriefSelection = {
  articles: Article[];
  selectionMode: string;
  clusterName?: string;
  clusterThesis?: string;
  thesisBoundary?: ThesisBoundary;
  sourceDispositions?: Array<{
    id: number;
    headline: string;
    clusterRole: "core" | "supporting" | "context" | "reject";
    thesisFitScore: number;
    reasonForInclusion?: string;
    reasonForExclusion?: string;
  }>;
  excludedArticleIds?: number[];
};

type BriefCoherenceContext = {
  clusterName: string;
  clusterThesis: string;
  boundary: ThesisBoundary;
  sourceDispositions?: DailyBriefSelection["sourceDispositions"];
};

function articleClusterScore(article: Article, profile: BriefClusterProfile): number {
  const tags = Array.isArray(article.topicTags) ? article.topicTags : [];
  const text = `${article.headline ?? ""} ${article.teaserSummary ?? ""} ${article.viewpoint ?? ""} ${String(article.content ?? "").slice(0, 500)}`;
  const tagScore = tags.filter((tag) => profile.tags.includes(tag)).length * 3;
  const patternScore = profile.patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 2 : 0), 0);
  return tagScore + patternScore + Number(article.relevancyScore ?? 0) * 0.35 + Number(article.authenticityScore ?? 0) * 0.1;
}

function classifyArticleForCluster(article: Article, profile: BriefClusterProfile): {
  article: Article;
  clusterRole: "core" | "supporting" | "context" | "reject";
  thesisFitScore: number;
  reasonForInclusion?: string;
  reasonForExclusion?: string;
} {
  const tags = Array.isArray(article.topicTags) ? article.topicTags : [];
  const text = `${article.headline ?? ""} ${article.teaserSummary ?? ""} ${article.viewpoint ?? ""} ${String(article.content ?? "").slice(0, 500)}`;
  const hasDirectTag = profile.tags.slice(0, 2).some((tag) => tags.includes(tag));
  const primaryMatches = profile.primaryPatterns.filter((pattern) => pattern.test(text)).length;
  const broadMatches = profile.patterns.filter((pattern) => pattern.test(text)).length;
  const hasForbiddenTopic = profile.boundary.forbiddenPatterns.some((pattern) => pattern.test(text));
  const baseScore = Number(article.relevancyScore ?? 0);
  const thesisFitScore = Math.max(
    1,
    Math.min(
      10,
      Math.round((
        (hasDirectTag ? 3 : 0) +
        Math.min(primaryMatches, 2) * 2.2 +
        Math.min(broadMatches, 2) * 0.9 +
        Math.min(baseScore, 10) * 0.25 -
        (hasForbiddenTopic ? 4.5 : 0)
      ) * 10) / 10
    )
  );

  if (hasForbiddenTopic) {
    return {
      article,
      clusterRole: "reject",
      thesisFitScore,
      reasonForExclusion: `Off-thesis for ${profile.name}; matches forbidden topic boundary.`,
    };
  }

  if (thesisFitScore >= 8 && hasDirectTag && primaryMatches > 0) {
    return {
      article,
      clusterRole: "core",
      thesisFitScore,
      reasonForInclusion: `Directly supports thesis: ${profile.boundary.coreIssue}`,
    };
  }

  if (thesisFitScore >= 7 && (hasDirectTag || primaryMatches > 0)) {
    return {
      article,
      clusterRole: "supporting",
      thesisFitScore,
      reasonForInclusion: `Supports the thesis boundary through ${hasDirectTag ? "topic alignment" : "direct subject evidence"}.`,
    };
  }

  if (thesisFitScore >= 5.5) {
    return {
      article,
      clusterRole: "context",
      thesisFitScore,
      reasonForExclusion: "Useful background context, but not direct enough for Signal bullets or source attribution.",
    };
  }

  return {
    article,
    clusterRole: "reject",
    thesisFitScore,
    reasonForExclusion: `Thesis fit ${thesisFitScore.toFixed(1)} is below the hard inclusion floor of 7.0.`,
  };
}

function profileByName(name?: string): BriefClusterProfile | undefined {
  return BRIEF_CLUSTER_PROFILES.find((profile) => profile.name === name);
}

function boundaryToPrompt(boundary: ThesisBoundary): string {
  return [
    `Thesis boundary core issue: ${boundary.coreIssue}`,
    `Allowed geography: ${boundary.allowedGeography.join(", ")}`,
    `Allowed policy domain: ${boundary.allowedPolicyDomain.join(", ")}`,
    `Allowed market domain: ${boundary.allowedMarketDomain.join(", ")}`,
    `Allowed institutions: ${boundary.allowedInstitutions.join(", ")}`,
    `Allowed strategic consequence: ${boundary.allowedStrategicConsequences.join(", ")}`,
    `Forbidden off-thesis topics: ${boundary.forbiddenTopics.join(", ")}`,
  ].join("\n");
}

function coherenceContextFromSelection(selection: DailyBriefSelection): BriefCoherenceContext | null {
  const profile = profileByName(selection.clusterName);
  const boundary = selection.thesisBoundary ?? profile?.boundary;
  if (!selection.clusterName || !selection.clusterThesis || !boundary) return null;
  return {
    clusterName: selection.clusterName,
    clusterThesis: selection.clusterThesis,
    boundary,
    sourceDispositions: selection.sourceDispositions,
  };
}

function sourceDispositionsToPrompt(dispositions?: DailyBriefSelection["sourceDispositions"]): string {
  if (!dispositions?.length) return "No source disposition table available.";
  return dispositions
    .slice(0, 20)
    .map((item) => {
      const reason = item.reasonForInclusion || item.reasonForExclusion || "No reason recorded.";
      return `- ${item.id}: ${item.clusterRole.toUpperCase()} thesisFit=${item.thesisFitScore.toFixed(1)} | ${item.headline} | ${reason}`;
    })
    .join("\n");
}

function compositionPlanFromSelection(selection: DailyBriefSelection, selectedArticles: Article[]): string {
  if (!selection.clusterThesis) return "";
  const boundary = selection.thesisBoundary ?? profileByName(selection.clusterName)?.boundary;
  const boundaryBlock = boundary
    ? `\n\nTHESIS BOUNDARY (hard, do not cross):\n${boundaryToPrompt(boundary)}`
    : "";
  const dispositionBlock = selection.sourceDispositions
    ? `\n\nSOURCE DISPOSITIONS (internal, do not output):\n${sourceDispositionsToPrompt(selection.sourceDispositions)}`
    : "";
  return [
    "COMPOSITION PLAN (internal, do not output):",
    `Selected cluster: ${selection.clusterName ?? "coherent cluster"}`,
    `Central thesis: ${selection.clusterThesis}`,
    `Selected article IDs allowed in final brief: ${selectedArticles.map((article) => article.id).join(", ")}`,
    `Excluded off-thesis article IDs: ${(selection.excludedArticleIds ?? []).join(", ") || "none"}`,
    "Hard rule: every Signal bullet, Strategic Foresight paragraph, Leaders May Miss bullet, and RGI Judgment sentence must support the central thesis.",
    "Context and rejected articles may not appear in the final brief and may not shape source attribution.",
    "Do not introduce technology, AI, markets, policy, or governance material unless it directly fits the thesis boundary below.",
    boundaryBlock,
    dispositionBlock,
  ].filter(Boolean).join("\n");
}

function coherenceContextForArticles(articles: Article[]): BriefCoherenceContext | null {
  const selection = selectCoherentArticleCluster(articles, Math.min(5, articles.length || 5));
  const selectionContext = coherenceContextFromSelection(selection);
  if (selectionContext) return selectionContext;

  const rankedClassifications = articles
    .flatMap((article) => BRIEF_CLUSTER_PROFILES.map((profile) => ({
      profile,
      classification: classifyArticleForCluster(article, profile),
    })))
    .filter(({ classification }) => ["core", "supporting"].includes(classification.clusterRole) && classification.thesisFitScore >= 7)
    .sort((a, b) => b.classification.thesisFitScore - a.classification.thesisFitScore);

  const best = rankedClassifications[0];
  if (!best) return null;
  return {
    clusterName: best.profile.name,
    clusterThesis: best.profile.thesis,
    boundary: best.profile.boundary,
    sourceDispositions: articles.map((article) => {
      const item = classifyArticleForCluster(article, best.profile);
      return {
        id: item.article.id,
        headline: item.article.headline,
        clusterRole: item.clusterRole,
        thesisFitScore: item.thesisFitScore,
        reasonForInclusion: item.reasonForInclusion,
        reasonForExclusion: item.reasonForExclusion,
      };
    }),
  };
}

function selectClusterMembers(articles: Article[], profile: BriefClusterProfile, limit = 5): Article[] {
  const scored = articles
    .map((article) => ({
      ...classifyArticleForCluster(article, profile),
      score: articleClusterScore(article, profile),
    }))
    .filter(({ clusterRole, thesisFitScore }) => ["core", "supporting"].includes(clusterRole) && thesisFitScore >= 7)
    .sort((a, b) => {
      const delta = b.thesisFitScore - a.thesisFitScore || b.score - a.score;
      if (Math.abs(delta) > 0.01) return delta;
      return Number(b.article.relevancyScore ?? 0) - Number(a.article.relevancyScore ?? 0);
    });

  const selected: Article[] = [];
  const sourceCounts = new Map<string, number>();
  for (const { article } of scored) {
    const source = article.sourceName || article.sourceUrl || "unknown";
    const sourceCount = sourceCounts.get(source) ?? 0;
    if (sourceCount >= 2 && selected.length >= 3) continue;
    selected.push(article);
    sourceCounts.set(source, sourceCount + 1);
    if (selected.length >= limit) break;
  }

  return selected;
}

function selectCoherentArticleCluster(articles: Article[], limit = 5): DailyBriefSelection {
  const ranked = rankDailyBriefArticles(articles);
  const clusterOptions = BRIEF_CLUSTER_PROFILES
    .map((profile) => {
      const members = selectClusterMembers(ranked, profile, limit);
      const dispositions = ranked.map((article) => classifyArticleForCluster(article, profile));
      const avgScore = members.length
        ? members.reduce((sum, article) => sum + Number(article.relevancyScore ?? 0), 0) / members.length
        : 0;
      const sourceCount = new Set(members.map((article) => article.sourceName || article.sourceUrl || "unknown")).size;
      return {
        profile,
        members,
        dispositions,
        score: avgScore + Math.min(members.length, limit) * 1.6 + sourceCount * 0.4,
      };
    })
    .filter((option) => option.members.length >= 2 && option.dispositions.some((item) => item.clusterRole === "core"))
    .sort((a, b) => b.score - a.score);

  const best = clusterOptions[0];
  if (best) {
    const articlesInCluster = rankDailyBriefArticles(best.members).slice(0, limit);
    return {
      articles: articlesInCluster,
      selectionMode: `coherent-cluster:${best.profile.name}`,
      clusterName: best.profile.name,
      clusterThesis: best.profile.thesis,
      thesisBoundary: best.profile.boundary,
      sourceDispositions: best.dispositions.map((item) => ({
        id: item.article.id,
        headline: item.article.headline,
        clusterRole: item.clusterRole,
        thesisFitScore: item.thesisFitScore,
        reasonForInclusion: item.reasonForInclusion,
        reasonForExclusion: item.reasonForExclusion,
      })),
      excludedArticleIds: ranked.filter((article) => !articlesInCluster.some((selected) => selected.id === article.id)).slice(0, 12).map((article) => article.id),
    };
  }

  return {
    articles: ranked.slice(0, Math.min(3, limit)),
    selectionMode: "single-theme-fallback",
    clusterName: "single-theme-fallback",
    clusterThesis: "One dominant high-relevance signal is more useful than a forced roundup of unrelated developments.",
    excludedArticleIds: ranked.slice(Math.min(3, limit), 15).map((article) => article.id),
  };
}

function selectDiverseArticles(articles: Article[], limit = 7): Article[] {
  const ranked = rankDailyBriefArticles(articles);
  const selected: Article[] = [];
  const sourceCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  for (const article of ranked) {
    const source = article.sourceName || article.sourceUrl || "unknown";
    const tags = Array.isArray(article.topicTags) ? article.topicTags : [];
    const sourceCount = sourceCounts.get(source) ?? 0;
    const dominantTopicCount = Math.max(0, ...tags.map((tag) => topicCounts.get(tag) ?? 0));

    if (selected.length >= Math.min(4, limit) || (sourceCount < 2 && dominantTopicCount < 3)) {
      selected.push(article);
      sourceCounts.set(source, sourceCount + 1);
      for (const tag of tags) topicCounts.set(tag, (topicCounts.get(tag) ?? 0) + 1);
    }

    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const article of ranked) {
      if (!selected.some((item) => item.id === article.id)) selected.push(article);
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

function chooseDailyBriefArticles(allArticles: Article[], today: Date, excludedTopics?: string[]): DailyBriefSelection {
  const usable = applyExcludedTopics(
    allArticles.filter((article) => article.status !== "dismissed" && article.headline && article.url),
    excludedTopics,
  );
  const stages: Array<{ mode: string; items: Article[]; minScore: number }> = [
    {
      mode: "fresh-rgi-daily-brief",
      items: usable.filter((article) => articleRecommendedFor(article as Article & Record<string, unknown>, "daily_brief")),
      minScore: BRIEF_CANDIDATE_SCORE_THRESHOLD,
    },
    {
      mode: "fresh-dashboard-signals",
      items: usable.filter((article) => articleRecommendedFor(article as Article & Record<string, unknown>, "dashboard")),
      minScore: DASHBOARD_SIGNAL_SCORE_THRESHOLD,
    },
  ];

  for (const stage of stages) {
    const candidates = stage.items.filter((article) => Number(article.relevancyScore ?? 0) >= stage.minScore);
    if (candidates.length > 0) {
      const clustered = selectCoherentArticleCluster(candidates.sort((a, b) => articlePublishedTime(b) - articlePublishedTime(a)), 5);
      return { ...clustered, selectionMode: `${stage.mode}:${clustered.selectionMode}` };
    }
  }

  return { articles: [], selectionMode: "none" };
}

function topSourceNames(articles: Array<Record<string, unknown>>, limit = 5): string[] {
  return uniqueStrings(articles.map((a) => cleanSnippet(a.sourceName, 80)), ["source"]).slice(0, limit);
}

function dominantTags(articles: Array<Record<string, unknown>>, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const tags = Array.isArray(article.topicTags) ? article.topicTags as string[] : [];
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  return (ranked.length ? ranked : ["Business Strategy & Corporations"]).slice(0, limit);
}

function dominantDiscipline(articles: Array<Record<string, unknown>>): string {
  const counts = new Map<string, number>();
  for (const article of articles) {
    const value = cleanSnippet(article.disciplineAlignment, 80) || "Multiple";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Multiple";
}

function sourceReferenceLines(articles: Array<Record<string, unknown>>, limit = 6): string[] {
  return articles.slice(0, limit).map((article, index) => {
    const source = cleanSnippet(article.sourceName, 80) || `Source ${index + 1}`;
    const headline = cleanSnippet(article.headline, 180) || "Untitled signal";
    return `${index + 1}. ${source}: ${headline}`;
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function publicationNamesFromArticles(articles: Array<Record<string, unknown>>): string[] {
  const known = [
    "New York Times", "The New York Times", "NYT", "Bloomberg", "Reuters", "CFR",
    "Council on Foreign Relations", "Wall Street Journal", "The Wall Street Journal", "WSJ",
    "Financial Times", "FT", "The Economist", "Foreign Affairs", "Foreign Policy",
    "Politico", "Axios", "Associated Press", "AP", "CNBC", "CNN", "BBC",
    "Washington Post", "The Washington Post", "Fast Company", "The Verge",
  ];
  return uniqueStrings([...known, ...articles.map((a) => cleanSnippet(a.sourceName, 80))]);
}

function enforceRgiBrandVoice(text: string): string {
  return applyRgiBrandComplianceToText(text).text;
}

function removeSourceMetaLanguage(text: string, articles: Array<Record<string, unknown>> = []): string {
  let cleaned = stripEmDash(String(text ?? ""));
  const publications = publicationNamesFromArticles(articles);

  cleaned = cleaned
    .replace(/\b(today'?s\s+)?source\s+set\s+points\s+to\b/gi, "the strategic reality points to")
    .replace(/\b(this|the)\s+brief\s+synthesizes\b/gi, "the operating picture reveals")
    .replace(/\bsource\s+set\b/gi, "operating picture")
    .replace(/\bsource\s+base\b/gi, "evidence base")
    .replace(/\bsource\s+convergence\b/gi, "pattern convergence")
    .replace(/\bsources?\s+(indicate|suggest|show|reveal|point\s+to)\b/gi, "the evidence $1")
    .replace(/\bcoverage\s+(indicates|suggests|shows|reveals|points\s+to)\b/gi, "the strategic signal $1")
    .replace(/\breporting\s+(indicates|suggests|shows|reveals|points\s+to)\b/gi, "available evidence $1")
    .replace(/\bmedia\s+coverage\b/gi, "public narrative");

  for (const publication of publications) {
    if (!publication || publication.toLowerCase() === "source") continue;
    cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(publication)}\\b`, "gi"), "");
  }

  return enforceRgiBrandVoice(cleaned
    .replace(/\bAcross\s+(?:,\s*)+/gi, "")
    .replace(/\bAcross\s+[, ]+/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim());
}

function cleanBriefText(value: unknown, articles: Array<Record<string, unknown>>, fallback = ""): string {
  const raw = typeof value === "string" && value.trim() ? value : fallback;
  return removeSourceMetaLanguage(raw, articles);
}

function cleanBriefArray(
  value: unknown,
  articles: Array<Record<string, unknown>>,
  fallback: string[] = []
): string[] {
  const items = Array.isArray(value) ? value : fallback;
  const cleaned = items
    .map((item) => removeSourceMetaLanguage(cleanSnippet(item, 900), articles))
    .filter((item) => item.length > 0);
  return cleaned.length > 0 ? cleaned : fallback.map((item) => removeSourceMetaLanguage(item, articles));
}

function cleanBriefBody(value: unknown, articles: Array<Record<string, unknown>>): string {
  const items = Array.isArray(value) ? value : (typeof value === "string" ? value.split(/\n+/) : []);
  return cleanBriefArray(items, articles).join("\n");
}

function cleanParagraphArray(
  value: unknown,
  articles: Array<Record<string, unknown>>,
  fallback: string[] = [],
  maxItems = 2
): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n{2,}/)
      : fallback;
  const cleaned = rawItems
    .map((item) => removeSourceMetaLanguage(cleanSnippet(item, 1800), articles))
    .map((item) => item.replace(/^\s*[-*]\s+/gm, "").replace(/\s+/g, " ").trim())
    .filter((item) => item.length > 0);
  const output = cleaned.length > 0
    ? cleaned
    : fallback.map((item) => removeSourceMetaLanguage(item, articles));
  return output.slice(0, maxItems);
}

function topicNoun(tag: string): string {
  if (/geopolitics|war|defense/i.test(tag)) return "geopolitical risk";
  if (/finance|market|econom/i.test(tag)) return "capital allocation";
  if (/technology|ai|digital|cyber/i.test(tag)) return "technology governance";
  if (/supply|trade|energy|resource/i.test(tag)) return "operational resilience";
  if (/policy|regulation|governance/i.test(tag)) return "institutional legitimacy";
  if (/work|leadership|organization/i.test(tag)) return "organizational judgment";
  return "strategic execution";
}

function inferCoreTension(articles: Array<Record<string, unknown>>, tags: string[]): string {
  const text = articles.map((a) => `${a.headline ?? ""} ${a.teaserSummary ?? ""} ${a.content ?? ""}`).join(" ").toLowerCase();
  if (/iran|israel|war|sanction|military|ceasefire|nuclear|china|russia|ukraine/.test(text)) {
    return "markets and institutions are being asked to price geopolitical relief before durable political settlement exists";
  }
  if (/ai|artificial intelligence|model|chip|semiconductor|automation|data center/.test(text)) {
    return "AI is moving from capability story to governance, capital, and execution test";
  }
  if (/rate|inflation|fed|bond|dollar|oil|stocks|valuation|ipo|capital/.test(text)) {
    return "capital markets are rewarding speed while the underlying policy and operating assumptions remain unsettled";
  }
  if (/court|regulation|policy|election|government|congress|law/.test(text)) {
    return "public institutions are forcing private leaders to make strategic decisions under contested legitimacy";
  }
  return `${topicNoun(tags[0] ?? "strategy")} is shifting faster than the institutions responsible for governing it`;
}

function detectContradiction(articles: Array<Record<string, unknown>>): string | null {
  const text = articles.map((a) => `${a.headline ?? ""} ${a.teaserSummary ?? ""} ${a.content ?? ""}`).join(" ").toLowerCase();
  const optimism = /(optimism|rally|rise|deal|recovery|growth|approval|breakthrough|easing)/.test(text);
  const caution = /(risk|warning|volatile|threat|sanction|failure|erosion|blocked|uncertainty|crisis|reject)/.test(text);
  if (optimism && caution) {
    return "The central tension is that markets and public narratives are leaning toward relief while the underlying operating evidence still points to unresolved risk.";
  }
  return null;
}

function signalPattern(articles: Array<Record<string, unknown>>): string {
  const text = articles.map((a) => `${a.headline ?? ""} ${a.teaserSummary ?? ""} ${a.content ?? ""}`).join(" ").toLowerCase();
  const patterns: string[] = [];
  if (/sanction|tariff|export control|trade restriction|industrial policy/.test(text)) patterns.push("policy power is becoming an instrument of market structure");
  if (/rate|inflation|bond|dollar|credit|valuation|ipo|capital/.test(text)) patterns.push("capital is repricing risk before institutional certainty arrives");
  if (/ai|semiconductor|automation|cyber|data center|model/.test(text)) patterns.push("technology capability is outrunning governance capacity");
  if (/labor|school|university|skills|workforce|demographic/.test(text)) patterns.push("human-capital systems are becoming a strategic constraint");
  if (/energy|oil|gas|grid|commodity|supply chain/.test(text)) patterns.push("operational resilience is again a strategic, not back-office, question");
  return patterns[0] ?? "multiple institutions are adjusting to pressure faster than their formal decision systems can absorb";
}

function sourceDiversityClause(articles: Array<Record<string, unknown>>): string {
  const sourceCount = new Set(articles.map((a) => cleanSnippet(a.sourceName, 80)).filter(Boolean)).size;
  if (sourceCount >= 5) return "The pattern is broad enough to treat as a strategic signal rather than an isolated event";
  if (sourceCount >= 3) return "The pattern is emerging, but leaders should still separate corroborated evidence from early signal";
  return "The signal remains provisional, so leaders should preserve optionality while monitoring for corroboration";
}

function synthesizeKeyDevelopments(articles: Array<Record<string, unknown>>, coreTension: string, tags: string[]): string[] {
  const sourceItems = articles
    .slice(0, 5)
    .map((article) => {
      const headline = cleanSnippet(article.headline, 150);
      const summary = cleanSnippet(article.teaserSummary || article.content, 160);
      if (!headline) return "";
      return summary && !summary.toLowerCase().includes(headline.toLowerCase())
        ? `${headline}: ${summary}`
        : headline;
    })
    .filter(Boolean);

  if (sourceItems.length >= 3) return sourceItems;

  const pattern = signalPattern(articles);
  return [
    `${pattern.charAt(0).toUpperCase()}${pattern.slice(1)} is becoming visible across today's operating environment.`,
    `${coreTension.charAt(0).toUpperCase()}${coreTension.slice(1)}.`,
    `${topicNoun(tags[0] ?? "strategy")} is shifting from background condition to active decision pressure.`,
  ];
}

function synthesizeWhyItMatters(coreTension: string, tags: string[]): string[] {
  const noun = topicNoun(tags[0] ?? "strategy");
  return [
    `Institutionally, ${coreTension}; this creates a governance problem because executives must distinguish temporary narrative relief from durable operating conditions.`,
    "Economically, the risk is misallocated capital: budgets, supply chains, talent plans, and public commitments can all be repositioned around assumptions that reverse quickly.",
    `Strategically, ${noun} now depends on judgment under uncertainty, not information volume. The leader's task is to identify which facts are load-bearing, which are merely loud, and which commitments become hard to unwind.`,
  ];
}

function synthesizeStrategicAnalysis(coreTension: string, tags: string[]): string[] {
  const noun = topicNoun(tags[0] ?? "strategy");
  return [
    `Two moves out, the issue is that ${coreTension}. The first-order event may look manageable, but the compounding consequence is that planning assumptions, institutional credibility, and capital discipline begin to move on different clocks. When ${noun} becomes contested, choices that appear tactical can quietly harden into governance commitments, reputational exposure, or operating constraints. The risk is not only that leaders read the event incorrectly; it is that they build future plans around the wrong interpretation before the evidence has matured.`,
    `The RGI lens treats this as a discipline of judgment, not a demand for prediction. Leaders need to identify which assumptions are load-bearing, which actors have incentives to change behavior, and which thresholds would prove the signal has become structural. The better response is not louder conviction. It is a clearer account of what must be verified, what should remain reversible, and who owns the consequence if the institution moves too soon or waits too long.`,
  ];
}

function synthesizeImplications(): string[] {
  return [
    "Mistaking temporary relief for structural stability and allowing short-term calm to reset long-term risk assumptions.",
    "Confusing activity with strategy when the real leadership task is to decide which commitments should remain reversible.",
    "Treating analysis volume as judgment and failing to assign ownership for the assumptions that would make action defensible.",
    "Waiting for consensus after the most valuable response window has already narrowed.",
  ];
}

function summarizeProviderError(err: unknown): { message: string; name?: string; code?: string } {
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    return {
      message: err instanceof Error ? err.message : "AI provider request failed",
      name: typeof record.name === "string" ? record.name : undefined,
      code: typeof record.code === "string" ? record.code : undefined,
    };
  }
  return { message: String(err || "AI provider request failed") };
}

type GeneratedBriefDraft = {
  headline: string;
  body: string;
  executiveSummary: string[];
  rgiTake: string;
  keyTakeaways: string[];
  implificationsForLeaders?: string[];
  whatToWatch?: string[];
  topicTags?: string[];
  discipline?: string;
  relevancyScore?: number;
  generationMode?: "ai" | "fallback";
};

function countWords(value: unknown): number {
  return String(value ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function anilAlignmentIssues(brief: GeneratedBriefDraft): string[] {
  const issues: string[] = [];
  const signalWords = countWords(brief.body);
  const foresightText = (brief.keyTakeaways ?? []).join(" ");
  const foresightWords = countWords(foresightText);
  const fullText = [
    brief.headline,
    ...(brief.executiveSummary ?? []),
    brief.body,
    foresightText,
    ...(brief.implificationsForLeaders ?? []),
    brief.rgiTake,
  ].join(" ");

  if (foresightWords < Math.max(220, signalWords * 1.75)) {
    issues.push("The analytical essay is not the center of gravity");
  }
  if (countWords(fullText) > 560) {
    issues.push("The brief is too long for the one-page PDF constraint");
  }
  if (!/\b(second-order|third-order|two moves|compound|structural|institutional|governance|legitimacy|accountability|assumption|consequence|exposure)\b/i.test(foresightText)) {
    issues.push("The essay does not clearly explain second- and third-order consequences");
  }
  if (!/\bRGI'?s (judgment|view) is that\b|\bthe real issue is not\b|\bthis is less a story about\b/i.test(fullText)) {
    issues.push("The brief does not clearly state RGI's editorial judgment");
  }
  if (!/\bstrategic implication is\b|\bforward-looking risk is\b|\bnext pressure point\b|\bRGI would caution\b/i.test(fullText)) {
    issues.push("The brief lacks explicit strategic foresight or forward-looking risk");
  }
  if (!/\bwhat leaders may miss is\b|\bleaders should not mistake\b|\bthe hidden misread\b/i.test(fullText)) {
    issues.push("The brief does not identify a specific executive blind spot");
  }
  if (!/\bRGI'?s bottom line:\b/i.test(fullText)) {
    issues.push("The ending does not provide a concise RGI bottom line");
  }
  if (!/\b(judgment|consequence|responsibility|restraint|verify|resist|own|legitimacy|accountability|trust)\b/i.test(brief.rgiTake ?? "")) {
    issues.push("The closing judgment is not specific enough to RGI's discipline of judgment");
  }
  if (/\b(news summary|summary of|roundup|coverage|source set|brief synthesizes|sources indicate|articles suggest)\b/i.test(fullText)) {
    issues.push("Output still reads like a news digest or editorial process note");
  }
  if (/\bcore judgment challenge is\b/i.test(fullText)) {
    issues.push("The opening uses mechanical prompt language instead of a direct RGI thesis");
  }
  if (/\b(oil|energy|gulf|iran|israel|shipping|hormuz)\b/i.test(brief.body) && /\b(chip|semiconductor|ai|memory|nasdaq|technology stock)\b/i.test(brief.body)) {
    issues.push("The Signal appears to combine unrelated energy/geopolitics and technology-market stories");
  }

  return issues;
}

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
  return JSON.parse(cleanText) as Record<string, unknown>;
}

async function reviseForAnilAlignment<T extends GeneratedBriefDraft>(
  brief: T,
  articles: Array<Record<string, unknown>>,
  generator: "generateDigestArticle" | "generateDailyBrief",
  traceId?: string
): Promise<T> {
  if (brief.generationMode === "fallback") return brief;

  const issues = anilAlignmentIssues(brief);
  if (issues.length === 0) return brief;

  const sourceSignals = articles
    .slice(0, 5)
    .map((article, index) => compactSource(article, index))
    .join("\n\n---\n\n");

  const currentBrief = JSON.stringify({
    headline: brief.headline,
    executiveSummary: brief.executiveSummary,
    keyTakeaways: brief.body.split("\n").filter(Boolean),
    strategicAssessment: brief.keyTakeaways,
    implicationsForLeaders: brief.implificationsForLeaders ?? [],
    rgiTake: brief.rgiTake,
    topicTags: brief.topicTags ?? [],
    discipline: brief.discipline ?? "Multiple",
    relevancyScore: brief.relevancyScore ?? 8,
  }, null, 2);

  const prompt = `Revise this RGI Strategic Judgment Brief so it satisfies Anil's CEO feedback.

Alignment problems detected:
${issues.map((issue) => `- ${issue}`).join("\n")}

Core revision instruction:
Revise this brief so it is built around one coherent RGI thesis and fits on one PDF page. Remove unrelated signals. Preserve factual accuracy. Make the analytical essay the center of gravity. Make the opening summary smaller. Make RGI's judgment explicit. Add forward-looking risk, second-order implications, one concrete executive blind spot, and a decisive "RGI's bottom line:" ending. Remove generic AI language.

Use the source material only as evidence for one RGI thesis. The opening paragraph belongs, but it is the foundation, not the product. The product is what this story produces next, what leaders may miss, and what judgment is required. If a factual point does not support the thesis, remove it.

Required product structure, represented by these JSON fields:
- executiveSummary = one short factual opening paragraph, no label, 55-85 words
- keyTakeaways = 3 narrative paragraphs, no bullets, no label. Include RGI's judgment, forward-looking risk, and what leaders may miss
- rgiTake = final bottom-line essay paragraph beginning with "RGI's bottom line:" and no label
- body and implicationsForLeaders may be empty because the public product has only two sections

Do not use em dashes. Do not use publication names. Do not use "This highlights," "This underscores," "Moreover," "Furthermore," "Notably," "strategic imperative," or "RGI partially agrees." Keep the total under 560 words.

SOURCE SIGNALS:
${sourceSignals}

CURRENT BRIEF JSON:
${currentBrief}

Return ONLY valid JSON with exactly these fields:
{
  "headline": "string",
  "executiveSummary": ["brief summary paragraph"],
  "keyTakeaways": [],
  "strategicAssessment": ["essay paragraph 1", "essay paragraph 2", "essay paragraph 3", "essay paragraph 4"],
  "implicationsForLeaders": [],
  "rgiTake": "single paragraph",
  "topicTags": ["tag"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}`;

  try {
    logger.info({ generator, traceId, alignmentIssues: issues }, "Running Anil CEO alignment revision pass");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    const parsed = parseJsonResponse(text);
    const revised = applyBrandComplianceToBrief({
      ...brief,
      headline: stripEmDash(String(parsed.headline || brief.headline)),
      executiveSummary: cleanParagraphArray(parsed.executiveSummary, articles, brief.executiveSummary, 1),
      body: cleanBriefBody(parsed.keyTakeaways, articles) || brief.body,
      keyTakeaways: cleanParagraphArray(parsed.strategicAssessment, articles, brief.keyTakeaways, 2),
      implificationsForLeaders: cleanBriefArray(parsed.implicationsForLeaders, articles, brief.implificationsForLeaders ?? []),
      rgiTake: cleanBriefText(parsed.rgiTake, articles, brief.rgiTake),
      topicTags: cleanTextArray(parsed.topicTags, brief.topicTags ?? ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: typeof parsed.discipline === "string" ? parsed.discipline : brief.discipline,
      relevancyScore: clampScore(parsed.relevancyScore, brief.relevancyScore ?? 8),
    });

    return revised as T;
  } catch (error) {
    logger.warn({ generator, traceId, error: summarizeProviderError(error), alignmentIssues: issues }, "Anil CEO alignment revision unavailable; using sanitized first pass");
    return brief;
  }
}

function briefFullText(brief: GeneratedBriefDraft): string {
  return [
    brief.headline,
    ...(brief.executiveSummary ?? []),
    brief.body,
    ...(brief.keyTakeaways ?? []),
    ...(brief.implificationsForLeaders ?? []),
    brief.rgiTake,
  ].join(" ");
}

function forbiddenBoundaryHits(text: string, boundary: ThesisBoundary): string[] {
  const hits = new Set<string>();
  for (const topic of boundary.forbiddenTopics) {
    const pattern = new RegExp(`\\b${escapeRegex(topic)}\\b`, "i");
    if (pattern.test(text)) hits.add(topic);
  }
  for (const pattern of boundary.forbiddenPatterns) {
    if (pattern.test(text)) hits.add(pattern.source);
  }
  return [...hits];
}

function isOffThesisText(text: string, boundary: ThesisBoundary): boolean {
  return forbiddenBoundaryHits(text, boundary).length > 0;
}

function removeOffThesisSentences(text: string, boundary: ThesisBoundary): string {
  const raw = String(text ?? "").trim();
  if (!raw) return raw;
  const parts = raw.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [raw];
  const kept = parts
    .map((part) => part.trim())
    .filter((part) => part && !isOffThesisText(part, boundary));
  return (kept.length ? kept : parts.map((part) => part.trim()).filter(Boolean))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeOffThesisItems(items: string[] | undefined, boundary: ThesisBoundary, minimum = 0): string[] {
  const current = items ?? [];
  const kept = current.filter((item) => !isOffThesisText(item, boundary));
  return kept.length >= minimum ? kept : current;
}

function deterministicCoherenceCleanup<T extends GeneratedBriefDraft>(brief: T, context: BriefCoherenceContext): T {
  const boundary = context.boundary;
  const cleaned = applyBrandComplianceToBrief({
    ...brief,
    executiveSummary: (brief.executiveSummary ?? []).map((item) => removeOffThesisSentences(item, boundary)),
    body: removeOffThesisItems(brief.body.split("\n").filter(Boolean), boundary, 3).join("\n"),
    keyTakeaways: removeOffThesisItems(brief.keyTakeaways ?? [], boundary, 1).map((item) => removeOffThesisSentences(item, boundary)),
    implificationsForLeaders: removeOffThesisItems(brief.implificationsForLeaders ?? [], boundary, 3).map((item) => removeOffThesisSentences(item, boundary)),
    rgiTake: removeOffThesisSentences(brief.rgiTake, boundary),
  });
  return cleaned as T;
}

function coherenceIssues(brief: GeneratedBriefDraft, context: BriefCoherenceContext): string[] {
  const issues: string[] = [];
  const boundary = context.boundary;
  const sections = [
    ["headline", brief.headline],
    ["the judgment issue", (brief.executiveSummary ?? []).join(" ")],
    ["the signal", brief.body],
    ["strategic foresight", (brief.keyTakeaways ?? []).join(" ")],
    ["what leaders may miss", (brief.implificationsForLeaders ?? []).join(" ")],
    ["rgi judgment", brief.rgiTake],
  ] as const;

  for (const [section, text] of sections) {
    const hits = forbiddenBoundaryHits(text, boundary);
    if (hits.length) issues.push(`${section} contains off-thesis material: ${hits.slice(0, 3).join(", ")}`);
  }

  const signalBullets = brief.body.split("\n").filter(Boolean);
  if (signalBullets.length < 3 || signalBullets.length > 4) {
    issues.push("The Signal must contain 3-4 thesis-bound bullets");
  }
  for (const bullet of signalBullets) {
    if (isOffThesisText(bullet, boundary)) {
      issues.push(`Off-thesis Signal bullet: ${bullet.slice(0, 140)}`);
    }
  }

  const fullText = briefFullText(brief);
  if (/\b(roundup|several things happened|unrelated|source set|coverage suggests|sources indicate|articles suggest)\b/i.test(fullText)) {
    issues.push("Brief still reads like a roundup or editorial process note");
  }
  if (!/\b(second-order|third-order|two moves|compound|structural|institutional|governance|legitimacy|accountability|assumption|consequence|exposure)\b/i.test((brief.keyTakeaways ?? []).join(" "))) {
    issues.push("Strategic Foresight does not carry the two-moves-out analysis");
  }
  if (!/\b(judgment|consequence|responsibility|restraint|verify|resist|own|legitimacy|accountability|trust)\b/i.test(brief.rgiTake ?? "")) {
    issues.push("RGI Judgment is too generic");
  }

  return [...new Set(issues)];
}

async function enforceBriefCoherence<T extends GeneratedBriefDraft>(
  brief: T,
  articles: Array<Record<string, unknown>>,
  context: BriefCoherenceContext | null,
  generator: "generateDigestArticle" | "generateDailyBrief",
  traceId?: string
): Promise<T> {
  if (!context || brief.generationMode === "fallback") return brief;

  const deterministicallyCleaned = deterministicCoherenceCleanup(brief, context);
  const firstIssues = coherenceIssues(deterministicallyCleaned, context);
  if (firstIssues.length === 0) return deterministicallyCleaned;

  const sourceSignals = articles
    .slice(0, 5)
    .map((article, index) => compactSource(article, index))
    .join("\n\n---\n\n");
  const currentBrief = JSON.stringify({
    headline: deterministicallyCleaned.headline,
    executiveSummary: deterministicallyCleaned.executiveSummary,
    keyTakeaways: deterministicallyCleaned.body.split("\n").filter(Boolean),
    strategicAssessment: deterministicallyCleaned.keyTakeaways,
    implicationsForLeaders: deterministicallyCleaned.implificationsForLeaders ?? [],
    rgiTake: deterministicallyCleaned.rgiTake,
    topicTags: deterministicallyCleaned.topicTags ?? [],
    discipline: deterministicallyCleaned.discipline ?? "Multiple",
    relevancyScore: deterministicallyCleaned.relevancyScore ?? 8,
  }, null, 2);

  const prompt = `The RGI brief failed the hard coherence validator.

Central thesis:
${context.clusterThesis}

Thesis boundary:
${boundaryToPrompt(context.boundary)}

Validator failures:
${firstIssues.map((issue) => `- ${issue}`).join("\n")}

Source disposition table:
${sourceDispositionsToPrompt(context.sourceDispositions)}

Revision instruction:
Remove every off-thesis sentence and source. Preserve only the articles and analysis that support the central RGI thesis. The brief must read as one coherent judgment essay, not a roundup. Do not introduce any topic outside the thesis boundary. The Brief Summary must support the same thesis. RGI Analysis must explain the second- and third-order consequences of that thesis only.

SOURCE SIGNALS ALLOWED:
${sourceSignals}

CURRENT BRIEF JSON:
${currentBrief}

Return ONLY valid JSON with exactly these fields:
{
  "headline": "string",
  "executiveSummary": ["single paragraph"],
	  "keyTakeaways": ["RGI Analysis paragraph 1", "RGI Analysis paragraph 2", "RGI Analysis paragraph 3"],
	  "strategicAssessment": ["RGI Analysis paragraph"],
	  "implicationsForLeaders": [],
	  "rgiTake": "final RGI Analysis paragraph",
  "topicTags": ["tag"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}`;

  try {
    logger.info({ generator, traceId, coherenceIssues: firstIssues, clusterName: context.clusterName }, "Running hard RGI coherence revision pass");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    const parsed = parseJsonResponse(text);
    const revised = applyBrandComplianceToBrief({
      ...deterministicallyCleaned,
      headline: stripEmDash(String(parsed.headline || deterministicallyCleaned.headline)),
      executiveSummary: cleanParagraphArray(parsed.executiveSummary, articles, deterministicallyCleaned.executiveSummary, 1),
      body: cleanBriefBody(parsed.keyTakeaways, articles) || deterministicallyCleaned.body,
      keyTakeaways: cleanParagraphArray(parsed.strategicAssessment, articles, deterministicallyCleaned.keyTakeaways, 2),
      implificationsForLeaders: cleanBriefArray(parsed.implicationsForLeaders, articles, deterministicallyCleaned.implificationsForLeaders ?? []),
      rgiTake: cleanBriefText(parsed.rgiTake, articles, deterministicallyCleaned.rgiTake),
      topicTags: cleanTextArray(parsed.topicTags, deterministicallyCleaned.topicTags ?? ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: typeof parsed.discipline === "string" ? parsed.discipline : deterministicallyCleaned.discipline,
      relevancyScore: clampScore(parsed.relevancyScore, deterministicallyCleaned.relevancyScore ?? 8),
    }) as T;
    const finalBrief = deterministicCoherenceCleanup(revised, context);
    const finalIssues = coherenceIssues(finalBrief, context);
    if (finalIssues.length) {
      logger.warn({ generator, traceId, finalIssues, clusterName: context.clusterName }, "Hard RGI coherence revision still had issues after cleanup");
    }
    return finalBrief;
  } catch (error) {
    logger.warn({ generator, traceId, error: summarizeProviderError(error), coherenceIssues: firstIssues }, "Hard RGI coherence revision unavailable; using deterministic cleanup");
    return deterministicallyCleaned;
  }
}

const HUMANIZATION_TEMPLATE_PATTERNS: Array<[RegExp, string]> = [
  [/\btwo moves out\b/i, "Visible internal prompt phrase: two moves out"],
  [/\bThe core decision problem is\b/i, "Template phrase: The core decision problem is"],
  [/\bThe discipline required is\b/i, "Template phrase: The discipline required is"],
  [/\bThis shift is not (?:a )?temporary\b/i, "Template phrase: This shift is not temporary"],
  [/\bLeaders who rely on legacy assumptions\b/i, "Template phrase: Leaders who rely on legacy assumptions"],
  [/\bstructural realignment\b/i, "Repeated abstraction: structural realignment"],
  [/\binstitutional vulnerabilities\b/i, "Repeated abstraction: institutional vulnerabilities"],
  [/\bstrategic posture\b/i, "Repeated abstraction: strategic posture"],
  [/\bcompounding effect\b/i, "Template phrase: compounding effect"],
  [/\bThe cost of inaction\b/i, "Template phrase: The cost of inaction"],
  [/\bdeeper consequence\b/i, "Template phrase: deeper consequence"],
  [/\bdeeper test\b/i, "Template phrase: deeper test"],
];

const HUMANIZATION_ABSTRACT_TERMS = [
  "institutional",
  "structural",
  "strategic",
  "risk",
  "volatility",
  "exposure",
  "resilience",
  "legitimacy",
  "governance",
  "consequence",
  "leaders",
  "assumptions",
  "stability",
];

function countTermOccurrences(text: string, term: string): number {
  return (text.match(new RegExp(`\\b${escapeRegex(term)}\\b`, "gi")) ?? []).length;
}

function editorialHumanizationIssues(brief: GeneratedBriefDraft): string[] {
  const text = briefFullText(brief);
  const issues = HUMANIZATION_TEMPLATE_PATTERNS
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);

  for (const term of HUMANIZATION_ABSTRACT_TERMS) {
    const count = countTermOccurrences(text, term);
    if (count >= 5) issues.push(`Overused abstract term: ${term} (${count} uses)`);
  }

  const rgiTake = brief.rgiTake ?? "";
  if (/^(The discipline required is|Institutional leaders must|RGI'?s judgment is)/i.test(rgiTake.trim())) {
    issues.push("RGI Judgment begins with a formulaic opening");
  }
  if (countWords(rgiTake) > 0 && !/\b(price|shipment|strike|board|capital|contract|insurance|supply|corridor|rate|policy|budget|deadline|deterrence|alliance|sanction|shipping|energy|oil|LNG|Hormuz|Gulf|Iran|Israel|Hezbollah|US)\b/i.test(rgiTake)) {
    issues.push("RGI Judgment lacks a concrete actor, constraint, or decision anchor");
  }

  return [...new Set(issues)];
}

function deterministicHumanStyleCleanup<T extends GeneratedBriefDraft>(brief: T): T {
  const cleanup = (value: string) => applyRgiBrandComplianceToText(String(value ?? "")
    .replace(/\bTwo moves out,?\s*/gi, "The next consequence ")
    .replace(/\btwo moves out\b/gi, "as the next consequences emerge")
    .replace(/\bThe core decision problem is\b/gi, "The practical question is")
    .replace(/\bThe discipline required is\b/gi, "The harder task is")
    .replace(/\bInstitutional leaders must\b/gi, "Executives and boards need to")
    .replace(/\bThis shift is not a temporary reaction but\b/gi, "The change is unlikely to remain a passing reaction; it is")
    .replace(/\bThis shift is not temporary\b/gi, "The change is unlikely to stay temporary")
    .replace(/\bLeaders who rely on legacy assumptions\b/gi, "Executives still planning around older assumptions")
    .replace(/\bstructural realignment\b/gi, "durable shift in incentives")
    .replace(/\binstitutional vulnerabilities\b/gi, "weak points in planning and oversight")
    .replace(/\bstrategic posture\b/gi, "position")
    .replace(/\brisk models\b/gi, "planning models")
    .replace(/\binstitutional weakness\b/gi, "weakness in oversight")
    .replace(/\bcompounding effect\b/gi, "knock-on effect")
    .replace(/\bThe cost of inaction\b/gi, "The price of waiting")
  ).text;

  return applyBrandComplianceToBrief({
    ...brief,
    headline: cleanup(brief.headline),
    executiveSummary: (brief.executiveSummary ?? []).map(cleanup),
    body: brief.body.split("\n").filter(Boolean).map(cleanup).join("\n"),
    keyTakeaways: (brief.keyTakeaways ?? []).map(cleanup),
    implificationsForLeaders: (brief.implificationsForLeaders ?? []).map(cleanup),
    rgiTake: cleanup(brief.rgiTake),
  }) as T;
}

async function humanizeBriefEditorially<T extends GeneratedBriefDraft>(
  brief: T,
  articles: Array<Record<string, unknown>>,
  context: BriefCoherenceContext | null,
  generator: "generateDigestArticle" | "generateDailyBrief",
  traceId?: string
): Promise<T> {
  if (brief.generationMode === "fallback") return deterministicHumanStyleCleanup(brief);

  const cleanedFirst = deterministicHumanStyleCleanup(brief);
  const issues = editorialHumanizationIssues(cleanedFirst);
  const sourceSignals = articles
    .slice(0, 5)
    .map((article, index) => compactSource(article, index))
    .join("\n\n---\n\n");
  const currentBrief = JSON.stringify({
    headline: cleanedFirst.headline,
    executiveSummary: cleanedFirst.executiveSummary,
    keyTakeaways: cleanedFirst.body.split("\n").filter(Boolean),
    strategicAssessment: cleanedFirst.keyTakeaways,
    implicationsForLeaders: cleanedFirst.implificationsForLeaders ?? [],
    rgiTake: cleanedFirst.rgiTake,
    topicTags: cleanedFirst.topicTags ?? [],
    discipline: cleanedFirst.discipline ?? "Multiple",
    relevancyScore: cleanedFirst.relevancyScore ?? 8,
  }, null, 2);

  const thesisBlock = context
    ? `Central thesis: ${context.clusterThesis}\nThesis boundary:\n${boundaryToPrompt(context.boundary)}`
    : "Central thesis: preserve the one thesis already present in the current brief.";

  const prompt = `Revise this RGI brief as a senior human editor.

Purpose:
Preserve the facts, thesis, section structure, one-page length, and RGI voice. Make the prose feel written by a serious human analyst, not assembled from RGI vocabulary.

${thesisBlock}

Detected style concerns:
${issues.length ? issues.map((issue) => `- ${issue}`).join("\n") : "- Reduce abstraction density and remove any mechanical phrasing that remains."}

Editorial instruction:
- Keep the five existing public sections represented by the JSON fields below.
- Preserve the one coherent thesis. Do not add a new theme.
- Preserve factual accuracy and source grounding.
- Reduce repetitive abstract language such as institutional, structural, strategic, risk, exposure, governance, consequence, assumptions, and stability.
- Replace template phrases with more natural prose.
- Do not use the public phrase "two moves out." Express that idea naturally.
- Add specificity where the source material supports it: actors, decisions, chokepoints, capital, insurance, shipping, policy, supply, boards, timelines, or concrete costs.
- Keep RGI judgment present throughout, but show judgment through concrete consequence rather than repeated brand vocabulary.
- Make RGI Judgment sound like a serious person making a defensible judgment. Avoid formulaic openings such as "The discipline required is" or "Institutional leaders must."
- No em dashes. No old labels. No new sections.

SOURCE MATERIAL:
${sourceSignals}

CURRENT BRIEF JSON:
${currentBrief}

Return ONLY valid JSON:
{
  "headline": "string",
  "executiveSummary": ["single paragraph"],
  "keyTakeaways": ["bullet 1", "bullet 2", "bullet 3"],
  "strategicAssessment": ["paragraph 1", "paragraph 2"],
  "implicationsForLeaders": ["bullet 1", "bullet 2", "bullet 3"],
  "rgiTake": "single paragraph",
  "topicTags": ["tag"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}`;

  try {
    logger.info({ generator, traceId, humanizationIssues: issues }, "Running final RGI human editorial pass");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2800,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    const parsed = parseJsonResponse(text);
    const revised = applyBrandComplianceToBrief({
      ...cleanedFirst,
      headline: stripEmDash(String(parsed.headline || cleanedFirst.headline)),
      executiveSummary: cleanParagraphArray(parsed.executiveSummary, articles, cleanedFirst.executiveSummary, 1),
      body: cleanBriefBody(parsed.keyTakeaways, articles) || cleanedFirst.body,
      keyTakeaways: cleanParagraphArray(parsed.strategicAssessment, articles, cleanedFirst.keyTakeaways, 2),
      implificationsForLeaders: cleanBriefArray(parsed.implicationsForLeaders, articles, cleanedFirst.implificationsForLeaders ?? []),
      rgiTake: cleanBriefText(parsed.rgiTake, articles, cleanedFirst.rgiTake),
      topicTags: cleanTextArray(parsed.topicTags, cleanedFirst.topicTags ?? ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: typeof parsed.discipline === "string" ? parsed.discipline : cleanedFirst.discipline,
      relevancyScore: clampScore(parsed.relevancyScore, cleanedFirst.relevancyScore ?? 8),
    }) as T;
    const finalBrief = deterministicHumanStyleCleanup(revised);
    return context ? deterministicCoherenceCleanup(finalBrief, context) : finalBrief;
  } catch (error) {
    logger.warn({ generator, traceId, error: summarizeProviderError(error), humanizationIssues: issues }, "Final RGI human editorial pass unavailable; using deterministic style cleanup");
    return context ? deterministicCoherenceCleanup(cleanedFirst, context) : cleanedFirst;
  }
}

function deterministicClassicalEssayShape<T extends GeneratedBriefDraft>(brief: T): T {
  const summary = cleanParagraphArray(
    brief.executiveSummary,
    [],
    [String(brief.executiveSummary?.[0] ?? "").trim()].filter(Boolean),
    1
  ).slice(0, 1);
  const essayParagraphs = [
    ...(brief.keyTakeaways ?? []),
    ...(brief.implificationsForLeaders ?? []),
    brief.rgiTake,
  ]
    .map((item) => stripEmDash(String(item ?? "").trim()))
    .filter(Boolean);

  const uniqueEssay = [...new Set(essayParagraphs)];
  const finalParagraph = uniqueEssay.length > 1 ? uniqueEssay[uniqueEssay.length - 1] : "";
  const bodyParagraphs = uniqueEssay.length > 1 ? uniqueEssay.slice(0, -1) : uniqueEssay;

  return {
    ...brief,
    executiveSummary: summary.length ? summary : brief.executiveSummary,
    body: "",
    keyTakeaways: bodyParagraphs,
    implificationsForLeaders: [],
    rgiTake: finalParagraph || brief.rgiTake,
  };
}

function firstSentences(value: string, maxSentences: number, maxWords: number): string {
  const clean = stripEmDash(String(value ?? "").trim());
  if (!clean) return "";
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const selected = (sentences.length ? sentences.slice(0, maxSentences).join(" ") : clean);
  const words = selected.split(/\s+/).filter(Boolean);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}.` : selected;
}

function enforceOnePageBriefBudget<T extends GeneratedBriefDraft>(brief: T): T {
  const summary = (brief.executiveSummary ?? [])
    .slice(0, 1)
    .map((paragraph) => firstSentences(paragraph, 2, 85))
    .filter(Boolean);
  const analysis = (brief.keyTakeaways ?? [])
    .map((paragraph) => firstSentences(paragraph, 3, 95))
    .filter(Boolean)
    .slice(0, 3);
  const closing = firstSentences(brief.rgiTake ?? "", 2, 75);
  const totalWords = [
    brief.headline,
    ...summary,
    ...analysis,
    closing,
  ].join(" ").split(/\s+/).filter(Boolean).length;

  if (totalWords <= 560) {
    return {
      ...brief,
      executiveSummary: summary.length ? summary : brief.executiveSummary,
      keyTakeaways: analysis.length ? analysis : brief.keyTakeaways,
      implificationsForLeaders: [],
      rgiTake: closing || brief.rgiTake,
      body: "",
    };
  }

  return {
    ...brief,
    executiveSummary: summary.map((paragraph) => firstSentences(paragraph, 1, 70)),
    keyTakeaways: analysis.slice(0, 3).map((paragraph) => firstSentences(paragraph, 2, 80)),
    implificationsForLeaders: [],
    rgiTake: firstSentences(closing, 1, 60),
    body: "",
  };
}

async function composeClassicalJudgmentEssay<T extends GeneratedBriefDraft>(
  brief: T,
  articles: Array<Record<string, unknown>>,
  context: BriefCoherenceContext | null,
  generator: "generateDigestArticle" | "generateDailyBrief",
  traceId?: string
): Promise<T> {
  if (brief.generationMode === "fallback") return deterministicClassicalEssayShape(brief);

  const sourceSignals = articles
    .slice(0, 5)
    .map((article, index) => compactSource(article, index))
    .join("\n\n---\n\n");
  const thesisBlock = context
    ? `Central thesis: ${context.clusterThesis}\nThesis boundary:\n${boundaryToPrompt(context.boundary)}`
    : "Central thesis: identify and preserve the single strongest RGI judgment thesis in the source material.";
  const currentBrief = JSON.stringify({
    headline: brief.headline,
    briefSummary: brief.executiveSummary,
    factualSignal: brief.body.split("\n").filter(Boolean),
    analysisParagraphs: brief.keyTakeaways,
    leaderImplications: brief.implificationsForLeaders ?? [],
    rgiJudgment: brief.rgiTake,
    topicTags: brief.topicTags ?? [],
    discipline: brief.discipline ?? "Multiple",
    relevancyScore: brief.relevancyScore ?? 8,
  }, null, 2);

  const prompt = `Convert this RGI brief into a one-page RGI strategic foresight essay.

The public-facing PDF is plain prose: a title followed by article paragraphs. No visible section labels, bullets, cards, headings, or report format.

The first paragraph may be descriptive. It should briefly explain what happened and why it matters. Everything after that must become strategic foresight with editorial authority, not continuing summary.

Do not write a news digest. Do not use bullets. Do not preserve the old five-section shape. The product is the second- and third-order analysis: what RGI believes this means, what comes next, what assumption is becoming dangerous, what risk is forming beneath the surface, and what leaders may miss.

${thesisBlock}

Essay requirements:
- One coherent story and one thesis.
- Headline: sharp, analytical, judgment-oriented. It should communicate the strategic thesis, not merely summarize the topic.
- Opening paragraph: 55-85 words, factual setup only.
- Analysis: 3-4 tight paragraphs, 300-430 words total.
- At least one analysis paragraph must explicitly state RGI's judgment using language such as "RGI's judgment is that..." or "RGI's view is that..."
- Include a clear forward-looking implication using language such as "The strategic implication is..." or "The forward-looking risk is..."
- Include a concrete blind spot using language such as "What leaders may miss is..."
- End with a concise bottom line using "RGI's bottom line:" and a decisive, forward-looking judgment.
- The brief must fit on one PDF page. If in doubt, compress. Cut repeated facts and secondary explanation before cutting the main judgment.
- Use source material as evidence, not as the structure.
- Do not write one paragraph per article.
- Do not use the public phrase "two moves out"; express the idea naturally.
- No em dashes. No bullets. No generic AI transitions. No consulting cliches.
- Preserve factual accuracy and source grounding.

SOURCE MATERIAL:
${sourceSignals}

CURRENT BRIEF:
${currentBrief}

Return ONLY valid JSON:
{
  "headline": "string",
  "briefSummary": "single opening paragraph, 55-85 words",
  "essayParagraphs": ["RGI judgment paragraph", "strategic foresight paragraph", "what leaders may miss paragraph", "RGI bottom line paragraph"],
  "topicTags": ["tag"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}`;

  try {
    logger.info({ generator, traceId }, "Running RGI classical essay composition pass");
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3200,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    const text = block.type === "text" ? block.text : "{}";
    const parsed = parseJsonResponse(text);
    const essayParagraphs = cleanParagraphArray(
      parsed.essayParagraphs,
      articles,
      [
        ...(brief.keyTakeaways ?? []),
        ...(brief.implificationsForLeaders ?? []),
        brief.rgiTake,
      ],
      6
    );
    const finalParagraph = essayParagraphs.length > 1 ? essayParagraphs[essayParagraphs.length - 1] : "";
    const shaped = applyBrandComplianceToBrief({
      ...brief,
      headline: stripEmDash(String(parsed.headline || brief.headline)),
      executiveSummary: cleanParagraphArray(parsed.briefSummary, articles, brief.executiveSummary, 1).slice(0, 1),
      body: "",
      keyTakeaways: essayParagraphs.length > 1 ? essayParagraphs.slice(0, -1) : essayParagraphs,
      implificationsForLeaders: [],
      rgiTake: finalParagraph || brief.rgiTake,
      topicTags: cleanTextArray(parsed.topicTags, brief.topicTags ?? ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: typeof parsed.discipline === "string" ? parsed.discipline : brief.discipline,
      relevancyScore: clampScore(parsed.relevancyScore, brief.relevancyScore ?? 8),
    }) as T;
	    return enforceOnePageBriefBudget(deterministicHumanStyleCleanup(shaped));
  } catch (error) {
    logger.warn({ generator, traceId, error: summarizeProviderError(error) }, "RGI classical essay composition unavailable; using deterministic essay shape");
    return enforceOnePageBriefBudget(deterministicClassicalEssayShape(brief));
  }
}

function fallbackTopicArticle(
  articles: Array<Record<string, unknown>>,
  editorNotes?: string | null
) {
  const primary = articles[0] ?? {};
  const topTags = dominantTags(articles);
  const coreTension = inferCoreTension(articles, topTags);
  const keyDevelopments = synthesizeKeyDevelopments(articles, coreTension, topTags);
  const strategicAnalysis = synthesizeStrategicAnalysis(coreTension, topTags);
  const implications = synthesizeImplications();
  const score = Math.max(6.8, Math.min(8.8, averageScore(articles)));
  const headlineTag = topicNoun(topTags[0] ?? "strategy").replace(/\b\w/g, (c) => c.toUpperCase());

  return enforceOnePageBriefBudget(applyBrandComplianceToBrief({
    headline: stripEmDash(`RGI Brief: ${headlineTag} Enters a Judgment Test`.slice(0, 180)),
    body: "",
    executiveSummary: [
      stripEmDash(`The immediate facts point to a practical judgment test: ${coreTension}. The event matters because it exposes how quickly governance credibility, capital discipline, and operating resilience can become linked. ${editorNotes?.trim() || "The useful question is not only what happened, but which assumptions become weaker once the headline fades."}`),
    ],
    rgiTake: `RGI's bottom line: the advantage will belong to leaders who identify the shift before it becomes consensus, keep commitments reversible where evidence is thin, and make clear which consequences the institution is prepared to own.`,
    keyTakeaways: stripEmDashArray([
      `RGI's judgment is that this is less a story about a single event than a warning that ${coreTension}. Leaders should not mistake motion for understanding; the first task is to decide which assumptions now require verification.`,
      `The strategic implication is that adjacent decisions will begin to move before consensus does. Capital plans, policy posture, supplier exposure, and executive communication can all become pressure points once institutions realize the old baseline no longer holds.`,
      `What leaders may miss is that waiting for full clarity can become its own decision. The forward-looking risk is that institutions preserve comfort today while allowing weaker assumptions to harden into tomorrow's liabilities.`,
      ...strategicAnalysis.slice(0, 1),
    ]),
    whatToWatch: [
      "Whether new reporting confirms the mechanism behind the current signal, not only the visible outcome.",
      "Whether adjacent institutions change behavior: pricing, policy language, capital plans, or public commitments.",
      "Whether source disagreement narrows or widens as more evidence becomes available.",
    ],
    whatMostAreMissing: null,
    mechanism: [`The mechanism is pattern convergence around ${topicNoun(topTags[0] ?? "strategy")}: multiple signals point to a decision environment changing faster than verification cycles.`],
    constraintsAndRisks: [
      "Evidence quality is uneven; editors should verify causal claims before publication.",
      "The strongest inference is pattern-level, not proof of a single settled outcome.",
    ],
    implificationsForLeaders: stripEmDashArray(implications),
    topicTags: topTags,
    discipline: dominantDiscipline(articles) || cleanSnippet(primary.disciplineAlignment, 80) || "Multiple",
    relevancyScore: score,
    generationMode: "fallback" as const,
    fallbackReason: "AI provider unavailable; source-backed editorial synthesis used.",
  }));
}

function fallbackDailyBrief(articles: Array<Record<string, unknown>>): DailyBriefResult {
  const topicTags = dominantTags(articles);
  const sourceArticleIds = articles.map((a) => Number(a.id)).filter((id) => Number.isFinite(id));
  const coreTension = inferCoreTension(articles, topicTags);
  const keyDevelopments = synthesizeKeyDevelopments(articles, coreTension, topicTags);
  const strategicAnalysis = synthesizeStrategicAnalysis(coreTension, topicTags);
  const implications = synthesizeImplications();
  const leadTopic = topicNoun(topicTags[0] ?? "strategy");
  return enforceOnePageBriefBudget(applyBrandComplianceToBrief({
    headline: `RGI Daily Brief: ${leadTopic.replace(/\b\w/g, (c) => c.toUpperCase())} Under Pressure`,
    executiveSummary: [
      `Today's visible developments point to one judgment problem: ${coreTension}. The facts matter because they expose the gap between information that creates urgency and evidence that justifies commitment. Leaders should treat this as a test of verification discipline, not a prompt to react to every signal.`,
    ],
    body: "",
    rgiTake: `RGI's bottom line: the strongest institutions will not be those that react first, but those that identify the pressure point early, preserve optionality, and assign ownership for the consequences before the risk becomes obvious.`,
    keyTakeaways: stripEmDashArray([
      `RGI's judgment is that this is less a demand for speed than a demand for disciplined interpretation. The visible facts create pressure, but the real test is whether leaders can separate urgent information from evidence that justifies commitment.`,
      `The strategic implication is that weak assumptions can become operational liabilities before public consensus catches up. Capital allocation, supply-chain posture, public positioning, and executive credibility become exposed when organizations move faster than their verification process.`,
      `What leaders may miss is that restraint is not inaction. The forward-looking risk is premature certainty: institutions that confuse information volume with decision quality may lock in commitments they cannot later unwind.`,
      ...strategicAnalysis.slice(0, 1),
    ]),
    implificationsForLeaders: [],
    whatChangedSinceYesterday: [],
    whatToWatch: [
      "Watch for actor behavior that confirms the signal: policy language, capital movement, operational changes, or public commitments.",
      "Track whether high-authority sources add new evidence or merely repeat the same narrative frame.",
      "Monitor contradictions between market reactions and institutional statements; that gap is often where decision risk accumulates.",
    ],
    summaryTakeaways: [
      `Core tension: ${coreTension}.`,
      `${sourceArticleIds.length} intelligence signal${sourceArticleIds.length === 1 ? "" : "s"} connected to this brief for editorial review.`,
    ],
    whatMostAreMissing: null,
    mechanism: [`Signals were ranked by relevance, credibility, recency, and topic convergence, then organized around the dominant decision tension.`],
    constraintsAndRisks: [
      "Editors should verify causal claims before publication.",
      "The evidence supports a strategic reading, but not every signal carries equal weight.",
    ],
    topicTags,
    discipline: dominantDiscipline(articles),
    relevancyScore: Math.max(7, Math.min(8.8, averageScore(articles))),
    sourceArticleIds,
    generationMode: "fallback",
    fallbackReason: "AI provider unavailable; source-backed editorial daily brief used.",
  }));
}

// Post-processing sanitizer: strip em dashes from all AI-generated text.
// " — " becomes ": " (clause separator); bare "—" becomes ", ".
function stripEmDash(text: string): string {
  return text.replace(/ — /g, ": ").replace(/—/g, ", ");
}
function stripEmDashArray(arr: string[]): string[] {
  return arr.map(stripEmDash);
}
function cleanTextArray(value: unknown, fallback: string[] = []): string[] {
  const items = Array.isArray(value) ? value : fallback;
  return stripEmDashArray(
    items
      .map((item) => cleanSnippet(item, 900))
      .filter((item) => item.length > 0)
  );
}

// ── Fixed length constraint ─────────────────────────────────────────────────
const FIXED_LENGTH_CONSTRAINTS = `ONE-PAGE PDF LIMIT: hard maximum 560 words.
The entire brief should normally be 420-540 words.
If the output is too long: cut repeated facts, secondary explanation, and weaker points before cutting the main judgment.
If the output is too short: add one concrete forward-looking implication, not more news recap.
Do not ignore this constraint.
Paragraph limits:
  - Opening factual setup: one compact paragraph, 55-85 words
  - Strategic foresight essay: 3-4 narrative paragraphs, 300-430 words total
Approximate balance: 15% factual setup, 85% RGI judgment and foresight.
If more than the first paragraph is primarily descriptive, revise it before returning JSON.
Before outputting, silently count your total words. If above 560 words, revise until you are under the one-page limit.`;

const RGI_SYSTEM_PROMPT = `${RGI_BRAND_VOICE_SYSTEM_PROMPT}

You are the senior intelligence editor for the Rick Goings Institute for Management and Executive Leadership (RGI) at Rollins College, a serious executive education institute built around one central idea: Where Leaders Learn Judgment.

	You are an analyst, not a summarizer. You transform raw information into clear, actionable intelligence. You never repeat what sources say. You interpret what it means. Every output must add insight that a reader cannot find by reading the sources themselves.

═══════════════════════════════════════════════════════
OFFICIAL RGI BRAND VOICE - HIGHEST AUTHORITY
═══════════════════════════════════════════════════════
RGI content is not written to inspire leaders, market a course, or produce generic analysis. Its job is to help accomplished leaders improve judgment when expertise, data, and technical tools are no longer enough.

Every generated article must reinforce this claim without turning it into a slogan: RGI is where leaders learn judgment.

The reader is an accomplished CEO, board member, investor, policymaker, enterprise leader, or next-generation family business leader. Write to the real pressure: irreversible decisions, incomplete information, institutional legitimacy, AI oversight, authority under scrutiny, and consequences that must be owned.

RGI helps leaders decide:
- what matters
- what can wait
- what must be resisted
- what can be delegated
- what must be verified
- what consequences must be owned

Use the six domains of judgment:
1. Priorities: what deserves attention and what does not.
2. Timing: when to act and when restraint is wiser than speed.
3. People: what character, motive, capability, and pressure reveal.
4. Institutions: how power moves, how organizations fail, and how trust is lost.
5. Technology: what to delegate to AI, what to verify, and what to resist.
6. Consequence: what decisions will cost, who bears the cost, and whether that cost is acceptable.

The RGI voice is serious without being pompous, practical without being shallow, intellectual without being decorative, and human without being sentimental. Think Foreign Affairs, The Economist, Harvard Business Review, McKinsey Quarterly, Peter Drucker, and Rick Goings in conversation: candid, worldly, direct, and free of wasted motion.

Start with the useful answer. Do not warm up. Do not announce what the piece will do. Do not open with generic change language or questions. The first two sentences must establish consequence.

Specificity beats polish. Use names, dates, numbers, sequence, costs, constraints, tradeoffs, decisions, and consequences when available. Match the weight of the language to the weight of the event. Do not make routine developments sound historic.

AI thesis: AI makes analysis faster, cheaper, and more abundant. That makes executive judgment more scarce, not less important. When writing about AI, evaluate what leaders should automate, what they should verify, what they should resist, and where human judgment must remain visible.

Preferred vocabulary: judgment, consequence, trust, responsibility, restraint, discernment, context, institutional legitimacy, executive accountability, strategic forbearance, AI fluency, institutional trust.

Avoid and do not output: transformational, game-changing, world-class, groundbreaking, cutting-edge, future-proof, leadership journey, thought leadership, disruption, ecosystem, unlock potential, elevate, supercharge, reimagine, robust, seamless, streamline, pivotal moment, unprecedented.

Never output assistant chatter or throat-clearing: "Let's dive in," "Let's explore," "It is important to note," "It is worth noting," "Certainly," "Of course," "Happy to help," "In today's rapidly changing world," or "Moving forward."

Before finalizing any article, silently ask:
- Is it accurate, clear, specific, and defensible?
- Would a serious executive actually say this?
- Did it remove manufactured importance, generic AI phrasing, consulting buzzwords, motivational language, filler, fake contrast, and decorative metaphor?
- Does it strengthen the idea: Where Leaders Learn Judgment?

═══════════════════════════════════════════════════════
THE RGI EXECUTIVE EDUCATION LENS
═══════════════════════════════════════════════════════
Every analysis must be shaped by RGI's core conviction: the most important skill in a period of accelerating change is not information processing — it is leadership judgment. The ability to reason under uncertainty, weigh competing obligations, and act with integrity when outcomes are unclear.

This shapes how RGI reads events:

1. LIBERAL ARTS AS ANALYTICAL DISCIPLINE: History, philosophy, ethics, and systems thinking are not decorative — they are the tools that prevent leaders from being captured by the immediate. A good brief connects today's event to long-run patterns, institutional health, and the kind of question a well-educated mind would ask before acting.

2. JUDGMENT OVER INFORMATION: Leaders today have too much information and too little framework for evaluating it. RGI analysis prioritizes insight that improves the quality of decisions, not just the quantity of data points. Ask: does this help a leader decide — or only inform?

3. ETHICAL AND CIVIC RESPONSIBILITY: Leaders operate within institutions that exist within societies. The RGI framework asks not only "what should we do?" but "what do we owe?" Civic stewardship is not a compliance function — it is a leadership discipline. Analysis must surface the civic and ethical dimensions of consequential decisions.

4. DECISION-MAKING UNDER UNCERTAINTY: Certainty is rare. RGI trains leaders to act despite incomplete information by understanding the structure of a situation — who bears risk, what assumptions are load-bearing, where the decision points actually lie. Analysis should clarify that structure, not manufacture false confidence.

5. AI AS AMPLIFIER, NOT REPLACEMENT: Artificial intelligence accelerates analysis, surfaces patterns, and reduces cognitive load. It does not replace human judgment, ethical reasoning, or the capacity to lead. RGI analysis names where AI changes the calculus for leaders — and where it does not.

6. GLOBAL EVENTS AND EXECUTIVE RESPONSIBILITY: Every significant global development — geopolitical, economic, technological, environmental — reshapes the environment in which leaders make decisions. RGI analysis connects events to the concrete obligations of executives, board members, and institutional leaders. The connection must be specific, not general.

═══════════════════════════════════════════════════════
RGI'S THREE CORE DISCIPLINES
═══════════════════════════════════════════════════════
1. Strategic Foresight: Anticipate change, read signals in the environment, and position organizations for futures not yet visible. Encompasses AI acceleration, geopolitical volatility, market transitions, weak signal detection, and pattern recognition across complex systems.

2. System Vitality: The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of pressure and renewal. Organizations as living systems driven by human energy, trust, purpose, and institutional health.

3. Civic Stewardship: The responsibility leaders bear to the communities and institutions that grant them legitimacy. Corporations as citizens with obligations beyond profit — to civic life, democratic institutions, and long-term community wellbeing.

═══════════════════════════════════════════════════════
THREE ANALYTICAL LENSES — apply to every output
═══════════════════════════════════════════════════════
These are not optional. Every piece of analysis must be filtered through all three:

	LENS 1, CAUSE AND EFFECT: Every development has a cause. Name it precisely. Do not describe what happened without explaining what produced it. Trace the chain: what decision, force, or failure set this in motion?

	LENS 2, SECOND-ORDER CONSEQUENCES: The first-order effect is what everyone can see. Your job is the second and third order. What does this force, constrain, or make inevitable next? What markets, institutions, supply chains, or leadership decisions get reconfigured as a result? Think two moves ahead, always.

	LENS 3, STRATEGIC RELEVANCE: Why does this matter for the humans making consequential decisions right now? Name the specific pressure it creates for executives, policymakers, or board members. If you cannot connect the development to a real decision a real leader must make, the analysis is incomplete.

═══════════════════════════════════════════════════════
MANDATORY REASONING PROCESS — silent pre-work before writing
═══════════════════════════════════════════════════════
Step through these questions before drafting a single word:

STEP 1 — CORE EVENT: What precisely happened? Strip the media narrative. What is the underlying fact, announcement, or decision — not how it was framed, but what actually occurred?

STEP 2 — UNDERLYING DRIVERS: What caused this? Apply cause-and-effect discipline:
  • Economic forces: incentive structures, capital flows, cost pressures, monetary policy
  • Geopolitical dynamics: power competition, alliance stress, sanctions, sovereignty claims
  • Technological change: capability shifts, adoption curves, regulatory responses
  • Institutional decisions: leadership choices, policy pivots, structural reforms
  Crucially: why now? What changed that made this the moment?

STEP 3 — SYSTEM IMPACT AND SECOND-ORDER EFFECTS: How does this propagate through interconnected systems?
  • Markets and capital allocation
  • Organizational decision-making and risk posture
  • Leadership priorities and institutional legitimacy
  • Global systems: supply chains, energy, governance, security
  Map what happens after the first-order effect. What does the second wave look like?

STEP 4 — FORWARD HORIZON: What specific signals, thresholds, or decision points will determine how this resolves in the next 72 hours and the next quarter? Name them. These become the "What to Watch" items.

STEP 5 — COHERENCE TEST: What is the one central thesis? Which facts directly support it? Which facts are interesting but off-thesis and should be excluded? Do not write until every included fact serves the same judgment problem.

═══════════════════════════════════════════════════════
RGI JUDGMENT PRINCIPLES — non-negotiable
═══════════════════════════════════════════════════════
1. LONG-TERM OVER SHORT-TERM: Headlines are raw material. Analysis must reveal what this means 2, 5, and 10 years from now. Short-term volatility is the noise; the structural shift is the signal.

2. SYSTEMS OVER ISOLATED EVENTS: Any single development is less important than the system it operates within. Explain the system. Name the structural force the event reveals or accelerates.

3. CHALLENGE SHALLOW NARRATIVES: When media framing is incomplete, oversimplified, agenda-driven, or emotionally charged — name it and correct it. Apply independent judgment. Do not reproduce conventional wisdom without interrogating it.

4. LEADERSHIP AND DECISION FOCUS: Every analysis must arrive at what this means for real people making consequential choices — executives, policymakers, board members, institutional leaders. What must they do differently as a result?

5. NO HYPE, NO EMOTIONAL FRAMING: Precise, measured language only. Avoid inflated language. Never sensationalize. Never catastrophize. State the facts and let the analysis carry the weight.

═══════════════════════════════════════════════════════
RGI STRATEGIC JUDGMENT ESSAY - MANDATORY PRODUCT DEFINITION
═══════════════════════════════════════════════════════
	Every brief is a one-page RGI strategic foresight essay built on timely news signals. The first paragraph is the factual entry point, not the product. RGI deliberately expands leaders beyond their usual information diet, but the product is the forward-looking judgment: what the development produces after the obvious headline, what risk is forming beneath the surface, what assumption is becoming dangerous, and where leaders will need judgment rather than more information.

The RGI judgment must shape the entire brief, not arrive only in the final paragraph. Do not write a neutral digest with an opinion attached. Write around one dominant judgment challenge and use the news facts as evidence for one RGI thesis.

For Daily Briefs, do not force together unrelated stories because they are recent or highly scored. Identify the strongest coherent pattern in the source material. Prefer three to five signals that support one strategic thesis over a broad roundup that produces a generic briefing. If the stories do not truly connect, focus on the strongest cluster and ignore the weaker off-thesis signals.

Every brief must answer:
1. What happened, briefly?
2. What is RGI's judgment?
3. What is the forward-looking strategic implication?
4. What may executives, policymakers, investors, or institutions miss?
5. What risk is forming before it becomes obvious?
6. What is RGI's bottom line?

The public PDF is a plain one-page article: title, then prose paragraphs. No visible section labels. The opening paragraph is the factual setup. Everything after that must become editorial and foresight-driven. Do not continue summarizing events. Do not write one paragraph per source. Do not save the RGI perspective for the final paragraph.

═══════════════════════════════════════════════════════
EDITORIAL STANDARDS
═══════════════════════════════════════════════════════
- INTERPRETATION RULE: After the first paragraph, never restate what sources say. State what it means. Your value is the inference, not the report.
- FORESIGHT RULE: Every brief must explicitly contain RGI's judgment, the strategic implication, what leaders may miss, and RGI's bottom line.
- ONE-PAGE RULE: Every brief must fit on one PDF page. When in doubt, compress. Cut weaker explanation and repeated facts before cutting the central judgment.
- SYNTHESIS RULE: Find the single thread connecting disparate signals — the structural force driving multiple developments simultaneously.
- DENSITY RULE: Every sentence must add new information or new analysis. No filler. No transitions that only restate the previous point.
- CONFLICT RULE: When sources disagree, surface the disagreement explicitly. Name the competing claims. Evaluate the evidence. Never flatten contradictions into false consensus.
- CREDIBILITY RULE: Higher-authenticity sources carry more analytical weight. When a major claim rests on weak or single-source reporting, say so.
- PRECISION RULE: No vague language. "Could have major implications" is not analysis. Name the mechanism. Name the actor. Name the timeline.
- FABRICATION RULE: All claims must trace to provided sources. Do not invent data, quotes, or events.
- STANDARD: Write at the level of Harvard Business Review or Foreign Affairs — analytical, rigorous, and worth reading twice.`;

const SYNTHESIS_PROMPT = `You are a senior strategic intelligence analyst at the Rick Goings Institute (RGI).

Your role is to produce high-impact intelligence briefs that reduce decision error for executives and investors.

The brief must reinforce RGI's central idea: Where Leaders Learn Judgment. Do this through substance, not slogans. The purpose is to help leaders decide what matters, what can wait, what deserves action, what deserves restraint, what must be verified, and what consequences they are prepared to own.

SOURCE MATERIAL:
{SOURCES}

EDITORIAL DIRECTION:
{NOTES}

---

# I. CORE RULE (NON-NEGOTIABLE)

Each brief must be built around ONE dominant insight.

- Not multiple themes
- Not a general overview
- Not a collection of risks

→ ONE idea that changes how the situation is understood

If more than one idea is present, you must remove the weaker ones.

For Topic Briefs, the selected article is the factual foundation, not the structure. Identify the judgment question the article raises, then build the brief around what a serious leader might otherwise miss.

---

# II. INSIGHT DEFINITION

Before writing, choose the SINGLE most important pressure point.
If multiple exist, rank them and focus only on the highest-impact one.
All other insights must support or derive from it.

Then explicitly determine:

1. What is the single most important hidden dynamic?
2. What assumption are others getting wrong?
3. What mechanism converts this into real-world consequences?

Then force the analysis to answer:

- What behavior does this insight FORCE from each actor?
- Why can those actors NOT behave differently?
- What outcome becomes structurally likely as a result?

If the answer is not clear, the mechanism is incomplete. Do not proceed until it is.

Then explicitly answer:

- Why is the market or consensus currently wrong?
- What behavioral or structural reason explains this mispricing?
- Why does this mispricing persist long enough to matter?

If this is missing, the insight is not actionable.

Then write one internal thesis sentence. It must be specific enough to organize the whole brief. Bad thesis: "markets, geopolitics, and technology are creating uncertainty." Good thesis: "AI governance is becoming a test of institutional judgment because adoption speed is exceeding boards' capacity to verify, resist, and own consequences."

---

# III. SIGNAL FILTER (STRICT)

Only include information that directly strengthens the core insight.

Remove:
- secondary geopolitical events unless they materially change the mechanism
- illustrative but non-essential examples
- background already known to informed readers

If a paragraph does not strengthen the insight, delete it.

---

# IV. OUTPUT STRUCTURE

## Title
Reflect the core insight directly. The title must be sharp, analytical, and judgment-oriented. It should communicate the strategic thesis, not merely summarize the topic.

## Opening paragraph
One compact factual paragraph, 55-85 words. Give the reader the necessary entry point: what happened, who is involved, and what changed. Do not analyze at length here. Do not begin with "recent developments," "this highlights," or any throat-clearing.

## RGI strategic foresight essay
Three to four tight narrative paragraphs, no bullets. This is the product. After the opening paragraph, stop summarizing and interpret the pattern. Clearly state RGI's judgment, the strategic implication, what leaders may miss, and a decisive RGI bottom line. Explain second-order consequences: what changes after the first visible effect, what institutions become exposed, what assumption weakens, what risk forms beneath the surface, and what executives should notice before the implication becomes obvious.

{LENGTH_CONSTRAINTS}

---

# V. ANALYTICAL DISCIPLINE

- Do not present inference as certainty
- Avoid dramatic phrasing unless supported
- Replace vague claims with clear causal logic
- Precision is more important than impact

---

# VI. STYLE

Direct and controlled. No performative language. No repetition. No unnecessary adjectives.
Do not use em dashes (the — character) anywhere in your output. Replace them with commas, colons, semicolons, or parentheses as appropriate.

---

# VII. FINAL CHECK (answer silently — if NO, revise before outputting)

- Is there exactly ONE core insight?
- Does every section reinforce it?
- Does every sentence in the essay support the same thesis?
- Is any low-signal information included? (remove it)
- Does everything after the first paragraph sound like strategic foresight, not continued news summary?
- Does the brief clearly state RGI's judgment?
- Does it name a forward-looking strategic implication?
- Does it include "What leaders may miss is..." or an equally direct blind-spot sentence?
- Does it end with "RGI's bottom line:" and a concise forward-looking judgment?
- Does the total word count fall within the selected mode's limit?
- Does the output fit on one PDF page?
- Does the article help leaders decide what matters, what can wait, what deserves action, what deserves restraint, what assumptions should be challenged, and what consequences must be owned?
- Are legacy takeaway, assessment, implication, editorial, watch-list, mechanism, and report-style headings absent?

---

OUTPUT FORMAT: return ONLY valid JSON, no markdown, no preamble.
ONLY these fields — do NOT add any others:
{
  "headline": "string: 8-12 words, sharp strategic thesis. No em dashes.",
  "executiveSummary": ["single compact opening paragraph, 55-85 words; factual setup only, no section label"],
  "keyTakeaways": [],
  "strategicAssessment": ["RGI judgment paragraph", "strategic foresight paragraph", "what leaders may miss paragraph"],
  "implicationsForLeaders": [],
  "rgiTake": "final paragraph beginning with RGI's bottom line:. It must be decisive, forward-looking, and specific. No em dashes.",
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1-3 only):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets", "Technology & AI",
"Innovation & Digital Transformation", "Business Strategy & Corporations", "Leadership & Organizations",
"Energy & Resources", "Supply Chains & Global Trade", "Policy, Regulation & Governance",
"Climate & Environmental Systems", "Future of Work & Society"

Return ONLY valid JSON. No markdown code blocks. No explanation before or after.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
Apply this throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Intelligence Brief: a premium geopolitical and institutional intelligence product for executives, investors, board members, and strategic decision-makers. It must read like a private advisory memo, not a media recap and not an explanation of how the brief was produced.

The brief must reinforce RGI's central idea: Where Leaders Learn Judgment. Do this through substance, not slogans. The purpose is to help leaders improve judgment under uncertainty, incomplete information, competing incentives, institutional pressure, technological change, and consequence.

{LENGTH_CONSTRAINTS}

Internal analyst inputs ({SOURCE_COUNT} article-derived signals across {THEME_COUNT} thematic areas):
{SOURCES}

{COMPOSITION_PLAN}

{PREVIOUS_BRIEF_SECTION}
═══════════════════════════════════════════════════════
INTERNAL REASONING (silent — do not output)
═══════════════════════════════════════════════════════
1. What is the real judgment challenge beneath today's visible facts?
2. What is the one central thesis that organizes the whole brief?
3. Why does each included source belong, and what off-thesis facts should be ignored?
4. What second- and third-order consequences are produced two moves out?
5. What institutional exposure, governance risk, or leadership accountability becomes visible?
6. What deserves action, what deserves restraint, what should be verified, and what consequences must be owned?
7. If yesterday's brief is provided: what materially changed? What reversed? What is new today that was absent?

RGI ANALYTICAL FRAMEWORK:
Apply priorities, timing, people, institutions, technology, and consequences. The brief should help leaders decide what matters, what can wait, what must be resisted, what can be delegated, what must be verified, and what costs they are prepared to own.

COHERENCE RULE:
The Daily Brief must be organized around one coherent pattern. Do not force unrelated stories together. If the source material contains multiple unrelated developments, select the strongest cluster that supports one strategic thesis and let weaker off-thesis signals fall away. The output should feel like "several timely signals point to one deeper judgment problem," not "here are several things that happened today."

NO SOURCE-REFERENCE RULE:
Publication names, outlet names, author names, and references to "sources," "source sets," "coverage," "reporting," "articles," or "synthesis" must NOT appear in Brief Summary or RGI Analysis. These sections must speak directly about the strategic reality, actor behavior, institutional consequences, and leadership decisions.

═══════════════════════════════════════════════════════
	STRICT FORMAT - PLAIN ONE-PAGE ARTICLE (length is set by the mode above)
═══════════════════════════════════════════════════════

HEADLINE: 8-12 words maximum. Sharp, analytical, and judgment-oriented. Communicate the strategic thesis, not merely the topic. Avoid neutral news headlines. Use a colon when it sharpens the consequence. Do not use em dashes.

OPENING PARAGRAPH: One compact factual setup paragraph, 55-85 words. State what happened, who is involved, and what changed. This is only the entry point. Do not turn it into the product. Do not mention publications, sources, article sets, coverage, reporting, or the synthesis process. Never begin with generic change language.

STRATEGIC FORESIGHT ESSAY: Three to four narrative paragraphs, not bullets. This is the product. After the first paragraph, do not continue summarizing events. Clearly state RGI's judgment, the strategic implication, what leaders may miss, and RGI's bottom line. The analysis must explain second-order consequences: what changes after the visible headline, who is exposed, what pressure point is likely to emerge, what assumption is becoming dangerous, and what executives should prepare for next.

Required phrases or equivalents:
✓ "RGI's judgment is that..." or "RGI's view is that..."
✓ "The strategic implication is..." or "The forward-looking risk is..."
✓ "What leaders may miss is..."
✓ "RGI's bottom line:"

FORBIDDEN — do NOT generate any of the following:
✗ What Most Are Missing
✗ Mechanism
✗ Constraints and Risks
✗ What Changed Since Yesterday
✗ What to Watch Next
✗ The Signal, Strategic Foresight, What Leaders May Miss, RGI Judgment, Brief Summary, RGI Analysis, or any visible section labels
✗ Generic development, implication, or watch-list headings
✗ Publication names or attribution outside a dedicated Sources section
✗ Phrases such as "source set," "coverage suggests," "sources indicate," "the brief synthesizes," "across Bloomberg/CFR/NYT," or any explanation of editorial process
✗ Assistant chatter, motivational phrasing, fake contrast, decorative metaphor, or consulting-firm buzzwords

ABSOLUTE RULES:
✗ No em dashes (the — character) anywhere in output. Use commas, colons, semicolons, or parentheses instead.
✗ No repetition across sections
✗ No vague language: name the actor, decision, timeline
✗ No generic phrases: "significant implications," "remains to be seen," "could have major impact"
✗ No banned RGI language: transformational, game-changing, world-class, groundbreaking, cutting-edge, future-proof, thought leadership, disruption, ecosystem, unlock potential, elevate, supercharge, reimagine, robust, seamless, streamline, pivotal moment, unprecedented
✗ No fabrication: all claims trace to provided sources
✓ Surface source conflicts explicitly
✓ Every sentence adds new information or analysis
✓ Total word count: stay within the one-page mode limit. Condense ruthlessly if over.

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
ONLY these fields — do NOT add any others:
{
  "headline": "string: 8 to 12 words, sharp strategic thesis, scannable in 3 seconds. No em dashes.",
  "executiveSummary": ["single opening factual setup paragraph, 55-85 words, no section label and no source/publication/process references"],
  "keyTakeaways": [],
  "strategicAssessment": ["RGI judgment paragraph", "strategic implication paragraph", "what leaders may miss paragraph"],
  "implicationsForLeaders": [],
  "rgiTake": "final paragraph beginning with RGI's bottom line:. Strategic, decisive, forward-looking, and specific. Do not include a section label. No source/publication/process references. No em dashes.",
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1–3 only):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets", "Technology & AI",
"Innovation & Digital Transformation", "Business Strategy & Corporations", "Leadership & Organizations",
"Energy & Resources", "Supply Chains & Global Trade", "Policy, Regulation & Governance",
"Climate & Environmental Systems", "Future of Work & Society"

Return ONLY valid JSON. No markdown code blocks. No explanation before or after.`;

export async function generateDigestArticle(
  articleIds: number[],
  editorNotes?: string | null
): Promise<{
  headline: string;
  body: string;
  executiveSummary: string[];
  rgiTake: string;
  keyTakeaways: string[];
  whatToWatch: string[];
  whatMostAreMissing?: string | null;
  mechanism?: string[];
  constraintsAndRisks?: string[];
  implificationsForLeaders?: string[];
  topicTags: string[];
  discipline: string;
  relevancyScore: number;
  fromCache: boolean;
  generationMode?: "ai" | "fallback";
  fallbackReason?: string;
}> {
  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = topicArticleCacheKey(articleIds, editorNotes);
  const cached = topicArticleCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAt < TOPIC_CACHE_TTL_MS) {
    logger.info({ cacheKey }, "Returning cached topic article");
    return { ...cached.result, fromCache: true };
  }

  let articles = (await Promise.all(articleIds.map((id) => getFirestoreArticle(id))))
    .filter((article): article is Article => Boolean(article));

  if (articles.length === 0) {
    throw new Error("No articles found with provided IDs");
  }

  // Cap to 7 highest-scoring articles to keep prompt tight and generation fast
  articles = [...articles]
    .sort((a, b) => b.relevancyScore - a.relevancyScore)
    .slice(0, 7);

  logger.info(
    {
      generator: "generateDigestArticle",
      sourceArticleIds: articles.map((a) => a.id),
      selectedCount: articles.length,
      hasEditorNotes: Boolean(editorNotes?.trim()),
      cacheReused: false,
    },
    "Starting strategic brief generation"
  );

  const sourcesText = articles
    .map((a, i) => compactSource(a as unknown as Record<string, unknown>, i))
    .join("\n\n---\n\n");

  const topicCoherenceContext = coherenceContextForArticles(articles);
  const topicCoherenceNotes = topicCoherenceContext
    ? `\n\nTOPIC BRIEF COHERENCE BOUNDARY (hard):\nCentral thesis: ${topicCoherenceContext.clusterThesis}\n${boundaryToPrompt(topicCoherenceContext.boundary)}\nEvery section must stay inside this boundary. Remove or ignore any off-thesis fact, even if it is interesting.`
    : "";
  const notesText = editorNotes?.trim()
    ? editorNotes.trim()
    : "No specific editorial direction — apply your best analytical judgment to identify the most important pattern across the provided sources.";
  const prompt = SYNTHESIS_PROMPT
    .replace("{SOURCES}", sourcesText)
    .replace("{NOTES}", `${notesText}${topicCoherenceNotes}`)
    .replace("{LENGTH_CONSTRAINTS}", FIXED_LENGTH_CONSTRAINTS);

  let text = "{}";
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    text = block.type === "text" ? block.text : "{}";
  } catch (e) {
    logger.warn(
      {
        error: summarizeProviderError(e),
        generator: "generateDigestArticle",
        sourceArticleIds: articles.map((a) => a.id),
        fallbackUsed: true,
      },
      "AI article generation unavailable; using fallback synthesis"
    );
    const result = fallbackTopicArticle(articles as unknown as Array<Record<string, unknown>>, editorNotes);
    return { ...result, fromCache: false };
  }

  try {
	    const parsed = parseJsonResponse(text);
    const rawResult = {
      headline: stripEmDash(parsed.headline || "Untitled Brief"),
      body: cleanBriefBody(parsed.keyTakeaways ?? parsed.keyDevelopments ?? parsed.body, articles as unknown as Array<Record<string, unknown>>),
      executiveSummary: cleanParagraphArray(parsed.executiveSummary, articles as unknown as Array<Record<string, unknown>>, ["The judgment challenge is to decide whether the visible development is a temporary event or a signal that institutional assumptions are weakening. Leaders should focus less on the headline and more on what it produces two moves out: exposed commitments, weaker planning assumptions, and consequences that may compound quietly before the public narrative catches up."], 1),
      rgiTake: cleanBriefText(parsed.rgiTake, articles as unknown as Array<Record<string, unknown>>, "RGI's judgment is that leaders must decide what deserves action, what requires restraint, what must be verified, and what consequences they are prepared to own."),
      keyTakeaways: cleanParagraphArray(
        parsed.strategicAssessment ?? parsed.strategicAnalysis ?? parsed.whyItMatters,
        articles as unknown as Array<Record<string, unknown>>,
        synthesizeStrategicAnalysis(inferCoreTension(articles as unknown as Array<Record<string, unknown>>, dominantTags(articles as unknown as Array<Record<string, unknown>>)), dominantTags(articles as unknown as Array<Record<string, unknown>>)),
        2
      ),
      whatToWatch: cleanBriefArray(parsed.whatToWatch, articles as unknown as Array<Record<string, unknown>>, ["Watch for concrete actor decisions, policy movement, capital flows, and operational changes that confirm whether the signal is becoming structural."]),
      whatMostAreMissing: typeof parsed.whatMostAreMissing === "string" ? stripEmDash(parsed.whatMostAreMissing) : null,
      mechanism: cleanTextArray(parsed.mechanism),
      constraintsAndRisks: cleanTextArray(parsed.constraintsAndRisks),
      implificationsForLeaders: cleanBriefArray(parsed.implicationsForLeaders ?? parsed.executiveImplications ?? parsed.implificationsForLeaders, articles as unknown as Array<Record<string, unknown>>, ["Name the uncertainty, assign ownership for validation, and avoid treating volume of information as certainty."]),
      topicTags: cleanTextArray(parsed.topicTags, ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: parsed.discipline || "Multiple",
      relevancyScore: clampScore(parsed.relevancyScore, 7),
      generationMode: "ai" as const,
    };
	    const sanitized = applyBrandComplianceToBrief(rawResult);
	    const aligned = await reviseForAnilAlignment(sanitized, articles as unknown as Array<Record<string, unknown>>, "generateDigestArticle");
	    const coherent = await enforceBriefCoherence(aligned, articles as unknown as Array<Record<string, unknown>>, topicCoherenceContext, "generateDigestArticle");
	    const humanized = await humanizeBriefEditorially(coherent, articles as unknown as Array<Record<string, unknown>>, topicCoherenceContext, "generateDigestArticle");
	    const result = await composeClassicalJudgmentEssay(humanized, articles as unknown as Array<Record<string, unknown>>, topicCoherenceContext, "generateDigestArticle");

    // Store in cache (only when no editorNotes — editorial direction makes each unique)
    if (!editorNotes?.trim()) {
      topicArticleCache.set(cacheKey, { result, generatedAt: Date.now() });
    }

    logger.info(
      {
        generator: "generateDigestArticle",
        fallbackUsed: false,
        headline: result.headline,
        sourceArticleIds: articles.map((a) => a.id),
        keyDevelopmentLines: result.body.split("\n").filter(Boolean).length,
        rgiEditorialChars: result.rgiTake.length,
        brandCompliance: result.brandCompliance,
      },
      "Strategic brief generated and sanitized"
    );

    return { ...result, fromCache: false };
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse AI article response");
    throw new Error("Failed to parse AI-generated article");
  }
}

const REFINE_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI). An article has been drafted and the editor has requested specific changes. Apply the instruction precisely and completely — it overrides all other considerations.

CURRENT ARTICLE:
Headline: {HEADLINE}

The Judgment Issue:
{EXEC_SUMMARY}

The Signal:
{BODY}

Strategic Foresight:
{KEY_TAKEAWAYS}

RGI Judgment:
{RGI_TAKE}

What to Watch:
{WHAT_TO_WATCH}

EDITOR'S REFINEMENT INSTRUCTION:
{INSTRUCTION}

Rewrite the article following the editor's instruction exactly. While applying the instruction, maintain the full RGI analytical framework:
- Every sentence must state what something means, not just what happened (no source repetition)
- Cause and effect must be named explicitly
- Second- and third-order consequences belong in Strategic Foresight
- RGI Judgment must provide a distinctive institutional interpretation and one concrete leadership discipline
- Total article: preserve the five-section paragraph, bullets, paragraph, bullets, paragraph sequence
- Preserve the official RGI voice: serious, specific, restrained, practical, and centered on judgment.
- Remove motivational language, consulting buzzwords, assistant chatter, generic change language, and manufactured importance.
- The revised article should help leaders decide what matters, what can wait, what deserves action, what deserves restraint, what must be verified, and what consequences must be owned.

Return ONLY a valid JSON object with these fields:
- headline: string (update if instruction requires — must be a declarative causal sentence)
- executiveSummary: string array with one paragraph for The Judgment Issue
- keyTakeaways: string array with 3-5 bullets for The Signal
- strategicAssessment: string array with one or two paragraphs for Strategic Foresight
- implicationsForLeaders: string array with 3-5 bullets for What Leaders May Miss
- rgiTake: string with one paragraph for RGI Judgment
- whatToWatch: string array (may be empty)

Return ONLY valid JSON. No explanation, no markdown code blocks.`;

const NEWSLETTER_DIGEST_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI) writing a weekly newsletter digest for subscribers interested in {TOPICS}.

Below are this week's top published RGI strategic briefs relevant to those topics:

{ARTICLES}

Write a concise weekly digest email that:
1. Opens with a brief introduction that starts with the useful answer and names the week's most important judgment challenge
2. For each article, writes 2-3 sentences capturing the key insight, consequence, and decision relevance
3. Closes with a short "RGI Judgment" paragraph naming what leaders should notice that others may overlook

Requirements:
- Tone: serious, specific, restrained, and editorial, not promotional or inspirational
- No emojis, no excessive enthusiasm
- No assistant chatter, generic change language, motivational phrasing, or consulting buzzwords
- The digest must reinforce RGI's central idea: Where Leaders Learn Judgment
- Target 400-600 words total
- All content must trace to the provided articles

Return ONLY a valid JSON object:
- headline: string (one declarative sentence summarizing the week's strategic theme)
- body: string (the full newsletter text as described — clean prose with article references)
- topicTags: string array (the topics this digest covers)

Return ONLY valid JSON.`;

export async function refineArticle(
  articleId: number,
  instruction: string
): Promise<{
  headline: string;
  body: string;
  executiveSummary: string[];
  rgiTake: string;
  keyTakeaways: string[];
  whatToWatch: string[];
}> {
  const article = await getFirestoreDigest(articleId);

  if (!article) {
    throw new Error("Article not found");
  }

  const prompt = REFINE_PROMPT
    .replace("{HEADLINE}", article.headline)
    .replace("{EXEC_SUMMARY}", (article.executiveSummary || []).join("\n"))
    .replace("{BODY}", article.body)
    .replace("{KEY_TAKEAWAYS}", (article.keyTakeaways || []).join("\n"))
    .replace("{RGI_TAKE}", article.rgiTake || "")
    .replace("{WHAT_TO_WATCH}", ((article as Record<string, unknown>).whatToWatch as string[] || []).join("\n"))
    .replace("{INSTRUCTION}", instruction.trim());

  let text = "{}";
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    text = block.type === "text" ? block.text : "{}";
  } catch (err) {
    logger.warn({ error: summarizeProviderError(err), articleId }, "AI refinement unavailable; preserving article with editor instruction");
    const fallbackRefined = applyBrandComplianceToBrief({
      headline: article.headline,
      body: article.body,
      executiveSummary: article.executiveSummary || [],
      rgiTake: `${article.rgiTake || "RGI notes this article remains in review."}\n\nFallback refinement note: ${instruction.trim()}`,
      keyTakeaways: article.keyTakeaways || [],
      whatToWatch: ((article as Record<string, unknown>).whatToWatch as string[] || []),
    });
    await updateFirestoreDigest(articleId, fallbackRefined);
    return fallbackRefined;
  }

  try {
	    const parsed = parseJsonResponse(text);

    const rawRefined = {
      headline: parsed.headline || article.headline,
      body: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways.join("\n") : (Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments.join("\n") : (parsed.body || article.body)),
      executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : (article.executiveSummary || []),
      rgiTake: parsed.rgiTake || article.rgiTake,
      keyTakeaways: Array.isArray(parsed.strategicAssessment) ? parsed.strategicAssessment : (Array.isArray(parsed.strategicAnalysis) ? parsed.strategicAnalysis : (Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : article.keyTakeaways)),
      implificationsForLeaders: Array.isArray(parsed.implicationsForLeaders) ? parsed.implicationsForLeaders : (Array.isArray(parsed.executiveImplications) ? parsed.executiveImplications : ((article as Record<string, unknown>).implificationsForLeaders as string[] || [])),
      whatToWatch: Array.isArray(parsed.whatToWatch) ? parsed.whatToWatch : ((article as Record<string, unknown>).whatToWatch as string[] || []),
    };
    const refined = applyBrandComplianceToBrief(rawRefined);

    await updateFirestoreDigest(articleId, refined);

    return refined;
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse refined article response");
    throw new Error("Failed to parse refined article");
  }
}

export async function regenerateSelectionText(options: {
  selectedText: string;
  field: "body" | "rgiTake";
  instructions: string;
  article: { headline: string; body: string; rgiTake: string };
}): Promise<{ regeneratedText: string }> {
  const { selectedText, field, instructions, article } = options;
  const fieldLabel = field === "rgiTake" ? "RGI Analysis closing" : "RGI Analysis";

  const prompt = `You are line-editing a specific passage within a published RGI intelligence article.

ARTICLE HEADLINE: ${article.headline}

FULL ARTICLE BODY (for context — do not rewrite the surrounding content):
${article.body}

RGI ANALYSIS CLOSING (for context):
${article.rgiTake || "None"}

FIELD BEING EDITED: ${fieldLabel}

SELECTED PASSAGE TO REWRITE:
"${selectedText}"

EDITOR INSTRUCTION: ${instructions}

Rules:
- Rewrite ONLY the selected passage above, nothing outside of it.
- Maintain the RGI editorial voice: precise, analytical, no hype, no emotional language.
- Ensure the rewritten passage integrates cleanly with the surrounding text.
- Match the approximate length of the original unless the instruction explicitly requires otherwise.
- Remove assistant chatter, generic change language, motivational phrasing, and consulting buzzwords.
- Preserve the RGI focus on judgment, consequence, responsibility, trust, restraint, and institutional legitimacy.
- Return ONLY the rewritten passage — no preamble, no explanation, no surrounding context.

Return ONLY a JSON object with no markdown code fences:
{"regeneratedText": "the rewritten passage only"}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";
  const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");

  try {
    const parsed = JSON.parse(cleanText);
    if (!parsed.regeneratedText || typeof parsed.regeneratedText !== "string") {
      throw new Error("Missing regeneratedText in response");
    }
    return { regeneratedText: applyRgiBrandComplianceToText(parsed.regeneratedText).text };
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse selection regeneration response");
    throw new Error("Failed to parse AI response");
  }
}

export async function generateNewsletterDigest(
  topics: string[],
  weekOf: string
): Promise<{
  headline: string;
  body: string;
  topicTags: string[];
  subscriberCount: number;
}> {
  const allApproved = await listFirestoreDigests({ status: "approved", limit: 40 });

  const matching = topics.length > 0
    ? allApproved.filter((a) => a.topicTags.some((t) => topics.includes(t)))
    : allApproved;

  const forDigest = matching.slice(0, 12);

  if (forDigest.length === 0) {
    throw new Error("No approved articles found for the selected topics");
  }

  const articlesText = forDigest
    .map((a, i) =>
      `BRIEF ${i + 1}:\nHeadline: ${a.headline}\nDiscipline: ${a.discipline || "—"}\nTopics: ${a.topicTags.join(", ")}\nThe Signal: ${a.body.slice(0, 800)}\nRGI Judgment: ${a.rgiTake?.slice(0, 300) || "—"}`
    )
    .join("\n\n---\n\n");

  const prompt = NEWSLETTER_DIGEST_PROMPT
    .replace("{TOPICS}", topics.length > 0 ? topics.join(", ") : "all topics")
    .replace("{ARTICLES}", articlesText);

  let text = "{}";
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });
    const block = message.content[0];
    text = block.type === "text" ? block.text : "{}";
  } catch (e) {
    logger.warn({ error: summarizeProviderError(e) }, "AI newsletter digest generation unavailable; using fallback digest");
    return {
      headline: "RGI Weekly Intelligence Digest",
      body: forDigest.map((article) => `${article.headline}\n${article.body}`).join("\n\n"),
      topicTags: topics,
      subscriberCount: 0,
    };
  }

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const subscribers = await listFirestoreNewsletterSubscribers(true);

    const relevantCount = topics.length > 0
      ? subscribers.filter((s) => s.topics.some((t) => topics.includes(t))).length
      : subscribers.length;

    return {
      headline: applyRgiBrandComplianceToText(parsed.headline || "RGI Weekly Intelligence Digest").text,
      body: applyRgiBrandComplianceToText(parsed.body || "").text,
      topicTags: parsed.topicTags || topics,
      subscriberCount: relevantCount,
    };
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse newsletter digest response");
    throw new Error("Failed to generate newsletter digest");
  }
}

export async function generateDailyBrief(
  articleIds?: number[],
  editorNotes?: string | null,
  excludedTopics?: string[],
  previousBriefContext?: string | null,
  options?: { requestId?: string | null }
): Promise<DailyBriefResult> {
  // Development/testing mode: Daily Brief generation intentionally never reads
  // from or writes to an in-memory cache. Every API request reaches this
  // function and builds a fresh prompt against current article data.
  const traceId = options?.requestId || `daily-${Date.now()}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  logger.info(
    { traceId, generator: "generateDailyBrief", promptFile: "artifacts/api-server/src/lib/ai-writer.ts", cacheReused: false, dbContentReused: false },
    "[daily-brief-trace] Starting fresh Daily Brief generation"
  );
  console.log(`[daily-brief-trace:${traceId}] prompt file: artifacts/api-server/src/lib/ai-writer.ts`);
  console.log(`[daily-brief-trace:${traceId}] generator function: generateDailyBrief`);
  console.log(`[daily-brief-trace:${traceId}] cached DB content reused: false`);

  let articles;
  let compositionPlan = "";
  let coherenceContext: BriefCoherenceContext | null = null;

  if (articleIds && articleIds.length > 0) {
    articles = (await listFirestoreArticles({ limit: 500 })).filter((article) => articleIds.includes(article.id));
    // Cap to top 7 by score
    articles = [...articles].sort((a, b) => b.relevancyScore - a.relevancyScore).slice(0, 7);
    const topicCluster = selectCoherentArticleCluster(articles, Math.min(5, articles.length || 5));
    coherenceContext = coherenceContextFromSelection(topicCluster) ?? coherenceContextForArticles(articles);
    if (topicCluster.clusterThesis) {
      compositionPlan = compositionPlanFromSelection(topicCluster, articles);
    }
  } else {
    let allArticles = await listFirestoreArticles({ limit: 500, sortBy: "time" });
    let selected = chooseDailyBriefArticles(allArticles, today, excludedTopics);
    if (selected.articles.length === 0) {
      logger.warn({ traceId, availableArticles: allArticles.length }, "[daily-brief-trace] No usable articles found; running one recovery scrape before failing");
      console.log(`[daily-brief-trace:${traceId}] no usable articles found; running recovery scrape`);
      await runScrape({ ignoreSourceCache: true });
      allArticles = await listFirestoreArticles({ limit: 500, sortBy: "time" });
      selected = chooseDailyBriefArticles(allArticles, today, excludedTopics);
    }
    articles = selected.articles;
    coherenceContext = coherenceContextFromSelection(selected);
    compositionPlan = compositionPlanFromSelection(selected, articles);
    logger.info(
      {
        traceId,
        selectionMode: selected.selectionMode,
        clusterName: selected.clusterName,
        clusterThesis: selected.clusterThesis,
        excludedArticleIds: selected.excludedArticleIds,
        availableArticles: allArticles.length,
        selectedArticleIds: articles.map((article) => article.id),
        selectedScores: articles.map((article) => article.relevancyScore),
      },
      "[daily-brief-trace] Daily Brief article selection complete"
    );
    console.log(`[daily-brief-trace:${traceId}] article selection mode: ${selected.selectionMode}`);
  }

  if (articles.length === 0) {
    throw new Error("No qualifying articles found for the brief. Add active sources or run a scrape, then try again.");
  }

  // Group articles by topic to understand theme count
  const topicSet = new Set<string>();
  for (const a of articles) {
    for (const t of a.topicTags) topicSet.add(t);
  }

  const sourcesText = articles
    .map((a, i) => compactSource(a as unknown as Record<string, unknown>, i))
    .join("\n\n---\n\n");

  const editorialSuffix = editorNotes?.trim()
    ? DAILY_BRIEF_EDITORIAL_SUFFIX.replace("{NOTES}", editorNotes.trim())
    : "";

  const previousBriefSection = previousBriefContext
    ? `═══════════════════════════════════════════════════════\nYESTERDAY'S BRIEF (for "What Changed Since Yesterday" comparison)\n═══════════════════════════════════════════════════════\n${previousBriefContext}\n\n`
    : "";

  const prompt = (DAILY_BRIEF_PROMPT + editorialSuffix)
    .replace("{SOURCE_COUNT}", String(articles.length))
    .replace("{THEME_COUNT}", String(topicSet.size))
    .replace("{SOURCES}", sourcesText)
    .replace("{COMPOSITION_PLAN}", compositionPlan)
    .replace("{PREVIOUS_BRIEF_SECTION}", previousBriefSection)
    .replace("{LENGTH_CONSTRAINTS}", FIXED_LENGTH_CONSTRAINTS);

  let text = "{}";
  try {
    logger.info(
      { traceId, prompt: "DAILY_BRIEF_PROMPT", sourceArticleIds: articles.map((a) => a.id), fallbackUsed: false },
      "[daily-brief-trace] Sending Daily Brief prompt to AI provider"
    );
    console.log(`[daily-brief-trace:${traceId}] prompt constant: DAILY_BRIEF_PROMPT`);
    console.log(`[daily-brief-trace:${traceId}] source of The Judgment Issue: AI JSON executiveSummary via generateDailyBrief`);
    console.log(`[daily-brief-trace:${traceId}] source of The Signal: AI JSON keyTakeaways -> digest.body`);
    console.log(`[daily-brief-trace:${traceId}] source of RGI Judgment: AI JSON rgiTake`);
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: RGI_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    text = block.type === "text" ? block.text : "{}";
  } catch (e) {
    logger.warn(
      { traceId, error: summarizeProviderError(e), fallbackUsed: true, fallbackFunction: "fallbackDailyBrief" },
      "[daily-brief-trace] AI daily brief generation unavailable; using fallback synthesis"
    );
    console.log(`[daily-brief-trace:${traceId}] fallback generation used: true`);
    console.log(`[daily-brief-trace:${traceId}] source of The Judgment Issue: fallbackDailyBrief.executiveSummary`);
    console.log(`[daily-brief-trace:${traceId}] source of The Signal: fallbackDailyBrief.body from synthesizeKeyDevelopments`);
    console.log(`[daily-brief-trace:${traceId}] source of RGI Judgment: fallbackDailyBrief.rgiTake`);
    return fallbackDailyBrief(articles as unknown as Array<Record<string, unknown>>);
  }

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const rawResult: DailyBriefResult = {
      headline: stripEmDash(parsed.headline || "RGI Daily Strategic Intelligence Brief"),
      executiveSummary: cleanParagraphArray(parsed.executiveSummary, articles as unknown as Array<Record<string, unknown>>, [
        "The judgment challenge is to decide whether today's visible developments are temporary noise or evidence that institutional assumptions are becoming weaker. Leaders should focus less on the headline and more on what the signal produces two moves out: exposed commitments, governance pressure, and consequences that may compound quietly before consensus catches up.",
      ], 1),
      body: cleanBriefBody(parsed.keyTakeaways ?? parsed.keyDevelopments ?? parsed.body, articles as unknown as Array<Record<string, unknown>>),
      rgiTake: cleanBriefText(parsed.rgiTake, articles as unknown as Array<Record<string, unknown>>, "RGI's judgment is that leaders must decide what deserves action, what requires restraint, what must be verified, and what consequences they are prepared to own."),
      keyTakeaways: cleanParagraphArray(
        parsed.strategicAssessment ?? parsed.strategicAnalysis ?? parsed.whyItMatters,
        articles as unknown as Array<Record<string, unknown>>,
        synthesizeStrategicAnalysis(inferCoreTension(articles as unknown as Array<Record<string, unknown>>, dominantTags(articles as unknown as Array<Record<string, unknown>>)), dominantTags(articles as unknown as Array<Record<string, unknown>>)),
        2
      ),
      implificationsForLeaders: cleanBriefArray(parsed.implicationsForLeaders ?? parsed.executiveImplications ?? parsed.implificationsForLeaders, articles as unknown as Array<Record<string, unknown>>, ["Set decision thresholds, preserve optionality, and assign ownership for the assumptions that would justify irreversible action."]),
      whatMostAreMissing: typeof parsed.whatMostAreMissing === "string" ? stripEmDash(parsed.whatMostAreMissing) : null,
      mechanism: cleanTextArray(parsed.mechanism),
      constraintsAndRisks: cleanTextArray(parsed.constraintsAndRisks),
      whatChangedSinceYesterday: cleanTextArray(parsed.whatChangedSinceYesterday),
      whatToWatch: cleanBriefArray(parsed.whatToWatch, articles as unknown as Array<Record<string, unknown>>, ["Watch for concrete actor decisions, policy movement, capital flows, and operational changes that confirm whether the signal is becoming structural."]),
      summaryTakeaways: cleanTextArray(parsed.summaryTakeaways),
      topicTags: cleanTextArray(parsed.topicTags, ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: parsed.discipline || "Multiple",
      relevancyScore: clampScore(parsed.relevancyScore, 8),
      sourceArticleIds: articles.map((a) => a.id),
      generationMode: "ai",
    };
	    const sanitized = applyBrandComplianceToBrief(rawResult);
	    const aligned = await reviseForAnilAlignment(sanitized, articles as unknown as Array<Record<string, unknown>>, "generateDailyBrief", traceId);
	    const coherent = await enforceBriefCoherence(aligned, articles as unknown as Array<Record<string, unknown>>, coherenceContext, "generateDailyBrief", traceId);
		    const humanized = await humanizeBriefEditorially(coherent, articles as unknown as Array<Record<string, unknown>>, coherenceContext, "generateDailyBrief", traceId);
		    const result = await composeClassicalJudgmentEssay(humanized, articles as unknown as Array<Record<string, unknown>>, coherenceContext, "generateDailyBrief", traceId);

    logger.info(
      {
        traceId,
        fallbackUsed: false,
        executiveSummaryItems: result.executiveSummary.length,
        keyDevelopmentLines: result.body.split("\n").filter(Boolean).length,
        rgiEditorialChars: result.rgiTake.length,
        brandCompliance: result.brandCompliance,
      },
      "[daily-brief-trace] Fresh Daily Brief generated and sanitized"
    );
    console.log(`[daily-brief-trace:${traceId}] fallback generation used: false`);

    return result;
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse daily brief response");
    throw new Error("Failed to parse AI-generated daily brief");
  }
}
