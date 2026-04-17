import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, articlesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

const RGI_SYSTEM_PROMPT = `You are an editorial AI for the Rick Goings Institute (RGI) at Rollins College. 

RGI equips leaders to build organizations that last, contribute, and stay vital in demanding times. RGI's perspective connects news to three disciplines:
- Strategic Foresight: how today's choices shape tomorrow; AI acceleration, geopolitical volatility, market transitions, weak signals, pattern recognition
- System Vitality: organizations as living systems driven by human energy and trust; organizational culture, leadership, institutional health
- Civic Stewardship: firms as citizens with responsibility to the environments that grant them legitimacy; corporate responsibility, civic institutions, community impact

RGI's editorial tone:
- Rigorous, pragmatic, and grounded in liberal arts and advanced management thinking
- Connects macro trends to leadership decisions
- Never sensationalist; avoids hyperbole
- Uses precise, direct language that respects the reader's intelligence
- Connects specific news events to timeless leadership principles
- Does not fabricate facts — only synthesizes from the provided source material`;

const ARTICLE_PROMPT = `Generate a newsletter article for RGI editors based on the following source article(s). The article should be newsletter-style — readable in 2–3 minutes.

Source Articles:
{SOURCES}

Editor Notes (if any): {NOTES}

Return ONLY a valid JSON object with these fields:
- headline: string (compelling, direct, not clickbait)
- body: string (2-4 paragraphs in RGI's editorial voice, written in markdown, connecting the news to one or more of RGI's three disciplines)
- rgiTake: string (2-3 sentences explicitly stating RGI's perspective on why this story matters to leaders)
- topicTags: string array (from: AI, Leadership, Geopolitics, Finance, Environmental Health, Central Florida, Strategy, Culture, Technology, Policy, Education, Economy, Innovation, Governance, Health)
- discipline: string ("Strategic Foresight", "System Vitality", "Civic Stewardship", or "Multiple")
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
      (a) =>
        `TITLE: ${a.headline}\nSOURCE: ${a.sourceName}\nURL: ${a.url}\nCONTENT: ${(a.content || a.teaserSummary || a.headline).slice(0, 1500)}`
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
