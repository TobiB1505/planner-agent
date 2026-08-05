# AP10 — Transaktionsgrenzen vereinheitlichen

Reines Transaktions-Refactoring: die 14 Low-Level-Schreibfunktionen in
`backend/db.py`, die bislang selbst `conn.commit()` aufriefen, tun das nicht
mehr. Die Transaktionsverantwortung liegt jetzt bei der fachlichen Operation
(dem API-Endpunkt in `backend/api.py`), die pro Anfrage genau einmal
committet. Keine API-Pfade, Request-/Response-Modelle, Datenbankschema,
Migrationen, Frontend, Planungslogik oder Importformate geändert.

Alle Verifikationen liefen gegen isolierte Testdatenbanken (`tmp_path`) und
eine schreibgeschützt geprüfte Kopie der lokalen Entwicklungsdatenbank; die
echte lokale Datenbank blieb MD5-identisch unverändert (`e54b965216b7ea02f3a4075e170dccc2`).

---

## Vorher

### Commit-Stellen (Schritt 1)

`backend/db.py` enthielt 17 `conn.commit()`-Aufrufe, `backend/api.py` genau 2:

| Funktion | Datei | commit vorhanden | Fachliche Verantwortung |
|---|---|---|---|
| `_migrate` | db.py | ja | Schema-Migration beim Start — außerhalb des AP10-Scopes |
| `initialize_database` | db.py | ja | Schema-Anlage beim Start — außerhalb des AP10-Scopes |
| `update_person` | db.py | ja → entfernt | Team-Verwaltung (`PUT /api/team/{id}`) |
| `delete_person` | db.py | ja → entfernt | Team-Verwaltung (`DELETE /api/team/{id}`) |
| `create_person` | db.py | ja (2×) → entfernt | Team-Verwaltung **und** Teil von `plan_save`/`import_save` |
| `add_alias` | db.py | ja → entfernt | Teil von `import_save` (`_resolve_with_choices`) |
| `insert_week_plan` | db.py | ja → entfernt | Teil von `plan_save`/`import_save` |
| `insert_assignment` | db.py | nein (bereits korrekt) | Teil von `plan_save`/`import_save` |
| `insert_absence` | db.py | nein (bereits korrekt) | Teil von `plan_save`/`import_save` |
| `delete_week_plan` | db.py | ja → entfernt | Archiv-Verwaltung (`DELETE /api/weeks/{id}`) |
| `set_setting` | db.py | ja → entfernt | Einstellungen (`PUT /api/settings/{key}`) |
| `set_memory_override` | db.py | ja → entfernt | Gedächtnis-Overrides (3 PUT-Endpunkte) |
| `clear_memory_override` | db.py | ja → entfernt | Gedächtnis-Overrides (3 PUT-Endpunkte) |
| `clear_memory_overrides_for_person` | db.py | ja (unverändert) | **kein Aufrufer** (weder in `api.py` noch in Tests) |
| `upsert_artist_plan` | db.py | ja → entfernt | Künstlerplan speichern (`POST /api/artist-plans`) |
| `delete_artist_plan` | db.py | ja → entfernt | Künstlerplan löschen (`DELETE /api/artist-plans/{id}`) |
| `upsert_rehearsal_plan` | db.py | ja → entfernt | Probenplan speichern (`POST /api/rehearsal-plans`) |
| `delete_rehearsal_plan` | db.py | ja → entfernt | Probenplan löschen (`DELETE /api/rehearsal-plans/{id}`) |
| `import_save` | api.py | ja (bereits korrekt am Ende) | Import-Speichern (`POST /api/import/save`) |
| `plan_save` | api.py | ja (bereits korrekt am Ende) | Plan-Speichern (`POST /api/plan/save`) |

### Risiken (Schritt 2)

Das problematische Muster traf am stärksten `create_person`, `add_alias` und
`insert_week_plan`: alle drei werden sowohl **standalone** (eigene
Team-/Import-Endpunkte) als auch als **Teilschritt** von `plan_save` und
`import_save` aufgerufen. Weil sie sofort committeten, konnte ein Fehler
mitten in `plan_save`/`import_save` einen `week_plans`-Eintrag ohne
(vollständige) `assignments` zurücklassen, oder eine über
`_resolve_with_choices`/`_resolve_or_create` neu angelegte Person samt Alias
bestehen lassen, obwohl die Zuweisung, für die sie angelegt wurde, nie
gespeichert wurde.

`plan_save` und `import_save` selbst hatten dieses Problem nicht durch
fehlendes Commit am Ende — beide committeten bereits korrekt genau einmal
nach der letzten Schreiboperation (`api.py:1606` bzw. `api.py:765`, vor
dieser Session). Das eigentliche Leck lag ausschließlich in den
Low-Level-Helfern, die sie aufrufen.

### Betroffene Workflows

- **Plan speichern** (`POST /api/plan/save`): neue Planwoche anlegen ODER
  bestehende überschreiben, Zuweisungen/Abwesenheiten speichern,
  Personen/Aliasse bei Bedarf neu anlegen, Audit-Metadaten schreiben.
- **Import speichern** (`POST /api/import/save`, gemeinsamer Zielpfad für
  PDF- und XLSX-Import): Planwoche anlegen, Zuweisungen/Abwesenheiten
  speichern, Personen/Aliasse anhand der Nutzer-Auflösung anlegen.
- **Künstlerplan/Probenplan speichern** (`POST /api/artist-plans`,
  `POST /api/rehearsal-plans`): je eine mehrstufige `upsert_*`-Funktion
  (Zeile löschen/neu schreiben, dann `executemany` für die Detailzeilen) —
  war intern bereits als eine Einheit konzipiert, besaß aber ihre Transaktion
  nicht selbst, sondern nur implizit über ihr eigenes abschließendes Commit.
- **Team-/Archiv-/Einstellungs-/Gedächtnis-Verwaltung**: einzelne,
  fachlich unabhängige Schreiboperationen (kein Halbzustand-Risiko, da nur
  ein Datensatz pro Aufruf betroffen ist) — brauchten trotzdem eine explizite
  Commit-Stelle beim jeweiligen Endpunkt, da ihr gemeinsam genutzter
  Low-Level-Helfer nicht mehr selbst committet.

---

## Umsetzung

### Neue Transaktionsgrenzen (Schritt 3+4)

Regel: **Low-Level-Helfer in `db.py` führen nur noch INSERT/UPDATE/DELETE/
SELECT aus, nie mehr `conn.commit()`.** Die aufrufende fachliche Operation
entscheidet, wann committet wird:

- `plan_save` und `import_save` brauchten **keine einzige Codeänderung an
  sich selbst** — ihr jeweils bereits vorhandener, korrekt platzierter
  Endcommit deckt jetzt automatisch die gesamte Operation ab, weil die
  Helfer, die sie aufrufen, nicht mehr vorzeitig committen.
- Für jeden **standalone** genutzten Helfer wurde am jeweiligen API-Endpunkt
  ein `conn.commit()` direkt nach dem Schreibaufruf ergänzt (12 Stellen in
  `api.py`), damit sich das nach außen sichtbare Verhalten dieser Endpunkte
  nicht ändert.

### Entfernte Low-Level-Commits (`backend/db.py`, Schritt 3)

14 `conn.commit()`-Aufrufe entfernt: `update_person`, `delete_person`,
`create_person` (beide Zweige), `add_alias`, `insert_week_plan`,
`delete_week_plan`, `set_setting`, `set_memory_override`,
`clear_memory_override`, `upsert_artist_plan`, `delete_artist_plan`,
`upsert_rehearsal_plan`, `delete_rehearsal_plan`. Sonst keine Änderung an
diesen Funktionen — dieselben SQL-Statements, dieselbe Reihenfolge,
dieselben Parameter.

### Neue Commits an den fachlichen Operationen (`backend/api.py`)

12 `conn.commit()` direkt nach dem jeweiligen Schreibaufruf ergänzt:
`create_person`, `update_person`, `delete_person` (Team), `delete_week`
(Archiv), `memory_set_show`, `memory_set_free`, `memory_set_task`
(Gedächtnis-Overrides), `artist_plan_save`, `artist_plan_delete`,
`rehearsal_plan_save`, `rehearsal_plan_delete`, `set_setting`. Jede dieser
Stellen committet exakt nach dem einen Schreibvorgang, den der Endpunkt
ausführt — keine dieser Operationen wurde funktional erweitert.

`plan_save` und `import_save` wurden **nicht verändert**: ihr bestehender
Endcommit (`api.py:1617` bzw. `api.py:776`) übernimmt jetzt korrekt die
gesamte Operation, weil `db.insert_week_plan`, `db.create_person` und
`db.add_alias` — die einzigen Helfer, die diese beiden Endpunkte
mehrfach/mittendrin aufrufen — nicht mehr selbst committen.

### Bewusst unverändert gelassen (Schritt 4 — Einzeloperationen)

- **`clear_memory_overrides_for_person`**: besitzt aktuell **keinen
  einzigen Aufrufer** — weder in `api.py` noch in einem Test (per
  repository-weitem Grep bestätigt). Da diese Funktion mit keiner anderen
  Schreiboperation zusammen aufgerufen wird, entsteht durch ihr
  eigenständiges Commit kein Halbzustand-Risiko; sie wurde daher nicht
  angefasst, um totem Code keine unnötige Verhaltensänderung
  aufzuzwingen. Sollte sie künftig einen echten Aufrufer bekommen, gilt
  für sie dieselbe Regel wie für die übrigen Helfer.
- **`insert_assignment`/`insert_absence`**: hatten von Anfang an kein
  eigenes Commit — bereits korrekt für ihre Rolle als reine Teilschritte
  von `plan_save`/`import_save` ausgelegt.
- **`_migrate`/`initialize_database`**: committen weiterhin selbst — sie
  laufen einmalig beim Start (FastAPI-Lifespan bzw. Test-Fixtures), nicht im
  Kontext einer Request-Transaktion, und Migrationen/Schema liegen
  ausdrücklich außerhalb des AP10-Scopes.

### SQLite-Fundament unverändert (Schritt 7)

`_configure_connection()` (WAL, `busy_timeout`), `create_connection()`
(inkl. `check_same_thread=False`) und `SCHEMA` wurden **nicht angefasst** —
per `git diff backend/db.py` verifiziert enthält der Diff ausschließlich die
14 entfernten `conn.commit()`-Zeilen, keine einzige weitere Änderung.

---

## Nachher

### Rollback-Verhalten

Bricht eine fachliche Operation mit einer Exception ab, bevor sie ihren
eigenen Endcommit erreicht, schließt `Depends(db.get_db_connection)` die
Connection in seinem `finally`-Block, **ohne vorher zu committen** — SQLite
rollt die dabei noch offene, implizite Transaktion automatisch zurück (siehe
Docstring von `db.get_db_connection`, unverändert seit AP4). Genau dieser
bereits vorhandene Mechanismus trägt jetzt die komplette Atomaritätsgarantie
für alle mehrstufigen Operationen — es musste kein neuer Rollback-Code
geschrieben werden, nur die vorzeitigen Commits, die ihn bisher unterlaufen
haben, mussten entfernt werden.

### Fehler-Injektion (Schritt 8)

Neue Datei
[backend/tests/test_transaction_boundaries.py](../../backend/tests/test_transaction_boundaries.py)
(12 Tests). Jeder Rollback-Test erzwingt eine Exception mitten in einer
mehrstufigen Operation und prüft danach **mit einer frischen Connection**
(zeigt nur committete Daten, wie ein zweiter echter Request), dass weder ein
Container-Datensatz noch Teil-Datensätze übrig geblieben sind:

| Test | Injektionspunkt | Erwartung |
|---|---|---|
| `test_plan_save_rolls_back_when_first_assignment_fails` | 1. `insert_assignment` schlägt fehl | keine Planwoche, keine Zuweisung |
| `test_plan_save_rolls_back_when_second_assignment_fails` | 2. `insert_assignment` schlägt fehl (1. gelingt) | keine Planwoche, **auch die erste Zuweisung nicht** |
| `test_plan_save_rolls_back_when_audit_metadata_fails` | `intelligence_audit.record_plan_saved` schlägt fehl (Woche + alle Zuweisungen bereits geschrieben) | keine Planwoche, keine Zuweisungen |
| `test_plan_save_succeeds_without_injected_fault` | — (Gegenprobe) | Planwoche + Zuweisung vorhanden |
| `test_import_save_rolls_back_when_assignment_insert_fails` | `insert_assignment` schlägt fehl | keine Planwoche, keine Person/Alias für die fehlgeschlagene Zeile |
| `test_import_save_rolls_back_new_person_and_alias_from_earlier_row` | 2. Import-Zeile schlägt fehl (1. legt neue Person+Alias an und gelingt) | **weder Person noch Alias aus Zeile 1** bleiben bestehen |
| `test_import_save_rolls_back_when_absence_insert_fails` | `insert_absence` schlägt fehl | keine Planwoche, keine Zuweisung, keine Abwesenheit |
| `test_import_save_succeeds_without_injected_fault` | — (Gegenprobe) | Planwoche + Zuweisung vorhanden |
| `test_artist_plan_save_rolls_back_when_entries_insert_fails` | `INSERT INTO artist_plan_entries` schlägt fehl | kein Künstlerplan ohne seine Einträge |
| `test_artist_plan_save_succeeds_without_injected_fault` | — (Gegenprobe) | Künstlerplan + Einträge vorhanden |
| `test_rehearsal_plan_save_rolls_back_when_rehearsal_insert_fails` | `INSERT INTO rehearsals` schlägt fehl | kein Probenplan ohne Probeneinträge |
| `test_rehearsal_plan_save_succeeds_without_injected_fault` | — (Gegenprobe) | Probenplan + Probeneintrag vorhanden |

`test_import_save_rolls_back_new_person_and_alias_from_earlier_row` deckt
exakt das im Auftrag genannte Personen/Alias-Szenario ab: eine bereits
erfolgreich angelegte Person samt Alias aus einer früheren Zeile derselben
Import-Operation wird verworfen, wenn eine spätere Zeile scheitert — Anlegen
und Verwerfen gehören zur selben fachlichen Operation.

Für `upsert_artist_plan`/`upsert_rehearsal_plan` (mehrere `conn.execute`-
Aufrufe hintereinander, dann `conn.executemany`) ließ sich die Fehlerstelle
nicht per `monkeypatch` auf `sqlite3.Cursor`/`sqlite3.Connection` setzen —
das sind eingebaute C-Typen ohne beschreibbares `__dict__`. Stattdessen
nutzen diese beiden Tests FastAPIs eigenen
`app.dependency_overrides`-Mechanismus: eine `_FailingConnProxy` reicht alle
Aufrufe an eine echte, produktionsidentisch geöffnete Connection durch und
löst nur beim SQL-Statement mit dem gesuchten Textfragment eine Exception
aus — ohne `db.py` oder `api.py` anzufassen.

### Tests

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m py_compile db.py api.py test_transaction_boundaries.py test_connection_lifecycle.py` | 0 | erfolgreich |
| `python -c "import backend.api, backend.db"` | 0 | keine Importfehler |
| `pytest` (3× hintereinander) | 0 / 0 / 0 | **217 passed** (205 vorher + 12 neu), stabil über 3 Läufe |
| `TestClient(api.app)` + `GET /api/health` gegen frische Testdatenbank | 200 | App-Start (Lifespan → `initialize_database()`) unverändert funktionsfähig |

Ein bestehender Test
([test_connection_lifecycle.py:51-67](../../backend/tests/test_connection_lifecycle.py:51))
schlug nach der Umstellung zunächst fehl: er ruft `db.create_person(conn,
...)` **direkt** auf einer selbst geöffneten Connection auf und schloss sie
danach ohne eigenen Commit — verließ sich also (wie ein „Aufrufer" außerhalb
der API) auf das inzwischen entfernte Auto-Commit von `create_person`. Der
Test wurde um ein explizites `conn.commit()` ergänzt — genau das
Verhalten, das AP10 von jedem Aufrufer eines Low-Level-Helfers jetzt
verlangt. Kein anderer bestehender Test war betroffen, weil alle übrigen
entweder über den FastAPI-`TestClient` (dessen Endpunkte weiterhin selbst
committen) oder auf derselben, noch offenen Connection lesen (SQLite zeigt
unkommittete eigene Schreibvorgänge auf derselben Connection ohnehin an).

### Verbleibende Einzeloperationen

`clear_memory_overrides_for_person` bleibt die einzige Low-Level-Funktion in
`db.py`, die weiterhin selbst committet — mangels jeglichem Aufrufer aktuell
ohne jedes Halbzustand-Risiko (siehe „Bewusst unverändert gelassen" oben).

---

## Scope-Kontrolle

Bestätigt per `git diff --stat` (nur `backend/db.py`, `backend/api.py`,
`backend/tests/test_connection_lifecycle.py`, plus die neue Testdatei):

- keine API-Pfade geändert (keine Route umbenannt/entfernt/hinzugefügt)
- keine Request-/Response-Modelle geändert
- kein Datenbankschema geändert
- keine Datenmigration
- keine Planungslogik geändert
- keine Frontendänderung (Hinweis: das Arbeitsverzeichnis enthält
  unabhängig von dieser Session bereits nicht committete Änderungen an
  `frontend/app/dashboard/page.tsx`, `frontend/app/layout.tsx` sowie neue
  Dateien `frontend/components/DashboardCommand.tsx` und zwei CSS-Dateien —
  diese stammen nicht aus AP10 und wurden in dieser Session nicht
  angefasst)
- keine neuen Abhängigkeiten, kein neues ORM, kein SQLAlchemy
- kein Commit, kein Push
