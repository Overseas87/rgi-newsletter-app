import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
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
- rgiTake: string (3-5 sentences articulating RGI's specific perspective — which discipline(s) this engages, and what it means for the leaders RGI serves. This is the pull-quote-worthy distillation of the piece's significance.)
- topicTags: string array (choose only from: ["AI", "Leadership", "Geopolitics", "Finance", "Environmental Health", "Central Florida", "Strategy", "Culture", "Technology", "Policy", "Education", "Economy", "Innovation", "Governance", "Health", "Democracy", "Future of Work", "Sustainability"])
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number 1-10 (how strategically significant this is for senior leaders at the intersection of business, policy, and society)

Return ONLY valid JSON. No explanation, no markdown code blocks, no preamble.`;

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
      (a, i) =>
        `SOURCE ${i + 1}:\nHeadline: ${a.headline}\nPublication: ${a.sourceName}${a.author ? `\nAuthor: ${a.author}` : ""}\nURL: ${a.url}\nContent: ${(a.content || a.teaserSummary || a.headline).slice(0, 4000)}`
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
