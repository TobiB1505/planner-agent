#!/bin/bash
set -e

cd "$(dirname "$0")"

if [ ! -d venv ]; then
  python3 -m venv venv
  ./venv/bin/pip install --upgrade pip -q
  ./venv/bin/pip install -r requirements.txt -q
fi

if [ ! -d frontend/node_modules ]; then
  npm --prefix frontend install
fi

echo "Planner-Agent wird vorbereitet …"
npm --prefix frontend run build

./venv/bin/python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 > .dienstplan-api.log 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

BACKEND_READY=0
for _ in {1..50}; do
  if curl -sf "http://127.0.0.1:8000/api/health" > /dev/null; then
    BACKEND_READY=1
    break
  fi
  sleep 0.2
done

if [ "$BACKEND_READY" -ne 1 ]; then
  echo "Das Backend konnte nicht gestartet werden. Details stehen in .dienstplan-api.log."
  exit 1
fi

(sleep 2; open "http://localhost:3000") &

echo "Die App öffnet sich gleich im Browser."
echo "Dieses Fenster bitte geöffnet lassen. Zum Beenden Strg+C drücken."
npm --prefix frontend run start
