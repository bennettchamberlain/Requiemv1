# Built from the repository root, not this directory: ci-summary is a uv
# workspace member, so it needs the root manifest and the root uv.lock to
# resolve. See the `build` target in the Makefile for the context.

FROM python:3.11.12-slim-bookworm

WORKDIR /app

COPY LICENSE.md /LICENSE.md

RUN useradd -m -u 1000 memorizer

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# uv >= 0.9 is required: the workspace members build with the uv_build
# backend, and `uv sync --package` needs workspace support.
COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /usr/local/bin/uv

# Install into the system interpreter rather than a virtualenv, so the
# entrypoint can invoke `uvicorn` and `python -m` directly with no
# activation step.
ENV UV_PROJECT_ENVIRONMENT=/usr/local \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependency layer. Only the manifests and the lock, so it stays cached
# until a dependency actually changes rather than on every source edit.
#
# Every workspace member's pyproject.toml has to be present even when this
# image does not use it, because uv reads the whole workspace to resolve
# against the single root lock. Adding a member means adding a line here.
# A missing one fails the build loudly, which is the safe direction.
COPY pyproject.toml uv.lock .python-version ./
COPY backend/apps/summary/pyproject.toml ./backend/apps/summary/pyproject.toml

# --locked fails the build if uv.lock does not match the manifests, so an
# image can never be built from an unresolved dependency set. This is the
# reason the lockfile exists; the previous `uv pip install -r
# pyproject.toml` ignored it entirely and re-resolved on every build.
RUN uv sync --locked --package ci-summary --no-install-project --no-dev

COPY backend/apps/summary/src ./backend/apps/summary/src

RUN uv sync --locked --package ci-summary --no-dev --no-editable

COPY --chmod=755 backend/apps/summary/entrypoint.sh ./entrypoint.sh

RUN chown -R memorizer:memorizer /app

USER memorizer

# Expose API ports
EXPOSE 8001
EXPOSE 8002

# ──────────────────────────────────────────────────
# Environment Variables
#
# Secrets are loaded from a shared secrets file or
# from environment variables set by Docker Compose.
# Non-secret config (models, etc.) lives in
# src/ci/summary/config.py.
#
# Required (no default — will not start without these):
#   DATABASE_PASSWORD          PostgreSQL password (if DATABASE_URL not set)
#
# Optional:
#   DATABASE_HOST              PostgreSQL host [database]
#   DATABASE_NAME              PostgreSQL database name [companion]
#   DATABASE_PORT              PostgreSQL port [5432]
#   DATABASE_URL               Full connection string (overrides individual DB vars)
#   DATABASE_USERNAME          PostgreSQL username [companion]
#   LLM_API_KEY                API key for remote LLM providers (not needed for Ollama)
#   SECRETS_FILE               Path to secrets file [/run/secrets/.env.secrets]
# ──────────────────────────────────────────────────

CMD ["./entrypoint.sh"]
