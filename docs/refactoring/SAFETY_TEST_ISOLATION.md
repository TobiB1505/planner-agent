# Safety Fix — Testisolation und SQLite-Thread-Sicherheit

Sicherheits-Arbeitspaket: die Testsuite lief teilweise gegen die produktive
lokale Datenbank (`local_data/database/dienstplaene.db`), und ein
architektonischer Isolationsdefekt ließ das für zwei Endpunkte unmöglich
über den etablierten Test-Mechanismus abfangen. Zusätzlich wurde ein echter,
reproduzierbarer SQLite-Thread-Fehler unter FastAPI-Threadpool-Ausführung
gefunden und behoben. Keine Fachlogik, keine API-Verträge, kein
Datenbankschema geändert.

Alle Verifikationsläufe liefen gegen isolierte Testdatenbanken (`tmp_path`)
oder — für die explizite „läuft die Suite die echte Datei nicht an"-Prüfung —
mit der real vorhandenen Entwicklungsdatenbank temporär beiseite gelegt und
danach unverändert (MD5-identisch) wiederhergestellt. Es wurde nie in die
echte Datei geschrieben.

---

## Vorher

### Übersicht (Schritt 1)

| Testdatei | DB-Zugriff | echte DB möglich? | Isolation vorhanden |
|---|---|---|---|
| `test_api.py` | `TestClient(app)`, `/api/health`, `/api/team` | **Ja** — Docstring dokumentierte dies explizit als Absicht | **Nein** |
| `test_async_imports.py` | `monkeypatch db.DATABASE_PATH` + `tmp_path`; ruft zusätzlich `/api/health` | **Ja, indirekt** — über den unten beschriebenen Architekturdefekt | Teilweise (DB-Connection isoliert, `/api/health`-Aufruf nicht) |
| `test_connection_lifecycle.py` | `monkeypatch` + `tmp_path`, `TestClient` (nur `/api/team`) | Nein | Ja |
| `test_dashboard_intelligence.py` | `monkeypatch` + `tmp_path` | Nein | Ja |
| `test_dashboard_week_selection.py` | `monkeypatch` + `tmp_path` | Nein | Ja |
| `test_database.py` | `monkeypatch` + `tmp_path` (Fixture `isolated_db`) | Nein | Ja |
| `test_intelligence.py` | `monkeypatch` + `tmp_path` (Helper `_conn`) | Nein | Ja |
| `test_memory_dataflow.py` | `monkeypatch` + `tmp_path` (Helper `_conn`) | Nein | Ja |
| `test_memory_free_suggestions_isolated.py` | `sqlite3.connect(":memory:")` | Nein | Ja |
| `test_paths.py` | liest nur den Pfad-Konstantenwert, öffnet nie eine Connection | Nein (kein Zugriff) | Ja (n/a) |
| `test_person_lookup.py` | `monkeypatch` + `tmp_path` (Helper `_conn`) | Nein | Ja |
| `test_plan_response_reuse.py` | `monkeypatch` + `tmp_path`, `TestClient` | Nein | Ja |
| `test_plan_save.py` | `monkeypatch` + `tmp_path`, `TestClient` | Nein | Ja |
| `test_planning_rules_isolated.py` | reine Funktionen / In-Memory | Nein | Ja |
| `test_sqlite_concurrency.py` | eigene `tmp_path`-Datei, eigene Connections | Nein | Ja |
| `test_team_overview.py` | `monkeypatch` + `tmp_path` | Nein | Ja |
| `test_team_overview_memory.py` | `monkeypatch` + `tmp_path` (Helper `_conn`) | Nein | Ja |
| `test_templates.py` | liest nur XLSX-Ressourcendateien (kein SQLite) | Nein (kein DB-Bezug) | Ja (n/a) |

### Kritischer Befund: architektonischer Isolationsdefekt

`GET /api/health` und `GET /api/system/diagnostics` (`backend/api.py`) lasen
`config_paths.DATABASE_PATH` — ein **separates** Modul-Attribut aus
`backend/config/paths.py` — statt `db.DATABASE_PATH`. `db.py` importiert
`DATABASE_PATH` zwar ursprünglich von dort (`from .config.paths import
DATABASE_PATH`), bindet es damit aber als **eigenen** Namen in seinem
Modul-Namensraum. Der in praktisch allen Tests verwendete Mechanismus
(`monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "...")`) ändert
ausschließlich `db.DATABASE_PATH` — `config_paths.DATABASE_PATH` blieb davon
komplett unberührt und zeigte in JEDEM Test weiterhin auf die echte Datei.

**Betroffen**: `test_api.py` (2 Health-Tests) und `test_async_imports.py`
(2 Responsivitätstests, die `/api/health` als Nebenprüfung aufrufen — die
eigentliche DB-Isolation dieser Datei war korrekt, nur der Health-Call
umging sie). Beide Zugriffe waren lesend (`SELECT 1` bzw.
`PRAGMA integrity_check`), keine Schreiboperation — aber echte
Datei-/Verbindungs-Berührung, potenziell inklusive `-wal`/`-shm`-Erzeugung
bei aktivem WAL-Modus, und Kopplung des Testergebnisses an lokalen
Entwicklungszustand.

### SQLite-Thread-Fehler (Schritt 7)

FastAPI wickelt einen sync-generator-basierten Dependency wie
`Depends(db.get_db_connection)` über `contextmanager_in_threadpool` in bis zu
drei separaten `anyio.to_thread.run_sync(...)`-Aufrufen ab
(Dependency-Enter → `create_connection()`, Endpunkt-Body, Dependency-Exit →
`conn.close()`). Unter echter Nebenläufigkeit (mehrere Requests konkurrieren
um denselben kleinen Worker-Pool) landen diese drei Schritte nicht
zuverlässig im selben OS-Thread. Mit dem sqlite3-Standardverhalten
(`check_same_thread=True`) führte das reproduzierbar zu:

```
sqlite3.ProgrammingError: SQLite objects created in a thread can only be
used in that same thread.
```

Empirisch verifiziert (vor dem Fix): 10 echte parallele Requests (eigene
Python-Threads, nicht nur sequenzielle Aufrufe) gegen einen
`Depends(db.get_db_connection)`-Endpunkt scheiterten zuverlässig; rein
sequenzielle Requests waren nie betroffen (der Fehler tritt nur bei
tatsächlicher Thread-Konkurrenz um den Worker-Pool auf).

### Test-Baseline

`pytest`: 117 passed (Stand nach AP8) — bereits vor diesem Fix grün, da die
Suite unter normaler (sequenzieller) Ausführung den Thread-Fehler nicht
auslöst und die Isolationslücke lesend/unauffällig war.

---

## Umsetzung

### Schutztest (Schritt 6): `backend/tests/conftest.py`

Neue, autouse-aktive Fixture `_guard_against_real_database`: wrappt
`sqlite3.connect` global für die Dauer jedes einzelnen Tests und lässt den
Test mit einer klaren `AssertionError` fehlschlagen, sobald der aufgelöste
Zielpfad exakt der echten lokalen Datenbank entspricht — unabhängig davon,
über welchen Codepfad die Verbindung geöffnet wird
(`db.create_connection()`, ein direkter `sqlite3.connect(...)`-Aufruf,
`config_paths.DATABASE_PATH` oder `db.DATABASE_PATH`). `:memory:`-Datenbanken
sind ausdrücklich ausgenommen. Dieser Fixture schützt **die gesamte
Testsuite** automatisch, ohne dass einzelne Testdateien etwas dafür tun
müssen — bewiesen: er hat beim ersten Testlauf nach seiner Einführung sofort
alle drei ungeschützten `test_api.py`-Tests korrekt zum Scheitern gebracht.

### Zentrale Fixtures: `test_db_path`/`test_conn`

Ebenfalls in `conftest.py`: eine wiederverwendbare, `tmp_path`-basierte
Fixture (`test_db_path`) plus eine Variante mit bereits geöffneter
Connection (`test_conn`) — dasselbe Muster, das ca. 10 Testdateien bereits
über lokale `_conn(tmp_path, monkeypatch, filename)`-Helper umsetzen, hier
zentral für neue Tests bereitgestellt.

**Bewusste Entscheidung**: die bereits korrekt isolierten Testdateien wurden
**nicht** zwangsweise auf die neue zentrale Fixture umgestellt — sie
funktionieren, sind bereits durch frühere Arbeitspakete verifiziert, und der
neue Schutz-Fixture sichert sie ohnehin zusätzlich ab. Migriert wurde
ausschließlich `test_api.py` (der einzige tatsächlich unisolierte Fall).

### Produktionsänderung (Schritt 5): `backend/api.py`

`health()` und `system_diagnostics()` lesen jetzt `db.DATABASE_PATH` statt
`config_paths.DATABASE_PATH` (drei Stellen: Existenzprüfung, `sqlite3.connect`,
der im Response zurückgegebene `path`-Wert). **Minimal, verhaltensneutral in
Produktion**: `db.DATABASE_PATH` wird beim Modulimport aus genau demselben
`config_paths.DATABASE_PATH` initialisiert — beide sind in jedem echten
Deployment identisch, der einzige Unterschied entsteht ausschließlich durch
`monkeypatch.setattr(db, "DATABASE_PATH", ...)` in Tests. Dadurch respektieren
beide Endpunkte jetzt denselben Isolationsmechanismus wie jede andere
DB-Nutzung im Projekt. `config_paths.DATABASE_DIR` (Verzeichnis-Diagnose) und
die Template-Pfade wurden bewusst **nicht** angefasst — außerhalb des
konkreten Risikos (`dienstplaene.db`-Datei) und nicht Teil dieses Scopes.

### SQLite-Thread-Sicherheit (Schritt 7/8): `backend/db.py`

`create_connection()` öffnet die Verbindung jetzt mit
`check_same_thread=False`. Bewertung nach dem in Schritt 8 vorgegebenen
Entscheidungsrahmen:

- **Fall A (Connection bleibt immer im selben Thread) trifft nicht zu** —
  empirisch widerlegt (siehe „SQLite-Thread-Fehler" oben).
- **Fall B (FastAPI kann dieselbe Connection zwischen Threads verwenden)
  trifft zu**, und alle dafür geforderten Voraussetzungen sind erfüllt:
  - **Eine Connection pro Request**: `create_connection()` öffnet immer eine
    neue, unabhängige Verbindung; `get_db_connection()` gibt genau eine
    Connection pro Request-Zyklus aus (AP4, unverändert).
  - **Sauberes Close**: `get_db_connection()`s `finally: conn.close()` läuft
    in jedem Fall, auch bei einer Exception (AP4, unverändert; zusätzlich
    jetzt mit `ConnectionCloseSpy` unter echter Parallelität verifiziert).
  - **Keine globalen Connections**: kein Connection-Objekt wird zwischen
    Requests oder Aufrufern geteilt (unverändert).
  - Eine Connection wird **innerhalb** eines Requests nur **sequenziell**
    verwendet (Dependency-Enter → Endpunkt-Body → Dependency-Exit) — nie von
    zwei Threads **gleichzeitig**. `check_same_thread=True` schützt vor
    echter Parallelnutzung durch mehrere Threads, die hier nachweislich nie
    stattfindet; nur vor dem (hier unschädlichen) Threadwechsel zwischen
    sequenziellen Schritten.
- **Keine Änderung ohne Test**: die Entscheidung ist mit vier neuen,
  gezielten Tests abgesichert (siehe unten), zwei davon nachweislich
  fehlschlagend ohne den Fix (per `git stash` verifiziert).

### Concurrent-Request-Test (Schritt 9): `backend/tests/test_sqlite_thread_safety.py`

Vier Tests, alle gegen isolierte Testdatenbanken, mit **echten** parallelen
Requests (eigene Python-Threads, nicht nur sequenzielle `TestClient`-Aufrufe
— nur echte Thread-Konkurrenz reproduziert die anyio-Worker-Pool-Situation):

1. `test_parallel_health_requests_do_not_raise_thread_errors` — 10 parallele
   `/api/health`-Requests.
2. `test_parallel_read_requests_close_every_connection` — 10 parallele
   `/api/people/active`-Requests, verifiziert per `ConnectionCloseSpy`
   zusätzlich, dass jede der 10 Request-Connections tatsächlich geschlossen
   wird (kein Leak).
3. `test_save_and_read_parallelism_does_not_error_or_deadlock` — ein
   `POST /api/plan/save` parallel zu mehreren `GET`-Requests.
4. `test_repeated_parallel_bursts_stay_stable` — drei aufeinanderfolgende
   Bursts, um Zustandsaufbau über mehrere Bursts hinweg auszuschließen.

**Verifiziert per `git stash`** (echter Vorher/Nachher-Codezustand): Tests 2
und 3 schlagen ohne `check_same_thread=False` zuverlässig fehl, mit dem Fix
bestehen alle vier. Test 1 besteht in beiden Zuständen — `/api/health` öffnet
und schließt seine Connection innerhalb eines einzigen Funktionsaufrufs
(kein `Depends(...)`-Generator mit separaten Enter-/Exit-Schritten) und war
nie von diesem spezifischen Fehler betroffen; als allgemeine
Nebenläufigkeits-Absicherung dennoch sinnvoll.

---

## Nachher

### Testanzahl

117 → **121 Tests** (3 neu in `test_api.py` migriert/erhalten, 4 neu in
`test_sqlite_thread_safety.py`, `test_api.py` selbst blieb bei 3 Tests –
Netto +4 aus der neuen Thread-Safety-Datei).

### Isolation bestätigt

- Globaler Schutz-Fixture aktiv für alle 121 Tests — kein Test öffnet die
  echte Datenbank (verifiziert: hätte er es versucht, wäre er mit einer
  klaren `AssertionError` fehlgeschlagen, wie beim initialen Testlauf mit
  dem neuen Fixture für die drei alten `test_api.py`-Tests demonstriert).
- `/api/health`/`/api/system/diagnostics` respektieren jetzt denselben
  Isolationsmechanismus wie alle anderen Endpunkte.

### Keine lokalen Dateien verändert

- MD5 von `local_data/database/dienstplaene.db` vor und nach allen
  Testläufen dieser Session identisch: `e54b965216b7ea02f3a4075e170dccc2`.
- Testlauf mit der echten Datei temporär entfernt (simuliert „keine lokale
  DB vorhanden") und Testlauf mit vorhandener Datei liefern identische
  Ergebnisse (121 passed in beiden Fällen).

### Ergebnisse

| Befehl | Ergebnis |
|---|---|
| `pytest` (3× hintereinander) | 121 passed, 121 passed, 121 passed — identisch |
| `pytest` ohne lokale DB (Datei temporär entfernt) | 121 passed |
| `pytest` mit vorhandener Entwicklungsdatenbank | 121 passed, MD5 unverändert |
| `pytest` mit nahezu leerer Umgebung (`env -i`, kein `GEMINI_API_KEY`/`PLANNER_DATA_DIR`) | 121 passed |
| `pytest` in vertauschter Dateireihenfolge (2 Beispieldateien) | 7 passed (beide Richtungen identisch) — keine Reihenfolgeabhängigkeit |
| Paralleler Testlauf (`pytest-xdist`) | **nicht verfügbar** (nicht installiert; Scope erlaubt keine neuen Dependencies) — stattdessen durch `test_sqlite_thread_safety.py`s eigene Thread-Parallelität ersetzt/abgedeckt |
| `python -m py_compile` (alle geänderten Dateien) | erfolgreich |
| `python -c "from backend.api import app"` | Import ok, 63 Routen (unverändert) |
