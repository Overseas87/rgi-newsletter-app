import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import {
  createFirestoreArticle,
  getFirestoreArticleByUrl,
  latestFirestoreScrapedAt,
  listFirestoreArticles,
  listActiveFirestoreSources,
  updateFirestoreArticle,
} from "./firestore-data";
import { updateFirestoreSourceHealth } from "./firestore-sources";
import { RGI_PROFILE, recommendedUseForScores, type RgiRecommendedUse } from "./rgi-relevance";

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

type LowScoreRejectedArticle = {
  headline: string;
  source: string;
  url: string;
  relevancyScore: number;
  scoreBreakdown: StrategicScoreBreakdown;
  reason: string;
  scoreExplanation: string;
};

type ScrapeExampleArticle = {
  headline: string;
  source: string;
  url: string;
  relevancyScore: number;
  recommendedUse?: RgiRecommendedUse | null;
  reason: string;
};

type ArticleDispositionOutcome =
  | "saved"
  | "duplicate"
  | "already_exists"
  | "low_relevance"
  | "validation_failure"
  | "rejected_by_recommendation_logic"
  | "rejected_by_insertion_threshold"
  | "write_failure"
  | "other";

type ArticleDispositionRecord = {
  headline: string;
  source: string;
  url: string;
  score: number;
  recommendation: RgiRecommendedUse | null;
  rejectionReason: string | null;
  insertionDecision: string;
  outcome: ArticleDispositionOutcome;
  writeAttempted: boolean;
  writeSucceeded: boolean;
};

type AcceptedArticleOutcomeCounts = {
  saved: number;
  duplicate: number;
  alreadyExistsInFirestore: number;
  lowRelevance: number;
  validationFailure: number;
  rejectedByRecommendationLogic: number;
  rejectedByInsertionThreshold: number;
  writeFailure: number;
  other: number;
  total: number;
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
  articlesAlreadyExisting: number;
  totalFetched: number;
  rejectedTooOld: number;
  rejectedLowRelevance: number;
  acceptedForFeed: number;
  acceptedForDashboard: number;
  acceptedForDailyBrief: number;
  needsReview: number;
  duplicatesSkipped: number;
  malformedSkipped: number;
  lowScoreSkipped: number;
  lowScoreRejectedArticles: LowScoreRejectedArticle[];
  topAcceptedArticles: ScrapeExampleArticle[];
  topRejectedArticles: ScrapeExampleArticle[];
  acceptedArticleOutcomes: AcceptedArticleOutcomeCounts;
  firestoreWriteAttempts: number;
  firestoreWriteSuccesses: number;
  firestoreWriteFailures: number;
  topAcceptedButNotSaved: ArticleDispositionRecord[];
  articleDispositions: ArticleDispositionRecord[];
  feedResults: ScrapeFeedResult[];
};

type ValidScrapedItem = ScrapedItem & {
  headline: string;
  url: string;
  normalizedUrl: string;
  titleFingerprint: string;
  content: string;
};

function emptyAcceptedArticleOutcomes(): AcceptedArticleOutcomeCounts {
  return {
    saved: 0,
    duplicate: 0,
    alreadyExistsInFirestore: 0,
    lowRelevance: 0,
    validationFailure: 0,
    rejectedByRecommendationLogic: 0,
    rejectedByInsertionThreshold: 0,
    writeFailure: 0,
    other: 0,
    total: 0,
  };
}

function countAcceptedArticleOutcomes(records: ArticleDispositionRecord[]): AcceptedArticleOutcomeCounts {
  const counts = emptyAcceptedArticleOutcomes();

  for (const record of records) {
    counts.total++;
    if (record.outcome === "saved") counts.saved++;
    else if (record.outcome === "duplicate") counts.duplicate++;
    else if (record.outcome === "already_exists") counts.alreadyExistsInFirestore++;
    else if (record.outcome === "low_relevance") counts.lowRelevance++;
    else if (record.outcome === "validation_failure") counts.validationFailure++;
    else if (record.outcome === "rejected_by_recommendation_logic") counts.rejectedByRecommendationLogic++;
    else if (record.outcome === "rejected_by_insertion_threshold") counts.rejectedByInsertionThreshold++;
    else if (record.outcome === "write_failure") counts.writeFailure++;
    else counts.other++;
  }

  return counts;
}

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

const RGI_RELEVANCY_PROMPT = `You are the RGI Strategic Intelligence Analyst for the Rick Goings Institute. Your job is not to count keywords. Your job is to judge whether an article contains strategic intelligence that would matter to executives, investors, board members, policymakers, institutional leaders, and geopolitical strategists.

RGI analytical doctrine:
- Strategic Foresight: geopolitical volatility, strategic competition, macro shocks, technology acceleration, weak signals, long-range pattern recognition.
- System Vitality: business resilience, leadership effectiveness, institutional trust, organizational adaptation, capital allocation, operational resilience.
- Civic Stewardship: governance, legitimacy, regulation, democratic institutions, public-private responsibility, societal stability.

Use this true 1-10 relevance scale:
1-3 = irrelevant or mostly noise for RGI
4-5 = potentially relevant but limited strategic consequence
6-7 = important development leaders should monitor
8-9 = highly important strategic intelligence with executive, geopolitical, institutional, or market implications
10 = major strategic development with system-level consequences

Important calibration:
- A Bloomberg, Reuters, FT, WSJ, CFR, Foreign Policy, BBC, Economist, or similar article about sanctions, conflict, commodities, central banks, strategic competition, AI infrastructure, supply chains, market stress, institutional legitimacy, regulation, or governance should often score 7-9 when the development has executive implications.
- Do not compress important strategic articles into 3-5 simply because only a few keywords appear.
- A niche article can score high if it reveals a meaningful strategic signal.
- Source authority supports confidence, but the final score must reflect strategic consequence, not brand name alone.

Evaluate the article through these RGI dimensions on a 1-10 scale:
- sourceAuthority
- geopoliticalImpact
- macroeconomicSignificance
- securityConflictRelevance
- supplyChainImportance
- technologyStrategicRelevance
- energyCommoditiesImportance
- financialMarketImpact
- governanceConsequence
- institutionalRisk
- leadershipRelevance
- secondOrderEffects
- marketCapitalAllocationImpact
- decisionMakerUrgency
- rgiDoctrineAlignment
- narrativeShiftPotential
- longTermStrategicConsequences
- rgiPriorityAlignment

Then provide:
- finalRelevanceScore: the final RGI analyst score, 1-10, calibrated to the scale above.
- isRelevantToRgi: whether this contains genuine RGI strategic signal.
- recommendedUse: one of "reject", "feed", "dashboard", "daily_brief", "needs_review".
- urgencyLevel: one of "low", "medium", "high", "critical".
- confidence: 0-1.
- scoreExplanation: one concise sentence explaining the strategic reason for the score.
- authenticityScore: 1-10.
- viewpoint: 2 concise sentences in RGI voice explaining the institutional/executive implication.

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
- finalRelevanceScore: number 1-10
- isRelevantToRgi: boolean
- recommendedUse: "reject" | "feed" | "dashboard" | "daily_brief" | "needs_review"
- urgencyLevel: "low" | "medium" | "high" | "critical"
- confidence: number 0-1
- sourceAuthority: number 1-10
- geopoliticalImpact: number 1-10
- macroeconomicSignificance: number 1-10
- securityConflictRelevance: number 1-10
- supplyChainImportance: number 1-10
- technologyStrategicRelevance: number 1-10
- energyCommoditiesImportance: number 1-10
- financialMarketImpact: number 1-10
- governanceConsequence: number 1-10
- institutionalRisk: number 1-10
- leadershipRelevance: number 1-10
- secondOrderEffects: number 1-10
- marketCapitalAllocationImpact: number 1-10
- decisionMakerUrgency: number 1-10
- rgiDoctrineAlignment: number 1-10
- narrativeShiftPotential: number 1-10
- longTermStrategicConsequences: number 1-10
- rgiPriorityAlignment: number 1-10
- scoreExplanation: string
- authenticityScore: number 1-10
- viewpoint: string
- topicTags: string array (1-3 tags from the list below)
- teaserSummary: string — 1-2 sentence factual summary of the article's core claim
- disciplineAlignment: string — one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", "Multiple"
- isPrimarySignal: boolean

No explanation, no markdown, no preamble. ONLY the JSON object.

Article:
Title: {TITLE}
Source: {SOURCE}
Content: {CONTENT}`;

type StrategicScoreBreakdown = {
  sourceAuthority: number;
  geopoliticalImpact: number;
  macroeconomicSignificance: number;
  securityConflictRelevance: number;
  supplyChainImportance: number;
  technologyStrategicRelevance: number;
  energyCommoditiesImportance: number;
  financialMarketImpact: number;
  governanceConsequence: number;
  institutionalRisk: number;
  leadershipRelevance: number;
  secondOrderEffects: number;
  marketCapitalAllocationImpact: number;
  decisionMakerUrgency: number;
  rgiDoctrineAlignment: number;
  narrativeShiftPotential: number;
  longTermStrategicConsequences: number;
  rgiPriorityAlignment: number;
  sourceWeight: number;
  aiAnalystScore?: number;
  aiConfidence?: number;
};

export const ARTICLE_INSERTION_SCORE_THRESHOLD = 4.0;
export const DASHBOARD_SIGNAL_SCORE_THRESHOLD = 5.5;
export const BRIEF_CANDIDATE_SCORE_THRESHOLD = 7.0;
const ARTICLE_SCORING_TIMEOUT_MS = Number(process.env.RGI_ARTICLE_SCORING_TIMEOUT_MS ?? 8000);

const RGI_FACTOR_WEIGHTS = {
  sourceAuthority: 0.08,
  geopoliticalImpact: 0.12,
  macroeconomicSignificance: 0.1,
  securityConflictRelevance: 0.08,
  supplyChainImportance: 0.08,
  technologyStrategicRelevance: 0.08,
  energyCommoditiesImportance: 0.07,
  financialMarketImpact: 0.08,
  governanceConsequence: 0.09,
  institutionalRisk: 0.09,
  leadershipRelevance: 0.07,
  secondOrderEffects: 0.09,
  marketCapitalAllocationImpact: 0.07,
  decisionMakerUrgency: 0.07,
  rgiDoctrineAlignment: 0.1,
  narrativeShiftPotential: 0.07,
  longTermStrategicConsequences: 0.09,
  rgiPriorityAlignment: 0.07,
} satisfies Partial<Record<keyof StrategicScoreBreakdown, number>>;

const RGI_STRATEGIC_PATTERNS: Array<{ key: keyof Omit<StrategicScoreBreakdown, "sourceAuthority" | "sourceWeight" | "aiAnalystScore" | "aiConfidence">; patterns: RegExp[] }> = [
  { key: "geopoliticalImpact", patterns: [/china|russia|iran|israel|ukraine|taiwan|nato|gaza|sanction|diplomacy|geopolitic|tariff|trade war|great power|european union|opec|hormuz|strait|quad|xi|trump|south korea|north korea|japan|europe/] },
  { key: "macroeconomicSignificance", patterns: [/inflation|recession|gdp|growth|central bank|ecb|fed|rate|yield|labor market|employment|currency|currencies|dollar|won|yen|euro|deficit|debt|productivity|inventory|demand|supply|export|exports/] },
  { key: "securityConflictRelevance", patterns: [/war|military|missile|defense|security|ceasefire|terror|attack|cyberattack|army|navy|air force|weapons|conflict|border/] },
  { key: "supplyChainImportance", patterns: [/supply chain|inventory|shipping|logistics|port|freight|container|semiconductor|manufacturing|export|exports|import|imports|critical minerals|rare earth|hormuz|strait|chokepoint|tanker/] },
  { key: "technologyStrategicRelevance", patterns: [/\bai\b|ai-fueled|artificial intelligence|chip|semiconductor|quantum|automation|robotics|data center|compute|cyber|software|model|openai|anthropic|deepseek|agi/] },
  { key: "energyCommoditiesImportance", patterns: [/energy|oil|gas|lng|nuclear|grid|electricity|power|renewable|solar|wind|commodity|commodities|copper|lithium|uranium|hormuz|tanker|metals/] },
  { key: "financialMarketImpact", patterns: [/market|markets|stock|stocks|bond|bonds|equity|credit|bank|investor|capital|earnings|valuation|ipo|shares|wall street|liquidity|default|loan|currency|currencies|won|yen|euro/] },
  { key: "governanceConsequence", patterns: [/governance|regulat|policy|law|court|congress|parliament|ministry|central bank|election|oversight|compliance|accountability|legitimacy/] },
  { key: "institutionalRisk", patterns: [/institution|trust|credibility|legitimacy|stability|resilience|fragility|crisis|corruption|protest|social unrest|public confidence|systemic/] },
  { key: "leadershipRelevance", patterns: [/leadership|executive|ceo|board|management|strategy|decision|reputation|public position|stakeholder|organization|talent|culture/] },
  { key: "secondOrderEffects", patterns: [/ripple|spillover|second.order|cascade|contagion|downstream|knock.on|chain reaction|repercussion|longer.term|unintended/] },
  { key: "marketCapitalAllocationImpact", patterns: [/capital allocation|investment|investor|valuation|earnings|margin|cost of capital|private equity|venture capital|asset|portfolio|liquidity/] },
  { key: "decisionMakerUrgency", patterns: [/urgent|deadline|imminent|now|today|this week|vote|summit|decision|approval|ban|strike|deadline|emergency|warning|warns|war impact|shock|strain/] },
  { key: "rgiDoctrineAlignment", patterns: [/foresight|system vitality|civic stewardship|strategic|leadership|governance|institution|disruption|ai acceleration|geopolitical volatility|continuous disruption/] },
  { key: "narrativeShiftPotential", patterns: [/shift|pivot|warning|signals?|trend|breakthrough|collapse|surge|historic|unprecedented|reshap|rethink|turning point|accelerat|slowdown/] },
  { key: "longTermStrategicConsequences", patterns: [/long.term|structural|strategy|strategic|governance|regulation|policy|institution|industrial policy|demographic|resilience|legitimacy|transition/] },
  { key: "rgiPriorityAlignment", patterns: [/leadership|governance|strategy|institution|system|civic|stewardship|foresight|vitality|board|executive|ceo|organization|trust/] },
];

function clamp(value: number, min = 0, max = 10): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function sourceAuthorityScore(sourceTier: number, authorityLevel: number, sourceWeight: number): number {
  const tierBase = sourceTier <= 1 ? 8.8 : sourceTier === 2 ? 7 : sourceTier === 3 ? 5.2 : 3.5;
  const authority = Number.isFinite(authorityLevel) ? authorityLevel : 5;
  return round1(clamp(tierBase * 0.55 + authority * 0.45 + (clamp(sourceWeight, 0.5, 2) - 1) * 1.1));
}

function patternScore(text: string, patterns: RegExp[]): number {
  const hits = patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
  if (hits <= 0) return 1.5;
  if (hits === 1) return 6.4;
  if (hits === 2) return 7.6;
  return clamp(8.4 + Math.min(1.4, (hits - 3) * 0.35));
}

function buildStrategicScoreBreakdown(input: {
  headline: string;
  content: string;
  sourceName: string;
  sourceTier: number;
  authorityLevel: number;
  sourceWeight: number;
  ai?: Partial<Omit<StrategicScoreBreakdown, "sourceWeight">>;
}): StrategicScoreBreakdown {
  const haystack = `${input.headline} ${input.content} ${input.sourceName}`.toLowerCase();
  const factors: StrategicScoreBreakdown = {
    sourceAuthority: sourceAuthorityScore(input.sourceTier, input.authorityLevel, input.sourceWeight),
    geopoliticalImpact: 1.5,
    macroeconomicSignificance: 1.5,
    securityConflictRelevance: 1.5,
    supplyChainImportance: 1.5,
    technologyStrategicRelevance: 1.5,
    energyCommoditiesImportance: 1.5,
    financialMarketImpact: 1.5,
    governanceConsequence: 1.5,
    institutionalRisk: 1.5,
    leadershipRelevance: 1.5,
    secondOrderEffects: 1.5,
    marketCapitalAllocationImpact: 1.5,
    decisionMakerUrgency: 1.5,
    rgiDoctrineAlignment: 1.5,
    narrativeShiftPotential: 1.5,
    longTermStrategicConsequences: 1.5,
    rgiPriorityAlignment: 1.5,
    sourceWeight: clamp(input.sourceWeight, 0.5, 2),
  };

  for (const factor of RGI_STRATEGIC_PATTERNS) {
    factors[factor.key] = round1(patternScore(haystack, factor.patterns));
  }

  if (input.ai) {
    for (const key of Object.keys(factors) as Array<keyof StrategicScoreBreakdown>) {
      if (key === "sourceWeight") continue;
      const aiValue = input.ai[key];
      if (typeof aiValue === "number" && Number.isFinite(aiValue)) {
        factors[key] = round1(clamp(Number(factors[key] ?? 1.5) * 0.25 + clamp(aiValue) * 0.75));
      }
    }
  }

  return factors;
}

function finalStrategicRelevanceScore(breakdown: StrategicScoreBreakdown): number {
  const weightedTotal = Object.entries(RGI_FACTOR_WEIGHTS).reduce((sum, [key, weight]) => {
    return sum + Number(breakdown[key as keyof StrategicScoreBreakdown] ?? 0) * Number(weight);
  }, 0);
  const weightTotal = Object.values(RGI_FACTOR_WEIGHTS).reduce((sum, weight) => sum + Number(weight), 0);
  const weighted = weightTotal > 0 ? weightedTotal / weightTotal : 1;
  const strategicSignals = [
    breakdown.geopoliticalImpact,
    breakdown.macroeconomicSignificance,
    breakdown.securityConflictRelevance,
    breakdown.supplyChainImportance,
    breakdown.technologyStrategicRelevance,
    breakdown.energyCommoditiesImportance,
    breakdown.financialMarketImpact,
    breakdown.governanceConsequence,
    breakdown.institutionalRisk,
    breakdown.secondOrderEffects,
    breakdown.marketCapitalAllocationImpact,
  ];
  const strongestSignal = Math.max(...strategicSignals);
  const topStrategicAverage = [...strategicSignals].sort((a, b) => b - a).slice(0, 4).reduce((sum, score) => sum + score, 0) / 4;
  const executiveLens = Math.max(
    breakdown.leadershipRelevance,
    breakdown.governanceConsequence,
    breakdown.institutionalRisk,
    breakdown.decisionMakerUrgency,
    breakdown.rgiDoctrineAlignment,
    breakdown.longTermStrategicConsequences,
  );
  const crossDomainCount = strategicSignals.filter((score) => score >= 6.5).length;
  const convergenceBonus = Math.min(0.8, Math.max(0, crossDomainCount - 1) * 0.18);
  const rgiDoctrineBonus = breakdown.rgiDoctrineAlignment >= 7 && executiveLens >= 6.5 ? 0.35 : 0;
  const eliteSourceSignalBonus = breakdown.sourceAuthority >= 8.5 && strongestSignal >= 6.4 ? 0.55 : 0;
  const aiAnalystScore = typeof breakdown.aiAnalystScore === "number" ? clamp(breakdown.aiAnalystScore) : null;
  const majorStrategicDomains = [
    breakdown.geopoliticalImpact,
    breakdown.macroeconomicSignificance,
    breakdown.securityConflictRelevance,
    breakdown.supplyChainImportance,
    breakdown.technologyStrategicRelevance,
    breakdown.energyCommoditiesImportance,
    breakdown.financialMarketImpact,
    breakdown.governanceConsequence,
    breakdown.institutionalRisk,
  ];
  const majorDomainCount = majorStrategicDomains.filter((score) => score >= 6.4).length;
  const strategicFloor = breakdown.sourceAuthority >= 8.5 && majorDomainCount >= 3
    ? 7.2
    : breakdown.sourceAuthority >= 8.5 && majorDomainCount >= 2
      ? 6.8
      : breakdown.sourceAuthority >= 8.5 && strongestSignal >= 6.4
        ? 6.2
        : 1;
  const modelBlend = aiAnalystScore === null
    ? weighted * 0.25 + topStrategicAverage * 0.27 + strongestSignal * 0.2 + executiveLens * 0.13 + breakdown.sourceAuthority * 0.15
    : aiAnalystScore * 0.82 + weighted * 0.08 + topStrategicAverage * 0.04 + executiveLens * 0.03 + breakdown.sourceAuthority * 0.03;
  const lowAuthorityPenalty = breakdown.sourceAuthority < 4.5 && strongestSignal < 8 ? -0.7 : 0;
  return round1(clamp(Math.max(modelBlend + convergenceBonus + rgiDoctrineBonus + eliteSourceSignalBonus + lowAuthorityPenalty, strategicFloor), 1, 10));
}

function topStrategicDrivers(breakdown: StrategicScoreBreakdown): string[] {
  const labels: Partial<Record<keyof StrategicScoreBreakdown, string>> = {
    sourceAuthority: "source authority",
    geopoliticalImpact: "geopolitical impact",
    macroeconomicSignificance: "macroeconomic significance",
    securityConflictRelevance: "security/conflict relevance",
    supplyChainImportance: "supply-chain importance",
    technologyStrategicRelevance: "AI/technology strategic relevance",
    energyCommoditiesImportance: "energy/commodities importance",
    financialMarketImpact: "financial-market impact",
    governanceConsequence: "governance consequence",
    institutionalRisk: "institutional risk",
    leadershipRelevance: "leadership relevance",
    secondOrderEffects: "second-order effects",
    marketCapitalAllocationImpact: "market/capital-allocation impact",
    decisionMakerUrgency: "decision-maker urgency",
    rgiDoctrineAlignment: "RGI doctrine alignment",
    narrativeShiftPotential: "narrative shift potential",
    longTermStrategicConsequences: "long-term strategic consequence",
    rgiPriorityAlignment: "RGI priority alignment",
  };
  return Object.entries(labels)
    .map(([key, label]) => ({ label: label!, score: Number(breakdown[key as keyof StrategicScoreBreakdown] ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => `${item.label} ${item.score.toFixed(1)}/10`);
}

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
  scoreExplanation: string;
  scoreBreakdown: StrategicScoreBreakdown;
  topicTags: string[];
  teaserSummary: string;
  disciplineAlignment: string;
  isPrimarySignal: boolean;
}> {
  const deterministicScore = () => {
    const fallback = fallbackTopicAnalysis(headline, content, sourceName);
    const strategicBreakdown = buildStrategicScoreBreakdown({ headline, content, sourceName, sourceTier, authorityLevel, sourceWeight });
    const fallbackScore = finalStrategicRelevanceScore(strategicBreakdown);
    return {
      relevancyScore: fallbackScore,
      authenticityScore: Math.min(10, Math.max(1, authorityLevel || 5)),
      viewpoint: `RGI notes this item carries ${fallback.topicTags[0].toLowerCase()} significance based on deterministic source and content scoring. Editors should verify the causal mechanism before publication.`,
      scoreExplanation: `Deterministic RGI Strategic Relevance score driven by ${topStrategicDrivers(strategicBreakdown).join(", ")}.`,
      scoreBreakdown: strategicBreakdown,
      topicTags: fallback.topicTags,
      teaserSummary: fallback.teaserSummary,
      disciplineAlignment: fallback.disciplineAlignment,
      isPrimarySignal: fallbackScore >= 8,
    };
  };

  // OpenAI is the primary RGI analyst when configured. Deterministic scoring is
  // only the resilience path when no provider is available or the provider fails.
  if (!process.env.OPENAI_API_KEY && !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return deterministicScore();
  }

  const prompt = RGI_RELEVANCY_PROMPT
    .replace("{TITLE}", headline)
    .replace("{SOURCE}", sourceName)
    .replace("{CONTENT}", content.slice(0, 2500));

  let text = "{}";
  try {
    const message = await withOperationTimeout<unknown>(
      "AI article scoring",
      anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }) as PromiseLike<unknown>,
      ARTICLE_SCORING_TIMEOUT_MS
    );

    const content = (message as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
    const block = content.find((item) => item.type === "text" && typeof item.text === "string");
    text = block?.text ?? "{}";
  } catch (e) {
    logger.warn({ error: summarizeHttpError(e) }, "AI scoring unavailable; using fallback article scoring");
    return deterministicScore();
  }

  let result = {
    relevancyScore: 5,
    authenticityScore: 5,
    viewpoint: "",
    scoreExplanation: "",
    scoreBreakdown: {
      sourceAuthority: sourceAuthorityScore(sourceTier, authorityLevel, sourceWeight),
      geopoliticalImpact: 1.5,
      macroeconomicSignificance: 1.5,
      securityConflictRelevance: 1.5,
      supplyChainImportance: 1.5,
      technologyStrategicRelevance: 1.5,
      energyCommoditiesImportance: 1.5,
      financialMarketImpact: 1.5,
      governanceConsequence: 1.5,
      institutionalRisk: 1.5,
      leadershipRelevance: 1.5,
      secondOrderEffects: 1.5,
      marketCapitalAllocationImpact: 1.5,
      decisionMakerUrgency: 1.5,
      rgiDoctrineAlignment: 1.5,
      narrativeShiftPotential: 1.5,
      longTermStrategicConsequences: 1.5,
      rgiPriorityAlignment: 1.5,
      sourceWeight: clamp(sourceWeight, 0.5, 2),
    },
    topicTags: [] as string[],
    teaserSummary: headline.slice(0, 200),
    disciplineAlignment: "Multiple",
    isPrimarySignal: false,
  };

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const clampedWeight = Math.max(0.5, Math.min(2.0, sourceWeight));
    const aiFactor = (key: string, fallback = 1.5) => clamp(Number(parsed[key] ?? fallback));
    const aiFinalScore = clamp(Number(parsed.finalRelevanceScore ?? parsed.relevancyScore ?? 5));
    const strategicBreakdown = buildStrategicScoreBreakdown({
      headline,
      content,
      sourceName,
      sourceTier,
      authorityLevel,
      sourceWeight: clampedWeight,
      ai: {
        sourceAuthority: aiFactor("sourceAuthority", sourceAuthorityScore(sourceTier, authorityLevel, sourceWeight)),
        geopoliticalImpact: aiFactor("geopoliticalImpact"),
        macroeconomicSignificance: aiFactor("macroeconomicSignificance"),
        securityConflictRelevance: aiFactor("securityConflictRelevance"),
        supplyChainImportance: aiFactor("supplyChainImportance"),
        technologyStrategicRelevance: aiFactor("technologyStrategicRelevance"),
        energyCommoditiesImportance: aiFactor("energyCommoditiesImportance"),
        financialMarketImpact: aiFactor("financialMarketImpact"),
        governanceConsequence: aiFactor("governanceConsequence"),
        institutionalRisk: aiFactor("institutionalRisk"),
        leadershipRelevance: aiFactor("leadershipRelevance"),
        secondOrderEffects: aiFactor("secondOrderEffects"),
        marketCapitalAllocationImpact: aiFactor("marketCapitalAllocationImpact"),
        decisionMakerUrgency: aiFactor("decisionMakerUrgency"),
        rgiDoctrineAlignment: aiFactor("rgiDoctrineAlignment"),
        narrativeShiftPotential: aiFactor("narrativeShiftPotential"),
        longTermStrategicConsequences: aiFactor("longTermStrategicConsequences"),
        rgiPriorityAlignment: aiFactor("rgiPriorityAlignment"),
        aiAnalystScore: aiFinalScore,
        aiConfidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.7))),
      },
    });
    const computedScore = finalStrategicRelevanceScore(strategicBreakdown);

    // Build a concise score breakdown appended to the viewpoint for transparency
    const weightLabel = clampedWeight !== 1.0 ? ` ×${clampedWeight.toFixed(1)} wt` : "";
    const breakdown = `Analyst ${aiFinalScore}/10 · Authority ${strategicBreakdown.sourceAuthority}/10${weightLabel} · Geopolitics ${strategicBreakdown.geopoliticalImpact}/10 · Macro ${strategicBreakdown.macroeconomicSignificance}/10 · Governance ${strategicBreakdown.governanceConsequence}/10 · Institutional risk ${strategicBreakdown.institutionalRisk}/10 · Decision urgency ${strategicBreakdown.decisionMakerUrgency}/10 · RGI doctrine ${strategicBreakdown.rgiDoctrineAlignment}/10`;
    const explanation = parsed.scoreExplanation ? `${parsed.scoreExplanation}` : "";
    const rgiViewpoint = parsed.viewpoint ?? "";
    const fullViewpoint = rgiViewpoint
      ? `${rgiViewpoint}\n\n[Score: ${breakdown}${explanation ? ` — ${explanation}` : ""}]`
      : `[Score: ${breakdown}${explanation ? ` — ${explanation}` : ""}]`;

    result = {
      relevancyScore: computedScore,
      authenticityScore: parsed.authenticityScore ?? 5,
      viewpoint: fullViewpoint,
      scoreExplanation: `RGI Strategic Relevance score driven by ${topStrategicDrivers(strategicBreakdown).join(", ")}.${explanation ? ` AI note: ${explanation}` : ""}`,
      scoreBreakdown: strategicBreakdown,
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
let scrapeStartedAt: Date | null = null;
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
  articlesAlreadyExisting: 0,
  totalFetched: 0,
  rejectedTooOld: 0,
  rejectedLowRelevance: 0,
  acceptedForFeed: 0,
  acceptedForDashboard: 0,
  acceptedForDailyBrief: 0,
  needsReview: 0,
  duplicatesSkipped: 0,
  malformedSkipped: 0,
  lowScoreSkipped: 0,
  lowScoreRejectedArticles: [],
  topAcceptedArticles: [],
  topRejectedArticles: [],
  acceptedArticleOutcomes: emptyAcceptedArticleOutcomes(),
  firestoreWriteAttempts: 0,
  firestoreWriteSuccesses: 0,
  firestoreWriteFailures: 0,
  topAcceptedButNotSaved: [],
  articleDispositions: [],
  feedResults: [],
};
const sourceFailureCounts = new Map<string, number>();

// Per-source cache: tracks last successful fetch time so recently-scraped sources are skipped
const sourceLastFetched = new Map<string, number>(); // source URL → timestamp ms
const SOURCE_CACHE_TTL_MS = 12 * 60 * 1000; // 12 minutes
const SCRAPE_STALE_AFTER_MS = Number(process.env.RGI_SCRAPE_STALE_AFTER_MS ?? 15 * 60 * 1000);

function resetStaleScrapeLockIfNeeded(): boolean {
  if (!scrapeInProgress || !scrapeStartedAt) return false;
  const ageMs = Date.now() - scrapeStartedAt.getTime();
  if (ageMs <= SCRAPE_STALE_AFTER_MS) return false;

  logger.warn(
    { startedAt: scrapeStartedAt.toISOString(), ageMs, staleAfterMs: SCRAPE_STALE_AFTER_MS },
    "Resetting stale scrape lock"
  );
  scrapeInProgress = false;
  lastScrapeFailures.unshift({
    source: "Scrape runner",
    url: "internal",
    attempts: 0,
    message: `Scrape lock reset after ${Math.round(ageMs / 1000)} seconds without completion.`,
    code: "STALE_SCRAPE_LOCK",
  });
  if (!lastScrapeSummary.finishedAt) lastScrapeSummary.finishedAt = new Date().toISOString();
  scrapeStartedAt = null;
  return true;
}

export function getScrapeStatus() {
  resetStaleScrapeLockIfNeeded();
  return {
    isRunning: scrapeInProgress,
    startedAt: scrapeStartedAt?.toISOString() ?? lastScrapeSummary.startedAt,
    staleAfterMs: SCRAPE_STALE_AFTER_MS,
    scheduler: process.env.FUNCTION_TARGET || process.env.K_SERVICE ? "firebase-scheduled-functions" : "local-node-cron",
    hourlySchedule: "0 * * * * America/New_York",
    morningBriefSchedule: "0 6 * * * America/New_York",
    eveningBriefSchedule: "0 18 * * * America/New_York",
    lastScrapeAt: lastScrapeAt?.toISOString() ?? null,
    lastScrapeArticlesFound,
    lastScrapeFailures,
    lastScrapeSummary,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withOperationTimeout<T>(label: string, promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
    const path = parsed.pathname.toLowerCase();
    const configuredAsFeed = /(?:feed|rss|atom|xml)(?:\/|\.|$)/i.test(path);
    if (configuredAsFeed) return [rawUrl];

    const origin = parsed.origin;
    if (/openai\.com$/i.test(parsed.hostname)) candidates.add(`${origin}/news/rss.xml`);
    candidates.add(`${origin}/feed/`);
    candidates.add(`${origin}/rss.xml`);
    candidates.add(`${origin}/rss`);
    candidates.add(`${origin}/atom.xml`);
  } catch {
    // Keep original only.
  }
  return [...candidates].slice(0, 3);
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
    const latest = await latestFirestoreScrapedAt();
    if (latest) lastScrapeAt = latest;
  } catch (err) {
    logger.error({ err }, "Failed to initialize scrape status from DB");
  }
}

export async function runScrape(options: { ignoreSourceCache?: boolean } = {}): Promise<{
  articlesFound: number;
  articlesAdded: number;
  summary?: ScrapeSummary;
}> {
  resetStaleScrapeLockIfNeeded();
  if (scrapeInProgress) {
    return { articlesFound: 0, articlesAdded: 0 };
  }

  scrapeInProgress = true;
  logger.info("Starting parallel scrape run");

  let articlesFound = 0;
  let articlesAdded = 0;
  let malformedSkipped = 0;
  let duplicatesSkipped = 0;
  let alreadyExistingSkipped = 0;
  let lowScoreSkipped = 0;
  const articleDispositions: ArticleDispositionRecord[] = [];
  const startedAt = new Date();
  scrapeStartedAt = startedAt;
  const scrapeRunId = `scrape-${startedAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
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
    articlesAlreadyExisting: 0,
    totalFetched: 0,
    rejectedTooOld: 0,
    rejectedLowRelevance: 0,
    acceptedForFeed: 0,
    acceptedForDashboard: 0,
    acceptedForDailyBrief: 0,
    needsReview: 0,
    duplicatesSkipped: 0,
    malformedSkipped: 0,
    lowScoreSkipped: 0,
    lowScoreRejectedArticles: [],
    topAcceptedArticles: [],
    topRejectedArticles: [],
    acceptedArticleOutcomes: emptyAcceptedArticleOutcomes(),
    firestoreWriteAttempts: 0,
    firestoreWriteSuccesses: 0,
    firestoreWriteFailures: 0,
    topAcceptedButNotSaved: [],
    articleDispositions: [],
    feedResults: [],
  };

  try {
    const sources = await listActiveFirestoreSources();
    logger.info({ scrapeRunId, activeSources: sources.length }, "Scrape run loaded active Firestore sources");

    lastScrapeSummary.totalFeeds = sources.length;

    const existingArticles = await listFirestoreArticles({ limit: 1000 });
    const existingUrls = new Set(existingArticles.map((article) => normalizeUrl(article.url)).filter(Boolean));
    const existingTitles = new Set(existingArticles.map((article) => titleFingerprint(article.headline)).filter(Boolean));
    const batchUrls = new Set<string>();
    const batchTitles = new Set<string>();

    // Bounded concurrency keeps scraping from starving UI/API requests during slow feed runs.
    logger.info({ scrapeRunId, count: sources.length, concurrency: 6 }, "Fetching sources with bounded concurrency");
    const fetchResults = await mapWithConcurrency(
      sources,
      6,
      async (source) => {
        try {
          // Skip recently-cached sources
          const lastFetched = sourceLastFetched.get(source.url);
          if (!options.ignoreSourceCache && lastFetched && Date.now() - lastFetched < SOURCE_CACHE_TTL_MS) {
            logger.debug({ scrapeRunId, source: source.name }, "Source recently fetched — using cache, skipping");
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
            logger.info({ scrapeRunId, source: source.name }, "LinkedIn source requires API configuration — skipping");
            return { source, items: [] as ScrapedItem[] };
          }

          if (items.length > 0) sourceLastFetched.set(source.url, Date.now());
          return { source, items };
        } catch (e) {
          const summary = summarizeHttpError(e);
          lastScrapeFailures.push({ source: source.name, url: source.url, attempts: 1, ...summary });
          logger.warn({ scrapeRunId, source: source.name, url: source.url, ...summary }, "Source scrape failed unexpectedly");
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
            logger.warn({ scrapeRunId, source: source.name, url: item.url, reason: validated.reason }, "Skipping malformed scraped item");
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
            logger.debug({ scrapeRunId, source: source.name, headline: validated.item.headline, url: normalized }, "Skipping duplicate scraped item");
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

        await updateFirestoreSourceHealth(source.id, {
          status: status === "success" ? "healthy" : nextFailures >= 3 ? "failed" : "warning",
          lastScrapeAt: new Date(),
          lastSuccessAt: status === "success" ? new Date() : null,
          lastError,
          consecutiveFailures: nextFailures,
        }).catch((err) => logger.debug({ err, source: source.name }, "Source health update skipped"));
      } else {
        const summary = summarizeHttpError(result.reason);
        lastScrapeFailures.push({ source: "unknown", url: "unknown", attempts: 1, ...summary });
      }
    }

    articlesFound = allItems.length;
    lastScrapeSummary.articlesCollected = fetchResults
      .filter((result): result is PromiseFulfilledResult<{ source: typeof sources[0]; items: ScrapedItem[] }> => result.status === "fulfilled")
      .reduce((sum, result) => sum + result.value.items.length, 0);
    lastScrapeSummary.totalFetched = lastScrapeSummary.articlesCollected;
    lastScrapeSummary.articlesAccepted = articlesFound;
    lastScrapeSummary.malformedSkipped = malformedSkipped;
    lastScrapeSummary.duplicatesSkipped = duplicatesSkipped;
    lastScrapeSummary.successfulFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "success").length;
    lastScrapeSummary.emptyFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "empty").length;
    lastScrapeSummary.failedFeeds = lastScrapeSummary.feedResults.filter((feed) => feed.status === "failed").length;
    logger.info({ scrapeRunId, articlesFound, summary: lastScrapeSummary }, "All sources fetched — scoring articles");

    // Scoring is also bounded so provider/network stalls cannot monopolize the server.
    const scoringResults = await mapWithConcurrency(
      allItems,
      8,
      async ({ source, item }) => {
        // Check if article already exists
        const existing = await getFirestoreArticleByUrl(item.url);
        if (existing) {
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
          const strategicImpactScore = Math.max(
            Number(scored.scoreBreakdown.longTermStrategicConsequences ?? 0),
            Number(scored.scoreBreakdown.geopoliticalImpact ?? 0),
            Number(scored.scoreBreakdown.macroeconomicSignificance ?? 0),
            Number(scored.scoreBreakdown.securityConflictRelevance ?? 0),
            Number(scored.scoreBreakdown.technologyStrategicRelevance ?? 0),
            Number(scored.scoreBreakdown.energyCommoditiesImportance ?? 0),
            finalScore,
          );
          const executiveRelevanceScore = Math.max(
            Number(scored.scoreBreakdown.leadershipRelevance ?? 0),
            Number(scored.scoreBreakdown.decisionMakerUrgency ?? 0),
            Number(scored.scoreBreakdown.institutionalRisk ?? 0),
            Number(scored.scoreBreakdown.rgiDoctrineAlignment ?? 0),
          );
          const judgment = recommendedUseForScores({
            publishedAt: item.publishedAt ?? existing.publishedAt,
            relevancyScore: finalScore,
            sourceAuthorityScore: scored.scoreBreakdown.sourceAuthority,
            strategicImpactScore,
            executiveRelevanceScore,
          });
          await updateFirestoreArticle(Number(existing.id), {
            relevancyScore: finalScore,
            authenticityScore: scored.authenticityScore,
            recencyScore: judgment.recencyScore,
            sourceAuthorityScore: scored.scoreBreakdown.sourceAuthority,
            strategicImpactScore,
            executiveRelevanceScore,
            recommendedUse: judgment.recommendedUse,
            reasonForAcceptance: judgment.reasonForAcceptance,
            reasonForRejection: judgment.reasonForRejection,
            rgiProfileVersion: RGI_PROFILE.name,
            viewpoint: scored.viewpoint || null,
            scoreExplanation: scored.scoreExplanation,
            scoreBreakdown: scored.scoreBreakdown as unknown as Record<string, unknown>,
            topicTags: scored.topicTags,
            teaserSummary: scored.teaserSummary,
            publishedAt: item.publishedAt ?? existing.publishedAt,
            content: item.content ?? existing.content,
            disciplineAlignment: scored.disciplineAlignment,
            isEmergingSignal: detectEmergingSignal(item.headline, finalScore),
            isPrimarySignal: scored.isPrimarySignal ?? false,
          });
          alreadyExistingSkipped++;
          const feed = lastScrapeSummary.feedResults.find((result) => result.url === source.url);
          if (feed) feed.articlesSkipped++;
          articleDispositions.push({
            headline: item.headline,
            source: source.name,
            url: item.url,
            score: finalScore,
            recommendation: judgment.recommendedUse,
            rejectionReason: "Article URL already exists in Firestore.",
            insertionDecision: "Existing Firestore article was rescored and updated instead of inserted as a duplicate.",
            outcome: "already_exists",
            writeAttempted: true,
            writeSucceeded: true,
          });
          return null;
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
        const strategicImpactScore = Math.max(
          Number(scored.scoreBreakdown.longTermStrategicConsequences ?? 0),
          Number(scored.scoreBreakdown.geopoliticalImpact ?? 0),
          Number(scored.scoreBreakdown.macroeconomicSignificance ?? 0),
          Number(scored.scoreBreakdown.securityConflictRelevance ?? 0),
          Number(scored.scoreBreakdown.technologyStrategicRelevance ?? 0),
          Number(scored.scoreBreakdown.energyCommoditiesImportance ?? 0),
          finalScore,
        );
        const executiveRelevanceScore = Math.max(
          Number(scored.scoreBreakdown.leadershipRelevance ?? 0),
          Number(scored.scoreBreakdown.decisionMakerUrgency ?? 0),
          Number(scored.scoreBreakdown.institutionalRisk ?? 0),
          Number(scored.scoreBreakdown.rgiDoctrineAlignment ?? 0),
        );
        const judgment = recommendedUseForScores({
          publishedAt: item.publishedAt,
          relevancyScore: finalScore,
          sourceAuthorityScore: scored.scoreBreakdown.sourceAuthority,
          strategicImpactScore,
          executiveRelevanceScore,
        });

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
          recencyScore: judgment.recencyScore,
          sourceAuthorityScore: scored.scoreBreakdown.sourceAuthority,
          strategicImpactScore,
          executiveRelevanceScore,
          recommendedUse: judgment.recommendedUse,
          reasonForAcceptance: judgment.reasonForAcceptance,
          reasonForRejection: judgment.reasonForRejection,
          rgiProfileVersion: RGI_PROFILE.name,
          viewpoint: scored.viewpoint || null,
          scoreExplanation: scored.scoreExplanation,
          scoreBreakdown: scored.scoreBreakdown,
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
	  viewpoint: string | null; scoreExplanation: string; scoreBreakdown: StrategicScoreBreakdown; topicTags: string[];
	  recencyScore: number; sourceAuthorityScore: number; strategicImpactScore: number; executiveRelevanceScore: number;
	  recommendedUse: RgiRecommendedUse; reasonForAcceptance: string | null; reasonForRejection: string | null;
	  rgiProfileVersion: string;
	  teaserSummary: string; publishedAt: Date | null | undefined;
	  content: string | null | undefined;
	  status: "pending"; disciplineAlignment: string;
    };
    const validArticles: ArticleToInsert[] = [];
    const lowScoreRejectedArticles: LowScoreRejectedArticle[] = [];
    const acceptedExamples: ScrapeExampleArticle[] = [];
    const rejectedExamples: ScrapeExampleArticle[] = [];
    for (const [index, r] of scoringResults.entries()) {
      if (r.status === "fulfilled" && r.value !== null && r.value.recommendedUse !== "reject" && r.value.relevancyScore >= ARTICLE_INSERTION_SCORE_THRESHOLD) {
        validArticles.push(r.value as ArticleToInsert);
        acceptedExamples.push({
          headline: r.value.headline,
          source: r.value.sourceName,
          url: r.value.url,
          relevancyScore: r.value.relevancyScore,
          recommendedUse: r.value.recommendedUse,
          reason: r.value.reasonForAcceptance ?? "Accepted by RGI relevance engine.",
        });
      } else if (r.status === "fulfilled" && r.value !== null) {
        const rejectedByThreshold = r.value.relevancyScore < ARTICLE_INSERTION_SCORE_THRESHOLD;
        const rejectionReason = r.value.reasonForRejection ?? `relevancyScore ${r.value.relevancyScore} is below insertion threshold ${ARTICLE_INSERTION_SCORE_THRESHOLD}`;
        const rejectedForLowRelevance = rejectedByThreshold || rejectionReason.includes("below ingestion threshold");
        if (r.value.reasonForRejection?.includes("outside the 24-hour")) {
          lastScrapeSummary.rejectedTooOld++;
        } else {
          lowScoreSkipped++;
        }
        lastScrapeSummary.rejectedLowRelevance = lowScoreSkipped;
        articleDispositions.push({
          headline: r.value.headline,
          source: r.value.sourceName,
          url: r.value.url,
          score: r.value.relevancyScore,
          recommendation: r.value.recommendedUse,
          rejectionReason,
          insertionDecision: rejectedByThreshold
            ? `Rejected before write because relevancyScore ${r.value.relevancyScore} is below insertion threshold ${ARTICLE_INSERTION_SCORE_THRESHOLD}.`
            : `Rejected before write because recommendation was ${r.value.recommendedUse}.`,
          outcome: rejectedForLowRelevance ? "low_relevance" : "rejected_by_recommendation_logic",
          writeAttempted: false,
          writeSucceeded: false,
        });
        rejectedExamples.push({
          headline: r.value.headline,
          source: r.value.sourceName,
          url: r.value.url,
          relevancyScore: r.value.relevancyScore,
          recommendedUse: r.value.recommendedUse,
          reason: rejectionReason,
        });
        lowScoreRejectedArticles.push({
          headline: r.value.headline,
          source: r.value.sourceName,
          url: r.value.url,
          relevancyScore: r.value.relevancyScore,
          scoreBreakdown: r.value.scoreBreakdown,
          reason: rejectionReason,
          scoreExplanation: r.value.scoreExplanation,
        });
      } else if (r.status === "rejected") {
        const original = allItems[index];
        articleDispositions.push({
          headline: original?.item.headline ?? "Unknown headline",
          source: original?.source.name ?? "Unknown source",
          url: original?.item.url ?? "unknown",
          score: 0,
          recommendation: null,
          rejectionReason: `Scoring failed: ${summarizeHttpError(r.reason).message}`,
          insertionDecision: "Rejected before write because article scoring failed.",
          outcome: "other",
          writeAttempted: false,
          writeSucceeded: false,
        });
      }
    }
    lowScoreRejectedArticles.sort((a, b) => b.relevancyScore - a.relevancyScore);
    lastScrapeSummary.lowScoreRejectedArticles = lowScoreRejectedArticles.slice(0, 10);
    lastScrapeSummary.topAcceptedArticles = acceptedExamples.sort((a, b) => b.relevancyScore - a.relevancyScore).slice(0, 10);
    lastScrapeSummary.topRejectedArticles = rejectedExamples.sort((a, b) => b.relevancyScore - a.relevancyScore).slice(0, 10);
    lastScrapeSummary.needsReview = validArticles.filter((article) => article.recommendedUse === "needs_review").length;
    lastScrapeSummary.acceptedForFeed = validArticles.filter((article) => article.recommendedUse === "feed").length;
    lastScrapeSummary.acceptedForDashboard = validArticles.filter((article) => article.recommendedUse === "dashboard").length;
    lastScrapeSummary.acceptedForDailyBrief = validArticles.filter((article) => article.recommendedUse === "daily_brief").length;

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

    // Insert new articles — skip low-relevance content below the ingestion threshold.
    for (const article of validArticles) {
      const multiSourceBoost = boostMap.get(article.url) ?? 0;
      const boostedScore = Math.min(10, Math.round((article.relevancyScore + multiSourceBoost) * 10) / 10);

      try {
        await createFirestoreArticle({
          ...article,
          relevancyScore: boostedScore,
          isEmergingSignal: multiSourceBoost > 0 ? true : article.isEmergingSignal,
        });
        articlesAdded++;
        articleDispositions.push({
          headline: article.headline,
          source: article.sourceName,
          url: article.url,
          score: boostedScore,
          recommendation: article.recommendedUse,
          rejectionReason: null,
          insertionDecision: multiSourceBoost > 0
            ? `Firestore write succeeded after multi-source boost from ${article.relevancyScore} to ${boostedScore}.`
            : "Firestore write succeeded.",
          outcome: "saved",
          writeAttempted: true,
          writeSucceeded: true,
        });
        const feed = lastScrapeSummary.feedResults.find((result) => result.url === article.sourceUrl);
        if (feed) feed.articlesSaved++;
      } catch (e) {
        duplicatesSkipped++;
        articleDispositions.push({
          headline: article.headline,
          source: article.sourceName,
          url: article.url,
          score: boostedScore,
          recommendation: article.recommendedUse,
          rejectionReason: summarizeHttpError(e).message,
          insertionDecision: "Firestore write was attempted but failed.",
          outcome: "write_failure",
          writeAttempted: true,
          writeSucceeded: false,
        });
        logger.warn({ scrapeRunId, error: summarizeHttpError(e), url: article.url, headline: article.headline }, "Failed to insert article");
      }
    }

    await Promise.allSettled(lastScrapeSummary.feedResults.map((feed) => {
      const previousFailures = sourceFailureCounts.get(String(feed.sourceId)) ?? 0;
      return updateFirestoreSourceHealth(feed.sourceId, {
        status: feed.status === "success" ? "healthy" : previousFailures >= 3 ? "failed" : "warning",
        lastScrapeAt: new Date(feed.lastScrapeAt),
        lastSuccessAt: feed.status === "success" ? new Date(feed.lastScrapeAt) : null,
        lastError: feed.error ?? null,
        consecutiveFailures: previousFailures,
        articlesCollected: feed.articlesCollected,
        articlesSaved: feed.articlesSaved,
      });
    }));

    // Also skip any scored articles that were below threshold (the validArticles filter above handles this)
    for (const result of scoringResults) {
      if (result.status === "fulfilled" && result.value !== null && result.value.relevancyScore < ARTICLE_INSERTION_SCORE_THRESHOLD) {
        logger.debug({ scrapeRunId, headline: result.value.headline, score: result.value.relevancyScore }, "Skipping low-relevance article");
      }
    }

    lastScrapeAt = new Date();
    lastScrapeArticlesFound = articlesFound;
    lastScrapeSummary.finishedAt = lastScrapeAt.toISOString();
    lastScrapeSummary.articlesSaved = articlesAdded;
    lastScrapeSummary.articlesAlreadyExisting = alreadyExistingSkipped;
    lastScrapeSummary.duplicatesSkipped = duplicatesSkipped;
    lastScrapeSummary.malformedSkipped = malformedSkipped;
    lastScrapeSummary.lowScoreSkipped = lowScoreSkipped;
    lastScrapeSummary.rejectedLowRelevance = lowScoreSkipped;
    lastScrapeSummary.lowScoreRejectedArticles = lowScoreRejectedArticles.slice(0, 10);
    lastScrapeSummary.articleDispositions = articleDispositions;
    lastScrapeSummary.acceptedArticleOutcomes = countAcceptedArticleOutcomes(articleDispositions);
    lastScrapeSummary.firestoreWriteAttempts = articleDispositions.filter((record) => record.writeAttempted).length;
    lastScrapeSummary.firestoreWriteSuccesses = articleDispositions.filter((record) => record.writeSucceeded).length;
    lastScrapeSummary.firestoreWriteFailures = articleDispositions.filter((record) => record.writeAttempted && !record.writeSucceeded).length;
    lastScrapeSummary.topAcceptedButNotSaved = articleDispositions
      .filter((record) => !record.writeSucceeded)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
    if (lowScoreRejectedArticles.length > 0) {
      logger.info(
        { scrapeRunId, threshold: ARTICLE_INSERTION_SCORE_THRESHOLD, rejected: lastScrapeSummary.lowScoreRejectedArticles },
        "Top low-score rejected articles"
      );
    }
    if (lastScrapeSummary.acceptedArticleOutcomes.total !== articlesFound) {
      logger.warn(
        {
          scrapeRunId,
          articlesAccepted: articlesFound,
          dispositionTotal: lastScrapeSummary.acceptedArticleOutcomes.total,
        },
        "Scrape disposition total does not match accepted article count"
      );
    }
    logger.info({ scrapeRunId, articlesFound, articlesAdded, feedFailures: lastScrapeFailures.length, summary: lastScrapeSummary }, "Parallel scrape run complete");
  } catch (e) {
    const summary = summarizeHttpError(e);
    lastScrapeFailures.unshift({
      source: "Scrape runner",
      url: "firestore://sources",
      attempts: 0,
      ...summary,
    });
    logger.error({ scrapeRunId, error: summary, summary: lastScrapeSummary }, "Scrape run failed");
  } finally {
    scrapeInProgress = false;
    scrapeStartedAt = null;
    if (!lastScrapeSummary.finishedAt) lastScrapeSummary.finishedAt = new Date().toISOString();
  }

  return { articlesFound, articlesAdded, summary: lastScrapeSummary };
}
