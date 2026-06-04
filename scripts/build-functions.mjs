import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outdir = path.join(root, "functions", "lib");
const apiRequire = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { build } = apiRequire("esbuild");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: [path.join(root, "artifacts/api-server/src/function.ts")],
  outdir,
  entryNames: "index",
  platform: "node",
  bundle: true,
  format: "esm",
  outExtension: { ".js": ".mjs" },
  target: "node22",
  sourcemap: "linked",
  logLevel: "info",
  external: [
    "firebase-functions",
    "firebase-functions/*",
    "firebase-admin",
    "firebase-admin/*",
    "pdfkit",
    "fontkit",
    "brotli",
    "nodemailer",
    "handlebars",
  ],
  banner: {
    js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
  },
});
