import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

const RGI_SYSTEM_PROMPT = `You are the senior editorial AI for the Rick Goings Institute (RGI) at Rollins College — an institution that equips leaders to build organizations that last, contribute, and stay vital in demanding times.

RGI's perspective connects current events to three core disciplines:

1. Strategic Foresight: The capacity to anticipate change, read signals in the environment, and position organizations advantageously for futures that are not yet visible. This includes AI acceleration, geopolitical volatility, market transitions, weak signal detection, and pattern recognition across complex systems.

2. System Vitality: The organizational energy, resilience, and adaptive capacity needed to sustain high performance across cycles of disruption and renewal. Organizations as living systems driven by human energy, trust, purpose, and institutional health.

3. Civic Stewardship: The responsibility leaders bear to the communities and institutions that grant them legitimacy. Corporations as citizens with obligations beyond profit — to civic life, democratic institutions, and long-term community wellbeing.

RGI's editorial voice:
- Rigorous, pragmatic, and grounded in liberal arts and advanced management thinking
- Connects macro trends to the daily decisions of real leaders
- Never sensationalist; avoids hyperbole and empty speculation
- Uses precise, direct language that respects the reader's intelligence and experience
- Connects specific news events to timeless leadership principles and disciplines
- Does not fabricate facts — synthesizes only from the provided source material
- Writes at the level of HBR or Foreign Affairs — thoughtful, substantial, and worth reading twice
- Always grounds analysis in what this means for leaders making decisions right now`;

const ARTICLE_PROMPT = `Generate a full-length newsletter article for RGI editors based on the following source article(s).

The article must be substantial — at minimum 500 words, ideally 700-900 words. Think of it as a full-page feature, not a brief. The structure should be:
1. A strong opening paragraph that frames the significance of the story
2. Two to three paragraphs developing the analysis with specific detail and insight
3. A paragraph connecting the story to organizational and leadership implications
4. A concluding paragraph that points toward what leaders should watch or do next

Source Articles:
{SOURCES}

Editor Notes (if any): {NOTES}

Return ONLY a valid JSON object with these exact fields:
- headline: string (compelling, direct — not clickbait; written as a quality editor would)
- body: string (the full multi-paragraph article in RGI's editorial voice, 500-900 words, written as clean prose — no bullet points, no headers within the body, no markdown formatting)
- rgiTake: string (3-4 sentences explicitly stating RGI's perspective on why this story matters to leaders right now — this must be present, substantive, and directly connected to one or more of the three disciplines)
- topicTags: string array (choose from: AI, Leadership, Geopolitics, Finance, Environmental Health, Central Florida, Strategy, Culture, Technology, Policy, Education, Economy, Innovation, Governance, Health, Democracy, Future of Work, Sustainability)
- discipline: string (exactly one of: "Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
- relevancyScore: number from 1 to 10 (how relevant this is to RGI's mission and audience)

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
      (a) =>
        `HEADLINE: ${a.headline}\nSOURCE: ${a.sourceName}\nURL: ${a.url}\nCONTENT: ${(a.content || a.teaserSummary || a.headline).slice(0, 3000)}`
    )
    .join("\n\n---\n\n");

  const prompt = ARTICLE_PROMPT.replace("{SOURCES}", sourcesText).replace(
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
      headline: parsed.headline || "Untitled Article",
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
