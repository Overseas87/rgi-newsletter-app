import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapeRouter from "./scrape";
import articlesRouter from "./articles";
import digestRouter from "./digest";
import sourcesRouter from "./sources";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapeRouter);
router.use(articlesRouter);
router.use(digestRouter);
router.use(sourcesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);

export default router;
