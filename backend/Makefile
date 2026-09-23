# Atajos de desarrollo y despliegue. Uso: `make <objetivo>`; `make help` lista todo.

SHELL := /bin/bash

EMAIL ?= admin@telar.local
NAME  ?= Admin
URL   ?= http://localhost:8000

# Producción: ver docs/DEPLOY.md. --env-file porque CLOUDFLARE_TUNNEL_TOKEN
# se interpola en el compose, no solo se pasa al contenedor.
PROD := docker compose -f ../deploy/docker-compose.prod.yml --env-file .env

.PHONY: help up down logs migrate migrate-status migrate-baseline user superadmin password login \
        deploy prod-status prod-logs prod-down prod-superadmin prod-password prod-migrate-status

help: ## Lista los objetivos disponibles
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-20s %s\n", $$1, $$2}'

up: ## Levanta la base y la API (aplica migraciones pendientes antes)
	docker compose up -d --build db api

down: ## Apaga los contenedores
	docker compose down

logs: ## Sigue los logs de la API
	docker compose logs -f api

migrate: ## Aplica las migraciones pendientes (dev)
	docker compose run --rm --build migrate

migrate-status: ## Lista migraciones aplicadas y pendientes (dev)
	docker compose run --rm --build migrate python -m telar.db.migrate --status

migrate-baseline: ## Marca todas como aplicadas; solo para bases creadas antes del runner
	docker compose run --rm --build migrate python -m telar.db.migrate --baseline

superadmin: up ## Crea un superadmin (EMAIL=... NAME=...); pide la contraseña
	docker compose exec -it api python -m telar.auth.create_user $(EMAIL) "$(NAME)" --superadmin

user: up ## Crea un usuario sin superadmin (EMAIL=... NAME=...); pide la contraseña
	docker compose exec -it api python -m telar.auth.create_user $(EMAIL) "$(NAME)"

password: up ## Resetea la contraseña de un usuario (EMAIL=...)
	docker compose exec -it api python -m telar.auth.reset_password $(EMAIL)

login: ## Prueba el login contra la API (EMAIL=...); pide la contraseña
	@read -s -p "Password: " PASS; echo; \
	curl -s -X POST $(URL)/auth/login -H "Content-Type: application/json" \
	  -d "{\"email\": \"$(EMAIL)\", \"password\": \"$$PASS\"}"; echo

# ------------------------------------------------------------- producción

deploy: ## PRODUCCIÓN: construye, migra y levanta API + túnel (también para actualizar)
	$(PROD) up -d --build --remove-orphans
	@$(PROD) ps

prod-status: ## PRODUCCIÓN: estado de los contenedores y salud de la API
	@$(PROD) ps
	@curl -fsS http://localhost:8000/health && echo || echo "La API no responde en localhost:8000"

prod-logs: ## PRODUCCIÓN: sigue los logs (SERVICE=api|migrate|tunnel)
	$(PROD) logs -f --tail 200 $(SERVICE)

prod-down: ## PRODUCCIÓN: apaga todo (los datos viven en la base externa)
	$(PROD) down

prod-superadmin: ## PRODUCCIÓN: crea un superadmin (EMAIL=... NAME=...)
	$(PROD) exec -it api python -m telar.auth.create_user $(EMAIL) "$(NAME)" --superadmin

prod-password: ## PRODUCCIÓN: resetea una contraseña (EMAIL=...)
	$(PROD) exec -it api python -m telar.auth.reset_password $(EMAIL)

prod-migrate-status: ## PRODUCCIÓN: migraciones aplicadas y pendientes
	$(PROD) run --rm migrate python -m telar.db.migrate --status
