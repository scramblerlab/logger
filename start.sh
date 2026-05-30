#!/bin/bash
# Start logger backend + frontend dev servers

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Backend
echo "Starting backend on port 8000..."
cd "$PROJECT_DIR/backend"
ANTHROPIC_API_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d= -f2) \
  DATA_DIR=./data \
  CORS_ORIGINS=http://localhost:5173 \
  .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend dev server
echo "Starting frontend on port 5173..."
cd "$PROJECT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
