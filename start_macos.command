#!/bin/bash
# Startet Planner-Agent lokal unter macOS: Backend (FastAPI) und Frontend
# (Next.js) jeweils in einem eigenen Terminal-Fenster.
#
# Ermittelt den eigenen Speicherort als Projektstamm, funktioniert also
# unabhängig davon, aus welchem Ordner das Skript aufgerufen/doppelgeklickt
# wird.
set -u

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

echo "Planner-Agent - lokaler Start"
echo "Projektstamm: $PROJECT_ROOT"
echo

# ---------- Python-Umgebung ermitteln ----------
PYTHON=""
if [ -x "$PROJECT_ROOT/.venv/bin/python" ]; then
  PYTHON="$PROJECT_ROOT/.venv/bin/python"
elif [ -x "$PROJECT_ROOT/venv/bin/python" ]; then
  # Abwärtskompatibel zum bisherigen, nicht versteckten Ordnernamen.
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
  echo "Fehler: Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren."
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
  lsof -ti ":$1" >/dev/null 2>&1
}

if port_busy 8000; then
  echo "Fehler: Port 8000 ist bereits belegt (vermutlich läuft schon ein Backend)."
  echo "Bitte den bestehenden Prozess prüfen/beenden oder BACKEND_PORT setzen."
  exit 1
fi
if port_busy 3000; then
  echo "Fehler: Port 3000 ist bereits belegt (vermutlich läuft schon ein Frontend)."
  echo "Bitte den bestehenden Prozess prüfen/beenden oder einen anderen Port verwenden."
  exit 1
fi

# ---------- Backend und Frontend in eigenen Terminal-Fenstern starten ----------
open_terminal_window() {
  # $1 = auszuführender Befehl (als String, in eigenem Fenster ausgeführt)
  osascript <<EOF
tell application "Terminal"
  activate
  do script "cd \"$PROJECT_ROOT\" && $1"
end tell
EOF
}

echo "Starte Backend (eigenes Fenster) ..."
open_terminal_window "\"$PYTHON\" -m backend.run_local"

echo "Starte Frontend (eigenes Fenster) ..."
open_terminal_window "cd frontend && $PKG_RUN dev"

# ---------- Auf Erreichbarkeit warten (kurzes Polling statt langer fester Wartezeit) ----------
wait_for() {
  local url="$1"
  local label="$2"
  for _ in $(seq 1 60); do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo "$label ist erreichbar."
      return 0
    fi
    sleep 0.5
  done
  echo "Warnung: $label war nach 30 Sekunden noch nicht erreichbar - im jeweiligen Fenster nachsehen."
  return 1
}

wait_for "http://127.0.0.1:8000/api/health" "Backend"
wait_for "http://localhost:3000" "Frontend"

if command -v open >/dev/null 2>&1; then
  open "http://localhost:3000"
fi

echo
echo "Planner-Agent läuft. Backend und Frontend laufen in eigenen Fenstern -"
echo "zum Beenden dort jeweils Strg+C drücken oder das Fenster schließen."
