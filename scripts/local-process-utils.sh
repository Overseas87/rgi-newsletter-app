#!/usr/bin/env bash

RGI_LOCAL_PORTS=(3000 21410)

local_pid_running() {
  local pid="$1"
  [[ -z "$pid" ]] && return 1
  kill -0 "$pid" >/dev/null 2>&1 && return 0
  ps -p "$pid" >/dev/null 2>&1 && return 0
  lsof -p "$pid" >/dev/null 2>&1 && return 0
  return 1
}

local_pid_command() {
  local pid="$1"
  ps -p "$pid" -o command= 2>/dev/null || true
}

local_pid_cwd() {
  local pid="$1"
  lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

local_pid_belongs_to_project() {
  local pid="$1"
  local command cwd
  command="$(local_pid_command "$pid")"
  cwd="$(local_pid_cwd "$pid")"

  [[ -n "$cwd" && "$cwd" == "$ROOT_DIR"* ]] && return 0
  [[ -n "$command" && "$command" == *"$ROOT_DIR"* ]] && return 0

  return 1
}

local_describe_pid() {
  local pid="$1"
  local command cwd
  command="$(local_pid_command "$pid")"
  cwd="$(local_pid_cwd "$pid")"
  [[ -z "$command" ]] && command="<unknown>"
  [[ -z "$cwd" ]] && cwd="<unknown>"
  echo "PID $pid"
  echo "  command: $command"
  echo "  cwd:     $cwd"
}

local_port_listeners() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

local_print_port_owners() {
  local port="$1"
  local pids
  pids="$(local_port_listeners "$port")"
  if [[ -z "$pids" ]]; then
    echo "Port $port: clear"
    return 0
  fi

  echo "Port $port is still in use:"
  local pid
  for pid in $pids; do
    local_describe_pid "$pid"
  done
}

local_wait_for_pid_exit() {
  local pid="$1"
  local seconds="${2:-3}"
  local i
  for ((i = 0; i < seconds * 10; i++)); do
    if ! local_pid_running "$pid"; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

local_stop_owned_pid() {
  local pid="$1"
  local label="$2"

  if [[ -z "$pid" ]]; then
    return 0
  fi

  if ! local_pid_running "$pid"; then
    echo "$label PID $pid is not running."
    return 0
  fi

  if ! local_pid_belongs_to_project "$pid"; then
    local command cwd
    command="$(local_pid_command "$pid")"
    cwd="$(local_pid_cwd "$pid")"
    if [[ -z "$command" && -z "$cwd" ]]; then
      echo "$label PID $pid is no longer inspectable. Treating it as stale."
      return 0
    fi
    echo "$label PID file points to a process outside this project. Not killing it."
    local_describe_pid "$pid"
    return 2
  fi

  echo "Stopping $label PID $pid"
  if ! kill "$pid" >/dev/null 2>&1; then
    echo "Could not send SIGTERM to $label PID $pid."
    return 1
  fi

  if local_wait_for_pid_exit "$pid" 3; then
    return 0
  fi

  echo "Force-stopping $label PID $pid"
  if ! kill -9 "$pid" >/dev/null 2>&1; then
    echo "Could not send SIGKILL to $label PID $pid."
    return 1
  fi

  local_wait_for_pid_exit "$pid" 2 || return 1
}

local_stop_pid_file() {
  local file="$1"
  local label="$2"

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    rm -f "$file"
    return 0
  fi

  local_stop_owned_pid "$pid" "$label" || true
  rm -f "$file"
}

local_stop_project_port_listeners() {
  local port="$1"
  local pids
  pids="$(local_port_listeners "$port")"
  if [[ -z "$pids" ]]; then
    echo "No local RGI process is listening on port $port."
    return 0
  fi

  local status=0
  local pid
  for pid in $pids; do
    if local_pid_belongs_to_project "$pid"; then
      local_stop_owned_pid "$pid" "port $port listener" || status=1
    else
      echo "Port $port is in use by another project. Not killing it automatically."
      local_describe_pid "$pid"
      status=1
    fi
  done

  return "$status"
}

local_stop_owned_processes() {
  mkdir -p .local-run
  local_stop_project_port_listeners 21410 || true
  local_stop_pid_file .local-run/frontend.pid "frontend"
  local_stop_pid_file .local-run/frontend-wrapper.pid "frontend wrapper"
  local_stop_project_port_listeners 3000 || true
  local_stop_pid_file .local-run/backend.pid "backend"
  local_stop_pid_file .local-run/backend-wrapper.pid "backend wrapper"
}

local_verify_ports_clear() {
  local status=0
  local port
  for port in "${RGI_LOCAL_PORTS[@]}"; do
    if [[ -n "$(local_port_listeners "$port")" ]]; then
      local_print_port_owners "$port"
      status=1
    fi
  done

  return "$status"
}

local_require_ports_available() {
  local status=0
  local port
  for port in "${RGI_LOCAL_PORTS[@]}"; do
    if [[ -n "$(local_port_listeners "$port")" ]]; then
      local_print_port_owners "$port"
      status=1
    fi
  done

  if [[ "$status" != "0" ]]; then
    echo
    echo "One or more required ports are occupied by processes that this project does not own."
    echo "Not killing them automatically."
    echo "Close the listed process, change its port, or run the RGI app after that port is free."
    return 1
  fi
}
