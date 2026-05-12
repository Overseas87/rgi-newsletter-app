import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  CreateSourceBody,
  UpdateSourceParams,
  UpdateSourceBody,
  DeleteSourceParams,
} from "@workspace/api-zod";
import {
  createSupabaseSource,
  deleteSupabaseSource,
  isSupabaseConfigured,
  listSupabaseSources,
  updateSupabaseSource,
} from "../lib/supabase-sources";

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

  if (isSupabaseConfigured()) {
    try {
      const sources = await listSupabaseSources();
      res.json(Array.isArray(sources) ? sources : []);
    } catch (err) {
      req.log.error({ err }, "Failed to list Supabase sources");
      res.json([]);
    }
    return;
  }

  const { db, sourcesTable } = await import("@workspace/db");
  const sources = await db.select().from(sourcesTable).orderBy(sourcesTable.tier, sourcesTable.name);
  res.json(sources);
});

router.post("/sources", async (req, res): Promise<void> => {
  const body = CreateSourceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (isSupabaseConfigured()) {
    const source = await createSupabaseSource({
      name: body.data.name,
      url: body.data.url,
      type: body.data.type,
      tier: body.data.tier,
      isActive: true,
    });

    res.status(201).json(source);
    return;
  }

  const { db, sourcesTable } = await import("@workspace/db");
  const [source] = await db
    .insert(sourcesTable)
    .values({
      name: body.data.name,
      url: body.data.url,
      type: body.data.type,
      tier: body.data.tier,
      isActive: true,
    })
    .returning();

  res.status(201).json(source);
});

router.patch("/sources/:id", async (req, res): Promise<void> => {
  if (isSupabaseConfigured()) {
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
    if (body.data.authorityLevel !== undefined) updateData.authorityLevel = body.data.authorityLevel;
    if (body.data.description !== undefined) updateData.description = body.data.description ?? undefined;

    const updated = await updateSupabaseSource(req.params.id, updateData);

    if (!updated) {
      res.status(404).json({ error: "Source not found" });
      return;
    }

    res.json(updated);
    return;
  }

  const params = UpdateSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

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

  const { db, sourcesTable } = await import("@workspace/db");
  const [updated] = await db
    .update(sourcesTable)
    .set(updateData)
    .where(eq(sourcesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  res.json(updated);
});

router.delete("/sources/:id", async (req, res): Promise<void> => {
  if (isSupabaseConfigured()) {
    const deleted = await deleteSupabaseSource(req.params.id);

    if (!deleted) {
      res.status(404).json({ error: "Source not found" });
      return;
    }

    res.sendStatus(204);
    return;
  }

  const params = DeleteSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { db, sourcesTable } = await import("@workspace/db");
  const [deleted] = await db
    .delete(sourcesTable)
    .where(eq(sourcesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
