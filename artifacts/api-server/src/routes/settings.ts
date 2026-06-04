import { Router, type IRouter } from "express";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getFirestoreSettings, upsertFirestoreSettings } from "../lib/firestore-data";

const router: IRouter = Router();

// GET /settings - return current settings (or defaults)
router.get("/settings", async (req, res): Promise<void> => {
  try {
    res.json(await getFirestoreSettings());
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

    res.json(await upsertFirestoreSettings(body.data));
  } catch (err) {
    logger.error({ err }, "Failed to update settings");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
