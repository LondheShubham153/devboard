# DevBoard

DevBoard is a small task-tracking application with a dashboard and project views. It displays projects and tasks, supports board and list views, lets users create and update tasks, and provides task search. The frontend reads and writes data through a Go REST API backed by PostgreSQL.

There is no authentication or user service in the current application. The profile shown in the UI is static demo data.

## Tech Stack

### Frontend

- React 18.3.1
- JavaScript with JSX and ES modules
- React Router DOM 6.26.2
- TanStack React Query 5.59.0 for server-state fetching and mutations
- Tabler Icons React 3.17.0
- Tailwind CSS 3.4.13
- Vite 8.1.0
- Vitest and Testing Library for tests
- ESLint 9 with React and React Hooks plugins

### Backend

- Go 1.22
- Gin 1.10.0 HTTP framework
- REST API returning JSON
- `database/sql` with the PostgreSQL driver `github.com/lib/pq` 1.10.9
- No authentication is implemented

### Database

- PostgreSQL
- Direct SQL through Go's `database/sql`; no ORM or ODM is used
- SQL schema and seed files in `init/postgres/`

### Other Technologies

- GitHub Actions workflows under `.github/workflows/`
- SonarQube project configuration in `sonar-project.properties`

## Project Structure

```text
devboard/
├── backend/
│   ├── go.mod
│   ├── main.go
│   └── main_test.go
├── frontend/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.js
│   ├── vite.preview.config.js
│   ├── public/
│   └── src/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       ├── pages/
│       ├── styles/
│       └── test/
├── init/
│   └── postgres/
│       ├── 01_schema.sql
│       └── 02_seed.sql
├── .env.example
├── .github/
│   └── workflows/
├── .dockerignore
├── Makefile
├── sonar-project.properties
└── README.md
```

## Prerequisites

Install the following:

- Git
- Go 1.26 or later
- Node.js `^20.19.0` or `>=22.12.0` (required by the installed Vite version)
- npm
- PostgreSQL

The current checkout does not pin a PostgreSQL server version in an active local configuration. The SQL uses standard PostgreSQL features such as `SERIAL`, `TIMESTAMPTZ`, PL/pgSQL triggers, and `ILIKE`.

## Clone the Repository

```bash
git clone https://github.com/AVNISHRANJAN/devboard.git
cd devboard
```

## Environment Variables

The committed `.env.example` documents the variables used by the Docker-oriented configuration:

```bash
cp .env.example .env
```

It defines:

- `POSTGRES_USER` - PostgreSQL username; local demo default is `devboard`.
- `POSTGRES_PASSWORD` - PostgreSQL password; local demo default is `devboard`.
- `POSTGRES_DB` - database name; local demo default is `devboard`.
- `POSTGRES_URL` - backend connection string; use a secret manager outside local development.
- `BACKEND_PORT` - backend container port, default `8080`.
- `POSTGRES_HOST_PORT` - host PostgreSQL port, default `5432`.
- `BACKEND_HOST_PORT` - host backend port for the Docker setup, default `8081`.
- `FRONTEND_HOST_PORT` - host frontend port for the Docker setup, default `8080`.

The Go backend reads `POSTGRES_URL` and `PORT`. It does not load `.env` files itself. For a manual local run, export these variables in the backend terminal:

```bash
export POSTGRES_URL='postgres://devboard:devboard@localhost:5432/devboard?sslmode=disable'
export PORT=8080
```

The frontend does not define any `VITE_*` variables. Its Vite development proxy forwards `/api` requests to `http://localhost:8080` and removes the `/api` prefix.

## Dependency Installation

Install backend dependencies:

```bash
cd backend
go mod download
```

Install frontend dependencies from the lockfile:

```bash
cd frontend
npm ci
```

## Database Setup

Create a PostgreSQL database and user matching the local connection URL, then run the existing SQL files from the repository root:

```bash
psql 'postgres://devboard:devboard@localhost:5432/devboard?sslmode=disable' \
  -f init/postgres/01_schema.sql
psql 'postgres://devboard:devboard@localhost:5432/devboard?sslmode=disable' \
  -f init/postgres/02_seed.sql
```

`01_schema.sql` creates the `projects` and `tasks` tables, indexes, and the task `updated_at` trigger. `02_seed.sql` inserts the demo projects and tasks. There are no migration commands or ORM configuration in the repository.

If the PostgreSQL role and database do not already exist, create them with administrative PostgreSQL tools before running the files above. The repository does not provide a database creation script.

## Run Locally

Start PostgreSQL and complete the database setup first. Then use two terminals.

### Terminal 1: backend

```bash
cd backend
export POSTGRES_URL='postgres://devboard:devboard@localhost:5432/devboard?sslmode=disable'
export PORT=8080
go run .
```

The backend listens at `http://localhost:8080`.

### Terminal 2: frontend

```bash
cd frontend
npm ci
npm run dev
```

Vite serves the frontend at `http://localhost:5173`. Open that URL in a browser. Requests made by the frontend to `/api/...` are proxied to the backend at port `8080`.

## Existing Scripts

### Frontend scripts

Run these from `frontend/`:

```bash
npm run dev       # Start the Vite development server on port 5173
npm run build     # Build the production frontend into dist/
npm run preview   # Preview the built frontend
npm run lint      # Lint the src directory
npm test          # Run the Vitest test suite
```

### Backend commands

Run these from `backend/`:

```bash
go test ./...     # Run Go tests
go run .          # Start the API
go build .        # Build the backend binary
```

### Make targets

The root `Makefile` includes these targets:

```bash
make help    # Show the target list
make setup   # Copy .env.example to .env if .env does not exist
make up      # Run the Docker Compose stack
make down    # Stop the Docker Compose stack
make logs    # Follow Docker Compose logs
make ps      # Show Docker Compose services
make reset   # Remove Docker Compose volumes and restart
make smoke   # Check the backend, frontend, and seeded task endpoint
```

The Compose stack and Dockerfiles are available in this checkout. Compose requires
the variables in `.env`; use `cp .env.example .env` for a local demo only. Never
copy those demo values into staging or production.

The enterprise CI/CD design is documented in
[`docs/devsecops-pipeline.md`](docs/devsecops-pipeline.md). The thin pipeline
orchestrator is [`.github/workflows/pipeline.yml`](.github/workflows/pipeline.yml)
and its CI/CD stages are split into separate reusable workflow files alongside it.

## API

The direct backend base URL is `http://localhost:8080`. The frontend accesses the same routes through its local `/api` proxy.

Available routes:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Backend health check |
| `GET` | `/projects` | List projects |
| `POST` | `/projects` | Create a project |
| `GET` | `/tasks?project_id=1` | List tasks for a project |
| `POST` | `/tasks` | Create a task |
| `PATCH` | `/tasks/:id` | Update a task's title, description, status, or priority |
| `GET` | `/search?q=term&project_id=1` | Search task titles within a project |

No API authentication or token configuration is present.

## Troubleshooting

### Port already in use

The backend uses port `8080` and the Vite development server uses port `5173`. Stop the process using the port or set a different backend `PORT` and update the target in `frontend/vite.config.js` to match.

### Database connection failure

Verify that PostgreSQL is running, the `devboard` database and role exist, and `POSTGRES_URL` points to the correct host, port, credentials, and database. The backend waits for PostgreSQL during startup and exits if it cannot connect.

### Empty projects or tasks

Run both SQL files in order from the repository root. The seed file expects the schema from `01_schema.sql` to exist first.

### Dependencies are missing

Run `go mod download` from `backend/` and `npm ci` from `frontend/`.

### Docker Make targets fail

The current checkout has Make targets that invoke Docker Compose, but the referenced `docker-compose.yml` and Dockerfiles are not present. Use the manual PostgreSQL, Go, and Vite workflow above.

## Quick Start

1. Clone the repository.
2. Install Git, Go 1.22+, Node.js with the required Vite version, npm, and PostgreSQL.
3. Create the local PostgreSQL database and run `init/postgres/01_schema.sql` and `init/postgres/02_seed.sql`.
4. Run `go mod download` in `backend/` and `npm ci` in `frontend/`.
5. Start the backend on `http://localhost:8080`.
6. Start the frontend with `npm run dev`.
7. Open `http://localhost:5173`.

---

## AWS EKS Deployment

DevBoard includes production-ready Kubernetes manifests and Terraform infrastructure for deployment on AWS EKS.

### Architecture

```
Internet → Route 53 → ALB (HTTPS) → Kubernetes Ingress
                                          ↓
                                   Frontend (Nginx)
                                     ↓ /api/*
                                   Backend (Go/Gin)
                                          ↓
                                   Amazon RDS PostgreSQL
```

### Quick EKS Deployment

```bash
# 1. Provision AWS infrastructure
cd terraform/
terraform init
terraform apply -var-file=environments/production.tfvars

# 2. Configure kubectl
aws eks update-kubeconfig --region <AWS_REGION> --name devboard-production

# 3. Build and push images to ECR
export ECR_REGISTRY=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com
export TAG=$(git rev-parse --short HEAD)
docker build -t ${ECR_REGISTRY}/devboard-backend:${TAG} ./backend/
docker build -t ${ECR_REGISTRY}/devboard-frontend:${TAG} ./frontend/
docker push ${ECR_REGISTRY}/devboard-backend:${TAG}
docker push ${ECR_REGISTRY}/devboard-frontend:${TAG}

# 4. Deploy to Kubernetes
kubectl apply -k k8s/

# 5. Verify
kubectl get pods -n devboard-prod
kubectl get ingress -n devboard-prod
```

### Documentation

| Document | Description |
|----------|-------------|
| [Step-by-Step EKS Runbook](docs/STEP_BY_STEP_EKS_DEPLOYMENT.md) | Exact commands and directory-by-directory execution steps |
| [EKS Deployment Guide](docs/EKS_DEPLOYMENT.md) | Complete operations and troubleshooting guide |
| [EKS Architecture](docs/EKS_ARCHITECTURE.md) | Architecture diagrams and decisions |
| [Production Checklist](docs/PRODUCTION_CHECKLIST.md) | Pre-production readiness checklist |
| [DevSecOps Pipeline](docs/devsecops-pipeline.md) | CI/CD pipeline design |

### Key Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Container Registry | Amazon ECR | Docker image storage with vulnerability scanning |
| Orchestration | Amazon EKS | Managed Kubernetes cluster |
| Database | Amazon RDS PostgreSQL | Managed database with automated backups |
| Load Balancer | AWS ALB | HTTPS termination, path-based routing |
| Node Autoscaling | Karpenter | Fast node provisioning (~60s) |
| Pod Autoscaling | Kubernetes HPA | CPU/memory-based replica scaling |
| IaC | Terraform | Reproducible infrastructure |
| CI/CD | GitHub Actions | Automated build, scan, deploy |

### Environment Variables (EKS)

| Variable | Source | Description |
|----------|--------|-------------|
| `POSTGRES_URL` | K8s Secret | RDS connection string |
| `PORT` | K8s ConfigMap | Backend listen port (8080) |
| `GIN_MODE` | K8s ConfigMap | Gin framework mode (release) |
| `APP_ENV` | K8s ConfigMap | Environment identifier |

### Scaling

- **HPA** scales backend pods (2→8) and frontend pods (2→6) based on CPU utilization
- **Karpenter** provisions new EC2 nodes when pods are pending
- **PodDisruptionBudgets** ensure at least 1 pod per service during disruptions

### Rollback

```bash
kubectl rollout undo deployment/backend -n devboard-prod
kubectl rollout undo deployment/frontend -n devboard-prod
```
