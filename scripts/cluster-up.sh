#!/usr/bin/env bash
# One command from an empty AWS account to a running DevBoard on EKS.
# Idempotent: safe to re-run after a failure. See `make cluster-up`.
#
#   REGION=us-west-2 CLUSTER=devboard BRANCH=<git branch> HTTPS=1 ./scripts/cluster-up.sh
#   DRY_RUN=1 ./scripts/cluster-up.sh     # print what would change, change nothing
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

REGION="${REGION:-us-west-2}"
CLUSTER="${CLUSTER:-devboard}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"
HTTPS="${HTTPS:-0}"          # 1 = also set up DNS and a Let's Encrypt certificate
export REGION CLUSTER

TF_VARS=(-input=false -var "region=${REGION}" -var "cluster_name=${CLUSTER}")

# --- 0. Preflight -------------------------------------------------------------
say "Preflight"
need aws terraform kubectl helm git jq openssl curl
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "AWS credentials are not working. Run: aws configure (or aws sso login)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
ok "AWS account ${ACCOUNT}, region ${REGION}"

origin="$(git remote get-url origin 2>/dev/null)" || die "no git remote named origin"
slug="$(printf '%s' "$origin" | sed -E 's#^(https://github.com/|git@github.com:|ssh://git@github.com/)##; s#\.git$##')"
case "$slug" in */*) ;; *) die "origin is not a GitHub URL I understand: $origin" ;; esac
REPO_URL="https://github.com/${slug}.git"
ok "Argo CD will sync ${REPO_URL} @ ${BRANCH}"
[ "$DRY_RUN" = 1 ] && warn "DRY RUN: nothing below is changed"

# --- 1. Terraform state bucket ------------------------------------------------
say "State bucket (terraform/bootstrap)"
BUCKET="devboard-tfstate-${ACCOUNT}-${REGION}"
run terraform -chdir=terraform/bootstrap init -input=false >/dev/null
if [ "$DRY_RUN" != 1 ] \
   && [ -z "$(terraform -chdir=terraform/bootstrap state list 2>/dev/null)" ] \
   && aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  warn "bucket ${BUCKET} exists but local bootstrap state is empty: importing it"
  terraform -chdir=terraform/bootstrap import -input=false -var "region=${REGION}" \
    aws_s3_bucket.state "$BUCKET" >/dev/null
fi
run terraform -chdir=terraform/bootstrap apply -auto-approve -input=false -var "region=${REGION}"
if [ "$DRY_RUN" != 1 ]; then
  terraform -chdir=terraform/bootstrap output -raw backend_hcl > terraform/backend.hcl
  ok "terraform/backend.hcl written (bucket ${BUCKET})"
fi

# --- 2. The cluster -----------------------------------------------------------
say "Cluster (terraform, about 15-20 minutes the first time)"
run terraform -chdir=terraform init -input=false -reconfigure -backend-config=backend.hcl >/dev/null
run terraform -chdir=terraform apply -auto-approve "${TF_VARS[@]}"
run aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null
if [ "$DRY_RUN" != 1 ]; then
  kube_ready || die "kubectl cannot reach cluster ${CLUSTER} in ${REGION}"
  ok "$(kubectl get nodes --no-headers | wc -l | tr -d ' ') nodes ready"
fi

# --- 3. Database password -----------------------------------------------------
say "Database password (AWS Secrets Manager)"
SECRET="devboard/postgres"
if [ "$DRY_RUN" != 1 ]; then
  SECRET="$(terraform -chdir=terraform output -raw postgres_secret_name 2>/dev/null || echo "$SECRET")"
fi
if aws secretsmanager get-secret-value --secret-id "$SECRET" --region "$REGION" >/dev/null 2>&1; then
  ok "${SECRET} already has a value (left unchanged)"
elif [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would generate a random password and store it in %s\n' "$SECRET"
else
  # Hex, not base64: it goes into a postgres:// URL, and base64's / and + would need escaping.
  pass="$(openssl rand -hex 32)"
  aws secretsmanager put-secret-value --secret-id "$SECRET" --region "$REGION" \
    --secret-string "$(jq -nc --arg p "$pass" '{username:"devboard",password:$p,dbname:"devboard"}')" >/dev/null
  unset pass
  ok "random password stored in ${SECRET} (never printed)"
fi

# --- 4. Point Argo CD at this repo and branch ---------------------------------
say "Rewire Argo CD to ${slug}@${BRANCH}"
files="$(grep -rl 'repoURL: https://github.com' gitops/argocd || true)"
if [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would set repoURL and targetRevision in %s files under gitops/argocd\n' \
    "$(printf '%s\n' "$files" | grep -c .)"
else
  for f in $files; do
    sed -i.bak -E \
      -e "s#(repoURL: )https://github.com/[^ ]+#\\1${REPO_URL}#" \
      -e "s#^( *targetRevision: )[A-Za-z][A-Za-z0-9/_.-]*\$#\\1${BRANCH}#" "$f"
    rm -f "${f}.bak"
  done
  # The ClusterSecretStore carries the region too (one of the five places).
  sed -i.bak -E "s#^( *region: ).*#\\1${REGION}#" gitops/external-secrets/cluster-secret-store.yaml
  rm -f gitops/external-secrets/cluster-secret-store.yaml.bak
  if ! git diff --quiet -- gitops; then
    git add gitops
    git commit -q -m "Point Argo CD at ${slug}@${BRANCH}"
    ok "committed the rewire"
  else
    ok "already pointing there"
  fi
fi

# --- 5. Push the branch (Argo CD reads GitHub, not this laptop) ---------------
say "Push ${BRANCH}"
if [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would run: git push -u origin %s\n' "$BRANCH"
else
  ahead="$(git rev-list "origin/${BRANCH}..${BRANCH}" --oneline 2>/dev/null || git log --oneline -1)"
  if [ -n "$ahead" ]; then
    warn "pushing these commits so Argo CD can see them:"
    printf '%s\n' "$ahead" | head -10 | sed 's/^/      /'
    git push -u origin "$BRANCH"
  fi
  git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null || die "branch ${BRANCH} is not on origin"
  ok "branch ${BRANCH} is on origin"
fi

# --- 6. Envoy Gateway, the platform, the app ----------------------------------
say "Platform and app (scripts/deploy.sh)"
if [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would run: ./scripts/deploy.sh\n'
else
  ./scripts/deploy.sh
fi

# --- 7. Wake up the AI assistant ----------------------------------------------
say "AI assistant (Ollama pulls about 1.3 GB on first start)"
if [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would wait for the ollama deployment and check /api/ai/health\n'
else
  if kubectl -n ollama rollout status deploy/ollama --timeout=20m >/dev/null 2>&1; then
    ok "ollama is ready"
  else
    warn "ollama not ready yet: kubectl -n ollama get pods"
  fi
  ADDR="$(gateway_addr)"
  if [ -n "$ADDR" ] && wait_until 600 curl -fsS "http://${ADDR}/api/ai/health"; then
    ok "http://${ADDR}/api/ai/health answers"
  else
    warn "AI health not answering yet (a new load balancer can take a few minutes to resolve)"
  fi
fi

# --- 8. HTTPS (optional) ------------------------------------------------------
if [ "$HTTPS" = 1 ]; then
  say "HTTPS"
  run ./scripts/cluster-https.sh
else
  say "HTTPS skipped"
  echo "    To add DNS and a Let's Encrypt certificate: make cluster-https"
fi

say "Done"
if [ "$DRY_RUN" != 1 ]; then
  echo "    URL:       http://$(gateway_addr)"
  echo "    Argo CD:   kubectl -n argocd port-forward svc/argocd-server 8080:80"
  echo "               kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
  echo "    Grafana:   kubectl -n observability port-forward svc/observability-grafana 3000:80   (admin / devboard)"
  echo "    Tear down: make cluster-down        (about \$11/day while it runs)"
fi
