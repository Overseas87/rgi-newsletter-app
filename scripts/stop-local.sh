#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/local-process-utils.sh
source ./scripts/local-process-utils.sh

status=0

local_stop_owned_processes || status=1
local_stop_project_port_listeners 3000 || status=1
local_stop_project_port_listeners 21410 || status=1

if local_verify_ports_clear; then
  echo "Local RGI app ports are clear."
  exit 0
fi

echo
echo "Local RGI app ports are not clear."
echo "The remaining listener(s) were not killed because they do not clearly belong to this project, or the OS refused the signal."
exit 1
