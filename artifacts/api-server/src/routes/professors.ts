import { Router, type IRouter, type Response } from "express";
import {
  CreateProfessorProfileBodySchema,
  ListProfessorProfilesQuerySchema,
  ProfessorLibraryConfigResponseSchema,
  ProfessorProfileDetailResponseSchema,
  ProfessorProfileIdSchema,
  UpdateProfessorProfileBodySchema,
} from "@workspace/api-zod";
import { sendApiError } from "../lib/api-errors";
import {
  createProfessorProfile,
  getProfessorProfile,
  listProfessorProfiles,
  professorLibraryWritesEnabled,
  professorWritesDisabledPayload,
  updateProfessorProfile,
} from "../lib/professor-profiles";

const router: IRouter = Router();

function validationError(error: { issues: Array<{ path: Array<string | number>; message: string }> }) {
  return {
    error: "Invalid professor profile request",
    code: "VALIDATION_FAILED",
    retryable: false,
    userMessage: error.issues[0]?.message ?? "Professor profile request is invalid.",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function writesDisabled(res: Response): void {
  res.status(403).json(professorWritesDisabledPayload());
}

router.get("/professors/config", (_req, res) => {
  res.json(ProfessorLibraryConfigResponseSchema.parse({
    writesEnabled: professorLibraryWritesEnabled(),
  }));
});

router.get("/professors", async (req, res): Promise<void> => {
  const query = ListProfessorProfilesQuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json(validationError(query.error));
    return;
  }

  try {
    const items = await listProfessorProfiles(query.data);
    res.json({
      items,
      total: items.length,
      writesEnabled: professorLibraryWritesEnabled(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to list professor profiles");
    sendApiError(res, error, "Professor profiles failed to load. Retry after the database is available.");
  }
});

router.get("/professors/:id", async (req, res): Promise<void> => {
  const id = ProfessorProfileIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json(validationError(id.error));
    return;
  }

  try {
    const profile = await getProfessorProfile(id.data);
    if (!profile) {
      res.status(404).json({ error: "Professor profile not found", code: "PROFESSOR_PROFILE_NOT_FOUND", retryable: false });
      return;
    }
    res.json(ProfessorProfileDetailResponseSchema.parse({
      profile,
      writesEnabled: professorLibraryWritesEnabled(),
    }));
  } catch (error) {
    req.log.error({ err: error, professorProfileId: id.data }, "Failed to read professor profile");
    sendApiError(res, error, "Professor profile failed to load. Retry after the database is available.");
  }
});

router.post("/professors", async (req, res): Promise<void> => {
  if (!professorLibraryWritesEnabled()) {
    writesDisabled(res);
    return;
  }

  const body = CreateProfessorProfileBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(validationError(body.error));
    return;
  }

  try {
    const profile = await createProfessorProfile(body.data);
    res.status(201).json(ProfessorProfileDetailResponseSchema.parse({
      profile,
      writesEnabled: professorLibraryWritesEnabled(),
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create professor profile");
    sendApiError(res, error, "Professor profile failed to save. Retry after the database is available.");
  }
});

router.patch("/professors/:id", async (req, res): Promise<void> => {
  if (!professorLibraryWritesEnabled()) {
    writesDisabled(res);
    return;
  }

  const id = ProfessorProfileIdSchema.safeParse(req.params.id);
  if (!id.success) {
    res.status(400).json(validationError(id.error));
    return;
  }

  const body = UpdateProfessorProfileBodySchema.safeParse(req.body);
  if (!body.success) {
    res.status(400).json(validationError(body.error));
    return;
  }

  try {
    const profile = await updateProfessorProfile(id.data, body.data);
    if (!profile) {
      res.status(404).json({ error: "Professor profile not found", code: "PROFESSOR_PROFILE_NOT_FOUND", retryable: false });
      return;
    }
    res.json(ProfessorProfileDetailResponseSchema.parse({
      profile,
      writesEnabled: professorLibraryWritesEnabled(),
    }));
  } catch (error) {
    req.log.error({ err: error, professorProfileId: id.data }, "Failed to update professor profile");
    sendApiError(res, error, "Professor profile failed to save. Retry after the database is available.");
  }
});

export default router;
