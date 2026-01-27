.PHONY: help build chatreset dbclear dev graphql health init install local migrate seed staging gentoken useradd userpw
.DEFAULT_GOAL := help

RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[0;33m
RESET=\033[0m

export API_REPO ?= ci/api
export WEBSERVER_REPO ?= ci/nginx
export TAG ?= $(shell git rev-parse --short HEAD 2>/dev/null)

define BANNER
   ______                                  _
  / ____/___  ____ ___  ____  ____ _____  (_)___  ____
 / /   / __ \/ __ `__ \/ __ \/ __ `/ __ \/ / __ \/ __ \\
/ /___/ /_/ / / / / / / /_/ / /_/ / / / / / /_/ / / / /
\____/\____/_/ /_/ /_/ .___/\__,_/_/ /_/_/\____/_/ /_/
    ____      __    /_/_____
   /  _/___  / /____  / / (_)___ ____  ____  ________
   / // __ \/ __/ _ \/ / / / __ `/ _ \/ __ \/ ___/ _ \\
 _/ // / / / /_/  __/ / / / /_/ /  __/ / / / /__/  __/
/___/_/ /_/\__/\___/_/_/_/\__, /\___/_/ /_/\___/\___/
                         /____/
endef

export BANNER

# Sourced from: https://marmelab.com/blog/2016/02/29/auto-documented-makefile.html
help: ## List make commands with their descriptions
	@printf "$$BANNER\n\n"
	@printf "\033[33mCommands:\033[0m\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

reset: ## Reset the local development environment
	@printf "🧹 Resetting local development environment INCLUDING DATABASE DATA...\n\n"
	@COMPOSE_CONTAINERS=$$(docker compose ps -aq 2>/dev/null); \
	if [ -n "$$COMPOSE_CONTAINERS" ]; then \
		docker stop $$COMPOSE_CONTAINERS 2>/dev/null || true; \
		docker rm -f $$COMPOSE_CONTAINERS 2>/dev/null || true; \
	fi
	docker compose down -v --remove-orphans
	@COMPOSE_CONTAINERS=$$(docker compose ps -aq 2>/dev/null); \
	if [ -n "$$COMPOSE_CONTAINERS" ]; then \
		printf "Removing remaining containers...\n"; \
		docker rm -f $$COMPOSE_CONTAINERS 2>/dev/null || true; \
	fi
	@COMPOSE_VOLUMES="postgres-data minio-data stt-service-models stt-service-cache tts-service-models tts-service-cache"; \
	for vol in $$COMPOSE_VOLUMES; do \
		docker volume ls -q | grep "^ci-server_$$vol$$" | xargs -r docker volume rm -f 2>/dev/null || true; \
	done
	docker rmi -f ci/postgres ci/api:latest ci/stt-service ci/tts-service ci/nginx 2>/dev/null || true
	docker network prune --force
	@printf "\nLocal development environment successfully reset.\n"

build: ## Build the application
	@printf "🧱 Building the application...\n\n"

	@printf "Building PostgreSQL image...\n\n"
	@docker compose build postgres

	@printf "\nBuilding Speech-to-text service image...\n\n"
	@docker compose build stt-service

	@printf "\nBuilding Text-to-speech service image...\n\n"
	@docker compose build tts-service

	@printf "\nBuilding Summary service image...\n\n"
	@docker compose build summary-service

	@printf "\nCompiling API...\n\n"
	@cd backend/apps/api && yarn clean && yarn build

	@printf "\nBuilding API image...\n\n"
	@docker build -f backend/apps/api/Dockerfile -t $(API_REPO):latest .

	@printf "\nCompiling web frontend...\n\n"
	@cd frontend/apps/web && yarn clean && yarn build

	@printf "\nBuilding webserver image...\n\n"
	@docker build -f infrastructure/nginx/Dockerfile.staging -t $(WEBSERVER_REPO):latest .

	@printf "\nApplication successfully built.\n"

dbclear: ## Clear the PostgreSQL database and start from scratch
	@printf "🧻 Clearing PostgreSQL data...\n\n"
	@cd backend/apps/api && yarn db:clear
	@printf "\nData successfully cleared.\n"

dbdestroy: ## Clear the PostgreSQL database and start from scratch
	@printf "🧨 Destroying PostgreSQL database...\n\n"
	@cd backend/apps/api && yarn db:destroy
	@printf "\nDatabase successfully destroyed. 💥\n"

deploy: ## Deploy the application (staging)
	@printf "🐳 Deploying Companion Intelligence application...\n\n"
	$(MAKE) init
	@printf "\n"
	$(MAKE) build
	@printf "\n"
	$(MAKE) staging

dev: ## DEPRECATED
	$(MAKE) init
	@printf "\n"
	$(MAKE) build
	@printf "\n"
	$(MAKE) local
	@printf "\n"
	$(MAKE) migrate
	@printf "\n"
	$(MAKE) seed
	@printf "\n"
	$(MAKE) index
	@printf "\n"
	$(MAKE) run-dev-session

setup-dev: ## Setup the development environment
	$(MAKE) init
	@printf "\n"
	$(MAKE) local
	@printf "\n"
	$(MAKE) migrate
	@printf "\n"
	$(MAKE) seed

run-dev: ## Run the development environment locally
	$(MAKE) local
	@printf "\n"
	$(MAKE) run-dev-session

run-dev-session:
	@which tmux >/dev/null || { printf "\n$(RED)✗$(RESET) You do not have tmux installed. Please install it first.\n\n"; exit 1; }
	@SESSION="companion"; \
	BACKEND_DIR="backend/apps/api"; \
	FRONTEND_DIR="frontend/apps/web"; \
	\
	if tmux has-session -t $$SESSION 2>/dev/null; then \
		printf "\n🔪 Killing existing tmux session: $$SESSION\n\n"; \
		tmux kill-session -t $$SESSION; \
	fi; \
	\
	printf "🚀 Starting new tmux session: $$SESSION\n\n"; \
	tmux new-session -d -s $$SESSION -c $$BACKEND_DIR; \
	tmux send-keys -t $$SESSION "yarn dev" C-m; \
	\
	tmux split-window -h -t $$SESSION -c $$FRONTEND_DIR; \
	tmux send-keys -t $$SESSION "yarn dev" C-m; \
	\
	tmux select-pane -t 0; \
	tmux attach -t $$SESSION

graphql: ## Generate GraphQL schema and frontend types
	@printf "🏷️ Generating GraphQL...\n\n"

	@yarn workspace @ci/be-api graphql:generate

	@printf "\n"

	@yarn workspace @ci/fe-web graphql:generate

	@printf "\nGraphQL successfully generated.\n"

health: ## Check the repository for prerequisites
	@printf "🩺 Checking health of prerequisites...\n\n"

	@NODEJS=$$(which node 2>/dev/null); \
	if [ -z "$$NODEJS" ]; then \
		printf "$(RED)✗$(RESET) You do not have 'node' installed or it is not in your path. Please install NodeJS v$(shell cat .nvmrc 2>/dev/null || echo '[unknown]') first.\n\n"; \
		exit 1; \
	else \
		printf "$(GREEN)✓$(RESET) NodeJS found at $$NODEJS\n\n"; \
	fi

	@required_version=$$(cat .nvmrc); \
	current_version=$$(node -v | cut -c2-); \
	if [ "$$current_version" != "$$required_version" ]; then \
		printf "$(RED)✗$(RESET) Node version mismatch. Expected $$required_version, but got $$current_version.\n\n"; \
		exit 1; \
	else \
		printf "$(GREEN)✓$(RESET) Node version matches ($$current_version)\n\n"; \
	fi

	@OLLAMA=$$(which ollama 2>/dev/null); \
	if [ -z "$$OLLAMA" ]; then \
		printf "$(RED)✗$(RESET) You do not have 'ollama' installed or it is not in your PATH.\n\n"; \
		exit 1; \
	else \
		printf "$(GREEN)✓$(RESET) ollama found at $$OLLAMA 🦙\n\n"; \
	fi

	@if nc -z localhost 11434 > /dev/null 2>&1; then \
		printf "\t$(GREEN)✓$(RESET) ollama is running on port 11434\n\n"; \
	else \
		printf "\t$(RED)✗$(RESET) ollama is NOT running on port 11434. Please start ollama (e.g., 'ollama serve')\n\n"; \
		exit 1; \
	fi

	@MODEL=nomic-embed-text; \
	ollama list | grep -Fq "$$MODEL"; \
	STATUS=$$?; \
	if [ "$$STATUS" -eq 0 ]; then \
		printf "\t$(GREEN)✓$(RESET) ollama model '$$MODEL' is available\n\n"; \
	else \
		printf "\t$(RED)✗$(RESET) ollama model '$$MODEL' is not yet pulled\n\n"; \
		exit 1; \
	fi

	@MODEL=gemma3:1b; \
	ollama list | grep -Fq "$$MODEL"; \
	STATUS=$$?; \
	if [ "$$STATUS" -eq 0 ]; then \
		printf "\t$(GREEN)✓$(RESET) ollama model '$$MODEL' is available\n\n"; \
	else \
		printf "\t$(RED)✗$(RESET) ollama model '$$MODEL' is not yet pulled\n\n"; \
		exit 1; \
	fi

	@HOST=dev.companionintelligence.com; \
	IP=$$(ping -c 1 -W 1 $$HOST | grep -oE '\(([0-9:.]+)\)' | head -n1 | tr -d '()'); \
	if [ "$$IP" = "127.0.0.1" ] || [ "$$IP" = "::1" ]; then \
		printf "$(GREEN)✓$(RESET) $$HOST resolves to localhost ($$IP)\n\n"; \
	else \
		printf "$(RED)✗$(RESET) $$HOST resolves to $$IP (not localhost)\n\n"; \
		exit 1; \
	fi

init: ## Initialize repository after checkout
	@printf "🏗️ Initializing repository...\n\n"

	@corepack enable
	@corepack prepare yarn@$$(grep '"packageManager"' package.json | cut -d@ -f2 | tr -d '", ') --activate
	@which asdf >/dev/null && asdf reshim nodejs || printf "\n$(YELLOW)•$(RESET) asdf binary not found, skipping reshim step...\n\n"
	@hash -r

	@printf "\n"
	@yarn install

	@printf "\n"
	@yarn dlx @yarnpkg/sdks vscode

	@printf "\n"
	@yarn prepare

	@if [ ! -f .env ]; then \
		printf "\nCopying dotenv template file... "; \
		cp -v .env.default .env; \
	fi

	@printf "\nRepository initialized.\n"

install: ## Install project dependencies
	@printf "📦 Installing dependencies...\n\n"
	@yarn install
	@printf "\nDependencies successfully installed.\n"

local: ## Run the local dependencies from Docker images
	@printf "⌨️ Starting the local services...\n\n"

	@printf "Stopping any staging profile services...\n\n"
	@docker compose down ci-api staging-webserver

	@printf "\nStarting a new local deployment cluster...\n\n"
	@docker compose --profile local up -d

	@printf "\nLocal services successfully started.\n"

migrate: ## Run database migrations
	@printf "🪿 Running database migrations...\n\n"
	@cd backend/apps/api && yarn migrate
	@printf "\nMigrations successfully run.\n"

seed: ## Seed backend database
	@printf "🌱 Seeding database...\n\n"
	@cd backend/apps/api && yarn run exec -- scripts/seed-database/main.ts
	@printf "\nDatabase successfully seeded. 🌳\n"

staging: ## Run the staging server from Docker images
	@printf "🎭 Starting the staging services...\n\n"

	@printf "Stopping any local profile services...\n\n"
	@docker compose down dev-webserver

	@printf "\nStarting a new staging deployment cluster...\n\n"
	@docker compose --profile staging up -d

	@printf "\nStaging services successfully started.\n"

#####################
# API ADMIN SCRIPTS #
#####################

gentoken: ## Generates a stable access token for use during development
	@printf "🔑 Generating stable access token...\n\n"
	@cd backend/apps/api && yarn run exec -- scripts/generate-stable-access-token.ts

signup: ## Generates a set of signup codes for user registration
	@printf "👋 Generating signup codes...\n\n"
	@cd backend/apps/api && yarn run exec -- scripts/generate-signup-codes.ts

userpw: ## Change a user's password
	@printf "🔑 Changing user password...\n\n"
	@cd backend/apps/api && yarn run exec -- scripts/change-password.ts

chatreset: ## Reset John Smith's demo threads
	@printf "🧼 Resetting John Smith's demo threads...\n\n"
	@cd backend/apps/api && yarn db:chatreset
	@printf "\nDemo threads reset.\n"
