#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="blog-generator-1bb12"
LEGACY_PROJECT_ID="rgi-insight-blog-generator"
HOST="${RGI_SMOKE_HOST:-127.0.0.1}"
PORT="${RGI_SMOKE_BACKEND_PORT:-3001}"
BASE_URL="http://${HOST}:${PORT}"
LOG_DIR="$ROOT_DIR/.local-run"
LOG_FILE="$LOG_DIR/firebase-readonly-smoke.log"
RESPONSE_FILE="$LOG_DIR/firebase-readonly-smoke-response.json"

mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

backend_pid=""
cleanup() {
  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Building API server for read-only Firebase smoke test..."
pnpm --filter @workspace/api-server run build

echo "Starting API server with explicit migrated Firebase read-only settings..."
env \
  -u FIREBASE_SERVICE_ACCOUNT_JSON \
  -u GOOGLE_APPLICATION_CREDENTIALS \
  -u FIRESTORE_EMULATOR_HOST \
  -u USE_FIRESTORE_EMULATOR \
  -u USE_MOCK_DATA \
  -u RGI_FORCE_LOCAL_STORE \
  -u RGI_ALLOW_LOCAL_FALLBACK \
  FIREBASE_PROJECT_ID="$PROJECT_ID" \
  NODE_ENV=development \
  HOST="$HOST" \
  PORT="$PORT" \
  FRONTEND_URL="http://localhost:21410" \
  RGI_READ_ONLY_STARTUP=true \
  RGI_START_SCHEDULER=false \
  RGI_INLINE_JOBS=false \
  node --enable-source-maps ./artifacts/api-server/dist/index.mjs >"$LOG_FILE" 2>&1 &
backend_pid="$!"

fetch_json() {
  local label="$1"
  local path="$2"
  local url="${BASE_URL}${path}"

  if ! curl -fsS -H "accept: application/json" "$url" > "$RESPONSE_FILE"; then
    echo "FAILED: ${label}"
    echo "Backend log: $LOG_FILE"
    return 1
  fi
}

wait_for_ready() {
  local attempts=40
  for ((i = 1; i <= attempts; i++)); do
    if fetch_json "backend readiness" "/api/readyz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "FAILED: backend did not become ready"
  echo "Backend log: $LOG_FILE"
  return 1
}

assert_readyz() {
  node - "$RESPONSE_FILE" "$PROJECT_ID" "$LEGACY_PROJECT_ID" <<'NODE'
const fs = require("node:fs");
const [file, expectedProjectId, legacyProjectId] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const runtime = payload.runtime || {};
if (runtime.firestoreProjectId === legacyProjectId) {
  throw new Error("Smoke runtime targets the legacy Firebase project.");
}
if (runtime.firestoreProjectId !== expectedProjectId) {
  throw new Error(`Smoke runtime target mismatch: ${runtime.firestoreProjectId || "unset"}`);
}
if (runtime.readOnlyStartup !== true) {
  throw new Error("RGI_READ_ONLY_STARTUP is not active.");
}
if (runtime.firestoreEmulatorActive === true || runtime.localStoreMode === true || runtime.mockDataMode === true) {
  throw new Error("Smoke runtime is not using the migrated Firestore backend.");
}
console.log(`OK: readyz target=${runtime.firestoreProjectId} readOnlyStartup=${runtime.readOnlyStartup}`);
NODE
}

assert_healthz() {
  node - "$RESPONSE_FILE" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (payload.status !== "ok" || payload.database !== "firestore" || payload.firestore?.available !== true) {
  throw new Error("Firestore health check is not ok.");
}
console.log("OK: healthz Firestore available");
NODE
}

assert_diagnostics() {
  node - "$RESPONSE_FILE" "$PROJECT_ID" <<'NODE'
const fs = require("node:fs");
const [file, expectedProjectId] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const runtime = payload.env?.runtime || {};
const data = payload.data || {};
if (payload.status !== "ok" || payload.database !== "firestore") {
  throw new Error("Diagnostics did not report healthy Firestore.");
}
if (runtime.firestoreProjectId !== expectedProjectId) {
  throw new Error("Diagnostics runtime target mismatch.");
}
if (Number(data.articles || 0) <= 1000) {
  throw new Error(`Diagnostics article count appears capped: ${data.articles || 0}`);
}
console.log(`OK: diagnostics sources=${data.sources} articles=${data.articles} digests=${data.digests}`);
NODE
}

summarize_array_count() {
  local label="$1"
  node - "$RESPONSE_FILE" "$label" <<'NODE'
const fs = require("node:fs");
const [file, label] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(file, "utf8"));
const count = Array.isArray(payload) ? payload.length : Array.isArray(payload.items) ? payload.items.length : 0;
if (count < 1) {
  throw new Error(`${label} returned no rows.`);
}
console.log(`OK: ${label} count=${count}`);
NODE
}

summarize_settings() {
  node - "$RESPONSE_FILE" <<'NODE'
const fs = require("node:fs");
const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const keys = Object.keys(payload || {}).filter((key) => !/secret|token|key|credential|email/i.test(key));
if (keys.length < 1) {
  throw new Error("Settings endpoint returned no public settings fields.");
}
console.log(`OK: settings keys=${keys.sort().join(",")}`);
NODE
}

wait_for_ready
assert_readyz

fetch_json "backend health" "/api/healthz"
assert_healthz

fetch_json "diagnostics" "/api/diagnostics"
assert_diagnostics

fetch_json "articles list" "/api/articles?limit=5"
summarize_array_count "articles"

fetch_json "sources list" "/api/sources"
summarize_array_count "sources"

fetch_json "dashboard settings" "/api/dashboard/settings"
summarize_settings

fetch_json "digest list" "/api/digest?limit=5"
summarize_array_count "digest"

echo
echo "Read-only Firebase smoke test passed."
echo "Backend: $BASE_URL"
echo "Target project: $PROJECT_ID"
echo "Backend log: $LOG_FILE"
