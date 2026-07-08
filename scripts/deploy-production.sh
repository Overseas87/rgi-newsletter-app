#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PROJECT_ID="${PROJECT_ID:-blog-generator-1bb12}"
FRONTEND_URL="${FRONTEND_URL:-https://${PROJECT_ID}.web.app}"

export PATH="/Users/aaronschoneck/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
export FIREBASE_CLI_DISABLE_UPDATE_CHECK=1
export NO_UPDATE_NOTIFIER=1

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI is not installed. Install it with: npm install -g firebase-tools" >&2
  exit 1
fi

echo "Building frontend and backend..."
pnpm --filter @workspace/api-server run build
node scripts/build-functions.mjs
PORT=21410 BASE_PATH=/ pnpm --filter @workspace/rgi-digest run build

echo "Deploying Firebase Hosting, Functions API, scheduled functions, and Firestore rules..."
firebase deploy --project "$PROJECT_ID" --only functions:api,functions:hourlyScrape,functions:morningIntelligenceBrief,functions:eveningIntelligenceBrief,hosting,firestore:rules --force

echo
echo "Production deployment complete."
echo "Frontend: ${FRONTEND_URL}"
echo "Backend:  ${FRONTEND_URL}/api"
echo "Health:   ${FRONTEND_URL}/api/healthz"
