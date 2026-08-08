# Datei-Restpunkte nach der PostgreSQL-Migration

Die Migration von SQLite auf PostgreSQL beseitigt **nur** die Persistenz-
abhängigkeit der Datenbank. Alle übrigen Dateisystemzugriffe des Backends
bleiben davon unberührt und müssen deshalb separat bewertet werden
(Sprint-Punkt 32).

Grundlage: repositoryweite Suche nach `ARCHIVE_DIR`, `DIENSTPLAN_ARCHIVE_DIR`,
`UPLOAD_DIR`, `EXPORT_DIR`, `BACKUP_DIR`, `LOCAL_DATA_DIR`, `open(`,
`Path.write*`, `shutil.copy*`, `tempfile.mkstemp` im gesamten Backend.
Ergänzt die bestehende `docs/deployment/STORAGE_INVENTORY.md` um den Zustand
**nach** der Datenbankmigration.

---

## Klassifikation

| Verzeichnis | Klassifikation | Wer schreibt heute dorthin? | Konsequenz |
| --- | --- | --- | --- |
| `local_data/database/` | **nicht mehr benötigt** (für den Betrieb) | Niemand. Vor der Migration lag hier `dienstplaene.db`. Nach der Migration schreibt kein Codepfad mehr in dieses Verzeichnis. | Der Ordner wird von `ensure_runtime_directories()` noch angelegt und in `/api/system/diagnostics` angezeigt. Er hat genau noch einen Zweck: die alte `dienstplaene.db` als Migrationsquelle bzw. Rollback-Stand aufzubewahren. Nach abgeschlossenem Cutover kann er entfallen. |
| `local_data/archives/dienstplanarchiv/` | **rekonstruierbar / ungenutzt** | Niemand. `run_local.py` prüft beim Start nur, ob der Ordner leer ist (reiner Hinweis, kein Fehler), `system.py` zeigt ihn in der Diagnose an. **Kein Anwendungscode legt dort Dateien ab.** Das fachliche "Archiv" der Anwendung (Seite `/archiv`) liegt vollständig in der Datenbank (`week_plans`/`assignments`, Endpunkt `GET /api/weeks`). | Keine Persistenz nötig. |
| `local_data/uploads/` | **temporär** | Niemand. `routers/imports.py` liest hochgeladene PDF/XLSX-Dateien vollständig in den Speicher (`file.file.read()` → `io.BytesIO(content)`) und verarbeitet sie dort. Es gibt keinen Schreibvorgang in `UPLOAD_DIR`. | Keine Persistenz nötig. Sprint-Punkt 33 (Uploads auf temporären Speicher umstellen) ist damit gegenstandslos - sie sind bereits rein flüchtig. |
| `local_data/exports/` | **temporär** | Niemand. `xlsx_generate()` (`routers/plans.py:747`) und `artist_plan_export()` (`routers/imports.py:202`) schreiben über `tempfile.mkstemp()` in das OS-Temp-Verzeichnis, liefern die Datei per `FileResponse` aus und löschen sie danach über `BackgroundTask(os.unlink, ...)`. | Keine Persistenz nötig. Sprint-Punkt 34: Exporte gehen bereits direkt an den Client und werden nicht dauerhaft gespeichert. Kein Refactoring erforderlich. |
| `local_data/backups/` | **nicht mehr benötigt** (für den Betrieb) | Nur noch `backend/backup.py` - und das ist seit der Migration als **deprecated** markiert und sichert ausdrücklich NICHT die operative Datenbank, sondern nur die alte SQLite-Datei. | Nach dem Cutover ohne Funktion. Gültige Backup-Strategie: `POSTGRES_BACKUP.md`. |
| `backend/resources/templates/` | **persistent zwingend, aber read-only** | Niemand - die Dateien werden nur gelesen. | Sie sind Bestandteil des Docker-Images, nicht des Volumes. Kein Volume-Bedarf. Abgesichert durch `backend/tests/test_templates.py::test_reading_a_template_does_not_modify_it`. |

---

## Ist Render nach diesem Sprint vollständig stateless?

**Für die Datenbank: ja, nachweislich.**

`backend/tests/test_preview_persistence.py::test_synthetic_person_survives_a_backend_restart_with_a_fresh_data_dir`
startet einen echten Backend-Prozess, legt eine Person an, beendet den Prozess
und startet ihn mit einem **komplett anderen, leeren** `PLANNER_DATA_DIR` neu.
Die Person ist danach unverändert lesbar, und in beiden Datenordnern existiert
keine einzige `*.db`-Datei. Vor der Migration wäre genau dieser Test
fehlgeschlagen.

**Für die Anwendung insgesamt: ja, mit einer Präzisierung.**

Es gibt aktuell **keinen** Kernworkflow, der eine persistente Datei auf Render
benötigt. Alle fünf Laufzeitverzeichnisse sind nach obiger Analyse entweder
ungenutzt oder rein temporär.

Was das Backend weiterhin braucht, ist ein **beschreibbares** (nicht
persistentes) Verzeichnis:

* `run_local.py::check_runtime_directories()` legt die Ordner an und schreibt
  eine Prüfdatei, um Schreibrechte zu verifizieren - der Start bricht sonst ab.
* `run_local.py::check_data_dir_for_environment()` verlangt in
  `APP_ENV=preview/production` weiterhin ein explizit gesetztes
  `PLANNER_DATA_DIR`.
* `/api/health` meldet `data_dir_writable` und wird `degraded`, wenn der Ordner
  nicht beschreibbar ist.
* Die Excel-Exporte brauchen ein beschreibbares OS-Temp-Verzeichnis.

Ein Render-Container hat ein beschreibbares (ephemeres) Dateisystem. Ein
**persistentes Volume ist nicht mehr erforderlich** - ein ephemerer
Schreib-Layer genügt.

> **Ehrliche Einschränkung:** die Prüfung `check_data_dir_for_environment()`
> verlangt in Preview/Production immer noch explizit `PLANNER_DATA_DIR` und
> begründet das in ihrem Text mit Persistenz. Diese Begründung ist nach der
> Migration überholt. Die Prüfung selbst wurde in diesem Sprint bewusst **nicht**
> entfernt: sie zu lockern wäre eine Deployment-Verhaltensänderung außerhalb des
> Datenbank-Scopes. `PLANNER_DATA_DIR` muss also weiterhin gesetzt sein, darf
> aber jetzt auf ein ephemeres Verzeichnis zeigen (z.B. `/tmp/planner`).

---

## Empfehlung für einen Folge-Sprint (nicht Teil dieses Sprints)

1. `PLANNER_DATA_DIR`-Pflicht in Preview/Production überdenken oder ihre
   Begründung an die neue Realität anpassen.
2. `local_data/database/` und `local_data/backups/` aus
   `ensure_runtime_directories()` entfernen, sobald der Cutover abgeschlossen
   und die alte SQLite-Datei archiviert ist.
3. `backend/backup.py` löschen, sobald kein Rollback auf SQLite mehr
   vorgesehen ist.
4. `archives`/`uploads`/`exports` aus der Diagnose-Anzeige entfernen oder als
   "nicht genutzt" kennzeichnen, damit die `/system`-Seite keinen Speicherbedarf
   suggeriert, den es nicht gibt.

Eine Supabase-Storage-Migration ist nach dieser Analyse **nicht erforderlich** -
es gibt keine Dateien, die migriert werden müssten.
