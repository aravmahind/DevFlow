.PHONY: help dev build-dev up down restart ps logs health prune frontend-dev backend ai local-backend local-ai local-frontend

help:
	@echo "Devflow Management Commands:"
	@echo ""
	@echo "=== Docker Mode (Containers) ==="
	@echo "  make dev            - Start containers in background (frontend, backend, ai)"
	@echo "  make build-dev      - Rebuild and start all containers"
	@echo "  make down           - Stop and remove all containers"
	@echo "  make logs           - Tail logs from all containers"
	@echo "  make ps             - List status of all containers"
	@echo "  make health         - Check health endpoints of running services"
	@echo "  make restart        - Restart all containers"
	@echo ""
	@echo "=== Non-Docker Local Mode (Run natively) ==="
	@echo "  make local-backend  - Run FastAPI Backend locally on :8000"
	@echo "  make local-ai       - Run AI Services locally on :8001"
	@echo "  make local-frontend - Run Next.js Frontend locally on :3000"

dev:
	docker compose up --detach --wait
	@echo "======================================================="
	@echo "  Devflow is ready in Docker!"
	@echo "  Frontend:    http://localhost:3000"
	@echo "  Backend API: http://localhost:8000/docs"
	@echo "  AI Services: http://localhost:8001/docs"
	@echo "======================================================="

build-dev:
	docker compose up --build --detach --wait
	@echo "======================================================="
	@echo "  Devflow is built & ready in Docker!"
	@echo "  Frontend:    http://localhost:3000"
	@echo "  Backend API: http://localhost:8000/docs"
	@echo "  AI Services: http://localhost:8001/docs"
	@echo "======================================================="

up: dev

down:
	docker compose down --remove-orphans

prune:
	docker system prune -af

logs:
	docker compose logs -f

# ---- Convenience ----
up-backend:        ## Bring up API stack (no dockerized frontend build)
	docker compose up -d backend ai-services

restart:
	docker compose restart

ps:
	docker compose ps

health:
	@echo "--- Backend Health ---"
	@curl -sf http://localhost:8000/health | python3 -m json.tool 2>/dev/null || curl -sf http://localhost:8000/health || echo "Backend unreachable"
	@echo "\n--- AI Services Health ---"
	@curl -sf http://localhost:8001/health | python3 -m json.tool 2>/dev/null || curl -sf http://localhost:8001/health || echo "AI Services unreachable"

frontend-dev: local-frontend

# ---- Non-Docker Local Development ----
local-backend:
	cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

local-ai:
	cd ai-services && uvicorn main:app --host 0.0.0.0 --port 8001 --reload

local-frontend:
	cd frontend && npm run dev -- -p 3000

# ---- Shells ----
backend:
	docker compose exec backend bash

ai:
	docker compose exec ai-services bash
