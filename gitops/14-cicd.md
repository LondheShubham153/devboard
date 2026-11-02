# 14 — CI/CD (pure GitOps)

GitHub is the single source of truth. A code change runs the pipeline, which
builds images and **commits the new image tag into the manifests**. ArgoCD sees
that commit and deploys. CI never touches the cluster.

```
push code to mega-project ─▶ GitHub Actions (DevSecOps)
   gates: lint · tests · gitleaks · dep-scan · trivy · sonar
      └▶ build & push  trainwithshubham/devboard-{backend,frontend,ai-service}:sha-<short>
           └▶ gitops-bump: write that tag into k8s/ + helm/values.yaml, commit back
                └▶ ArgoCD (watches mega-project) syncs to EKS
push manifest-only ─▶ no build (path filter) ─▶ ArgoCD syncs
```

## Workflows

| File | Role |
|------|------|
| `devsecops.yml` | orchestrator — triggers, gates, build, bump |
| `code-quality.yml` / `code-tests.yml` | lint + unit tests (backend, frontend, ai-service) |
| `secret-scanning.yml` / `dependency-scan.yml` / `docker-scans.yml` / `sonar-scan.yml` | security & quality gates |
| `docker-push.yml` | build + push the 3 images, tagged `sha-<short>` (+ `:latest`) |
| `gitops-bump.yml` | write the tag into manifests, commit back to `mega-project` |
| `dast.yml` | OWASP ZAP — **manual** (`workflow_dispatch`), pass the NLB URL |

## No infinite loop

The bump commit only touches `k8s/` + `helm/`, which are **not** in the push
`paths:` filter; commits made with `GITHUB_TOKEN` don't trigger workflows; and the
message carries `[skip ci]`. Three independent safety nets.

## Required GitHub config (Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|------|------|-------|
| Variable | `DOCKERHUB_USERNAME` | **`trainwithshubham`** (must match the image owner in the manifests) |
| Secret | `DOCKERHUB_TOKEN` | Docker Hub access token with **Read & Write** |
| Secret | `SONAR_TOKEN` | a SonarCloud token |
| Secret | `SONAR_HOST_URL` | `https://sonarcloud.io` |

`GITHUB_TOKEN` is built in. No `EC2_HOST` and no self-hosted runner anymore.

### SonarCloud setup (one-time)

1. Sign in at https://sonarcloud.io with GitHub, create an **organization**, and
   **import** this repo (creates the project).
2. Copy the **organization key** and **project key** into
   `sonar-project.properties` (`sonar.organization`, `sonar.projectKey`).
3. Generate a token (My Account → Security) and set the secrets:
   ```bash
   gh secret set SONAR_TOKEN --body '<sonarcloud-token>'
   gh secret set SONAR_HOST_URL --body 'https://sonarcloud.io'
   ```

## See it work

1. Change something in `backend/`, `frontend/`, or `ai-service/`; push to `mega-project`.
2. **Actions** tab → the run passes the gates and pushes 3 `sha-<short>` images.
3. A commit `ci: deploy sha-… [skip ci]` appears on `mega-project`.
4. ArgoCD syncs; confirm the live tag:
   ```bash
   kubectl -n devboard get deploy devboard-backend-deployment \
     -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
   ```

To run DAST: **Actions → OWASP ZAP DAST Scan → Run workflow**, enter
`http://<nlb-hostname>/`.
