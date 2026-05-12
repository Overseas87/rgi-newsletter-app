import { db, sourcesTable } from "@workspace/db";
import { count } from "drizzle-orm";
import { logger } from "./logger";

const DEFAULT_SOURCES = [
  // Tier 1 — Premium financial and global news
  { name: "Financial Times", url: "https://www.ft.com/rss/home", type: "rss" as const, tier: 1, description: "Global business, economics, and geopolitics" },
  { name: "Wall Street Journal", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", type: "rss" as const, tier: 1, description: "US and global business, markets, and policy" },
  { name: "The Economist", url: "https://www.economist.com/latest/rss.xml", type: "rss" as const, tier: 1, description: "Global affairs, business, science, and culture" },
  { name: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews", type: "rss" as const, tier: 1, description: "Breaking international news and analysis" },
  { name: "Bloomberg", url: "https://feeds.bloomberg.com/politics/news.rss", type: "rss" as const, tier: 1, description: "Finance, markets, and economic policy" },
  { name: "Associated Press", url: "https://rsshub.app/apnews/topics/world-news", type: "rss" as const, tier: 1, description: "Global breaking news and investigative reporting" },

  // Tier 1 — Policy, strategy, and leadership
  { name: "Harvard Business Review", url: "https://hbr.org/feed", type: "rss" as const, tier: 1, description: "Leadership, management, and business strategy" },
  { name: "Foreign Affairs", url: "https://www.foreignaffairs.com/rss.xml", type: "rss" as const, tier: 1, description: "Global policy, geopolitics, and international relations" },
  { name: "Foreign Policy", url: "https://foreignpolicy.com/feed/", type: "rss" as const, tier: 1, description: "International affairs, defense, and global economy" },
  { name: "Brookings Institution", url: "https://www.brookings.edu/feed/", type: "rss" as const, tier: 1, description: "Policy research on governance, economics, and society" },

  // Tier 2 — Technology and innovation
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", type: "rss" as const, tier: 2, description: "AI, emerging technology, and scientific breakthroughs" },
  { name: "Wired", url: "https://www.wired.com/feed/rss", type: "rss" as const, tier: 2, description: "Technology, culture, and their intersection with society" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", type: "rss" as const, tier: 2, description: "Technology news and analysis" },

  // Tier 2 — Business and markets
  { name: "Fortune", url: "https://fortune.com/feed/", type: "rss" as const, tier: 2, description: "Business, finance, and leadership" },
  { name: "Axios", url: "https://api.axios.com/feed/", type: "rss" as const, tier: 2, description: "Smart brevity news across business, politics, and tech" },

  // Tier 2 — Global affairs and governance
  { name: "The Atlantic", url: "https://feeds.feedburner.com/TheAtlantic", type: "rss" as const, tier: 2, description: "Ideas, politics, culture, and global issues" },
  { name: "Politico", url: "https://www.politico.com/rss/politicopicks.xml", type: "rss" as const, tier: 2, description: "Political and policy intelligence" },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", type: "rss" as const, tier: 2, description: "International news, politics, and environment" },

  // Tier 2 — Think tanks and institutional
  { name: "Council on Foreign Relations", url: "https://www.cfr.org/rss.xml", type: "institutional" as const, tier: 2, description: "Foreign policy analysis and global risk intelligence" },
  { name: "McKinsey Global Institute", url: "https://www.mckinsey.com/mgi/rss", type: "institutional" as const, tier: 2, description: "Business, economics, and organizational research" },
];

export async function seedDefaultSources(): Promise<void> {
  try {
    const [{ existingCount }] = await db
      .select({ existingCount: count() })
      .from(sourcesTable);

    if (existingCount > 0) {
      logger.info({ existingCount }, "Sources already seeded — skipping default seed");
      return;
    }

    logger.info("No sources found — seeding default high-quality sources");

    for (const source of DEFAULT_SOURCES) {
      await db.insert(sourcesTable).values({
        name: source.name,
        url: source.url,
        type: source.type,
        tier: source.tier,
        isActive: true,
        description: source.description,
        authorityLevel: source.tier === 1 ? 5 : 3,
      });
    }

    logger.info({ count: DEFAULT_SOURCES.length }, "Default sources seeded successfully");
  } catch (err) {
    logger.error({ err }, "Failed to seed default sources");
  }
}
