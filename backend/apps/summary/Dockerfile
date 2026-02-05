FROM python:3.11.12-slim-bookworm

WORKDIR /app

RUN useradd -m -u 1000 memorizer

RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:0.5.18 /uv /usr/local/bin/uv

# Copy dependency files first for better caching
COPY pyproject.toml uv.lock ./

# Install dependencies from lock file (without project structure)
RUN uv pip install --system --no-cache -r pyproject.toml

# Copy application code
COPY src/ ./src/
COPY entrypoint.sh ./

# Make entrypoint executable and set ownership
RUN chmod +x entrypoint.sh && chown -R memorizer:memorizer /app

USER memorizer

# Expose API port
EXPOSE 8001

CMD ["./entrypoint.sh"]
