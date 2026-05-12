#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PATH="/Users/aaronschoneck/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export NODE_ENV="${NODE_ENV:-development}"
export DATABASE_PROVIDER="${DATABASE_PROVIDER:-supabase}"
export RGI_INLINE_JOBS="${RGI_INLINE_JOBS:-true}"
export FRONTEND_URL="${FRONTEND_URL:-http://localhost:21410}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

mkdir -p .local-run
rm -f .local-run/backend.pid .local-run/frontend.pid

cleanup() {
  if [[ -f .local-run/backend.pid ]]; then
    kill "$(cat .local-run/backend.pid)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Building backend..."
pnpm --filter @workspace/api-server run build

echo "Starting backend on http://localhost:3000"
(PORT=3000 pnpm --filter @workspace/api-server run start > .local-run/backend.log 2>&1 & echo $! > .local-run/backend.pid)

for i in {1..45}; do
  if curl -fsS http://localhost:3000/api/healthz >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" == "45" ]]; then
    echo "Backend failed to start. Last backend log lines:"
    tail -120 .local-run/backend.log || true
    exit 1
  fi
done

echo
echo "RGI Newsletter app is starting:"
echo "  Frontend: http://localhost:21410"
echo "  Backend:  http://localhost:3000"
echo

PORT=21410 BASE_PATH=/ pnpm --filter @workspace/rgi-digest run dev
