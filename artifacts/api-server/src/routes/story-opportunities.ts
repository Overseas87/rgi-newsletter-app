import { Router, type IRouter, type Request, type Response } from "express";
import { requireInternalEditor } from "../lib/internal-editor-auth";
import { sendApiError } from "../lib/api-errors";
import { OpportunityCommandError } from "../lib/story-opportunities";
import {
  defaultStoryOpportunityService,
  type StoryOpportunityService,
} from "../lib/story-opportunity-service";

const ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;

export function storyOpportunityReadsEnabled(): boolean {
  return process.env.STORY_OPPORTUNITIES_READS_ENABLED === "true";
}

export function storyOpportunityWritesEnabled(): boolean {
  return (
    process.env.STORY_OPPORTUNITIES_WRITES_ENABLED === "true" &&
    process.env.RGI_READ_ONLY_STARTUP !== "true"
  );
}

function disabledPayload(kind: "reads" | "writes") {
  const readOnly =
    kind === "writes" && process.env.RGI_READ_ONLY_STARTUP === "true";
  return {
    error: readOnly
      ? "Story Opportunity writes are blocked by read-only startup"
      : `Story Opportunity ${kind} are disabled`,
    code: readOnly
      ? "READ_ONLY_STARTUP"
      : `STORY_OPPORTUNITIES_${kind.toUpperCase()}_DISABLED`,
    retryable: false,
  };
}

function requireReads(_req: Request, res: Response, next: () => void): void {
  if (!storyOpportunityReadsEnabled()) {
    res.status(403).json(disabledPayload("reads"));
    return;
  }
  next();
}

function requireWrites(_req: Request, res: Response, next: () => void): void {
  if (!storyOpportunityWritesEnabled()) {
    res.status(403).json(disabledPayload("writes"));
    return;
  }
  next();
}

function actorId(res: Response): string {
  return String(res.locals.internalEditorActorId || "admin-api-key");
}

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function hasOnlyBodyKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).every((key) =>
      keys.includes(key),
    )
  );
}

function expectedRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : null;
}

function optionalReason(value: unknown): {
  valid: boolean;
  value: string | null;
} {
  if (value === undefined) return { valid: true, value: null };
  if (typeof value !== "string" || value.length > 1000)
    return { valid: false, value: null };
  return { valid: true, value };
}

function requestError(res: Response, message: string): void {
  res
    .status(400)
    .json({
      error: "Invalid Story Opportunity request",
      code: "VALIDATION_FAILED",
      retryable: false,
      userMessage: message,
    });
}

function handleError(
  req: Request,
  res: Response,
  error: unknown,
  message: string,
): void {
  if (error instanceof OpportunityCommandError) {
    res
      .status(error.status)
      .json({
        error: error.message,
        code: error.code,
        retryable: false,
        userMessage: error.message,
      });
    return;
  }
  req.log.error({ err: error }, message);
  sendApiError(
    res,
    error,
    "Story Opportunity data failed to load. Retry after the database is available.",
  );
}

export function createStoryOpportunitiesRouter(
  service: StoryOpportunityService = defaultStoryOpportunityService,
): IRouter {
  const router: IRouter = Router();
  router.use(requireInternalEditor);

  router.get("/opportunity-windows/config", (_req, res) => {
    res.json({
      readsEnabled: storyOpportunityReadsEnabled(),
      writesEnabled: storyOpportunityWritesEnabled(),
    });
  });

  router.get("/opportunity-windows", requireReads, async (req, res) => {
    try {
      const items = await service.listWindows();
      res.json({
        items,
        total: items.length,
        readsEnabled: true,
        writesEnabled: storyOpportunityWritesEnabled(),
      });
    } catch (error) {
      handleError(req, res, error, "Failed to list Story Opportunity windows");
    }
  });

  router.get("/opportunity-windows/current", requireReads, async (req, res) => {
    try {
      const result = await service.getCurrentWindow();
      res.json({
        window: result.window,
        items: result.opportunities,
        total: result.opportunities.length,
        readsEnabled: true,
        writesEnabled: storyOpportunityWritesEnabled(),
      });
    } catch (error) {
      handleError(
        req,
        res,
        error,
        "Failed to read current Story Opportunity window",
      );
    }
  });

  router.post(
    "/opportunity-windows/calculate",
    requireWrites,
    async (req, res) => {
      const asOf =
        typeof req.body?.asOf === "string" ? new Date(req.body.asOf) : null;
      const snapshotRevision =
        req.body?.snapshotRevision === undefined
          ? 1
          : expectedRevision(req.body.snapshotRevision);
      if (
        !hasOnlyBodyKeys(req.body, ["asOf", "snapshotRevision"]) ||
        !asOf ||
        !Number.isFinite(asOf.getTime()) ||
        snapshotRevision === null
      ) {
        requestError(
          res,
          "asOf must be an ISO date-time and snapshotRevision, when provided, must be a positive integer.",
        );
        return;
      }
      try {
        const result = await service.calculateWindow(asOf, snapshotRevision);
        res
          .status(result.created ? 201 : 200)
          .json({
            ...result,
            readsEnabled: storyOpportunityReadsEnabled(),
            writesEnabled: true,
          });
      } catch (error) {
        handleError(
          req,
          res,
          error,
          "Failed to calculate Story Opportunity window",
        );
      }
    },
  );

  router.get(
    "/opportunity-windows/:windowId/opportunities",
    requireReads,
    async (req, res) => {
      if (!validId(req.params.windowId)) {
        requestError(res, "windowId is invalid.");
        return;
      }
      try {
        const result = await service.getWindowWithOpportunities(
          req.params.windowId,
        );
        if (!result.window) {
          res
            .status(404)
            .json({
              error: "Story Opportunity window not found",
              code: "OPPORTUNITY_WINDOW_NOT_FOUND",
              retryable: false,
            });
          return;
        }
        res.json({
          window: result.window,
          items: result.opportunities,
          total: result.opportunities.length,
          readsEnabled: true,
          writesEnabled: storyOpportunityWritesEnabled(),
        });
      } catch (error) {
        handleError(req, res, error, "Failed to list Story Opportunities");
      }
    },
  );

  router.get("/story-opportunities/:id", requireReads, async (req, res) => {
    if (!validId(req.params.id)) {
      requestError(res, "opportunity id is invalid.");
      return;
    }
    try {
      const opportunity = await service.getOpportunity(req.params.id);
      if (!opportunity) {
        res
          .status(404)
          .json({
            error: "Story Opportunity not found",
            code: "STORY_OPPORTUNITY_NOT_FOUND",
            retryable: false,
          });
        return;
      }
      res.json({
        opportunity,
        readsEnabled: true,
        writesEnabled: storyOpportunityWritesEnabled(),
      });
    } catch (error) {
      handleError(req, res, error, "Failed to read Story Opportunity");
    }
  });

  router.get(
    "/story-opportunities/:id/matches",
    requireReads,
    async (req, res) => {
      if (!validId(req.params.id)) {
        requestError(res, "opportunity id is invalid.");
        return;
      }
      try {
        const opportunity = await service.getOpportunity(req.params.id);
        if (!opportunity) {
          res
            .status(404)
            .json({
              error: "Story Opportunity not found",
              code: "STORY_OPPORTUNITY_NOT_FOUND",
              retryable: false,
            });
          return;
        }
        res.json({
          items: opportunity.professorMatches,
          total: opportunity.professorMatches.length,
        });
      } catch (error) {
        handleError(req, res, error, "Failed to read Professor Matches");
      }
    },
  );

  router.post(
    "/story-opportunities/:id/select-professor",
    requireWrites,
    async (req, res) => {
      const revision = expectedRevision(req.body?.expectedRevision);
      const reason = optionalReason(req.body?.reason);
      if (
        !hasOnlyBodyKeys(req.body, [
          "professorId",
          "reason",
          "expectedRevision",
        ]) ||
        !validId(req.params.id) ||
        !validId(req.body?.professorId) ||
        revision === null ||
        !reason.valid
      ) {
        requestError(
          res,
          "opportunity id, professorId, a positive integer expectedRevision, and an optional reason of at most 1000 characters are required.",
        );
        return;
      }
      try {
        const opportunity = await service.selectProfessor({
          id: req.params.id,
          professorId: req.body.professorId,
          reason: reason.value,
          expectedRevision: revision,
          actorId: actorId(res),
        });
        if (!opportunity) {
          res
            .status(404)
            .json({
              error: "Story Opportunity not found",
              code: "STORY_OPPORTUNITY_NOT_FOUND",
              retryable: false,
            });
          return;
        }
        res.json({
          opportunity,
          readsEnabled: storyOpportunityReadsEnabled(),
          writesEnabled: true,
        });
      } catch (error) {
        handleError(req, res, error, "Failed to select professor");
      }
    },
  );

  router.post(
    "/story-opportunities/:id/clear-professor",
    requireWrites,
    async (req, res) => {
      const revision = expectedRevision(req.body?.expectedRevision);
      const reason = optionalReason(req.body?.reason);
      if (
        !hasOnlyBodyKeys(req.body, ["expectedRevision", "reason"]) ||
        !validId(req.params.id) ||
        revision === null ||
        !reason.valid
      ) {
        requestError(
          res,
          "opportunity id, a positive integer expectedRevision, and an optional reason of at most 1000 characters are required.",
        );
        return;
      }
      try {
        const opportunity = await service.clearProfessor({
          id: req.params.id,
          reason: reason.value,
          expectedRevision: revision,
          actorId: actorId(res),
        });
        if (!opportunity) {
          res
            .status(404)
            .json({
              error: "Story Opportunity not found",
              code: "STORY_OPPORTUNITY_NOT_FOUND",
              retryable: false,
            });
          return;
        }
        res.json({
          opportunity,
          readsEnabled: storyOpportunityReadsEnabled(),
          writesEnabled: true,
        });
      } catch (error) {
        handleError(req, res, error, "Failed to clear professor selection");
      }
    },
  );

  router.post(
    "/story-opportunities/:id/update-angle",
    requireWrites,
    async (req, res) => {
      const revision = expectedRevision(req.body?.expectedRevision);
      if (
        !hasOnlyBodyKeys(req.body, ["expectedRevision", "angle"]) ||
        !validId(req.params.id) ||
        revision === null ||
        typeof req.body?.angle !== "string"
      ) {
        requestError(
          res,
          "angle and a positive expectedRevision are required.",
        );
        return;
      }
      try {
        const opportunity = await service.updateAngle({
          id: req.params.id,
          angle: req.body.angle,
          expectedRevision: revision,
        });
        if (!opportunity) {
          res
            .status(404)
            .json({
              error: "Story Opportunity not found",
              code: "STORY_OPPORTUNITY_NOT_FOUND",
              retryable: false,
            });
          return;
        }
        res.json({
          opportunity,
          readsEnabled: storyOpportunityReadsEnabled(),
          writesEnabled: true,
        });
      } catch (error) {
        handleError(
          req,
          res,
          error,
          "Failed to update Story Opportunity angle",
        );
      }
    },
  );

  for (const action of ["close", "reopen"] as const) {
    router.post(
      `/story-opportunities/:id/${action}`,
      requireWrites,
      async (req, res) => {
        const revision = expectedRevision(req.body?.expectedRevision);
        if (
          !hasOnlyBodyKeys(req.body, ["expectedRevision"]) ||
          !validId(req.params.id) ||
          revision === null
        ) {
          requestError(
            res,
            "opportunity id and a positive expectedRevision are required.",
          );
          return;
        }
        try {
          const opportunity = await service[action]({
            id: req.params.id,
            expectedRevision: revision,
          });
          if (!opportunity) {
            res
              .status(404)
              .json({
                error: "Story Opportunity not found",
                code: "STORY_OPPORTUNITY_NOT_FOUND",
                retryable: false,
              });
            return;
          }
          res.json({
            opportunity,
            readsEnabled: storyOpportunityReadsEnabled(),
            writesEnabled: true,
          });
        } catch (error) {
          handleError(req, res, error, `Failed to ${action} Story Opportunity`);
        }
      },
    );
  }

  return router;
}

export default createStoryOpportunitiesRouter();
