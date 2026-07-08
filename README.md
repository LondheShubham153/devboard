# DevBoard — Advanced (UI + Go + Postgres)

This is the same DevBoard UI as the `master` branch, but now the data comes
from a **real backend** instead of fake in-memory data.

Three pieces talk to each other:

```
browser  →  frontend (React)  →  backend (Go API)  →  database (Postgres)
```

- **frontend** — the React app. It also forwards anything starting with `/api`
  to the backend.
- **backend** — a small Go program that reads and writes the database.
- **database** — Postgres, with some example projects and tasks loaded on first
  start.

There's no login and no AI here on purpose. The whole point is to *see how the
pieces connect*.

---

## What you need

- **Docker** (with Docker Compose, which comes with Docker Desktop).
- That's it. You do **not** need Node, Go, or Postgres installed — they all run
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
make down      # stop everything
make logs      # watch the logs
make reset     # wipe the database and start fresh
make smoke     # quick check that everything works
```

`make up` creates `.env` for you automatically, so it's the simplest way to start.

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

## Folder layout

```
.
├── docker-compose.yml   starts frontend + backend + postgres together
├── Makefile             short commands (make up, make down, ...)
├── .env.example         template for settings (copy to .env)
├── frontend/            React app (Vite). Serves the UI, forwards /api
├── backend/             Go API (main.go + Dockerfile)
└── init/postgres/       schema + example data, loaded on first start
```

---

## CI/CD DevSecOps Setup

The repository contains GitHub Actions workflows configured with SonarQube (SAST) and OWASP ZAP (DAST) scanning.

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


