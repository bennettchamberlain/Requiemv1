#!/bin/bash
# Entrypoint script to run both the Temporal worker and the API server

set -e

echo "Starting CI-Summary services..."

# Start the FastAPI server in the background
echo "Starting FastAPI API server on port 8001..."
uvicorn src.api:app --host 0.0.0.0 --port 8001 &
API_PID=$!

# Give the API a moment to start
sleep 2

# Start the Temporal worker service in the foreground
echo "Starting Temporal worker..."
python -m src.worker &
WORKER_PID=$!

# Give the worker a moment to connect to Temporal
sleep 3

# Set up system schedules (idempotent - skips existing schedules)
echo "Setting up system schedules..."
python -m src.system_schedules setup || echo "Warning: Failed to set up schedules (Temporal may not be ready)"

# Function to handle shutdown gracefully
shutdown() {
    echo "Shutting down services..."
    kill $API_PID $WORKER_PID 2>/dev/null || true
    wait $API_PID $WORKER_PID 2>/dev/null || true
    exit 0
}

# Trap SIGTERM and SIGINT
trap shutdown SIGTERM SIGINT

# Wait for both processes
wait $API_PID $WORKER_PID
