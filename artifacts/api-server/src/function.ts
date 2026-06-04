import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import app, { initializeApp } from "./app";
import { logger } from "./lib/logger";
import { runScrape } from "./lib/scraper";
import { executeDurableJob } from "./lib/job-handlers";
import type { JobRecord } from "./lib/job-queue";

let initPromise: Promise<void> | null = null;
const openAiApiKey = defineSecret("OPENAI_API_KEY");

function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeApp().catch((error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        { message: err.message, stack: err.stack },
        "Firebase Function background initialization failed; API will still serve requests"
      );
    });
  }
  return initPromise;
}

export const api = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    minInstances: 1,
    maxInstances: 5,
    concurrency: 20,
    secrets: [openAiApiKey],
  },
  async (req, res) => {
    await ensureInitialized();
    return app(req, res);
  },
);

function scheduledDailyBriefJob(label: "Morning Intelligence Brief" | "Evening Intelligence Brief"): JobRecord {
  const now = new Date();
  return {
    id: `scheduled_${label.toLowerCase().replace(/\s+/g, "_")}_${now.toISOString()}`,
    type: "generation",
    label,
    handler: "generate-daily-brief",
    payload: {
      articleIds: null,
      editorNotes: `${label}: prioritize geopolitical, macroeconomic, security, technology, supply-chain, energy, and market signals through the RGI analytical doctrine.`,
      excludedTopics: [],
      requestId: `${label.toLowerCase().replace(/\s+/g, "-")}-${now.getTime()}`,
    },
    status: "queued",
    progress: 0,
    attempts: 0,
    maxAttempts: 1,
    queuedAt: now.toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  };
}

export const hourlyScrape = onSchedule(
  {
    schedule: "0 * * * *",
    timeZone: "America/New_York",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [openAiApiKey],
  },
  async () => {
    await ensureInitialized();
    const startedAt = new Date().toISOString();
    logger.info({ startedAt, scheduler: "hourlyScrape" }, "Scheduled hourly scrape started");
    const result = await runScrape();
    logger.info({ scheduler: "hourlyScrape", result }, "Scheduled hourly scrape finished");
  },
);

export const morningIntelligenceBrief = onSchedule(
  {
    schedule: "0 6 * * *",
    timeZone: "America/New_York",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [openAiApiKey],
  },
  async () => {
    await ensureInitialized();
    logger.info({ scheduler: "morningIntelligenceBrief" }, "Scheduled morning brief generation started");
    const result = await executeDurableJob(scheduledDailyBriefJob("Morning Intelligence Brief"));
    logger.info({ scheduler: "morningIntelligenceBrief", result }, "Scheduled morning brief generation finished");
  },
);

export const eveningIntelligenceBrief = onSchedule(
  {
    schedule: "0 18 * * *",
    timeZone: "America/New_York",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "1GiB",
    secrets: [openAiApiKey],
  },
  async () => {
    await ensureInitialized();
    logger.info({ scheduler: "eveningIntelligenceBrief" }, "Scheduled evening brief generation started");
    const result = await executeDurableJob(scheduledDailyBriefJob("Evening Intelligence Brief"));
    logger.info({ scheduler: "eveningIntelligenceBrief", result }, "Scheduled evening brief generation finished");
  },
);
