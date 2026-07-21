import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiSpecDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedZod = resolve(apiSpecDir, "..", "api-zod", "src", "generated", "api.ts");

// Orval 8.5.3 inlines referenced response objects for every operation in its
// Zod output. The nested Story Opportunity contract is intentionally rich, so
// TypeScript can otherwise expand the repeated inferred Zod declaration types
// until declaration emission exhausts the filesystem. Runtime validators stay
// complete; only the exported compile-time declaration is widened. Request and
// path schemas remain fully inferred.
const responseSchemas = [
  "ListStoryOpportunityWindowsResponse",
  "GetCurrentStoryOpportunityWindowResponse",
  "CalculateStoryOpportunityWindowResponse",
  "ListStoryOpportunitiesForWindowResponse",
  "GetStoryOpportunityResponse",
  "ListStoryOpportunityProfessorMatchesResponse",
  "SelectStoryOpportunityProfessorResponse",
  "ClearStoryOpportunityProfessorResponse",
  "UpdateStoryOpportunityAngleResponse",
  "CloseStoryOpportunityResponse",
  "ReopenStoryOpportunityResponse",
];

let source = await readFile(generatedZod, "utf8");
for (const schema of responseSchemas) {
  const generated = `export const ${schema} = zod.object(`;
  const compact = `export const ${schema}: zod.ZodTypeAny = zod.object(`;
  const occurrences = source.split(generated).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one generated declaration for ${schema}; found ${occurrences}.`);
  }
  source = source.replace(generated, compact);
}

await writeFile(generatedZod, source);
