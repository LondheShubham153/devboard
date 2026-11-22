#!/usr/bin/env bash
# Prepares a local run: creates or refreshes .env and checks the machine.
# Called by `make setup` (and so by `make up` / `make up-ai`).
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. .env: create it, or add any variables a newer .env.example introduced.
#    Existing values are never overwritten.
if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env created"
else
  added=0
  while IFS= read -r line; do
    key="${line%%=*}"
    if ! grep -q "^${key}=" .env; then
      printf '%s\n' "$line" >> .env
      echo ".env: added missing ${key}"
      added=1
    fi
  done < <(grep -E '^[A-Z_]+=' .env.example)
  [ "$added" = 1 ] || echo ".env is up to date"
fi

# 2. Docker must be installed and running.
command -v docker >/dev/null || { echo "Docker is not installed."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and retry."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required."; exit 1; }

# 3. Host ports must be free, unless this stack is already running (then they are ours).
if [ -z "$(docker compose --profile ai ps -q 2>/dev/null)" ]; then
  busy=0
  for var in FRONTEND_HOST_PORT BACKEND_HOST_PORT POSTGRES_HOST_PORT; do
    port="$(grep "^${var}=" .env | cut -d= -f2)"
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $port ($var) is already in use. Free it or change $var in .env."
      busy=1
    fi
  done
  [ "$busy" = 0 ] || exit 1
fi
