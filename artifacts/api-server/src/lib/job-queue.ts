import { logger } from "./logger";

export type JobType = "scrape" | "generation";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobRecord<T = unknown> = {
  id: string;
  type: JobType;
  label: string;
  handler?: string | null;
  payload?: unknown;
  status: JobStatus;
  progress: number;
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: T | null;
};

type JobTask<T> = (job: JobRecord<T>) => Promise<T>;
export type DurableJobHandler = (job: JobRecord) => Promise<unknown>;
type EnqueueOptions = {
  maxAttempts?: number;
  handler?: string;
  payload?: unknown;
  dedupeKey?: string;
};

const jobs = new Map<string, JobRecord>();
const queues: Record<JobType, Array<() => void>> = {
  scrape: [],
  generation: [],
};
const running: Record<JobType, number> = {
  scrape: 0,
  generation: 0,
};
const concurrency: Record<JobType, number> = {
  scrape: 1,
  generation: 1,
};

function nextId(type: JobType): string {
  return `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Job failed");
}

function supabaseEnabled(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function supabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
  return { url, anonKey };
}

function jobHeaders(extra?: Record<string, string>) {
  const { anonKey } = supabaseConfig();
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function rowToJob(row: Record<string, unknown>): JobRecord {
  return {
    id: String(row.id),
    type: row.type === "generation" ? "generation" : "scrape",
    label: String(row.label ?? "Background job"),
    handler: typeof row.handler === "string" ? row.handler : null,
    payload: row.payload ?? null,
    status: ["queued", "running", "succeeded", "failed", "cancelled"].includes(String(row.status))
      ? String(row.status) as JobStatus
      : "queued",
    progress: Number(row.progress ?? 0),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 1),
    queuedAt: String(row.queued_at ?? row.created_at ?? new Date().toISOString()),
    startedAt: typeof row.started_at === "string" ? row.started_at : null,
    finishedAt: typeof row.finished_at === "string" ? row.finished_at : null,
    error: typeof row.error === "string" ? row.error : null,
    result: row.result ?? null,
  };
}

function jobToPublicRecord(job: JobRecord): JobRecord {
  return {
    ...job,
    handler: job.handler ?? null,
    payload: job.payload ?? null,
  };
}

async function jobRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: jobHeaders(init?.headers as Record<string, string> | undefined),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase jobs request failed (${response.status}) ${path}: ${body}`);
  }

  if (response.status === 204) return [] as T;
  return (await response.json()) as T;
}

function isMissingJobsTable(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("PGRST205") || error.message.includes("background_jobs"));
}

let durableJobsAvailable: boolean | null = null;

async function canUseDurableJobs(): Promise<boolean> {
  if (!supabaseEnabled()) return false;
  if (durableJobsAvailable !== null) return durableJobsAvailable;
  try {
    await jobRequest<Record<string, unknown>[]>("background_jobs?select=id&limit=1");
    durableJobsAvailable = true;
  } catch (error) {
    if (!isMissingJobsTable(error)) logger.warn({ err: error }, "Durable job table unavailable");
    durableJobsAvailable = false;
  }
  return durableJobsAvailable;
}

export async function durableJobsReady(): Promise<boolean> {
  return canUseDurableJobs();
}

async function persistJob(job: JobRecord, dedupeKey?: string): Promise<void> {
  if (!(await canUseDurableJobs())) return;
  try {
    await jobRequest<Record<string, unknown>[]>("background_jobs", {
      method: "POST",
      headers: { Prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify({
        id: job.id,
        type: job.type,
        label: job.label,
        handler: job.handler ?? null,
        payload: job.payload ?? null,
        status: job.status,
        progress: job.progress,
        attempts: job.attempts,
        max_attempts: job.maxAttempts,
        queued_at: job.queuedAt,
        started_at: job.startedAt,
        finished_at: job.finishedAt,
        error: job.error,
        result: job.result,
        dedupe_key: dedupeKey ?? null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, "Failed to persist background job");
  }
}

async function patchJob(job: JobRecord): Promise<void> {
  if (!(await canUseDurableJobs())) return;
  try {
    await jobRequest<Record<string, unknown>[]>(`background_jobs?id=eq.${encodeURIComponent(job.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: job.status,
        progress: job.progress,
        attempts: job.attempts,
        started_at: job.startedAt,
        finished_at: job.finishedAt,
        error: job.error,
        result: job.result,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, "Failed to update durable background job");
  }
}

export async function updateDurableJob(job: JobRecord): Promise<void> {
  jobs.set(job.id, job);
  await patchJob(job);
}

async function findReusableJob(type: JobType, dedupeKey?: string): Promise<JobRecord | null> {
  if (!dedupeKey || !(await canUseDurableJobs())) return null;
  try {
    const rows = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?select=*&type=eq.${type}&dedupe_key=eq.${encodeURIComponent(dedupeKey)}&status=in.(queued,running)&order=queued_at.desc&limit=1`
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  } catch (error) {
    logger.warn({ err: error, type, dedupeKey }, "Failed to check duplicate durable job");
    return null;
  }
}

function trimJobs() {
  const ordered = [...jobs.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  for (const job of ordered.slice(0, Math.max(0, ordered.length - 200))) {
    jobs.delete(job.id);
  }
}

function drain(type: JobType) {
  while (running[type] < concurrency[type] && queues[type].length > 0) {
    const run = queues[type].shift();
    if (run) run();
  }
}

export function enqueueJob<T>(
  type: JobType,
  label: string,
  task: JobTask<T>,
  maxAttemptsOrOptions: number | EnqueueOptions = 2
): JobRecord<T> {
  const options: EnqueueOptions = typeof maxAttemptsOrOptions === "number"
    ? { maxAttempts: maxAttemptsOrOptions }
    : maxAttemptsOrOptions;

  const job: JobRecord<T> = {
    id: nextId(type),
    type,
    label,
    handler: options.handler ?? null,
    payload: options.payload ?? null,
    status: "queued",
    progress: 0,
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 2,
    queuedAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
  };

  jobs.set(job.id, job);
  trimJobs();
  void persistJob(job, options.dedupeKey);

  if (process.env.RGI_INLINE_JOBS === "false") {
    logger.info({ jobId: job.id, type, handler: job.handler }, "Background job persisted for external worker");
    return job;
  }

  const run = async () => {
    running[type] += 1;
    job.status = "running";
    job.startedAt = job.startedAt ?? new Date().toISOString();
    job.error = null;
    await patchJob(job);

    while (job.attempts < job.maxAttempts) {
      job.attempts += 1;
      try {
        job.progress = Math.max(job.progress, 10);
        await patchJob(job);
        const result = await task(job);
        job.result = result;
        job.progress = 100;
        job.status = "succeeded";
        job.finishedAt = new Date().toISOString();
        await patchJob(job);
        logger.info({ jobId: job.id, type: job.type, attempts: job.attempts }, "Background job succeeded");
        break;
      } catch (error) {
        job.error = sanitizeError(error);
        await patchJob(job);
        logger.warn({ jobId: job.id, type: job.type, attempt: job.attempts, error: job.error }, "Background job attempt failed");
        if (job.attempts < job.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * job.attempts));
        } else {
          job.status = "failed";
          job.finishedAt = new Date().toISOString();
          await patchJob(job);
        }
      }
    }

    running[type] -= 1;
    drain(type);
  };

  queues[type].push(run);
  drain(type);
  return job;
}

export async function enqueueUniqueJob<T>(
  type: JobType,
  label: string,
  dedupeKey: string,
  task: JobTask<T>,
  options: Omit<EnqueueOptions, "dedupeKey"> = {}
): Promise<JobRecord<T>> {
  const existingMemoryJob = [...jobs.values()].find(
    (job) => job.type === type &&
      (job.status === "queued" || job.status === "running") &&
      job.handler === options.handler &&
      JSON.stringify(job.payload ?? null) === JSON.stringify(options.payload ?? null)
  );
  if (existingMemoryJob) return existingMemoryJob as JobRecord<T>;

  const existingDurableJob = await findReusableJob(type, dedupeKey);
  if (existingDurableJob) {
    jobs.set(existingDurableJob.id, existingDurableJob);
    return existingDurableJob as JobRecord<T>;
  }

  return enqueueJob(type, label, task, { ...options, dedupeKey });
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

export async function getJobAsync(id: string): Promise<JobRecord | null> {
  const memoryJob = getJob(id);
  if (memoryJob) return memoryJob;
  if (!(await canUseDurableJobs())) return null;
  try {
    const rows = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    );
    return rows[0] ? jobToPublicRecord(rowToJob(rows[0])) : null;
  } catch (error) {
    logger.warn({ err: error, id }, "Failed to fetch durable background job");
    return null;
  }
}

export async function claimNextDurableJob(workerId: string, types: JobType[] = ["scrape", "generation"]): Promise<JobRecord | null> {
  if (!(await canUseDurableJobs())) return null;
  const typeFilter = `type=in.(${types.join(",")})`;
  try {
    const rows = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?select=*&status=eq.queued&${typeFilter}&order=queued_at.asc&limit=1`
    );
    const next = rows[0] ? rowToJob(rows[0]) : null;
    if (!next) return null;

    const startedAt = new Date().toISOString();
    const claimed = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?id=eq.${encodeURIComponent(next.id)}&status=eq.queued`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "running",
          started_at: next.startedAt ?? startedAt,
          locked_by: workerId,
          locked_at: startedAt,
          updated_at: startedAt,
        }),
      }
    );

    if (!claimed[0]) return null;
    const job = rowToJob(claimed[0]);
    jobs.set(job.id, job);
    return job;
  } catch (error) {
    logger.warn({ err: error, workerId }, "Failed to claim durable background job");
    return null;
  }
}

export async function runDurableJob(job: JobRecord, handler: DurableJobHandler): Promise<void> {
  job.status = "running";
  job.progress = Math.max(job.progress, 10);
  job.error = null;
  jobs.set(job.id, job);
  await patchJob(job);

  while (job.attempts < job.maxAttempts) {
    job.attempts += 1;
    try {
      const result = await handler(job);
      job.result = result;
      job.progress = 100;
      job.status = "succeeded";
      job.finishedAt = new Date().toISOString();
      await patchJob(job);
      logger.info({ jobId: job.id, type: job.type, handler: job.handler, attempts: job.attempts }, "Durable worker job succeeded");
      return;
    } catch (error) {
      job.error = sanitizeError(error);
      await patchJob(job);
      logger.warn({ jobId: job.id, attempt: job.attempts, error: job.error }, "Durable worker job attempt failed");
      if (job.attempts < job.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * job.attempts));
      }
    }
  }

  job.status = "failed";
  job.finishedAt = new Date().toISOString();
  await patchJob(job);
}

export function listJobs(type?: JobType): JobRecord[] {
  return [...jobs.values()]
    .filter((job) => !type || job.type === type)
    .sort((a, b) => b.queuedAt.localeCompare(a.queuedAt));
}

export async function listJobsAsync(type?: JobType): Promise<JobRecord[]> {
  if (!(await canUseDurableJobs())) return listJobs(type);
  try {
    const filter = type ? `&type=eq.${type}` : "";
    const rows = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?select=*&order=queued_at.desc&limit=100${filter}`
    );
    const durableJobs = rows.map(rowToJob);
    const memoryById = new Map(listJobs(type).map((job) => [job.id, job]));
    return durableJobs.map((job) => memoryById.get(job.id) ?? job);
  } catch (error) {
    logger.warn({ err: error }, "Failed to list durable background jobs");
    return listJobs(type);
  }
}

export function getQueueSummary() {
  const all = listJobs();
  return {
    running,
    queued: {
      scrape: queues.scrape.length,
      generation: queues.generation.length,
    },
    recent: all.slice(0, 20).map((job) => ({
      id: job.id,
      type: job.type,
      label: job.label,
      status: job.status,
      progress: job.progress,
      attempts: job.attempts,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    })),
    totals: {
      queued: all.filter((job) => job.status === "queued").length,
      running: all.filter((job) => job.status === "running").length,
      succeeded: all.filter((job) => job.status === "succeeded").length,
      failed: all.filter((job) => job.status === "failed").length,
    },
  };
}

export async function getQueueSummaryAsync() {
  const all = await listJobsAsync();
  return {
    ...getQueueSummary(),
    recent: all.slice(0, 20).map((job) => ({
      id: job.id,
      type: job.type,
      label: job.label,
      status: job.status,
      progress: job.progress,
      attempts: job.attempts,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
    })),
    totals: {
      queued: all.filter((job) => job.status === "queued").length,
      running: all.filter((job) => job.status === "running").length,
      succeeded: all.filter((job) => job.status === "succeeded").length,
      failed: all.filter((job) => job.status === "failed").length,
    },
    durable: durableJobsAvailable === true,
  };
}

export async function markStaleRunningJobsFailed(maxAgeMinutes = 60): Promise<number> {
  if (!(await canUseDurableJobs())) return 0;
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();
  try {
    const rows = await jobRequest<Record<string, unknown>[]>(
      `background_jobs?status=eq.running&updated_at=lt.${encodeURIComponent(cutoff)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "failed",
          error: "Job marked failed during startup recovery because its worker stopped before completion.",
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      }
    );
    if (rows.length) logger.warn({ count: rows.length }, "Recovered stale running jobs");
    return rows.length;
  } catch (error) {
    logger.warn({ err: error }, "Failed to recover stale durable jobs");
    return 0;
  }
}
