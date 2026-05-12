import { Router, type IRouter } from "express";
import { listSupabaseDigests, useSupabaseData } from "../lib/supabase-data";

const router: IRouter = Router();

function publicDigest(article: Awaited<ReturnType<typeof listSupabaseDigests>>[number]) {
  return {
    id: article.id,
    slug: `${article.id}-${article.headline.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90)}`,
    type: article.articleType,
    headline: article.headline,
    executiveSummary: Array.isArray(article.executiveSummary) ? article.executiveSummary : [],
    body: article.body,
    rgiEditorial: article.rgiTake,
    keyTakeaways: Array.isArray(article.keyTakeaways) ? article.keyTakeaways : [],
    implicationsForLeaders: Array.isArray(article.implificationsForLeaders) ? article.implificationsForLeaders : [],
    whatToWatch: Array.isArray(article.whatToWatch) ? article.whatToWatch : [],
    topicTags: Array.isArray(article.topicTags) ? article.topicTags : [],
    discipline: article.discipline,
    publishedAt: article.publishedAt ?? article.updatedAt,
    updatedAt: article.updatedAt,
  };
}

router.get("/public/newsletters", async (req, res): Promise<void> => {
  if (!useSupabaseData()) {
    res.json({ items: [], count: 0 });
    return;
  }

  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20) || 20));
  try {
    const approved = await listSupabaseDigests({ status: "approved", limit });
    const items = approved.map(publicDigest);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({ items, count: items.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list public newsletters");
    res.status(503).json({ items: [], count: 0, error: "Public newsletters temporarily unavailable" });
  }
});

router.get("/public/newsletters/:id", async (req, res): Promise<void> => {
  if (!useSupabaseData()) {
    res.status(404).json({ error: "Newsletter not found" });
    return;
  }

  const id = Number(String(req.params.id).split("-")[0]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid newsletter id" });
    return;
  }

  const approved = await listSupabaseDigests({ status: "approved", limit: 100 });
  const article = approved.find((item) => item.id === id);
  if (!article) {
    res.status(404).json({ error: "Newsletter not found" });
    return;
  }
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  res.json(publicDigest(article));
});

export default router;
