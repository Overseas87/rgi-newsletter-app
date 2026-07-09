import { Router, type IRouter } from "express";
import { runScrape, getScrapeStatus } from "../lib/scraper";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/scrape/trigger", async (req, res): Promise<void> => {
  const current = getScrapeStatus();
  if (current.isRunning) {
    res.status(202).json({
      ...current,
      message: "Scrape is already running",
      status: "already_running",
    });
    return;
  }

  req.log.info("Manual scrape triggered; running in background");
  void runScrape({ ignoreSourceCache: true })
    .then((result) => {
      if (result.status === "failed") {
        logger.error(result, "Manual scrape failed");
      } else if (result.status === "partial") {
        logger.warn(result, "Manual scrape completed with partial failures");
      } else {
        logger.info(result, "Manual scrape completed");
      }
    })
    .catch((err) => {
      logger.error({ err }, "Manual scrape failed");
    });

  res.status(202).json({
    ...getScrapeStatus(),
    message: "Scrape started",
    status: "running",
  });
});

router.post("/scrape/trigger-legacy", async (req, res): Promise<void> => {
  req.log.info("Manual legacy scrape triggered");
  runScrape({ ignoreSourceCache: true }).then((result) => {
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

router.get("/scraper/status", async (req, res): Promise<void> => {
  const status = getScrapeStatus();
  res.json(status);
});

export default router;
