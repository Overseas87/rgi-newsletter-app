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

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief — a premium, editor-curated intelligence piece synthesizing multiple source articles into a single coherent analysis.

CRITICAL INSTRUCTION: Do NOT summarize these articles individually. Instead, read them as a collection of signals. Identify what they have in common. Extract the underlying pattern. Then write ONE integrated piece that reveals the deeper narrative connecting them all.

ATTRIBUTION RULE: When a source is marked [PRIMARY SIGNAL], that is a direct, original statement or announcement. Attribute it as such: "In a direct post on X, [name/company] stated…" or "In an official announcement, [company] declared…" — never attribute primary signals as if they are news reports. Primary signals can carry equal or greater weight than news articles reporting on the same topic.

VIEWPOINT & CREDIBILITY RULES:
- Each source carries a viewpoint and an authenticity level. Higher-authenticity sources deserve more weight.
- Identify the dominant perspective across sources. If sources conflict, name the disagreement explicitly — do not manufacture false consensus.
- When sources present contradictory claims, analyze both sides and explain which evidence is more robust and why.
- Do not echo the most common narrative by default. Ask: is this narrative complete? Is it potentially exaggerated or misleading? Apply independent analytical judgment.

Source Articles (synthesize ALL of these into one unified brief):
{SOURCES}

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
The above direction MUST shape the entire article — its angle, tone, emphasis, and structure. This is not a suggestion. If the editor specifies a focus, lead with it. If the editor names a specific angle or audience, build the entire piece around it. The final article must clearly and unmistakably reflect these instructions.

Write a concise, focused brief following this three-part logic in the body (flowing prose, no labeled sections):

1. WHAT IS HAPPENING — Frame the key development with precision. Use specific facts and examples from the sources. Be direct — one tight paragraph that sets the context without padding.

2. THE PATTERN — What connects these signals? Identify the underlying trend or tension. If sources disagree, name the disagreement and analyze it. Why does this matter now? This is the analytical heart.

3. IMPLICATIONS FOR LEADERS — Who is affected, how, and on what timeline? Be concrete about risk, opportunity, and the decisions leaders face as a result. End with 1-2 things to watch.

Requirements:
- Body: 400-600 words. Be ruthlessly concise. Every sentence must earn its place.
- Write as clean, flowing prose — no bullet points, no visible headers, no markdown in the body
- Analytical and direct — avoid padding, vague generalities, and filler transitions
- All claims must trace to the provided sources

Return ONLY a valid JSON object with these exact fields:
- headline: string (strong, direct, analytical — not clickbait; no colons; written as a senior editor would headline a Foreign Affairs piece)
- body: string (the complete 400-700 word brief as described — clean prose only, no markdown, no headers, no bullets)
- rgiTake: string (3-4 sentences of unapologetic editorial OPINION from RGI. This MUST: (1) explicitly state whether RGI agrees, partially agrees, or disagrees with the dominant claim in the source material — and WHY; (2) name the specific RGI discipline; (3) challenge the narrative if it is incomplete or misleading; (4) connect to what leaders must do or stop doing. Use declarative voice: "RGI takes the view that...", "The evidence here does not support...", "This marks a turning point...", "The strategic imperative is clear:". Forbidden: neutral hedging, summarizing what the sources said, vague conclusions like "leaders should be aware.")
- keyTakeaways: string array of EXACTLY 5 items — each a short, crisp, actionable insight a leader can act on. Start each with a strong verb or noun. No filler. Scannable in 10 seconds.
- topicTags: string array (choose only from: ["AI", "Leadership", "Geopolitics", "Finance", "Environmental Health", "Central Florida", "Strategy", "Culture", "Technology", "Policy", "Education", "Economy", "Innovation", "Governance", "Health", "Democracy", "Future of Work", "Sustainability"])
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number 1-10 (how strategically significant this is for senior leaders at the intersection of business, policy, and society)

Return ONLY valid JSON. No explanation, no markdown code blocks, no preamble.`;

const DAILY_BRIEF_EDITORIAL_SUFFIX = `

EDITORIAL DIRECTION — MANDATORY PRIORITY:
{NOTES}
The above direction MUST shape the emphasis, angle, and framing of the brief. Apply it throughout — not just in one section.`;

const DAILY_BRIEF_PROMPT = `You are writing the RGI Daily Strategic Intelligence Brief — a comprehensive executive briefing that synthesizes everything that matters from today's intelligence feed into one authoritative, well-structured analysis.

CRITICAL INSTRUCTION: This is NOT a list of article summaries. It is an executive intelligence document that answers: "What happened today — and why does it matter for leaders?" You must identify underlying patterns, connections between separate events, and the strategic implications that only emerge when you read all sources together.

Today's Sources ({SOURCE_COUNT} articles across {THEME_COUNT} thematic areas):
{SOURCES}

Structure the brief as follows. Each section flows as polished prose — no bullet points in the body sections, no visible section labels in the text itself:

HEADLINE: A single declarative sentence summarizing the day's most important strategic development. Not a list. Not vague. One clear, strong, analytical sentence.

EXECUTIVE SUMMARY: Exactly 6 bullet points. Each bullet is one tight sentence stating a specific development and its significance. These should be the 6 things a senior leader absolutely must know from today.

BODY (write as flowing prose paragraphs, following this internal logic in order):
1. The Day's Dominant Narrative — what was the central story or tension that unified today's most significant developments?
2. Thematic Deep Dives — for each major theme (3-5 themes), one paragraph synthesizing all relevant sources. Explicitly reference sources: "According to Bloomberg..." or "In a post on X..." or "The Financial Times reported..." Do not just describe events — connect them to larger patterns.
3. Cross-Theme Intelligence — what connections and patterns emerge when you look across all themes simultaneously? What does the day's full picture reveal that no single story makes visible?
4. RGI Perspective — how do today's developments illuminate one or more of RGI's three disciplines: Strategic Foresight, System Vitality, or Civic Stewardship? Be specific about which leaders and organizations face which decisions as a result.
5. Why This Matters for Leaders — what should senior leaders do differently, watch more carefully, or think about differently as a result of today's intelligence? 2-3 concrete, decision-relevant observations.

Requirements:
- Total body word count: 500-700 words — tight, authoritative, scannable. Target 500 words.
- Tone: HBR/Foreign Affairs — analytical, rigorous, free of hype
- No emojis, no informal language, no vague generalities
- Every claim traces back to a source in the provided articles — no fabrication
- The brief must read as a coherent document, not a sequence of summaries

Return ONLY a valid JSON object with these fields:
- headline: string (the day's single most important strategic development, one declarative sentence)
- executiveSummary: string array (exactly 6 bullet strings, each one tight sentence — the 6 things a senior leader must know today)
- body: string (the full 600-800 word prose brief as described above — no markdown, no headers, no bullets in the body)
- rgiTake: string (3-4 sentences of unapologetic editorial OPINION from RGI. This is NOT a summary of today — it must stake a clear position on what today means. It must: (1) name the specific RGI discipline(s), (2) argue WHY today's pattern matters in a broader historical or strategic context, (3) connect it to what leaders and organizations must do or stop doing, and (4) take a definitive stand with conviction. Use active, declarative voice: "Today's convergence confirms...", "The strategic imperative is unmistakable:", "Organizations that ignore this...", "This is not a trend — it is a reckoning." Forbidden: neutral hedging, summarizing what articles said, generic conclusions like "leaders should be aware" or "this could be significant.")
- keyTakeaways: string array of EXACTLY 5 items — crisp, actionable insights for leaders drawn from today's brief. Start each with a strong verb or noun. Scannable in 10 seconds. No filler.
- topicTags: string array (from: ["AI", "Leadership", "Geopolitics", "Finance", "Environmental Health", "Central Florida", "Strategy", "Culture", "Technology", "Policy", "Education", "Economy", "Innovation", "Governance", "Health", "Democracy", "Future of Work", "Sustainability"])
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
  editorNotes?: string | null
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
