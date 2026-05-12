import { Router, type IRouter } from "express";
import { enqueueJob } from "../lib/job-queue";
import { executeDurableJob } from "../lib/job-handlers";
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

  try {
    const job = await enqueueJob("generation", "Manual Daily Brief", executeDurableJob, {
      handler: "generate-daily-brief",
      maxAttempts: 1,
      payload: {
      articleIds: [],
      editorNotes: null,
      excludedTopics: [],
      requestId: `manual-daily-${Date.now()}`,
      },
    });
    res.status(202).json({ message: "Daily brief job started", jobId: job.id });
  } catch (err) {
    logger.error({ err }, "Manual brief generation failed");
    res.status(500).json({ error: "Daily brief job could not be started" });
  }
});

export default router;
