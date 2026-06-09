#!/bin/bash
# Start logger locally (no Cloudflare tunnel): Ollama + backend + frontend

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Cleanup existing processes ---
pkill -f "uvicorn main:app" 2>/dev/null && echo "Stopped existing backend." || true
pkill -f "vite" 2>/dev/null && echo "Stopped existing frontend." || true
sleep 1

# --- aimodel proxy check ---
# Ollama is managed by aimodel — this app connects through the proxy on :11431.
OLLAMA_BASE_URL=$(grep -E '^OLLAMA_BASE_URL=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2)
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11431}"
OLLAMA_PID=""

if ! curl -s "${OLLAMA_BASE_URL}/health" &>/dev/null; then
  echo ""
  echo "  ERROR: aimodel proxy not running on ${OLLAMA_BASE_URL}."
  echo "  Start it first:  cd $(dirname "$PROJECT_DIR")/aimodel && ./start.sh"
  echo ""
  exit 1
fi
echo "aimodel proxy ready (${OLLAMA_BASE_URL})"

# --- Backend ---
echo "Starting backend on port 8000..."
cd "$PROJECT_DIR/backend"
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# --- Frontend ---
echo "Building frontend..."
cd "$PROJECT_DIR/frontend"
npm run build
echo "Starting frontend on port 5173..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
