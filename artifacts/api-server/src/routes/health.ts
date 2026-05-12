import { Router, type IRouter } from "express";
import {
  countSupabaseArticles,
  countSupabaseDigests,
  listSupabaseSources,
} from "../lib/supabase-data";
import { getSupabaseSourceSchemaStatus } from "../lib/supabase-sources";
import { getFirebaseDiagnostics, verifyFirestoreConnection } from "../lib/firebase";
import { useFirestoreData } from "../lib/firestore-data";
import { getScrapeStatus } from "../lib/scraper";
import { durableJobsReady, getQueueSummaryAsync } from "../lib/job-queue";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    if (useFirestoreData()) await verifyFirestoreConnection();
    const [sources, articleCount, digestCount] = await Promise.all([
      listSupabaseSources(),
      countSupabaseArticles(),
      countSupabaseDigests(),
    ]);
    res.json({
      status: "ok",
      database: useFirestoreData() ? "firestore" : "supabase",
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
    databaseProvider: process.env.DATABASE_PROVIDER ?? "legacy",
    supabaseUrl: Boolean(process.env.SUPABASE_URL),
    supabaseAnonKey: Boolean(process.env.SUPABASE_ANON_KEY),
    firebaseProjectId: Boolean(process.env.FIREBASE_PROJECT_ID),
    firebaseServiceAccount: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS),
    anthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    nodeEnv: process.env.NODE_ENV ?? "development",
  };

  try {
    if (useFirestoreData()) await verifyFirestoreConnection();
    const [sources, articleCount, pendingArticleCount, digestCount, pendingReviewCount, sourceSchema, jobs, durableReady] = await Promise.all([
      listSupabaseSources(),
      countSupabaseArticles(),
      countSupabaseArticles({ status: "pending" }),
      countSupabaseDigests(),
      countSupabaseDigests({ status: "pending_review" }),
      getSupabaseSourceSchemaStatus(),
      getQueueSummaryAsync(),
      durableJobsReady(),
    ]);
    const blockers = [
      !durableReady ? "Firestore is active; background jobs currently use the in-process queue until a Firestore durable jobs adapter is added." : null,
      !sourceSchema.supportsHealth ? "Source health metadata is not fully available for feed scoring diagnostics." : null,
      !env.anthropicApiKey ? "Configure ANTHROPIC_API_KEY for full provider-backed editorial synthesis." : null,
      process.env.NODE_ENV !== "production" ? "Run with NODE_ENV=production for live website deployment." : null,
      process.env.RGI_INLINE_JOBS !== "false" ? "Run API with RGI_INLINE_JOBS=false and a separate worker process for production isolation." : null,
    ].filter((item): item is string => Boolean(item));

    res.json({
      status: "ok",
      database: useFirestoreData() ? "firestore" : "supabase",
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
