#!/bin/bash
# Start logger locally (no Cloudflare tunnel): Ollama + backend + frontend

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Cleanup existing processes ---
pkill -f "uvicorn main:app" 2>/dev/null && echo "Stopped existing backend." || true
pkill -f "vite" 2>/dev/null && echo "Stopped existing frontend." || true
sleep 1

# --- Ollama ---
OLLAMA_MODEL=$(grep -E '^OLLAMA_MODEL=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2)
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"
OLLAMA_BASE_URL=$(grep -E '^OLLAMA_BASE_URL=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2)
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"

if ! curl -s "${OLLAMA_BASE_URL}/api/tags" &>/dev/null; then
  echo "Starting Ollama..."
  ollama serve &>/tmp/ollama.log &
  OLLAMA_PID=$!
  sleep 2
else
  OLLAMA_PID=""
fi

if ! ollama list 2>/dev/null | grep -q "^${OLLAMA_MODEL}"; then
  echo "Model ${OLLAMA_MODEL} not found. Run: ollama pull ${OLLAMA_MODEL}"
  exit 1
fi
echo "Ollama ready (model: ${OLLAMA_MODEL})"

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

trap "kill $BACKEND_PID $FRONTEND_PID ${OLLAMA_PID:-} 2>/dev/null; exit" SIGINT SIGTERM
wait
