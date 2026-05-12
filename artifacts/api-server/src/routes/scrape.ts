import { Router, type IRouter } from "express";
import { runScrape, getScrapeStatus } from "../lib/scraper";
import { logger } from "../lib/logger";
import { enqueueUniqueJob } from "../lib/job-queue";

const router: IRouter = Router();

router.post("/scrape/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual scrape triggered");
  const job = await enqueueUniqueJob("scrape", "Manual scrape", "manual-scrape", async (record) => {
    record.progress = 20;
    const result = await runScrape();
    record.progress = 95;
    return result;
  }, {
    maxAttempts: 2,
    handler: "manual-scrape",
    payload: { requestedBy: "manual" },
  });

  res.status(202).json({
    message: "Scrape queued successfully",
    jobId: job.id,
    status: job.status,
    articlesFound: 0,
    articlesAdded: 0,
  });
});

router.post("/scrape/trigger-legacy", async (req, res): Promise<void> => {
  req.log.info("Manual legacy scrape triggered");
  runScrape().then((result) => {
    logger.info(result, "Scrape completed");
  }).catch((err) => {
    logger.error({ err }, "Scrape failed");
  });

  res.json({
    message: "Scrape triggered successfully",
    articlesFound: 0,
    articlesAdded: 0,
  });
});

router.get("/scrape/status", async (req, res): Promise<void> => {
  const status = getScrapeStatus();
  res.json(status);
});

export default router;
