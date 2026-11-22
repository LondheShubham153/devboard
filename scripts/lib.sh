# Shared helpers for the cluster scripts. Source it; do not run it.
# shellcheck shell=bash

DRY_RUN="${DRY_RUN:-0}"   # DRY_RUN=1 prints every change instead of making it

say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# run <cmd...>: run it, or just print it in dry-run mode.
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}

need() {
  local b
  for b in "$@"; do command -v "$b" >/dev/null 2>&1 || die "missing tool: $b"; done
}

# wait_until <timeout-seconds> <cmd...>: poll every 10s until the command succeeds.
wait_until() {
  local limit="$1" waited=0
  shift
  until "$@" >/dev/null 2>&1; do
    [ "$waited" -ge "$limit" ] && return 1
    sleep 10
    waited=$((waited + 10))
  done
}

# kube_ready: true only when kubectl points at THIS cluster in THIS region.
# Guards against acting on whatever cluster the current context happens to be.
kube_ready() {
  local ctx
  ctx="$(kubectl config current-context 2>/dev/null || true)"
  case "$ctx" in
    *":${REGION}:"*"cluster/${CLUSTER}") kubectl get nodes >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

# gateway_addr: the public hostname of the DevBoard Gateway (empty until it exists).
gateway_addr() {
  kubectl -n devboard get gateway devboard-gateway \
    -o jsonpath='{.status.addresses[0].value}' 2>/dev/null || true
}
