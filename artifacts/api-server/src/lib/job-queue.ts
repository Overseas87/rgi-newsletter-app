import { getFirebaseBundle } from "./firebase";
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

const COLLECTION = "background_jobs";
const jobs = new Map<string, JobRecord>();
const queues: Record<JobType, Array<() => void>> = { scrape: [], generation: [] };
const running: Record<JobType, number> = { scrape: 0, generation: 0 };
const concurrency: Record<JobType, number> = { scrape: 1, generation: 1 };
let durableJobsAvailable: boolean | null = null;

function nextId(type: JobType): string {
  return `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Job failed");
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function docToJob(doc: any): JobRecord {
  const data = doc.data?.() ?? doc;
  return {
    id: String(data.id ?? doc.id),
    type: data.type === "generation" ? "generation" : "scrape",
    label: String(data.label ?? "Background job"),
    handler: typeof data.handler === "string" ? data.handler : null,
    payload: data.payload ?? null,
    status: ["queued", "running", "succeeded", "failed", "cancelled"].includes(String(data.status))
      ? String(data.status) as JobStatus
      : "queued",
    progress: Number(data.progress ?? 0),
    attempts: Number(data.attempts ?? 0),
    maxAttempts: Number(data.maxAttempts ?? 1),
    queuedAt: dateString(data.queuedAt) ?? new Date().toISOString(),
    startedAt: dateString(data.startedAt),
    finishedAt: dateString(data.finishedAt),
    error: typeof data.error === "string" ? data.error : null,
    result: data.result ?? null,
  };
}

function jobDoc(job: JobRecord, dedupeKey?: string): Record<string, unknown> {
  return {
    id: job.id,
    type: job.type,
    label: job.label,
    handler: job.handler ?? null,
    payload: job.payload ?? null,
    status: job.status,
    progress: job.progress,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.result,
    dedupeKey: dedupeKey ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function canUseDurableJobs(): Promise<boolean> {
  if (durableJobsAvailable !== null) return durableJobsAvailable;
  try {
    const { db } = await getFirebaseBundle();
    await db.collection(COLLECTION).limit(1).get();
    durableJobsAvailable = true;
  } catch (error) {
    logger.warn({ err: error }, "Firestore durable job collection unavailable");
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
    const { db } = await getFirebaseBundle();
    await db.collection(COLLECTION).doc(job.id).set(jobDoc(job, dedupeKey), { merge: true });
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, "Failed to persist Firestore background job");
  }
}

async function patchJob(job: JobRecord): Promise<void> {
  if (!(await canUseDurableJobs())) return;
  try {
    const { db } = await getFirebaseBundle();
    await db.collection(COLLECTION).doc(job.id).set(jobDoc(job), { merge: true });
  } catch (error) {
    logger.warn({ err: error, jobId: job.id }, "Failed to update Firestore background job");
  }
}

export async function updateDurableJob(job: JobRecord): Promise<void> {
  jobs.set(job.id, job);
  await patchJob(job);
}

async function findReusableJob(type: JobType, dedupeKey?: string): Promise<JobRecord | null> {
  if (!dedupeKey || !(await canUseDurableJobs())) return null;
  try {
    const { db } = await getFirebaseBundle();
    const snapshot = await db.collection(COLLECTION)
      .where("type", "==", type)
      .where("dedupeKey", "==", dedupeKey)
      .where("status", "in", ["queued", "running"])
      .limit(1)
      .get();
    return snapshot.empty ? null : docToJob(snapshot.docs[0]);
  } catch (error) {
    logger.warn({ err: error, type, dedupeKey }, "Failed to check duplicate Firestore job");
    return null;
  }
}

function trimJobs() {
  const ordered = [...jobs.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  for (const job of ordered.slice(0, Math.max(0, ordered.length - 200))) jobs.delete(job.id);
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
  const options: EnqueueOptions = typeof maxAttemptsOrOptions === "number" ? { maxAttempts: maxAttemptsOrOptions } : maxAttemptsOrOptions;
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
    const { db } = await getFirebaseBundle();
    const snapshot = await db.collection(COLLECTION).doc(id).get();
    return snapshot.exists ? docToJob(snapshot) : null;
  } catch (error) {
    logger.warn({ err: error, id }, "Failed to fetch Firestore background job");
    return null;
  }
}

export async function claimNextDurableJob(workerId: string, types: JobType[] = ["scrape", "generation"]): Promise<JobRecord | null> {
  if (!(await canUseDurableJobs())) return null;
  try {
    const { db } = await getFirebaseBundle();
    const snapshot = await db.collection(COLLECTION).where("status", "==", "queued").limit(25).get();
    const nextDoc = snapshot.docs
      .map((doc: any) => ({ doc, job: docToJob(doc) }))
      .filter(({ job }: { job: JobRecord }) => types.includes(job.type))
      .sort((a: { job: JobRecord }, b: { job: JobRecord }) => a.job.queuedAt.localeCompare(b.job.queuedAt))[0];
    if (!nextDoc) return null;

    const startedAt = new Date().toISOString();
    await nextDoc.doc.ref.set({ status: "running", startedAt, lockedBy: workerId, lockedAt: startedAt, updatedAt: startedAt }, { merge: true });
    const job = docToJob(await nextDoc.doc.ref.get());
    jobs.set(job.id, job);
    return job;
  } catch (error) {
    logger.warn({ err: error, workerId }, "Failed to claim Firestore background job");
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
      if (job.attempts < job.maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1000 * job.attempts));
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
    const { db } = await getFirebaseBundle();
    const snapshot = await db.collection(COLLECTION).limit(100).get();
    const durableJobs = snapshot.docs.map(docToJob).filter((job: JobRecord) => !type || job.type === type);
    const memoryById = new Map(listJobs(type).map((job) => [job.id, job]));
    return durableJobs
      .map((job: JobRecord) => memoryById.get(job.id) ?? job)
      .sort((a: JobRecord, b: JobRecord) => b.queuedAt.localeCompare(a.queuedAt));
  } catch (error) {
    logger.warn({ err: error }, "Failed to list Firestore background jobs");
    return listJobs(type);
  }
}

export function getQueueSummary() {
  const all = listJobs();
  return {
    running,
    queued: { scrape: queues.scrape.length, generation: queues.generation.length },
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
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
  try {
    const { db } = await getFirebaseBundle();
    const snapshot = await db.collection(COLLECTION).where("status", "==", "running").limit(100).get();
    const stale = snapshot.docs
      .map((doc: any) => ({ doc, job: docToJob(doc) }))
      .filter(({ job }: { job: JobRecord }) => Date.parse(job.startedAt ?? job.queuedAt) < cutoff);
    await Promise.all(stale.map(({ doc }: { doc: any }) => doc.ref.set({
      status: "failed",
      error: "Job marked failed during startup recovery because its worker stopped before completion.",
      finishedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { merge: true })));
    if (stale.length) logger.warn({ count: stale.length }, "Recovered stale running jobs");
    return stale.length;
  } catch (error) {
    logger.warn({ err: error }, "Failed to recover stale Firestore jobs");
    return 0;
  }
}
