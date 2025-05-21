.PHONY: help dev init install migrate
.DEFAULT_GOAL := help

RED=\033[0;31m
GREEN=\033[0;32m
YELLOW=\033[0;33m
RESET=\033[0m

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
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

dev:
	@which tmux >/dev/null || { printf "\n$(RED)✗$(RESET) You do not have tmux installed. Please install it first.\n\n"; exit 1; };

	@printf "🐳 Starting Docker dependencies...\n\n"
	@docker compose --profile local up -d
	@printf "\n"

	@SESSION="companion-dev"; \
	BACKEND_DIR="backend/apps/api"; \
	FRONTEND_DIR="frontend/apps/web"; \
	\
	if tmux has-session -t $$SESSION 2>/dev/null; then \
		printf "\n🔪 Killing existing tmux session: $$SESSION\n\n"; \
		tmux kill-session -t $$SESSION; \
		printf "You can now re-run: make dev\n"; \
		exit 0; \
	fi; \
	\
	printf "🚀 Starting new tmux session: $$SESSION\n\n"; \
	tmux new-session -d -s $$SESSION -c $$BACKEND_DIR; \
	tmux send-keys -t $$SESSION "yarn dev | yarn pino-pretty" C-m; \
	\
	tmux split-window -h -t $$SESSION -c $$FRONTEND_DIR; \
	tmux send-keys -t $$SESSION "yarn dev" C-m; \
	\
	tmux select-pane -t 0; \
	tmux attach -t $$SESSION

init: ## Initialize repository after checkout
	@printf "🏗️ Initializing repository...\n\n"

	@which node >/dev/null || { printf "$(RED)✗$(RESET) You do not have NodeJS installed. Please install NodeJS v$(shell cat .nvmrc 2>/dev/null || echo '[unknown]') first.\n\n"; exit 1; }

	@required_version=$$(cat .nvmrc); \
	current_version=$$(node -v | cut -c2-); \
	if [ "$$current_version" != "$$required_version" ]; then \
		printf "$(RED)✗$(RESET) Node version mismatch. Expected $$required_version, but got $$current_version.\n\n"; \
		exit 1; \
	else \
		printf "$(GREEN)✓$(RESET) Node version matches ($$current_version)\n\n"; \
	fi

	@HOST=dev.companionintelligence.com; \
	IP=$$(ping -c 1 -W 1 $$HOST | grep -oE '\(([0-9:.]+)\)' | tr -d '()'); \
	if [ "$$IP" = "127.0.0.1" ] || [ "$$IP" = "::1" ]; then \
		printf "$(GREEN)✓$(RESET) $$HOST resolves to localhost ($$IP)\n\n"; \
	else \
		printf "$(RED)✗$(RESET) $$HOST resolves to $$IP (not localhost)\n\n"; \
		exit 1; \
	fi

	@corepack enable
	@corepack prepare yarn@$$(grep '"packageManager"' package.json | cut -d@ -f2 | tr -d '", ') --activate
	@which asdf >/dev/null && asdf reshim nodejs || printf "\n$(YELLOW)•$(RESET) asdf binary not found, skipping reshim step...\n\n"
	@hash -r

	@printf "\n"
	@yarn install
	@printf "\n"
	@yarn dlx @yarnpkg/sdks vscode
	@printf "\nRepository initialized.\n"

install: ## Install project dependencies
	@printf "📦 Installing dependencies...\n\n"
	@yarn install
	@printf "\nDependencies successfully installed.\n"

migrate: ## Run database migrations
	@printf "🪿 Running database migrations...\n\n"
	@cd backend/apps/api && yarn migrate
	@printf "\nMigrations successfully run.\n"
