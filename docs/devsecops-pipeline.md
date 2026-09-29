# DevBoard enterprise DevSecOps pipeline

The canonical pipeline is `.github/workflows/pipeline.yml`. Its stages are
implemented as separate reusable workflows: `ci-policy-security.yml`,
`ci-app-validation.yml`, `container-release.yml`, `deploy-staging.yml`,
`deploy-production.yml`, and `rollback-production.yml`. It
preserves the existing frontend/backend parallel build and test model, then
promotes the same signed, immutable image through staging and production.

## Flow

```text
PR / push / release tag / manual dispatch
  -> policy + CODEOWNERS + commit validation
  -> [secret scan | SAST | SCA | IaC/config | frontend quality+build+tests | backend quality+build+tests]
  -> [frontend image | backend image] build + Hadolint + Trivy + SPDX SBOM
  -> sign + publish SHA-tagged images
  -> staging + health/smoke + E2E hook + OWASP ZAP DAST
  -> protected production environment approval
  -> deploy the exact images tested in staging
  -> post-deploy validation and restore of the previous known-good release
```

Pull requests run quality and security gates but do not publish or deploy.
Pushes to `development` and `staging` publish and deploy staging. A protected
`main` or `vX.Y.Z` tag can promote to production after required reviewers
approve the `production` environment. Manual dispatch supports production
promotion and emergency rollback.

## Required GitHub controls

Protect `development`, `staging`, and `main`: require pull requests, two
approvals for production-bound changes, CODEOWNER review, conversation
resolution, signed commits where available, and a successful
`Enterprise DevSecOps` check. Restrict production environment approvers and
prevent self-approval. Enable GitHub secret scanning and push protection.

Required repository/environment values are `DOCKERHUB_USERNAME`, `STAGING_URL`,
and `PRODUCTION_URL`; the required secret is `DOCKERHUB_TOKEN`. Prefer GitHub
OIDC to AWS over long-lived cloud keys. The staging/production deployment host
should fetch its environment-specific secrets from AWS Secrets Manager or SSM
Parameter Store into a root-owned, non-world-readable env file. CI must never
write secret values to artifacts or logs.

`POSTGRES_URL`, database credentials, JWT/API keys, registry credentials, and
cloud credentials belong only in the relevant environment secret store. The
committed `.env.example` is documentation only and must never contain a real
credential.

## Gates and severity policy

- Secret detection: any confirmed secret fails, including Git history. Revoke
  and rotate a leaked credential before rerunning.
- SAST and image scanning: CRITICAL fails; HIGH fails for production-bound
  changes; MEDIUM is tracked with an owner; LOW is informational.
- Dependency/license scanning: HIGH/CRITICAL vulnerabilities fail; exceptions
  require an expiry, owner, rationale, and compensating control.
- Frontend and backend unit tests remain parallel. Set the coverage floor to
  80% by default; it can be configured with the repository variable
  `MIN_BACKEND_COVERAGE`. Publish JUnit/coverage artifacts with the release.

The current application has no authentication or migration framework. Before
a real production rollout, add authentication/authorization and versioned
migrations (for example Goose, Atlas, or Flyway). The existing SQL init files
are suitable for local bootstrap, not destructive production migrations.

## Deployment, migration, and rollback

`scripts/deploy-compose.sh` snapshots the host's previous env/image references,
pulls the already-published SHA-tagged images, starts them without rebuilding,
and checks the backend health endpoint. A failed deployment restores the
snapshot. Rollback is a promotion of the previous known-good image, never a
rebuild.

Use expand/contract migrations: add nullable columns/tables and compatible
indexes first; deploy code that can read both schemas; backfill asynchronously;
switch reads/writes; remove old columns only in a later release. Take and
verify a database backup before production migration. Never combine an
irreversible schema drop with an application rollout.

Compose is the current rolling-replacement baseline. For a multi-instance
platform, use blue/green or canary traffic shifting with automatic rollback on
5xx, latency, restart, or smoke-test thresholds.

## Operations after deployment

Instrument the Go API and frontend gateway with OpenTelemetry and export
metrics/logs/traces to the selected platform (CloudWatch, Prometheus/Grafana,
Loki/ELK, and an OTEL collector are compatible choices). Alert on availability,
5xx rate, p95/p99 latency, CPU/memory/disk, database health, container
restarts, certificate expiry, and newly disclosed image/dependency
vulnerabilities. Retain the Git SHA, workflow run, release tag, image digest,
SBOM, approval, migration version, and rollback event for every release.

This repository currently has no Terraform, CloudFormation, or Kubernetes
infrastructure to scan. If infrastructure code is added, re-enable a dedicated
IaC scan using Checkov/Trivy before provisioning. If the target moves to Kubernetes, add Pod Security Standards, non-root
security contexts, resource limits, probes, NetworkPolicy, least-privilege
RBAC, admission signature verification, and Trivy/Checkov scans. This repo
currently has no Kubernetes manifests to scan or deploy.
