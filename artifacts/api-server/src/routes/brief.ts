import { Router, type IRouter } from "express";
import { runDailyBriefJob } from "../lib/daily-brief-scheduler";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /brief/trigger
 * Manually trigger the daily brief generation job.
 * The job runs in the background — responds immediately with 202 Accepted.
 * Useful for testing and manual override.
 */
router.post("/brief/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual daily brief generation triggered");

  runDailyBriefJob().catch((err) => {
    logger.error({ err }, "Manual brief generation failed");
  });

  res.status(202).json({ message: "Daily brief job started" });
});

export default router;
