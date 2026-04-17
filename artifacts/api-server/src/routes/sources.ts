import { Router, type IRouter } from "express";
import { db, sourcesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateSourceBody,
  UpdateSourceParams,
  UpdateSourceBody,
  DeleteSourceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/sources", async (req, res): Promise<void> => {
  const sources = await db.select().from(sourcesTable).orderBy(sourcesTable.tier, sourcesTable.name);
  res.json(sources);
});

router.post("/sources", async (req, res): Promise<void> => {
  const body = CreateSourceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

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

  const updateData: Partial<typeof sourcesTable.$inferInsert> = {};
  if (body.data.name !== undefined) updateData.name = body.data.name;
  if (body.data.url !== undefined) updateData.url = body.data.url;
  if (body.data.tier !== undefined) updateData.tier = body.data.tier;
  if (body.data.isActive !== undefined) updateData.isActive = body.data.isActive;

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
  const params = DeleteSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

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
