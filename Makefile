.PHONY: up down logs build pull-model dev dev-down dev-logs pull-model-dev web

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=200

build:
	docker compose build

pull-model:
	docker compose exec ollama ollama pull qwen2.5:1.5b

# --- lokální vývoj (bez Traefiku) ---
# 1) make dev
# 2) make web   (nebo v druhém terminálu: cd apps/web && npm run dev)
dev:
	docker compose -f docker-compose.dev.yml up -d --build
	@echo ""
	@echo "API:  http://localhost:8000/api  (docs: http://localhost:8000/docs)"
	@echo "Web:  make web   → http://localhost:3000"
	@echo "Ollama model: make pull-model-dev"

dev-down:
	docker compose -f docker-compose.dev.yml down

dev-logs:
	docker compose -f docker-compose.dev.yml logs -f --tail=200

pull-model-dev:
	docker compose -f docker-compose.dev.yml exec ollama ollama pull qwen2.5:1.5b

web:
	cd apps/web && npm install && npm run dev
