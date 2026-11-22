#!/usr/bin/env bash
# Tears DevBoard down in the order that actually frees the billing resources.
# See `make cluster-down`.
#
#   YES=1 ./scripts/cluster-down.sh              # skip the confirmation prompt
#   KEEP_STATE=1 ./scripts/cluster-down.sh       # keep the S3 state bucket
#   DRY_RUN=1 ./scripts/cluster-down.sh          # print what would be deleted
#
# Order matters: the load balancers (created by Envoy) and EBS volumes (created by the
# CSI driver) are not in Terraform state, so they must be released from inside the
# cluster BEFORE `terraform destroy`, or they are orphaned and keep billing.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

REGION="${REGION:-us-west-2}"
CLUSTER="${CLUSTER:-devboard}"
KEEP_STATE="${KEEP_STATE:-0}"
export REGION CLUSTER
TF_VARS=(-input=false -var "region=${REGION}" -var "cluster_name=${CLUSTER}")
NAMESPACES=(devboard devboard-helm ollama observability external-secrets cert-manager)

need aws terraform kubectl helm
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS credentials are not working"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

# --- Confirm ------------------------------------------------------------------
say "This will DELETE cluster '${CLUSTER}' in ${REGION} (account ${ACCOUNT}) and everything in it"
[ "$KEEP_STATE" = 1 ] || echo "    and the Terraform state bucket."
if [ "$DRY_RUN" != 1 ] && [ "${YES:-0}" != 1 ]; then
  [ -t 0 ] || die "not a terminal. Re-run with YES=1 to confirm."
  printf '    Type the cluster name (%s) to continue: ' "$CLUSTER"
  read -r answer
  [ "$answer" = "$CLUSTER" ] || die "cancelled"
fi

# --- 1. Inside the cluster ----------------------------------------------------
if aws eks describe-cluster --name "$CLUSTER" --region "$REGION" >/dev/null 2>&1; then
  run aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null
fi

if [ "$DRY_RUN" != 1 ] && kube_ready; then
  say "Stop Argo CD managing anything"
  # Strip finalizers first: a finalizer on an Application is what stalls namespace deletion.
  for app in $(kubectl -n argocd get applications -o name 2>/dev/null); do
    kubectl -n argocd patch "$app" --type merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
  done
  kubectl delete -f gitops/argocd/platform.yaml --ignore-not-found --wait=false >/dev/null 2>&1 || true
  kubectl delete -f gitops/argocd/devboard-raw.yaml -f gitops/argocd/devboard-helm.yaml \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true
  # Children of the app-of-apps can reappear for a moment; strip and delete them too.
  sleep 10
  for app in $(kubectl -n argocd get applications -o name 2>/dev/null); do
    kubectl -n argocd patch "$app" --type merge -p '{"metadata":{"finalizers":null}}' >/dev/null 2>&1 || true
    kubectl -n argocd delete "$app" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  done
  ok "Argo CD applications removed"

  say "Delete the namespaces (this releases the load balancers and EBS volumes)"
  kubectl delete namespace "${NAMESPACES[@]}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  ns_gone() { [ -z "$(kubectl get namespace "${NAMESPACES[@]}" -o name 2>/dev/null)" ]; }
  wait_until 900 ns_gone || warn "some namespaces are still Terminating: kubectl get ns"

  say "Confirm nothing is left to orphan"
  clean() {
    [ -z "$(kubectl -n envoy-gateway-system get svc -o jsonpath='{range .items[?(@.spec.type=="LoadBalancer")]}{.metadata.name}{"\n"}{end}' 2>/dev/null)" ] \
      && [ -z "$(kubectl get gateway -A -o name 2>/dev/null)" ] \
      && [ -z "$(kubectl get pvc -A -o name 2>/dev/null)" ]
  }
  wait_until 900 clean || die "LoadBalancer services, Gateways or PVCs remain. Destroying now would orphan them. Check: kubectl get svc,gateway,pvc -A"
  ok "no LoadBalancer services, Gateways or PVCs"

  say "Remove Envoy Gateway"
  helm uninstall eg -n envoy-gateway-system >/dev/null 2>&1 || warn "eg was not installed"

  say "Release Argo CD from Terraform state, then delete its namespace"
  # helm_release.argocd created the namespace, so destroy would block on Application finalizers.
  terraform -chdir=terraform init -input=false -reconfigure -backend-config=backend.hcl >/dev/null
  for addr in 'helm_release.argocd[0]' 'kubernetes_storage_class_v1.gp3'; do
    if terraform -chdir=terraform state list 2>/dev/null | grep -qxF "$addr"; then
      terraform -chdir=terraform state rm "$addr" >/dev/null
      ok "removed ${addr} from state"
    fi
  done
  kubectl delete namespace argocd --ignore-not-found --wait=false >/dev/null 2>&1 || true
else
  warn "cannot reach cluster ${CLUSTER} in ${REGION} (or dry run): skipping the in-cluster steps"
  [ "$DRY_RUN" = 1 ] && printf '  [dry-run] would: strip Argo CD finalizers, delete apps and namespaces (%s), wait for LB/PVC to clear, helm uninstall eg, terraform state rm argocd+gp3\n' "${NAMESPACES[*]}"
fi

# --- 2. Infrastructure --------------------------------------------------------
say "Destroy the cluster (terraform, about 15 minutes)"
if [ -f terraform/backend.hcl ]; then
  run terraform -chdir=terraform init -input=false -reconfigure -backend-config=backend.hcl >/dev/null
  run terraform -chdir=terraform destroy -auto-approve "${TF_VARS[@]}"
else
  warn "terraform/backend.hcl is missing: skipping terraform destroy (run make cluster-up once, or recreate it from the bootstrap output)"
fi

# --- 3. State bucket, last ----------------------------------------------------
if [ "$KEEP_STATE" = 1 ]; then
  warn "KEEP_STATE=1: leaving the state bucket in place"
else
  say "Destroy the state bucket"
  run terraform -chdir=terraform/bootstrap destroy -auto-approve -input=false -var "region=${REGION}"
  run rm -f terraform/backend.hcl
fi

# --- 4. Verify nothing is still billing --------------------------------------
say "Verify nothing is left"
if [ "$DRY_RUN" = 1 ]; then
  printf '  [dry-run] would list: EKS clusters, unattached EBS volumes, load balancers, secrets\n'
  exit 0
fi
left=0
report() { # report <what> <output>
  if [ -n "$2" ]; then warn "$1 still exists: $2"; left=1; else ok "no $1 left"; fi
}
report "EKS cluster" "$(aws eks list-clusters --region "$REGION" --query "clusters[?@=='${CLUSTER}']" --output text)"
report "unattached EBS volumes" "$(aws ec2 describe-volumes --region "$REGION" --filters Name=status,Values=available --query 'Volumes[].VolumeId' --output text)"
report "network load balancers" "$(aws elbv2 describe-load-balancers --region "$REGION" --query 'LoadBalancers[].LoadBalancerName' --output text 2>/dev/null)"
report "classic load balancers" "$(aws elb describe-load-balancers --region "$REGION" --query 'LoadBalancerDescriptions[].LoadBalancerName' --output text 2>/dev/null)"
report "devboard secrets" "$(aws secretsmanager list-secrets --region "$REGION" --query "SecretList[?starts_with(Name,'devboard')].Name" --output text)"
[ "$left" = 0 ] || die "something is still there (or belongs to another project in this account): review it in the AWS console"
say "Everything is gone"
