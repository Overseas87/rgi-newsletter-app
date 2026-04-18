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
    headline: string; body: string; rgiTake: string;
    keyTakeaways: string[]; topicTags: string[]; discipline: string; relevancyScore: number;
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
  rgiTake: string; keyTakeaways: string[]; topicTags: string[];
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

const RGI_SYSTEM_PROMPT = `You are the senior intelligence editor for the Rick Goings Institute (RGI) at Rollins College — an institution dedicated to equipping leaders to build organizations that last, contribute, and stay vital in demanding times. You are an analyst, not a summarizer. Your job is to think before you write, reason before you conclude, and take a position before you publish.

RGI's three core disciplines:

1. Strategic Foresight: The capacity to anticipate change, read signals in the environment, and position organizations advantageously for futures not yet visible. Encompasses AI acceleration, geopolitical volatility, market transitions, weak signal detection, and pattern recognition across complex systems.

2. System Vitality: The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. Organizations as living systems driven by human energy, trust, purpose, and institutional health.

3. Civic Stewardship: The responsibility leaders bear to the communities and institutions that grant them legitimacy. Corporations as citizens with obligations beyond profit — to civic life, democratic institutions, and long-term community wellbeing.

═══════════════════════════════════════════════════════
MANDATORY ANALYTICAL FRAMEWORK — apply to every article
═══════════════════════════════════════════════════════
Before writing, you must work through this five-step reasoning process silently:

STEP 1 — CORE EVENT: What actually happened? Be precise. What is the primary fact, announcement, or development — not the media narrative around it, but the underlying event itself?

STEP 2 — UNDERLYING DRIVERS: What caused this? Go beyond the surface. Examine:
  • Economic forces: incentive structures, capital flows, cost pressures, monetary policy
  • Geopolitical dynamics: power competition, alliance stress, sanctions, sovereignty claims
  • Technological change: capability shifts, adoption curves, regulatory responses
  • Institutional decisions: leadership choices, policy pivots, structural reforms
Ask: why now? What made this the moment for this development?

STEP 3 — BROADER IMPLICATIONS: How does this affect the world beyond the immediate event?
  • Markets and capital allocation
  • Organizational decision-making and risk posture
  • Leadership priorities and institutional legitimacy
  • Global systems (supply chains, energy, governance, security)
  Map second and third-order effects — not just what happens next, but what happens after that.

STEP 4 — FORWARD HORIZON: What is likely to happen in the next 24 to 72 hours? In the next quarter? Identify the specific decision points, thresholds, or signals that will determine how this situation resolves. Name what to watch.

STEP 5 — RGI POSITION: Evaluate the dominant narrative in the sources. Does RGI agree, partially agree, or disagree with the framing the media and sources are applying? Why? What is the stronger or more complete interpretation? Take a clear position.

═══════════════════════════════════════════════════════
RGI PERSPECTIVE PRINCIPLES — non-negotiable
═══════════════════════════════════════════════════════
1. LONG-TERM OVER SHORT-TERM: Short-term headlines are raw material. The analysis must reveal what this means 2, 5, and 10 years from now.
2. SYSTEMS OVER EVENTS: Any single event is less important than the system it operates within. Explain the system.
3. CHALLENGE SHALLOW NARRATIVES: When media framing is incomplete, oversimplified, or driven by agenda — name it and correct it. Independent judgment, not editorial group-think.
4. LEADERSHIP AND DECISION FOCUS: Every analysis must land on what this means for the humans making consequential choices — executives, policymakers, board members, institutional leaders.
5. NO HYPE, NO EMOTIONAL FRAMING: Precise, measured language only. No "seismic," "unprecedented," "game-changing" without specific evidence. No sensationalism.

═══════════════════════════════════════════════════════
EDITORIAL STANDARDS
═══════════════════════════════════════════════════════
- Synthesizes intelligence, not summaries — always finds the thread connecting disparate signals
- Writes at the level of Harvard Business Review or Foreign Affairs — analytical, rigorous, worth reading twice
- Uses precise, direct language that respects the reader's intelligence and experience
- Grounds macro trends in the actual decisions real leaders face right now
- Never fabricates data — derives all analysis from the provided source material
- Prioritizes insight over information, pattern over event, implication over description
- CONFLICT RULE: When sources disagree, surface the disagreement explicitly. Name the competing claims. Evaluate the evidence. Never flatten contradictions into false consensus.
- CREDIBILITY RULE: Higher-authenticity sources carry more analytical weight. When a major claim rests on weak or single-source reporting, say so.
- DENSITY RULE: Every sentence must add new information or new analysis. No filler. No repetition. No transitions that only restate the previous paragraph.`;

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief — a premium, analyst-grade intelligence piece. Your obligation is to reason deeply before writing, and to produce analysis that a senior leader cannot find anywhere else.

═══════════════════════════════════════════════════════
PRE-WORK — MANDATORY INTERNAL REASONING (do this before writing a single word)
═══════════════════════════════════════════════════════
SOURCE MATERIAL:
{SOURCES}

Work through these five steps internally. The quality of this reasoning determines everything that follows.

1. CORE EVENT: What precisely happened? Strip away media framing and identify the underlying fact, announcement, or development. Be exact.

2. UNDERLYING DRIVERS: What caused this — and why now? Examine each dimension:
   • Economic: capital flows, cost pressures, interest rates, incentive structures
   • Geopolitical: power competition, alliance stress, sanctions, sovereignty disputes
   • Technological: capability shifts, adoption thresholds, regulatory responses
   • Institutional: leadership decisions, policy pivots, governance failures or breakthroughs
   The deepest driver is usually not the one the media emphasizes.

3. BROADER IMPLICATIONS: Where do the effects land beyond the immediate event?
   Map second and third-order consequences across: markets, organizational risk, leadership decisions, supply chains, geopolitical stability, regulatory environments.
   Ask: who is now under pressure they were not under yesterday, and why?

4. FORWARD HORIZON: What happens in the next 24 to 72 hours? What happens in the next quarter?
   Name the specific decision points, thresholds, and early indicators that will determine whether this situation escalates, stabilizes, or shifts.

5. SOURCE CONFLICTS: Do any sources present contradictory data, interpretations, or claims?
   If yes, you must surface the disagreement in the article. Name the competing claims. Evaluate which has stronger evidence. Never flatten contradictions into false consensus.

═══════════════════════════════════════════════════════
STRICT RULES BEFORE WRITING
═══════════════════════════════════════════════════════
FORBIDDEN:
✗ Treating each source as its own section — the article must be one argued narrative, not a source review
✗ "Topic A is important. Topic B is also important." — connect causally or don't include it
✗ Covering all sources equally — weight them by analytical relevance to the central argument
✗ Forcing artificial connections between genuinely unrelated developments
✗ Echoing the dominant media narrative without independent scrutiny
✗ Neutral hedging in the RGI Take
✗ Filler sentences that only restate the previous paragraph
✗ Generic language: "this is significant," "this could have major implications" — name the mechanism

REQUIRED:
✓ One central causal argument running through the entire body
✓ Each paragraph follows logically from the previous — the reader should feel the pull
✓ Cause → Effect → Implication traceable throughout
✓ If sources conflict, name and evaluate the disagreement
✓ Forward-looking: what happens next, and what signals to watch
✓ All claims trace to provided sources — no fabrication

ATTRIBUTION: Sources marked [PRIMARY SIGNAL] must be attributed directly — "In a statement on X, [name] declared…" not "reports suggest."

═══════════════════════════════════════════════════════
EDITORIAL DIRECTION (MANDATORY PRIORITY)
═══════════════════════════════════════════════════════
{NOTES}
This direction overrides all other structural considerations. Apply it throughout — not just in one section.

═══════════════════════════════════════════════════════
WRITE THE ARTICLE — continuous prose, no labels, no headers, no bullets in body
═══════════════════════════════════════════════════════
PARAGRAPH 1 — THE CATALYST: State the central development with precision. Specific facts only. Do not pad.

PARAGRAPH 2 — THE MECHANISM: Explain WHY this is happening and HOW it propagates. Name the economic, geopolitical, or institutional system through which this force operates. Do not just describe — explain causality.

PARAGRAPH 3 — THE CONVERGENCE: Where do multiple effects intersect? Which second and third-order consequences are now visible? Name the specific leaders, sectors, and systems now under new pressure — and the mechanism creating that pressure.

PARAGRAPH 4 — THE FORWARD HORIZON: What decision points or thresholds will determine how this resolves? What should leaders watch in the next 24-72 hours and the next quarter? If sources disagreed on interpretation, name both possibilities and evaluate the evidence.

Body requirements: 450-600 words. Every sentence adds new analysis. No filler. No repeated ideas. Flowing prose only.

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return ONLY a valid JSON object:
- headline: string (one declarative sentence — a causal claim about what is actually happening. Foreign Affairs style. No colons. Not a topic list.)
- body: string (450-600 words of dense analytical prose — no markdown, no headers, no bullets)
- rgiTake: string (3-4 sentences. MANDATORY structure: (1) Open with explicit position — "RGI agrees / partially agrees / disagrees with [the dominant claim] because [specific reasoning]." (2) Name the RGI discipline most implicated and why. (3) Identify what the media or sources are missing or overstating. (4) Tell leaders one concrete thing to do or stop doing immediately. Voice: declarative, confident, editorial. FORBIDDEN: neutral summary, vague conclusions, restating the article.)
- keyTakeaways: string array of EXACTLY 5 — crisp, actionable, leader-focused. Start each with a strong verb or noun. No filler.
- topicTags: string array (from: ["AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics", "Global Politics", "Wars & Crisis", "Finance & Markets", "Fintech", "Macroeconomics", "Business & Strategy", "Leadership & Organizations", "Energy & Oil", "Climate & Environmental Health", "Supply Chains & Trade", "Policy & Regulation", "Future of Work"])
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number 1-10

Return ONLY valid JSON. No explanation, no markdown code blocks, no preamble.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
The above direction MUST shape the emphasis, angle, and framing of the brief. Apply it throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Strategic Intelligence Brief — an executive-grade intelligence document that answers one question: "What is actually happening today, why is it happening, and what does it mean for leaders making consequential decisions right now?"

You are an analyst, not a curator. Your job is to reason through the day's signals, find the real story underneath the headlines, and produce insight that cannot be found by reading any single source.

═══════════════════════════════════════════════════════
PRE-ANALYSIS — MANDATORY INTERNAL REASONING (perform before writing)
═══════════════════════════════════════════════════════
Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
{SOURCES}

Work through each step before writing a single word:

1. CORE EVENT: What is the single most consequential development today? Not the most frequently covered topic — the development with the largest downstream effects. Why is this happening today and not last week?

2. UNDERLYING DRIVERS: What structural forces produced this development?
   • Economic: capital flows, rate environment, cost pressures, incentive structures
   • Geopolitical: power competition, alliance fragility, sanctions regimes, sovereignty disputes
   • Technological: new capabilities, adoption tipping points, regulatory pivots
   • Institutional: leadership decisions, governance failures or breakthroughs, policy shifts
   Identify the deepest driver — it is usually not the one the media is foregrounding.

3. SECOND AND THIRD-ORDER EFFECTS: Where do the consequences land beyond the immediate event?
   • Which markets are repricing and why?
   • Which organizational decisions are now forced?
   • Which geopolitical relationships are newly stressed?
   • Which supply chains, energy systems, or governance structures face new pressure?

4. FORWARD HORIZON — 24 to 72 hours and next quarter:
   What specific thresholds, decision points, or signals will determine whether this escalates, stabilizes, or pivots? Name them concretely. What should a senior leader be monitoring tomorrow morning?

5. SOURCE CONFLICTS: Do any sources present contradictory interpretations, data, or claims?
   If yes, you must surface this in the article — name the competing claims, evaluate the evidence on each side, and explain which interpretation is better supported. Never manufacture false consensus.

6. LEADERSHIP IMPLICATION: Based on this causal map, what concrete decisions are now in front of senior leaders — executives, policymakers, board members, institutional heads? Name the decision, name who faces it, and name the timeline.

═══════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════
FORBIDDEN:
✗ Topic-by-topic summaries ("On AI... On the economy... On governance...")
✗ Parallel event descriptions without causal connection
✗ Covering all sources equally regardless of analytical weight
✗ Artificial connections between genuinely unrelated developments
✗ Echoing the dominant media narrative without independent scrutiny
✗ Filler sentences that restate the previous paragraph
✗ Generic language: "this is significant," "this could have major implications" — name the mechanism

REQUIRED:
✓ One central causal argument threading through the entire body
✓ Each paragraph causally follows from the previous
✓ Explicit cause-and-effect relationships — explain WHY, not just THAT
✓ Source disagreements surfaced and evaluated, not smoothed over
✓ Forward-looking: specific signals and thresholds to watch
✓ All claims derived from provided sources

═══════════════════════════════════════════════════════
STRUCTURE
═══════════════════════════════════════════════════════
HEADLINE: One declarative sentence — a causal claim about what is happening today and why. Not a topic list. A Foreign Affairs-style assertion.

EXECUTIVE SUMMARY: Exactly 6 tight sentences. Not 6 summaries of 6 topics. Six facts that together build the complete argument a leader must grasp today.

BODY — 500-650 words of continuous analytical prose. No headers, no bullets, no markdown:

Paragraph 1 — THE CENTRAL DEVELOPMENT: State the most consequential event with precision. Specific facts. No padding.

Paragraph 2 — THE MECHANISM: Explain WHY this is happening and HOW it propagates through the system. Name the economic, geopolitical, or institutional forces at work. Cite sources directly when relevant.

Paragraph 3 — THE CONVERGENCE: Where do today's multiple developments intersect? Map the second and third-order effects across domains. Name the specific leaders, sectors, and systems now under new pressure — and the causal mechanism creating that pressure.

Paragraph 4 — THE STRATEGIC IMPLICATION: What decisions are now forced for senior leaders? Name the specific types of leaders, the specific pressure they face, and the timeline. If sources disagreed, surface both interpretations and evaluate them.

Paragraph 5 — WHAT TO WATCH: 2-3 concrete signals or thresholds — specific, actionable, time-bound — that will determine whether this situation escalates, stabilizes, or pivots in the next 24-72 hours and next quarter.

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return ONLY a valid JSON object:
- headline: string (one declarative causal sentence — not a topic list)
- executiveSummary: string array (exactly 6 tight sentences building today's complete argument)
- body: string (500-650 words of dense analytical prose — no markdown, no headers, no bullets)
- rgiTake: string (3-4 sentences. MANDATORY structure: (1) Open with explicit position: "RGI agrees / partially agrees / disagrees with [today's dominant narrative] because [specific reasoning]." (2) Name the RGI discipline most implicated and explain why this moment tests it. (3) Identify what the media, markets, or policymakers are missing or overstating. (4) State one concrete action leaders must take or stop taking immediately. Voice: declarative, editorial, confident. FORBIDDEN: neutral summary, restating the article, vague conclusions.)
- keyTakeaways: string array of EXACTLY 5 — crisp, actionable, leader-focused. Start each with a strong verb or noun. No filler.
- topicTags: string array (from: ["AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics", "Global Politics", "Wars & Crisis", "Finance & Markets", "Fintech", "Macroeconomics", "Business & Strategy", "Leadership & Organizations", "Energy & Oil", "Climate & Environmental Health", "Supply Chains & Trade", "Policy & Regulation", "Future of Work"])
- discipline: string (one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", "Multiple")
- relevancyScore: number 1-10

Return ONLY valid JSON. No explanation, no markdown code blocks.`;

export async function generateDigestArticle(
  articleIds: number[],
  editorNotes?: string | null
): Promise<{
  headline: string;
  body: string;
  rgiTake: string;
  keyTakeaways: string[];
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
      body: parsed.body || "",
      rgiTake: parsed.rgiTake || "",
      keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
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

const REFINE_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI). An article has already been drafted and the editor has requested specific changes.

CURRENT ARTICLE:
Headline: {HEADLINE}

Body:
{BODY}

RGI Take:
{RGI_TAKE}

Key Takeaways:
{KEY_TAKEAWAYS}

EDITOR'S REFINEMENT INSTRUCTION (MANDATORY — apply this precisely):
{INSTRUCTION}

Rewrite the article following the editor's instruction exactly. Maintain RGI's analytical voice, precision, and format. The instruction is the highest priority — restructure, refocus, shorten, expand, or reframe as directed.

Return ONLY a valid JSON object with these fields:
- headline: string (updated if needed based on instruction)
- body: string (revised article body — clean prose, no markdown, no headers, no bullets in body)
- rgiTake: string (3-4 sentences of RGI editorial opinion — update if instruction affects the take)
- keyTakeaways: string array of EXACTLY 5 crisp actionable insights

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
  rgiTake: string;
  keyTakeaways: string[];
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
    .replace("{BODY}", article.body)
    .replace("{RGI_TAKE}", article.rgiTake || "")
    .replace("{KEY_TAKEAWAYS}", JSON.stringify(article.keyTakeaways || []))
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
      body: parsed.body || article.body,
      rgiTake: parsed.rgiTake || article.rgiTake,
      keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : article.keyTakeaways,
    };

    // Persist the refinement back to the DB
    await db
      .update(digestArticlesTable)
      .set({
        headline: refined.headline,
        body: refined.body,
        rgiTake: refined.rgiTake,
        keyTakeaways: refined.keyTakeaways,
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
      body: parsed.body || "",
      rgiTake: parsed.rgiTake || "",
      keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
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
