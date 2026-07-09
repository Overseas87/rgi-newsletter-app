#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { initializeApp, cert, applicationDefault, getApps, deleteApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const EXPECTED_SOURCE_PROJECT = "rgi-insight-blog-generator";
const EXPECTED_TARGET_PROJECT = "blog-generator-1bb12";
const DEFAULT_COLLECTIONS = [
  "settings",
  "sources",
  "_meta",
  "_article_dedupe",
  "articles",
  "digest_articles",
];
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const DEFAULT_BATCH_SIZE = 400;
const MAX_BATCH_SIZE = 450;

function usage() {
  return [
    "Usage:",
    "  node scripts/migration/blog-targeted-firestore-migrate.mjs \\",
    "    --source-project rgi-insight-blog-generator \\",
    "    --target-project blog-generator-1bb12 \\",
    "    --source-credentials /path/to/source-service-account.json \\",
    "    --collections settings,sources,_meta,_article_dedupe,articles,digest_articles",
    "",
    "Dry-run is the default. Writes require --execute --confirm-target blog-generator-1bb12.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    sourceProject: null,
    targetProject: null,
    sourceCredentials: null,
    targetCredentials: null,
    collections: DEFAULT_COLLECTIONS,
    execute: false,
    confirmTarget: null,
    includeTerminalJobsOnly: false,
    allowNonEmptyTarget: false,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--source-project":
        args.sourceProject = readValue();
        break;
      case "--target-project":
        args.targetProject = readValue();
        break;
      case "--source-credentials":
        args.sourceCredentials = readValue();
        break;
      case "--target-credentials":
        args.targetCredentials = readValue();
        break;
      case "--collections":
        args.collections = readValue().split(",").map((item) => item.trim()).filter(Boolean);
        break;
      case "--dry-run":
        args.execute = false;
        break;
      case "--execute":
        args.execute = true;
        break;
      case "--confirm-target":
        args.confirmTarget = readValue();
        break;
      case "--include-terminal-jobs-only":
        args.includeTerminalJobsOnly = true;
        break;
      case "--allow-non-empty-target":
        args.allowNonEmptyTarget = true;
        break;
      case "--batch-size":
        args.batchSize = Number(readValue());
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function validateArgs(args) {
  if (args.help) return;
  if (!args.sourceProject) throw new Error("--source-project is required");
  if (!args.targetProject) throw new Error("--target-project is required");
  if (!args.sourceCredentials) throw new Error("--source-credentials is required for old-project reads");
  if (args.sourceProject !== EXPECTED_SOURCE_PROJECT) {
    throw new Error(`Refusing unexpected source project: ${args.sourceProject}`);
  }
  if (args.targetProject !== EXPECTED_TARGET_PROJECT) {
    throw new Error(`Refusing unexpected target project: ${args.targetProject}`);
  }
  if (args.sourceProject === args.targetProject) {
    throw new Error("Refusing to migrate because source and target project IDs are identical");
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1 || args.batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be an integer between 1 and ${MAX_BATCH_SIZE}`);
  }
  if (!Array.isArray(args.collections) || args.collections.length === 0) {
    throw new Error("--collections must include at least one collection");
  }
  if (args.collections.includes("background_jobs") && !args.includeTerminalJobsOnly) {
    throw new Error("background_jobs requires --include-terminal-jobs-only; active jobs are never migrated by this script");
  }
  if (args.execute && args.confirmTarget !== EXPECTED_TARGET_PROJECT) {
    throw new Error(`Execute mode requires --confirm-target ${EXPECTED_TARGET_PROJECT}`);
  }
}

function loadCredential(path, label) {
  if (!path) return null;
  if (!existsSync(path)) {
    throw new Error(`${label} credential file does not exist`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return cert(parsed);
}

function initializeFirestore({ name, projectId, credentialPath, useAdcFallback }) {
  const credential = credentialPath
    ? loadCredential(credentialPath, name)
    : useAdcFallback
      ? applicationDefault()
      : null;
  if (!credential) {
    throw new Error(`${name} credentials are required`);
  }
  const app = initializeApp({ credential, projectId }, name);
  const db = getFirestore(app);
  db.settings?.({ ignoreUndefinedProperties: true });
  return { app, db };
}

async function countQuery(query) {
  if (typeof query.count === "function") {
    const snapshot = await query.count().get();
    return Number(snapshot.data().count ?? 0);
  }
  const snapshot = await query.select(FieldPath.documentId()).get();
  return snapshot.size;
}

function sourceQuery(db, collectionName, args) {
  let query = db.collection(collectionName);
  if (collectionName === "background_jobs") {
    query = query.where("status", "in", [...TERMINAL_JOB_STATUSES]);
  }
  return query;
}

async function countCollection(db, collectionName, args) {
  return countQuery(sourceQuery(db, collectionName, args));
}

async function listTargetExistingIds(targetDb, collectionName, ids) {
  if (ids.length === 0) return new Set();
  const refs = ids.map((id) => targetDb.collection(collectionName).doc(id));
  const snapshots = await targetDb.getAll(...refs);
  return new Set(snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => snapshot.id));
}

async function migrateCollection({ sourceDb, targetDb, collectionName, args }) {
  const sourceCount = await countCollection(sourceDb, collectionName, args);
  const targetCount = await countCollection(targetDb, collectionName, args);
  const result = {
    collection: collectionName,
    sourceCount,
    targetCountBefore: targetCount,
    targetCountAfter: targetCount,
    planned: 0,
    created: 0,
    conflicts: 0,
    skipped: 0,
  };

  console.log(`[${collectionName}] source=${sourceCount} target=${targetCount}`);

  if (args.execute && targetCount > 0 && !args.allowNonEmptyTarget) {
    throw new Error(`[${collectionName}] target is non-empty; refusing execute mode without --allow-non-empty-target`);
  }

  let lastId = null;
  for (;;) {
    let query = sourceQuery(sourceDb, collectionName, args)
      .orderBy(FieldPath.documentId())
      .limit(args.batchSize);
    if (lastId) query = query.startAfter(lastId);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const docs = snapshot.docs;
    lastId = docs[docs.length - 1].id;
    const ids = docs.map((doc) => doc.id);
    const existingIds = await listTargetExistingIds(targetDb, collectionName, ids);
    const writableDocs = docs.filter((doc) => !existingIds.has(doc.id));
    const conflicts = docs.length - writableDocs.length;

    result.planned += writableDocs.length;
    result.conflicts += conflicts;
    result.skipped += conflicts;

    if (args.execute && writableDocs.length > 0) {
      const batch = targetDb.batch();
      for (const doc of writableDocs) {
        batch.create(targetDb.collection(collectionName).doc(doc.id), doc.data());
      }
      await batch.commit();
      result.created += writableDocs.length;
    }

    const action = args.execute ? "created" : "would-create";
    console.log(
      `[${collectionName}] scanned=${result.planned + result.conflicts} ${action}=${args.execute ? result.created : result.planned} conflicts=${result.conflicts}`,
    );
  }

  result.targetCountAfter = args.execute
    ? await countCollection(targetDb, collectionName, args)
    : targetCount;
  console.log(
    `[${collectionName}] done source=${result.sourceCount} targetBefore=${result.targetCountBefore} targetAfter=${result.targetCountAfter} planned=${result.planned} conflicts=${result.conflicts}`,
  );
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  validateArgs(args);

  console.log(`Mode: ${args.execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`Source project: ${args.sourceProject}`);
  console.log(`Target project: ${args.targetProject}`);
  console.log(`Collections: ${args.collections.join(",")}`);
  if (!args.targetCredentials) {
    console.log("Target credentials: Application Default Credentials");
  }
  if (args.collections.includes("background_jobs")) {
    console.log("background_jobs: terminal statuses only");
  }

  const source = initializeFirestore({
    name: "blog-source",
    projectId: args.sourceProject,
    credentialPath: args.sourceCredentials,
    useAdcFallback: false,
  });
  const target = initializeFirestore({
    name: "blog-target",
    projectId: args.targetProject,
    credentialPath: args.targetCredentials,
    useAdcFallback: true,
  });

  try {
    const results = [];
    for (const collectionName of args.collections) {
      results.push(await migrateCollection({
        sourceDb: source.db,
        targetDb: target.db,
        collectionName,
        args,
      }));
    }

    console.log("Summary:");
    for (const result of results) {
      console.log(
        [
          result.collection,
          `source=${result.sourceCount}`,
          `targetBefore=${result.targetCountBefore}`,
          `targetAfter=${result.targetCountAfter}`,
          `planned=${result.planned}`,
          `created=${result.created}`,
          `conflicts=${result.conflicts}`,
        ].join(" "),
      );
    }
    if (!args.execute) {
      console.log("Dry-run complete. No Firestore writes were performed.");
    }
  } finally {
    await Promise.all(getApps().map((app) => deleteApp(app)));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
