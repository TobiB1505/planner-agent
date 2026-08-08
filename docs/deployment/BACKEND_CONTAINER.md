# Backend-Container-Deployment

> **Hinweis (PostgreSQL-Migration, August 2026):** Dieses Dokument beschreibt
> den Stand VOR der Migration der operativen Datenbank von SQLite auf
> PostgreSQL. Die Aussagen zu SQLite, zur persistenten Disk und zum
> Einzel-Instanz-Betrieb sind dadurch überholt. Aktueller Stand:
> `docs/database/POSTGRES_MIGRATION_AUDIT.md`,
> `docs/database/POSTGRES_STORAGE_GAPS.md` und
> `docs/database/SUPABASE_SETUP.md`.

Providerneutral - kein SDK, kein proprietärer Zugangscode. Getestet gegen
Railway/Render/Fly.io-typische Konventionen (Volume-Mount, `PORT`-Injektion),
aber an keinen dieser Anbieter gebunden.

## Image bauen

Build-Kontext ist **`backend/`**, nicht der Repo-Root (siehe Kommentar in
`backend/Dockerfile`) - dadurch liegen `.env`, `.git/` und `frontend/`
automatisch außerhalb des Build-Kontexts:

```bash
docker build -t planner-agent-backend -f backend/Dockerfile backend
```

**Hinweis zur Verifikation in diesem Sprint:** Der Docker-Daemon war in der
Sandbox-Umgebung zwar verfügbar, das Pullen von `python:3.9-slim` von Docker
Hub wurde aber durch die Netzwerk-Policy der Umgebung blockiert (`403
Forbidden` beim Registry-Zugriff). Ein echter Image-Build konnte deshalb
**nicht** end-to-end verifiziert werden. Stattdessen wurde eine statische
Prüfung durchgeführt: `docker build --check` erreichte denselben
Netzwerkfehler erst *nach* erfolgreichem Parsen von Dockerfile-Syntax und
-Struktur (kein Syntaxfehler, keine Warnung zu Instruktionsreihenfolge). Ein
realer Build in einer Umgebung mit Docker-Hub-Zugriff (z.B. der jeweilige
Hosting-Provider selbst) ist vor dem ersten echten Deployment nachzuholen.

## Container starten (lokal, zum Testen)

```bash
docker run --rm -p 8000:8000 \
  -e APP_ENV=preview \
  -e SYSTEM_RESTART_ENABLED=0 \
  -v planner-agent-data:/data \
  planner-agent-backend
```

- `-v planner-agent-data:/data`: **persistentes Volume-Mounting** - das
  Docker-Volume `planner-agent-data` bleibt über Container-Neustarts hinweg
  erhalten (im Gegensatz zum beschreibbaren Container-Layer, der bei jedem
  `docker rm`/Redeploy verloren geht).
- `PLANNER_DATA_DIR=/data` ist im Image bereits als Default gesetzt
  (`backend/Dockerfile`).
- `PORT`: falls die Hosting-Plattform `PORT` injiziert, bindet
  `backend/run_local.py` automatisch darauf (Priorität vor `BACKEND_PORT`,
  siehe `backend/run_local.py: resolve_backend_port()`). Ohne `PORT` bindet
  der Container auf `BACKEND_PORT` (Default `8000`).

## PLANNER_DATA_DIR setzen

**Pflicht in Preview/Production** (`APP_ENV∈{preview,production}`) - ohne
gesetztes `PLANNER_DATA_DIR` bricht der Start mit einer klaren Meldung ab
(`backend/run_local.py: check_data_dir_for_environment()`). Im Container ist
der Default bereits `/data` (siehe Dockerfile) - passend zum oben gezeigten
Volume-Mount. Diese Prüfung beweist nicht, dass `/data` tatsächlich auf
einen persistenten Datenträger gemountet ist (das kann kein Code der
Anwendung technisch nachweisen) - nur, dass die Variable bewusst gesetzt
wurde statt still auf den lokalen Entwicklungsdefault (`local_data/`)
zurückzufallen.

## PORT setzen

Siehe oben - `PORT` (Plattform-Standard) geht `BACKEND_PORT` vor. Wird von
keiner der beiden gesetzt, ist der Default `8000` (siehe `EXPOSE 8000` im
Dockerfile).

## /api/health konfigurieren

Als Health-Check-URL beim Hosting-Provider eintragen: `GET /api/health`
(Port wie oben). Erwartete "gesunde" Antwort: HTTP `200` mit
`"status": "ok"`. `"status": "degraded"` (weiterhin HTTP `200`, damit die
Plattform eine strukturierte Antwort statt eines Verbindungsfehlers sieht)
bedeutet: Datenbank nicht erreichbar, Excel-Grundvorlagen fehlen im Image,
oder das Datenverzeichnis ist nicht beschreibbar - alle drei sind
Konfigurationsfehler, kein Absturz. Ausführliche Diagnose (Pfade,
Integritätsprüfung, Plattenplatz): `GET /api/system/diagnostics` - **nicht**
als Plattform-Health-Check verwenden, da unauthentifiziert mehr preisgibt
als für einen automatisierten Check nötig (siehe
`docs/deployment/DEPLOYMENT_CHECKLIST.md`).

## Genau eine Backend-Instanz

SQLite erlaubt keine parallelen Schreibprozesse zuverlässig - deshalb:

- Kein horizontales Skalieren (`replicas: 1` bzw. Äquivalent der jeweiligen
  Plattform).
- Der Uvicorn-Prozess selbst läuft ohne `--workers` (ein Prozess,
  `backend/run_local.py: uvicorn.run(...)` ohne `workers=`-Parameter) - siehe
  `docs/deployment/ARCHITECTURE.md`, Abschnitt Datenhaltung.

## Backup-Verzeichnis persistent halten

Backups (`python -m backend.backup`) landen unter
`$PLANNER_DATA_DIR/backups/` (siehe `backend/config/paths.py: BACKUP_DIR`) -
also automatisch auf demselben Volume wie die Datenbank, kein separates
Volume nötig (siehe `docs/deployment/STORAGE_INVENTORY.md`). Empfehlung für
den produktiven Betrieb: den Backup-Befehl regelmäßig (Cron/Scheduled Job
der Hosting-Plattform) ausführen UND die entstehenden `.db`-Dateien
zusätzlich außerhalb des Volumes sichern (z.B. periodischer Objekt-Storage-
Upload) - ein Volume-Snapshot allein schützt nicht vor versehentlichem
Löschen des gesamten Volumes. Das ist als Empfehlung dokumentiert, nicht in
diesem Sprint implementiert (kein Blob-Storage, siehe
`docs/deployment/ARCHITECTURE.md`, Grenzen).
