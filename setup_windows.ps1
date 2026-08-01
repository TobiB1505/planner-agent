# Einmalige lokale Einrichtung unter Windows: virtuelle Python-Umgebung,
# Backend-Abhaengigkeiten, Frontend-Abhaengigkeiten, lokale Laufzeitordner.
#
# Ueberschreibt nie vorhandene Daten: eine bestehende .venv oder ein
# bestehendes frontend\node_modules werden nicht angetastet. Erzeugt keine
# Datenbank und keine Excel-Vorlagen - das uebernimmt backend\run_local.py
# bzw. bleibt Aufgabe des Nutzers.

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "Planner-Agent - einmalige Einrichtung (Windows)" -ForegroundColor Cyan
Write-Host "Projektstamm: $ProjectRoot"
Write-Host ""

# ---------- Python pruefen ----------
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: Python wurde nicht gefunden. Bitte von https://python.org installieren." -ForegroundColor Red
    exit 1
}

# ---------- Virtuelle Umgebung ----------
$VenvPath = Join-Path $ProjectRoot ".venv"
if (Test-Path $VenvPath) {
    Write-Host "Virtuelle Umgebung .venv existiert bereits - wird nicht veraendert."
} else {
    Write-Host "Lege virtuelle Umgebung .venv an ..."
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Fehler beim Anlegen der virtuellen Umgebung." -ForegroundColor Red
        exit 1
    }
}

$PythonPath = Join-Path $VenvPath "Scripts\python.exe"

Write-Host "Installiere Backend-Abhaengigkeiten (backend\requirements.txt) ..."
& $PythonPath -m pip install --upgrade pip
& $PythonPath -m pip install -r (Join-Path $ProjectRoot "backend\requirements.txt")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Fehler bei der Installation der Backend-Abhaengigkeiten." -ForegroundColor Red
    exit 1
}

# ---------- Node.js / Frontend-Abhaengigkeiten ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren." -ForegroundColor Red
    exit 1
}

$FrontendDir = Join-Path $ProjectRoot "frontend"
if (Test-Path (Join-Path $FrontendDir "node_modules")) {
    Write-Host "frontend\node_modules existiert bereits - wird nicht veraendert."
} else {
    Write-Host "Installiere Frontend-Abhaengigkeiten (npm install) ..."
    Push-Location $FrontendDir
    npm install
    $npmExit = $LASTEXITCODE
    Pop-Location
    if ($npmExit -ne 0) {
        Write-Host "Fehler bei npm install." -ForegroundColor Red
        exit 1
    }
}

# ---------- Lokale Laufzeitordner ----------
Write-Host "Lege lokale Laufzeitordner an (local_data\...) ..."
& $PythonPath -c "from backend.config.paths import ensure_runtime_directories; ensure_runtime_directories()"

Write-Host ""
Write-Host "Einrichtung abgeschlossen." -ForegroundColor Green
Write-Host "Start der Anwendung: .\start_windows.ps1"
