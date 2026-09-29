#!/usr/bin/env bash
set -Eeuo pipefail

: "${ENVIRONMENT:?ENVIRONMENT is required}"
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${FRONTEND_IMAGE:?FRONTEND_IMAGE is required}"
: "${BACKEND_IMAGE:?BACKEND_IMAGE is required}"

ENV_FILE="${ENV_FILE:-/etc/devboard/${ENVIRONMENT}.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
STATE_DIR="${STATE_DIR:-/var/lib/devboard}"
PREVIOUS_ENV_FILE="${STATE_DIR}/${ENVIRONMENT}.previous.env"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "ERROR: environment file is missing or unreadable: $ENV_FILE" >&2
  echo "Create it on the deployment host or set ENV_FILE explicitly." >&2
  exit 1
fi

if [[ ! -r "$COMPOSE_FILE" ]]; then
  echo "ERROR: Compose file is missing or unreadable: $COMPOSE_FILE" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: docker is not installed or not available to this runner user." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "ERROR: Docker Compose v2 is not available to this runner user." >&2
  exit 1
}
mkdir -p "$STATE_DIR"

if [[ "${ROLLBACK:-false}" == "true" ]]; then
  test -r "$PREVIOUS_ENV_FILE"
  cp "$PREVIOUS_ENV_FILE" "$ENV_FILE"
else
  cp "$ENV_FILE" "$PREVIOUS_ENV_FILE"
  # Secrets stay in the host-managed env file; only release metadata is appended.
  printf '\nFRONTEND_IMAGE=%s\nBACKEND_IMAGE=%s\nRELEASE_VERSION=%s\n' \
    "$FRONTEND_IMAGE" "$BACKEND_IMAGE" "$RELEASE_VERSION" >> "$ENV_FILE"
fi

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config --quiet

rollback() {
  status=$?
  trap - ERR
  echo "Deployment failed; restoring previous known-good release"
  if [[ -r "$PREVIOUS_ENV_FILE" ]]; then
    cp "$PREVIOUS_ENV_FILE" "$ENV_FILE"
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build || true
  fi
  echo "Container status after deployment failure:"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps || true
  echo "Recent backend logs (credentials are not printed by the application):"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --no-color --tail=100 backend || true
  exit "$status"
}
trap rollback ERR

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-build --remove-orphans

for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${BACKEND_HOST_PORT:-8081}/health" >/dev/null; then
    trap - ERR
    echo "${ENVIRONMENT} release ${RELEASE_VERSION} is healthy"
    exit 0
  fi
  sleep 10
done

false
