#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/Users/aaronschoneck/Documents/Codex/2026-05-05/files-mentioned-by-the-user-rgi/rgi-newsletter-app-main"
cd "$PROJECT_DIR"

clear
echo "Starting the RGI Strategic Intelligence Platform locally..."
echo
echo "Project:"
echo "  $PROJECT_DIR"
echo
echo "This window must stay open while you use the local app."
echo

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm was not found in this Terminal session."
  echo "Install/enable pnpm, then run this launcher again:"
  echo "  corepack enable"
  echo "  corepack prepare pnpm@latest --activate"
  echo
  read -r -p "Press Enter to close this window..."
  exit 1
fi

pnpm stop:local || true

echo
echo "Launching local app..."
echo "Frontend will be available at: http://localhost:21410"
echo "Backend will be available at:  http://localhost:3000"
echo

./run-local.sh

echo
echo "The RGI app stopped."
read -r -p "Press Enter to close this window..."
