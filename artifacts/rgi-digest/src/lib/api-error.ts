type ApiErrorPayload = {
  userMessage?: unknown;
  error?: unknown;
  code?: unknown;
};

function apiErrorPayload(error: unknown): ApiErrorPayload | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { data?: unknown }).data;
  if (typeof direct === "object" && direct !== null) {
    return direct as ApiErrorPayload;
  }
  const responseData = (error as { response?: { data?: unknown } }).response
    ?.data;
  return typeof responseData === "object" && responseData !== null
    ? (responseData as ApiErrorPayload)
    : undefined;
}

export function apiErrorCode(error: unknown): string | null {
  const code = apiErrorPayload(error)?.code;
  return typeof code === "string" && code.trim() ? code : null;
}

export function userSafeErrorMessage(error: unknown, fallback: string): string {
  const payload = apiErrorPayload(error);
  const responseMessage = payload?.userMessage ?? payload?.error;
  if (typeof responseMessage === "string" && responseMessage.trim()) return responseMessage;

  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/RESOURCE_EXHAUSTED|quota exceeded|FIRESTORE_QUOTA_EXCEEDED/i.test(message)) {
    return "Database quota exceeded. The app cannot load or save articles right now. Please retry later or increase Firestore quota.";
  }
  if (/DATABASE_UNAVAILABLE|timed out|503/i.test(message)) {
    return "Database access timed out. The app cannot load articles right now. Please retry shortly.";
  }
  return message && message !== "[object Object]" ? message : fallback;
}

export async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.clone().json();
    const message = payload?.userMessage || payload?.error;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // Fall back to status text below.
  }
  return `${fallback} (${response.status})`;
}
