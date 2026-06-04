import { Router, type IRouter } from "express";
import {
  countFirestoreArticles,
  countFirestoreDigests,
} from "../lib/firestore-data";
import { getFirestoreSourceSchemaStatus, listFirestoreSources } from "../lib/firestore-sources";
import { getFirebaseDiagnostics, verifyFirestoreConnection } from "../lib/firebase";
import { getScrapeStatus } from "../lib/scraper";
import { durableJobsReady, getQueueSummaryAsync } from "../lib/job-queue";

const router: IRouter = Router();
const BUILD_MARKER = "rgi-local-2026-05-20-scrape-sync-daily-brief-selection-v2";

router.get("/readyz", async (_req, res) => {
  res.json({
    status: "ready",
    build: BUILD_MARKER,
    database: "firestore",
    uptimeSeconds: Math.round(process.uptime()),
    scheduler: process.env.FUNCTION_TARGET || process.env.K_SERVICE ? "firebase-scheduled-functions" : "local-node-cron",
  });
});

router.get("/healthz", async (_req, res) => {
  try {
    await verifyFirestoreConnection();
    const [sources, articleCount, digestCount] = await Promise.all([
      listFirestoreSources(),
      countFirestoreArticles(),
      countFirestoreDigests(),
    ]);
    res.json({
      status: "ok",
      build: BUILD_MARKER,
      database: "firestore",
      data: {
        sources: sources.length,
        articles: articleCount,
        digests: digestCount,
      },
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[healthz] Firestore healthcheck failed", {
      message: error.message,
      stack: error.stack,
      diagnostics: getFirebaseDiagnostics(),
    });
    res.status(200).json({
      status: "degraded",
      build: BUILD_MARKER,
      database: "unverified",
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      diagnostics: process.env.NODE_ENV === "production" ? undefined : getFirebaseDiagnostics(),
      scraper: getScrapeStatus(),
    });
  }
});

router.get("/diagnostics", async (_req, res) => {
  const env = {
    databaseProvider: "firestore",
    firebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    firebaseServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    aiProvider: process.env.OPENAI_API_KEY ? "openai" : process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY ? "anthropic" : "fallback",
    openAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    anthropicApiKey: Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
    nodeEnv: process.env.NODE_ENV ?? "development",
  };

  try {
    await verifyFirestoreConnection();
    const [sources, articleCount, pendingArticleCount, digestCount, pendingReviewCount, sourceSchema, jobs, durableReady] = await Promise.all([
      listFirestoreSources(),
      countFirestoreArticles(),
      countFirestoreArticles({ status: "pending" }),
      countFirestoreDigests(),
      countFirestoreDigests({ status: "pending_review" }),
      getFirestoreSourceSchemaStatus(),
      getQueueSummaryAsync(),
      durableJobsReady(),
    ]);
    const blockers = [
      !durableReady ? "Firestore is active; background jobs currently use the in-process queue until a Firestore durable jobs adapter is added." : null,
      !sourceSchema.supportsHealth ? "Source health metadata is not fully available for feed scoring diagnostics." : null,
      env.aiProvider === "fallback" ? "Configure OPENAI_API_KEY or AI_INTEGRATIONS_ANTHROPIC_API_KEY for full provider-backed editorial synthesis." : null,
      process.env.NODE_ENV !== "production" ? "Run with NODE_ENV=production for live website deployment." : null,
      process.env.RGI_INLINE_JOBS !== "false" && !(process.env.FUNCTION_TARGET || process.env.K_SERVICE)
        ? "Run API with RGI_INLINE_JOBS=false and a separate worker process for production isolation."
        : null,
    ].filter((item): item is string => Boolean(item));

    res.json({
      status: "ok",
      build: BUILD_MARKER,
      database: "firestore",
      env,
      deployment: {
        readyForLiveSite: blockers.length === 0,
        readinessPercent: blockers.length === 0 ? 96 : Math.max(70, 96 - blockers.length * 6),
        blockers,
      },
      data: {
        sources: sources.length,
        activeSources: sources.filter((source) => source.isActive).length,
        articles: articleCount,
        pendingArticles: pendingArticleCount,
        digests: digestCount,
        pendingReview: pendingReviewCount,
      },
      sourceSchema,
      scraper: getScrapeStatus(),
      jobs,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[diagnostics] Firestore diagnostics failed", {
      message: error.message,
      stack: error.stack,
      diagnostics: getFirebaseDiagnostics(),
    });
    res.status(200).json({
      status: "degraded",
      build: BUILD_MARKER,
      database: "unreachable",
      env,
      deployment: {
        readyForLiveSite: false,
        readinessPercent: 40,
        blockers: ["Diagnostics could not verify database, queue, and source health state."],
      },
      message: error.message,
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      diagnostics: process.env.NODE_ENV === "production" ? undefined : getFirebaseDiagnostics(),
      scraper: getScrapeStatus(),
      jobs: await getQueueSummaryAsync(),
    });
  }
});

export default router;
