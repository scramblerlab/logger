#!/bin/bash
# Start logger in PRODUCTION mode.
#
# Differences from start.sh (dev):
#   - backend binds 127.0.0.1 (not 0.0.0.0) and runs WITHOUT --reload, so it is
#     reachable only through the Cloudflare tunnel, never directly over the LAN
#   - the frontend is BUILT and served by the backend (no Vite dev server)
#   - --proxy-headers + --forwarded-allow-ips lets the app see the real visitor IP
#     (via the tunnel's X-Forwarded-For) instead of 127.0.0.1
#   - python + node deps are synced to the pinned versions on every run
#   - API docs stay disabled (ENABLE_DOCS is left unset)

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
UV_BIN="$(command -v uv || echo "$HOME/.local/bin/uv")"

# --- aimodel proxy check ---
# Ollama is managed by aimodel — this app connects through the proxy on :11431.
OLLAMA_BASE_URL=$(grep -E '^OLLAMA_BASE_URL=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2)
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11431}"

if ! curl -s "${OLLAMA_BASE_URL}/health" &>/dev/null; then
  echo ""
  echo "  ERROR: aimodel proxy not running on ${OLLAMA_BASE_URL}."
  echo "  Start it first:  cd $(dirname "$PROJECT_DIR")/aimodel && ./start.sh"
  echo ""
  exit 1
fi
echo "aimodel proxy ready (${OLLAMA_BASE_URL})"

# --- Backend deps (sync to the pinned, security-patched versions) ---
echo "Syncing backend dependencies..."
cd "$PROJECT_DIR/backend"
[ -d .venv ] || "$UV_BIN" venv .venv
"$UV_BIN" pip install --python .venv/bin/python -r requirements.txt

# --- Frontend build (served by the backend; no dev server in production) ---
echo "Installing frontend dependencies and building..."
cd "$PROJECT_DIR/frontend"
npm ci
npm run build

# --- Backend (production: localhost bind, no reload, trust the tunnel's proxy headers) ---
echo "Starting backend on 127.0.0.1:8000 (production)..."
cd "$PROJECT_DIR/backend"
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
unset ENABLE_DOCS   # API docs stay off in production
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips '127.0.0.1,::1' &
BACKEND_PID=$!

# --- CloudFlare Tunnel (the only public entry point) ---
CF_CONFIG="$PROJECT_DIR/cloudflare/config.yml"
CF_HOSTNAME=$(awk -F'hostname:' '/hostname:/{split($2,a," "); print a[1]; exit}' "$CF_CONFIG")
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
echo "  Backend:  http://127.0.0.1:8000  (localhost only — no LAN access)"
echo "  Public:   https://${CF_HOSTNAME}"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $CLOUDFLARED_PID 2>/dev/null; exit" SIGINT SIGTERM
wait
