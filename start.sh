#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -d .venv ]]; then python3 -m venv .venv; fi
.venv/bin/pip install -r backend/requirements.txt
if [[ "${1:-}" == "--demo" ]]; then
  export DEMO_MODE=true EXPO_PUBLIC_DEMO_MODE=1
  export EXPO_PUBLIC_API_BASE_URL="${EXPO_PUBLIC_API_BASE_URL:-http://localhost:8000}"
else
  export DEMO_MODE=false EXPO_PUBLIC_DEMO_MODE=0
fi
.venv/bin/uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 &
api_pid=$!
trap 'kill "$api_pid" 2>/dev/null || true' EXIT INT TERM
cd frontend
npm install
npx expo start
