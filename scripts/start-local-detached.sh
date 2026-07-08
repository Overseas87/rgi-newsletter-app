#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/local-process-utils.sh
source ./scripts/local-process-utils.sh

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
LOG_MAX_BYTES="${RGI_LOCAL_LOG_MAX_BYTES:-5242880}"
LOG_RETAIN_BYTES="${RGI_LOCAL_LOG_RETAIN_BYTES:-1048576}"

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
if ! bash ./scripts/stop-local.sh; then
  echo
  echo "Could not safely clear the local RGI ports."
  echo "Resolve the port conflict above, then run pnpm start:local again."
  exit 1
fi

check_can_bind 3000
check_can_bind 21410

: > .local-run/backend.log
: > .local-run/frontend.log

echo "Building backend..."
pnpm --filter @workspace/api-server run build

echo "Starting backend in the background on http://localhost:3000"
nohup bash -c '
  set -Eeuo pipefail
  cd "$1"
  (
    env HOST=127.0.0.1 PORT=3000 node --enable-source-maps ./artifacts/api-server/dist/index.mjs 2>&1 &
    backend_pid=$!
    if ! echo "$backend_pid" > .local-run/backend.pid; then
      echo "[local-run] Warning: could not write backend PID file"
    fi
    set +e
    wait "$backend_pid"
    exit_code=$?
    set -e
    if [[ "$exit_code" == "143" ]]; then
      echo "[local-run] Backend received SIGTERM. This is expected when stopping or restarting the local app."
      exit 0
    fi
    echo "[local-run] Backend process exited with code $exit_code"
    exit "$exit_code"
  ) | env RGI_LOCAL_LOG_MAX_BYTES="$2" RGI_LOCAL_LOG_RETAIN_BYTES="$3" node ./scripts/local-log-writer.mjs .local-run/backend.log --quiet
' _ "$ROOT_DIR" "$LOG_MAX_BYTES" "$LOG_RETAIN_BYTES" >/dev/null 2>&1 &
echo $! > .local-run/backend-wrapper.pid

for i in {1..10}; do
  [[ -f .local-run/backend.pid ]] && break
  sleep 0.2
done

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
    echo "Backend failed to become ready. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
done

echo "Starting frontend in the background on http://localhost:21410"
nohup bash -c '
  set -Eeuo pipefail
  cd "$1/artifacts/rgi-digest"
  (
    env PORT=21410 BASE_PATH=/ ./node_modules/.bin/vite --config vite.config.ts --host 0.0.0.0 2>&1 &
    frontend_pid=$!
    if ! echo "$frontend_pid" > "$1/.local-run/frontend.pid"; then
      echo "[local-run] Warning: could not write frontend PID file"
    fi
    set +e
    wait "$frontend_pid"
    exit_code=$?
    set -e
    if [[ "$exit_code" == "143" ]]; then
      echo "[local-run] Frontend received SIGTERM. This is expected when stopping or restarting the local app."
      exit 0
    fi
    echo "[local-run] Frontend process exited with code $exit_code"
    exit "$exit_code"
  ) | env RGI_LOCAL_LOG_MAX_BYTES="$2" RGI_LOCAL_LOG_RETAIN_BYTES="$3" node "$1/scripts/local-log-writer.mjs" "$1/.local-run/frontend.log" --quiet
' _ "$ROOT_DIR" "$LOG_MAX_BYTES" "$LOG_RETAIN_BYTES" >/dev/null 2>&1 &
echo $! > .local-run/frontend-wrapper.pid

for i in {1..10}; do
  [[ -f .local-run/frontend.pid ]] && break
  sleep 0.2
done

for i in {1..30}; do
  if curl -fsS http://localhost:21410/ >/dev/null 2>&1; then
    break
  fi
  if [[ -f .local-run/frontend.pid ]] && ! kill -0 "$(cat .local-run/frontend.pid)" >/dev/null 2>&1; then
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
echo "  cap: $LOG_MAX_BYTES bytes, retaining last $LOG_RETAIN_BYTES bytes"
echo
echo "To stop it later, run:"
echo "  pnpm stop:local"

open http://localhost:21410 >/dev/null 2>&1 || true
