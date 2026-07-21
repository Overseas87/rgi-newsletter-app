import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { getFirebaseBundle } from "./firebase";

export type VerifiedEditorToken = {
  uid: string;
};

export type VerifyEditorToken = (token: string) => Promise<VerifiedEditorToken>;

type FirebaseIdTokenVerifier = {
  verifyIdToken: (
    token: string,
    checkRevoked?: boolean,
  ) => Promise<{ uid: string }>;
};

type InternalEditorAuthOptions = {
  verifyEditorToken?: VerifyEditorToken;
  approvedEditorUids?: () => ReadonlySet<string>;
};

class InternalEditorAuthUnavailableError extends Error {
  readonly name = "InternalEditorAuthUnavailableError";
}

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function configuredEditorUids(): ReadonlySet<string> {
  return new Set(
    (process.env.RGI_EDITOR_UIDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export async function verifyFirebaseEditorTokenWithAuth(
  auth: FirebaseIdTokenVerifier,
  token: string,
): Promise<VerifiedEditorToken> {
  const decoded = await auth.verifyIdToken(token, true);
  return { uid: decoded.uid };
}

async function verifyFirebaseEditorToken(
  token: string,
): Promise<VerifiedEditorToken> {
  let app: unknown;
  try {
    app = (await getFirebaseBundle()).app;
  } catch (cause) {
    throw new InternalEditorAuthUnavailableError(
      "Firebase editor authentication is unavailable",
      { cause },
    );
  }

  try {
    const { getAuth } = await import("firebase-admin/auth");
    return await verifyFirebaseEditorTokenWithAuth(
      getAuth(app as Parameters<typeof getAuth>[0]),
      token,
    );
  } catch {
    throw new Error("Invalid Firebase ID token");
  }
}

function errorResponse(
  res: Response,
  status: 401 | 403 | 503,
  code: string,
  error: string,
): void {
  res.status(status).json({ error, code, retryable: false });
}

export function internalEditorActorId(): string {
  return process.env.STORY_OPPORTUNITIES_ACTOR_ID?.trim() || "admin-api-key";
}

/**
 * Protect internal editorial data in every environment. Browser requests use a
 * Firebase ID token and a server-only UID allowlist. Trusted operational tools
 * may use ADMIN_API_KEY only through x-admin-api-key; it is never a browser
 * bearer credential.
 */
export function createRequireInternalEditor(
  options: InternalEditorAuthOptions = {},
): RequestHandler {
  const verifyEditorToken =
    options.verifyEditorToken ?? verifyFirebaseEditorToken;
  const approvedEditorUids = options.approvedEditorUids ?? configuredEditorUids;

  return (req: Request, res: Response, next: NextFunction): void => {
    void (async () => {
      const serviceKey = req.get("x-admin-api-key")?.trim();
      if (serviceKey) {
        const configuredKey = process.env.ADMIN_API_KEY;
        if (!configuredKey) {
          errorResponse(
            res,
            503,
            "INTERNAL_EDITOR_AUTH_UNCONFIGURED",
            "Internal editor authorization is not configured",
          );
          return;
        }
        if (!equalSecret(serviceKey, configuredKey)) {
          errorResponse(
            res,
            401,
            "UNAUTHORIZED",
            "Unauthorized internal editor request",
          );
          return;
        }
        res.locals.internalEditorActorId = internalEditorActorId();
        res.locals.internalEditorAuthMethod = "admin-api-key";
        next();
        return;
      }

      const authorization = req.get("authorization") ?? "";
      const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
      if (!match) {
        errorResponse(
          res,
          401,
          authorization ? "INVALID_ID_TOKEN" : "AUTHORIZATION_REQUIRED",
          authorization
            ? "The Firebase ID token is malformed or invalid"
            : "Internal editor authorization is required",
        );
        return;
      }

      const allowedUids = approvedEditorUids();
      if (allowedUids.size === 0) {
        errorResponse(
          res,
          503,
          "INTERNAL_EDITOR_AUTH_UNCONFIGURED",
          "Internal editor authorization is not configured",
        );
        return;
      }

      let decoded: VerifiedEditorToken;
      try {
        decoded = await verifyEditorToken(match[1]);
      } catch (error) {
        if (error instanceof InternalEditorAuthUnavailableError) {
          errorResponse(
            res,
            503,
            "INTERNAL_EDITOR_AUTH_UNCONFIGURED",
            "Internal editor authorization is not configured",
          );
          return;
        }
        errorResponse(
          res,
          401,
          "INVALID_ID_TOKEN",
          "The Firebase ID token is expired, revoked, malformed, or invalid",
        );
        return;
      }

      if (!decoded.uid || !allowedUids.has(decoded.uid)) {
        errorResponse(
          res,
          403,
          "INTERNAL_EDITOR_ACCESS_DENIED",
          "Authenticated user is not an approved RGI editor",
        );
        return;
      }

      res.locals.internalEditorActorId = `firebase:${decoded.uid}`;
      res.locals.internalEditorAuthMethod = "firebase-id-token";
      res.locals.internalEditorUid = decoded.uid;
      next();
    })().catch(next);
  };
}

export const requireInternalEditor = createRequireInternalEditor();

function hasStrictInternalEditorGuard(pathname: string): boolean {
  return [
    "/api/professors",
    "/api/opportunity-windows",
    "/api/story-opportunities",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isLegacyMutation(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  // These namespaces authenticate in their own fail-closed router middleware.
  if (hasStrictInternalEditorGuard(req.path)) return false;
  return req.path.startsWith("/api/") || req.path.startsWith("/sources");
}

export function createAdminMutationGuard(
  editorGuard: RequestHandler = requireInternalEditor,
): RequestHandler {
  return (req, res, next): void => {
    if (!isLegacyMutation(req)) {
      next();
      return;
    }
    editorGuard(req, res, next);
  };
}
