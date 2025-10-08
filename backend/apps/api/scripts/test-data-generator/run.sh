#!/bin/bash
# Quick setup and run script for the graph data generator using pyenv + uv

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON_VERSION="${PYTHON_VERSION:-3.11.9}"
VENV_DIR="${VENV_DIR:-${SCRIPT_DIR}/.venv}"

PYENV_ROOT="${PYENV_ROOT:-$HOME/.pyenv}"
export PYENV_ROOT
export PATH="$PYENV_ROOT/bin:$PATH"

if ! command -v pyenv >/dev/null 2>&1; then
    echo "❌ pyenv is required but not installed"
    exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
    echo "❌ uv is required but not installed"
    exit 1
fi

echo "🚀 Setting up Graph Test Data Generator..."

# Ensure pyenv is initialized for this shell session
eval "$(pyenv init -)"
if command -v pyenv virtualenv-init >/dev/null 2>&1; then
    eval "$(pyenv virtualenv-init -)"
fi

echo "🐍 Ensuring Python ${PYTHON_VERSION} is available via pyenv..."
pyenv install -s "$PYTHON_VERSION"

pyenv shell "$PYTHON_VERSION"

PYTHON_BIN="$(pyenv which python)"

if [[ ! -d "$VENV_DIR" ]]; then
    echo "✨ Creating virtual environment at ${VENV_DIR} via uv"
    uv venv "$VENV_DIR" --python "$PYTHON_BIN"
fi

VENV_PYTHON="${VENV_DIR}/bin/python"

if [[ ! -x "$VENV_PYTHON" ]]; then
    echo "❌ Expected virtual environment python at ${VENV_PYTHON}"
    exit 1
fi

echo "📦 Installing dependencies with uv..."
uv pip install --python "$VENV_PYTHON" --requirement requirements.txt

# Check if --family flag is passed
FLAG="${1:-}"

if [[ "$FLAG" == "--family" ]]; then
    echo "🎲 Generating test data with John Smith family demo..."
    "$VENV_PYTHON" generate_graph_data.py \
        --family \
        --num-people 25 \
        --num-companies 6
else
    echo "🎲 Generating test data..."
    echo "💡 Tip: Run './run.sh --family' to include the Smith family demo"
    "$VENV_PYTHON" generate_graph_data.py \
        --num-people 25 \
        --num-companies 6
fi

echo "✅ Test data generation complete!"
echo "You can now test the frontend with the new graph data."
