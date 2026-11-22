help:
	@echo ""
	@echo "DevBoard commands:"
	@echo "  make setup   create or refresh .env and check Docker and ports"
	@echo "  make up      build and start everything"
	@echo "  make up-ai   same, plus the AI assistant (downloads a ~1.3 GB model once)"
	@echo "  make down    stop everything"
	@echo "  make logs    watch the logs"
	@echo "  make ps      show what is running"
	@echo "  make reset   wipe the database and start fresh"
	@echo "  make smoke   quick check that everything works"
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

.PHONY: help setup up up-ai down logs ps reset smoke
