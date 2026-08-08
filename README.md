Planner-Agent

Lokale Planungssoftware für die Erstellung, Verwaltung und Auswertung von Dienstplänen eines Entertainment-Teams.

Der Planner-Agent verbindet Wochenprogramm, Künstlerplan, Probenzeiten, Abwesenheiten, Teamhistorie und Planungsregeln zu einem zentralen Arbeitsbereich. Die Anwendung unterstützt dabei nicht nur die manuelle Bearbeitung, sondern liefert auch nachvollziehbare Vorschläge, Konflikthinweise und Fairness-Auswertungen.

Status

Der Planner-Agent befindet sich in aktiver Entwicklung.

Der aktuelle Betriebsmodus ist eine lokale Installation auf einem einzelnen Rechner:

* Frontend und Backend laufen lokal.
* Die Daten werden in einer PostgreSQL-Datenbank gespeichert, die über die
  Umgebungsvariable DATABASE_URL konfiguriert wird. Lokal kann das eine
  PostgreSQL-Instanz auf dem eigenen Rechner sein, im Cloud-Betrieb eine
  Supabase-PostgreSQL-Instanz. Bis August 2026 wurde stattdessen eine lokale
  SQLite-Datei verwendet - siehe docs/database/POSTGRES_MIGRATION_AUDIT.md.
* Dienstplanarchive und Exporte liegen im lokalen Dateisystem.
* Für die KI-gestützte PDF-Auswertung kann optional Google Gemini verwendet werden.
* Ein öffentliches Mehrbenutzer- oder Cloud-Deployment ist derzeit nicht der primäre Einsatzzweck.

⸻

Kernfunktionen

Dashboard

Das Dashboard fasst den aktuellen Planungsstand zusammen:

* Status von Künstlerplan, Probenplan und Dienstplan
* offene Planungsschritte
* erkannte Show- und Probentage
* Team-Auslastung
* Fairness- und Belastungshinweise
* stark oder schwach ausgelastete Mitarbeiter
* direkte Verlinkung in die betroffenen Planungsbereiche
* Auswertung bereits gespeicherter Wochen

Dienstplan-Editor

Der Dienstplan-Editor führt in vier Schritten durch die Wochenplanung:

1. Künstlerplan vorbereiten
2. Proben und Verfügbarkeiten berücksichtigen
3. Dienstplan erstellen und bearbeiten
4. Dienstplan speichern und als Excel-Datei exportieren

Unterstützte Funktionen:

* Wochenwechsel mit automatischer A-/B-Vorlagenauswahl
* Übernahme gespeicherter Künstlerpläne
* Übernahme gespeicherter Probenpläne
* Berücksichtigung von Abwesenheiten
* automatische Planungsvorschläge
* Mitarbeiter- und Abteilungszuweisungen
* Wochen- und Tagesansicht
* unterschiedliche Darstellungsdichten
* Undo und Redo
* Konflikt- und Pflichtdienstprüfung
* Planqualitätsanalyse
* intelligente Mitarbeiterempfehlungen
* Warnung vor ungespeicherten Änderungen
* Speichern trotz Konflikten nach Bestätigung
* Export im Design der ursprünglichen Excel-Vorlage
* erneutes Öffnen und Bearbeiten archivierter Wochen

Planner Intelligence

Die Intelligence-Schicht wertet historische Planungsdaten aus und unterstützt die Dienstplanung mit nachvollziehbaren Empfehlungen.

Berücksichtigt werden unter anderem:

* vorhandene Skills
* historische Erfahrung
* bisherige Arbeitsbelastung
* faire Aufgabenverteilung
* Verfügbarkeit
* erfolgreiche frühere Zuweisungen
* manuell hinterlegte Präferenzen
* Konfliktfreiheit
* aktuelle und historische Wochenbelastung
* frühe und späte Dienste
* Kochdienste
* Sporteinsätze
* Moderationen
* Shows und Proben

Empfehlungen enthalten Gründe und Nachweise, damit sie nicht als undurchsichtige automatische Entscheidung erscheinen.

Teamverwaltung

Die Teamverwaltung enthält:

* aktive und inaktive Mitarbeiter
* Name und Abteilung
* Suche und Filter
* neue Mitarbeiter anlegen
* vorhandene Mitarbeiter bearbeiten
* Mitarbeiter deaktivieren oder reaktivieren
* Mitarbeiter löschen
* historische Dienstplandaten beim Löschen erhalten
* Intelligence-Status je Mitarbeiter
* Skills und Erfahrungswerte
* Belastungstrends
* aktuelle Konflikte
* planungsrelevante Hinweise

MA-Gedächtnis

Das MA-Gedächtnis speichert und visualisiert Informationen, die für zukünftige Planungen relevant sind.

Dazu gehören:

* bekannte Shows und Partys
* freie Wochentage und Frei-Muster
* Aufgabenprofile
* historische Einsätze
* automatisch erkannte Skills
* manuelle Korrekturen
* Präferenzen
* neue Mitarbeiter ohne ausreichende Historie
* Profile mit besonderem Klärungsbedarf

Automatisch gelernte Informationen können durch manuelle Angaben ergänzt oder korrigiert werden.

Künstlerplan

Der Künstlerplan kann aus einer vorhandenen Excel-Datei übernommen oder als leere Woche angelegt werden.

Funktionen:

* Excel-Datei per Drag-and-drop hochladen
* vorhandene Wochenblätter erkennen
* gewünschte Woche auswählen
* leeren Künstlerplan erstellen
* Einträge direkt im Tabelleneditor bearbeiten
* gespeicherte Künstlerpläne erneut öffnen
* Plan für die Dienstplanung aktivieren
* Künstlerplan als Excel-Datei exportieren
* vorhandene Künstlerpläne löschen
* Woche nachträglich verschieben

Unter anderem können folgende Informationen automatisch in den Dienstplan übernommen werden:

* Shows und Partys
* DJs
* Chillout
* Mittagsgrill
* Gastrotainment
* Specials
* NITE CLUB
* Orte und Uhrzeiten

Interne Mitarbeiterzuweisungen werden bei einer Aktualisierung des Künstlerplans nicht automatisch überschrieben.

Probenplan

Der Probenplan kann aus Excel- oder PDF-Dateien eingelesen werden.

Funktionen:

* Excel-Dateien direkt auslesen
* PDF-Dateien optional mit Google Gemini auswerten
* vorhandene Wochenblätter erkennen
* Probe, Datum und Uhrzeit übernehmen
* Teilnehmer erkennen
* nicht eindeutig erkannte Namen anzeigen
* Ergebnisse vor dem Speichern korrigieren
* gespeicherte Probenpläne erneut öffnen
* Probenplan für die Dienstplanung aktivieren

Aktivierte Proben werden im Dienstplan als Zeitblockaden berücksichtigt.

Planungslogik

Die Seite „Planungslogik“ zeigt die Regeln, die bei automatischen Vorschlägen und Prüfungen berücksichtigt werden.

Dazu gehören beispielsweise:

* Fairness-Regeln
* Abteilungsanforderungen
* Verfügbarkeiten
* Probenüberschneidungen
* Showbesetzungen
* Belastungsverteilung
* Pflichtdienste
* besondere Einschränkungen
* harte und weiche Planungsregeln

Dienstplanarchiv

Im Archiv werden importierte und selbst erzeugte Wochenpläne gemeinsam verwaltet.

Funktionen:

* gespeicherte Wochen durchsuchen
* nach importierten und generierten Plänen filtern
* Detailansicht einer Woche öffnen
* Zuweisungen und Abwesenheiten prüfen
* archivierte Woche wieder im Editor öffnen
* Wochen löschen
* alte Dienstpläne importieren
* Excel-Reiter auswählen
* PDF-Dateien optional mit Gemini auswerten
* erkannte Namen bestehenden Mitarbeitern zuordnen
* neue Mitarbeiter aus einem Import anlegen
* Abteilungseinträge von Einzelpersonen unterscheiden
* erkannte Daten vor dem Speichern korrigieren

Systemverwaltung

Die Systemseite zeigt den Zustand der lokalen Installation.

Angezeigt werden:

* Erreichbarkeit des Backends
* Backend-Host und Port
* Laufzeit seit dem letzten Start
* Datenbankverbindung
* Datenbankzustand (Erreichbarkeit und angewendete Schemaversion)
* vorhandene Excel-Vorlagen
* Laufzeitverzeichnisse
* Schreibrechte
* freier und belegter Speicherplatz
* konfigurierte CORS-Origins

Zusätzlich kann das Backend über die Oberfläche neu gestartet werden.

Der Neustart wird durch das Next.js-Frontend ausgelöst und funktioniert daher auch dann, wenn das FastAPI-Backend selbst nicht mehr antwortet.

⸻

Typischer Planungsablauf

Künstlerplan importieren oder erstellen
                ↓
Probenplan importieren und prüfen
                ↓
Planwoche im Dienstplan-Editor auswählen
                ↓
Programm, Proben, Abwesenheiten und Historie zusammenführen
                ↓
Automatischen Planungsvorschlag erstellen
                ↓
Zuweisungen manuell prüfen und bearbeiten
                ↓
Konflikte und Planqualität kontrollieren
                ↓
Dienstplan speichern
                ↓
Excel-Datei im Originaldesign exportieren

⸻

Architektur

Browser oder installierte PWA
            │
            ▼
Next.js Frontend
http://localhost:3000
            │
            │ relative /api/...-Anfragen
            ▼
Next.js Rewrite
            │
            ▼
FastAPI Backend
http://127.0.0.1:8000
            │
            ├── PostgreSQL-Datenbank (DATABASE_URL)
            ├── Excel-Vorlagen
            ├── lokales Dienstplanarchiv
            ├── Uploads und Exporte
            └── optional Google Gemini

Der Browser kommuniziert ausschließlich mit der eigenen Next.js-Origin. API-Aufrufe werden serverseitig an das FastAPI-Backend weitergeleitet.

⸻

Technologie

Frontend

* Next.js 16
* React 19
* TypeScript
* Tailwind CSS 4
* AG Grid Community
* ESLint
* Next.js App Router
* Progressive Web App Manifest

Backend

* Python
* FastAPI
* Uvicorn
* PostgreSQL (psycopg 3 mit Connection Pool)
* pandas
* openpyxl
* PyMuPDF
* Google GenAI SDK
* python-dotenv
* python-multipart

Tests und Qualität

* pytest
* HTTPX
* Python Compile Check
* ESLint
* TypeScript-/Next.js-Build

⸻

Projektstruktur

planner-agent/
├── backend/
│   ├── config/
│   │   └── paths.py
│   ├── intelligence/
│   │   ├── audit.py
│   │   ├── dashboard.py
│   │   ├── employee_stats.py
│   │   ├── memory_engine.py
│   │   ├── plan_quality.py
│   │   ├── recommendation_engine.py
│   │   └── team_overview.py
│   ├── resources/
│   │   └── templates/
│   ├── tests/
│   ├── api.py
│   ├── artist_plan.py
│   ├── assignment.py
│   ├── db.py
│   ├── extraction.py
│   ├── grid.py
│   ├── memory.py
│   ├── plan_templates.py
│   ├── planning_rules.py
│   ├── rehearsal_plan.py
│   ├── run_local.py
│   ├── stats.py
│   ├── template_spec.py
│   ├── util.py
│   ├── xlsx_template.py
│   └── requirements.txt
│
├── frontend/
│   ├── app/
│   │   ├── archiv/
│   │   ├── artist-plan/
│   │   ├── control/backend/
│   │   ├── dashboard/
│   │   ├── gedaechtnis/
│   │   ├── plan-editor/
│   │   ├── planning-logic/
│   │   ├── rehearsal-plan/
│   │   ├── system/
│   │   └── team/
│   ├── components/
│   ├── lib/
│   ├── public/
│   ├── next.config.ts
│   ├── package.json
│   └── .env.example
│
├── docs/
│   └── refactoring/
│
├── local_data/
│   ├── database/
│   ├── archives/
│   │   └── dienstplanarchiv/
│   ├── uploads/
│   └── exports/
│
├── scripts/
├── .env.example
├── pytest.ini
├── setup_windows.ps1
├── start_windows.ps1
├── start_macos.command
├── start_linux.sh
└── README.md

Versionierte Dateien

Diese Bereiche werden über Git verwaltet:

* frontend/
* backend/
* backend/resources/templates/
* docs/
* Start- und Setup-Skripte
* Environment-Beispiele
* Testkonfiguration
* README

Nicht versionierte Laufzeitdaten

Diese Daten bleiben ausschließlich lokal:

* local_data/
* .env
* frontend/.env.local
* .venv/
* venv/
* frontend/node_modules/
* temporäre Uploads
* erzeugte Exporte
* Datenbank-Zugangsdaten (DATABASE_URL)
* lokale Archivdateien

⸻

Voraussetzungen

Erforderlich

* Git
* Python 3.9 oder neuer
* Python 3.11 oder neuer empfohlen
* Node.js 20.9 oder neuer
* npm

Die Startskripte können auch pnpm oder yarn verwenden, wenn eine passende Lock-Datei vorhanden ist.

Unterstützte Betriebssysteme

* Windows
* macOS
* Linux

⸻

Installation unter Windows

Automatische Einrichtung

PowerShell öffnen und ausführen:

git clone https://github.com/TobiB1505/planner-agent.git
cd planner-agent
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup_windows.ps1

Danach starten:

.\start_windows.ps1

Das Setup-Skript:

* erstellt eine virtuelle Python-Umgebung unter .venv
* installiert die Backend-Abhängigkeiten
* installiert die Frontend-Abhängigkeiten
* legt die lokalen Laufzeitordner an
* überschreibt keine vorhandene virtuelle Umgebung
* überschreibt keine vorhandenen node_modules
* verändert keine bestehende Datenbank

Manuelle Einrichtung

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

Start:

.\start_windows.ps1

⸻

Installation unter macOS

git clone https://github.com/TobiB1505/planner-agent.git
cd planner-agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
cd frontend
npm install
cd ..

Startskript ausführbar machen:

chmod +x start_macos.command

Anwendung starten:

./start_macos.command

Backend und Frontend werden in getrennten Terminal-Fenstern geöffnet.

⸻

Installation unter Linux

git clone https://github.com/TobiB1505/planner-agent.git
cd planner-agent
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt
cd frontend
npm install
cd ..

Startskript ausführbar machen:

chmod +x start_linux.sh

Anwendung starten:

./start_linux.sh

Unter Linux laufen Backend und Frontend als Hintergrundprozesse des Startskripts.

Die Logs liegen standardmäßig unter:

local_data/.backend.log
local_data/.frontend.log

Zum Beenden im Terminal Strg+C drücken.

⸻

Manueller Entwicklungsstart

Backend

Vom Projektstamm aus:

python -m backend.run_local

Nicht direkt python backend/run_local.py verwenden, da das Backend als Python-Modul gestartet werden soll.

Frontend

In einem zweiten Terminal:

cd frontend
npm run dev

⸻

Lokale Adressen

Frontend:           http://localhost:3000
Backend:            http://127.0.0.1:8000
API-Dokumentation:  http://127.0.0.1:8000/docs
Health-Check:       http://127.0.0.1:8000/api/health

Die Benutzeroberfläche sollte normalerweise über das Frontend unter Port 3000 geöffnet werden.

⸻

Lokale Daten

Standardmäßig werden lokale Laufzeitdateien hier gespeichert:

local_data/archives/dienstplanarchiv/
local_data/uploads/
local_data/exports/

Die Datenbank liegt NICHT mehr in diesem Ordner. local_data/database/ enthält
nur noch die alte SQLite-Datei aus der Zeit vor der PostgreSQL-Migration
(Migrationsquelle und Rollback-Stand, siehe
docs/database/SQLITE_POSTGRES_CUTOVER.md).

Datenbank

Die PostgreSQL-Datenbank enthält unter anderem:

* Mitarbeiter
* Abteilungen
* Namensaliasse
* gespeicherte Wochenpläne
* Dienstzuweisungen
* Abwesenheiten
* Künstlerpläne
* Probenpläne
* Proben-Teilnehmer
* Memory-Einträge
* Skills
* Einstellungen
* Planungs- und Auditdaten

Das Schema wird beim Start automatisch über versionierte Migrationen angelegt
(backend/migrations/). Die Datenbank selbst muss vorher existieren und über
DATABASE_URL erreichbar sein.

Datenschutz

Der normale Betrieb mit der Datenbank, Excel-Dateien und lokalen Importen findet auf dem eigenen Rechner statt.

Bei Verwendung der Gemini-basierten PDF-Auswertung werden PDF-Inhalte an die konfigurierte Google-Gemini-API übertragen und dort verarbeitet.

Excel-Importe werden direkt lokal verarbeitet und benötigen keinen Gemini-API-Key.

Keine echten Mitarbeiterdaten, Dienstpläne, API-Keys oder lokale Datenbankdateien in das öffentliche Repository hochladen.

⸻

Excel-Vorlagen

Die mitgelieferten Vorlagen liegen unter:

backend/resources/templates/
├── Woche_A_NewYork.xlsx
├── Woche_B_Espania.xlsx
└── Künstlerplan_Vorlage_2026.xlsx

Die Vorlagen werden versioniert und bei einem normalen git clone mit heruntergeladen.

Sie werden vom Backend als Grundlage verwendet und nicht direkt überschrieben. Erzeugte Dateien werden separat als Download oder temporärer Export erstellt.

⸻

Unterstützte Importformate

Dienstplanarchiv

* .xlsx
* .pdf

Excel-Dateien werden lokal strukturiert eingelesen.

PDF-Dateien können über Gemini ausgewertet werden.

Künstlerplan

* .xlsx

Vorhandene Wochenblätter innerhalb der Datei werden erkannt und können einzeln ausgewählt werden.

Probenplan

* .xlsx
* .pdf

Excel-Dateien werden direkt gelesen. PDF-Dateien können über Gemini analysiert werden.

⸻

Environment Variables

Backend

Die Vorlage liegt unter:

.env.example

Für eine lokale Konfiguration kopieren:

cp .env.example .env

Unter Windows PowerShell:

Copy-Item .env.example .env

Verfügbare Variablen:

Variable	Standard	Bedeutung
DATABASE_URL	leer (PFLICHT)	Verbindung zur PostgreSQL-Datenbank, Form postgresql://USER:PASSWORD@HOST:PORT/DATABASE. Ohne diesen Wert startet das Backend bewusst nicht.
DATABASE_POOL_MIN_SIZE	1	Untergrenze des Connection Pools
DATABASE_POOL_MAX_SIZE	5	Obergrenze des Connection Pools - bewusst klein, da gehostete Datenbanken harte Verbindungslimits haben
TEST_DATABASE_URL	postgresql://postgres@127.0.0.1:5432/planner_test	Nur für die Testsuite. Darf nie auf eine Produktionsdatenbank zeigen - die Tests brechen sonst ab.
GEMINI_API_KEY	leer	Optionaler API-Key für die KI-gestützte PDF-Auswertung
PLANNER_DATA_DIR	local_data/	Speicherort für Archiv, Uploads und Exporte (nicht mehr für die Datenbank)
CORS_ORIGINS	lokale Frontend-Adressen	Erlaubte Origins für direkte Backend-Anfragen
BACKEND_HOST	127.0.0.1	Host des FastAPI-Backends
BACKEND_PORT	8000	Port des FastAPI-Backends
BACKEND_RELOAD	0	Mit 1 wird der Auto-Neustart bei Codeänderungen aktiviert

BACKEND_RELOAD=1 ist nur für die aktive Entwicklung gedacht.

Frontend

Die Vorlage liegt unter:

frontend/.env.example

Kopieren:

cp frontend/.env.example frontend/.env.local

Unter Windows PowerShell:

Copy-Item frontend\.env.example frontend\.env.local

Verfügbare Variable:

Variable	Standard	Bedeutung
BACKEND_INTERNAL_URL	http://127.0.0.1:8000	Ziel des serverseitigen Next.js-API-Rewrites

Die Variable darf nicht mit NEXT_PUBLIC_ beginnen, da die Backend-Adresse nicht an den Browser ausgeliefert werden soll.

Alternative Ports

Bei einer Änderung des Backend-Ports müssen mindestens diese Werte zusammenpassen:

BACKEND_PORT
BACKEND_INTERNAL_URL

Die mitgelieferten Startskripte sind primär auf die Standardports 3000 und 8000 ausgelegt.

⸻

Tests und Qualitätsprüfung

Vom Projektstamm aus:

python -m compileall backend
pytest

Frontend prüfen:

cd frontend
npm run lint
npm run build

Die Testsuite braucht eine erreichbare PostgreSQL-Instanz. Jeder einzelne Test
bekommt darin ein eigenes, frisch migriertes Schema; kein Test sieht die Daten
eines anderen. Vor dem ersten Lauf einmalig eine Testdatenbank anlegen:

createdb planner_test

Ein Guard in backend/tests/conftest.py bricht die gesamte Suite ab, wenn
TEST_DATABASE_URL erkennbar auf eine gehostete oder produktionsartige Datenbank
zeigt.

⸻

Planner-Agent als App installieren

Das Frontend besitzt ein PWA-Manifest und kann in unterstützten Browsern als App installiert werden.

Vorteile:

* eigenes App-Icon
* Eintrag im Startmenü oder Programme-Ordner
* eigenes Fenster
* keine sichtbare Browser-Adressleiste
* schneller Zugriff auf die lokale Anwendung

Wichtiger Hinweis

Die installierte App ersetzt nicht das lokale Backend.

Vor der Nutzung müssen Backend und Frontend weiterhin über das jeweilige Startskript gestartet werden.

Windows mit Edge oder Chrome

1. start_windows.ps1 ausführen.
2. Planner-Agent unter http://localhost:3000 öffnen.
3. Installationssymbol in der Adressleiste oder den Installationsbutton in der Sidebar verwenden.
4. App installieren.
5. Danach über Startmenü oder Desktop-Verknüpfung öffnen.

macOS mit Chrome

1. start_macos.command ausführen.
2. Planner-Agent in Chrome öffnen.
3. „Planner-Agent installieren“ auswählen.
4. App anschließend über Programme oder Dock öffnen.

macOS mit Safari

1. Planner-Agent in Safari öffnen.
2. „Zum Dock hinzufügen“ verwenden.
3. App über das Dock öffnen.

Offline-Verhalten

Der Planner-Agent verwendet derzeit bewusst keinen Service Worker für einen vollständigen Offline-Cache.

Dadurch werden keine möglicherweise veralteten Mitarbeiter- oder Dienstplandaten aus einem Browsercache angezeigt. Für die Nutzung müssen Frontend und Backend lokal erreichbar sein.

⸻

Datensicherung

Regelmäßig sichern:

local_data/archives/

Die Planungsdaten liegen in der PostgreSQL-Datenbank, nicht mehr im
Projektordner.

Ein normales git clone oder git pull enthält keine Planungsdaten.

Beim Umzug auf einen neuen Rechner muss die Datenbank separat gesichert und
wiederhergestellt werden - siehe docs/database/POSTGRES_BACKUP.md.

Empfohlene Sicherungsstrategie

1. Planner-Agent beenden.
2. Datenbank sichern (pg_dump, siehe docs/database/POSTGRES_BACKUP.md).
3. Ordner local_data/archives/ kopieren.
4. Sicherung auf einem externen Laufwerk oder einem geschützten Speicherort ablegen.
5. Keine unverschlüsselte Sicherung mit personenbezogenen Daten öffentlich teilen.

⸻

Fehlerbehebung

PowerShell blockiert Skripte

Fehlermeldung:

Die Ausführung von Skripts ist auf diesem System deaktiviert

Lösung:

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

Danach den Befehl im selben PowerShell-Fenster erneut ausführen.

Python wird nicht gefunden

Prüfen:

python --version

Unter macOS oder Linux:

python3 --version

Python installieren und darauf achten, dass es über den Systempfad erreichbar ist.

Node.js oder npm wird nicht gefunden

Prüfen:

node --version
npm --version

Für das aktuelle Next.js-Frontend ist Node.js 20.9 oder neuer erforderlich.

Port 3000 ist belegt

Meist läuft bereits ein Frontend-Prozess.

Vorhandenen Prozess beenden oder prüfen, ob Planner-Agent bereits geöffnet ist.

Port 8000 ist belegt

Meist läuft bereits ein Backend-Prozess.

Vorhandenen Prozess beenden oder prüfen, ob das Backend bereits erreichbar ist:

http://127.0.0.1:8000/api/health

Backend ist nicht erreichbar

1. Seite „System“ öffnen.
2. Backend-Status prüfen.
3. „Backend neu starten“ ausführen.
4. Falls auch das Frontend nicht läuft, das Betriebssystem-Startskript erneut starten.
5. Fehlermeldungen im Backend-Terminal prüfen.

Frontend zeigt alte Daten

1. Seite neu laden.
2. Backend-Status kontrollieren.
3. Prüfen, ob die richtige Woche ausgewählt ist.
4. Prüfen, ob Änderungen gespeichert wurden.
5. Bei Bedarf Backend über die Systemseite neu starten.

Excel-Vorlage fehlt

Prüfen, ob folgende Dateien vorhanden sind:

backend/resources/templates/Woche_A_NewYork.xlsx
backend/resources/templates/Woche_B_Espania.xlsx
backend/resources/templates/Künstlerplan_Vorlage_2026.xlsx

Fehlende Vorlagen verhindern nicht zwingend den vollständigen Start der Anwendung, können aber den jeweiligen Excel-Export blockieren.

DATABASE_URL ist nicht gesetzt

Das Backend startet bewusst nicht ohne konfigurierte Datenbank.

Lösung: DATABASE_URL in der .env eintragen (Vorlage: .env.example). Eine
Schritt-für-Schritt-Anleitung für Supabase steht in
docs/database/SUPABASE_SETUP.md.

Datenbank nicht erreichbar

Mögliche Ursachen:

* die PostgreSQL-Instanz läuft nicht
* Host, Port, Benutzername oder Passwort in DATABASE_URL sind falsch
* Sonderzeichen im Passwort sind nicht prozentkodiert
* ein gehostetes Projekt wurde wegen Inaktivität pausiert

Lösung:

1. Die Vorprüfung beim Start liest die Fehlermeldung des Servers vor - sie
   nennt in der Regel die konkrete Ursache.
2. DATABASE_URL prüfen.
3. Erreichbarkeit testen: curl http://127.0.0.1:8000/api/health
4. Projekt nach Möglichkeit außerhalb eines synchronisierten Ordners speichern.

Alternativ kann PLANNER_DATA_DIR auf einen nicht synchronisierten Ordner gesetzt werden.

Excel-Datei kann nicht überschrieben werden

Die exportierte Datei ist möglicherweise noch in Excel geöffnet.

Datei schließen und Export erneut durchführen.

PDF-Auswertung funktioniert nicht

Prüfen:

* Ist GEMINI_API_KEY in .env gesetzt?
* Ist die Internetverbindung verfügbar?
* Ist der API-Key gültig?
* Ist die PDF-Datei lesbar?
* Enthält die Datei tatsächlich einen Dienst- oder Probenplan?
* Werden im Backend-Terminal konkrete API-Fehler angezeigt?

⸻

Entwicklungshinweise

API-Kommunikation

Frontend-Anfragen verwenden relative Pfade:

/api/...

Next.js leitet diese serverseitig an das FastAPI-Backend weiter.

Die zentrale Frontend-API-Schicht liegt unter:

frontend/lib/api.ts

Pfadverwaltung

Alle relevanten lokalen Pfade werden zentral verwaltet:

backend/config/paths.py

Neue Backend-Funktionen sollten keine fest codierten absoluten Benutzerpfade verwenden.

Planungslogik

Planungsrelevante Kernbereiche:

backend/assignment.py
backend/memory.py
backend/planning_rules.py
backend/intelligence/
backend/template_spec.py

Refactoring-Dokumentation

Technische Analysen und bereits durchgeführte Optimierungsschritte liegen unter:

docs/refactoring/

Dort werden unter anderem behandelt:

* SQLite-Baseline (historisch, vor der PostgreSQL-Migration)
* Connection Lifecycle
* Alias-Lookups
* Memory-Datenfluss
* Teamübersicht und Memory
* Wiederverwendung von Planantworten
* asynchrone Importprozesse

⸻

Deployment

Die Architektur trennt Frontend, Backend und Laufzeitdaten bereits voneinander. Der aktuelle Stand ist trotzdem auf den lokalen Betrieb ausgelegt.

Für ein öffentliches oder produktives Cloud-Deployment wären unter anderem notwendig:

* persistente externe Datenbank (erledigt: PostgreSQL über DATABASE_URL)
* Authentifizierung
* Rollen- und Berechtigungssystem
* sichere Geheimnisverwaltung
* HTTPS
* Backup- und Wiederherstellungsstrategie
* Datenschutz- und Löschkonzept
* Absicherung der Upload-Endpunkte
* Anpassung des Backend-Supervisors
* Deployment-spezifische Prozessverwaltung

Die Planungsdaten liegen inzwischen in PostgreSQL und überleben ein Redeploy
unabhängig vom Container-Dateisystem. Das lokale Dienstplanarchiv wird derzeit
von keinem Codepfad beschrieben - siehe docs/database/POSTGRES_STORAGE_GAPS.md.

⸻

Projektziel

Der Planner-Agent soll die Dienstplanung nicht vollständig autonom ersetzen.

Das Ziel ist eine professionelle Planungsoberfläche, die:

* wiederkehrende Arbeit beschleunigt
* vorhandenes Teamwissen strukturiert
* Konflikte früh sichtbar macht
* faire Verteilung unterstützt
* Empfehlungen nachvollziehbar begründet
* manuelle Entscheidungen jederzeit ermöglicht
* bestehende Excel-Arbeitsabläufe weiterhin unterstützt
* historische Planung als Grundlage für bessere zukünftige Entscheidungen nutzt