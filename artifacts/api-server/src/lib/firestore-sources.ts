import type { Source } from "@workspace/db/schema";
import { getFirebaseBundle, isFirebaseConfigured } from "./firebase";

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

export function useFirestoreData(): boolean {
  return process.env.DATABASE_PROVIDER === "firestore" && isFirebaseConfigured();
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
  const { db } = await getFirebaseBundle();
  const snapshot = await db.collection(COLLECTION).get();
  return snapshot.docs
    .map(sourceFromDoc)
    .sort((a: Source, b: Source) => a.tier - b.tier || a.name.localeCompare(b.name));
}

export async function createFirestoreSource(source: SourcePatch): Promise<Source> {
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
  await ref.set(doc);
  const saved = await ref.get();
  return sourceFromDoc(saved);
}

export async function updateFirestoreSource(id: number | string, patch: SourcePatch): Promise<Source | null> {
  const { db, FieldValue } = await getFirebaseBundle();
  const ref = db.collection(COLLECTION).doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;
  await ref.set({ ...patchToDoc(patch), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return sourceFromDoc(await ref.get());
}

export async function deleteFirestoreSource(id: number | string): Promise<boolean> {
  const { db } = await getFirebaseBundle();
  const ref = db.collection(COLLECTION).doc(String(id));
  const snapshot = await ref.get();
  if (!snapshot.exists) return false;
  await ref.delete();
  return true;
}

export async function updateFirestoreSourceHealth(id: number | string, health: SourceHealth): Promise<void> {
  const { db, FieldValue } = await getFirebaseBundle();
  const failures = health.consecutiveFailures ?? 0;
  const reliabilityScore = health.status === "healthy"
    ? 100
    : health.status === "warning"
      ? Math.max(45, 85 - failures * 10)
      : Math.max(0, 35 - failures * 5);

  await db.collection(COLLECTION).doc(String(id)).set({
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
  }, { merge: true });
}
