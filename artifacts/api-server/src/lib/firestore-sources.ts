import type { Source } from "@workspace/db/schema";
import { getFirebaseBundle, isFirestoreTemporarilyDegraded, withFirestoreRetry, withTimeout } from "./firebase";
import {
  createLocalSource,
  deleteLocalSource,
  listLocalSources,
  localFallback,
  updateLocalSource,
} from "./local-store";
import { logger } from "./logger";

type SourcePatch = Partial<
  Pick<
    Source,
    | "name"
    | "url"
    | "type"
    | "tier"
    | "isActive"
    | "authorName"
    | "authorType"
    | "authorityLevel"
    | "description"
    | "weight"
  >
>;

type SourceHealth = {
  status: "healthy" | "warning" | "failed";
  lastScrapeAt?: Date;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
  consecutiveFailures?: number;
  articlesCollected?: number;
  articlesSaved?: number;
};

const COLLECTION = "sources";
let lastGoodSources: { items: Source[]; loadedAt: Date } | null = null;

export function useFirestoreData(): boolean {
  return true;
}

function dateFrom(value: unknown): Date {
  if (!value) return new Date(0);
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return new Date(0);
}

function clampWeight(value: unknown): number | undefined {
  const weight = Number(value);
  if (!Number.isFinite(weight)) return undefined;
  return Math.round(Math.max(0.5, Math.min(2, weight)) * 100) / 100;
}

function sourceFromDoc(doc: any): Source {
  const data = doc.data?.() ?? doc;
  const authorityLevel = Number(data.authorityLevel ?? data.credibilityScore ?? 3);
  return {
    id: String(data.id ?? doc.id) as unknown as Source["id"],
    name: String(data.name ?? data.title ?? "Untitled Source"),
    url: String(data.url ?? ""),
    type: String(data.type ?? "rss").toLowerCase() as Source["type"],
    tier: Number(data.tier ?? (authorityLevel >= 8 ? 1 : authorityLevel >= 6 ? 2 : 3)),
    isActive: data.isActive ?? (typeof data.status === "string" ? data.status.toLowerCase() === "active" : true),
    authorName: typeof data.authorName === "string" ? data.authorName : null,
    authorType: typeof data.authorType === "string" ? data.authorType : null,
    authorityLevel,
    description: typeof data.description === "string" ? data.description : null,
    weight: Number(data.weight ?? 1),
    createdAt: dateFrom(data.createdAt),
  };
}

function patchToDoc(patch: SourcePatch): Record<string, unknown> {
  const doc: Record<string, unknown> = {};
  if (patch.name !== undefined) doc.name = patch.name;
  if (patch.url !== undefined) doc.url = patch.url;
  if (patch.type !== undefined) doc.type = String(patch.type).toLowerCase();
  if (patch.tier !== undefined) doc.tier = patch.tier;
  if (patch.isActive !== undefined) doc.isActive = patch.isActive;
  if (patch.authorName !== undefined) doc.authorName = patch.authorName ?? null;
  if (patch.authorType !== undefined) doc.authorType = patch.authorType ?? null;
  if (patch.authorityLevel !== undefined) doc.authorityLevel = patch.authorityLevel;
  if (patch.description !== undefined) doc.description = patch.description ?? null;
  if (patch.weight !== undefined) {
    const weight = clampWeight(patch.weight);
    if (weight !== undefined) doc.weight = weight;
  }
  return doc;
}

export async function getFirestoreSourceSchemaStatus(): Promise<{
  columns: string[];
  supportsWeight: boolean;
  supportsDescription: boolean;
  supportsHealth: boolean;
}> {
  return {
    columns: [
      "id",
      "name",
      "url",
      "type",
      "tier",
      "isActive",
      "description",
      "weight",
      "healthStatus",
      "lastScrapeAt",
      "lastScrapeError",
      "lastSuccessAt",
      "consecutiveFailures",
      "reliabilityScore",
    ],
    supportsWeight: true,
    supportsDescription: true,
    supportsHealth: true,
  };
}

export async function listFirestoreSources(): Promise<Source[]> {
  try {
    const { db } = await getFirebaseBundle();
    const snapshot: any = await withFirestoreRetry("List Firestore sources", () => db.collection(COLLECTION).get());
    const sources = snapshot.docs
      .map(sourceFromDoc)
      .sort((a: Source, b: Source) => a.tier - b.tier || a.name.localeCompare(b.name));
    lastGoodSources = { items: sources, loadedAt: new Date() };
    logger.info(
      { collection: COLLECTION, count: sources.length, activeCount: sources.filter((source: Source) => source.isActive).length },
      "Listed Firestore sources"
    );
    return sources;
  } catch (error) {
    if (lastGoodSources?.items.length) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          count: lastGoodSources.items.length,
          loadedAt: lastGoodSources.loadedAt.toISOString(),
        },
        "Firestore sources unavailable; serving last-known-good Firestore sources"
      );
      return lastGoodSources.items;
    }
    return localFallback("list sources", error, listLocalSources);
  }
}

export async function createFirestoreSource(source: SourcePatch): Promise<Source> {
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const ref = db.collection(COLLECTION).doc();
    const doc = {
      ...patchToDoc(source),
      id: ref.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      healthStatus: "unknown",
      reliabilityScore: 100,
    };
    await withTimeout("Create Firestore source", ref.set(doc));
    const saved: any = await withTimeout("Read created Firestore source", ref.get());
    return sourceFromDoc(saved);
  } catch (error) {
    return localFallback("create source", error, () => createLocalSource(source as Partial<Source>));
  }
}

export async function updateFirestoreSource(id: number | string, patch: SourcePatch): Promise<Source | null> {
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const ref = db.collection(COLLECTION).doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore source", ref.get());
    if (!snapshot.exists) return null;
    await withTimeout("Update Firestore source", ref.set({ ...patchToDoc(patch), updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
    return sourceFromDoc(await withTimeout("Read updated Firestore source", ref.get()));
  } catch (error) {
    return localFallback("update source", error, () => updateLocalSource(id, patch as Partial<Source>));
  }
}

export async function deleteFirestoreSource(id: number | string): Promise<boolean> {
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db } = await getFirebaseBundle();
    const ref = db.collection(COLLECTION).doc(String(id));
    const snapshot: any = await withTimeout("Read Firestore source before delete", ref.get());
    if (!snapshot.exists) return false;
    await withTimeout("Delete Firestore source", ref.delete());
    return true;
  } catch (error) {
    return localFallback("delete source", error, () => deleteLocalSource(id));
  }
}

export async function updateFirestoreSourceHealth(id: number | string, health: SourceHealth): Promise<void> {
  try {
    if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
    const { db, FieldValue } = await getFirebaseBundle();
    const failures = health.consecutiveFailures ?? 0;
    const reliabilityScore = health.status === "healthy"
      ? 100
      : health.status === "warning"
        ? Math.max(45, 85 - failures * 10)
        : Math.max(0, 35 - failures * 5);

    await withTimeout("Update Firestore source health", db.collection(COLLECTION).doc(String(id)).set({
      healthStatus: health.status,
      lastScrapeAt: health.lastScrapeAt ?? new Date(),
      lastSuccessAt: health.lastSuccessAt ?? null,
      lastScrapeError: health.lastError ?? null,
      failureReason: health.lastError ?? null,
      consecutiveFailures: failures,
      totalArticlesCollected: health.articlesCollected ?? 0,
      totalArticlesSaved: health.articlesSaved ?? 0,
      avgArticleYield: health.articlesSaved ?? 0,
      reliabilityScore,
      cooldownUntil: health.status === "failed"
        ? new Date(Date.now() + Math.min(24, Math.max(1, failures)) * 60 * 60 * 1000)
        : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true }), 5000);
  } catch (error) {
    await localFallback("update source health", error, async () => {});
  }
}
