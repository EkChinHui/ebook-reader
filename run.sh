#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building frontend..."
cd frontend && npm run build && cd ..

echo "Starting server on http://localhost:8000"
uv run uvicorn backend.server:app --host 0.0.0.0 --port 8000
