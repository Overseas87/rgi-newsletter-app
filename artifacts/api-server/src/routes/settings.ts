import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// GET /settings - return current settings (or defaults)
router.get("/settings", async (req, res): Promise<void> => {
  try {
    const rows = await db.select().from(settingsTable).limit(1);
    if (rows.length === 0) {
      // Return defaults if no settings row exists yet
      res.json({
        relevancyThreshold: 7.0,
        scrapeIntervalHours: 24,
        scrapeTimeUtc: "11:00",
      });
      return;
    }
    const s = rows[0];
    res.json({
      relevancyThreshold: s.relevancyThreshold,
      scrapeIntervalHours: s.scrapeIntervalHours,
      scrapeTimeUtc: s.scrapeTimeUtc,
    });
  } catch (err) {
    logger.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /settings - update settings
router.patch("/settings", async (req, res): Promise<void> => {
  try {
    const body = UpdateSettingsBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues });
      return;
    }

    const updates: Partial<typeof settingsTable.$inferInsert> = {};
    if (body.data.relevancyThreshold !== undefined) {
      updates.relevancyThreshold = body.data.relevancyThreshold;
    }
    if (body.data.scrapeIntervalHours !== undefined) {
      updates.scrapeIntervalHours = body.data.scrapeIntervalHours;
    }
    if (body.data.scrapeTimeUtc !== undefined) {
      updates.scrapeTimeUtc = body.data.scrapeTimeUtc;
    }

    const existing = await db.select().from(settingsTable).limit(1);

    let result;
    if (existing.length === 0) {
      // Create first row with defaults merged with updates
      [result] = await db
        .insert(settingsTable)
        .values({
          relevancyThreshold: 7.0,
          scrapeIntervalHours: 24,
          scrapeTimeUtc: "11:00",
          ...updates,
        })
        .returning();
    } else {
      [result] = await db
        .update(settingsTable)
        .set(updates)
        .returning();
    }

    res.json({
      relevancyThreshold: result.relevancyThreshold,
      scrapeIntervalHours: result.scrapeIntervalHours,
      scrapeTimeUtc: result.scrapeTimeUtc,
    });
  } catch (err) {
    logger.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
