# Atajos de desarrollo. Uso: `make <objetivo>`; `make help` lista todo.

SHELL := /bin/bash

EMAIL ?= admin@telar.local
NAME  ?= Admin
URL   ?= http://localhost:8000

.PHONY: help up down logs user superadmin password login

help: ## Lista los objetivos disponibles
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

up: ## Levanta la base y la API
	docker compose up -d db api

down: ## Apaga los contenedores
	docker compose down

logs: ## Sigue los logs de la API
	docker compose logs -f api

superadmin: up ## Crea un superadmin (EMAIL=... NAME=...); pide la contraseña
	docker compose exec -it api python -m telar.auth.create_user $(EMAIL) "$(NAME)" --superadmin

user: up ## Crea un usuario sin superadmin (EMAIL=... NAME=...); pide la contraseña
	docker compose exec -it api python -m telar.auth.create_user $(EMAIL) "$(NAME)"

password: ## Resetea la contraseña de un usuario (EMAIL=...); reconstruye la API
	docker compose up -d --build db api
	docker compose exec -it api python -m telar.auth.reset_password $(EMAIL)

login: ## Prueba el login contra la API (EMAIL=...); pide la contraseña
	@read -s -p "Password: " PASS; echo; \
	curl -s -X POST $(URL)/auth/login -H "Content-Type: application/json" \
	  -d "{\"email\": \"$(EMAIL)\", \"password\": \"$$PASS\"}"; echo
