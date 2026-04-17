import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable } from "@workspace/db";
import { inArray, gte, desc } from "drizzle-orm";
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
- Prioritizes insight over information, pattern over event, implication over description`;

const SYNTHESIS_PROMPT = `You are writing an RGI Strategic Intelligence Brief — a premium, editor-curated intelligence piece synthesizing multiple source articles into a single coherent analysis.

CRITICAL INSTRUCTION: Do NOT summarize these articles individually. Instead, read them as a collection of signals. Identify what they have in common. Extract the underlying pattern. Then write ONE integrated piece that reveals the deeper narrative connecting them all.

ATTRIBUTION RULE: When a source is marked [PRIMARY SIGNAL], that is a direct, original statement or announcement. Attribute it as such: "In a direct post on X, [name/company] stated…" or "In an official announcement, [company] declared…" — never attribute primary signals as if they are news reports. Primary signals can carry equal or greater weight than news articles reporting on the same topic.

Source Articles (synthesize ALL of these into one unified brief):
{SOURCES}

Editor Notes: {NOTES}

The brief must follow this exact five-part structure in the body (written as flowing prose, not as labeled sections):

1. CONTEXT — What is happening? Frame the moment with precision. Use specific facts, data, and examples from the sources. Set the stage without editorializing.

2. SYNTHESIS — What connects these stories? This is the analytical heart of the piece. Identify the pattern, tension, or trend that runs across all the sources. Name it. Explain why it matters that these things are happening simultaneously.

3. IMPLICATIONS — What does this mean for organizations and leaders? Be specific about consequences — who is affected, how, on what timeline. Think in terms of risk, opportunity, and strategic positioning.

4. RGI PERSPECTIVE — Connect this moment to one or more of RGI's three disciplines (Strategic Foresight, System Vitality, Civic Stewardship). What would a thoughtful RGI fellow say about this? This is where RGI's voice is strongest.

5. WHAT LEADERS SHOULD WATCH — Conclude with 2-3 forward-looking indicators, questions, or actions leaders should monitor in the coming weeks and months.

Requirements:
- Minimum 700 words, target 800-900 words
- Write as clean, flowing prose — no bullet points, no visible section headers, no markdown formatting in the body
- The five parts should flow naturally as paragraphs, not labeled sections
- Analytical, rigorous, non-sensational tone throughout

Return ONLY a valid JSON object with these exact fields:
- headline: string (strong, direct, analytical — not clickbait; no colons splitting into two halves; written as a senior editor would headline a Foreign Affairs piece)
- body: string (the complete synthesized brief as described above, 700-900 words, clean prose only — no markdown, no headers, no bullets)
- rgiTake: string (3-5 sentences of INTERPRETATION, not description. Name the RGI discipline(s) explicitly. State a clear point of view — what RGI actually thinks about this, why it matters NOW, and what it demands of leaders. This must read as an editorial opinion from a senior RGI fellow, not a neutral summary. Use active voice: "This signals...", "Leaders who ignore this...", "The strategic imperative here is..." — never "This article discusses...")
- topicTags: string array (choose only from: ["AI", "Leadership", "Geopolitics", "Finance", "Environmental Health", "Central Florida", "Strategy", "Culture", "Technology", "Policy", "Education", "Economy", "Innovation", "Governance", "Health", "Democracy", "Future of Work", "Sustainability"])
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number 1-10 (how strategically significant this is for senior leaders at the intersection of business, policy, and society)

Return ONLY valid JSON. No explanation, no markdown code blocks, no preamble.`;

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
- Total body word count: 900-1200 words
- Tone: HBR/Foreign Affairs — analytical, rigorous, free of hype
- No emojis, no informal language, no vague generalities
- Every claim traces back to a source in the provided articles — no fabrication
- The brief must read as a coherent document, not a sequence of summaries

Return ONLY a valid JSON object with these fields:
- headline: string (the day's single most important strategic development, one declarative sentence)
- executiveSummary: string array (exactly 6 bullet strings, each one tight sentence)
- body: string (the full 900-1200 word prose brief as described above — no markdown, no headers, no bullets in the body)
- rgiTake: string (3-5 sentences of sharp editorial OPINION, not description. Name the RGI discipline(s) explicitly. State what today's events mean — not what happened, but what RGI concludes from it. Use active, opinionated voice: "Today's convergence signals...", "The strategic imperative for leaders is...", "Organizations that fail to act on this..." — never summarize or describe. This is the pull-quote that captures RGI's distinctive analytical perspective on the day.)
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
        const signalType = isPrimary
          ? `[PRIMARY SIGNAL — direct ${a.platform === "twitter" ? "post on X" : a.platform === "linkedin" ? "post on LinkedIn" : "statement"}${a.author ? ` from ${a.author}${a.authorType ? `, ${a.authorType}` : ""}` : ""}]`
          : "";
        return `SOURCE ${i + 1}${signalType ? " " + signalType : ""}:\nHeadline: ${a.headline}\nPublication: ${a.sourceName}${a.author ? `\nAuthor: ${a.author}${a.authorType ? ` (${a.authorType})` : ""}` : ""}${a.platform && a.platform !== "news" ? `\nPlatform: ${a.platform}` : ""}\nURL: ${a.url}\nContent: ${(a.content || a.teaserSummary || a.headline).slice(0, 4000)}`;
      }
    )
    .join("\n\n---\n\n");

  const prompt = SYNTHESIS_PROMPT.replace("{SOURCES}", sourcesText).replace(
    "{NOTES}",
    editorNotes || "None"
  );

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
      topicTags: parsed.topicTags || [],
      discipline: parsed.discipline || "Multiple",
      relevancyScore: parsed.relevancyScore || 7,
    };
  } catch (e) {
    logger.error({ err: e, text }, "Failed to parse AI article response");
    throw new Error("Failed to parse AI-generated article");
  }
}

export async function generateDailyBrief(
  articleIds?: number[]
): Promise<{
  headline: string;
  executiveSummary: string[];
  body: string;
  rgiTake: string;
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
      (a, i) =>
        `SOURCE ${i + 1}:\nHeadline: ${a.headline}\nPublication: ${a.sourceName}${a.author ? `\nAuthor: ${a.author}` : ""}${a.platform && a.platform !== "news" ? `\nPlatform: ${a.platform}` : ""}\nTopics: ${a.topicTags.join(", ")}\nRelevancy Score: ${a.relevancyScore}/10${a.isEmergingSignal ? "\n[EMERGING SIGNAL]" : ""}\nURL: ${a.url}\nContent: ${(a.content || a.teaserSummary || a.headline).slice(0, 3000)}`
    )
    .join("\n\n---\n\n");

  const prompt = DAILY_BRIEF_PROMPT.replace("{SOURCE_COUNT}", String(articles.length))
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
