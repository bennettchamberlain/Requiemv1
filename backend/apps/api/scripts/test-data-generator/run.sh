#!/bin/bash
# Quick setup and run script for the graph data generator using uv

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_VERSION="${PYTHON_VERSION:-3.11}"

if ! command -v uv >/dev/null 2>&1; then
    echo "❌ uv is required but not installed"
    exit 1
fi

echo "🚀 Setting up Graph Test Data Generator..."

echo "🐍 Ensuring Python ${PYTHON_VERSION} is available via uv..."
uv python install "$PYTHON_VERSION"

echo "📦 Syncing dependencies from pyproject.toml / uv.lock..."
uv sync --python "$PYTHON_VERSION" --frozen

# Check if --family flag is passed
FLAG="${1:-}"

if [[ "$FLAG" == "--family" ]]; then
    echo "🎲 Generating test data with John Smith family demo..."
    uv run --python "$PYTHON_VERSION" python generate_graph_data.py \
        --family \
        --num-people 25 \
        --num-companies 6
else
    echo "🎲 Generating test data..."
    echo "💡 Tip: Run './run.sh --family' to include the Smith family demo"
    uv run --python "$PYTHON_VERSION" python generate_graph_data.py \
        --num-people 25 \
        --num-companies 6
fi

echo "✅ Test data generation complete!"
echo "You can now test the frontend with the new graph data."
