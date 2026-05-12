import type { Source } from "@workspace/db/schema";
import {
  createFirestoreSource,
  deleteFirestoreSource,
  getFirestoreSourceSchemaStatus,
  listFirestoreSources,
  updateFirestoreSource,
  updateFirestoreSourceHealth,
  useFirestoreData,
} from "./firestore-sources";

type SupabaseSourceRow = {
  id: number | string;
  name?: string;
  title?: string;
  url: string;
  type?: Source["type"];
  status?: string;
  tier?: number;
  is_active?: boolean;
  author_name?: string | null;
  author_type?: string | null;
  authority_level?: number | null;
  credibility_score?: number | null;
  description?: string | null;
  weight?: number;
  health_status?: string | null;
  last_scrape_at?: string | null;
  last_scrape_error?: string | null;
  last_success_at?: string | null;
  consecutive_failures?: number | null;
  scrape_attempts?: number | null;
  scrape_successes?: number | null;
  scrape_failures?: number | null;
  total_articles_collected?: number | null;
  total_articles_saved?: number | null;
  avg_article_yield?: number | null;
  reliability_score?: number | null;
  cooldown_until?: string | null;
  failure_reason?: string | null;
  created_at?: string;
};

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

let cachedSourceColumns: Set<string> | null = null;

export function isSupabaseConfigured(): boolean {
  return useFirestoreData() || Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  }

  return { url, anonKey };
}

function headers(extra?: Record<string, string>): Record<string, string> {
  const { anonKey } = getSupabaseConfig();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function sourceFromRow(row: SupabaseSourceRow): Source {
  const authorityLevel = row.authority_level ?? row.credibility_score ?? 3;
  const normalizedType = String(row.type ?? "rss").toLowerCase() as Source["type"];
  const isActive = row.is_active ?? (row.status ? row.status.toLowerCase() === "active" : true);

  return {
    id: row.id as Source["id"],
    name: row.name ?? row.title ?? "Untitled Source",
    url: row.url,
    type: normalizedType,
    tier: row.tier ?? (authorityLevel >= 8 ? 1 : authorityLevel >= 6 ? 2 : 3),
    isActive,
    authorName: row.author_name ?? null,
    authorType: row.author_type ?? null,
    authorityLevel,
    description: row.description ?? null,
    weight: row.weight ?? 1,
    createdAt: row.created_at ? new Date(row.created_at) : new Date(0),
  };
}

function clampWeight(value: unknown): number | undefined {
  const weight = Number(value);
  if (!Number.isFinite(weight)) return undefined;
  return Math.round(Math.max(0.5, Math.min(2, weight)) * 100) / 100;
}

async function sourceColumns(): Promise<Set<string>> {
  if (cachedSourceColumns) return cachedSourceColumns;

  try {
    const rows = await requestSources("sources?select=*&limit=1");
    cachedSourceColumns = new Set(Object.keys(rows[0] ?? {}));
  } catch {
    cachedSourceColumns = new Set(["id", "title", "url", "type", "status", "credibility_score", "created_at"]);
  }

  return cachedSourceColumns;
}

export async function getSupabaseSourceSchemaStatus(): Promise<{
  columns: string[];
  supportsWeight: boolean;
  supportsDescription: boolean;
  supportsHealth: boolean;
}> {
  if (useFirestoreData()) return getFirestoreSourceSchemaStatus();
  const columns = await sourceColumns();
  return {
    columns: [...columns].sort(),
    supportsWeight: columns.has("weight"),
    supportsDescription: columns.has("description"),
    supportsHealth: columns.has("health_status") && columns.has("last_scrape_at"),
  };
}

function rowFromPatch(patch: SourcePatch, columns: Set<string>): Partial<SupabaseSourceRow> {
  const row: Partial<SupabaseSourceRow> = {};
  if (patch.name !== undefined) row.title = patch.name;
  if (patch.url !== undefined) row.url = patch.url;
  if (patch.type !== undefined) row.type = patch.type.toUpperCase() as Source["type"];
  if (patch.isActive !== undefined) row.status = patch.isActive ? "Active" : "Inactive";
  if (patch.authorityLevel !== undefined) row.credibility_score = patch.authorityLevel;
  if (patch.tier !== undefined && patch.authorityLevel === undefined) {
    row.credibility_score = patch.tier === 1 ? 9 : patch.tier === 2 ? 7 : 5;
  }
  if (columns.has("description") && patch.description !== undefined) {
    row.description = patch.description ?? null;
  }
  if (columns.has("weight") && patch.weight !== undefined) {
    const weight = clampWeight(patch.weight);
    if (weight !== undefined) row.weight = weight;
  }
  return row;
}

async function requestSources(path: string, init?: RequestInit): Promise<SupabaseSourceRow[]> {
  const { url } = getSupabaseConfig();
  const extraHeaders = init?.headers as Record<string, string> | undefined;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: headers(extraHeaders),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Supabase sources request failed (${response.status}): ${message}`);
  }

  if (response.status === 204) {
    return [];
  }

  return (await response.json()) as SupabaseSourceRow[];
}

export async function listSupabaseSources(): Promise<Source[]> {
  if (useFirestoreData()) return listFirestoreSources();
  const rows = await requestSources("sources?select=*");
  return rows
    .map(sourceFromRow)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

export async function createSupabaseSource(source: SourcePatch): Promise<Source> {
  if (useFirestoreData()) return createFirestoreSource(source);
  const columns = await sourceColumns();
  const rows = await requestSources("sources", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rowFromPatch(source, columns)),
  });
  if (!rows[0]) throw new Error("Supabase did not return the created source.");
  cachedSourceColumns = new Set(Object.keys(rows[0] ?? {}));
  return sourceFromRow(rows[0]);
}

export async function updateSupabaseSource(id: number | string, patch: SourcePatch): Promise<Source | null> {
  if (useFirestoreData()) return updateFirestoreSource(id, patch);
  const columns = await sourceColumns();
  const rows = await requestSources(`sources?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(rowFromPatch(patch, columns)),
  });
  if (rows[0]) cachedSourceColumns = new Set(Object.keys(rows[0]));
  return rows[0] ? sourceFromRow(rows[0]) : null;
}

export async function deleteSupabaseSource(id: number | string): Promise<boolean> {
  if (useFirestoreData()) return deleteFirestoreSource(id);
  const rows = await requestSources(`sources?id=eq.${id}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  return rows.length > 0;
}

export async function updateSupabaseSourceHealth(
  id: number | string,
  health: {
    status: "healthy" | "warning" | "failed";
    lastScrapeAt?: Date;
    lastSuccessAt?: Date | null;
    lastError?: string | null;
    consecutiveFailures?: number;
    articlesCollected?: number;
    articlesSaved?: number;
  }
): Promise<void> {
  if (useFirestoreData()) return updateFirestoreSourceHealth(id, health);
  const columns = await sourceColumns();
  const row: Partial<SupabaseSourceRow> = {};

  if (columns.has("health_status")) row.health_status = health.status;
  if (columns.has("last_scrape_at")) row.last_scrape_at = (health.lastScrapeAt ?? new Date()).toISOString();
  if (columns.has("last_success_at")) row.last_success_at = health.lastSuccessAt instanceof Date ? health.lastSuccessAt.toISOString() : null;
  if (columns.has("last_scrape_error")) row.last_scrape_error = health.lastError ?? null;
  if (columns.has("consecutive_failures")) row.consecutive_failures = health.consecutiveFailures ?? 0;
  if (columns.has("failure_reason")) row.failure_reason = health.lastError ?? null;
  if (columns.has("reliability_score")) {
    const failures = health.consecutiveFailures ?? 0;
    const score = health.status === "healthy" ? 100 : health.status === "warning" ? Math.max(45, 85 - failures * 10) : Math.max(0, 35 - failures * 5);
    row.reliability_score = score;
  }
  if (columns.has("cooldown_until")) {
    row.cooldown_until = health.status === "failed"
      ? new Date(Date.now() + Math.min(24, Math.max(1, health.consecutiveFailures ?? 1)) * 60 * 60 * 1000).toISOString()
      : null;
  }
  if (columns.has("avg_article_yield") && health.articlesSaved !== undefined) {
    row.avg_article_yield = Math.max(0, health.articlesSaved);
  }
  if (columns.has("total_articles_collected") && health.articlesCollected !== undefined) {
    row.total_articles_collected = Math.max(0, health.articlesCollected);
  }
  if (columns.has("total_articles_saved") && health.articlesSaved !== undefined) {
    row.total_articles_saved = Math.max(0, health.articlesSaved);
  }

  if (Object.keys(row).length === 0) return;

  await requestSources(`sources?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
}
