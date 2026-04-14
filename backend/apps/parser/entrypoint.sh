#!/bin/bash
set -e

exec uvicorn src.main:app \
  --host "${PARSER_HOST:-0.0.0.0}" \
  --port "${PARSER_PORT:-8002}" \
  --log-level info
