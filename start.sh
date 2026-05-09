#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "node not found. Please install Node.js (recommended 18+)."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Please install npm."
  exit 1
fi

if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "[astrag] Installing dependencies..."
  npm install
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" >/dev/null 2>&1 || true; fi
  if [ -n "${FRONTEND_PID:-}" ]; then kill "$FRONTEND_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

echo "[astrag] Starting backend on http://localhost:8787 ..."
npm run dev -w backend >/tmp/astrag-backend.log 2>&1 &
BACKEND_PID="$!"

echo "[astrag] Starting frontend on http://localhost:5173 ..."
npm run dev -w frontend >/tmp/astrag-frontend.log 2>&1 &
FRONTEND_PID="$!"

echo
echo "[astrag] Running."
echo "  - Frontend: http://localhost:5173/"
echo "  - Backend:  http://localhost:8787/"
echo
echo "[astrag] Logs:"
echo "  - /tmp/astrag-backend.log"
echo "  - /tmp/astrag-frontend.log"
echo
echo "Press Ctrl+C to stop."

wait "$BACKEND_PID" "$FRONTEND_PID"

