#!/bin/bash
# First-time setup for logger
# Run once after cloning: ./setup.sh

set -e
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== logger setup ==="
echo ""

# --- Python backend ---
echo "[1/4] Setting up Python virtual environment..."
cd "$PROJECT_DIR/backend"
if [ ! -d ".venv" ]; then
  uv venv .venv --python 3.12
fi
uv pip install -r requirements.txt
echo "      Done."

# --- .env ---
if [ ! -f "$PROJECT_DIR/backend/.env" ]; then
  echo "[2/4] Creating backend/.env from template..."
  cp "$PROJECT_DIR/backend/.env.example" "$PROJECT_DIR/backend/.env"
  echo "      ⚠  Edit backend/.env if needed (DATA_DIR, CORS_ORIGINS, etc.)"
else
  echo "[2/4] backend/.env already exists, skipping."
fi

# --- Frontend ---
echo "[3/4] Installing frontend dependencies..."
cd "$PROJECT_DIR/frontend"
npm install
echo "      Done."

# --- Ollama ---
echo "[4/4] Setting up Ollama..."

if ! command -v ollama &>/dev/null; then
  echo "      Installing Ollama via Homebrew..."
  brew install ollama
else
  echo "      Ollama already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
fi

# Start ollama serve in background if not already running
if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
  echo "      Starting ollama serve..."
  ollama serve &>/tmp/ollama.log &
  sleep 3
fi

# Determine model from .env, fall back to default
OLLAMA_MODEL=$(grep -E '^OLLAMA_MODEL=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2)
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3.5:4b}"

# Check if model is already pulled
if ollama list 2>/dev/null | grep -q "^${OLLAMA_MODEL}"; then
  echo "      Model ${OLLAMA_MODEL} already pulled."
else
  echo "      Pulling ${OLLAMA_MODEL} (this may take a few minutes)..."
  ollama pull "$OLLAMA_MODEL"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "  Start the app:  ./start.sh"
echo "  Import page:    http://localhost:5173/import"
echo "  API docs:       http://localhost:8000/docs"
echo ""
echo "  AI provider is set to: $(grep -E '^AI_PROVIDER=' "$PROJECT_DIR/backend/.env" 2>/dev/null | cut -d= -f2 || echo 'ollama (default)')"
echo "  Model:          ${OLLAMA_MODEL}"
echo ""
