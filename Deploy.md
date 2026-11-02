# Deploy DevBoard to EKS

> **This file is the runbook. `gitops/` is the course.**
> Deploy.md tells you *what to run and in what order*. Each step links to the
> chapter that explains *why*. If the two ever disagree, this file wins — it is
> the one that gets run end to end.

Roughly 50 minutes, ~20 of which is `terraform apply` doing nothing you can help
with. It costs about **$11/day** while it is up (`gitops/README.md` has the
breakdown). Section 15 tears it down.

```
terraform/bootstrap  ─▶  state bucket
terraform/           ─▶  VPC · EKS · gp3 · Pod Identity · Secrets Manager · ArgoCD
scripts/deploy.sh    ─▶  Envoy Gateway · platform app-of-apps · the app
your browser         ─▶  https://devboard.trainwithshubham.com
```

---

## 0. Before you start

### 0.1 Tools

```bash
brew install awscli terraform kubernetes-cli helm jq   # macOS
```

Linux install commands are in [gitops/01-prerequisites.md](gitops/01-prerequisites.md).
You also need `dig` (`dnsutils` on Debian, `bind-utils` on RHEL) for section 12.

**You know it worked when:**

```bash
terraform version   # >= 1.11 — needed for S3-native state locking
kubectl version --client
helm version
aws --version
jq --version
dig -v
```

### 0.2 AWS credentials

```bash
aws configure          # region: us-west-2
aws sts get-caller-identity
```

You need rights to create EKS, VPC, IAM, S3 and Secrets Manager resources.
`AdministratorAccess` is simplest while learning.

### 0.3 Fork and rewire

ArgoCD syncs from whatever `repoURL` says. If it still points at the upstream
repo, your pushes never reach the cluster.

```bash
gh repo fork LondheShubham153/devboard --clone --remote
cd devboard && git checkout mega-project

GH_USER=<your-github-username>

# macOS (BSD sed):
grep -rl 'LondheShubham153/devboard.git' gitops/argocd \
  | xargs sed -i '' "s|LondheShubham153/devboard.git|${GH_USER}/devboard.git|g"

# Linux (GNU sed): same, but  sed -i  with no ''
```

**You know it worked when:**

```bash
grep -rn 'repoURL: https://github.com' gitops/argocd | grep -v "$GH_USER"   # prints nothing
grep -rl "$GH_USER/devboard.git" gitops/argocd | wc -l                      # 14
```

> ⚠️ Keep the branch named `mega-project`. All 14 files also carry
> `targetRevision: mega-project`, and renaming means 14 more edits. It is the
> single most common cause of `ComparisonError`.

### 0.4 Changing region — the five places

Stay on `us-west-2` and you can skip this. If you change it, all five must agree:

```bash
aws configure get region                                          # 1
grep '^region' terraform/terraform.tfvars                         # 2
# 3 — bootstrap takes it as a flag: terraform apply -var=region=<r>
grep 'region:' gitops/external-secrets/cluster-secret-store.yaml  # 4
grep '^region' terraform/backend.hcl                              # 5 (created in §2)
```

> Number 4 is the one people miss. A mismatch surfaces much later as
> `ResourceNotFoundException` on a secret you can plainly see in the console.
> The gate in §8 catches it.

---

## 1. Create the state bucket

→ why: [gitops/02-terraform-bootstrap.md](gitops/02-terraform-bootstrap.md)

```bash
cd terraform/bootstrap
terraform init
terraform apply          # type: yes
```

**You know it worked when:**

```bash
terraform output -raw bucket_name
aws s3api get-bucket-versioning --bucket "$(terraform output -raw bucket_name)"
# "Status": "Enabled"
```

## 2. Point Terraform at that bucket

```bash
terraform output -raw backend_hcl > ../backend.hcl
cat ../backend.hcl
cd ..
terraform init -backend-config=backend.hcl
```

**You know it worked when:** you see `Successfully configured the backend "s3"`.

`backend.hcl` is gitignored — it names *your* bucket.

## 3. Build the cluster

→ why: [gitops/03-provision-eks.md](gitops/03-provision-eks.md)

```bash
terraform plan           # ~70 resources
terraform apply          # 15-20 minutes
aws eks update-kubeconfig --name devboard --region us-west-2
```

**You know it worked when:**

```bash
kubectl get nodes                    # 3 Ready
kubectl get storageclass             # gp3 (default) — no kubectl patch needed
kubectl -n kube-system get pods | grep -E 'ebs-csi|metrics-server|pod-identity'
kubectl -n argocd get pods           # Terraform installed ArgoCD too — see §7
terraform output
```

> ⚠️ Terraform created the Secrets Manager secret's **name**, not its **value**.
> That is §4, and nothing will start without it.

## 4. Set the database password

→ why: [gitops/06-secrets-with-secrets-manager.md](gitops/06-secrets-with-secrets-manager.md)

```bash
PGPASS=$(openssl rand -hex 32)

aws secretsmanager put-secret-value \
  --secret-id devboard/postgres \
  --region us-west-2 \
  --secret-string "$(jq -nc --arg p "$PGPASS" \
      '{username:"devboard", password:$p, dbname:"devboard"}')"
```

**You know it worked when** this prints the three keys without printing the password:

```bash
aws secretsmanager get-secret-value --secret-id devboard/postgres \
  --region us-west-2 --query SecretString --output text | jq 'keys'
# ["dbname","password","username"]
```

> Hex, not base64: the value goes into a `postgres://` DSN, and base64's `/` and
> `+` would need URL-encoding.

## 5. Push your branch

```bash
git add -A && git commit -m "point argocd at my fork"
git push -u origin mega-project
```

**You know it worked when:**

```bash
git ls-remote --exit-code --heads origin mega-project && echo OK
git log origin/mega-project..HEAD --oneline        # empty
```

> ArgoCD reads GitHub, not your laptop. An unpushed commit is invisible to it,
> and the symptom is a confusing `ComparisonError` (§16.4).

---

### ══ HARD GATE ══

All five must pass before you continue. They are exactly what `scripts/deploy.sh`
checks before it does anything.

```bash
kubectl config current-context | grep devboard
kubectl get nodes --no-headers | wc -l                                        # 3
git ls-remote --exit-code --heads origin "$(git rev-parse --abbrev-ref HEAD)"
aws secretsmanager get-secret-value --secret-id devboard/postgres \
  --region us-west-2 >/dev/null && echo secret-ok
grep -rn 'repoURL: https://github.com' gitops/argocd | grep -vc "$GH_USER"    # 0
```

If all five pass, nothing downstream can fail for a trivial reason. You can
either keep reading, or jump to **§17** and let the script do §6–§9 for you.

---

## 6. Install Envoy Gateway

→ why: [gitops/04-gateway-api.md](gitops/04-gateway-api.md)

```bash
helm upgrade --install eg oci://docker.io/envoyproxy/gateway-helm \
  --version v1.2.1 \
  -n envoy-gateway-system --create-namespace \
  --wait --timeout 10m

kubectl apply -f gitops/gateway/gatewayclass.yaml
```

**You know it worked when:**

```bash
kubectl -n envoy-gateway-system rollout status deploy/envoy-gateway
kubectl get gatewayclass envoy                      # ACCEPTED: True
kubectl get crd | grep gateway.networking.k8s.io    # gateways, httproutes, ...
```

> This is also what installs the Gateway API CRDs, so it must come before
> anything that declares a `Gateway`, an `EnvoyProxy`, or cert-manager.
> `upgrade --install` rather than `install`, so re-running is safe.

## 7. Log in to ArgoCD

→ why: [gitops/05-argocd.md](gitops/05-argocd.md)

There is no install step. Terraform did it in §3.

```bash
helm list -n argocd        # argocd, chart argo-cd-10.3.0, deployed
kubectl -n argocd get pods

kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo

kubectl -n argocd port-forward svc/argocd-server 8080:80
```

Open <http://localhost:8080>, user `admin`.

> ⚠️ Do **not** run `helm install argocd`. Helm refuses with *"cannot re-use a
> name that is still in use."* If you would rather install it by hand, set
> `enable_argocd = false` in `terraform/terraform.tfvars` **before** §3.

## 8. Install the platform

→ why: [gitops/06-secrets-with-secrets-manager.md](gitops/06-secrets-with-secrets-manager.md) · [gitops/11-observability.md](gitops/11-observability.md)

One Application creates all the rest.

```bash
kubectl apply -f gitops/argocd/platform.yaml
```

They arrive in **sync waves**:

| Wave | What |
| --- | --- |
| 0 | External Secrets Operator, cert-manager |
| 1 | ClusterSecretStore, ClusterIssuers, Prometheus, Tempo, Loki |
| 2 | OTel Collector agent + gateway |
| 3 | Grafana |
| 4 | observability config + dashboards |
| 5 | Ollama |

**You know it worked when:**

```bash
kubectl -n argocd get applications          # 14: platform + 13 children
kubectl -n external-secrets rollout status deploy/external-secrets --timeout=8m
kubectl -n cert-manager rollout status deploy/cert-manager --timeout=8m
kubectl get clustersecretstore aws-secrets-manager    # STATUS: Valid
kubectl -n observability get pods
```

> **Do not continue until `ClusterSecretStore` reads `Valid`.** That one check
> proves region place #4, the Pod Identity association and the IAM policy all at
> once — about ten minutes before the alternative symptom
> (`CreateContainerConfigError`) would tell you the same thing.

## 9. Deploy the app

→ why: [gitops/07-deploy-without-helm.md](gitops/07-deploy-without-helm.md)

```bash
kubectl apply -f gitops/argocd/devboard-raw.yaml
kubectl -n devboard get pods -w
```

**You know it worked when:**

```bash
kubectl -n devboard get externalsecret devboard-secrets      # SecretSynced
kubectl -n devboard get secret devboard-secrets -o jsonpath='{.data}' | jq 'keys'
#   ["POSTGRES_DB","POSTGRES_PASSWORD","POSTGRES_URL","POSTGRES_USER"]
kubectl -n devboard get pvc                                  # Bound, not Pending
kubectl -n devboard wait --for=condition=available --timeout=10m \
  deploy/devboard-backend-deployment deploy/devboard-frontend-deployment
```

> ⚠️ Pods sitting in `CreateContainerConfigError` for the first 30–60 seconds is
> **expected** — they start before ESO has produced the Secret, and self-heal.
> Only worry after about two minutes (§16.1).

## 10. Public URL and smoke test

```bash
ADDR=$(kubectl -n devboard get gateway devboard-gateway \
        -o jsonpath='{.status.addresses[0].value}')
echo "$ADDR"           # takes 2-3 min to appear

curl -s -o /dev/null -w '%{http_code}\n' "http://$ADDR/"      # 200
curl -s "http://$ADDR/api/projects" | jq '.[0]'
```

Open `http://$ADDR/` in a browser. **Keep `$ADDR`** — §12 needs it.

> The load balancer is an AWS **Classic ELB**: no manifest sets
> `service.beta.kubernetes.io/aws-load-balancer-type`, so it gets the EKS
> default. It gives you a hostname, never a stable IP, which is why §12 uses a
> CNAME.

## 11. Wake up the AI assistant

→ why: [gitops/10-ai-feature.md](gitops/10-ai-feature.md)

```bash
kubectl -n ollama get pvc ollama-models                       # Bound
kubectl -n ollama rollout status deploy/ollama --timeout=15m  # pulls ~1.3 GB
kubectl -n ollama exec deploy/ollama -- ollama list           # llama3.2:1b

curl -s "http://$ADDR/api/ai/health" | jq
curl -N -X POST "http://$ADDR/api/ai/ask" \
  -H 'content-type: application/json' \
  -d '{"project_id":"1","question":"what is blocked?"}'
```

**You know it worked when** tokens stream back. That request also puts a real
trace in Tempo for §13.

---

## 12. HTTPS on your own domain

→ why: [gitops/04-gateway-api.md](gitops/04-gateway-api.md)

Order matters here. The DNS record cannot exist before the load balancer does,
and the certificate cannot be issued before DNS resolves.

### 12.1 Get the load balancer hostname

```bash
ADDR=$(kubectl -n devboard get gateway devboard-gateway \
        -o jsonpath='{.status.addresses[0].value}')
echo "$ADDR"
```

### 12.2 Create the CNAME (manual, at GoDaddy)

In the DNS panel for `trainwithshubham.com`:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| CNAME | `devboard` | the `$ADDR` from 12.1 | 600 |

It must be a **CNAME**, not an A record: AWS gives a hostname whose addresses
rotate without warning.

**You know it worked when — and do not continue until it does:**

```bash
dig +short @8.8.8.8 devboard.trainwithshubham.com
curl -s -o /dev/null -w '%{http_code}\n' http://devboard.trainwithshubham.com/   # 200
```

> ⚠️ A `403` here means the frontend image predates the `preview.allowedHosts`
> fix in `frontend/vite.preview.config.js`. Vite rejects Host headers it does not
> recognise, and the pods still look healthy because kubelet's probes use the pod
> IP. Let CI rebuild and bump the image first.
>
> ⚠️ Let's Encrypt allows only **5 authorization failures per hostname per hour**,
> with no override. Getting DNS right first is what keeps you out of that.

### 12.3 cert-manager and the issuers

Already installed by §8, wave 0 and 1. Verify:

```bash
kubectl -n cert-manager rollout status deploy/cert-manager
kubectl get clusterissuer          # letsencrypt-staging, letsencrypt-prod: READY True

# The switch that makes the Gateway API solver work at all. The chart passes it
# through --config, not as a CLI flag, so read the ConfigMap:
kubectl -n cert-manager get cm cert-manager -o jsonpath='{.data.config\.yaml}'
# apiVersion: controller.config.cert-manager.io/v1alpha1
# gatewayAPI:
#   enabled: true
# kind: ControllerConfiguration
```

If that flag is missing, cert-manager booted before the Gateway API CRDs existed.
It only checks at startup:

```bash
kubectl -n cert-manager rollout restart deploy cert-manager
```

### 12.4 Issue against staging first

`k8s/certificate.yml` ships pointing at `letsencrypt-staging`. Leave it there for
the first run.

```bash
git add k8s/certificate.yml && git commit -m "request tls certificate" && git push
kubectl -n argocd annotate app devboard-raw argocd.argoproj.io/refresh=hard --overwrite
kubectl -n devboard get certificate devboard-tls -w      # READY True, ~60-90s
```

> ⚠️ `devboard-raw` syncs with `selfHeal: true`. **Commit and push — never
> `kubectl apply`.** An applied change is reverted within about three minutes.

Watch the machinery if it stalls:

```bash
kubectl -n devboard get certificate,certificaterequest,order,challenge
kubectl -n devboard get httproute -l acme.cert-manager.io/http01-solver=true

TOKEN=$(kubectl -n devboard get challenge -o jsonpath='{.items[0].spec.token}')
curl -s "http://devboard.trainwithshubham.com/.well-known/acme-challenge/$TOKEN"
# the key authorization string — not HTML, not a 301
```

### 12.5 Switch to production

Edit `k8s/certificate.yml`, change `issuerRef.name` to `letsencrypt-prod`, commit,
push. Then force re-issue:

```bash
kubectl -n devboard delete secret devboard-tls
kubectl -n devboard get certificate devboard-tls -w
```

**You know it worked when the issuer is real, not staging:**

```bash
kubectl -n devboard get secret devboard-tls -o jsonpath='{.data.tls\.crt}' \
  | base64 -d | openssl x509 -noout -issuer -dates
# issuer=C=US, O=Let's Encrypt, ...   NOT  CN=(STAGING) ...
```

### 12.6 Turn on the HTTPS listener

The `:443` listener is already in `k8s/gateway.yml`. Once the Secret exists it
goes green on the next sync.

```bash
kubectl -n devboard get gateway devboard-gateway \
  -o jsonpath='{range .status.listeners[*]}{.name}{"\t"}{range .conditions[*]}{.type}={.status}{" "}{end}{"\n"}{end}'
# http   Accepted=True ResolvedRefs=True Programmed=True
# https  Accepted=True ResolvedRefs=True Programmed=True
```

**You know it worked when:**

```bash
curl -sI https://devboard.trainwithshubham.com/ | head -1
curl -s https://devboard.trainwithshubham.com/api/projects | jq '.[0]'
```

### 12.7 Redirect HTTP to HTTPS

```bash
git add k8s/httproute-redirect.yml && git commit -m "redirect http to https" && git push
```

**You know it worked when the domain redirects but the raw URL still does not:**

```bash
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' http://devboard.trainwithshubham.com/
# 301 -> https://devboard.trainwithshubham.com/

curl -s -o /dev/null -w '%{http_code}\n' "http://$ADDR/"     # 200, not 301
```

Renewal is automatic at 60 days. Nothing to do.

---

## 13. Where to see the OpenTelemetry data

→ why: [gitops/11-observability.md](gitops/11-observability.md) · [12-instrumentation.md](gitops/12-instrumentation.md) · [13-debug-with-traces.md](gitops/13-debug-with-traces.md)

Everything lives in the `observability` namespace.

### 13.1 Open Grafana

```bash
kubectl -n observability port-forward svc/observability-grafana 3000:80
```

<http://localhost:3000> — **`admin` / `devboard`**.

It is a ClusterIP, not a LoadBalancer, on purpose: a LoadBalancer here is a third
billed load balancer in front of an admin console with a known password. Also
`persistence.enabled=false`, so anything you draw in the UI is gone on restart —
dashboards come from Git.

### 13.2 The three datasources

| Name | URL | Notes |
| --- | --- | --- |
| Prometheus | `prometheus-operated.observability:9090` | default; exemplars link to Tempo |
| Loki | `loki.observability:3100` | extracts `trace_id`, giving a "View trace" button |
| Tempo | `tempo.observability:**3200**` | 3200 is the query API. **4317 is OTLP ingest** — using it gives a datasource that saves fine and returns nothing. |

The Tempo datasource's `tracesToLogsV2` / `tracesToMetrics` / `serviceMap` config
is what makes trace → log → metric navigation work.

### 13.3 The dashboards

Folder **DevBoard**, provisioned from Git:

| Dashboard | Shows |
| --- | --- |
| DevBoard AI — RED | rate / errors / p50-p95-p99, derived from spans rather than metrics code, next to the app's own counter |
| Ollama health | PVC Pending, CPU throttling, restarts, memory vs limit |

Folder **Community**: node-exporter (1860) and kube-state (13332).

### 13.4 Prove data is flowing

```bash
# 1. generate traffic
curl -s "http://$ADDR/api/projects" >/dev/null

# 2. traces — Explore -> Tempo -> Search, service.name = backend / ai-service / envoy

# 3. metrics — Prometheus targets
kubectl -n observability port-forward svc/prometheus-operated 9090:9090
#    http://localhost:9090/targets -> devboard-backend, devboard-ai-service UP

# 4. logs — Explore -> Loki -> {k8s_namespace_name="devboard"}
kubectl -n observability logs deploy/otel-collector-gateway | grep -i loki

# 5. the whole pipeline — Explore -> Tempo -> Service Graph
```

### 13.5 What emits what

| Emitter | How | Wire |
| --- | --- | --- |
| Envoy Gateway | `EnvoyProxy` CRD, 100% sampling — becomes the trace **root** | gRPC 4317 |
| backend (Go) | manual OTel SDK (`backend/tracing.go`) | gRPC 4317 |
| ai-service (Python) | zero-code `opentelemetry-instrument` | HTTP 4318 |
| frontend (React) | **not instrumented** — traces start at the Gateway | — |
| every node | DaemonSet agent reads `/var/log/pods` + host metrics | → gateway |

Pipeline: apps → `otel-collector-gateway` → Tempo (traces) + Loki (logs) +
Prometheus remote-write (metrics, including the spanmetrics connector).

> ⚠️ `observability-config` attaches an `EnvoyProxy` to the **GatewayClass**, so a
> bad sync there takes the public URL down with it. Rollback:
> ```bash
> kubectl patch gatewayclass envoy --type=json -p '[{"op":"remove","path":"/spec/parametersRef"}]'
> ```

---

## 14. Optional extras

**The second stack (Helm)** — → [gitops/09-deploy-with-helm.md](gitops/09-deploy-with-helm.md)

```bash
kubectl apply -f gitops/argocd/devboard-helm.yaml     # namespace devboard-helm
ADDR2=$(kubectl -n devboard-helm get gateway -o jsonpath='{.items[0].status.addresses[0].value}')
```

⚠️ Costs a second load balancer, ~$17/mo. Deliberately commented out in
`scripts/deploy.sh`.

**CI/CD** — → [gitops/14-cicd.md](gitops/14-cicd.md). Push to `mega-project` and
the pipeline builds, scans, pushes images and commits the new tag back; ArgoCD
syncs it. Needs GitHub variable `DOCKERHUB_USERNAME` and secrets
`DOCKERHUB_TOKEN`, `SONAR_TOKEN`, `SONAR_HOST_URL`.

---

## 15. Tear it all down

→ why: [gitops/15-cleanup.md](gitops/15-cleanup.md)

**Terraform did not create the load balancers or the EBS volumes, so
`terraform destroy` does not know they exist.** Skipping steps 1–3 below costs
about 40 minutes of `DependencyViolation` retries.

```bash
# 1. stop ArgoCD managing anything
kubectl delete -f gitops/argocd/platform.yaml
kubectl delete -f gitops/argocd/devboard-raw.yaml --ignore-not-found
kubectl delete -f gitops/argocd/devboard-helm.yaml --ignore-not-found
kubectl -n argocd get applications            # wait until empty

# 2. delete the namespaces — THIS is what stops the billing
kubectl delete namespace devboard devboard-helm ollama observability \
                         external-secrets cert-manager --ignore-not-found

# 3. all three must be empty before going further
kubectl -n envoy-gateway-system get svc       # no LoadBalancer
kubectl get gateway -A                        # empty
kubectl get pvc -A                            # empty

# 4. remove Envoy Gateway
helm uninstall eg -n envoy-gateway-system

# 5. drop ArgoCD from Terraform state FIRST.
#    helm_release.argocd has create_namespace=true, so destroy otherwise blocks
#    forever on the argocd namespace waiting for Application finalizers.
cd terraform
terraform state rm 'helm_release.argocd[0]'
terraform state rm 'kubernetes_storage_class_v1.gp3'
kubectl delete namespace argocd --ignore-not-found

# 6. confirm no orphans are left to stall the VPC delete
VPC=$(terraform output -raw vpc_id)
aws ec2 describe-security-groups --region us-west-2 \
  --filters Name=vpc-id,Values=$VPC Name=group-name,Values='k8s-elb-*' \
  --query 'SecurityGroups[].GroupId' --output text          # must be empty
aws elb describe-load-balancers --region us-west-2 \
  --query "LoadBalancerDescriptions[?VPCId=='$VPC'].LoadBalancerName" --output text
aws elbv2 describe-load-balancers --region us-west-2 \
  --query "LoadBalancers[?VpcId=='$VPC'].LoadBalancerName" --output text
# delete anything listed, then continue

terraform destroy        # ~15 min

# 7. PVC-created EBS volumes survive and keep billing
aws ec2 describe-volumes --region us-west-2 \
  --filters Name=status,Values=available \
  --query 'Volumes[].[VolumeId,Size,Tags[?Key==`CSIVolumeName`].Value|[0]]' --output table
# for each: aws ec2 delete-volume --region us-west-2 --volume-id vol-xxxx

# 8. the state bucket, last
cd bootstrap && terraform destroy
```

**Nothing is billing when all four are empty:**

```bash
aws eks list-clusters --region us-west-2
aws ec2 describe-volumes --region us-west-2 --filters Name=status,Values=available --query 'Volumes[].VolumeId'
aws elb describe-load-balancers --region us-west-2 --query 'LoadBalancerDescriptions[].LoadBalancerName'
aws secretsmanager list-secrets --region us-west-2 --query 'SecretList[].Name'
```

Finally, **delete the `devboard` CNAME at GoDaddy.** A CNAME pointing at a
released AWS hostname is a subdomain-takeover risk.

---

## 16. Troubleshooting

### 16.1 Pods in `CreateContainerConfigError`

Normal for the first ~60 seconds. A bug only if it persists past two minutes.

```bash
kubectl -n devboard get externalsecret devboard-secrets      # want SecretSynced
kubectl -n devboard describe externalsecret devboard-secrets | tail -20
kubectl get clustersecretstore aws-secrets-manager -o yaml | grep -A5 status
kubectl -n external-secrets logs deploy/external-secrets --tail=50
```

Ranked causes: §4 never run; region place #4 wrong (`ResourceNotFoundException`
on a secret you can see in the console); Pod Identity association missing
(`AccessDeniedException`).

### 16.2 PVC stuck `Pending`

```bash
kubectl get pvc -A
kubectl -n ollama describe pvc ollama-models | tail -20
kubectl get storageclass                                     # gp3 must be (default)
```

Either no default StorageClass (`terraform apply` did not finish), or
`WaitForFirstConsumer` waiting on an unschedulable pod — in which case the real
error is on the pod, not the PVC.

### 16.3 `ImagePullBackOff`

```bash
kubectl -n devboard describe pod <pod> | grep -A5 Events
```

Docker Hub anonymous rate limit, or a `sha-<short>` tag from a CI run whose build
never pushed. The upstream `trainwithshubham/*` images are public and pull fine.

### 16.4 ArgoCD `ComparisonError` / app stuck `Unknown`

```bash
kubectl -n argocd get app devboard-raw -o jsonpath='{.status.conditions}' | jq
kubectl -n argocd logs deploy/argocd-repo-server --tail=50
```

In order: branch not pushed (§5); `repoURL` still upstream (§0.3);
`targetRevision` names a branch your fork does not have. After fixing:

```bash
kubectl -n argocd annotate app <name> argocd.argoproj.io/refresh=hard --overwrite
```

### 16.5 Gateway has no address after 5 minutes

```bash
kubectl -n devboard describe gateway devboard-gateway | tail -20
kubectl get gatewayclass envoy -o yaml | grep -A5 status
kubectl -n envoy-gateway-system logs deploy/envoy-gateway --tail=50
```

Most common: the `EnvoyProxy` from `observability-config` made the GatewayClass
`Accepted=False` — patch out `parametersRef` (§13.5). Second: public subnets
missing the `kubernetes.io/role/elb` tag.

### 16.6 Certificate stuck, or HTTPS not working

```bash
kubectl -n devboard describe certificate devboard-tls
kubectl -n devboard describe challenge
kubectl -n cert-manager logs deploy/cert-manager --tail=100 | grep -i devboard
dig +short @8.8.8.8 devboard.trainwithshubham.com
```

Ranked causes:

- **DNS not propagated** — wait, re-check `dig`.
- **Challenge `pending` forever** — `--enable-gateway-api` missing (§12.3).
- **Solver route rejected** — `Accepted=False / NotAllowedByListeners` means the
  Certificate is not in the `devboard` namespace, so its solver HTTPRoute landed
  somewhere the Gateway will not accept.
- **The challenge URL returns 301** — the redirect beat the solver. Remove
  `k8s/httproute-redirect.yml` from Git, get the cert, put it back.
- **`rateLimited`** — you retried against prod. Wait an hour, use staging.
- **`NET::ERR_CERT_AUTHORITY_INVALID` in a browser** — still on staging (§12.5).

### 16.7 Nothing you change sticks

Every stack runs `selfHeal: true`. `kubectl edit` and `kubectl patch` on anything
in `k8s/` are reverted within about three minutes. Commit and push instead. The
one safe imperative action is `kubectl delete secret devboard-tls` — cert-manager
owns that Secret, so ArgoCD does not restore it.

---

## 17. The shortcut: `scripts/deploy.sh`

Once §0–§5 are done and the HARD GATE passes, one command does **§6, §8 and §9**:

```bash
./scripts/deploy.sh
```

It re-runs the same five preflight checks and exits non-zero if any fail. Every
step inside is idempotent (`helm upgrade --install`, `kubectl apply`), so it is
safe to re-run after fixing whatever it complained about.

**It does not do:** §1–§5 (Terraform, the secret value, the git push), §12
(TLS and DNS), the second Helm stack, or teardown.

Use Deploy.md the first time so you know what it is doing. Use the script the
second time.
