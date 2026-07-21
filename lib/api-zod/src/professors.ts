import { z } from "zod";

export const ProfessorProfileStatusSchema = z.enum(["active", "inactive"]);

const SCHEMA_VERSION = 2;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeTag(value: string): string {
  return normalizeText(value).toLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const requiredText = (max: number) =>
  z.string()
    .transform(normalizeText)
    .pipe(z.string().min(1).max(max));

const optionalText = (max: number) =>
  z.string()
    .transform((value) => value.trim())
    .pipe(z.string().max(max))
    .default("");

const textList = (maxItems: number, maxLength: number, normalizer: (value: string) => string = normalizeText) =>
  z.preprocess(
    (value) => Array.isArray(value) ? value.filter((item) => typeof item !== "string" || normalizeText(item).length > 0) : value,
    z.array(
      z.string()
        .transform(normalizer)
        .pipe(z.string().min(1).max(maxLength)),
    ),
  )
    .default([])
    .transform(unique)
    .pipe(z.array(z.string()).max(maxItems));

export const ProfessorProfileIdSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "Invalid professor profile id");

export const ProfessorProfileSchema = z.object({
  id: ProfessorProfileIdSchema,
  fullName: requiredText(160),
  academicTitle: requiredText(160),
  department: requiredText(160),
  coursesTaught: textList(40, 120),
  expertiseTags: textList(40, 80, normalizeTag),
  researchInterests: textList(40, 160),
  professionalExperienceTags: textList(40, 120),
  academicExperienceTags: textList(40, 120),
  industries: textList(30, 80),
  topicInterests: textList(40, 120),
  regions: textList(30, 80),
  affiliations: textList(40, 160),
  professionalBackground: optionalText(2000),
  approvedBio: optionalText(2000),
  publications: textList(40, 240),
  publicationTopicTags: textList(40, 120),
  recurringThemes: textList(40, 120),
  contactableTopics: textList(40, 120),
  restrictedTopics: textList(40, 120),
  doNotContactTopics: textList(40, 120),
  institutionalConflicts: textList(40, 160),
  affiliationConcerns: textList(40, 160),
  status: ProfessorProfileStatusSchema.default("active"),
  schemaVersion: z.number().int().min(1).default(SCHEMA_VERSION),
  profileRevision: z.number().int().min(1).default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const professorProfileWritableFields = {
  fullName: requiredText(160),
  academicTitle: requiredText(160),
  department: requiredText(160),
  coursesTaught: textList(40, 120),
  expertiseTags: textList(40, 80, normalizeTag),
  researchInterests: textList(40, 160),
  professionalExperienceTags: textList(40, 120),
  academicExperienceTags: textList(40, 120),
  industries: textList(30, 80),
  topicInterests: textList(40, 120),
  regions: textList(30, 80),
  affiliations: textList(40, 160),
  professionalBackground: optionalText(2000),
  approvedBio: optionalText(2000),
  publications: textList(40, 240),
  publicationTopicTags: textList(40, 120),
  recurringThemes: textList(40, 120),
  contactableTopics: textList(40, 120),
  restrictedTopics: textList(40, 120),
  doNotContactTopics: textList(40, 120),
  institutionalConflicts: textList(40, 160),
  affiliationConcerns: textList(40, 160),
  status: ProfessorProfileStatusSchema.default("active"),
} satisfies z.ZodRawShape;

export const CreateProfessorProfileBodySchema = z.object(professorProfileWritableFields).strict();

const optionalWritableFields = Object.fromEntries(
  Object.entries(professorProfileWritableFields).map(([key, schema]) => [key, schema.optional()]),
) as { [K in keyof typeof professorProfileWritableFields]: z.ZodOptional<(typeof professorProfileWritableFields)[K]> };

export const UpdateProfessorProfileBodySchema = z.object(optionalWritableFields).strict()
  .refine((value) => Object.keys(value).length > 0, "At least one professor profile field is required");

export const ListProfessorProfilesQuerySchema = z.object({
  status: ProfessorProfileStatusSchema.optional(),
});

export const ProfessorProfileDetailResponseSchema = z.object({
  profile: ProfessorProfileSchema,
  writesEnabled: z.boolean(),
});

export const ListProfessorProfilesResponseSchema = z.object({
  items: z.array(ProfessorProfileSchema),
  total: z.number().int().min(0),
  writesEnabled: z.boolean(),
});

export const ProfessorLibraryConfigResponseSchema = z.object({
  writesEnabled: z.boolean(),
});

export type ProfessorProfile = z.infer<typeof ProfessorProfileSchema>;
export type CreateProfessorProfileInput = z.infer<typeof CreateProfessorProfileBodySchema>;
export type UpdateProfessorProfileInput = z.infer<typeof UpdateProfessorProfileBodySchema>;
