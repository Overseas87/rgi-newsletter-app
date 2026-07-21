import {
  CreateProfessorProfileBodySchema,
  type CreateProfessorProfileInput,
  ListProfessorProfilesQuerySchema,
  ProfessorProfileSchema,
  type ProfessorProfile,
  type UpdateProfessorProfileInput,
  UpdateProfessorProfileBodySchema,
} from "@workspace/api-zod";
import { getFirebaseBundle, isFirestoreTemporarilyDegraded, withFirestoreRetry, withTimeout } from "./firebase";

export const PROFESSOR_PROFILES_COLLECTION = "professor_profiles";

export function professorLibraryWritesEnabled(): boolean {
  return (
    process.env.PROFESSOR_LIBRARY_WRITES_ENABLED === "true" &&
    process.env.RGI_READ_ONLY_STARTUP !== "true"
  );
}

export function professorWritesDisabledPayload() {
  if (process.env.RGI_READ_ONLY_STARTUP === "true") {
    return {
      error: "Professor Library writes are blocked by read-only startup",
      code: "READ_ONLY_STARTUP",
      retryable: false,
      userMessage: "Professor Library editing is blocked while the application is in read-only mode.",
    };
  }
  return {
    error: "Professor Library writes are disabled",
    code: "PROFESSOR_LIBRARY_WRITES_DISABLED",
    retryable: false,
    userMessage: "Professor Library editing is disabled in this environment.",
  };
}

function isoDate(value: unknown): string {
  let date: Date | undefined;
  if (value instanceof Date) date = value;
  else if (typeof value === "string") date = new Date(value);
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    date = (value as { toDate: () => Date }).toDate();
  }
  if (!date || Number.isNaN(date.getTime())) throw new Error("Professor profile contains an invalid Firestore timestamp");
  return date.toISOString();
}

export function professorProfileFromDoc(doc: any): ProfessorProfile {
  const data = doc.data?.() ?? doc;
  return ProfessorProfileSchema.parse({
    ...data,
    id: String(data.id ?? doc.id),
    createdAt: isoDate(data.createdAt),
    updatedAt: isoDate(data.updatedAt),
  });
}

function createDoc(profile: CreateProfessorProfileInput, id: string, FieldValue: any): Record<string, unknown> {
  const parsed = CreateProfessorProfileBodySchema.parse(profile);
  return {
    ...parsed,
    id,
    schemaVersion: 2,
    profileRevision: 1,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function updateDoc(patch: UpdateProfessorProfileInput, FieldValue: any, profileRevision: number): Record<string, unknown> {
  const parsed = UpdateProfessorProfileBodySchema.parse(patch);
  return {
    ...parsed,
    schemaVersion: 2,
    profileRevision,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export async function listProfessorProfiles(query: unknown = {}): Promise<ProfessorProfile[]> {
  if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
  const { db } = await getFirebaseBundle();
  return listProfessorProfilesFromDb(db, query);
}

export async function listProfessorProfilesFromDb(db: any, query: unknown = {}): Promise<ProfessorProfile[]> {
  const parsed = ListProfessorProfilesQuerySchema.parse(query);
  const snapshot: any = await withFirestoreRetry("List professor profiles", () => {
    let ref: any = db.collection(PROFESSOR_PROFILES_COLLECTION);
    if (parsed.status) ref = ref.where("status", "==", parsed.status);
    return ref.get();
  });
  return snapshot.docs
    .map(professorProfileFromDoc)
    .sort((a: ProfessorProfile, b: ProfessorProfile) => a.fullName.localeCompare(b.fullName));
}

export async function getProfessorProfile(id: string): Promise<ProfessorProfile | null> {
  if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
  const { db } = await getFirebaseBundle();
  return getProfessorProfileFromDb(db, id);
}

export async function getProfessorProfileFromDb(db: any, id: string): Promise<ProfessorProfile | null> {
  const snapshot: any = await withTimeout("Read professor profile", db.collection(PROFESSOR_PROFILES_COLLECTION).doc(id).get());
  return snapshot.exists ? professorProfileFromDoc(snapshot) : null;
}

export async function createProfessorProfile(profile: CreateProfessorProfileInput): Promise<ProfessorProfile> {
  if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
  const { db, FieldValue } = await getFirebaseBundle();
  return createProfessorProfileInDb(db, FieldValue, profile);
}

export async function createProfessorProfileInDb(db: any, FieldValue: any, profile: CreateProfessorProfileInput): Promise<ProfessorProfile> {
  const ref = db.collection(PROFESSOR_PROFILES_COLLECTION).doc();
  await withTimeout("Create professor profile", ref.set(createDoc(profile, ref.id, FieldValue)));
  return professorProfileFromDoc(await withTimeout("Read created professor profile", ref.get()));
}

export async function updateProfessorProfile(id: string, patch: UpdateProfessorProfileInput): Promise<ProfessorProfile | null> {
  if (isFirestoreTemporarilyDegraded()) throw new Error("Firestore is temporarily degraded");
  const { db, FieldValue } = await getFirebaseBundle();
  return updateProfessorProfileInDb(db, FieldValue, id, patch);
}

export async function updateProfessorProfileInDb(db: any, FieldValue: any, id: string, patch: UpdateProfessorProfileInput): Promise<ProfessorProfile | null> {
  const ref = db.collection(PROFESSOR_PROFILES_COLLECTION).doc(id);
  const updated = await withTimeout(
    "Update professor profile",
    db.runTransaction(async (transaction: any) => {
      const snapshot: any = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const current = professorProfileFromDoc(snapshot);
      transaction.set(ref, updateDoc(patch, FieldValue, current.profileRevision + 1), { merge: true });
      return true;
    }),
  );
  if (!updated) return null;
  return professorProfileFromDoc(await withTimeout("Read updated professor profile", ref.get()));
}
