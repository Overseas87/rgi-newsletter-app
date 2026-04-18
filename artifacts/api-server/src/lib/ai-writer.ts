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

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief. Reason deeply before writing — your job is to produce insight a senior leader cannot find anywhere else.

SOURCE MATERIAL:
{SOURCES}

EDITORIAL DIRECTION:
{NOTES}

═══════════════════════════════════════════════════════
INTERNAL PRE-WORK (do silently before writing)
═══════════════════════════════════════════════════════
1. What precisely happened? Strip media framing — identify the underlying fact.
2. Why now? Name the economic, geopolitical, technological, or institutional driver.
3. Who is under new pressure, and through what mechanism?
4. What signals or thresholds determine how this resolves in the next 72 hours and next quarter?
5. Does the dominant narrative miss or overstate something? Take a position.

═══════════════════════════════════════════════════════
OUTPUT — STRUCTURED ARTICLE FORMAT
═══════════════════════════════════════════════════════
Total article: 300–500 words. Scannable. No long prose blocks.

HEADLINE: One declarative sentence. A causal claim — not a topic list. Foreign Affairs style.

EXECUTIVE SUMMARY (2–3 sentences): What happened and why it matters. Immediate and direct.

KEY DEVELOPMENTS (3–5 bullets): The most important facts. One clear sentence each.

WHY IT MATTERS (2–3 bullets): Direct implications for senior leaders. Name mechanisms, not abstractions.

RGI TAKE (2–3 sentences): Open with explicit position — "RGI agrees / partially agrees / disagrees with [claim] because [reasoning]." State what the media or sources are missing. End with one concrete action or decision leaders must face.

WHAT TO WATCH (2–3 bullets): Forward-looking signals in the next 24–72 hours or next quarter. Specific and time-bound.

RULES:
✗ No generic language: "this is significant," "could have major implications" — name the mechanism
✗ No neutral hedging in the RGI Take
✗ No bullet that repeats another bullet — every point adds distinct value
✓ All claims trace to provided sources — no fabrication
✓ If sources conflict, name the disagreement in Key Developments or RGI Take
✓ Every sentence earns its place

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
{
  "headline": "string — one declarative causal sentence",
  "executiveSummary": ["sentence 1", "sentence 2", "sentence 3"],
  "keyDevelopments": ["development 1", "development 2", "development 3", "development 4"],
  "whyItMatters": ["implication 1", "implication 2", "implication 3"],
  "rgiTake": "string — 2-3 sentences with explicit position, what media misses, and one concrete leader action",
  "whatToWatch": ["signal 1", "signal 2", "signal 3"],
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1–3 only from this exact list):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets", "Technology & AI",
"Innovation & Digital Transformation", "Business Strategy & Corporations", "Leadership & Organizations",
"Energy & Resources", "Supply Chains & Global Trade", "Policy, Regulation & Governance",
"Climate & Environmental Systems", "Future of Work & Society"

Return ONLY valid JSON. No markdown code blocks.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
Apply this throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Strategic Intelligence Brief — an executive-grade document that answers: "What is actually happening today, why, and what must leaders do?"

Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
{SOURCES}

═══════════════════════════════════════════════════════
INTERNAL PRE-WORK (do silently)
═══════════════════════════════════════════════════════
1. What is the single most consequential development today — and why today, not last week?
2. What structural force (economic, geopolitical, technological, institutional) is the deepest driver?
3. Where do the second and third-order effects land — markets, organizations, supply chains, governance?
4. What specific signals or decision points determine how this resolves in the next 72 hours and next quarter?
5. What are sources getting wrong or overstating? Do any sources conflict — name it if so.

═══════════════════════════════════════════════════════
OUTPUT — STRUCTURED ARTICLE FORMAT
═══════════════════════════════════════════════════════
Total: 300–500 words. Highly scannable. No long text blocks.

HEADLINE: One declarative sentence. A causal claim about what is happening and why — not a topic list.

EXECUTIVE SUMMARY (2–3 sentences): The most important development and why it matters right now. Direct, no hedging.

KEY DEVELOPMENTS (3–5 bullets): The most important facts across today's signals. One clear sentence each. No topic-by-topic summaries — connect causally.

WHY IT MATTERS (2–3 bullets): What this forces for senior leaders — executives, policymakers, board members. Name mechanisms, not abstractions.

RGI TAKE (2–3 sentences): Open with "RGI agrees / partially agrees / disagrees with [dominant narrative] because [reasoning]." Name what markets, media, or policymakers are missing. State one concrete thing leaders must do or stop doing.

WHAT TO WATCH (2–3 bullets): Specific signals, thresholds, or decision points to monitor in the next 24–72 hours and next quarter.

RULES:
✗ No topic-by-topic summaries — find the thread across developments
✗ No generic language: name mechanisms, not "significance"
✗ No neutral hedging in RGI Take
✓ Surface source conflicts if they exist — do not manufacture consensus
✓ All claims trace to provided sources

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
{
  "headline": "string — one declarative causal sentence",
  "executiveSummary": ["sentence 1", "sentence 2", "sentence 3"],
  "keyDevelopments": ["development 1", "development 2", "development 3", "development 4"],
  "whyItMatters": ["implication 1", "implication 2", "implication 3"],
  "rgiTake": "string — 2-3 sentences with explicit position, what's missing, and one leader action",
  "whatToWatch": ["signal 1", "signal 2", "signal 3"],
  "topicTags": ["from the 12 allowed tags only"],
  "discipline": "Strategic Foresight | System Vitality | Civic Stewardship | Multiple",
  "relevancyScore": 1-10
}

Allowed topic tags (choose 1–3 only from this exact list):
"Geopolitics & Global Power", "Economics & Macroeconomics", "Finance & Markets", "Technology & AI",
"Innovation & Digital Transformation", "Business Strategy & Corporations", "Leadership & Organizations",
"Energy & Resources", "Supply Chains & Global Trade", "Policy, Regulation & Governance",
"Climate & Environmental Systems", "Future of Work & Society"

Return ONLY valid JSON. No markdown code blocks.`;

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

const REFINE_PROMPT = `You are the senior intelligence editor at the Rick Goings Institute (RGI). An article has been drafted and the editor has requested specific changes.

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

EDITOR'S REFINEMENT INSTRUCTION (apply this precisely — it overrides all other considerations):
{INSTRUCTION}

Rewrite the article following the editor's instruction exactly. Maintain RGI's analytical voice and the structured format. Keep the total article under 500 words.

Return ONLY a valid JSON object:
- headline: string (update if instruction requires)
- executiveSummary: string array (2–3 sentences — what happened and why it matters)
- keyDevelopments: string array (3–5 bullets — key facts, one sentence each)
- whyItMatters: string array (2–3 bullets — implications for senior leaders)
- rgiTake: string (2–3 sentences with explicit position, what media misses, one leader action)
- whatToWatch: string array (2–3 forward-looking signals, specific and time-bound)

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
