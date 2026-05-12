import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable, digestArticlesTable } from "@workspace/db";
import { inArray, gte, desc, eq } from "drizzle-orm";
import { logger } from "./logger";
import { getSupabaseDigest, listSupabaseArticles, listSupabaseDigests, updateSupabaseDigest, useSupabaseData } from "./supabase-data";
import { listFirestoreNewsletterSubscribers } from "./firestore-newsletter";

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

function topicArticleCacheKey(articleIds: number[], editorNotes?: string | null): string {
  return `${[...articleIds].sort((a, b) => a - b).join(",")}:${editorNotes?.trim() || ""}`;
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
  const viewpoint = (a.viewpoint as string | null | undefined) || "";
  const summary = ((a.teaserSummary || a.content || a.headline) as string).slice(0, 350);
  return [
    `S${i + 1}${signalTag}: ${a.headline}`,
    `Source: ${a.sourceName}${a.author ? ` · ${a.author}` : ""} | Relevancy: ${a.relevancyScore}/10 | Auth: ${auth}/10 (${credLabel})`,
    viewpoint ? `RGI viewpoint: ${viewpoint}` : null,
    `Summary: ${summary}`,
  ].filter(Boolean).join("\n");
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

  return cleaned
    .replace(/\bAcross\s+(?:,\s*)+/gi, "")
    .replace(/\bAcross\s+[, ]+/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const contradiction = detectContradiction(articles);
  const pattern = signalPattern(articles);
  return [
    `The important development is not the individual headline sequence but the pattern underneath it: ${pattern}.`,
    `That pattern sharpens the core tension: ${coreTension}. For executives, ${topicNoun(tags[0] ?? "strategy")} is becoming a governance question before it becomes a clean operating plan.`,
    contradiction ?? `${sourceDiversityClause(articles)}; repeated signals matter only when they add a new actor, mechanism, or decision consequence.`,
    "The practical decision is whether to preserve optionality now or wait for confirmation and accept that the most valuable response window may narrow.",
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

function synthesizeImplications(): string[] {
  return [
    "Set explicit decision thresholds before acting: name the evidence that would justify changing investment, staffing, supply chain, or public-position strategy.",
    "Separate monitoring from commitment. Leaders can increase attention immediately while delaying irreversible moves until source conflicts, policy signals, or market reactions are better corroborated.",
    "Assign ownership for uncertainty. Boards and executive teams should decide who validates the source trail, who models downside exposure, and who communicates what remains unresolved.",
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

function fallbackTopicArticle(
  articles: Array<Record<string, unknown>>,
  editorNotes?: string | null
) {
  const primary = articles[0] ?? {};
  const topTags = dominantTags(articles);
  const coreTension = inferCoreTension(articles, topTags);
  const keyDevelopments = synthesizeKeyDevelopments(articles, coreTension, topTags);
  const whyItMatters = synthesizeWhyItMatters(coreTension, topTags);
  const implications = synthesizeImplications();
  const score = Math.max(6.8, Math.min(8.8, averageScore(articles)));
  const headlineTag = topicNoun(topTags[0] ?? "strategy").replace(/\b\w/g, (c) => c.toUpperCase());

  return {
    headline: stripEmDash(`RGI Brief: ${headlineTag} Enters a Judgment Test`.slice(0, 180)),
    body: stripEmDashArray(keyDevelopments).join("\n"),
    executiveSummary: [
      stripEmDash(`The central strategic tension is that ${coreTension}. The institutional risk is not the headline itself; it is the gap between the speed of external change and the slower cycle of governance, capital allocation, and public accountability.`),
      stripEmDash(editorNotes?.trim() || "The signal is best read as a pattern of decision pressure rather than a discrete event. Leaders should treat this brief as a judgment map: what is changing, where evidence is thin, and which commitments become costly to reverse."),
    ],
    rgiTake: `RGI reads this moment as an institutional judgment test: leaders are being asked to act before evidence is complete, but waiting for perfect certainty can itself become a strategic failure. Historically, institutions lose ground when they confuse caution with discipline; the deeper task is to separate noise from obligation and preserve the capacity to move before consensus forms.`,
    keyTakeaways: stripEmDashArray(whyItMatters),
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
  };
}

function fallbackDailyBrief(articles: Array<Record<string, unknown>>): DailyBriefResult {
  const topicTags = dominantTags(articles);
  const sourceArticleIds = articles.map((a) => Number(a.id)).filter((id) => Number.isFinite(id));
  const coreTension = inferCoreTension(articles, topicTags);
  const keyDevelopments = synthesizeKeyDevelopments(articles, coreTension, topicTags);
  const whyItMatters = synthesizeWhyItMatters(coreTension, topicTags);
  const implications = synthesizeImplications();
  const leadTopic = topicNoun(topicTags[0] ?? "strategy");
  return {
    headline: `RGI Daily Brief: ${leadTopic.replace(/\b\w/g, (c) => c.toUpperCase())} Under Pressure`,
    executiveSummary: [
      `The strategic reality today is that ${coreTension}. This is not simply a question of faster information flow; it is a test of whether institutions can make disciplined commitments while the facts, incentives, and political constraints are still moving.`,
      `The main tension for leaders is the widening gap between public narratives that reward fast reaction and operating environments that still require patience, verification, and governance discipline. Capital allocation, supply chain posture, public positioning, and executive credibility are all becoming exposed to decisions made before uncertainty has cleared.`,
      `What matters most is not which single event dominates the day, but whether leaders can identify the assumptions that are becoming load-bearing across multiple decisions. The near-term opportunity is to preserve strategic optionality while competitors either overreact to noise or wait too long for certainty.`,
      `The risk is that institutions mistake temporary stabilization for structural resolution and build plans around conditions that may reverse quickly. Leaders should focus on decision thresholds, accountability for uncertainty, and the practical resilience needed if the current pattern intensifies rather than resolves.`,
    ],
    body: stripEmDashArray(keyDevelopments).join("\n"),
    rgiTake: `RGI reads today's pattern as a judgment test for institutions operating between volatility and obligation. The deeper issue is not whether leaders possess enough information, but whether they can distinguish evidence that changes strategy from noise that only increases urgency. History is unkind to organizations that wait for certainty when the decision window is already narrowing, but it is equally unkind to those that confuse speed with wisdom. The disciplined response is to name the uncertainty, assign ownership for the assumptions that matter, and preserve optionality without drifting into paralysis. Leaders should treat this moment as a governance exercise: decide what must remain flexible, what must be protected, and what would justify a more irreversible commitment.`,
    keyTakeaways: stripEmDashArray(whyItMatters),
    implificationsForLeaders: stripEmDashArray(implications),
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
  };
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
const FIXED_LENGTH_CONSTRAINTS = `TOTAL WORD LIMIT: 950
The entire newsletter (from Executive Summary to RGI Editorial) must be between 850 and 1050 words.
If the output is too long: shorten sentences, remove less important details.
If the output is too short: expand slightly with relevant insights.
Do not ignore this constraint.
Section limits (use these to distribute words across sections):
  - Executive Summary: 5–6 sentences, 150–220 words
  - Key Developments: 4 bullets, 140–190 words total
  - Why It Matters: 3 bullets, 150–210 words total
  - Implications for Decision Makers: 3 bullets, 150–210 words total
  - RGI Editorial: 5–6 sentences, 180–260 words
Before outputting, silently count your total words. If outside the 850–1050 window, revise until you are within range.`;

const RGI_SYSTEM_PROMPT = `You are the senior intelligence editor for the Rick Goings Institute (RGI) at Rollins College — a center for rigorous executive education preparing leaders to navigate AI acceleration, geopolitical volatility, and continuous disruption.

You are an analyst, not a summarizer. You transform raw information into clear, actionable intelligence. You never repeat what sources say — you interpret what it means. Every output must add insight that a reader cannot find by reading the sources themselves.

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

2. System Vitality: The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. Organizations as living systems driven by human energy, trust, purpose, and institutional health.

3. Civic Stewardship: The responsibility leaders bear to the communities and institutions that grant them legitimacy. Corporations as citizens with obligations beyond profit — to civic life, democratic institutions, and long-term community wellbeing.

═══════════════════════════════════════════════════════
THREE ANALYTICAL LENSES — apply to every output
═══════════════════════════════════════════════════════
These are not optional. Every piece of analysis must be filtered through all three:

LENS 1 — CAUSE AND EFFECT: Every development has a cause. Name it precisely. Do not describe what happened without explaining what produced it. Trace the chain: what decision, force, or failure set this in motion?

LENS 2 — SECOND-ORDER CONSEQUENCES: The first-order effect is what everyone can see. Your job is the second and third order. What does this force, constrain, or make inevitable next? What markets, institutions, supply chains, or leadership decisions get reconfigured as a result? Think two moves ahead — always.

LENS 3 — STRATEGIC RELEVANCE: Why does this matter for the humans making consequential decisions right now? Name the specific pressure it creates for executives, policymakers, or board members. If you cannot connect the development to a real decision a real leader must make, the analysis is incomplete.

═══════════════════════════════════════════════════════
MANDATORY REASONING PROCESS — silent pre-work before writing
═══════════════════════════════════════════════════════
Step through these four questions before drafting a single word:

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

═══════════════════════════════════════════════════════
RGI PERSPECTIVE PRINCIPLES — non-negotiable
═══════════════════════════════════════════════════════
1. LONG-TERM OVER SHORT-TERM: Headlines are raw material. Analysis must reveal what this means 2, 5, and 10 years from now. Short-term volatility is the noise; the structural shift is the signal.

2. SYSTEMS OVER ISOLATED EVENTS: Any single development is less important than the system it operates within. Explain the system. Name the structural force the event reveals or accelerates.

3. CHALLENGE SHALLOW NARRATIVES: When media framing is incomplete, oversimplified, agenda-driven, or emotionally charged — name it and correct it. Apply independent judgment. Do not reproduce conventional wisdom without interrogating it.

4. LEADERSHIP AND DECISION FOCUS: Every analysis must arrive at what this means for real people making consequential choices — executives, policymakers, board members, institutional leaders. What must they do differently as a result?

5. NO HYPE, NO EMOTIONAL FRAMING: Precise, measured language only. Words like "seismic," "unprecedented," or "game-changing" require specific evidence. Never sensationalize. Never catastrophize. State the facts and let the analysis carry the weight.

═══════════════════════════════════════════════════════
RGI TAKE — MANDATORY FORMAT
═══════════════════════════════════════════════════════
Every RGI Take must:
1. Open with an explicit position: "RGI agrees / partially agrees / disagrees with [the dominant claim or narrative] because [precise reasoning]."
2. Name what markets, media, or policymakers are missing, overstating, or getting wrong.
3. Close with one concrete, forward-looking implication — a specific action, risk, or decision leaders must confront.

A Take that does not take a position is not a Take. Neutral hedging is a failure of analysis.

═══════════════════════════════════════════════════════
EDITORIAL STANDARDS
═══════════════════════════════════════════════════════
- INTERPRETATION RULE: Never restate what sources say. State what it means. Your value is the inference, not the report.
- SYNTHESIS RULE: Find the single thread connecting disparate signals — the structural force driving multiple developments simultaneously.
- DENSITY RULE: Every sentence must add new information or new analysis. No filler. No transitions that only restate the previous point.
- CONFLICT RULE: When sources disagree, surface the disagreement explicitly. Name the competing claims. Evaluate the evidence. Never flatten contradictions into false consensus.
- CREDIBILITY RULE: Higher-authenticity sources carry more analytical weight. When a major claim rests on weak or single-source reporting, say so.
- PRECISION RULE: No vague language. "Could have major implications" is not analysis. Name the mechanism. Name the actor. Name the timeline.
- FABRICATION RULE: All claims must trace to provided sources. Do not invent data, quotes, or events.
- STANDARD: Write at the level of Harvard Business Review or Foreign Affairs — analytical, rigorous, and worth reading twice.`;

const SYNTHESIS_PROMPT = `You are a senior strategic intelligence analyst at the Rick Goings Institute (RGI).

Your role is to produce high-impact intelligence briefs that reduce decision error for executives and investors.

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
Reflect the core insight directly.

## Executive Summary (max 80 words)
- State the core insight clearly
- Explain why it matters now

## Key Developments (3–4 bullets ONLY — max 80 words total)
Each bullet must directly support the core insight. One analytical sentence per bullet. Distinct, no overlap.

## Why It Matters (2–3 bullets — max 120 words total)
Apply RGI's executive education lens. For each bullet: name the second-order implication AND the leadership judgment it demands. Surface ethical or civic dimensions where real, not decorative. Connect the event to actual decisions people in positions of responsibility must make.

## Implications for Decision-Makers (2–3 bullets — max 120 words total)
Write through RGI's executive education framework. Each bullet addresses leadership judgment under uncertainty — not just operational tactics. Name the decision a leader, board member, or institution must now make or reconsider. Name what is still unknown and how a leader should reason despite that. Where relevant, name the civic or ethical obligation this event creates.

## RGI Editorial (max 120 words)
Write 2–3 sentences interpreting this development through RGI's executive education mission.
Open with: "RGI [agrees / partially agrees / disagrees] with [dominant narrative] because [precise reasoning]."
Then: apply a liberal arts lens — history, ethics, or institutional theory — to name what this moment reveals about leadership, power, or collective responsibility.
Close with: one concrete judgment for how leaders should reason or act.
A neutral Editorial is a failure. Grounded and interpretive, not promotional or breathless.

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
- Is any low-signal information included? (remove it)
- Does the total word count fall within the selected mode's limit?
- Are forbidden sections absent? (What Changed Since Yesterday, What to Watch, Key Takeaways, Mechanism, What Most Are Missing — do NOT output these)

---

OUTPUT FORMAT: return ONLY valid JSON, no markdown, no preamble.
ONLY these fields — do NOT add any others:
{
  "headline": "string: 8-12 words, reflects core insight directly, Bloomberg/Reuters style. No em dashes.",
  "executiveSummary": ["core insight clearly stated (max 80 words total across all items)"],
  "keyDevelopments": ["bullet 1 (3-4 bullets, max 80 words total)", "bullet 2", "bullet 3"],
  "whyItMatters": ["RGI executive education lens: leadership judgment + second-order implication (max 120 words total)", "bullet 2"],
  "implificationsForLeaders": ["leadership judgment under uncertainty + civic/ethical dimension (max 120 words total)", "bullet 2"],
  "rgiTake": "string: 2-3 sentences, max 120 words. Agrees/partially agrees/disagrees + liberal arts or institutional interpretation + one concrete judgment. Grounded, interpretive, not promotional. No em dashes.",
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

{LENGTH_CONSTRAINTS}

Internal analyst inputs ({SOURCE_COUNT} article-derived signals across {THEME_COUNT} thematic areas):
{SOURCES}

{PREVIOUS_BRIEF_SECTION}
═══════════════════════════════════════════════════════
INTERNAL REASONING (silent — do not output)
═══════════════════════════════════════════════════════
1. What precisely happened today? (strip media framing — name the underlying fact)
2. What caused it? Name the economic force, geopolitical dynamic, or institutional decision.
3. What gets reconfigured next? (second-order: markets, supply chains, leadership priorities)
4. What specific signals will determine how this resolves in the next 72 hours and next quarter?
5. If yesterday's brief is provided: what materially changed? What reversed? What is new today that was absent?

NO SOURCE-REFERENCE RULE:
Publication names, outlet names, author names, and references to "sources," "source sets," "coverage," "reporting," "articles," or "synthesis" must NOT appear in Executive Summary, Key Developments, Why It Matters, Implications for Decision-Makers, or RGI Editorial. Those sections must speak directly about the strategic reality, actor behavior, institutional consequences, and leadership decisions. Attribution belongs only in a separate Sources section if the product chooses to render one outside this JSON.

═══════════════════════════════════════════════════════
STRICT FORMAT — 6 sections only (length is set by the mode above)
═══════════════════════════════════════════════════════

HEADLINE: 8–12 words maximum. Lead with the key actor and action. Use a colon to add the sharpest consequence. Must be scannable in 3 seconds, no subordinate clauses, no jargon. Think Bloomberg/Reuters, not Foreign Affairs. Format: "[Actor] [Action] [What]: [Consequence]" or "[Event]: [Impact]". Examples: "Trump Threatens Iran: Hormuz Deal at Risk" / "Fed Holds Rates as Trade War Pressure Builds" / "China Dumps Treasuries: Dollar Risk Returns". Do not use em dashes.

EXECUTIVE SUMMARY (5–6 sentences, 150–220 words): State the core geopolitical and institutional reality. Explain the main strategic tension, why it matters now, what leaders should pay attention to, and what risks or opportunities are emerging. Do not mention publications, sources, article sets, coverage, reporting, or the synthesis process. The summary should answer: "What should an executive understand from today's developments?"

KEY DEVELOPMENTS (4 bullets, 140–190 words total): Each bullet directly states the development and its strategic significance. Name what changed, why it matters, and what signal it sends. Do not reference publications, source convergence, article coverage, or media framing.

WHY IT MATTERS (3 bullets, 150–210 words total): Apply RGI's executive education lens. For each bullet: name the institutional consequence, second-order implication, and leadership judgment it demands. Focus on capital allocation, supply chains, political legitimacy, regulatory risk, strategic optionality, public positioning, and operational resilience where relevant.

IMPLICATIONS FOR DECISION-MAKERS (3 bullets, 150–210 words total): Make recommendations concrete, operational, and executive-level. Focus on uncertainty management, threshold-based decisions, optionality, timing, capital allocation, geopolitical exposure, public positioning, operational resilience, and governance choices. Avoid generic consulting language.

RGI EDITORIAL (5–6 sentences, 180–260 words): Write a thoughtful institutional editorial and strategic reflection. It should interpret the deeper meaning behind the developments, connect geopolitical dynamics to leadership judgment, and offer an original RGI framing. Use a disciplined, historically aware, executive-level voice. Avoid motivational language, vague corporate phrasing, and repetition of earlier sections.

FORBIDDEN — do NOT generate any of the following:
✗ What Most Are Missing
✗ Mechanism
✗ Constraints and Risks
✗ What Changed Since Yesterday
✗ What to Watch Next
✗ Key Takeaways
✗ Any content after RGI Editorial (except Sources)
✗ Publication names or attribution outside a dedicated Sources section
✗ Phrases such as "source set," "coverage suggests," "sources indicate," "the brief synthesizes," "across Bloomberg/CFR/NYT," or any explanation of editorial process

ABSOLUTE RULES:
✗ No em dashes (the — character) anywhere in output. Use commas, colons, semicolons, or parentheses instead.
✗ No repetition across sections
✗ No vague language: name the actor, decision, timeline
✗ No generic phrases: "significant implications," "remains to be seen," "could have major impact"
✗ No fabrication: all claims trace to provided sources
✓ Surface source conflicts explicitly
✓ Every sentence adds new information or analysis
✓ Total word count: stay within the mode limit. Condense ruthlessly if over.

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
ONLY these fields — do NOT add any others:
{
  "headline": "string: 8 to 12 words, actor + action + consequence, scannable in 3 seconds, Bloomberg/Reuters style. No em dashes.",
  "executiveSummary": ["5-6 strategic sentences total, 150-220 words, no source/publication/process references"],
  "keyDevelopments": ["bullet 1 (4 bullets, concise strategic development, no source/publication/process references)", "bullet 2", "bullet 3", "bullet 4"],
  "whyItMatters": ["RGI lens: institutional consequence + second-order implication + leadership judgment", "bullet 2", "bullet 3"],
  "implificationsForLeaders": ["executive decision framing under uncertainty, operational and governance-specific", "bullet 2", "bullet 3"],
  "rgiTake": "string: 5-6 sentences, 180-260 words. Strategic, historically/institutionally aware, original RGI editorial voice. No source/publication/process references. No em dashes.",
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

  let articles = useSupabaseData()
    ? (await listSupabaseArticles({ limit: 500 })).filter((article) => articleIds.includes(article.id))
    : await db
        .select()
        .from(articlesTable)
        .where(inArray(articlesTable.id, articleIds));

  if (articles.length === 0) {
    throw new Error("No articles found with provided IDs");
  }

  // Cap to 7 highest-scoring articles to keep prompt tight and generation fast
  articles = [...articles]
    .sort((a, b) => b.relevancyScore - a.relevancyScore)
    .slice(0, 7);

  const sourcesText = articles
    .map((a, i) => compactSource(a as unknown as Record<string, unknown>, i))
    .join("\n\n---\n\n");

  const notesText = editorNotes?.trim()
    ? editorNotes.trim()
    : "No specific editorial direction — apply your best analytical judgment to identify the most important pattern across the provided sources.";
  const prompt = SYNTHESIS_PROMPT
    .replace("{SOURCES}", sourcesText)
    .replace("{NOTES}", notesText)
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
    logger.warn({ error: summarizeProviderError(e) }, "AI article generation unavailable; using fallback synthesis");
    const result = fallbackTopicArticle(articles as unknown as Array<Record<string, unknown>>, editorNotes);
    return { ...result, fromCache: false };
  }

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);
    const result = {
      headline: stripEmDash(parsed.headline || "Untitled Brief"),
      body: cleanBriefBody(Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments : parsed.body, articles as unknown as Array<Record<string, unknown>>),
      executiveSummary: cleanBriefArray(parsed.executiveSummary, articles as unknown as Array<Record<string, unknown>>, ["The operating environment is creating a judgment problem for leaders who must distinguish temporary narrative relief from durable strategic change."]),
      rgiTake: cleanBriefText(parsed.rgiTake, articles as unknown as Array<Record<string, unknown>>, "RGI reads this as a test of institutional judgment: leaders must convert ambiguous evidence into disciplined action without confusing speed for wisdom."),
      keyTakeaways: cleanBriefArray(Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : parsed.keyTakeaways, articles as unknown as Array<Record<string, unknown>>, ["Leaders should focus on the second-order implications and the decisions this development forces under uncertainty."]),
      whatToWatch: cleanBriefArray(parsed.whatToWatch, articles as unknown as Array<Record<string, unknown>>, ["Watch for concrete actor decisions, policy movement, capital flows, and operational changes that confirm whether the signal is becoming structural."]),
      whatMostAreMissing: typeof parsed.whatMostAreMissing === "string" ? stripEmDash(parsed.whatMostAreMissing) : null,
      mechanism: cleanTextArray(parsed.mechanism),
      constraintsAndRisks: cleanTextArray(parsed.constraintsAndRisks),
      implificationsForLeaders: cleanBriefArray(parsed.implificationsForLeaders, articles as unknown as Array<Record<string, unknown>>, ["Name the uncertainty, assign ownership for validation, and avoid treating volume of information as certainty."]),
      topicTags: cleanTextArray(parsed.topicTags, ["Business Strategy & Corporations"]).slice(0, 3),
      discipline: parsed.discipline || "Multiple",
      relevancyScore: clampScore(parsed.relevancyScore, 7),
      generationMode: "ai" as const,
    };

    // Store in cache (only when no editorNotes — editorial direction makes each unique)
    if (!editorNotes?.trim()) {
      topicArticleCache.set(cacheKey, { result, generatedAt: Date.now() });
    }

    return { ...result, fromCache: false };
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse AI article response");
    throw new Error("Failed to parse AI-generated article");
  }
}

const REFINE_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI). An article has been drafted and the editor has requested specific changes. Apply the instruction precisely and completely — it overrides all other considerations.

CURRENT ARTICLE:
Headline: {HEADLINE}

Executive Summary:
{EXEC_SUMMARY}

Key Developments:
{BODY}

Why It Matters:
{KEY_TAKEAWAYS}

RGI Take:
{RGI_TAKE}

What to Watch:
{WHAT_TO_WATCH}

EDITOR'S REFINEMENT INSTRUCTION:
{INSTRUCTION}

Rewrite the article following the editor's instruction exactly. While applying the instruction, maintain the full RGI analytical framework:
- Every sentence must state what something means, not just what happened (no source repetition)
- Cause and effect must be named explicitly
- Second-order consequences belong in Why It Matters
- The RGI Take must open with an explicit position (agrees / partially agrees / disagrees) and close with one concrete leader action
- What to Watch must be specific and time-bound, not vague trends
- Total article: under 500 words

Return ONLY a valid JSON object with these fields:
- headline: string (update if instruction requires — must be a declarative causal sentence)
- executiveSummary: string array (2–3 sentences — core development and most important implication)
- keyDevelopments: string array (3–5 bullets — causally connected analytical facts, one sentence each)
- whyItMatters: string array (2–3 bullets — second-order implications naming mechanisms and leaders affected)
- rgiTake: string (opens with explicit agree/disagree position, names what is missed, ends with one leader action)
- whatToWatch: string array (2–3 specific, time-bound forward signals)

Return ONLY valid JSON. No explanation, no markdown code blocks.`;

const NEWSLETTER_DIGEST_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI) writing a weekly newsletter digest for subscribers interested in {TOPICS}.

Below are this week's top published RGI strategic briefs relevant to those topics:

{ARTICLES}

Write a concise weekly digest email that:
1. Opens with a brief "This Week in Intelligence" introduction (2-3 sentences) summarizing the most important development of the week
2. For each article, writes 2-3 sentences capturing the key insight and why it matters — link to the original brief
3. Closes with a short "RGI Perspective" paragraph naming the biggest strategic pattern across all topics this week

Requirements:
- Tone: professional, insightful, editorial — not promotional
- No emojis, no excessive enthusiasm
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
  const article = useSupabaseData()
    ? await getSupabaseDigest(articleId)
    : (await db
        .select()
        .from(digestArticlesTable)
        .where(eq(digestArticlesTable.id, articleId))
        .limit(1))[0];

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
    const fallbackRefined = {
      headline: article.headline,
      body: article.body,
      executiveSummary: article.executiveSummary || [],
      rgiTake: `${article.rgiTake || "RGI notes this article remains in review."}\n\nFallback refinement note: ${instruction.trim()}`,
      keyTakeaways: article.keyTakeaways || [],
      whatToWatch: ((article as Record<string, unknown>).whatToWatch as string[] || []),
    };
    if (useSupabaseData()) {
      await updateSupabaseDigest(articleId, fallbackRefined);
    } else {
      await db
        .update(digestArticlesTable)
        .set(fallbackRefined)
        .where(eq(digestArticlesTable.id, articleId));
    }
    return fallbackRefined;
  }

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const refined = {
      headline: parsed.headline || article.headline,
      body: Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments.join("\n") : (parsed.body || article.body),
      executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : (article.executiveSummary || []),
      rgiTake: parsed.rgiTake || article.rgiTake,
      keyTakeaways: Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : (Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : article.keyTakeaways),
      whatToWatch: Array.isArray(parsed.whatToWatch) ? parsed.whatToWatch : ((article as Record<string, unknown>).whatToWatch as string[] || []),
    };

    if (useSupabaseData()) {
      await updateSupabaseDigest(articleId, refined);
    } else {
      await db
        .update(digestArticlesTable)
        .set({
          headline: refined.headline,
          body: refined.body,
          executiveSummary: refined.executiveSummary,
          rgiTake: refined.rgiTake,
          keyTakeaways: refined.keyTakeaways,
          whatToWatch: refined.whatToWatch,
        })
        .where(eq(digestArticlesTable.id, articleId));
    }

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
  const fieldLabel = field === "rgiTake" ? "RGI Editorial" : "Key Developments";

  const prompt = `You are line-editing a specific passage within a published RGI intelligence article.

ARTICLE HEADLINE: ${article.headline}

FULL ARTICLE BODY (for context — do not rewrite the surrounding content):
${article.body}

RGI TAKE (for context):
${article.rgiTake || "None"}

FIELD BEING EDITED: ${fieldLabel}

SELECTED PASSAGE TO REWRITE:
"${selectedText}"

EDITOR INSTRUCTION: ${instructions}

Rules:
- Rewrite ONLY the selected passage above, nothing outside of it.
- Maintain the RGI editorial voice: precise, analytical, no hype, no emotional language.
- Ensure the rewritten passage integrates seamlessly with the surrounding text.
- Match the approximate length of the original unless the instruction explicitly requires otherwise.
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
    return { regeneratedText: parsed.regeneratedText };
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
  const allApproved = await listSupabaseDigests({ status: "approved", limit: 40 });

  const matching = topics.length > 0
    ? allApproved.filter((a) => a.topicTags.some((t) => topics.includes(t)))
    : allApproved;

  const forDigest = matching.slice(0, 12);

  if (forDigest.length === 0) {
    throw new Error("No approved articles found for the selected topics");
  }

  const articlesText = forDigest
    .map((a, i) =>
      `BRIEF ${i + 1}:\nHeadline: ${a.headline}\nDiscipline: ${a.discipline || "—"}\nTopics: ${a.topicTags.join(", ")}\nSummary: ${a.body.slice(0, 800)}\nRGI Take: ${a.rgiTake?.slice(0, 300) || "—"}`
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
      headline: parsed.headline || "RGI Weekly Intelligence Digest",
      body: parsed.body || "",
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

  if (articleIds && articleIds.length > 0) {
    articles = useSupabaseData()
      ? (await listSupabaseArticles({ limit: 500 })).filter((article) => articleIds.includes(article.id))
      : await db
          .select()
          .from(articlesTable)
          .where(inArray(articlesTable.id, articleIds));
    // Cap to top 7 by score
    articles = [...articles].sort((a, b) => b.relevancyScore - a.relevancyScore).slice(0, 7);
  } else {
    // Auto-select: today's top 7 articles with score >= 6.5
    articles = useSupabaseData()
      ? (await listSupabaseArticles({ limit: 200 }))
          .filter((a) => new Date(a.scrapedAt).getTime() >= today.getTime())
          .sort((a, b) => b.relevancyScore - a.relevancyScore)
          .slice(0, 7)
      : await db
          .select()
          .from(articlesTable)
          .where(gte(articlesTable.scrapedAt, today))
          .orderBy(desc(articlesTable.relevancyScore))
          .limit(7);

    // Filter to minimum quality threshold
    articles = articles.filter((a) => a.relevancyScore >= 6.0);

    // Apply excluded topics: skip an article only if ALL its topic tags are excluded
    if (excludedTopics && excludedTopics.length > 0) {
      const excluded = new Set(excludedTopics);
      articles = articles.filter((a) => a.topicTags.some((t) => !excluded.has(t)));
    }
  }

  if (articles.length === 0) {
    throw new Error("No qualifying articles found for today's brief");
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
    .replace("{PREVIOUS_BRIEF_SECTION}", previousBriefSection)
    .replace("{LENGTH_CONSTRAINTS}", FIXED_LENGTH_CONSTRAINTS);

  let text = "{}";
  try {
    logger.info(
      { traceId, prompt: "DAILY_BRIEF_PROMPT", sourceArticleIds: articles.map((a) => a.id), fallbackUsed: false },
      "[daily-brief-trace] Sending Daily Brief prompt to AI provider"
    );
    console.log(`[daily-brief-trace:${traceId}] prompt constant: DAILY_BRIEF_PROMPT`);
    console.log(`[daily-brief-trace:${traceId}] source of Executive Summary: AI JSON executiveSummary via generateDailyBrief`);
    console.log(`[daily-brief-trace:${traceId}] source of Key Developments: AI JSON keyDevelopments -> digest.body`);
    console.log(`[daily-brief-trace:${traceId}] source of RGI Editorial: AI JSON rgiTake`);
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
    console.log(`[daily-brief-trace:${traceId}] source of Executive Summary: fallbackDailyBrief.executiveSummary`);
    console.log(`[daily-brief-trace:${traceId}] source of Key Developments: fallbackDailyBrief.body from synthesizeKeyDevelopments`);
    console.log(`[daily-brief-trace:${traceId}] source of RGI Editorial: fallbackDailyBrief.rgiTake`);
    return fallbackDailyBrief(articles as unknown as Array<Record<string, unknown>>);
  }

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const result: DailyBriefResult = {
      headline: stripEmDash(parsed.headline || "RGI Daily Strategic Intelligence Brief"),
      executiveSummary: cleanBriefArray(parsed.executiveSummary, articles as unknown as Array<Record<string, unknown>>, [
        "The operating environment is creating a judgment problem for leaders who must distinguish temporary narrative relief from durable strategic change.",
        "Institutions should focus on which assumptions are becoming load-bearing, which risks are compounding, and which decisions should remain reversible until stronger evidence emerges.",
      ]),
      body: cleanBriefBody(Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments : parsed.body, articles as unknown as Array<Record<string, unknown>>),
      rgiTake: cleanBriefText(parsed.rgiTake, articles as unknown as Array<Record<string, unknown>>, "RGI reads this as a test of institutional judgment: leaders must convert ambiguous evidence into disciplined action without confusing speed for wisdom."),
      keyTakeaways: cleanBriefArray(Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : parsed.keyTakeaways, articles as unknown as Array<Record<string, unknown>>, ["Leaders should focus on the decisions this pattern forces under uncertainty."]),
      implificationsForLeaders: cleanBriefArray(parsed.implificationsForLeaders, articles as unknown as Array<Record<string, unknown>>, ["Set decision thresholds, preserve optionality, and assign ownership for the assumptions that would justify irreversible action."]),
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

    logger.info(
      {
        traceId,
        fallbackUsed: false,
        executiveSummaryItems: result.executiveSummary.length,
        keyDevelopmentLines: result.body.split("\n").filter(Boolean).length,
        rgiEditorialChars: result.rgiTake.length,
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
