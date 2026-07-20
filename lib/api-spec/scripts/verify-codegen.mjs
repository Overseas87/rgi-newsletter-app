import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const apiSpecDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(apiSpecDir, "..", "..");
const generatedTargets = [
  resolve(workspaceRoot, "lib/api-client-react/src/generated"),
  resolve(workspaceRoot, "lib/api-zod/src/generated"),
  resolve(workspaceRoot, "lib/api-zod/src/index.ts"),
];

function runCodegen() {
  const result = spawnSync("pnpm", ["run", "codegen"], {
    cwd: apiSpecDir,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function filesUnder(target) {
  const targetStat = await stat(target);
  if (targetStat.isFile()) return [target];

  const entries = await readdir(target, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(target, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return nested.flat();
}

async function snapshot() {
  const files = (await Promise.all(generatedTargets.map(filesUnder)))
    .flat()
    .sort((left, right) => left.localeCompare(right));
  const entries = await Promise.all(files.map(async (file) => ({
    path: relative(workspaceRoot, file),
    sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
  })));
  return JSON.stringify(entries);
}

runCodegen();
const first = await snapshot();
runCodegen();
const second = await snapshot();

if (first !== second) {
  console.error("Generated output changed on the second consecutive code-generation run.");
  process.exit(1);
}

const digest = createHash("sha256").update(second).digest("hex");
console.log(`Code generation is reproducible (${digest}).`);
