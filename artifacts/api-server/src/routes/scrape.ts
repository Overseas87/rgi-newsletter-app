import { Router, type IRouter } from "express";
import { runScrape, getScrapeStatus } from "../lib/scraper";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/scrape/trigger", async (req, res): Promise<void> => {
  req.log.info("Manual scrape triggered");
  // Run in background
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
