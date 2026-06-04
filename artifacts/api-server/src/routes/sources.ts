import { Router, type IRouter } from "express";
import {
  CreateSourceBody,
  UpdateSourceBody,
} from "@workspace/api-zod";
import {
  createFirestoreSource,
  deleteFirestoreSource,
  listFirestoreSources,
  updateFirestoreSource,
} from "../lib/firestore-sources";

const router: IRouter = Router();

router.get("/sources", async (req, res): Promise<void> => {
  const acceptHeader = req.get("accept") ?? "";
  const acceptsHtml = acceptHeader.includes("text/html") && !acceptHeader.includes("application/json");
  if (acceptsHtml) {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:21410";
    res.redirect(302, `${frontendUrl}/sources`);
    return;
  }

  res.setHeader("Cache-Control", "no-store");

  try {
    const sources = await listFirestoreSources();
    res.json(Array.isArray(sources) ? sources : []);
  } catch (err) {
    req.log.error({ err }, "Failed to list Firestore sources");
    res.status(503).json({
      error: "Firestore sources unavailable",
      message: err instanceof Error ? err.message : "Unable to read Firestore sources",
    });
  }
});

router.post("/sources", async (req, res): Promise<void> => {
  const body = CreateSourceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const source = await createFirestoreSource({
    name: body.data.name,
    url: body.data.url,
    type: body.data.type,
    tier: body.data.tier,
    isActive: true,
  });
  res.status(201).json(source);
});

router.patch("/sources/:id", async (req, res): Promise<void> => {
  const body = UpdateSourceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.url !== undefined) updateData.url = body.data.url;
  if (body.data.tier !== undefined) updateData.tier = body.data.tier;
  if (body.data.isActive !== undefined) updateData.isActive = body.data.isActive;
  if (body.data.weight !== undefined) updateData.weight = body.data.weight;
  if (body.data.authorityLevel !== undefined) updateData.authorityLevel = body.data.authorityLevel;
  if (body.data.description !== undefined) updateData.description = body.data.description ?? undefined;

  const updated = await updateFirestoreSource(req.params.id, updateData);

  if (!updated) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  res.json(updated);
});

router.delete("/sources/:id", async (req, res): Promise<void> => {
  const deleted = await deleteFirestoreSource(req.params.id);

  if (!deleted) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
