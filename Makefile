.PHONY: up down logs build pull-model

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
