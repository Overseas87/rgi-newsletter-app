import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { initializeScrapeStatus } from "./lib/scraper";
import sourcesRouter from "./routes/sources";
import { listFirestoreArticles, listFirestoreDigests } from "./lib/firestore-data";
import { listFirestoreSources } from "./lib/firestore-sources";
import { markStaleRunningJobsFailed } from "./lib/job-queue";
import { getFirebaseDiagnostics, verifyFirestoreConnection } from "./lib/firebase";
import { createAdminMutationGuard } from "./lib/internal-editor-auth";

const app: Express = express();
app.set("etag", false);

const CANONICAL_RUNTIME =
  "Canonical production runtime: Firebase Hosting serves the Vite app and rewrites /api/** to Firebase Functions. Docker/Cloud Run remains an optional API runtime for later migration.";

function configuredCorsOrigins(): string[] {
  const configured = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_APP_URL,
    process.env.APP_ORIGIN,
    process.env.CORS_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (configured.length > 0) return [...new Set(configured)];
  if (process.env.NODE_ENV === "production") return [];
  return ["http://localhost:21410", "http://127.0.0.1:21410", "http://localhost:5173", "http://127.0.0.1:5173"];
}

function readOnlyStartupEnabled(): boolean {
  return process.env.RGI_READ_ONLY_STARTUP === "true";
}

async function withStartupTimeout<T>(label: string, promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

// Startup must never block the local editorial workflow. Firebase is optional
// tonight; if it fails, the app falls back to the legacy operational datasource.
export async function initializeApp() {
  logger.info({ ...getFirebaseDiagnostics(), canonicalRuntime: CANONICAL_RUNTIME }, "Startup environment diagnostics");

  try {
    await withStartupTimeout("Firestore verification", verifyFirestoreConnection(), 8000);
    const [sources, articles, digests] = await withStartupTimeout("Firestore startup audit", Promise.all([
      listFirestoreSources(),
      listFirestoreArticles({ limit: 1 }),
      listFirestoreDigests({ limit: 1 }),
    ]), 10000);
    logger.info(
      { database: "firestore", sourcesCount: sources.length, articlesCount: articles.length, digestsCount: digests.length },
      "Operational datasource audit complete"
    );
    if (sources.length === 0) {
      logger.warn("No sources found in Firestore. Add sources in the Sources page before scraping.");
    }

    if (readOnlyStartupEnabled()) {
      logger.info("Read-only startup enabled; skipping Firestore job recovery writes");
    } else {
      await withStartupTimeout("job recovery", markStaleRunningJobsFailed(60), 5000);
    }
    await withStartupTimeout("scrape status initialization", initializeScrapeStatus(), 5000);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.warn(
      {
        message: error.message,
        stack: error.stack,
        diagnostics: getFirebaseDiagnostics(),
      },
      "Firestore initialization failed; backend will still start so the error is visible in diagnostics"
    );
  }

  const managedRuntime = Boolean(process.env.FUNCTION_TARGET || process.env.K_SERVICE);
  if (readOnlyStartupEnabled()) {
    logger.info("Read-only startup enabled; scheduler disabled");
  } else if (process.env.RGI_START_SCHEDULER === "false") {
    logger.info("Local scheduler disabled by RGI_START_SCHEDULER=false");
  } else if (managedRuntime) {
    logger.info("Managed cloud runtime detected; Firebase scheduled functions own scrape and brief schedules");
  } else {
    startScheduler();
  }
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
app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowed = configuredCorsOrigins();
    if (allowed.includes(origin.replace(/\/+$/, ""))) {
      callback(null, true);
      return;
    }
    if (process.env.NODE_ENV !== "production" && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createAdminMutationGuard());

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
