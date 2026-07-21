import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function equalSecret(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function internalEditorActorId(): string {
  return process.env.STORY_OPPORTUNITIES_ACTOR_ID?.trim() || "admin-api-key";
}

/**
 * Story Opportunity data is internal even on GET routes. Unlike the legacy
 * mutation guard, this guard never opens access merely because NODE_ENV is not
 * production.
 */
export function requireInternalEditor(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    res.status(503).json({
      error: "Internal editor authorization is not configured",
      code: "INTERNAL_EDITOR_AUTH_UNCONFIGURED",
      retryable: false,
    });
    return;
  }
  const authorization = req.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const provided = req.get("x-admin-api-key") ?? bearer ?? "";
  if (!equalSecret(provided, adminKey)) {
    res
      .status(401)
      .json({
        error: "Unauthorized internal editor request",
        code: "UNAUTHORIZED",
        retryable: false,
      });
    return;
  }
  res.locals.internalEditorActorId = internalEditorActorId();
  next();
}
