# DevBoard

A small task tracker (projects, tasks, a kanban board, and an AI assistant) built
to teach the full path from `docker compose up` to production on AWS: GitOps,
Terraform, secrets, observability and a DevSecOps pipeline.

It is deliberately small. The point is to *see how the pieces connect*, not to
build a big product. There is no login and no cache.

| Piece | Tech |
| --- | --- |
| Frontend | React 18, Vite, Tailwind, React Query |
| Backend | Go (Gin), Postgres via `database/sql` + `lib/pq` |
| AI service | Python 3.13, Flask + gunicorn, streams answers over SSE |
| Model | Ollama running `llama3.2:1b` (self-hosted, no API key) |
| Database | Postgres 16 |
| Cluster | EKS 1.34 built with Terraform, Envoy Gateway (Gateway API) |
| Delivery | GitHub Actions, Docker Hub, Argo CD (GitOps), Helm or raw manifests |
| Secrets | AWS Secrets Manager + External Secrets Operator, Pod Identity |
| Observability | OpenTelemetry Collector, Tempo, Loki, Prometheus, Grafana |

## Architecture

![DevBoard architecture: build and ship, platform, runtime on EKS, observe](docs/architecture.png)

Read the four lanes left to right:

1. **Build and ship:** a push to GitHub triggers GitHub Actions (lint, tests,
   Gitleaks, Trivy, SonarQube). Images go to Docker Hub, and a bot commit writes
   the new `sha-` tag back to Git. CI never touches the cluster.
2. **Platform:** Terraform creates the VPC and the EKS cluster (state in S3).
   Argo CD watches Git and deploys into EKS.
3. **Runtime on EKS:** the browser reaches the Envoy Gateway through an AWS load
   balancer (a Classic ELB). `/` goes to the React frontend, which calls the Go
   backend and Postgres. `/api/ai/*` goes to the Python AI service, which reads
   tasks from the backend and prompts Ollama. External Secrets feeds the passwords
   from AWS Secrets Manager, so none live in Git.
4. **Observe:** the backend and AI service send OTLP to the OpenTelemetry
   Collector, and the Gateway forwards the browser's and Envoy's traces to it. The
   Collector feeds Tempo, Loki and Prometheus, all viewed in Grafana.

Locally, Docker Compose runs the same runtime lane, with an nginx container in
place of the Envoy Gateway.

## Choose your path

| I want to... | Go to |
| --- | --- |
| Run it on my laptop in one command | [Quick start](#quick-start-local) |
| Understand it by building it by hand | [Part 1](#part-1--the-manual-way-do-it-by-hand-to-understand-it) |
| Deploy to EKS with one command | [Automated EKS](#automated-eks-make-cluster-up) |
| Deploy to EKS with explanations (15 chapters) | [`gitops/README.md`](gitops/README.md) |
| Deploy to EKS, commands only | [`Deploy.md`](Deploy.md) |
| Work on the code or the pipeline | [For DevOps engineers](#for-devops-engineers) |

> **Cost warning for EKS:** budget about **$330 a month (about $11 a day)**. Do
> [`gitops/15-cleanup.md`](gitops/15-cleanup.md) when you are done. Steps 2 and 3
> there are the ones that stop the billing.

---

## Quick start (local)

You need **Docker** (with Compose) and `make`. No Node, Go, Python or Postgres,
and no logins or tokens.

```bash
make up        # the app: frontend, backend, Postgres      -> http://localhost:8080
make up-ai     # the same, plus Ollama and the AI service  (first run downloads ~1.3 GB)
make smoke     # quick end-to-end check
make down      # stop everything
```

`make up` creates `.env` for you, checks that Docker is running and the ports are
free, builds everything, and returns once every service is healthy.

| Service | URL | Notes |
| --- | --- | --- |
| App (via gateway) | http://localhost:8080 | the one door; also serves `/api/ai/*` with `make up-ai` |
| Backend | http://localhost:8081/health | direct access for debugging |
| Postgres | localhost:5432 | `devboard` / `devboard` |

Locally, a small nginx container (`gateway`) plays the part of the Envoy Gateway
on EKS and uses the same routes. Without `make up-ai` the app works normally and
the AI buttons return an error.

---

## Automated EKS (`make cluster-up`)

From an empty AWS account to a running DevBoard, with no manual steps:

```bash
aws configure                 # once; or aws sso login
make cluster-up               # about 25-35 minutes the first time
make cluster-https            # optional: DNS + a Let's Encrypt certificate
make cluster-down             # tear it all down in the right order
```

`make cluster-up` is idempotent, so you can re-run it after a failure. It does,
in order:

1. creates the Terraform state bucket and writes `terraform/backend.hcl`
2. builds the VPC and EKS cluster with Terraform (and installs Argo CD)
3. generates a random database password into AWS Secrets Manager (never printed)
4. points Argo CD at *your* fork and branch, and commits the change
5. pushes the branch, because Argo CD reads GitHub and not your laptop
6. installs Envoy Gateway, the platform and the app (`scripts/deploy.sh`), and
   waits until the `ClusterSecretStore` is Valid
7. waits for the AI model to download and checks `/api/ai/health`

Settings are environment variables: `REGION` (default `us-west-2`), `CLUSTER`
(default `devboard`), `BRANCH` (default: your current branch) and `HTTPS=1` to
run the HTTPS step as part of `cluster-up`. Add `DRY_RUN=1` to any command to
print what it would do without changing anything.

Other commands:

| Command | What it does |
| --- | --- |
| `make cluster-https` | creates the DNS record if the domain's zone is in your Route 53 (otherwise prints the CNAME and waits for it), then issues a staging certificate, switches to production, and checks HTTP redirects to HTTPS |
| `make ci-secrets` | sets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `SONAR_TOKEN` and `SONAR_HOST_URL` in GitHub from environment variables (needs `gh auth login`) |
| `make cluster-down` | asks you to type the cluster name, then removes Argo CD finalizers, deletes the namespaces so the load balancers and EBS volumes are released, waits until none remain, runs `terraform destroy`, removes the state bucket (`KEEP_STATE=1` keeps it) and lists anything still billing |

What no script can do for you: AWS credentials, a Docker Hub token, a SonarQube
token, and a Route 53 zone for your domain (or one manual CNAME at your DNS
provider). The scripts only act on the cluster named `CLUSTER` in `REGION`, and
refuse to run if `kubectl` points anywhere else.

> **It costs about $11 a day while it runs.** Run `make cluster-down` when you
> are done, then check the AWS console.

## What you need (for Parts 1-3)

- **Docker** (with Docker Compose, which comes with Docker Desktop).
- That's it for the hands-on parts below. You do **not** need Node, Go, or Postgres installed — they all run
  inside containers.

---

## Part 1 — The manual way (do it by hand to understand it)

Run all commands from this folder. We'll start the three pieces one by one, the
hard way, so you can see exactly what Docker Compose does for you later.

### Step 1: Create a network

Containers can only find each other by name if they're on the **same network**.
So first we make one:

```bash
docker network create devboard-net
```

### Step 2: Build the images

The frontend and backend are *our* code, so we build an image for each. The
database is not our code — it's the official Postgres image — so there's
nothing to build for it.

```bash
docker build -t devboard-frontend ./frontend
docker build -t devboard-backend ./backend
```

The first build downloads base images and compiles the code, so it can take a
few minutes. Later builds are much faster.

### Step 3: Run the database

We name it `postgres`. The backend will look for it by that exact name. The
`-v ./init/postgres:...` line loads the example data the first time it starts.

```bash
docker run -d --name postgres --network devboard-net \
  -e POSTGRES_USER=devboard \
  -e POSTGRES_PASSWORD=devboard \
  -e POSTGRES_DB=devboard \
  -v "$PWD/init/postgres":/docker-entrypoint-initdb.d:ro \
  -p 5432:5432 \
  postgres:16-alpine
```

### Step 4: Run the backend

We name it `backend` (the frontend looks for this name). We also tell it how to
reach the database with `POSTGRES_URL` — notice it uses the name `postgres`.

```bash
docker run -d --name backend --network devboard-net \
  -e PORT=8080 \
  -e POSTGRES_URL="postgres://devboard:devboard@postgres:5432/devboard?sslmode=disable" \
  -p 8081:8080 \
  devboard-backend
```

### Step 5: Run the frontend

It serves the app on port 4173 inside the container; we map it to 8080 on your
machine.

```bash
docker run -d --name frontend --network devboard-net \
  -p 8080:4173 \
  devboard-frontend
```

### Step 6: Open it and check

Open **http://localhost:8080** in your browser — you should see the DevBoard
dashboard with some example tasks. (If the page shows an error for a second on
first load, the backend is still starting up — just refresh.)

Then check the wiring from the terminal:

```bash
curl http://localhost:8081/health                      # backend says OK
curl "http://localhost:8080/api/tasks?project_id=1"    # app → backend → database
```

### Step 7: Stop and clean up

```bash
docker rm -f frontend backend postgres
docker network rm devboard-net
```

### The one thing to remember: names

The backend finds the database using the name `postgres` (see `POSTGRES_URL`).
The frontend finds the backend using the name `backend` (see
`frontend/vite.config.js`). So those container **names must match**, and they
only work because everything is on the same `devboard-net` network.

That's a lot of typing, and you have to start them in the right order. This is
exactly the problem Docker Compose solves.

---

## Part 2 — The easy way: Docker Compose

Compose does everything from Part 1 — the network, the names, the order, the
environment values — from one file (`docker-compose.yml`).

First, create your settings file (one time only). Compose reads it to fill in
passwords and ports, so the stack won't start without it:

```bash
cp .env.example .env
```

Then start everything with one command:

```bash
docker compose up --build
```

The first build can take a few minutes. When it's done, open
**http://localhost:8080** in your browser.

Stop it:

```bash
docker compose down
```

| Piece    | Open in browser / curl        | Notes                                   |
| -------- | ----------------------------- | --------------------------------------- |
| Frontend | http://localhost:8080         | the app; forwards `/api` to the backend |
| Backend  | http://localhost:8081/health  | the Go API (the app uses it via `/api`) |
| Postgres | localhost:5432                | user / password: `devboard` / `devboard`|

---

## Part 3 — The shortcut: `make`

You don't even have to remember the Compose commands. Run `make` to see what's
available:

```bash
make           # list all commands
make setup     # create your .env file (first time only)
make up        # build and start everything
make up-ai     # same, plus the AI assistant
make down      # stop everything
make logs      # watch the logs
make reset     # wipe the database and start fresh
make smoke     # quick check that everything works
```

`make up` creates `.env` for you automatically, so it's the simplest way to start.

### Optional: the AI assistant

`make up-ai` (or `docker compose --profile ai up --build`) also starts Ollama and
the Python `ai-service`. The first run downloads the model (about 1.3 GB), so
give it a few minutes. A small nginx container (`gateway`) plays the part of the
Envoy Gateway on EKS: it sends `/api/ai/*` to `ai-service` and everything else to
the frontend. Without the AI profile the app works normally and the AI buttons
return an error.

> `make` is optional. It's already available on Linux and macOS (on macOS you may
> need Xcode Command Line Tools: `xcode-select --install`). On Windows, either use
> WSL or just run the `docker compose` commands from Part 2 directly.

---

## Settings live in `.env`

All the changeable values (passwords, ports) live in one file. The first time,
copy the example:

```bash
cp .env.example .env     # or: make setup
```

`.env.example` is the template kept in git. Your real `.env` is ignored by git,
so in a real project your secrets never get committed.

---

## The API (for reference)

The browser calls these as `/api/...`; the backend serves them at the root.

| Method | Path                      | What it does                          |
| ------ | ------------------------- | ------------------------------------- |
| GET    | `/projects`               | list projects                         |
| POST   | `/projects`               | create a project                      |
| GET    | `/tasks?project_id=N`     | list tasks in a project               |
| POST   | `/tasks`                  | create a task                         |
| PATCH  | `/tasks/:id`              | update a task (e.g. change status)    |
| GET    | `/search?q=&project_id=N` | search tasks by title                 |
| GET    | `/health`                 | health check                          |

---

## For DevOps engineers

### Repository layout

```
docker-compose.yml     local stack: postgres, backend, frontend, gateway (+ ollama, ai-service with --profile ai)
Makefile               make up / up-ai / down / reset / smoke / logs
.env.example           local settings; copied to .env (gitignored)
local/                 nginx gateway config and setup.sh (.env refresh + preflight checks)
frontend/              React app (Vite). `vite preview` serves it and proxies /api
backend/               Go API: main.go, tracing.go (OpenTelemetry)
ai-service/            Python AI microservice (Flask, gunicorn, hashed requirements.lock)
init/postgres/         schema and seed data, loaded on first boot
k8s/                   raw Kubernetes manifests
helm/devboard/         the same app as a Helm chart
terraform/             VPC, EKS, IAM, Pod Identity, Secrets Manager, Argo CD install
terraform/bootstrap/   the S3 state bucket (local state, run once)
gitops/                Argo CD apps, Gateway, cert-manager, External Secrets, observability, Ollama
ansible/               optional: prepares an EC2 admin box with the CLI tools
scripts/cluster-up.sh  state bucket, cluster, secret, Argo CD rewire, platform, app, AI (make cluster-up)
scripts/cluster-https.sh  DNS and a Let's Encrypt certificate (make cluster-https)
scripts/cluster-down.sh   ordered teardown that frees load balancers and volumes (make cluster-down)
scripts/ci-secrets.sh  sets the GitHub Actions secrets from env vars (make ci-secrets)
scripts/deploy.sh      installs Envoy Gateway, the platform and the app after Terraform
.github/workflows/     DevSecOps pipeline (reusable workflows) and Terraform checks
```

### Ports and routes

| Service | Container port | Local host port | Notes |
| --- | --- | --- | --- |
| gateway (nginx) | 80 | 8080 | local only; Envoy Gateway on EKS |
| frontend | 4173 | none | reached through the gateway |
| backend | 8080 | 8081 | `PORT` env var |
| ai-service | 3005 | none | `/summarise`, `/ask`, `/health`, `/metrics` |
| postgres | 5432 | 5432 | |
| ollama | 11434 | none | OpenAI-compatible API under `/v1` |

Routing, identical locally and on EKS (`k8s/httproute.yml`):

- `/api/ai/summarise`, `/api/ai/ask`, `/api/ai/health` go to ai-service. They are
  exact matches on purpose, so `/metrics` is never reachable from outside.
- Everything else goes to the frontend, which forwards `/api/*` to the backend
  with the `/api` prefix removed.

### Configuration

| Variable | Used by | Default |
| --- | --- | --- |
| `POSTGRES_URL` | backend | built by Compose from the `POSTGRES_*` values |
| `PORT` | backend | `8080` |
| `TASK_SERVICE_URL` | ai-service | `http://backend:8080` |
| `MODEL_API_BASE` | ai-service | `http://ollama.ollama.svc.cluster.local:11434/v1` (Compose overrides it) |
| `MODEL_NAME` | ai-service, ollama-pull | `llama3.2:1b` |
| `MODEL_API_KEY` | ai-service | empty; set it to use a hosted OpenAI-compatible provider |
| `OTEL_EXPORTER_OTLP_*`, `OTEL_SERVICE_NAME` | backend, ai-service | set in the cluster; telemetry is switched off locally |
| `VITE_OTEL_ENABLED` | frontend (build time) | `false` |
| `GO_IMAGE`, `NODE_BUILD_IMAGE`, `NODE_RUNTIME_IMAGE` | Compose builds | public images in `.env.example` |

### Docker Hardened Images

The Dockerfiles default to Docker Hardened Images (`dhi.io`), which need
`docker login dhi.io`. CI uses them. For local builds `.env.example` points the
build args at public `golang` and `node` images so nothing needs a login. Delete
those three lines from `.env` to use the hardened images locally.

### Secrets

No credentials live in Git and no access keys exist anywhere.

```
AWS Secrets Manager (devboard/postgres)
   -> External Secrets Operator (EKS Pod Identity)
   -> Kubernetes Secret devboard-secrets
   -> backend and postgres
```

Locally the values come from `.env` (`devboard` / `devboard`, for development
only).

### CI/CD

Push to `mega-project` runs `.github/workflows/devsecops.yml`:

1. **Gates, in parallel:** code quality (eslint, `go fmt`/`vet`, ruff), Gitleaks,
   dependency checks (govulncheck, npm audit), Dockerfile lint (hadolint) and
   Trivy image scan, SonarQube, and tests (Vitest, `go test`, pytest).
2. **Build and push:** backend, frontend and ai-service images go to Docker Hub
   tagged `sha-<7 chars>`.
3. **GitOps bump:** the new tags are written into `k8s/` and
   `helm/devboard/values.yaml` and committed back. Argo CD syncs from Git.

Other workflows: `terraform-ci.yml` (fmt, validate, tflint), `dast.yml` (OWASP
ZAP) and `matrix.yml` (manual Go version matrix). Dependabot covers GitHub
Actions, Terraform, Go, npm, pip and Docker.

### GitOps rules to know

- Every Argo CD app runs with `selfHeal: true`. `kubectl edit` changes are
  reverted within about three minutes, so commit and push instead.
- Argo CD reads GitHub, not your laptop. Push before you expect a deploy.
- The repo and branch (`mega-project`) are hard-coded in 14 files under
  `gitops/argocd/`. If you fork, follow `Deploy.md` section 0.3.
- Platform pieces are an app-of-apps (`gitops/argocd/platform/`): External
  Secrets, cert-manager, the observability stack and Ollama.

### Observability

The browser, backend and ai-service send OTLP to an OpenTelemetry Collector
(agent plus gateway), which feeds Tempo (traces), Loki (logs) and Prometheus
(metrics). Grafana sits on top (`admin` / `devboard`):

```bash
kubectl -n observability port-forward svc/observability-grafana 3000:80
```

A trace starts in the browser and continues through the Gateway, the Go backend
and Postgres. Chapters 11-13 walk through it.

### Infrastructure and cost

Terraform builds the VPC, EKS 1.34 with three `t3.large` nodes, IAM, Pod Identity
and Secrets Manager, with remote state in S3, and installs Argo CD. See
[`gitops/README.md`](gitops/README.md) for the full cost table. The biggest lever
is `node_desired_size = 2` in `terraform/terraform.tfvars`, which saves about
$61 a month if you run only one DevBoard stack.

### Teardown

Order matters: stop Argo CD, delete the namespaces, confirm no load balancers or
volumes remain, then `terraform destroy`, then the state bucket. Argo CD
finalizers, orphaned ELBs and security groups, and PVC volumes are what stall or
survive a destroy. Follow [`gitops/15-cleanup.md`](gitops/15-cleanup.md).

### Troubleshooting

`Deploy.md` section 16 covers `ImagePullBackOff`, Argo CD `ComparisonError`, a
Gateway with no address, stuck certificates, and a PVC stuck `Pending`. For local
runs:

| Symptom | Likely cause |
| --- | --- |
| `401 Unauthorized` from `dhi.io` during build | an old `.env` without the image variables; run `make setup` |
| "Port ... is already in use" | another process on 8080, 8081 or 5432; free it or change the port in `.env` |
| `/api/ai/*` returns 502 | you started with `make up`; use `make up-ai` |
| Blank page or 502 right after start | services still starting; `make up` waits, plain `docker compose up` does not |

### Deliberately broken (teaching material)

- `ai_service_requests_total` increments before the response streams, so it
  reports `200` forever and can never see a failure (chapter 12).
- The `/api/projects` trace has a small unexplained gap (chapter 13).

### Recent changes

- **Local parity:** `docker compose` now runs the AI assistant (`--profile ai`)
  behind an nginx gateway that mirrors the Envoy routes. `make up` waits for
  health, refreshes `.env` and checks Docker and ports first.
- **OpenTelemetry end to end:** browser tracing, explicit Go tracing, and
  zero-code auto-instrumentation for Python, into Tempo, Loki and Prometheus.
- **Pure GitOps delivery:** CI builds SHA-tagged images and commits the tags
  back; Argo CD does the deploy. CI no longer touches the cluster.
- **Gateway API:** Envoy Gateway replaces an ingress controller, with
  cert-manager for TLS.
- **Secretless AWS access:** EKS Pod Identity instead of IRSA or access keys.
- **Self-hosted AI:** Ollama in-cluster (or in Compose) behind a Python
  streaming service, so no API key is needed.
- **Supply chain:** hardened base images, hashed Python lockfile, Gitleaks,
  Trivy, govulncheck and Dependabot across every ecosystem.

---

## CI/CD — DevSecOps + GitOps

Pushing to the `mega-project` branch runs the pipeline in
[`.github/workflows/devsecops.yml`](.github/workflows/devsecops.yml):

1. **Gates** (parallel) — code quality, secret scanning, dependency checks,
   Dockerfile lint + image scan, SonarQube (SAST), and tests.
2. **Build & push** — once every gate passes, each service image is built and
   pushed to Docker Hub tagged with the commit SHA.
3. **GitOps bump** — the new SHA tags are written into `k8s/` and
   `helm/devboard/values.yaml` and committed back. Argo CD (watching this
   branch) then syncs the change to the cluster — **CI never touches the
   cluster directly**.

See [`gitops/14-cicd.md`](gitops/14-cicd.md) for the full walk-through. The
steps below configure the secrets the pipeline needs.

### How to Install and Set Up SonarQube on EC2

To run your own self-hosted SonarQube server on your AWS EC2 instance:

1. **Start the SonarQube Container**:
   Ensure Docker is installed on your EC2 instance, then run:
   ```bash
   docker run -itd --name SonarQube-Server -p 9000:9000 sonarqube:community
   ```

2. **Access the Web Interface**:
   - Make sure port `9000` is open in your **AWS EC2 Security Group** inbound rules.
   - Access `http://<YOUR_EC2_PUBLIC_IP>:9000` in your browser.
   - Log in using default credentials: Username: `admin` / Password: `admin` (you will be prompted to change it)


### How to configure SonarQube Secrets

To enable SonarQube scanning in your GitHub Actions pipeline:

1. **Get the Host URL**:
   - If using a self-hosted instance, your `SONAR_HOST_URL` is the URL where SonarQube is hosted (e.g., `http://your-sonarqube-ip:9000`).
   - If using SonarCloud, use `https://sonarcloud.io`.
2. **Generate a SonarQube Token**:
   - In SonarQube: Go to your **Profile (User Icon) > My Account > Security**.
   - Under **Generate Tokens**, enter a token name, select the **User Token** type, and click **Generate**.
   - Copy the generated token string.
3. **Add Secrets to GitHub**:
   - Go to your GitHub Repository settings.
   - Navigate to **Settings > Secrets and variables > Actions**.
   - Add two Repository Secrets:
     - `SONAR_TOKEN`: Paste the SonarQube token you copied.
     - `SONAR_HOST_URL`: Paste your SonarQube server URL.

### How to configure Docker Hub Credentials

To allow the CI pipeline to build and push images to Docker Hub:
1. Navigate to **Settings > Secrets and variables > Actions**.
2. Under the **Variables** tab, add:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username.
3. Under the **Secrets** tab, add:
   - `DOCKERHUB_TOKEN`: A Personal Access Token (PAT) generated from Docker Hub.


