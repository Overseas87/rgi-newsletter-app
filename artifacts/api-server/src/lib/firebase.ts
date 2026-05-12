import { existsSync } from "node:fs";
import { logger } from "./logger";

type FirebaseBundle = {
  app: unknown;
  db: any;
  FieldValue: any;
};

let bundlePromise: Promise<FirebaseBundle> | null = null;

export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "rgi-insight-blog-generator";

export function isFirebaseConfigured(): boolean {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasUsableServiceAccount = Boolean(serviceAccount && !serviceAccount.includes("PLACEHOLDER"));
  return Boolean(hasUsableServiceAccount || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

export function getFirebaseDiagnostics(): Record<string, unknown> {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
  return {
    databaseProvider: process.env.DATABASE_PROVIDER ?? null,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? null,
    hasServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON),
    hasUsableServiceAccountJson: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON.includes("PLACEHOLDER")),
    googleApplicationCredentials: credentialsPath,
    googleApplicationCredentialsExists: credentialsPath ? existsSync(credentialsPath) : false,
    nodeEnv: process.env.NODE_ENV ?? null,
  };
}

export function missingFirebaseConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.FIREBASE_PROJECT_ID) missing.push("FIREBASE_PROJECT_ID");
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const hasJson = Boolean(serviceAccount && !serviceAccount.includes("PLACEHOLDER"));
  const hasGoogleCredentials = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!hasJson && !hasGoogleCredentials) {
    missing.push("FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS");
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    missing.push(`GOOGLE_APPLICATION_CREDENTIALS file does not exist: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
  }
  if (serviceAccount?.includes("PLACEHOLDER")) {
    missing.push("replace placeholder FIREBASE_SERVICE_ACCOUNT_JSON");
  }
  return missing;
}

export function assertFirebaseConfigured(): void {
  const missing = missingFirebaseConfig();
  if (missing.length > 0) {
    throw new Error(
      `Firebase/Firestore is the configured database, but Firebase Admin credentials are incomplete. Missing: ${missing.join(", ")}. ` +
      "Provide a real service account via GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON."
    );
  }
}

async function runtimeImport<T = any>(specifier: string): Promise<T> {
  const importer = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<T>;
  return importer(specifier);
}

function parseServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw.includes("PLACEHOLDER")) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.private_key === "string") {
      parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    }
    return parsed;
  } catch (error) {
    logger.warn({ err: error }, "Invalid FIREBASE_SERVICE_ACCOUNT_JSON; falling back to application default credentials");
    return null;
  }
}

export async function getFirebaseBundle(): Promise<FirebaseBundle> {
  if (bundlePromise) return bundlePromise;

  bundlePromise = (async () => {
    logger.info(getFirebaseDiagnostics(), "Initializing Firebase Admin SDK");
    try {
      assertFirebaseConfigured();
      const appModule = await runtimeImport<any>("firebase-admin/app");
      const firestoreModule = await runtimeImport<any>("firebase-admin/firestore");
      const existingApps = appModule.getApps();
      const serviceAccount = parseServiceAccount();
      const credential = serviceAccount
        ? appModule.cert(serviceAccount)
        : appModule.applicationDefault();

      const app = existingApps[0] ?? appModule.initializeApp({
        credential,
        projectId: FIREBASE_PROJECT_ID,
      });

      const db = firestoreModule.getFirestore(app);
      db.settings?.({ ignoreUndefinedProperties: true });
      logger.info({ projectId: FIREBASE_PROJECT_ID }, "Firebase Admin SDK initialized");

      return {
        app,
        db,
        FieldValue: firestoreModule.FieldValue,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        {
          message: err.message,
          stack: err.stack,
          diagnostics: getFirebaseDiagnostics(),
        },
        "Firebase Admin SDK initialization failed"
      );
      bundlePromise = null;
      throw err;
    }
  })();

  return bundlePromise;
}

export async function verifyFirestoreConnection(): Promise<void> {
  logger.info(getFirebaseDiagnostics(), "Verifying Firestore API access");
  try {
    const { db } = await getFirebaseBundle();
    await db.collection("_meta").doc("healthcheck").get();
    logger.info({ projectId: FIREBASE_PROJECT_ID }, "Firestore API access verified");
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(
      {
        message: err.message,
        stack: err.stack,
        diagnostics: getFirebaseDiagnostics(),
      },
      "Firestore API access failed"
    );
    throw err;
  }
}
