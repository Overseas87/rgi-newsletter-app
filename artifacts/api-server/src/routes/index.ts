import { Router, type IRouter } from "express";
import healthRouter from "./health";
import scrapeRouter from "./scrape";
import briefRouter from "./brief";
import articlesRouter from "./articles";
import digestRouter from "./digest";
import sourcesRouter from "./sources";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import newsletterRouter from "./newsletter";
import jobsRouter from "./jobs";
import publicRouter from "./public";
import professorsRouter from "./professors";

const router: IRouter = Router();

router.use(healthRouter);
router.use(scrapeRouter);
router.use(briefRouter);
router.use(articlesRouter);
router.use(digestRouter);
router.use(sourcesRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(newsletterRouter);
router.use(jobsRouter);
router.use(professorsRouter);
router.use(publicRouter);

export default router;
