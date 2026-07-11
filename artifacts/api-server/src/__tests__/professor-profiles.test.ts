import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  CreateProfessorProfileBodySchema,
  ProfessorProfileSchema,
  UpdateProfessorProfileBodySchema,
} from "@workspace/api-zod";
import {
  PROFESSOR_PROFILES_COLLECTION,
  createProfessorProfileInDb,
  getProfessorProfileFromDb,
  listProfessorProfilesFromDb,
  professorLibraryWritesEnabled,
  professorWritesDisabledPayload,
  updateProfessorProfileInDb,
} from "../lib/professor-profiles";
import { writesDisabled } from "../routes/professors";

const now = new Date("2026-07-10T00:00:00.000Z");

function makeDb() {
  const store = new Map<string, Record<string, unknown>>();
  const collection = {
    doc(id?: string) {
      const docId = id ?? "prof_auto_generated_01";
      return {
        id: docId,
        async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
          store.set(docId, options?.merge ? { ...(store.get(docId) ?? {}), ...data } : { ...data });
        },
        async get() {
          const data = store.get(docId);
          return {
            id: docId,
            exists: Boolean(data),
            data: () => data,
          };
        },
      };
    },
    where(field: string, operator: string, value: unknown) {
      assert.equal(field, "status");
      assert.equal(operator, "==");
      return {
        async get() {
          return {
            docs: [...store.entries()]
              .filter(([, data]) => data.status === value)
              .map(([id, data]) => ({ id, data: () => data })),
          };
        },
      };
    },
    async get() {
      return {
        docs: [...store.entries()].map(([id, data]) => ({ id, data: () => data })),
      };
    },
  };
  return {
    collectionName: "",
    store,
    db: {
      collection(name: string) {
        assert.equal(name, PROFESSOR_PROFILES_COLLECTION);
        return collection;
      },
    },
    FieldValue: {
      serverTimestamp: () => now,
    },
  };
}

const validBody = {
  fullName: "  Dr. Example Professor  ",
  academicTitle: " Professor of Strategy ",
  department: " International Business ",
  coursesTaught: [" Global Strategy ", "Global Strategy", "Leadership"],
  expertiseTags: ["Governance", "governance", "AI Policy"],
  researchInterests: ["Boards", "Responsible AI"],
  industries: ["Higher Education"],
  regions: ["North America"],
  professionalBackground: " Works with boards. ",
  approvedBio: " Approved public bio. ",
  publications: ["Journal article"],
  recurringThemes: ["Institutional trust"],
  contactableTopics: ["AI governance"],
  doNotContactTopics: ["Personal matters"],
  participationStatus: "available" as const,
  maxOpenRequests: 2,
  status: "active" as const,
};

test("valid professor profile create body trims strings and deduplicates arrays", () => {
  const parsed = CreateProfessorProfileBodySchema.parse({ ...validBody, coursesTaught: [...validBody.coursesTaught, "  "] });
  assert.equal(parsed.fullName, "Dr. Example Professor");
  assert.equal(parsed.academicTitle, "Professor of Strategy");
  assert.equal(parsed.department, "International Business");
  assert.deepEqual(parsed.coursesTaught, ["Global Strategy", "Leadership"]);
  assert.deepEqual(parsed.expertiseTags, ["governance", "ai policy"]);
});

test("professor profile schema validates status enums and timestamps", () => {
  const parsed = ProfessorProfileSchema.parse({
    ...CreateProfessorProfileBodySchema.parse(validBody),
    id: "prof_auto_generated_01",
    schemaVersion: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  assert.equal(parsed.status, "active");
  assert.throws(() => ProfessorProfileSchema.parse({ ...parsed, status: "archived" }), /Invalid enum value/);
});

test("invalid required fields fail and update allows partial status changes", () => {
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, fullName: " " }), /String must contain/);
  assert.throws(() => UpdateProfessorProfileBodySchema.parse({}), /At least one professor profile field/);
  assert.deepEqual(UpdateProfessorProfileBodySchema.parse({ status: "paused" }), { status: "paused" });
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, id: "prof_forbidden_01" }), /Unrecognized key/);
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, createdAt: now.toISOString() }), /Unrecognized key/);
  assert.throws(() => UpdateProfessorProfileBodySchema.parse({ id: "prof_forbidden_01" }), /Unrecognized key/);
  assert.throws(() => UpdateProfessorProfileBodySchema.parse({ createdAt: now.toISOString() }), /Unrecognized key/);
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, participationStatus: "unknown" }), /Invalid enum value/);
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, maxOpenRequests: -1 }), /greater than or equal to 0/);
  assert.throws(() => CreateProfessorProfileBodySchema.parse({ ...validBody, maxOpenRequests: 21 }), /less than or equal to 20/);
});

test("professor library writes require the exact true flag value", () => {
  const previous = process.env.PROFESSOR_LIBRARY_WRITES_ENABLED;
  delete process.env.PROFESSOR_LIBRARY_WRITES_ENABLED;
  try {
    assert.equal(professorLibraryWritesEnabled(), false);
    for (const value of ["", "false", "TRUE", "1", " true "]) {
      process.env.PROFESSOR_LIBRARY_WRITES_ENABLED = value;
      assert.equal(professorLibraryWritesEnabled(), false, `expected ${JSON.stringify(value)} to remain disabled`);
    }
    process.env.PROFESSOR_LIBRARY_WRITES_ENABLED = "true";
    assert.equal(professorLibraryWritesEnabled(), true);
    assert.deepEqual(professorWritesDisabledPayload(), {
      error: "Professor Library writes are disabled",
      code: "PROFESSOR_LIBRARY_WRITES_DISABLED",
      retryable: false,
      userMessage: "Professor Library editing is disabled in this environment until administrator authentication is implemented.",
    });
  } finally {
    if (previous === undefined) delete process.env.PROFESSOR_LIBRARY_WRITES_ENABLED;
    else process.env.PROFESSOR_LIBRARY_WRITES_ENABLED = previous;
  }
});

test("disabled writes return a typed 403 response", () => {
  let statusCode = 0;
  let payload: unknown;
  const response = {
    status(code: number) { statusCode = code; return this; },
    json(body: unknown) { payload = body; return this; },
  };
  writesDisabled(response as never);
  assert.equal(statusCode, 403);
  assert.deepEqual(payload, professorWritesDisabledPayload());
});

test("professor repository uses mocked Firestore auto ids and status updates", async () => {
  const { db, FieldValue } = makeDb();
  const created = await createProfessorProfileInDb(db, FieldValue, validBody);
  assert.equal(created.id, "prof_auto_generated_01");
  assert.equal(created.fullName, "Dr. Example Professor");

  const updated = await updateProfessorProfileInDb(db, FieldValue, created.id, { status: "inactive" });
  assert.equal(updated?.status, "inactive");

  const inactive = await listProfessorProfilesFromDb(db, { status: "inactive" });
  assert.equal(inactive.length, 1);
  assert.equal(inactive[0].id, created.id);
  assert.equal((await getProfessorProfileFromDb(db, created.id))?.id, created.id);
  assert.equal(await getProfessorProfileFromDb(db, "prof_missing_01"), null);
  assert.equal(await updateProfessorProfileInDb(db, FieldValue, "prof_missing_01", { status: "paused" }), null);
});

test("professor routes do not expose a hard-delete endpoint", () => {
  const routeSource = readFileSync(resolve(process.cwd(), "src/routes/professors.ts"), "utf8");
  assert.equal(routeSource.includes("router.delete"), false);
  assert.equal(routeSource.includes("deleteProfessor"), false);
});
