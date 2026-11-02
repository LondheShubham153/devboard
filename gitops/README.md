# DevBoard on EKS — the mega project

Take a small 3-tier app (React + Go + Postgres) all the way to production shape
on AWS: infrastructure as code, GitOps delivery, a real secret store, and
distributed tracing you can actually debug with.

You'll build:

- **EKS via Terraform** — the VPC, subnets, NAT and IAM that `eksctl` used to
  hide from you, with remote state in S3
- **Envoy Gateway** for a public URL (Gateway API → AWS NLB)
- **ArgoCD** deploying the app from Git — **two ways**, raw manifests (`k8s/`)
  and a Helm chart (`helm/devboard/`), side by side so you can compare them
- **AWS Secrets Manager + External Secrets Operator** — no credentials in Git,
  and no access keys anywhere
- **An AI Assistant** — a self-hosted model (Ollama) that summarises your tasks
- **OpenTelemetry** — traces, metrics and logs, instrumented three different
  ways, ending in a chapter where you break things and find them

## Architecture

```
Internet ─▶ Envoy Gateway (NLB) ─┬─ /           ─▶ frontend ─▶ /api ─▶ backend ─▶ postgres
                                 └─ /api/ai/*   ─▶ ai-service ─▶ Ollama

AWS Secrets Manager ─▶ External Secrets Operator ─▶ Secret ─▶ backend + postgres

everything ──OTLP──▶ OpenTelemetry Collector ─┬─▶ Tempo      (traces)
                                              ├─▶ Loki       (logs)
                                              └─▶ Prometheus (metrics) ─▶ Grafana
```

## Steps

> Want it running first and the theory after? [`../Deploy.md`](../Deploy.md) is
> the same path as a flat command runbook, with no explanations in the way.

**Part 1 · Foundations**

| # | File | What |
|---|------|------|
| 1 | [01-prerequisites.md](01-prerequisites.md) | Tools, AWS credentials, the region checklist |
| 2 | [02-terraform-bootstrap.md](02-terraform-bootstrap.md) | Remote state, and the chicken-and-egg |
| 3 | [03-provision-eks.md](03-provision-eks.md) | The cluster — and the VPC eksctl hid |

**Part 2 · Platform**

| # | File | What |
|---|------|------|
| 4 | [04-gateway-api.md](04-gateway-api.md) | Envoy Gateway, for a public URL |
| 5 | [05-argocd.md](05-argocd.md) | ArgoCD |
| 6 | [06-secrets-with-secrets-manager.md](06-secrets-with-secrets-manager.md) | Get the password out of Git |

**Part 3 · The application**

| # | File | What |
|---|------|------|
| 7 | [07-deploy-without-helm.md](07-deploy-without-helm.md) | Deploy from raw manifests |
| 8 | [08-package-with-helm.md](08-package-with-helm.md) | Tour the Helm chart |
| 9 | [09-deploy-with-helm.md](09-deploy-with-helm.md) | Deploy from the chart |
| 10 | [10-ai-feature.md](10-ai-feature.md) | Add the AI Assistant |

**Part 4 · Operating it**

| # | File | What |
|---|------|------|
| 11 | [11-observability.md](11-observability.md) | Deploy the OpenTelemetry stack |
| 12 | [12-instrumentation.md](12-instrumentation.md) | Three ways to instrument, compared |
| 13 | [13-debug-with-traces.md](13-debug-with-traces.md) | Break things on purpose and find them |
| 14 | [14-cicd.md](14-cicd.md) | CI/CD (GitHub Actions → Git → ArgoCD) |
| 15 | [15-cleanup.md](15-cleanup.md) | Tear it all down, in the right order |

## Cost

**This is not a free-tier project. Budget ~$330/month, or about $11/day.**

| Item | Monthly |
|---|---|
| EKS control plane | $73 |
| 3 × t3.large | $182 |
| NAT Gateway (one, not three) | $33 |
| NLB per Gateway | $17 (×2 if you run both stacks) |
| EBS — nodes, Postgres, Ollama, Prometheus/Tempo/Loki | $11 |
| CloudWatch logs (audit + authenticator, 7-day retention) | $2–8 |
| KMS key for EKS envelope encryption | $1 |
| Secrets Manager + S3 state | <$1 |

Biggest lever if that is too much: `node_desired_size = 2` in
`terraform/terraform.tfvars` saves ~$61/month — but then run only one DevBoard
stack, not both.

Deliberately **not** enabled, each one variable away: VPC flow logs, ECR
enhanced scanning, an ArgoCD `LoadBalancer` Service (+$17/mo — use
`port-forward`), and ECR interface VPC endpoints (+$15/mo, which only pays for
itself at production traffic volumes).

**Do [15-cleanup.md](15-cleanup.md) when you're done.** Steps 2 and 3 there are
the ones that actually stop the billing.

## Layout

```
terraform/                   the cluster, IAM, state — replaces eksctl
terraform/bootstrap/         the S3 state bucket (local state, run once)
gitops/gateway/              GatewayClass
gitops/argocd/               ArgoCD Applications
gitops/argocd/platform/      the app-of-apps: ESO, observability, Ollama
gitops/external-secrets/     ClusterSecretStore
gitops/observability/        Collector configs, chart values, dashboards, alerts
gitops/ollama/               shared in-cluster model server
helm/devboard/               the Helm chart
k8s/                         raw manifests
ai-service/                  the AI microservice (Python/Flask)
backend/                     the Go API (see tracing.go)
```

## A note on what's deliberately broken

Two things in this repo are wrong on purpose, and both are teaching material:

- **`ai_service_requests_total`** increments before the response streams, so it
  reports `200` forever and can never see a failure. Chapter 12 puts it on a
  dashboard next to the truth.
- **The `/api/projects` trace has a small unexplained gap.** Chapter 13 asks you
  to find out what's in it.
