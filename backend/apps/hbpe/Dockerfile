# Built from the repository root, not this directory: ci-hbpe is a uv
# workspace member, so it needs the root manifest and the root uv.lock to
# resolve. See the `build` target in the Makefile for the context.

FROM python:3.11-slim-bookworm

# System dependencies — cmake required for the llama-cpp-python build
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    build-essential \
    cmake \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# uv >= 0.9 is required: the workspace members build with the uv_build
# backend, and `uv sync --package` needs workspace support.
COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /usr/local/bin/uv

WORKDIR /app

# Putting the venv on PATH is what lets the entrypoint invoke `uvicorn` and
# `python` directly. PYTHONPATH is deliberately not set: the service is an
# installed distribution now, not a directory on the import path.
ENV VIRTUAL_ENV=/app/.venv \
    PATH=/app/.venv/bin:$PATH \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    MODELS_DIR=/app/models \
    HF_HOME=/app/models/hf_cache

RUN useradd -m -u 1000 hbpe

# ── Locked dependencies ───────────────────────────────────────────────────────
# Only the manifests and the lock, so this layer stays cached until a
# dependency actually changes rather than on every source edit.
#
# Every workspace member's pyproject.toml has to be present even when this
# image does not use it, because uv reads the whole workspace to resolve
# against the single root lock. Adding a member means adding a line here.
# A missing one fails the build loudly, which is the safe direction.
COPY pyproject.toml uv.lock .python-version ./
COPY backend/apps/hbpe/pyproject.toml ./backend/apps/hbpe/pyproject.toml
COPY backend/apps/summary/pyproject.toml ./backend/apps/summary/pyproject.toml

# --locked fails the build if uv.lock does not match the manifests, so an
# image can never be built from an unresolved dependency set. This is the
# reason the lockfile exists; the previous `uv pip install -r pyproject.toml`
# ignored it entirely and re-resolved on every build.
#
# torch is excluded and installed below from a hardware-specific index. The
# CPU/CUDA/ROCm builds are the same version from different indexes, which is
# not something a single lock entry can express.
#
# onnxruntime needs no special handling any more: the marker in ci-hbpe's
# pyproject.toml selects the GPU build on linux-x86_64 and the portable one
# everywhere else, replacing the `sed -i 's/onnxruntime-gpu/onnxruntime/'`
# that used to rewrite the manifest mid-build.
RUN uv sync --locked --package ci-hbpe --no-install-project --no-dev \
    --no-install-package torch

# ── Hardware-specific packages ────────────────────────────────────────────────
# These must come after `uv sync`, not before it. Sync makes the environment
# match the lock exactly, which means it removes anything the lock does not
# mention — including everything installed here.

# CPU-only wheel; no CUDA needed for local dev/testing.
RUN uv pip install --no-cache torch --index-url https://download.pytorch.org/whl/cpu

# llama-cpp-python (JamePeng fork — required for Qwen3.5 support).
#
# The official abetlen/llama-cpp-python on PyPI is frozen at llama.cpp Aug 2025
# and cannot load Qwen3.5 GGUFs (architecture added in llama.cpp b7990, Feb 2026).
# JamePeng's fork tracks llama.cpp HEAD and has confirmed Qwen3.5 support.
#
# This cannot move into pyproject.toml and the lock: it needs a per-package
# build environment variable, which uv has no way to express.
#
# There are no pre-built Linux aarch64 wheels — must build from source.
# GGML_NATIVE=OFF disables -mcpu=native which probes for CPU features (DOTPROD,
# FP16, SVE) that the Docker aarch64 VM doesn't expose — without it the build
# enables those extensions but the assembler rejects them at compile time.
# For native macOS dev (outside Docker) install with Metal instead:
#   CMAKE_ARGS="-DGGML_METAL=ON" FORCE_CMAKE=1 uv pip install \
#     "llama-cpp-python @ git+https://github.com/JamePeng/llama-cpp-python.git"
RUN CMAKE_ARGS="-DGGML_NATIVE=OFF" FORCE_CMAKE=1 \
    uv pip install --no-cache \
      "llama-cpp-python @ git+https://github.com/JamePeng/llama-cpp-python.git"

COPY LICENSE.md /LICENSE.md

# ── Application code ──────────────────────────────────────────────────────────
COPY backend/apps/hbpe/src ./backend/apps/hbpe/src
COPY backend/apps/hbpe/scripts ./scripts
COPY --chmod=755 backend/apps/hbpe/entrypoint.sh ./entrypoint.sh

# `uv pip install`, not a second `uv sync`, because sync would prune the
# hardware-specific packages installed above. --no-deps because the
# dependencies are already installed from the lock.
RUN uv pip install --no-cache --no-deps ./backend/apps/hbpe

# Persistent volumes for model artifacts and token corpus
RUN mkdir -p /app/models/qwen \
             /app/data/token_corpus \
             /app/data/artifacts

RUN chown -R hbpe:hbpe /app

USER hbpe

# HBPE histogram API
EXPOSE 8002

CMD ["./entrypoint.sh"]
