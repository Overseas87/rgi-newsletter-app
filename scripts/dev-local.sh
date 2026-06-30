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
export RGI_FORCE_LOCAL_STORE="${RGI_FORCE_LOCAL_STORE:-false}"

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

  echo
  echo "The local app cannot open port $port."
  echo "$output"
  echo
  if [[ "$output" == *"EPERM"* || "$output" == *"operation not permitted"* ]]; then
    echo "This usually means the command is running inside a restricted Codex/sandbox terminal."
    echo "Run the same command from the normal macOS Terminal app instead:"
    echo "  cd \"$ROOT_DIR\""
    echo "  ./run-local.sh"
  else
    echo "Something else is using or blocking port $port."
    echo "Try clearing the app ports first:"
    echo "  cd \"$ROOT_DIR\""
    echo "  bash ./scripts/stop-local.sh"
    echo "  ./run-local.sh"
  fi
  exit 1
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Stopping stale process(es) on port $port: $pids"
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
      sleep 1
    fi
  fi

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "Could not clear port $port. Stale process(es) still running: $pids"
    echo "Close the old terminal window, or run: kill -9 $pids"
    exit 1
  fi
}

if [[ -f .local-run/backend.pid ]]; then
  OLD_BACKEND_PID="$(cat .local-run/backend.pid || true)"
  if [[ -n "${OLD_BACKEND_PID}" ]]; then
    kill "${OLD_BACKEND_PID}" >/dev/null 2>&1 || true
    sleep 1
  fi
fi
rm -f .local-run/backend.pid .local-run/frontend.pid
kill_port 3000
kill_port 21410
check_can_bind 3000
check_can_bind 21410
: > .local-run/backend.log
: > .local-run/frontend.log

cleanup() {
  echo
  echo "Stopping local RGI app..."
  if [[ -f .local-run/backend.pid ]]; then
    kill "$(cat .local-run/backend.pid)" >/dev/null 2>&1 || true
  fi
  if [[ -f .local-run/frontend.pid ]]; then
    kill "$(cat .local-run/frontend.pid)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Building backend..."
pnpm --filter @workspace/api-server run build

echo "Starting backend on http://localhost:3000"
(HOST=127.0.0.1 PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs > .local-run/backend.log 2>&1 & echo $! > .local-run/backend.pid)

for i in {1..45}; do
  if curl -fsS http://localhost:3000/api/readyz >/dev/null 2>&1; then
    break
  fi
  if [[ -f .local-run/backend.pid ]] && ! kill -0 "$(cat .local-run/backend.pid)" >/dev/null 2>&1; then
    echo "Backend exited before becoming ready. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
  sleep 1
  if [[ "$i" == "45" ]]; then
    echo "Backend failed to start. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
done

READY_RESPONSE="$(curl -fsS http://localhost:3000/api/readyz || true)"

echo
echo "RGI Newsletter app is starting:"
echo "  Frontend: http://localhost:21410"
echo "  Backend:  http://localhost:3000"
if [[ "$RGI_FORCE_LOCAL_STORE" == "true" ]]; then
  echo "  Database: local JSON store"
else
  echo "  Database: Firestore"
fi
echo "  Backend ready: ${READY_RESPONSE}"
echo
echo "Keep this terminal window open while using the local app."
echo "If a page says data is unavailable, check:"
echo "  Backend log:  .local-run/backend.log"
echo "  Frontend log: .local-run/frontend.log"
echo

(for i in {1..30}; do
  if curl -fsS http://localhost:21410/ >/dev/null 2>&1; then
    open http://localhost:21410 >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 1
done) &

PORT=21410 BASE_PATH=/ pnpm --filter @workspace/rgi-digest run dev 2>&1 | tee .local-run/frontend.log
