import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { initializeScrapeStatus } from "./lib/scraper";
import sourcesRouter from "./routes/sources";
import { listSupabaseArticles, listSupabaseDigests, listSupabaseSources, useSupabaseData } from "./lib/supabase-data";
import { markStaleRunningJobsFailed } from "./lib/job-queue";
import { getFirebaseDiagnostics, verifyFirestoreConnection } from "./lib/firebase";
import { useFirestoreData } from "./lib/firestore-data";

const app: Express = express();
app.set("etag", false);

// Startup must never block the local editorial workflow. Firebase is optional
// tonight; if it fails, the app falls back to the legacy operational datasource.
export async function initializeApp() {
  logger.info(getFirebaseDiagnostics(), "Startup environment diagnostics");

  if (useFirestoreData()) {
    try {
      await verifyFirestoreConnection();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn({ message: error.message, stack: error.stack }, "Firestore unavailable; continuing with fallback datasource");
      process.env.DATABASE_PROVIDER = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? "supabase" : "legacy";
    }
  }

  try {
    if (useSupabaseData()) {
      const [sources, articles, digests] = await Promise.all([
        listSupabaseSources(),
        listSupabaseArticles({ limit: 1 }),
        listSupabaseDigests({ limit: 1 }),
      ]);
      logger.info(
        { database: useFirestoreData() ? "firestore" : "supabase", sourcesCount: sources.length, articlesCount: articles.length, digestsCount: digests.length },
        "Operational datasource audit complete"
      );
      if (sources.length === 0) {
        logger.warn("No sources found in the active datasource. Add sources in the Sources page before scraping.");
      }
    } else {
      logger.warn("No Firebase or Supabase datasource is available; legacy route fallbacks may have limited data.");
    }

    await markStaleRunningJobsFailed(60);
    await initializeScrapeStatus();
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn(
      {
        message: error.message,
        stack: error.stack,
        diagnostics: getFirebaseDiagnostics(),
      },
      "Datasource initialization failed; backend will still start for local UI and editorial workflows"
    );
  }

  startScheduler();
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(sourcesRouter);
app.use("/api", router);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found", path: req.path });
});

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err, path: req.path }, "Unhandled API error");
  if (res.headersSent) return;

  const wantsHtml = (req.get("accept") ?? "").includes("text/html") && !req.path.startsWith("/api");
  if (wantsHtml) {
    const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:21410";
    res.redirect(302, frontendUrl);
    return;
  }

  res.status(500).json({ error: "Internal server error" });
});

export default app;
