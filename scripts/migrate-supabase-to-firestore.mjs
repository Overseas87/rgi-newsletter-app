#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const requireFromApiServer = createRequire(resolve(process.cwd(), "artifacts/api-server/package.json"));

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (!key || process.env[key]) continue;
    let value = rest.join("=").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  console.log(`[migration] Loaded environment from ${envPath}`);
}

loadDotEnv();

const supabaseUrl = (process.env.SUPABASE_MIGRATION_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey =
  process.env.SUPABASE_MIGRATION_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_MIGRATION_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!process.env.FIREBASE_PROJECT_ID) throw new Error("FIREBASE_PROJECT_ID is required.");
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON is required.");
}
if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL/SUPABASE_ANON_KEY or SUPABASE_MIGRATION_URL/SUPABASE_MIGRATION_*_KEY is required.");
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS && !existsSync(resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS))) {
  throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file does not exist: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
}

const appModule = requireFromApiServer("firebase-admin/app");
const firestoreModule = requireFromApiServer("firebase-admin/firestore");
const { initializeApp, applicationDefault, cert, getApps } = appModule;
const { FieldValue, getFirestore } = firestoreModule;

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON.includes("PLACEHOLDER")
  ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
  : applicationDefault();

const app = getApps()[0] ?? initializeApp({
  credential: serviceAccount,
  projectId: process.env.FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings?.({ ignoreUndefinedProperties: true });

const tables = [
  { table: "sources", collection: "sources" },
  { table: "articles", collection: "articles" },
  { table: "digest_articles", collection: "digest_articles" },
  { table: "settings", collection: "settings" },
  { table: "newsletter_subscribers", collection: "newsletter_subscribers" },
  { table: "newsletter_digests", collection: "newsletter_digests" },
];

const report = {
  startedAt: new Date().toISOString(),
  finishedAt: null,
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
  supabaseUrl,
  databaseProviderUnchanged: process.env.DATABASE_PROVIDER ?? null,
  collections: [],
};

function toCamel(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function normalize(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value;
  }
  return {
    ...out,
    migratedFrom: "supabase",
    migratedAt: FieldValue.serverTimestamp(),
  };
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error
    ? `; cause=${error.cause.message}`
    : error.cause
      ? `; cause=${JSON.stringify(error.cause)}`
      : "";
  return `${error.message}${cause}`;
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    ...extra,
  };
}

async function supabaseCount(table) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id`, {
    headers: supabaseHeaders({ Prefer: "count=exact", Range: "0-0" }),
  });
  if (!response.ok) throw new Error(`Supabase count failed for ${table}: ${response.status} ${await response.text()}`);
  const range = response.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function fetchTable(table, from = 0, size = 500) {
  const to = from + size - 1;
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&order=id.asc`, {
    headers: supabaseHeaders({
      Range: `${from}-${to}`,
      Prefer: "count=exact",
    }),
  });
  if (!response.ok) throw new Error(`Supabase read failed for ${table}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function firestoreCount(collection) {
  const aggregate = await db.collection(collection).count().get();
  return Number(aggregate.data().count ?? 0);
}

async function writeRows(collection, rows) {
  const failedRows = [];
  for (let i = 0; i < rows.length; i += 450) {
    const chunk = rows.slice(i, i + 450);
    const batch = db.batch();
    for (const row of chunk) {
      try {
        const id = String(row.id ?? crypto.randomUUID());
        batch.set(db.collection(collection).doc(id), normalize(row), { merge: true });
      } catch (error) {
        failedRows.push({
          id: row?.id ?? null,
          error: describeError(error),
        });
      }
    }
    await batch.commit();
  }
  return failedRows;
}

async function migrateTable(item) {
  console.log(`[migration] Migrating ${item.table} -> ${item.collection}`);
  const startedAt = new Date().toISOString();
  const summary = {
    table: item.table,
    collection: item.collection,
    startedAt,
    finishedAt: null,
    supabaseCount: 0,
    firestoreCountBefore: 0,
    firestoreCountAfter: 0,
    rowsRead: 0,
    rowsWritten: 0,
    failedRows: [],
    status: "pending",
  };

  try {
    summary.supabaseCount = await supabaseCount(item.table);
    summary.firestoreCountBefore = await firestoreCount(item.collection);

    let offset = 0;
    while (true) {
      const rows = await fetchTable(item.table, offset);
      if (!rows.length) break;
      const failedRows = await writeRows(item.collection, rows);
      summary.failedRows.push(...failedRows);
      summary.rowsRead += rows.length;
      summary.rowsWritten += rows.length - failedRows.length;
      offset += rows.length;
      console.log(`[migration] ${item.table}: ${summary.rowsRead}/${summary.supabaseCount} read, ${summary.rowsWritten} written`);
      if (rows.length < 500) break;
    }

    summary.firestoreCountAfter = await firestoreCount(item.collection);
    summary.status = summary.failedRows.length === 0 ? "ok" : "partial";
  } catch (error) {
    summary.status = "failed";
    summary.failedRows.push({
      id: null,
      error: describeError(error),
    });
  } finally {
    summary.finishedAt = new Date().toISOString();
  }

  console.log(
    `[migration] ${item.table}: status=${summary.status}, supabase=${summary.supabaseCount}, firestoreBefore=${summary.firestoreCountBefore}, firestoreAfter=${summary.firestoreCountAfter}, failed=${summary.failedRows.length}`
  );
  return summary;
}

for (const item of tables) {
  report.collections.push(await migrateTable(item));
}

report.finishedAt = new Date().toISOString();
mkdirSync(resolve(process.cwd(), "migration-reports"), { recursive: true });
const reportPath = resolve(process.cwd(), "migration-reports", `supabase-to-firestore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

console.log("\n[migration] Validation summary");
for (const item of report.collections) {
  const countMatches = item.firestoreCountAfter >= item.supabaseCount;
  console.log(
    `- ${item.table} -> ${item.collection}: ${item.status}; Supabase=${item.supabaseCount}; Firestore=${item.firestoreCountAfter}; failedRows=${item.failedRows.length}; countCheck=${countMatches ? "ok" : "needs review"}`
  );
}
console.log(`[migration] Report written to ${reportPath}`);
console.log("[migration] Runtime DATABASE_PROVIDER was not changed.");
