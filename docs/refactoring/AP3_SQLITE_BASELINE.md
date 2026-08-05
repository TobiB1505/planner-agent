# AP3 — SQLite-Fundament (Indizes, WAL, busy_timeout)

Arbeitspaket aus dem Refactoring-Plan: additive Indizes für häufige Lookups,
`journal_mode=WAL` für stabileren Parallelzugriff, `busy_timeout=5000` pro
Verbindung. Kein Connection-Lifecycle-Refactoring (AP4), keine
`PRAGMA foreign_keys=ON`, keine Datenmigration, keine Transaktionsgrenzen
geändert.

Alle Messungen/Tests liefen ausschließlich auf Kopien der Datenbank oder auf
temporären, dateibasierten Testdatenbanken (`tmp_path`) — mit einer
dokumentierten Ausnahme: der bereits vorhandene Test `test_api.py` läuft
absichtlich (siehe eigener Docstring dort) gegen die echte lokale Datenbank,
aber nur über zwei rein lesende Endpunkte (`/api/health`, `/api/team`). Dieses
Verhalten stammt nicht aus AP3, sondern war bereits vorher so angelegt.

## Vorher

**Git-Status zu Beginn der Session** (unverändert von der vorherigen,
uncommitteten AP1-Session — nicht Teil von AP3, nicht angefasst):

```
On branch main, up to date with origin/main
Staged:   deleted backend/app.py, deleted backend/theme.py
Unstaged: modified README.md, backend/grid.py, backend/requirements.txt,
          frontend/lib/categoryColors.ts
```

**Bestehende Indizes** (`SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'`,
auf einer Kopie der Live-DB):

| Index | Tabelle | Definition |
|---|---|---|
| `idx_assignments_person_date` | assignments | `(person_id, date)` |
| `idx_absences_person_date` | absences | `(person_id, date)` |
| `idx_audit_week_created` | plan_audit_log | `(week_plan_id, created_at DESC)` |
| `sqlite_autoindex_people_1` | people | UNIQUE(name) |
| `sqlite_autoindex_people_aliases_1` | people_aliases | UNIQUE(alias) |
| `sqlite_autoindex_artist_plans_1` | artist_plans | UNIQUE(start_date) |
| `sqlite_autoindex_artist_plan_entries_1` | artist_plan_entries | UNIQUE(artist_plan_id, date, field_key) |
| `sqlite_autoindex_rehearsal_plans_1` | rehearsal_plans | UNIQUE(start_date) |
| `sqlite_autoindex_employee_skills_1` | employee_skills | UNIQUE(person_id, skill_id) |
| `sqlite_autoindex_employee_memory_1` | employee_memory | UNIQUE(person_id, type, subject, source) |
| `sqlite_autoindex_person_memory_overrides_1` | person_memory_overrides | UNIQUE(person_id, facet, item_key) |
| `sqlite_autoindex_settings_1` | settings | PRIMARY KEY(key) |

**PRAGMA-Werte** (Kopie der Live-DB):

```
journal_mode = delete
busy_timeout = 0
foreign_keys = 0
```

**Zeilenzahlen der Live-DB** (Ausgangszustand):

```
people               41
people_aliases       55
week_plans           11
assignments          1490
absences             378
rehearsals           72
rehearsal_people     345
artist_plan_entries  154
plan_audit_log       24
```

**EXPLAIN QUERY PLAN — vorher** (Kopie der Live-DB, reale Queries aus
`backend/db.py` bzw. `backend/intelligence/audit.py`):

| Query | Plan vorher |
|---|---|
| `SELECT person_id FROM people_aliases WHERE alias = ? COLLATE NOCASE` | `SCAN people_aliases` |
| `SELECT id FROM people WHERE name = ? COLLATE NOCASE` | `SCAN people USING COVERING INDEX sqlite_autoindex_people_1` (Index wird nur als Ganzes durchlaufen, keine gezielte SEARCH) |
| `SELECT * FROM assignments WHERE week_plan_id = ?` | `SCAN assignments` |
| `SELECT * FROM absences WHERE week_plan_id = ?` | `SCAN absences` |
| `SELECT * FROM rehearsals WHERE date BETWEEN ? AND ?` | `SCAN rehearsals` |
| `SELECT * FROM rehearsals WHERE rehearsal_plan_id = ?` | `SCAN rehearsals` |
| `SELECT * FROM rehearsal_people WHERE rehearsal_id = ?` | `SCAN rehearsal_people` |
| `SELECT date, field_key, content FROM artist_plan_entries WHERE artist_plan_id = ?` | `SEARCH artist_plan_entries USING INDEX sqlite_autoindex_artist_plan_entries_1 (artist_plan_id=?)` — **bereits effizient**, siehe unten |
| `SELECT * FROM plan_audit_log WHERE start_date = ? ORDER BY id DESC LIMIT ?` | `SCAN plan_audit_log` |

**Bestehende Test-/Build-Ergebnisse vor AP3** (identisch zur AP1-Baseline dieser
Session): `pytest` 54 passed, `npm run build`/`npm run lint` grün (je eine
vorbestehende, unabhängige Warnung).

## Änderungen

**`backend/db.py`** — einzige geänderte Datei (Fachlogik in `api.py`,
`grid.py`, Frontend etc. nicht angefasst).

1. **Additive Indizes** im `SCHEMA`-String ergänzt (alle `CREATE INDEX IF NOT
   EXISTS`, laufen sowohl bei einer neuen als auch bei einer bestehenden DB
   automatisch mit, da `SCHEMA` bei jedem `get_conn()` per `executescript`
   ausgeführt wird):
   - `idx_people_aliases_alias_nocase` auf `people_aliases(alias COLLATE NOCASE)`
   - `idx_people_name_nocase` auf `people(name COLLATE NOCASE)`
   - `idx_assignments_week_plan_id` auf `assignments(week_plan_id)`
   - `idx_absences_week_plan_id` auf `absences(week_plan_id)`
   - `idx_rehearsals_date` auf `rehearsals(date)`
   - `idx_rehearsals_rehearsal_plan_id` auf `rehearsals(rehearsal_plan_id)`
   - `idx_rehearsal_people_rehearsal_id` auf `rehearsal_people(rehearsal_id)`
   - `idx_plan_audit_log_start_date` auf `plan_audit_log(start_date)`

   **Bewusst NICHT angelegt:** ein separater Index auf
   `artist_plan_entries(artist_plan_id)`. Der bestehende
   `UNIQUE(artist_plan_id, date, field_key)`-Autoindex hat `artist_plan_id`
   bereits als führende Spalte und lieferte schon vor AP3 eine
   `SEARCH ... USING INDEX (artist_plan_id=?)` (siehe Tabelle oben) — ein
   weiterer Index wäre redundant. Dies ist ein Abweichen von der
   ursprünglichen Analyse, das erst durch die Verifikation in Schritt 2/7
   dieser Session bestätigt wurde.

2. **WAL-Konfiguration**: neue Funktion `_configure_connection(conn)`, die
   `PRAGMA journal_mode=WAL;` ausführt und das *tatsächliche* Ergebnis
   prüft (nicht nur "kein Fehler geworfen"). Weicht der zurückgegebene Modus
   von `"wal"` ab (z. B. bei `:memory:`-Datenbanken, wo WAL nicht unterstützt
   wird), wird eine `logger.warning(...)` ausgegeben — kein stiller
   Erfolg, aber auch kein Abbruch der Anwendung.

3. **busy_timeout**: dieselbe Funktion setzt zusätzlich
   `PRAGMA busy_timeout = 5000;` — pro Verbindung, da busy_timeout im
   Gegensatz zu journal_mode nicht dateipersistent ist.

4. **Aufruf**: `_configure_connection(conn)` wird in `get_conn()` direkt nach
   `sqlite3.connect(...)` und vor `executescript(SCHEMA)` aufgerufen — der
   Connection-Lifecycle selbst (eine Verbindung pro `get_conn()`-Aufruf,
   nie geschlossen) bleibt unverändert; das ist ausdrücklich AP4
   vorbehalten.

5. **Foreign Keys**: `PRAGMA foreign_keys` wird nicht gesetzt. Ausgangswert
   `0` bleibt unverändert (siehe Nachher-Abschnitt).

**`backend/tests/test_sqlite_concurrency.py`** (neu) — 5 Tests für WAL und
`busy_timeout` auf einer temporären, dateibasierten Testdatenbank (`tmp_path`,
nie die echte lokale DB, nie `:memory:` da WAL dort nicht greift).

## Nachher

**Neue Indizes** (Kopie der Live-DB, nach Anwendung des neuen `SCHEMA` über
`db.get_conn()`):

```
idx_absences_person_date
idx_absences_week_plan_id            (neu)
idx_assignments_person_date
idx_assignments_week_plan_id         (neu)
idx_audit_week_created
idx_people_aliases_alias_nocase      (neu)
idx_people_name_nocase               (neu)
idx_plan_audit_log_start_date        (neu)
idx_rehearsal_people_rehearsal_id    (neu)
idx_rehearsals_date                  (neu)
idx_rehearsals_rehearsal_plan_id     (neu)
+ alle bisherigen sqlite_autoindex_* (unverändert, keiner entfernt/umbenannt)
```

**PRAGMA-Werte** (Kopie der Live-DB, nach `db.get_conn()`):

```
journal_mode = wal
busy_timeout = 5000
foreign_keys = 0   (unverändert, wie in Schritt 6 gefordert)
```

**EXPLAIN QUERY PLAN — nachher** (identische Queries, Kopie der Live-DB nach
Indexerstellung):

| Query | Plan vorher | Plan nachher |
|---|---|---|
| Alias-Lookup (`people_aliases`, NOCASE) | `SCAN people_aliases` | `SEARCH people_aliases USING INDEX idx_people_aliases_alias_nocase (alias=?)` |
| Personenname (`people`, NOCASE) | `SCAN ... COVERING INDEX` | `SEARCH people USING COVERING INDEX idx_people_name_nocase (name=?)` |
| `assignments WHERE week_plan_id=?` | `SCAN assignments` | `SEARCH assignments USING INDEX idx_assignments_week_plan_id (week_plan_id=?)` |
| `absences WHERE week_plan_id=?` | `SCAN absences` | `SEARCH absences USING INDEX idx_absences_week_plan_id (week_plan_id=?)` |
| `rehearsals WHERE date BETWEEN ?` | `SCAN rehearsals` | `SEARCH rehearsals USING INDEX idx_rehearsals_date (date>? AND date<?)` |
| `rehearsals WHERE rehearsal_plan_id=?` | `SCAN rehearsals` | `SEARCH rehearsals USING INDEX idx_rehearsals_rehearsal_plan_id (rehearsal_plan_id=?)` |
| `rehearsal_people WHERE rehearsal_id=?` | `SCAN rehearsal_people` | `SEARCH rehearsal_people USING INDEX idx_rehearsal_people_rehearsal_id (rehearsal_id=?)` |
| `artist_plan_entries WHERE artist_plan_id=?` | `SEARCH ... sqlite_autoindex_artist_plan_entries_1` | unverändert — kein neuer Index nötig (bewusst übersprungen) |
| `plan_audit_log WHERE start_date=?` | `SCAN plan_audit_log` | `SEARCH plan_audit_log USING INDEX idx_plan_audit_log_start_date (start_date=?)` |

Jede vorgeschlagene, tatsächlich neu angelegte Query nutzt nach der Änderung
eine gezielte `SEARCH ... USING INDEX` statt eines vollen `SCAN`.

**Parallelzugriffstest** (`backend/tests/test_sqlite_concurrency.py`, 5 Tests,
temporäre Datei-DB, keine künstlich langen Wartezeiten — Gesamtlaufzeit ≈ 0.45 s):

1. `test_new_file_database_runs_in_wal_mode` — neue Datei-DB läuft im WAL-Modus.
2. `test_busy_timeout_is_set_on_every_connection` — `busy_timeout=5000` auf
   zwei unabhängigen Verbindungen.
3. `test_two_connections_can_read_the_same_committed_data` — Connection A
   schreibt+committet, Connection B liest denselben Stand.
4. `test_reader_is_not_blocked_by_an_open_writer_transaction` — eine offene,
   noch nicht committete Schreibtransaktion blockiert einen parallelen Leser
   nicht (Leser bekommt sofort < 0.5 s Antwort, sieht die uncommittete Zeile
   erwartungsgemäß noch nicht; nach Commit ist sie sichtbar).
5. `test_short_write_lock_is_absorbed_by_busy_timeout` — ein 0.3 s gehaltener
   Schreib-Lock einer zweiten Verbindung führt dank `busy_timeout` zu kurzem
   Warten (< 2 s) statt sofort `sqlite3.OperationalError: database is
   locked` auszulösen; nach Abschluss beider Transaktionen sind beide
   geschriebenen Zeilen konsistent vorhanden.

Alle 5 Tests: **passed**.

**Testergebnisse (gesamt, nach den Änderungen):**

| Befehl | Exit-Code | Ergebnis | Warnungen |
|---|---|---|---|
| `python -m compileall backend` | 0 | erfolgreich | keine |
| `pytest` (aus Projektstamm) | 0 | **59 passed** (54 bestehend + 5 neu) | 9 unveränderte, unabhängige Warnungen (Python-3.9-EOL, PyMuPDF/pydantic/urllib3/google-auth-Deprecations) |
| `python -c "from backend.api import app"` | 0 | Import erfolgreich | 2 unveränderte google-auth-FutureWarnings |
| `python -c "import backend.run_local"` | 0 | Import erfolgreich, `main()` aufrufbar | dieselben |
| `cd frontend && npm run build` | 0 | erfolgreich, 16/16 Seiten | 1 vorbestehende, unabhängige Turbopack-NFT-Warnung |
| `cd frontend && npm run lint` | 0 | 0 Fehler | 1 vorbestehende, unabhängige Warnung (`lastSavedAt` unused) |

**Datenintegritätsprüfung** (Live-DB, Zeilenzahlen vor/nach dem vollständigen
`pytest`-Lauf — `test_api.py` läuft absichtlich rein lesend gegen die echte
DB):

| Tabelle | vorher | nachher |
|---|---|---|
| people | 41 | 41 |
| people_aliases | 55 | 55 |
| week_plans | 11 | 11 |
| assignments | 1490 | 1490 |
| absences | 378 | 378 |
| rehearsals | 72 | 72 |
| rehearsal_people | 345 | 345 |

`PRAGMA integrity_check` auf der Live-DB nach dem Testlauf: `ok`.

**Bekannter, gewollter Nebeneffekt:** Da `test_api.py` bereits vor AP3 bewusst
gegen die echte lokale Datenbank läuft (zwei rein lesende Endpunkte), wechselt
deren `journal_mode` beim ersten `pytest`-Lauf nach dieser Änderung dauerhaft
von `delete` auf `wal` (zwei zusätzliche Dateien `dienstplaene.db-wal` /
`dienstplaene.db-shm` erscheinen neben der Hauptdatei). Das ist exakt das in
AP3 geforderte Verhalten ("muss bei normaler App-/Datenbankinitialisierung
zuverlässig aktiv werden") und verändert keine Nutzdaten — bestätigt durch
identische Zeilenzahlen und `integrity_check: ok` oben.

## Vorher-Nachher-Vergleich (Kurzfassung)

| Aspekt | Vorher | Nachher |
|---|---|---|
| journal_mode | delete | wal |
| busy_timeout | 0 | 5000 (pro Verbindung) |
| foreign_keys | 0 | 0 (unverändert) |
| Alias-/Namenslookup | SCAN | SEARCH USING INDEX |
| assignments/absences nach week_plan_id | SCAN | SEARCH USING INDEX |
| rehearsals nach date/rehearsal_plan_id | SCAN | SEARCH USING INDEX |
| rehearsal_people nach rehearsal_id | SCAN | SEARCH USING INDEX |
| plan_audit_log nach start_date | SCAN | SEARCH USING INDEX |
| artist_plan_entries nach artist_plan_id | SEARCH (Autoindex) | unverändert (kein neuer Index nötig) |
| Tabellenanzahl / Zeilenzahlen | — | unverändert |
| pytest | 54 passed | 59 passed |
