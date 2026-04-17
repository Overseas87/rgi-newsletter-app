import { Router, type IRouter } from "express";
import { db, newsletterSubscribersTable, newsletterDigestsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { generateNewsletterDigest } from "../lib/ai-writer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/newsletter/subscribers", async (req, res): Promise<void> => {
  const subscribers = await db
    .select()
    .from(newsletterSubscribersTable)
    .where(eq(newsletterSubscribersTable.isActive, true))
    .orderBy(desc(newsletterSubscribersTable.subscribedAt));
  res.json(subscribers);
});

router.post("/newsletter/subscribe", async (req, res): Promise<void> => {
  const { email, name, topics } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }
  try {
    const [existing] = await db
      .select()
      .from(newsletterSubscribersTable)
      .where(eq(newsletterSubscribersTable.email, email.toLowerCase().trim()))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(newsletterSubscribersTable)
        .set({
          name: name?.trim() || existing.name,
          topics: Array.isArray(topics) ? topics : existing.topics,
          isActive: true,
        })
        .where(eq(newsletterSubscribersTable.id, existing.id))
        .returning();
      res.json({ success: true, subscriber: updated, updated: true });
      return;
    }

    const [subscriber] = await db
      .insert(newsletterSubscribersTable)
      .values({
        email: email.toLowerCase().trim(),
        name: name?.trim() || null,
        topics: Array.isArray(topics) ? topics : [],
        isActive: true,
      })
      .returning();
    res.json({ success: true, subscriber, updated: false });
  } catch (err) {
    logger.error({ err }, "Failed to subscribe");
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

router.delete("/newsletter/unsubscribe/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid subscriber ID" });
    return;
  }
  await db
    .update(newsletterSubscribersTable)
    .set({ isActive: false })
    .where(eq(newsletterSubscribersTable.id, id));
  res.json({ success: true });
});

router.get("/newsletter/digests", async (req, res): Promise<void> => {
  const digests = await db
    .select()
    .from(newsletterDigestsTable)
    .orderBy(desc(newsletterDigestsTable.generatedAt))
    .limit(20);
  res.json(digests);
});

router.post("/newsletter/generate-digest", async (req, res): Promise<void> => {
  const { topics, weekOf } = req.body;
  const week = weekOf || new Date().toISOString().slice(0, 10);

  try {
    const result = await generateNewsletterDigest(
      Array.isArray(topics) ? topics : [],
      week
    );

    const [digest] = await db
      .insert(newsletterDigestsTable)
      .values({
        weekOf: week,
        headline: result.headline,
        body: result.body,
        topicTags: result.topicTags,
        subscriberCount: result.subscriberCount,
      })
      .returning();

    res.json(digest);
  } catch (err) {
    logger.error({ err }, "Newsletter digest generation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

export default router;
