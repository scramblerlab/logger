#!/bin/bash
# Start logger: Ollama + backend + frontend

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

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

# --- CloudFlare Tunnel ---
CF_CONFIG="$PROJECT_DIR/cloudflare/config.yml"
CF_HOSTNAME=$(grep -E '^\s+hostname:' "$CF_CONFIG" | head -1 | awk '{print $2}')
echo "Starting CloudFlare tunnel (exposing https://${CF_HOSTNAME})..."
cloudflared tunnel --config "$CF_CONFIG" run &>/tmp/cloudflared.log &
CLOUDFLARED_PID=$!
sleep 2
if kill -0 "$CLOUDFLARED_PID" 2>/dev/null; then
  echo "CloudFlare tunnel running -> https://${CF_HOSTNAME}"
else
  echo "CloudFlare tunnel failed to start. Check /tmp/cloudflared.log"
fi

echo ""
echo "  Backend:  http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo "  API docs: http://localhost:8000/docs"
echo "  Public:   https://log.scrambler-lab.com"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID $CLOUDFLARED_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
