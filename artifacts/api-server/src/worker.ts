import { logger } from "./lib/logger";
import { claimNextDurableJob, markStaleRunningJobsFailed, runDurableJob } from "./lib/job-queue";
import { executeDurableJob } from "./lib/job-handlers";

const workerId = process.env.RGI_WORKER_ID ?? `worker-${process.pid}`;
const pollMs = Number(process.env.RGI_WORKER_POLL_MS ?? 2000);
const types = (process.env.RGI_WORKER_TYPES ?? "scrape,generation")
  .split(",")
  .map((type) => type.trim())
  .filter((type): type is "scrape" | "generation" => type === "scrape" || type === "generation");

let shuttingDown = false;

process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  logger.info({ workerId, types, pollMs }, "RGI durable worker started");
  await markStaleRunningJobsFailed(60);

  while (!shuttingDown) {
    const job = await claimNextDurableJob(workerId, types);
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    await runDurableJob(job, executeDurableJob);
  }

  logger.info({ workerId }, "RGI durable worker stopped");
}

main().catch((err) => {
  logger.error({ err, workerId }, "RGI durable worker crashed");
  process.exit(1);
});
