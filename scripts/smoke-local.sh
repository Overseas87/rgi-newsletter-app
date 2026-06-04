#!/usr/bin/env bash
set -Eeuo pipefail

FRONTEND_URL="${FRONTEND_URL:-http://localhost:21410}"
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"

check() {
  local label="$1"
  local url="$2"
  echo "Checking $label..."
  if ! curl -fsS "$url" >/tmp/rgi-smoke-response.json 2>/tmp/rgi-smoke-error.log; then
    echo "FAILED: $label"
    cat /tmp/rgi-smoke-error.log || true
    return 1
  fi
  echo "OK: $label"
}

check "backend readiness" "$BACKEND_URL/api/readyz"
check "backend health" "$BACKEND_URL/api/healthz"
check "Firestore sources API" "$BACKEND_URL/api/sources"
check "dashboard API" "$BACKEND_URL/api/dashboard/summary"
check "digest API" "$BACKEND_URL/api/digest"
check "frontend" "$FRONTEND_URL/"

echo
echo "Local RGI smoke test passed."
echo "Frontend: $FRONTEND_URL"
echo "Backend:  $BACKEND_URL"
