import type { Response } from "express";

export type ApiErrorPayload = {
  error: string;
  code: string;
  retryable: boolean;
  userMessage: string;
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function isFirestoreQuotaError(error: unknown): boolean {
  const message = getErrorMessage(error);
  const code = typeof error === "object" && error !== null
    ? String((error as Record<string, unknown>).code ?? "")
    : "";
  return code === "8" || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message);
}

export function isDatabaseAccessError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return isFirestoreQuotaError(error) || /List Firestore|Firestore .*timed out|timed out after/i.test(message);
}

export function apiErrorPayload(error: unknown, fallback: string): ApiErrorPayload {
  if (isFirestoreQuotaError(error)) {
    return {
      error: "Firestore quota exceeded",
      code: "FIRESTORE_QUOTA_EXCEEDED",
      retryable: true,
      userMessage: "Database quota exceeded. The app cannot load or save articles right now. Please retry later or increase Firestore quota.",
    };
  }

  if (isDatabaseAccessError(error)) {
    return {
      error: "Database temporarily unavailable",
      code: "DATABASE_UNAVAILABLE",
      retryable: true,
      userMessage: "Database access timed out. The app cannot load articles right now. Please retry shortly.",
    };
  }

  return {
    error: fallback,
    code: "BACKEND_REQUEST_FAILED",
    retryable: true,
    userMessage: fallback,
  };
}

export function sendApiError(res: Response, error: unknown, fallback: string): void {
  const payload = apiErrorPayload(error, fallback);
  res.status(isDatabaseAccessError(error) ? 503 : 500).json(payload);
}

export async function withApiTimeout<T>(
  label: string,
  promise: Promise<T>,
  timeoutMs = Number(process.env.API_ROUTE_TIMEOUT_MS ?? 9000),
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
