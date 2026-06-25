# DevBoard — short commands so you don't have to remember the long ones.
# Run "make" to see this list.

help:
	@echo ""
	@echo "DevBoard commands:"
	@echo "  make setup   create your .env file (first time only)"
	@echo "  make up      build and start everything"
	@echo "  make down    stop everything"
	@echo "  make logs    watch the logs"
	@echo "  make ps      show what is running"
	@echo "  make reset   wipe the database and start fresh"
	@echo "  make smoke   quick check that everything works"
	@echo ""

setup:
	@test -f .env || cp .env.example .env
	@echo ".env is ready"

up: setup
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

ps:
	docker compose ps

reset:
	docker compose down -v
	docker compose up --build

smoke:
	@echo "backend health:"
	curl -s http://localhost:8081/health
	@echo ""
	@echo "frontend page:"
	curl -s -o /dev/null -w "  HTTP %{http_code}\n" http://localhost:8080/
	@echo "tasks from the database:"
	curl -s "http://localhost:8080/api/tasks?project_id=1"
	@echo ""

# These are command names, not files — so make always runs them.
.PHONY: help setup up down logs ps reset smoke
