import { Router, type IRouter } from "express";
import {
  countFirestoreArticles,
  countFirestoreDigests,
} from "../lib/firestore-data";
import { getFirestoreSourceSchemaStatus, listFirestoreSources } from "../lib/firestore-sources";
import { getFirebaseDiagnostics, verifyFirestoreConnection } from "../lib/firebase";
import { getScrapeStatus } from "../lib/scraper";
import { durableJobsReady, getQueueSummaryAsync } from "../lib/job-queue";
import { localFallbackEnabled, localStoreModeEnabled, localStorePath, seedLocalDemoData } from "../lib/local-store";
import { apiErrorPayload, getErrorMessage, isFirestoreQuotaError } from "../lib/api-errors";

const router: IRouter = Router();
const BUILD_MARKER = "rgi-local-2026-05-20-scrape-sync-daily-brief-selection-v2";

function runtimeFlags() {
  return {
    firestoreProjectId: process.env.FIREBASE_PROJECT_ID ?? "rgi-insight-blog-generator",
    firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST ?? null,
    firestoreEmulatorActive: Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.USE_FIRESTORE_EMULATOR === "true"),
    localStoreMode: localStoreModeEnabled(),
    localFallbackEnabled: localFallbackEnabled(),
    localStorePath: localStorePath(),
    mockDataMode: process.env.USE_MOCK_DATA === "true",
  };
}

router.get("/readyz", async (_req, res) => {
  res.json({
    status: "ready",
    build: BUILD_MARKER,
    database: localStoreModeEnabled() ? "local-json" : "firestore",
    runtime: runtimeFlags(),
    uptimeSeconds: Math.round(process.uptime()),
    scheduler: process.env.FUNCTION_TARGET || process.env.K_SERVICE ? "firebase-scheduled-functions" : "local-node-cron",
  });
});

async function healthPayload() {
  const runtime = runtimeFlags();
  if (localStoreModeEnabled()) {
    return {
      status: "ok",
      build: BUILD_MARKER,
      database: "local-json",
      runtime,
      firestore: { available: false, quotaExceeded: false },
      scraper: summarizeScrapeStatus(),
    };
  }

  try {
    await verifyFirestoreConnection();
    return {
      status: "ok",
      build: BUILD_MARKER,
      database: "firestore",
      runtime,
      firestore: { available: true, quotaExceeded: false },
      scraper: summarizeScrapeStatus(),
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error("[healthz] Firestore healthcheck failed", {
      message: error.message,
      stack: error.stack,
      diagnostics: getFirebaseDiagnostics(),
    });
    return {
      status: "degraded",
      build: BUILD_MARKER,
      database: "unverified",
      runtime,
      message: error.message,
      errorCategory: isFirestoreQuotaError(error) ? "firestore_quota_exceeded" : "database_unavailable",
      firestore: { available: false, quotaExceeded: isFirestoreQuotaError(error) },
      safeError: apiErrorPayload(error, "Database health check failed."),
      stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
      diagnostics: process.env.NODE_ENV === "production" ? undefined : getFirebaseDiagnostics(),
      scraper: summarizeScrapeStatus(),
    };
  }
}

function summarizeScrapeStatus() {
  const status = getScrapeStatus();
  return {
    isRunning: status.isRunning,
    startedAt: status.startedAt,
    staleAfterMs: status.staleAfterMs,
    lastScrapeAt: status.lastScrapeAt,
    lastScrapeArticlesFound: status.lastScrapeArticlesFound,
    lastScrapeFailures: status.lastScrapeFailures?.length ?? 0,
    lastScrapeSummary: status.lastScrapeSummary ? {
      startedAt: status.lastScrapeSummary.startedAt,
      finishedAt: status.lastScrapeSummary.finishedAt,
      totalFeeds: status.lastScrapeSummary.totalFeeds,
      successfulFeeds: status.lastScrapeSummary.successfulFeeds,
      emptyFeeds: status.lastScrapeSummary.emptyFeeds,
      failedFeeds: status.lastScrapeSummary.failedFeeds,
      articlesCollected: status.lastScrapeSummary.articlesCollected,
      articlesAccepted: status.lastScrapeSummary.articlesAccepted,
      articlesSaved: status.lastScrapeSummary.articlesSaved,
    } : undefined,
  };
}

router.get("/healthz", async (_req, res) => {
  res.status(200).json(await healthPayload());
});

router.get("/health", async (_req, res) => {
  res.status(200).json(await healthPayload());
});

router.get("/debug/health", async (_req, res) => {
  res.status(200).json(await healthPayload());
});

router.post("/debug/seed-local", async (req, res): Promise<void> => {
  if (process.env.NODE_ENV === "production" && process.env.RGI_ENABLE_DEBUG_SEED !== "true") {
    res.status(403).json({ error: "Local seed route is disabled in production." });
    return;
  }
  try {
    const result = await seedLocalDemoData();
    req.log.info(result, "Seeded local RGI demo data");
    res.json({ status: "ok", database: "local-json", ...result });
  } catch (error) {
    req.log.error({ err: error }, "Failed to seed local RGI demo data");
    res.status(500).json({
      error: "Failed to seed local demo data",
      message: getErrorMessage(error),
    });
  }
});

router.get("/diagnostics", async (_req, res) => {
  const env = {
    databaseProvider: localStoreModeEnabled() ? "local-json" : "firestore",
    firebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    firebaseServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    aiProvider: process.env.OPENAI_API_KEY ? "openai" : process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY ? "anthropic" : "fallback",
    openAiApiKey: Boolean(process.env.OPENAI_API_KEY),
    anthropicApiKey: Boolean(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY),
    nodeEnv: process.env.NODE_ENV ?? "development",
    runtime: runtimeFlags(),
  };

  if (localStoreModeEnabled()) {
    const [sources, articleCount, pendingArticleCount, digestCount, pendingReviewCount, jobs] = await Promise.all([
      listFirestoreSources(),
      countFirestoreArticles(),
      countFirestoreArticles({ status: "pending" }),
      countFirestoreDigests(),
      countFirestoreDigests({ status: "pending_review" }),
      getQueueSummaryAsync(),
    ]);
    res.json({
      status: "ok",
      build: BUILD_MARKER,
      database: "local-json",
      env,
      deployment: {
        readyForLiveSite: false,
        readinessPercent: 80,
        blockers: ["Local JSON store is active. Use Firestore for production deployment."],
      },
      data: {
        sources: sources.length,
        activeSources: sources.filter((source) => source.isActive).length,
        articles: articleCount,
        pendingArticles: pendingArticleCount,
        digests: digestCount,
        pendingReview: pendingReviewCount,
      },
      sourceSchema: await getFirestoreSourceSchemaStatus(),
      scraper: getScrapeStatus(),
      jobs,
    });
    return;
  }

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
