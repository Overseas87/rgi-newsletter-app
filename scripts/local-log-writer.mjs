#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [logPath, ...flags] = process.argv.slice(2);

if (!logPath) {
  console.error("Usage: local-log-writer.mjs <log-path> [--quiet]");
  process.exit(1);
}

const quiet = flags.includes("--quiet");
const maxBytes = Number(process.env.RGI_LOCAL_LOG_MAX_BYTES ?? 5 * 1024 * 1024);
const retainBytes = Number(process.env.RGI_LOCAL_LOG_RETAIN_BYTES ?? 1024 * 1024);
const resolvedLogPath = path.resolve(process.cwd(), logPath);

fs.mkdirSync(path.dirname(resolvedLogPath), { recursive: true });

let currentBytes = 0;
let fileLoggingEnabled = true;
let warnedAboutFileLogging = false;

function disableFileLogging(error) {
  fileLoggingEnabled = false;
  if (warnedAboutFileLogging) return;
  warnedAboutFileLogging = true;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[local-run] File logging disabled for ${resolvedLogPath}: ${message}`);
}

try {
  fs.writeFileSync(resolvedLogPath, "");
} catch (error) {
  disableFileLogging(error);
}

function trimLogIfNeeded(incomingBytes) {
  if (!fileLoggingEnabled) return;
  if (currentBytes + incomingBytes <= maxBytes) return;

  let retained = Buffer.alloc(0);
  try {
    const existing = fs.readFileSync(resolvedLogPath);
    retained = existing.subarray(Math.max(0, existing.length - retainBytes));
  } catch {
    retained = Buffer.alloc(0);
  }

  const marker = Buffer.from(
    `\n[local-run] Log trimmed at ${new Date().toISOString()} after reaching ${maxBytes} bytes. Keeping last ${retainBytes} bytes.\n`,
  );
  try {
    fs.writeFileSync(resolvedLogPath, Buffer.concat([marker, retained]));
    currentBytes = marker.length + retained.length;
  } catch (error) {
    disableFileLogging(error);
  }
}

process.stdin.on("data", (chunk) => {
  if (!quiet || !fileLoggingEnabled) process.stdout.write(chunk);
  trimLogIfNeeded(chunk.length);
  if (!fileLoggingEnabled) return;
  try {
    fs.appendFileSync(resolvedLogPath, chunk);
    currentBytes += chunk.length;
  } catch (error) {
    disableFileLogging(error);
  }
});

process.stdin.on("end", () => {
  if (!quiet) process.stdout.write("");
});
