#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

# Start FastAPI backend
.venv/bin/uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Start Vite dev server
cd frontend && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
echo "Backend: http://localhost:8000  |  Frontend: http://localhost:5173"
wait
