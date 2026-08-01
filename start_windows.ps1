# Startet Planner-Agent lokal unter Windows: Backend (FastAPI) und Frontend
# (Next.js) jeweils in einem eigenen PowerShell-Fenster.
#
# Ermittelt den eigenen Speicherort als Projektstamm, funktioniert also
# unabhaengig vom aktuellen Arbeitsverzeichnis.

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "Planner-Agent - lokaler Start" -ForegroundColor Cyan
Write-Host "Projektstamm: $ProjectRoot"
Write-Host ""

# ---------- Python-Umgebung ermitteln ----------
$PythonPath = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    $LegacyPythonPath = Join-Path $ProjectRoot "venv\Scripts\python.exe"
    if (Test-Path $LegacyPythonPath) {
        $PythonPath = $LegacyPythonPath
    } else {
        Write-Host "Fehler: Keine virtuelle Python-Umgebung gefunden (.venv oder venv)." -ForegroundColor Red
        Write-Host "Bitte einmalig einrichten:"
        Write-Host "  python -m venv .venv"
        Write-Host "  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass"
        Write-Host "  .\.venv\Scripts\Activate.ps1"
        Write-Host "  python -m pip install --upgrade pip"
        Write-Host "  pip install -r backend\requirements.txt"
        exit 1
    }
}
Write-Host "Python-Umgebung: $PythonPath"

# ---------- Node.js / Package Manager ermitteln ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: Node.js wurde nicht gefunden. Bitte von https://nodejs.org installieren." -ForegroundColor Red
    exit 1
}

$FrontendDir = Join-Path $ProjectRoot "frontend"
$PkgManager = "npm"
$PkgRun = "npm run"
if ((Test-Path (Join-Path $FrontendDir "pnpm-lock.yaml")) -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $PkgManager = "pnpm"
    $PkgRun = "pnpm run"
} elseif ((Test-Path (Join-Path $FrontendDir "yarn.lock")) -and (Get-Command yarn -ErrorAction SilentlyContinue)) {
    $PkgManager = "yarn"
    $PkgRun = "yarn"
} elseif (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Fehler: npm wurde nicht gefunden. Bitte Node.js (inkl. npm) installieren." -ForegroundColor Red
    exit 1
}
Write-Host "Package Manager: $PkgManager"

if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "Fehler: frontend\node_modules fehlt." -ForegroundColor Red
    Write-Host "Bitte einmalig einrichten:"
    Write-Host "  cd frontend; $PkgManager install"
    exit 1
}

# ---------- Ports pruefen (fremde Prozesse werden nicht beendet) ----------
function Test-PortBusy {
    param([int]$Port)
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -ne $connections
}

if (Test-PortBusy -Port 8000) {
    Write-Host "Fehler: Port 8000 ist bereits belegt (vermutlich laeuft schon ein Backend)." -ForegroundColor Red
    Write-Host "Bitte den bestehenden Prozess pruefen/beenden oder BACKEND_PORT setzen."
    exit 1
}
if (Test-PortBusy -Port 3000) {
    Write-Host "Fehler: Port 3000 ist bereits belegt (vermutlich laeuft schon ein Frontend)." -ForegroundColor Red
    Write-Host "Bitte den bestehenden Prozess pruefen/beenden oder einen anderen Port verwenden."
    exit 1
}

# ---------- Backend und Frontend in eigenen Fenstern starten ----------
Write-Host "Starte Backend (eigenes Fenster) ..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$ProjectRoot'; & '$PythonPath' -m backend.run_local"
)

Write-Host "Starte Frontend (eigenes Fenster) ..."
Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "Set-Location '$FrontendDir'; $PkgRun dev"
)

# ---------- Auf Erreichbarkeit warten (kurzes Polling statt langer fester Wartezeit) ----------
function Wait-ForUrl {
    param([string]$Url, [string]$Label)
    for ($i = 0; $i -lt 60; $i++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                Write-Host "$Label ist erreichbar." -ForegroundColor Green
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    Write-Host "Warnung: $Label war nach 30 Sekunden noch nicht erreichbar - im jeweiligen Fenster nachsehen." -ForegroundColor Yellow
    return $false
}

Wait-ForUrl -Url "http://127.0.0.1:8000/api/health" -Label "Backend" | Out-Null
Wait-ForUrl -Url "http://localhost:3000" -Label "Frontend" | Out-Null

Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "Planner-Agent laeuft. Backend und Frontend laufen in eigenen Fenstern -" -ForegroundColor Cyan
Write-Host "zum Beenden dort jeweils Strg+C druecken oder das Fenster schliessen."
