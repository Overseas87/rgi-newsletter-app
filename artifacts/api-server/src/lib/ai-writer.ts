import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable, digestArticlesTable, newsletterSubscribersTable } from "@workspace/db";
import { inArray, gte, desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const RGI_SYSTEM_PROMPT = `You are the senior intelligence editor for the Rick Goings Institute (RGI) at Rollins College — an institution dedicated to equipping leaders to build organizations that last, contribute, and stay vital in demanding times.

RGI's three core disciplines:

1. Strategic Foresight: The capacity to anticipate change, read signals in the environment, and position organizations advantageously for futures not yet visible. Encompasses AI acceleration, geopolitical volatility, market transitions, weak signal detection, and pattern recognition across complex systems.

2. System Vitality: The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. Organizations as living systems driven by human energy, trust, purpose, and institutional health.

3. Civic Stewardship: The responsibility leaders bear to the communities and institutions that grant them legitimacy. Corporations as citizens with obligations beyond profit — to civic life, democratic institutions, and long-term community wellbeing.

RGI's editorial standards:
- Synthesizes intelligence, not summaries — always finds the thread connecting disparate signals
- Writes at the level of Harvard Business Review or Foreign Affairs — analytical, rigorous, worth reading twice
- Uses precise, direct language that respects the reader's intelligence and experience
- Never sensationalist — avoids hyperbole, jargon, and empty speculation
- Grounds macro trends in the actual decisions real leaders face right now
- Never fabricates data — derives all analysis from the provided source material
- Prioritizes insight over information, pattern over event, implication over description

RGI's analytical principles — apply these at all times:
- VIEWPOINT AWARENESS: Every source has a perspective. Identify it. Understand what claim or argument the source is actually making before synthesizing or evaluating it.
- CONFLICT DETECTION: When sources present conflicting perspectives, name the disagreement explicitly. Do not flatten contradictory evidence into a false consensus.
- CHALLENGE MAINSTREAM NARRATIVES: Identify when the dominant narrative may be incomplete, exaggerated, or misleading. Apply independent analytical judgment, not editorial group-think.
- LONG-TERM THINKING: Prioritize second and third-order consequences over first-order reactions. Ask: what does this mean in 2, 5, or 10 years?
- RGI TAKES A POSITION: The RGI Take is not a neutral summary. It is editorial opinion grounded in RGI principles. It must clearly state whether RGI agrees, partially agrees, or disagrees with the source material's dominant claim — and explain why with strategic reasoning.
- CREDIBILITY WEIGHTING: Higher-authenticity sources (primary signals, Tier-1 outlets, named experts) carry more analytical weight than speculative or secondary sources. Note when a claim rests on weak sourcing.`;

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief — a premium, analyst-grade intelligence piece that turns a set of source signals into one coherent, argued narrative.

═══════════════════════════════════════════════════════
STEP 1 — ANALYTICAL PRE-WORK (do this silently before writing)
═══════════════════════════════════════════════════════
Before writing a single word of the article, perform this internal analysis:

A) IDENTIFY THE DOMAINS: What distinct topic areas do the sources cover? (e.g., geopolitics, economy, AI, governance, environment)

B) MAP CAUSAL CONNECTIONS: How do these domains interact in the real world right now? Ask:
   - Does development A cause or accelerate development B?
   - Does tension in domain X create pressure in domain Y?
   - Are there feedback loops — does effect B loop back to amplify cause A?
   Example chain: Military conflict → energy supply disruption → commodity price spike → central bank pressure → corporate cost structures → workforce decisions → social stability.

C) FIND THE SINGLE STRONGEST NARRATIVE THREAD: Out of all possible connections, identify the one causal chain that best explains what is actually happening and why it matters. This thread becomes the spine of the entire article. Every paragraph must advance this argument.

D) IDENTIFY WEAK OR FORCED LINKS: If some source topics do not meaningfully connect to the central narrative, do not force them in. A focused article on 3 connected topics is always better than a sprawling overview of 7 disconnected ones.

E) CHECK FOR CONFLICTING EVIDENCE: Do any sources present opposing viewpoints or data? If so, plan to name the disagreement explicitly — do not manufacture false consensus.

═══════════════════════════════════════════════════════
STEP 2 — STRICT RULES BEFORE WRITING
═══════════════════════════════════════════════════════
FORBIDDEN — any of these will make the article fail:
✗ Treating each topic as a separate section ("First, regarding geopolitics... Second, on the economy...")
✗ Writing "Topic A is important. Topic B is also important." without connecting them causally
✗ Covering all sources equally — weight them by strength of connection to the central narrative
✗ Artificial connections — if two topics don't genuinely interact, say so and focus on those that do
✗ Echoing the most common media narrative without analytical scrutiny
✗ Neutral hedging in the RGI Take — it must take a clear position

REQUIRED:
✓ One continuous causal argument from paragraph 1 through the end
✓ Each paragraph must follow logically from the previous — the reader should feel the narrative pull
✓ Cause → Effect → Implication must be traceable through the entire body
✓ If sources conflict, name the disagreement and evaluate the evidence
✓ Higher-authenticity sources carry more analytical weight

ATTRIBUTION RULE: When a source is marked [PRIMARY SIGNAL], attribute directly: "In a post on X, [name] stated…" or "In an official announcement, [company] declared…" — never as a news report.

═══════════════════════════════════════════════════════
STEP 3 — SOURCE MATERIAL
═══════════════════════════════════════════════════════
{SOURCES}

═══════════════════════════════════════════════════════
STEP 4 — EDITORIAL DIRECTION (MANDATORY PRIORITY)
═══════════════════════════════════════════════════════
{NOTES}
This direction is the highest priority. It must shape the entire article — its central argument, angle, emphasis, and conclusion. If no specific direction is given, use your analytical judgment to find the strongest causal narrative in the sources.

═══════════════════════════════════════════════════════
STEP 5 — WRITE THE ARTICLE
═══════════════════════════════════════════════════════
The body follows this causal logic as continuous flowing prose (no labeled sections, no headers, no bullets):

PARAGRAPH 1 — THE CATALYST: What is the central development that started the chain? Frame it precisely with specific facts from the sources. Do not pad. One tight paragraph.

PARAGRAPH 2 — THE MECHANISM: How does this development propagate? What system or relationship does it operate through? This is the causal bridge — explain WHY one thing leads to another, not just THAT it does.

PARAGRAPH 3 — THE CONVERGENCE: Where do the effects land? What second and third-order consequences are becoming visible across domains? Name which leaders, industries, and systems are now under pressure — and why.

PARAGRAPH 4 — THE INFLECTION POINT: What decision or threshold is approaching? What are the 1-2 things to watch that will determine whether this situation stabilizes or escalates?

Requirements:
- Body: 450-600 words. Every sentence must advance the argument.
- Flowing prose only — no bullet points, no visible headers, no markdown
- Analytical voice — explain mechanisms, not just outcomes
- All claims trace to provided sources — no fabrication

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return ONLY a valid JSON object with these exact fields:
- headline: string (one declarative analytical sentence — captures the causal argument, not just a topic. Foreign Affairs style. No colons.)
- body: string (the complete 450-600 word brief — clean prose, no markdown, no visible structure)
- rgiTake: string (3-4 sentences of unapologetic RGI editorial opinion. MUST: (1) state explicitly whether RGI agrees, partially agrees, or disagrees with the dominant claim in the sources — and WHY with reasoning; (2) name the RGI discipline; (3) challenge any incomplete or misleading narrative; (4) tell leaders what to do or stop doing. Declarative voice: "RGI takes the view that...", "The evidence does not support...", "This marks a structural shift..." Forbidden: neutral hedging, restating what sources said.)
- keyTakeaways: string array of EXACTLY 5 items — short, crisp, actionable insights. Start each with a strong verb or noun. Scannable in 10 seconds. No filler.
- topicTags: string array (from: ["AI & Artificial Intelligence", "Technology & Digital Innovation", "Geopolitics", "Global Politics", "Wars & Crisis", "Finance & Markets", "Fintech", "Macroeconomics", "Business & Strategy", "Leadership & Organizations", "Energy & Oil", "Climate & Environmental Health", "Supply Chains & Trade", "Policy & Regulation", "Future of Work"])
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number 1-10

Return ONLY valid JSON. No explanation, no markdown code blocks, no preamble.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
The above direction MUST shape the emphasis, angle, and framing of the brief. Apply it throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Strategic Intelligence Brief — an executive-grade intelligence document that answers one question: "What is actually happening today, how are these developments connected, and why does it matter for leaders?"

═══════════════════════════════════════════════════════
PRE-ANALYSIS (perform silently before writing)
═══════════════════════════════════════════════════════
Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
{SOURCES}

Before writing, work through these steps internally:

1. FIND THE DOMINANT FORCE: What is the single most consequential development in today's feed? Not the most common topic — the one with the largest downstream effects.

2. MAP THE CAUSAL WEB: How does today's dominant development interact with other themes? Build cause-and-effect chains:
   - What triggered what?
   - What pressure is flowing from one domain into another?
   - Which second and third-order effects are already visible?
   Example: AI chip export restrictions → semiconductor supply constraint → corporate AI investment delays → talent market shift → geopolitical tech decoupling → central bank uncertainty.

3. IDENTIFY THE STRONGEST CONNECTIONS: Weight sources by their authenticity scores and causal relevance to the central narrative. Ignore sources that don't connect meaningfully.

4. FLAG CONFLICTS: Do any sources contradict each other? Plan to surface the disagreement, not smooth it over.

5. DETERMINE WHAT LEADERS FACE: Based on this causal map, what concrete decisions are now on the table for senior leaders?

═══════════════════════════════════════════════════════
STRICT RULES
═══════════════════════════════════════════════════════
FORBIDDEN:
✗ Treating each topic as its own section ("On AI... On the economy... On governance...")
✗ Parallel summaries of unconnected events
✗ Covering all sources equally regardless of relevance to the central narrative
✗ Forcing artificial connections between genuinely unrelated developments
✗ Echoing the dominant media narrative without independent analytical scrutiny

REQUIRED:
✓ One central causal argument running through the entire body
✓ Each paragraph must follow logically and causally from the previous
✓ Explicitly name cause-and-effect relationships — don't just list events
✓ Surface conflicting evidence when present
✓ Ground all analysis in specific sources

═══════════════════════════════════════════════════════
STRUCTURE
═══════════════════════════════════════════════════════
HEADLINE: One declarative sentence naming today's most important causal development. Not a topic list — a claim about what is actually happening and why.

EXECUTIVE SUMMARY: Exactly 6 bullet points. Each is one tight sentence. Not 6 summaries of 6 different topics — 6 facts that together build the argument a leader must understand today.

BODY (flowing prose, no visible headers, no bullets, no markdown — 500-650 words):

Paragraph 1 — THE CENTRAL DEVELOPMENT: What happened? State the most significant event or signal from today's feed with precision. Use specific facts from sources.

Paragraph 2 — THE MECHANISM: Why is this happening, and how does it propagate? Explain the causal system at work. Reference sources explicitly: "The Financial Times reported...", "According to Bloomberg...", "In a direct post on X, [name] stated..." Do not just describe — explain why one thing leads to another.

Paragraph 3 — THE CONVERGENCE: Where do multiple developments intersect? What connections across domains (geopolitics, economy, technology, governance, etc.) are now becoming visible? This paragraph builds the cross-theme intelligence — but as causal argument, not parallel summary.

Paragraph 4 — THE STRATEGIC IMPLICATION: What decisions are now in front of senior leaders? What changes for organizations, markets, or policy as a result? Name which specific types of leaders face which specific pressures, and on what timeline.

Paragraph 5 — WHAT TO WATCH: 2-3 concrete leading indicators or decision points that will determine whether this situation escalates, stabilizes, or shifts in an unexpected direction.

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return ONLY a valid JSON object:
- headline: string (one declarative sentence — a causal claim about today, not a topic list)
- executiveSummary: string array (exactly 6 tight sentences — facts that together build today's argument)
- body: string (500-650 words of clean flowing prose — no markdown, no headers, no bullets)
- rgiTake: string (3-4 sentences of unapologetic RGI editorial opinion. MUST: (1) state explicitly whether RGI agrees, partially agrees, or disagrees with today's dominant narrative — and WHY; (2) name the RGI discipline(s) most implicated; (3) identify what leaders must do differently; (4) take a definitive stand. Forbidden: neutral hedging, summarizing articles, vague conclusions.)
- keyTakeaways: string array of EXACTLY 5 items — crisp, actionable insights for leaders. Start each with a strong verb or noun. No filler.
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
}> {
  const articles = await db
    .select()
    .from(articlesTable)
    .where(inArray(articlesTable.id, articleIds));

  if (articles.length === 0) {
    throw new Error("No articles found with provided IDs");
  }

  const sourcesText = articles
    .map(
      (a, i) => {
        const isPrimary = (a as any).isPrimarySignal;
        const authenticityScore = (a as any).authenticityScore ?? 5;
        const viewpoint = (a as any).viewpoint;
        const signalType = isPrimary
          ? `[PRIMARY SIGNAL — direct ${a.platform === "twitter" ? "post on X" : a.platform === "linkedin" ? "post on LinkedIn" : "statement"}${a.author ? ` from ${a.author}${a.authorType ? `, ${a.authorType}` : ""}` : ""}]`
          : "";
        const credibilityLabel = authenticityScore >= 8 ? "HIGH" : authenticityScore >= 6 ? "MODERATE" : "LOW";
        return `SOURCE ${i + 1}${signalType ? " " + signalType : ""}:\nHeadline: ${a.headline}\nPublication: ${a.sourceName}${a.author ? `\nAuthor: ${a.author}${a.authorType ? ` (${a.authorType})` : ""}` : ""}${a.platform && a.platform !== "news" ? `\nPlatform: ${a.platform}` : ""}\nAuthenticity: ${authenticityScore}/10 (${credibilityLabel} credibility)${viewpoint ? `\nViewpoint: ${viewpoint}` : ""}\nURL: ${a.url}\nContent: ${(a.content || a.teaserSummary || a.headline).slice(0, 4000)}`;
      }
    )
    .join("\n\n---\n\n");

  const notesText = editorNotes?.trim()
    ? editorNotes.trim()
    : "No specific editorial direction — apply your best analytical judgment to identify the most important pattern across the provided sources.";
  const prompt = SYNTHESIS_PROMPT.replace("{SOURCES}", sourcesText).replace("{NOTES}", notesText);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);
    return {
      headline: parsed.headline || "Untitled Brief",
      body: parsed.body || "",
      rgiTake: parsed.rgiTake || "",
      keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways : [],
      topicTags: parsed.topicTags || [],
      discipline: parsed.discipline || "Multiple",
      relevancyScore: parsed.relevancyScore || 7,
    };
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
    max_tokens: 8192,
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
  let articles;

  if (articleIds && articleIds.length > 0) {
    articles = await db
      .select()
      .from(articlesTable)
      .where(inArray(articlesTable.id, articleIds));
  } else {
    // Auto-select: today's articles with score >= 6.5, up to 20 by relevance
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    articles = await db
      .select()
      .from(articlesTable)
      .where(gte(articlesTable.scrapedAt, today))
      .orderBy(desc(articlesTable.relevancyScore))
      .limit(20);

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
    .map(
      (a, i) => {
        const authenticityScore = (a as any).authenticityScore ?? 5;
        const viewpoint = (a as any).viewpoint;
        const credibilityLabel = authenticityScore >= 8 ? "HIGH" : authenticityScore >= 6 ? "MODERATE" : "LOW";
        return `SOURCE ${i + 1}:\nHeadline: ${a.headline}\nPublication: ${a.sourceName}${a.author ? `\nAuthor: ${a.author}` : ""}${a.platform && a.platform !== "news" ? `\nPlatform: ${a.platform}` : ""}\nTopics: ${a.topicTags.join(", ")}\nRelevancy: ${a.relevancyScore}/10 | Authenticity: ${authenticityScore}/10 (${credibilityLabel})${a.isEmergingSignal ? "\n[EMERGING SIGNAL]" : ""}${viewpoint ? `\nViewpoint: ${viewpoint}` : ""}\nURL: ${a.url}\nContent: ${(a.content || a.teaserSummary || a.headline).slice(0, 3000)}`;
      }
    )
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
    max_tokens: 16384,
    system: RGI_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "{}";

  try {
    const cleanText = text.trim().replace(/^```json\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(cleanText);

    return {
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
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse daily brief response");
    throw new Error("Failed to parse AI-generated daily brief");
  }
}
