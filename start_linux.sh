#!/bin/bash
# Startet Planner-Agent lokal unter Linux. Anders als unter macOS gibt es
# kein einheitliches "neues Terminal-Fenster öffnen" - Backend und Frontend
# laufen deshalb als Hintergrundprozesse dieses Skripts, mit Logs im
# Projektstamm. Zum Beenden: Strg+C in diesem Fenster.
set -u

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "Planner-Agent - lokaler Start (Linux)"
echo "Projektstamm: $PROJECT_ROOT"
echo

# ---------- Python-Umgebung ermitteln ----------
PYTHON=""
if [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif [ -x "$PROJECT_ROOT/venv/bin/python" ]; then
  PYTHON="$PROJECT_ROOT/venv/bin/python"
else
  echo "Fehler: Keine virtuelle Python-Umgebung gefunden (.venv oder venv)."
  echo "Bitte einmalig einrichten:"
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  python -m pip install --upgrade pip"
  echo "  pip install -r backend/requirements.txt"
  exit 1
fi
echo "Python-Umgebung: $PYTHON"

# ---------- Node.js / Package Manager ermitteln ----------
if ! command -v node >/dev/null 2>&1; then
  echo "Fehler: Node.js wurde nicht gefunden. Bitte über den Paketmanager der Distribution installieren."
  exit 1
fi

PKG_MANAGER="npm"
PKG_RUN="npm run"
if [ -f "$PROJECT_ROOT/frontend/pnpm-lock.yaml" ] && command -v pnpm >/dev/null 2>&1; then
  PKG_MANAGER="pnpm"
  PKG_RUN="pnpm run"
elif [ -f "$PROJECT_ROOT/frontend/yarn.lock" ] && command -v yarn >/dev/null 2>&1; then
  PKG_MANAGER="yarn"
  PKG_RUN="yarn"
elif ! command -v npm >/dev/null 2>&1; then
  echo "Fehler: npm wurde nicht gefunden. Bitte Node.js (inkl. npm) installieren."
  exit 1
fi
echo "Package Manager: $PKG_MANAGER"

if [ ! -d "$PROJECT_ROOT/frontend/node_modules" ]; then
  echo "Fehler: frontend/node_modules fehlt."
  echo "Bitte einmalig einrichten:"
  echo "  cd frontend && $PKG_MANAGER install"
  exit 1
fi

# ---------- Ports prüfen (fremde Prozesse werden nicht beendet) ----------
port_busy() {
  (command -v lsof >/dev/null 2>&1 && lsof -ti ":$1" >/dev/null 2>&1) || \
  (command -v ss >/dev/null 2>&1 && ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1")
}

if port_busy 8000; then
  echo "Fehler: Port 8000 ist bereits belegt (vermutlich läuft schon ein Backend)."
  exit 1
fi
if port_busy 3000; then
  echo "Fehler: Port 3000 ist bereits belegt (vermutlich läuft schon ein Frontend)."
  exit 1
fi

# ---------- Backend und Frontend als Hintergrundprozesse starten ----------
mkdir -p "$PROJECT_ROOT/local_data"
BACKEND_LOG="$PROJECT_ROOT/local_data/.backend.log"
FRONTEND_LOG="$PROJECT_ROOT/local_data/.frontend.log"

echo "Starte Backend ..."
"$PYTHON" -m backend.run_local > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

echo "Starte Frontend ..."
(cd frontend && $PKG_RUN dev) > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  echo
  echo "Beende Backend und Frontend ..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for() {
  local url="$1"
  local label="$2"
  local log="$3"
  for _ in $(seq 1 60); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "$label ist erreichbar."
      return 0
    fi
    sleep 0.5
  done
  echo "Warnung: $label war nach 30 Sekunden noch nicht erreichbar - siehe $log"
  return 1
}

wait_for "http://127.0.0.1:8000/api/health" "Backend" "$BACKEND_LOG"
wait_for "http://localhost:3000" "Frontend" "$FRONTEND_LOG"

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:3000" >/dev/null 2>&1 &
fi

echo
echo "Planner-Agent läuft. Logs: $BACKEND_LOG / $FRONTEND_LOG"
echo "Zum Beenden Strg+C drücken."
wait
