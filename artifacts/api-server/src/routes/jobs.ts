import { Router, type IRouter } from "express";
import { getJobAsync, getQueueSummaryAsync, listJobsAsync } from "../lib/job-queue";

const router: IRouter = Router();

router.get("/jobs", async (req, res) => {
  const type = req.query.type === "scrape" || req.query.type === "generation" ? req.query.type : undefined;
  res.json({
    summary: await getQueueSummaryAsync(),
    jobs: (await listJobsAsync(type)).slice(0, 50),
  });
});

router.get("/jobs/:id", async (req, res) => {
  const job = await getJobAsync(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

export default router;
