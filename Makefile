help:
	@echo ""
	@echo "DevBoard commands:"
	@echo "  make setup   create or refresh .env and check Docker and ports"
	@echo "  make up      build and start everything"
	@echo "  make up-ai   same, plus the AI assistant (downloads a ~1.3 GB model once)"
	@echo "  make down    stop everything"
	@echo "  make logs    watch the logs"
	@echo "  make ps      show what is running"
	@echo "  make reset   wipe the database (keeps the AI model) and start fresh"
	@echo "  make smoke   quick check that everything works"
	@echo ""
	@echo "EKS (needs AWS credentials; costs about \$$11/day while it runs):"
	@echo "  make cluster-up       state bucket, cluster, secret, Argo CD, platform, app, AI"
	@echo "  make cluster-https    DNS + Let's Encrypt certificate (after cluster-up)"
	@echo "  make ci-secrets       set the GitHub Actions secrets from env vars"
	@echo "  make cluster-down     tear it all down in the right order"
	@echo "  (add DRY_RUN=1 to any of them to print instead of change)"
	@echo ""

setup:
	@./local/setup.sh

# Builds, starts detached and waits until every service is healthy.
up: setup
	docker compose up -d --build --wait
	@echo ""
	@echo "DevBoard is ready: http://localhost:$$(grep '^FRONTEND_HOST_PORT=' .env | cut -d= -f2)"

up-ai: setup
	docker compose --profile ai up -d --build --wait
	@echo ""
	@echo "DevBoard + AI assistant are ready: http://localhost:$$(grep '^FRONTEND_HOST_PORT=' .env | cut -d= -f2)"

down:
	docker compose --profile ai down

logs:
	docker compose logs -f

ps:
	docker compose ps

# Wipes the database only. The downloaded AI model (ollama volume) is kept.
reset:
	docker compose --profile ai down
	docker volume rm -f devboard_pgdata
	$(MAKE) up

smoke:
	@echo "backend health:"
	curl -s http://localhost:8081/health
	@echo ""
	@echo "frontend page:"
	curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:8080/
	@echo "tasks from the database:"
	curl -s "http://localhost:8080/api/tasks?project_id=1"
	@echo ""

cluster-up:
	./scripts/cluster-up.sh

cluster-https:
	./scripts/cluster-https.sh

ci-secrets:
	./scripts/ci-secrets.sh

cluster-down:
	./scripts/cluster-down.sh

.PHONY: cluster-up cluster-https ci-secrets cluster-down help setup up up-ai down logs ps reset smoke
