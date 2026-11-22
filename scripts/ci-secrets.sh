#!/usr/bin/env bash
# Sets the GitHub Actions variable and secrets the pipeline needs, from environment
# variables, so none of them are typed into a web page. See `make ci-secrets`.
#
#   DOCKERHUB_USERNAME=me DOCKERHUB_TOKEN=... SONAR_TOKEN=... SONAR_HOST_URL=https://... \
#     ./scripts/ci-secrets.sh
#
# Only the variables you set are changed. Needs `gh auth login` once.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

need gh git
gh auth status >/dev/null 2>&1 || die "not logged in to GitHub. Run: gh auth login"

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
ok "repository ${repo}"

set_any=0
if [ -n "${DOCKERHUB_USERNAME:-}" ]; then
  run gh variable set DOCKERHUB_USERNAME --body "$DOCKERHUB_USERNAME" --repo "$repo"
  ok "variable DOCKERHUB_USERNAME"
  set_any=1
fi
for name in DOCKERHUB_TOKEN SONAR_TOKEN SONAR_HOST_URL; do
  value="${!name:-}"
  if [ -n "$value" ]; then
    # stdin, not an argument: the value never appears in the process list
    if [ "$DRY_RUN" = 1 ]; then
      printf '  [dry-run] would set secret %s\n' "$name"
    else
      printf '%s' "$value" | gh secret set "$name" --repo "$repo"
    fi
    ok "secret ${name}"
    set_any=1
  fi
done
[ "$set_any" = 1 ] || die "nothing to set. Export DOCKERHUB_USERNAME, DOCKERHUB_TOKEN, SONAR_TOKEN and/or SONAR_HOST_URL first."

echo
gh secret list --repo "$repo"
gh variable list --repo "$repo"
