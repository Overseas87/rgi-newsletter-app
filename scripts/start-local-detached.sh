#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/Users/aaronschoneck/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export NODE_ENV="${NODE_ENV:-development}"
export RGI_INLINE_JOBS="${RGI_INLINE_JOBS:-true}"
export RGI_START_SCHEDULER="${RGI_START_SCHEDULER:-false}"
export RGI_PRETTY_LOGS="${RGI_PRETTY_LOGS:-true}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:21410}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export FIRESTORE_RETRY_ATTEMPTS="${FIRESTORE_RETRY_ATTEMPTS:-2}"
# Firestore can take several seconds locally when the collection has hundreds
# of articles. A too-small timeout makes healthy data look empty or stale.
export FIRESTORE_OPERATION_TIMEOUT_MS="${FIRESTORE_OPERATION_TIMEOUT_MS:-10000}"
export API_ROUTE_TIMEOUT_MS="${API_ROUTE_TIMEOUT_MS:-12000}"

mkdir -p .local-run

check_can_bind() {
  local port="$1"
  local output
  set +e
  output="$(node -e '
    const port = Number(process.argv[1]);
    const server = require("node:net").createServer();
    server.once("error", (error) => {
      console.error(`${error.code || "ERROR"}: ${error.message}`);
      process.exit(error.code === "EADDRINUSE" ? 20 : 21);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => process.exit(0)));
  ' "$port" 2>&1)"
  local status=$?
  set -e

  if [[ "$status" == "0" ]]; then
    return 0
  fi

  echo "Cannot open port $port."
  echo "$output"
  if [[ "$status" == "20" ]]; then
    echo "A process is already using port $port. Run: pnpm stop:local"
  elif [[ "$output" == *"EPERM"* || "$output" == *"operation not permitted"* ]]; then
    echo "This terminal cannot open localhost ports. Run this from the normal macOS Terminal app."
  fi
  exit 1
}

echo "Stopping any old local RGI app processes..."
bash ./scripts/stop-local.sh || true

check_can_bind 3000
check_can_bind 21410

: > .local-run/backend.log
: > .local-run/frontend.log

echo "Building backend..."
pnpm --filter @workspace/api-server run build

echo "Starting backend in the background on http://localhost:3000"
nohup bash -c 'cd "$1" && exec env HOST=127.0.0.1 PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs' _ "$ROOT_DIR" > .local-run/backend.log 2>&1 &
echo $! > .local-run/backend.pid

for i in {1..45}; do
  if curl -fsS http://localhost:3000/api/readyz >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$(cat .local-run/backend.pid)" >/dev/null 2>&1; then
    echo "Backend exited before becoming ready. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
  sleep 1
  if [[ "$i" == "45" ]]; then
    echo "Backend failed to become ready. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
done

echo "Starting frontend in the background on http://localhost:21410"
nohup bash -c 'cd "$1/artifacts/rgi-digest" && exec env PORT=21410 BASE_PATH=/ ./node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0' _ "$ROOT_DIR" > .local-run/frontend.log 2>&1 &
echo $! > .local-run/frontend.pid

for i in {1..30}; do
  if curl -fsS http://localhost:21410/ >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$(cat .local-run/frontend.pid)" >/dev/null 2>&1; then
    echo "Frontend exited before becoming ready. Last frontend log lines:"
    tail -120 .local-run/frontend.log || true
    exit 1
  fi
  sleep 1
  if [[ "$i" == "30" ]]; then
    echo "Frontend failed to become ready. Last frontend log lines:"
    tail -120 .local-run/frontend.log || true
    exit 1
  fi
done

echo
echo "RGI Newsletter app is running."
echo "Frontend: http://localhost:21410"
echo "Backend:  http://localhost:3000"
echo
echo "Logs:"
echo "  .local-run/backend.log"
echo "  .local-run/frontend.log"
echo
echo "To stop it later, run:"
echo "  pnpm stop:local"

open http://localhost:21410 >/dev/null 2>&1 || true
