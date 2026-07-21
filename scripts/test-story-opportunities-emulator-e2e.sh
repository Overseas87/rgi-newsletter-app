#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

require_emulator_host() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Refusing to run: $name is not set." >&2
    exit 1
  fi
  if [[ ! "$value" =~ ^(127\.0\.0\.1|localhost):[0-9]+$ ]]; then
    echo "Refusing to run: $name must be a loopback emulator host, received $value." >&2
    exit 1
  fi
}

require_emulator_host FIRESTORE_EMULATOR_HOST
require_emulator_host FIREBASE_AUTH_EMULATOR_HOST

PROJECT_ID="${FIREBASE_PROJECT_ID:-${GCLOUD_PROJECT:-${GOOGLE_CLOUD_PROJECT:-}}}"
if [[ "$PROJECT_ID" != demo-* ]]; then
  echo "Refusing to run against non-demo Firebase project: ${PROJECT_ID:-unset}." >&2
  exit 1
fi

if [[ -n "${GCLOUD_PROJECT:-}" && "$GCLOUD_PROJECT" != "$PROJECT_ID" ]]; then
  echo "Refusing to run: FIREBASE_PROJECT_ID and GCLOUD_PROJECT disagree." >&2
  exit 1
fi
if [[ -n "${GOOGLE_CLOUD_PROJECT:-}" && "$GOOGLE_CLOUD_PROJECT" != "$PROJECT_ID" ]]; then
  echo "Refusing to run: FIREBASE_PROJECT_ID and GOOGLE_CLOUD_PROJECT disagree." >&2
  exit 1
fi

export FIREBASE_PROJECT_ID="$PROJECT_ID"
export GCLOUD_PROJECT="$PROJECT_ID"
export GOOGLE_CLOUD_PROJECT="$PROJECT_ID"
export RGI_EDITOR_UIDS="rgi-e2e-editor"
export STORY_OPPORTUNITIES_READS_ENABLED="true"
export STORY_OPPORTUNITIES_WRITES_ENABLED="true"
export PROFESSOR_LIBRARY_WRITES_ENABLED="false"
export RGI_READ_ONLY_STARTUP="false"
export RGI_START_SCHEDULER="false"
export RGI_INLINE_JOBS="false"
export RGI_PRETTY_LOGS="false"
export FRONTEND_URL="http://127.0.0.1:21413"

# The test must prove Firebase ID-token authorization. Remove every shared-key
# or production credential path while both SDKs are pinned to loopback hosts.
unset ADMIN_API_KEY
unset VITE_ADMIN_API_KEY
unset FIREBASE_SERVICE_ACCOUNT_JSON
unset GOOGLE_APPLICATION_CREDENTIALS

pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run seed:e2e:emulator
pnpm --filter @workspace/rgi-digest run test:e2e:real-stack
