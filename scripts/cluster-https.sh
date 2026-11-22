#!/usr/bin/env bash
# DNS + a Let's Encrypt certificate for the domain in k8s/certificate.yml.
# Run after cluster-up. See `make cluster-https`.
#
#   ISSUER=staging ./scripts/cluster-https.sh   # stop at the staging certificate
#   DNS_WAIT=3600  ./scripts/cluster-https.sh   # wait longer for DNS (seconds, default 1800)
#
# DNS: if the domain's zone is in this AWS account's Route 53, the CNAME is created for
# you. Otherwise the script prints the record and waits for it to appear.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib.sh
source scripts/lib.sh

REGION="${REGION:-us-west-2}"
CLUSTER="${CLUSTER:-devboard}"
ISSUER="${ISSUER:-prod}"
DNS_WAIT="${DNS_WAIT:-1800}"

need aws kubectl jq dig curl openssl git
kube_ready || die "kubectl is not pointed at cluster ${CLUSTER} in ${REGION}: aws eks update-kubeconfig --name ${CLUSTER} --region ${REGION}"

DOMAIN="$(awk '/dnsNames:/{getline; gsub(/[ -]/,""); print; exit}' k8s/certificate.yml)"
[ -n "$DOMAIN" ] || die "no dnsNames found in k8s/certificate.yml"
ADDR="$(gateway_addr)"
[ -n "$ADDR" ] || die "the Gateway has no address yet (is the app deployed?)"
ok "domain ${DOMAIN} -> ${ADDR}"

# --- 1. DNS -------------------------------------------------------------------
say "DNS"
zone=""
d="$DOMAIN"
while [[ "$d" == *.* ]]; do
  d="${d#*.}"
  zone="$(aws route53 list-hosted-zones --output json 2>/dev/null \
    | jq -r --arg d "${d}." '.HostedZones[] | select(.Name==$d and (.Config.PrivateZone|not)) | .Id' | head -1)"
  [ -n "$zone" ] && break
done

if [ -n "$zone" ]; then
  batch="$(jq -nc --arg n "$DOMAIN" --arg v "$ADDR" \
    '{Changes:[{Action:"UPSERT",ResourceRecordSet:{Name:$n,Type:"CNAME",TTL:60,ResourceRecords:[{Value:$v}]}}]}')"
  run aws route53 change-resource-record-sets --hosted-zone-id "$zone" --change-batch "$batch" >/dev/null
  ok "Route 53 CNAME ${DOMAIN} -> ${ADDR} (zone ${zone})"
else
  warn "no Route 53 zone for ${DOMAIN} in this account. Create this record at your DNS provider:"
  echo "      CNAME   ${DOMAIN%%.*}   ${ADDR}   (TTL 600)"
fi

dns_ok() { [ "$(dig +short @8.8.8.8 "$DOMAIN" CNAME | head -1)" = "${ADDR}." ]; }
echo "  waiting up to ${DNS_WAIT}s for DNS to resolve..."
wait_until "$DNS_WAIT" dns_ok || die "DNS for ${DOMAIN} does not point at ${ADDR} yet. Re-run when it does."
ok "DNS resolves"
wait_until 300 curl -fsS -o /dev/null "http://${DOMAIN}/" \
  || die "http://${DOMAIN}/ does not answer 200 (a 403 means the frontend image predates the allowedHosts fix)"
ok "http://${DOMAIN}/ answers"

# --- 2. cert-manager ----------------------------------------------------------
say "cert-manager"
if ! kubectl -n cert-manager get cm cert-manager -o jsonpath='{.data.config\.yaml}' 2>/dev/null \
     | grep -A1 'gatewayAPI' | grep -q 'enabled: true'; then
  warn "Gateway API support is off (cert-manager booted before the CRDs): restarting it"
  kubectl -n cert-manager rollout restart deploy cert-manager >/dev/null
  kubectl -n cert-manager rollout status deploy cert-manager --timeout=5m >/dev/null
fi
ok "Gateway API support on"

cert_ready() {
  [ "$(kubectl -n devboard get certificate devboard-tls \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)" = "True" ]
}

# The certificate is requested the moment the app syncs, usually before DNS exists.
# Those first attempts fail and back off for about an hour, so clear them and retry now.
if ! cert_ready; then
  warn "clearing earlier failed attempts so cert-manager retries immediately"
  kubectl -n devboard delete certificaterequest,order,challenge --all --ignore-not-found >/dev/null 2>&1 || true
fi

# --- 3. Staging certificate ---------------------------------------------------
say "Staging certificate"
wait_until 600 cert_ready || die "certificate not Ready: kubectl -n devboard describe certificate,challenge"
ok "devboard-tls is Ready"

issuer_of() {
  kubectl -n devboard get secret devboard-tls -o jsonpath='{.data.tls\.crt}' 2>/dev/null \
    | base64 -d | openssl x509 -noout -issuer 2>/dev/null
}

# --- 4. Production certificate ------------------------------------------------
if [ "$ISSUER" = "staging" ]; then
  warn "ISSUER=staging: stopping with a staging certificate (browsers will warn)"
  exit 0
fi

say "Production certificate"
if issuer_of | grep -qi 'staging'; then
  if grep -q 'name: letsencrypt-staging' k8s/certificate.yml; then
    sed -i.bak 's/name: letsencrypt-staging/name: letsencrypt-prod/' k8s/certificate.yml
    rm -f k8s/certificate.yml.bak
    git add k8s/certificate.yml
    git commit -q -m "Issue the TLS certificate from Let's Encrypt production"
    git push origin "$(git rev-parse --abbrev-ref HEAD)"
  fi
  kubectl -n argocd annotate app devboard-raw argocd.argoproj.io/refresh=hard --overwrite >/dev/null
  # Argo CD must apply the new issuerRef before the Secret is deleted, or cert-manager
  # re-issues from staging again.
  prod_ref() { [ "$(kubectl -n devboard get certificate devboard-tls -o jsonpath='{.spec.issuerRef.name}')" = "letsencrypt-prod" ]; }
  wait_until 300 prod_ref || die "Argo CD has not applied the production issuerRef (check: kubectl -n argocd get app devboard-raw)"
  kubectl -n devboard delete secret devboard-tls --ignore-not-found >/dev/null
  wait_until 600 cert_ready || die "production certificate not Ready: kubectl -n devboard describe certificate,challenge"
fi
issuer_of | grep -qi 'staging' && die "still a staging certificate"
ok "$(issuer_of)"

# --- 5. Verify ----------------------------------------------------------------
say "Verify"
https_ok() { curl -fsS -o /dev/null "https://${DOMAIN}/"; }
wait_until 300 https_ok || die "https://${DOMAIN}/ is not answering (check the https listener: kubectl -n devboard describe gateway devboard-gateway)"
ok "https://${DOMAIN}/ answers with a trusted certificate"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://${DOMAIN}/" || true)"
if [ "$code" = "301" ]; then
  ok "http redirects to https (301)"
else
  warn "http returned ${code}, expected 301 (is httproute-redirect synced?)"
fi
