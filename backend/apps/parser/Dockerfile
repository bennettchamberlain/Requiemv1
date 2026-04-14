FROM python:3.11.12-slim-bookworm

WORKDIR /app

RUN useradd -m -u 1000 parser

RUN apt-get update && apt-get install -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5.18 /uv /usr/local/bin/uv

# Copy dependency files first for better caching
COPY pyproject.toml ./

# Install dependencies
RUN uv pip install --system --no-cache -r pyproject.toml

# Copy application code
COPY src/ ./src/
COPY entrypoint.sh ./

RUN chmod +x entrypoint.sh && chown -R parser:parser /app

USER parser

EXPOSE 8002

# ──────────────────────────────────────────────────
# Environment Variables
#
# Optional:
#   PARSER_HOST     Bind host [0.0.0.0]
#   PARSER_PORT     Bind port [8002]
# ──────────────────────────────────────────────────

CMD ["./entrypoint.sh"]
