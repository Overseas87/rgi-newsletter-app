import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const builtOutput = join(root, "artifacts/rgi-digest/dist/public");
const browserRuntimeInputs = [
  "artifacts/rgi-digest/src",
  "artifacts/rgi-digest/vite.config.ts",
  "artifacts/rgi-digest/dist/public",
].map((value) => join(root, value));
const inputs = [
  "artifacts/rgi-digest/src",
  "artifacts/rgi-digest/e2e",
  "artifacts/rgi-digest/playwright.config.ts",
  "artifacts/rgi-digest/playwright.real-stack.config.ts",
  "artifacts/rgi-digest/vite.config.ts",
  "artifacts/rgi-digest/dist/public",
].map((value) => join(root, value));

const readableExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".ts",
  ".tsx",
]);

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

const files = [...new Set(inputs.flatMap(filesUnder))].filter((file) =>
  readableExtensions.has(extname(file)),
);
const browserRuntimeFiles = new Set(
  browserRuntimeInputs
    .flatMap(filesUnder)
    .filter((file) => readableExtensions.has(extname(file))),
);
const builtFiles = filesUnder(builtOutput).filter((file) =>
  readableExtensions.has(extname(file)),
);
if (builtFiles.length === 0) {
  throw new Error(
    "Frontend secret scan requires a completed production build in artifacts/rgi-digest/dist/public.",
  );
}
const forbiddenMarkers = [
  "ADMIN_API_KEY",
  "VITE_ADMIN_API_KEY",
  "browser-fixture-key",
  "x-admin-api-key",
];
const configuredSecret = process.env.ADMIN_API_KEY?.trim();

for (const file of files) {
  const content = readFileSync(file, "utf8");
  if (browserRuntimeFiles.has(file)) {
    for (const marker of forbiddenMarkers) {
      if (content.includes(marker)) {
        throw new Error(
          `Frontend secret scan failed: forbidden administrative credential marker found in ${file}.`,
        );
      }
    }
  }
  if (configuredSecret && content.includes(configuredSecret)) {
    throw new Error(
      `Frontend secret scan failed: configured administrative credential found in ${file}.`,
    );
  }
}

process.stdout.write(
  `Frontend secret scan passed across ${files.length} source, test, configuration, and built files.\n`,
);
