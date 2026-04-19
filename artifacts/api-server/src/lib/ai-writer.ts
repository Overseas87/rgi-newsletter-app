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
  rgiTake: string; keyTakeaways: string[];
  implificationsForLeaders: string[]; whatChangedSinceYesterday: string[];
  whatToWatch: string[]; summaryTakeaways: string[];
  whatMostAreMissing: string | null; mechanism: string[]; constraintsAndRisks: string[];
  topicTags: string[]; discipline: string; relevancyScore: number; sourceArticleIds: number[];
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

const SYNTHESIS_PROMPT = `You are a senior strategic intelligence analyst at the Rick Goings Institute (RGI).

Your role is to produce high-conviction, decision-relevant intelligence briefs for executives and investors.

Your output must not resemble journalism or general analysis. It must demonstrate clear prioritization, original insight, causal reasoning, and strategic relevance.

SOURCE MATERIAL:
{SOURCES}

EDITORIAL DIRECTION:
{NOTES}

---

# I. CORE OBJECTIVE

Identify and explain:
1. What is ACTUALLY driving the situation (not the surface narrative)
2. What informed observers are misinterpreting
3. What mechanism will translate this into real-world consequences

If your analysis does not change how a sophisticated reader interprets the situation, it is insufficient.

---

# II. CENTRAL INSIGHT REQUIREMENT (CRITICAL)

Before writing, determine ONE core insight that is:
- non-obvious
- decision-relevant
- not explicitly stated in sources

This insight must be explicitly stated, structurally central, and repeated consistently throughout the brief.

If the insight is weak or generic, regenerate it before writing.

---

# III. SIGNAL FILTERING

Only include information that directly supports the core insight.

Remove:
- interesting but non-essential details
- secondary stories that dilute focus
- background already known to an informed reader

Every included element must answer: "Does this strengthen or clarify the core insight?"

---

# IV. OUTPUT STRUCTURE (STRICT)

## Title
Must reflect the core insight, not the headline event.

## Executive Analysis (max 100 words)
- What changed (structurally)
- Core insight
- Immediate implication

## What Actually Matters (3–4 bullets ONLY)
Each must directly support the core insight and explain WHY it matters.

## What Most Are Missing (PRIMARY SECTION)
- Clearly state the flawed assumption or misinterpretation
- Directly contrast common view vs correct interpretation
- This is the most important section

## Mechanism (MANDATORY – 5 STEPS)
Explain the causal chain:
1. Trigger event
2. Immediate actor response
3. Constraint or incentive forcing behavior
4. Market/institutional reaction
5. Second-order consequence

Each step must logically lead to the next. No vague transitions.

## Implications for Decision-Makers
Must be specific and operational. Include: action, timing, rationale. Avoid generic language.

## Constraints & Where This Could Break
List 2 key assumptions. Explain what would invalidate your thesis and how that would change outcomes.

## RGI Take
Clear, concise, high-conviction conclusion. No rhetorical language. No repetition.
Open with: "RGI [agrees / partially agrees / disagrees] with [dominant narrative] because [precise reasoning]."
A neutral Take is a failure of analysis.

## What to Watch
Only include signals that would confirm OR invalidate the core insight. Must be precise and time-bound.

---

# V. ANALYTICAL DISCIPLINE

1. No Overstatement — do not present inference as certainty. Use conditional phrasing where appropriate.
2. Precision Over Impact — avoid dramatic phrasing unless supported. Replace vague intensity with clear logic.
3. Mechanism > Assertion — every claim must be explained, not declared.
4. Focus > Coverage — depth is more important than breadth. One strong insight is better than five weak ones.

---

# VI. STYLE

Direct, analytical, and controlled. No performative language. No unnecessary adjectives. No repetition.
Write like a strategist briefing a decision-maker, not persuading an audience.

Forbidden:
- Summarizing news without interpretation
- Repeating obvious insights
- Listing risks without explaining mechanisms
- Vague or non-actionable recommendations
- Generic phrases: "this is significant," "remains to be seen," "could have major impact"

---

# VII. FINAL CHECK (answer silently — if NO, revise before outputting)

1. Is there ONE clear core insight?
2. Is everything in the article supporting it?
3. Is the mechanism fully explicit?
4. Is any low-signal information included? (if yes, remove it)
5. Are claims appropriately qualified?

---

OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble:
{
  "headline": "string — 8-12 words, true strategic insight not surface event, Bloomberg/Reuters style",
  "executiveSummary": ["what changed structurally", "core insight", "immediate implication"],
  "keyDevelopments": ["high-signal bullet with causal WHY 1", "high-signal bullet 2", "high-signal bullet 3", "high-signal bullet 4"],
  "whatMostAreMissing": "string — one paragraph. Clearly state the flawed assumption or misinterpretation. Contrast common view vs correct interpretation. The intellectual core.",
  "mechanism": ["Step 1 — Trigger event: ...", "Step 2 — Immediate actor response: ...", "Step 3 — Constraint or incentive forcing behavior: ...", "Step 4 — Market/institutional reaction: ...", "Step 5 — Second-order consequence: ..."],
  "whyItMatters": ["actionable implication with action/timing/rationale 1", "implication 2", "implication 3"],
  "constraintsAndRisks": ["assumption 1 and what would invalidate thesis + how outcome changes", "assumption 2 and invalidation condition"],
  "rgiTake": "string — agrees/partially agrees/disagrees + what is being missed + one concrete leader action",
  "whatToWatch": ["confirming/invalidating signal with precise timeframe 1", "signal 2", "signal 3"],
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

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Intelligence Brief — a concise executive brief readable in under 2 minutes, fully readable in under 5. Every word earns its place. No background. No padding.

Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
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

═══════════════════════════════════════════════════════
STRICT FORMAT — 9 sections, ~300–500 words total
═══════════════════════════════════════════════════════

HEADLINE: 8–12 words maximum. Lead with the key actor and action. Use a dash or colon to add the sharpest consequence. Must be scannable in 3 seconds — no subordinate clauses, no jargon. Think Bloomberg/Reuters, not Foreign Affairs. Format: "[Actor] [Action] [What] — [Consequence]" or "[Event]: [Impact]". Examples: "Trump Threatens Iran — Hormuz Deal at Risk" / "Fed Holds Rates as Trade War Pressure Builds" / "China Dumps Treasuries: Dollar Risk Returns".

EXECUTIVE SUMMARY (2–3 sentences): Core development + most important implication. No hedging. Each sentence adds distinct information — never repeat the headline.

KEY DEVELOPMENTS (3–5 bullets): One analytical sentence per bullet. Name mechanism, actor, timeline. Find the causal thread — do not list disconnected facts. Each bullet must be distinct.

WHY IT MATTERS (2–3 bullets): Second-order implications. Who faces pressure, through what channel, on what timeline. Name the mechanism. No abstractions.

WHAT MOST ARE MISSING (THE CORE SECTION — one paragraph): Identify ONE: a flawed market assumption, a misleading narrative, or a hidden structural dynamic. Be explicit and direct. This is the intellectual center of the brief.

MECHANISM (exactly 4 steps — every step logically connected):
  Step 1 — Trigger: What set this in motion?
  Step 2 — Immediate reaction: First-order response across markets, actors, institutions.
  Step 3 — System response: How interconnected systems absorb or amplify.
  Step 4 — Secondary effects: What this forces, constrains, or makes inevitable next.

IMPLICATIONS FOR DECISION-MAKERS (2–3 bullets): Actionable and specific. For each: what to do, when to act, what risk or opportunity this addresses.

CONSTRAINTS AND RISKS TO THIS VIEW (2–3 bullets): State the key assumptions. For each: explain how being wrong changes the conclusion.

RGI TAKE (2–3 sentences):
  Sentence 1: "RGI [agrees / partially agrees / disagrees] with [the dominant narrative] because [precise reasoning]."
  Sentence 2: Name exactly what markets, media, or policymakers are missing, overstating, or failing to see.
  Sentence 3: One concrete forward-looking action or risk leaders must confront now.
  A neutral or hedged Take is a failure. Take a position.

WHAT CHANGED SINCE YESTERDAY (2–3 bullets): Compare with the previous brief. Name meaningful shifts, reversals, or new developments. If no previous brief is available, write: ["No prior brief available for comparison — this is a baseline reading."]

WHAT TO WATCH NEXT (2–3 bullets): Time-bound signals, decision points, or thresholds. Each bullet names what to look for and why it matters if it occurs. (next 24–72 hours / next quarter)

KEY TAKEAWAYS (exactly 3 bullets): The three most important insights from the entire brief. Simple, direct, non-repetitive. A reader who reads only these three points should understand the essence.

ABSOLUTE RULES:
✗ No long paragraphs — bullets everywhere possible
✗ No repetition across sections
✗ No vague language — name the mechanism, actor, timeline
✗ No generic phrases: "significant implications," "remains to be seen," "could have major impact"
✗ No fabrication — all claims trace to provided sources
✓ Surface source conflicts explicitly
✓ Every sentence adds new information or analysis

═══════════════════════════════════════════════════════
OUTPUT FORMAT — return ONLY valid JSON, no markdown, no preamble
═══════════════════════════════════════════════════════
{
  "headline": "string — 8 to 12 words, actor + action + consequence, scannable in 3 seconds, Bloomberg/Reuters style",
  "executiveSummary": ["sentence 1", "sentence 2"],
  "keyDevelopments": ["bullet 1", "bullet 2", "bullet 3", "bullet 4"],
  "whyItMatters": ["implication 1", "implication 2", "implication 3"],
  "whatMostAreMissing": "string — one paragraph: the flawed assumption, misleading narrative, or hidden structural dynamic. The intellectual core.",
  "mechanism": ["Step 1 — Trigger: ...", "Step 2 — Immediate reaction: ...", "Step 3 — System response: ...", "Step 4 — Secondary effects: ..."],
  "implificationsForLeaders": ["actionable implication with what/when/risk 1", "implication 2", "implication 3"],
  "constraintsAndRisks": ["assumption 1 and how being wrong changes conclusion", "assumption 2", "assumption 3"],
  "rgiTake": "string — agrees/partially agrees/disagrees + what is being missed + one concrete leader action",
  "whatChangedSinceYesterday": ["shift 1", "shift 2", "shift 3"],
  "whatToWatch": ["signal 1 with timeframe", "signal 2", "signal 3"],
  "summaryTakeaways": ["takeaway 1", "takeaway 2", "takeaway 3"],
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
      whatMostAreMissing: typeof parsed.whatMostAreMissing === "string" ? parsed.whatMostAreMissing : null,
      mechanism: Array.isArray(parsed.mechanism) ? parsed.mechanism : [],
      constraintsAndRisks: Array.isArray(parsed.constraintsAndRisks) ? parsed.constraintsAndRisks : [],
      implificationsForLeaders: Array.isArray(parsed.whyItMatters) ? parsed.whyItMatters : (Array.isArray(parsed.implificationsForLeaders) ? parsed.implificationsForLeaders : []),
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
  excludedTopics?: string[],
  previousBriefContext?: string | null
): Promise<DailyBriefResult> {
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

  const previousBriefSection = previousBriefContext
    ? `═══════════════════════════════════════════════════════\nYESTERDAY'S BRIEF (for "What Changed Since Yesterday" comparison)\n═══════════════════════════════════════════════════════\n${previousBriefContext}\n\n`
    : "";

  const prompt = (DAILY_BRIEF_PROMPT + editorialSuffix)
    .replace("{SOURCE_COUNT}", String(articles.length))
    .replace("{THEME_COUNT}", String(topicSet.size))
    .replace("{SOURCES}", sourcesText)
    .replace("{PREVIOUS_BRIEF_SECTION}", previousBriefSection);

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
      implificationsForLeaders: Array.isArray(parsed.implificationsForLeaders) ? parsed.implificationsForLeaders : [],
      whatMostAreMissing: typeof parsed.whatMostAreMissing === "string" ? parsed.whatMostAreMissing : null,
      mechanism: Array.isArray(parsed.mechanism) ? parsed.mechanism : [],
      constraintsAndRisks: Array.isArray(parsed.constraintsAndRisks) ? parsed.constraintsAndRisks : [],
      whatChangedSinceYesterday: Array.isArray(parsed.whatChangedSinceYesterday) ? parsed.whatChangedSinceYesterday : [],
      whatToWatch: Array.isArray(parsed.whatToWatch) ? parsed.whatToWatch : [],
      summaryTakeaways: Array.isArray(parsed.summaryTakeaways) ? parsed.summaryTakeaways : [],
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
