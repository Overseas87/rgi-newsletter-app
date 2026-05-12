import { Router, type IRouter } from "express";
import { generateNewsletterDigest } from "../lib/ai-writer";
import { logger } from "../lib/logger";
import {
  createFirestoreNewsletterDigest,
  listFirestoreNewsletterDigests,
  listFirestoreNewsletterSubscribers,
  unsubscribeFirestoreNewsletterSubscriber,
  upsertFirestoreNewsletterSubscriber,
} from "../lib/firestore-newsletter";

const router: IRouter = Router();

router.get("/newsletter/subscribers", async (req, res): Promise<void> => {
  try {
    const subscribers = await listFirestoreNewsletterSubscribers(true);
    res.json(subscribers);
  } catch (err) {
    logger.error({ err }, "Failed to load Firestore newsletter subscribers");
    res.status(500).json({ error: "Failed to load subscribers" });
  }
});

router.post("/newsletter/subscribe", async (req, res): Promise<void> => {
  const { email, name, topics } = req.body;
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email address is required" });
    return;
  }
  try {
    const result = await upsertFirestoreNewsletterSubscriber({
      email,
      name: typeof name === "string" ? name : null,
      topics: Array.isArray(topics) ? topics : [],
    });
    res.json({ success: true, subscriber: result.subscriber, updated: result.updated });
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
  try {
    const ok = await unsubscribeFirestoreNewsletterSubscriber(id);
    if (!ok) {
      res.status(404).json({ error: "Subscriber not found" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to unsubscribe Firestore newsletter subscriber");
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

router.get("/newsletter/digests", async (req, res): Promise<void> => {
  try {
    const digests = await listFirestoreNewsletterDigests(20);
    res.json(digests);
  } catch (err) {
    logger.error({ err }, "Failed to load Firestore newsletter digests");
    res.status(500).json({ error: "Failed to load newsletter digests" });
  }
});

router.post("/newsletter/generate-digest", async (req, res): Promise<void> => {
  const { topics, weekOf } = req.body;
  const week = weekOf || new Date().toISOString().slice(0, 10);

  try {
    const result = await generateNewsletterDigest(
      Array.isArray(topics) ? topics : [],
      week
    );

    const digest = await createFirestoreNewsletterDigest({
      weekOf: week,
      headline: result.headline,
      body: result.body,
      topicTags: result.topicTags,
      subscriberCount: result.subscriberCount,
    });

    res.json(digest);
  } catch (err) {
    logger.error({ err }, "Newsletter digest generation failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

export default router;
