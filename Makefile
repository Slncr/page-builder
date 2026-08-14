SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

ENV_FILE ?= $(if $(wildcard .env),.env,.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE)
BACKUP_DIR ?= backups

.PHONY: help env config up up-gateway up-scheduler down logs ps lint test build migration-check \
	gateway-test e2e-install e2e load-public-smoke security-audit backup backup-media backup-all restore restore-media

help: ## Show available targets.
	@awk 'BEGIN {FS = ":.*## "; printf "Usage: make <target>\n\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create .env from the safe local template.
	@test ! -e .env || { echo ".env already exists"; exit 1; }
	cp .env.example .env

config: ## Validate the rendered Compose configuration.
	$(COMPOSE) config --quiet

up: ## Build and start the complete development stack.
	$(COMPOSE) up --build -d postgres redis minio minio-init backend scheduler worker frontend

up-gateway: ## Start the stack and opt-in legacy gateway profile.
	$(COMPOSE) --profile gateway up --build -d postgres redis minio minio-init backend frontend gateway

up-scheduler: ## Restart scheduler and worker processes.
	$(COMPOSE) up --build -d scheduler worker

down: ## Stop the stack without deleting persisted data.
	$(COMPOSE) down

logs: ## Follow logs for the core stack.
	$(COMPOSE) logs --follow --tail=200

ps: ## Show service and health status.
	$(COMPOSE) ps

lint: ## Run frontend and backend lint checks.
	./infra/ci/frontend.sh lint
	./infra/ci/backend.sh lint

test: ## Run frontend and backend test suites.
	./infra/ci/frontend.sh test
	./infra/ci/backend.sh test

build: ## Build frontend assets and backend package metadata.
	./infra/ci/frontend.sh build
	./infra/ci/backend.sh build

migration-check: ## Upgrade an empty database and detect migration drift.
	./infra/ci/backend.sh migration-check

gateway-test: ## Test gateway path ownership and kill-switch behavior.
	bash ./infra/nginx/test-gateway.sh

e2e-install: ## Install Playwright dependencies and Chromium.
	npm --prefix tests/e2e ci
	npx --prefix tests/e2e playwright install --with-deps chromium

e2e: ## Run Playwright and axe against configured base URLs.
	E2E_FRONTEND_BASE_URL="$${E2E_FRONTEND_BASE_URL:-http://127.0.0.1:15173}" \
	E2E_API_BASE_URL="$${E2E_API_BASE_URL:-http://127.0.0.1:18080}" \
	npm --prefix tests/e2e test

load-public-smoke: ## Run a non-destructive one-RPS k6 smoke check.
	docker run --rm --network host \
		-e BASE_URL="$${K6_FRONTEND_URL:-http://127.0.0.1:15173}" \
		-e PUBLIC_RPS=1 -e DURATION=10s \
		-v "$(CURDIR)/infra/load/k6:/scripts:ro" \
		grafana/k6:latest run /scripts/public.js

security-audit: ## Audit application dependencies.
	./infra/ci/frontend.sh audit
	./infra/ci/backend.sh audit

backup: ## Create a timestamped PostgreSQL logical backup.
	@mkdir -p "$(BACKUP_DIR)"
	@file="$(BACKUP_DIR)/page-builder-$$(date -u +%Y%m%dT%H%M%SZ).sql"; \
	$(COMPOSE) exec -T postgres sh -c 'pg_dump --clean --if-exists --no-owner -U "$$POSTGRES_USER" "$$POSTGRES_DB"' > "$$file"; \
	echo "Wrote $$file"

backup-media: ## Mirror MinIO media into BACKUP_DIR/media.
	@mkdir -p "$(BACKUP_DIR)/media"
	docker run --rm --entrypoint /bin/sh --network "$${COMPOSE_PROJECT_NAME:-page-builder}" \
		--env-file "$(ENV_FILE)" -v "$(CURDIR)/$(BACKUP_DIR)/media:/backup" \
		minio/mc:latest -c 'mc alias set source http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" && mc mirror --overwrite "source/$$S3_BUCKET" /backup'

backup-all: backup backup-media ## Back up PostgreSQL and media together.

restore: ## Restore BACKUP_FILE after CONFIRM_RESTORE=yes.
	@test "$(CONFIRM_RESTORE)" = "yes" || { echo "Set CONFIRM_RESTORE=yes"; exit 1; }
	@test -f "$(BACKUP_FILE)" || { echo "Set BACKUP_FILE to an existing SQL backup"; exit 1; }
	$(COMPOSE) exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" "$$POSTGRES_DB"' < "$(BACKUP_FILE)"

restore-media: ## Restore BACKUP_DIR/media after CONFIRM_RESTORE=yes.
	@test "$(CONFIRM_RESTORE)" = "yes" || { echo "Set CONFIRM_RESTORE=yes"; exit 1; }
	@test -d "$(BACKUP_DIR)/media" || { echo "Missing $(BACKUP_DIR)/media"; exit 1; }
	docker run --rm --entrypoint /bin/sh --network "$${COMPOSE_PROJECT_NAME:-page-builder}" \
		--env-file "$(ENV_FILE)" -v "$(CURDIR)/$(BACKUP_DIR)/media:/backup:ro" \
		minio/mc:latest -c 'mc alias set target http://minio:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" && mc mirror --overwrite /backup "target/$$S3_BUCKET"'
