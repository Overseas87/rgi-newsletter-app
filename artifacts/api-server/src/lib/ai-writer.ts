import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable, digestArticlesTable, newsletterSubscribersTable } from "@workspace/db";
import { inArray, gte, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

// ── Generation cache ──────────────────────────────────────────────────────────
// Daily brief: Key: date-string + sorted excludedTopics → cached result + timestamp
interface CachedBrief { result: DailyBriefResult; generatedAt: number }
const dailyBriefCache = new Map<string, CachedBrief>();
const BRIEF_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Topic article: Key: sorted article IDs + editorNotes → cached result + timestamp
interface CachedArticle {
  result: {
    headline: string; body: string; executiveSummary: string[]; rgiTake: string;
    keyTakeaways: string[]; whatToWatch: string[]; topicTags: string[]; discipline: string; relevancyScore: number;
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
  rgiTake: string; keyTakeaways: string[]; whatToWatch: string[]; topicTags: string[];
  discipline: string; relevancyScore: number; sourceArticleIds: number[];
}

function dailyBriefCacheKey(date: string, excludedTopics: string[]): string {
  return `${date}:${[...excludedTopics].sort().join(",")}`;
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

const RGI_SYSTEM_PROMPT = `You are the senior intelligence editor for the Rick Goings Institute (RGI) at Rollins College — an institution dedicated to equipping leaders to build organizations that last, contribute, and stay vital in demanding times.

You are an analyst, not a summarizer. You transform raw information into clear, actionable intelligence. You never repeat what sources say — you interpret what it means. Every output must add insight that a reader cannot find by reading the sources themselves.

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

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief. You are not summarizing sources — you are analyzing them. Your job is to produce insight a senior leader cannot find by reading the sources themselves.

SOURCE MATERIAL:
{SOURCES}

EDITORIAL DIRECTION:
{NOTES}

═══════════════════════════════════════════════════════
INTERNAL REASONING (complete silently before writing)
═══════════════════════════════════════════════════════
Work through the four-step reasoning process from the system prompt. Then apply all three analytical lenses:

— CAUSE AND EFFECT: What force, decision, or failure produced this development? Why now?
— SECOND-ORDER CONSEQUENCES: Beyond the obvious first-order effect, what gets reconfigured next? What do markets, organizations, and supply chains have to absorb or adjust to?
— STRATEGIC RELEVANCE: What specific decision or risk does this create for a senior leader today?

═══════════════════════════════════════════════════════
OUTPUT — STRUCTURED ARTICLE FORMAT
═══════════════════════════════════════════════════════
Total article: 300–500 words. Highly scannable. No long prose blocks. Every sentence is analysis, not description.

HEADLINE: One declarative sentence. A causal claim — not a topic label. Foreign Affairs / HBR style. Must state what happened AND why.

EXECUTIVE SUMMARY (2–3 sentences): The core development and its most important implication. Direct, no hedging. Must not repeat the headline — each sentence adds new information.

KEY DEVELOPMENTS (3–5 bullets): The most consequential facts across the sources. One clear analytical sentence each. Connect causally where possible — not a list of disconnected events. Each bullet must be distinct from every other.

WHY IT MATTERS (2–3 bullets): Second-order implications for senior leaders. Name the mechanism — who faces new pressure, through what channel, on what timeline. No abstractions.

RGI TAKE (2–3 sentences): 
  Sentence 1: "RGI [agrees / partially agrees / disagrees] with [the dominant claim or framing] because [specific reasoning]."
  Sentence 2: Name precisely what markets, media, or policymakers are missing, overstating, or failing to see.
  Sentence 3: One concrete forward-looking action or decision leaders must confront as a result.
  A neutral or hedged Take is a failure. Take a position.

WHAT TO WATCH (2–3 bullets): Specific signals, thresholds, or decision points — not vague trends. Time-bound where possible (next 72 hours / next quarter). Each bullet names what to look for and why it matters if it happens.

ABSOLUTE RULES:
✗ Never restate what sources say — state what it means
✗ No generic language: "this is significant," "could have major implications," "remains to be seen"
✗ No neutral hedging in the RGI Take — it must state a position
✗ No bullet repeats another — every point adds distinct analytical value
✗ No fabrication — all claims trace to provided sources
✓ If sources conflict, surface the disagreement explicitly in Key Developments or RGI Take
✓ Every sentence earns its place — cut anything that does not add new insight

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
{
  "headline": "string — one declarative causal sentence stating what happened and why",
  "executiveSummary": ["sentence 1", "sentence 2", "sentence 3"],
  "keyDevelopments": ["development 1", "development 2", "development 3", "development 4"],
  "whyItMatters": ["second-order implication 1", "second-order implication 2", "second-order implication 3"],
  "rgiTake": "string — opens with explicit agree/partially agree/disagree position, names what is being missed, ends with one concrete leader action",
  "whatToWatch": ["specific signal 1 with timeframe", "specific signal 2 with timeframe", "specific signal 3"],
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1–3 only from this exact list):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets", "Technology & AI",
"Innovation & Digital Transformation", "Business Strategy & Corporations", "Leadership & Organizations",
"Energy & Resources", "Supply Chains & Global Trade", "Policy, Regulation & Governance",
"Climate & Environmental Systems", "Future of Work & Society"

Return ONLY valid JSON. No markdown code blocks. No explanation before or after.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
Apply this throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Strategic Intelligence Brief — an executive-grade document that answers: "What is actually happening today, why does it matter, and what must leaders do?"

You are not summarizing the news. You are synthesizing today's intelligence into clear, actionable analysis that a senior leader cannot find anywhere else.

Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
{SOURCES}

═══════════════════════════════════════════════════════
INTERNAL REASONING (complete silently before writing)
═══════════════════════════════════════════════════════
Work through the four-step reasoning process from the system prompt. Then apply all three analytical lenses:

— CAUSE AND EFFECT: What single structural force is driving the most consequential development today? Why today, not last week or next month?
— SECOND-ORDER CONSEQUENCES: Beyond the headline effect, what systems — markets, organizations, supply chains, governance structures — are being reconfigured right now as a result?
— STRATEGIC RELEVANCE: What specific decision, risk, or opportunity does today's intelligence create for executives and institutional leaders?

Also: Do any sources conflict? What is the dominant narrative and is it accurate, incomplete, or misleading?

═══════════════════════════════════════════════════════
OUTPUT — STRUCTURED ARTICLE FORMAT
═══════════════════════════════════════════════════════
Total: 300–500 words. Highly scannable. No long text blocks. Every sentence is analysis, not description.

HEADLINE: One declarative sentence. A causal claim about what is happening and why — must name the driver, not just the event. Not a topic list.

EXECUTIVE SUMMARY (2–3 sentences): The single most consequential development today and its most important implication. Direct, no hedging. Each sentence adds new information — do not repeat the headline.

KEY DEVELOPMENTS (3–5 bullets): The most consequential facts across today's signals. One clear analytical sentence each. Do not summarize topic by topic — find the causal thread connecting them. Each bullet must be distinct.

WHY IT MATTERS (2–3 bullets): Second-order implications for senior leaders. Name the mechanism: who faces new pressure, through what channel, with what consequence, on what timeline. No abstractions.

RGI TAKE (2–3 sentences):
  Sentence 1: "RGI [agrees / partially agrees / disagrees] with [the dominant narrative] because [specific reasoning]."
  Sentence 2: Name precisely what markets, media, or policymakers are failing to see or are overstating.
  Sentence 3: One concrete action, risk, or decision leaders must confront now.
  A neutral or hedged Take is a failure. Take a position.

WHAT TO WATCH (2–3 bullets): Specific signals, thresholds, or decision points. Time-bound where possible (next 72 hours / next quarter). Each bullet names what to look for and why it matters if it occurs.

ABSOLUTE RULES:
✗ Never restate what sources say — state what it means
✗ No topic-by-topic summaries — synthesize across developments
✗ No generic language: name the mechanism, the actor, the timeline
✗ No neutral hedging in the RGI Take
✗ No fabrication — all claims trace to provided sources
✓ Surface source conflicts if they exist — do not manufacture consensus
✓ Every sentence must add new information or new analysis

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
{
  "headline": "string — one declarative causal sentence naming the development and its driver",
  "executiveSummary": ["sentence 1", "sentence 2", "sentence 3"],
  "keyDevelopments": ["causally connected development 1", "development 2", "development 3", "development 4"],
  "whyItMatters": ["second-order implication 1 with named mechanism", "implication 2", "implication 3"],
  "rgiTake": "string — opens with explicit agree/partially agree/disagree position, names what is missed, ends with one concrete leader action",
  "whatToWatch": ["specific signal 1 with timeframe", "specific signal 2", "specific signal 3"],
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1–3 only from this exact list):
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
  topicTags: string[];
  discipline: string;
  relevancyScore: number;
  fromCache: boolean;
}> {
  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = topicArticleCacheKey(articleIds, editorNotes);
  const cached = topicArticleCache.get(cacheKey);
  if (cached && Date.now() - cached.generatedAt < TOPIC_CACHE_TTL_MS) {
    logger.info({ cacheKey }, "Returning cached topic article");
    return { ...cached.result, fromCache: true };
  }

  let articles = await db
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
  const prompt = SYNTHESIS_PROMPT.replace("{SOURCES}", sourcesText).replace("{NOTES}", notesText);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);
    const result = {
      headline: parsed.headline || "Untitled Brief",
      body: Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments.join("\n") : (parsed.body || ""),
      executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : [],
      rgiTake: parsed.rgiTake || "",
      keyTakeaways: Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : (Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : []),
      whatToWatch: Array.isArray(parsed.whatToWatch) ? parsed.whatToWatch : [],
      topicTags: parsed.topicTags || [],
      discipline: parsed.discipline || "Multiple",
      relevancyScore: parsed.relevancyScore || 7,
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
  const [article] = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.id, articleId))
    .limit(1);

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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

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

    // Persist the refinement back to the DB
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
  const fieldLabel = field === "rgiTake" ? "RGI Take (editorial position)" : "Article Body";

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
  // Fetch recent approved articles matching the selected topics
  const allApproved = await db
    .select()
    .from(digestArticlesTable)
    .where(eq(digestArticlesTable.status, "approved"))
    .orderBy(desc(digestArticlesTable.createdAt))
    .limit(40);

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

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    // Count active subscribers interested in these topics
    const subscribers = await db
      .select()
      .from(newsletterSubscribersTable)
      .where(eq(newsletterSubscribersTable.isActive, true));

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
  excludedTopics?: string[]
): Promise<{
  headline: string;
  executiveSummary: string[];
  body: string;
  rgiTake: string;
  keyTakeaways: string[];
  topicTags: string[];
  discipline: string;
  relevancyScore: number;
  sourceArticleIds: number[];
}> {
  // ── Cache check (auto-brief only — specific articleIds always regenerate) ────
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateKey = today.toISOString().slice(0, 10);

  if (!articleIds || articleIds.length === 0) {
    const cacheKey = dailyBriefCacheKey(dateKey, excludedTopics ?? []);
    const cached = dailyBriefCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < BRIEF_CACHE_TTL_MS) {
      logger.info({ cacheKey }, "Returning cached daily brief");
      return cached.result;
    }
  }

  let articles;

  if (articleIds && articleIds.length > 0) {
    articles = await db
      .select()
      .from(articlesTable)
      .where(inArray(articlesTable.id, articleIds));
    // Cap to top 7 by score
    articles = [...articles].sort((a, b) => b.relevancyScore - a.relevancyScore).slice(0, 7);
  } else {
    // Auto-select: today's top 7 articles with score >= 6.5
    articles = await db
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

  const prompt = (DAILY_BRIEF_PROMPT + editorialSuffix)
    .replace("{SOURCE_COUNT}", String(articles.length))
    .replace("{THEME_COUNT}", String(topicSet.size))
    .replace("{SOURCES}", sourcesText);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    const result: DailyBriefResult = {
      headline: parsed.headline || "RGI Daily Strategic Intelligence Brief",
      executiveSummary: Array.isArray(parsed.executiveSummary) ? parsed.executiveSummary : [],
      body: Array.isArray(parsed.keyDevelopments) ? parsed.keyDevelopments.join("\n") : (parsed.body || ""),
      rgiTake: parsed.rgiTake || "",
      keyTakeaways: Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : (Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : []),
      whatToWatch: Array.isArray(parsed.whatToWatch) ? parsed.whatToWatch : [],
      topicTags: parsed.topicTags || [],
      discipline: parsed.discipline || "Multiple",
      relevancyScore: parsed.relevancyScore || 8,
      sourceArticleIds: articles.map((a) => a.id),
    };

    // Cache auto-brief results (not articleId-driven ones)
    if (!articleIds || articleIds.length === 0) {
      const cacheKey = dailyBriefCacheKey(dateKey, excludedTopics ?? []);
      dailyBriefCache.set(cacheKey, { result, generatedAt: Date.now() });
    }

    return result;
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse daily brief response");
    throw new Error("Failed to parse AI-generated daily brief");
  }
}
