# Storage Inventory

> **Hinweis (PostgreSQL-Migration, August 2026):** Dieses Dokument beschreibt
> den Stand VOR der Migration der operativen Datenbank von SQLite auf
> PostgreSQL. Die Aussagen zu SQLite, zur persistenten Disk und zum
> Einzel-Instanz-Betrieb sind dadurch überholt. Aktueller Stand:
> `docs/database/POSTGRES_MIGRATION_AUDIT.md`,
> `docs/database/POSTGRES_STORAGE_GAPS.md` und
> `docs/database/SUPABASE_SETUP.md`.

Repository-weite Bestandsaufnahme aller Dateisystemzugriffe im Backend (Suche
nach `DATABASE_PATH`, `UPLOAD_DIR`, `EXPORT_DIR`, `BACKUP_DIR`,
`DIENSTPLAN_ARCHIVE_DIR`, `PLANNER_DATA_DIR`, `open(`, `Path.write*`,
`Path.unlink`, `shutil.copy*`), Stand: Deployment-Readiness-Sprint.

## Ergebnis

| Ressource | Persistent nötig | Temporär möglich | Cloud-Maßnahme | Tatsächliche Nutzung heute |
|---|---|---|---|---|
| SQLite-DB (`DATABASE_PATH`, `backend/db.py`) | ja | nein | Persistentes Volume (`PLANNER_DATA_DIR`) | Wird bei jedem Request gelesen/geschrieben (`db.get_db_connection`). Einzige Ressource, die die Anwendung fachlich zwingend braucht. |
| Backups (`BACKUP_DIR`, `backend/backup.py`) | ja | nein | Persistentes Volume, idealerweise zusätzlich extern gespiegelt | `create_backup()`/`restore_backup()` schreiben/lesen unter `PLANNER_DATA_DIR/backups/` via `VACUUM INTO` bzw. `shutil.copyfile`. Aktuell manuell/als eigenständiges Skript (`python -m backend.backup`) aufgerufen, kein automatischer Trigger im Request-Pfad. |
| Archiv (`DIENSTPLAN_ARCHIVE_DIR`) | ja (sofern genutzt) | nein | Persistentes Volume | **Aktuell nur provisioniert, nicht beschrieben**: `run_local.py` prüft beim Start nur, ob der Ordner leer ist (Hinweis, kein Fehler); `system.py`-Diagnose zeigt ihn an. Kein Anwendungscode legt dort tatsächlich Dateien ab. |
| Upload-Zwischendateien (`UPLOAD_DIR`) | nein | ja | Kein Handlungsbedarf | **Aktuell ungenutzt für echte Schreibvorgänge**: `routers/imports.py` verarbeitet hochgeladene PDF/XLSX-Dateien vollständig in-memory (`io.BytesIO(content)`), nie über `UPLOAD_DIR`. Der Ordner existiert nur für die Diagnose-Anzeige. |
| Generierte Exporte (`EXPORT_DIR`) | nein (aktuell) | ja | Kein Handlungsbedarf, ggf. später Volume falls sich das ändert | **Aktuell ungenutzt**: `xlsx_generate()` (`routers/plans.py`) und `artist_plan_export()` (`routers/imports.py`) schreiben über `tempfile.mkstemp()` in ein OS-Temp-Verzeichnis, liefern die Datei per `FileResponse` direkt aus und löschen sie danach per `BackgroundTask(os.unlink, ...)` - nie über `EXPORT_DIR`. Ephemeres Container-Dateisystem ist dafür unproblematisch. |
| Excel-Grundvorlagen (`RESOURCE_DIR`/`TEMPLATE_DIR`) | read-only | nein | Bestandteil des Images | Werden mit dem Code ausgeliefert (`backend/resources/templates/*.xlsx`), nie verändert (siehe `backend/tests/test_templates.py: test_reading_a_template_does_not_modify_it`). Liegen im Docker-Image, nicht auf dem Volume. |

## Konsequenz für den Deployment-Sprint

- **Nur ein Volume-Mount ist wirklich erforderlich**: `PLANNER_DATA_DIR` (→ `/data` im Container) für `database/` und `backups/`.
- `archives/`, `uploads/`, `exports/` werden von `ensure_runtime_directories()` weiterhin mit angelegt (Diagnose/Zukunftssicherheit), liegen aber ebenfalls unter `PLANNER_DATA_DIR` - kein separates Volume nötig, kein zusätzlicher Aufwand.
- Keine Änderung an fachlichen Speicherpfaden in diesem Sprint (Auftrag: "ändere keine fachlichen Speicherpfade, sofern sie mit dem persistenten Volume funktionieren") - alle fünf Pfade hängen bereits einheitlich von `PLANNER_DATA_DIR` ab (`backend/config/paths.py`), ein einziges Volume deckt alle fünf ab.
- Sollte künftig tatsächlich in `UPLOAD_DIR`/`EXPORT_DIR` geschrieben werden (z.B. asynchrone Export-Jobs), ist das ein bewusster architektonischer Schritt und kein Bugfix - aktuell besteht dafür kein Bedarf.
