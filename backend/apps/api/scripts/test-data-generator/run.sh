#!/bin/bash
# Quick setup and run script for the graph data generator

echo "🚀 Setting up Graph Test Data Generator..."

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
pip3 install -r requirements.txt

# Check if --family flag is passed
if [[ "$1" == "--family" ]]; then
    echo "🎲 Generating test data with John Smith family demo..."
    python3 generate_graph_data.py \
        --family \
        --num-people 25 \
        --num-companies 6
else
    echo "🎲 Generating test data..."
    echo "💡 Tip: Run './run.sh --family' to include the Smith family demo"
    python3 generate_graph_data.py \
        --num-people 25 \
        --num-companies 6
fi

echo "✅ Test data generation complete!"
echo "You can now test the frontend with the new graph data."
