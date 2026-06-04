#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const apiRequire = createRequire(resolve(process.cwd(), "artifacts/api-server/package.json"));
const { initializeApp, applicationDefault, getApps } = apiRequire("firebase-admin/app");
const { FieldValue, getFirestore } = apiRequire("firebase-admin/firestore");

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    console.warn(`[firestore-test] No .env file found at ${envPath}; using current shell environment.`);
    return;
  }

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    let value = rest.join("=").trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  console.log(`[firestore-test] Loaded environment from ${envPath}`);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function withTimeout(label, promise, ms = 20000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("[firestore-test] Starting isolated Firestore connection test");
  loadDotEnv();

  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const credentialsPath = requireEnv("GOOGLE_APPLICATION_CREDENTIALS");
  const absoluteCredentialsPath = resolve(credentialsPath);

  console.log(`[firestore-test] FIREBASE_PROJECT_ID: ${projectId}`);
  console.log(`[firestore-test] GOOGLE_APPLICATION_CREDENTIALS: ${absoluteCredentialsPath}`);

  if (!existsSync(absoluteCredentialsPath)) {
    throw new Error(`Credential file does not exist: ${absoluteCredentialsPath}`);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = absoluteCredentialsPath;
  console.log("[firestore-test] Credential file exists");

  console.log("[firestore-test] Initializing Firebase Admin SDK");
  const app = getApps()[0] ?? initializeApp({
    credential: applicationDefault(),
    projectId,
  });

  const db = getFirestore(app);
  db.settings?.({ ignoreUndefinedProperties: true });
  console.log("[firestore-test] Firebase Admin SDK initialized");

  const docId = `connection-test-${Date.now()}`;
  const ref = db.collection("_migration_checks").doc(docId);
  const payload = {
    ok: true,
    projectId,
    createdAt: FieldValue.serverTimestamp(),
    source: "scripts/test-firestore-connection.mjs",
  };

  try {
    console.log(`[firestore-test] Writing temporary document: _migration_checks/${docId}`);
    await withTimeout("Temporary Firestore write", ref.set(payload));

    console.log("[firestore-test] Reading temporary document back");
    const snapshot = await withTimeout("Temporary Firestore read", ref.get());
    if (!snapshot.exists) {
      throw new Error("Temporary Firestore document was not found after write.");
    }

    const data = snapshot.data() ?? {};
    if (data.ok !== true || data.projectId !== projectId) {
      throw new Error(`Temporary Firestore document content mismatch: ${JSON.stringify(data)}`);
    }

    console.log("[firestore-test] Read/write verification succeeded");
  } finally {
    console.log(`[firestore-test] Deleting temporary document: _migration_checks/${docId}`);
    await withTimeout("Temporary Firestore delete", ref.delete()).catch((error) => {
      console.warn("[firestore-test] Warning: failed to delete temporary document", error);
    });
  }

  console.log("[firestore-test] SUCCESS: Firestore Admin read/write/delete access is working.");
}

main().catch((error) => {
  console.error("[firestore-test] FAILURE");
  console.error(`[firestore-test] Message: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.stack) {
    console.error("[firestore-test] Stack:");
    console.error(error.stack);
  }
  process.exit(1);
});
