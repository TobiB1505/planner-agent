# Planner-Agent

Dienstplan-Assistent für ein Entertainment-Team im Hotel: Wochenpläne
erstellen und pflegen, Aufgaben fair auf das Team rotieren lassen, Show-/
Künstlerprogramm und Probenzeiten berücksichtigen und alles als echte Excel-
Datei exportieren.

- **Frontend:** Next.js (React, TypeScript) - Plan-Editor, Dashboard, Team-
  und Archivverwaltung im Browser.
- **Backend:** FastAPI (Python) - Datenhaltung, Rotationslogik, Excel-Import/
  -Export, PDF-Extraktion.
- **Datenbank:** lokale SQLite-Datei - keine Cloud, keine externen Dienste.
- **Dienstplanarchiv:** lokaler Ordner für historische Dienstplan-Dateien.
- **Excel-Vorlagen:** feste, mit dem Code ausgelieferte Grundvorlagen für
  Wochenprogramm und Künstlerplan.

Die Anwendung läuft vollständig lokal auf dem eigenen Rechner - es wird
nichts an einen Server im Internet geschickt (mit Ausnahme des optionalen
Gemini-API-Keys für die KI-gestützte PDF-Extraktion, siehe unten).

## Inhaltsverzeichnis

1. [Projektstruktur](#1-projektstruktur)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Installation unter Windows](#3-installation-unter-windows)
4. [Installation unter macOS und Linux](#4-installation-unter-macos-und-linux)
5. [Anwendung starten](#5-anwendung-starten)
6. [Lokale Adressen](#6-lokale-adressen)
7. [Lokale Daten](#7-lokale-daten)
8. [Excel-Vorlagen](#8-excel-vorlagen)
9. [Environment Variables](#9-environment-variables)
10. [Tests](#10-tests)
11. [Fehlerbehebung](#11-fehlerbehebung)
12. [Datensicherung](#12-datensicherung)
13. [Späteres Deployment](#13-sp%C3%A4teres-deployment)

## 1. Projektstruktur

```
planner-agent/
├── frontend/                          Next.js-App (versioniert)
├── backend/                           Python-Backend (versioniert)
│   ├── config/paths.py                zentrale Pfadverwaltung
│   ├── resources/templates/           feste Excel-Grundvorlagen (versioniert)
│   ├── tests/                         pytest-Tests
│   ├── run_local.py                   lokaler Start mit Vorprüfung
│   ├── api.py                         FastAPI-App
│   ├── app.py                         Legacy-Oberfläche (Streamlit, siehe unten)
│   └── ... weitere Python-Module (db, assignment, memory, planning_rules, ...)
├── local_data/                        lokale Laufzeitdaten (NICHT versioniert)
│   ├── database/dienstplaene.db       SQLite-Datenbank
│   ├── archives/dienstplanarchiv/     lokales Dienstplanarchiv
│   ├── uploads/                       temporäre Upload-Dateien
│   └── exports/                       temporäre Export-Dateien
├── scripts/                           Platz für künftige Hilfsskripte
├── start_windows.ps1                  Start unter Windows
├── start_macos.command                Start unter macOS
├── start_linux.sh                     Start unter Linux (optional)
├── setup_windows.ps1                  einmalige Einrichtung unter Windows (optional)
├── pytest.ini
└── README.md
```

**Versioniert (landet auf GitHub):** `frontend/`, `backend/` inklusive
`backend/resources/templates/`, die Startskripte, `pytest.ini`, diese README.

**Nur lokal, nie versioniert:** alles unter `local_data/` (Datenbank, Archiv,
Uploads, Exporte), `.env`-Dateien mit echten Werten, `venv/`/`.venv/`,
`frontend/node_modules/`.

## 2. Voraussetzungen

Windows und macOS gleichermaßen:

- **Git**
- **Python 3.9 oder neuer** (entwickelt/getestet mit Python 3.9.6)
- **Node.js 18 oder neuer** (entwickelt/getestet mit Node.js 24, Next.js 16)
- **npm** (liegt Node.js bei) - `pnpm` oder `yarn` funktionieren ebenfalls,
  werden von den Startskripten automatisch anhand der Lock-Datei erkannt

## 3. Installation unter Windows

In PowerShell:

```powershell
git clone https://github.com/TobiB1505/planner-agent.git
cd planner-agent

python -m venv .venv

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip

pip install -r backend\requirements.txt

cd frontend
npm install
cd ..
```

Alternativ übernimmt `setup_windows.ps1` diese Schritte automatisch (siehe
Abschnitt 5) - vorhandene `.venv` oder `node_modules` werden dabei nicht
angetastet.

## 4. Installation unter macOS und Linux

```bash
git clone https://github.com/TobiB1505/planner-agent.git
cd planner-agent

python3 -m venv .venv
source .venv/bin/activate

python -m pip install --upgrade pip

pip install -r backend/requirements.txt

cd frontend
npm install
cd ..
```

## 5. Anwendung starten

**Windows:**

```powershell
.\start_windows.ps1
```

**macOS:**

```bash
chmod +x start_macos.command
./start_macos.command
```

**Linux (optional):**

```bash
chmod +x start_linux.sh
./start_linux.sh
```

Alle drei Skripte ermitteln ihren eigenen Speicherort als Projektstamm
(funktionieren also unabhängig vom aktuellen Arbeitsverzeichnis), erkennen
die virtuelle Python-Umgebung und den Node-Paketmanager automatisch, prüfen
vorab, ob die Ports 3000/8000 schon belegt sind, und öffnen Backend und
Frontend jeweils in einem eigenen Fenster (unter Linux als Hintergrund-
prozesse in diesem einen Fenster, da es dort kein einheitliches "neues
Terminal öffnen" gibt).

**Manuell (z.B. zum Debuggen):**

Backend:

```bash
python -m backend.run_local
```

Frontend:

```bash
cd frontend
npm run dev
```

### Legacy-Oberfläche (Streamlit)

`backend/app.py` ist die ursprüngliche Streamlit-Oberfläche aus einer frühen
Projektphase. Sie kennt Künstlerplan, Probenplan und die aktuelle
Planungslogik **nicht mehr** und wird nicht mehr aktiv weiterentwickelt.
Sie ist **nicht** Teil der Startskripte und startet nie automatisch mit.
Falls sie doch einmal gebraucht wird:

```bash
streamlit run backend/app.py
```

## 6. Lokale Adressen

```
Frontend:          http://localhost:3000
Backend:            http://127.0.0.1:8000
API-Dokumentation:   http://127.0.0.1:8000/docs
Health-Check:        http://127.0.0.1:8000/api/health
```

Der Browser spricht dabei ausschließlich `http://localhost:3000` an. Next.js
leitet `/api/...`-Aufrufe serverseitig an das Backend weiter (siehe
`frontend/next.config.ts`) - das Frontend kennt im Browser selbst keine
andere Adresse als seine eigene.

## 7. Lokale Daten

```
local_data/database/dienstplaene.db      SQLite-Datenbank
local_data/archives/dienstplanarchiv/    lokales Dienstplanarchiv
local_data/uploads/                      temporäre Upload-Dateien
local_data/exports/                      temporäre Export-Dateien
```

Wichtig:

- Diese Daten werden **nicht** nach GitHub hochgeladen (siehe `.gitignore`).
- Beim Wechsel auf einen neuen Rechner müssen sie **separat kopiert**
  werden - ein einfaches `git clone` bringt sie nicht mit.
- Die SQLite-Datenbank (`dienstplaene.db`) enthält die echten Mitarbeiter-
  und Planungsdaten des Teams.
- Das Dienstplanarchiv enthält lokale Kopien historischer Dienstplan-
  Dateien, getrennt von den in der Datenbank gespeicherten Wochenplänen.
- Der Speicherort lässt sich per `PLANNER_DATA_DIR` verschieben (siehe
  Abschnitt 9) - Standard ist `local_data/` im Projektstamm.

## 8. Excel-Vorlagen

```
backend/resources/templates/
├── Woche_A_NewYork.xlsx           Grundvorlage Woche A (New York)
├── Woche_B_Espania.xlsx           Grundvorlage Woche B (Espania)
└── Künstlerplan_Vorlage_2026.xlsx Grundvorlage für den Künstlerplan-Export
```

Diese drei Dateien sind **mit dem Code versioniert** (anders als die
Laufzeitdaten unter `local_data/`) - eine frische Installation aus GitHub
bringt sie automatisch mit. Sie werden vom Backend nur **gelesen**, nie
verändert; erzeugte Dienstpläne landen als eigene Datei im Download bzw.
temporär, nie im Vorlagenordner selbst.

## 9. Environment Variables

| Variable | Datei | Bedeutung |
|---|---|---|
| `GEMINI_API_KEY` | `.env` (Projektstamm) | Optional, für die KI-gestützte PDF-Extraktion |
| `PLANNER_DATA_DIR` | `.env` (Projektstamm) | Optional, verschiebt `local_data/` an einen anderen Ort |
| `CORS_ORIGINS` | `.env` (Projektstamm) | Optional, kommaseparierte Liste erlaubter Browser-Origins |
| `BACKEND_HOST` | `.env` (Projektstamm) | Optional, Standard `127.0.0.1` |
| `BACKEND_PORT` | `.env` (Projektstamm) | Optional, Standard `8000` |
| `BACKEND_INTERNAL_URL` | `frontend/.env.local` | Optional, wohin Next.js `/api/...` weiterleitet (Standard `http://127.0.0.1:8000`) |

Vorlagen liegen als `.env.example` bzw. `frontend/.env.example` bei - kopieren
und bei Bedarf anpassen:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

Keine echten API-Keys, Passwörter oder persönlichen Pfade in die
`.env.example`-Dateien eintragen - die sind versioniert und öffentlich
sichtbar. Nur die tatsächlichen `.env`/`.env.local`-Dateien enthalten echte
Werte und werden nicht versioniert.

## 10. Tests

```bash
python -m compileall backend
pytest

cd frontend
npm run build
npm run lint
```

`pytest` läuft aus dem Projektstamm heraus (kein `sys.path`-Hack nötig,
siehe `pytest.ini`). Die Datenbank-Tests verwenden immer eine temporäre
Testdatenbank, nie die echte lokale `dienstplaene.db`.

## 11. Fehlerbehebung

**PowerShell blockiert die virtuelle Umgebung** ("Ausführung von Skripts
deaktiviert"): einmalig `Set-ExecutionPolicy -Scope Process -ExecutionPolicy
Bypass` ausführen, bevor `.\.venv\Scripts\Activate.ps1` aufgerufen wird.

**Python wird nicht gefunden:** Python von https://python.org installieren
und beim Setup "Add python.exe to PATH" aktivieren, danach das Terminal neu
öffnen.

**npm wird nicht gefunden:** Node.js (bringt npm mit) von
https://nodejs.org installieren, danach das Terminal neu öffnen.

**Port 3000 ist belegt:** ein anderer Prozess (oft ein bereits laufendes
Frontend) blockiert den Port. Prozess beenden oder zuerst prüfen, ob nicht
schon eine Instanz von Planner-Agent läuft.

**Port 8000 ist belegt:** analog - oder `BACKEND_PORT` in `.env` auf einen
anderen Port setzen.

**Backend ist nicht erreichbar:** meist läuft es einfach noch nicht oder
gerade neu (Reload). Kurz warten, `http://127.0.0.1:8000/api/health` direkt
im Browser prüfen. Bleibt es rot, das Backend-Fenster auf Fehlermeldungen
prüfen.

**Excel-Vorlage fehlt:** `backend/run_local.py` meldet das beim Start klar.
Prüfen, ob `backend/resources/templates/` die drei in Abschnitt 8 genannten
Dateien enthält (sollte bei einem normalen `git clone` automatisch der Fall
sein).

**Datenbank fehlt:** normal bei der allerersten Nutzung - wird beim ersten
Zugriff automatisch neu angelegt. Falls eine bestehende Datenbank von einem
anderen Rechner übernommen werden soll, sie nach `local_data/database/
dienstplaene.db` kopieren, bevor die Anwendung gestartet wird.

**Datenbank ist gesperrt** ("database is locked"): meist, weil noch ein
zweiter Backend-Prozess läuft oder die Datei gerade von einem Sync-Tool
(siehe OneDrive-Hinweis unten) angefasst wird. Alle Backend-Fenster
schließen, kurz warten, neu starten.

**OneDrive blockiert oder synchronisiert Dateien:** liegt das Projekt in
einem OneDrive-/Dropbox-/iCloud-Ordner, kann der Sync-Client Dateien kurz
sperren, während SQLite oder Excel schreiben. Empfehlung: Projekt außerhalb
eines synchronisierten Ordners ablegen, oder den lokalen Datenordner per
`PLANNER_DATA_DIR` in einen nicht synchronisierten Ordner legen.

**Excel-Datei ist geöffnet und kann nicht überschrieben werden:** betrifft
nur eigene, bereits heruntergeladene Dienstplan-Exporte, nicht die
Vorlagen selbst (die werden nie überschrieben). Die geöffnete Datei in
Excel schließen und den Export erneut herunterladen.

## 12. Datensicherung

Regelmäßig sichern:

```
local_data/database/     enthält Mitarbeiter- und Planungsdaten
local_data/archives/      enthält lokale Dienstplan-Archivdateien
```

Diese Ordner werden **nicht** von Git erfasst - eine Sicherung muss separat
erfolgen (z.B. regelmäßige Kopie auf ein externes Laufwerk oder einen
Cloud-Speicher außerhalb des Projekts).

## 13. Späteres Deployment

Die Struktur ist bewusst so aufgebaut, dass ein späteres Deployment
vorbereitet ist (zentrale Pfadverwaltung, saubere Trennung von Code und
Laufzeitdaten). SQLite und die lokalen Archivdateien müssten dafür durch
persistente, extern erreichbare Dienste ersetzt werden. **In dieser Phase
ist noch kein Cloud-Deployment eingerichtet** - die Anwendung läuft
ausschließlich lokal.
