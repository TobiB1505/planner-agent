# AP4 — Verbindungs- und Schema-Lifecycle

Arbeitspaket aus dem Refactoring-Plan: SQLite-Schema und Migrationen nur noch
einmal beim App-Start ausführen, `get_conn()` von Schema-/Migrationslogik
befreien, Datenbankverbindungen pro Request zuverlässig schließen. Baut auf
AP3 (additive Indizes, WAL, `busy_timeout=5000`) auf und erhält dessen
Einstellungen unverändert. Transaktionsgrenzen (AP10) und Foreign Keys bleiben
bewusst unangetastet.

---

## Vorher

### Ablauf von `db.get_conn()` (vor AP4)

```python
def get_conn():
    ensure_runtime_directories()
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    _configure_connection(conn)   # AP3: WAL + busy_timeout
    conn.executescript(SCHEMA)    # bei JEDEM Aufruf erneut
    _migrate(conn)                # bei JEDEM Aufruf erneut
    return conn
```

Jeder Aufruf führte also Laufzeitordner-Prüfung, Verbindungsaufbau,
vollständiges Schema-Script (13 `CREATE TABLE`/`CREATE INDEX IF NOT EXISTS`)
und Migrationsprüfung (`PRAGMA table_info` + bedingte `ALTER TABLE`) aus -
unabhängig davon, ob die Datenbank bereits vollständig initialisiert war.

### Aufruferliste (vor AP4), kategorisiert

| Kategorie | Fundstellen | Anzahl |
|---|---|---|
| **API-Request** | `backend/api.py`, ein `conn = get_conn()` (oder inline `get_conn()`) pro Endpunkt-Funktion | **47** Endpunkte |
| **App-Initialisierung** | keine - es gab noch keinen Lifespan | 0 |
| **Test** | `test_database.py` (4 Tests via `isolated_db`-Fixture), `test_plan_save.py` (1 Test, ruft `api.plan_save()` direkt auf und monkeypatcht `api.get_conn`), `test_intelligence.py` (`_conn`-Helper), `test_team_overview.py`, `test_dashboard_week_selection.py`, `test_dashboard_intelligence.py` | 6 Dateien |
| **CLI-/Startskript** | `backend/run_local.py` ruft `db.get_conn()` **nicht** auf - eigene, unabhängige Vorprüfung (`paths.ensure_runtime_directories()` + roher `sqlite3.connect()` nur für `PRAGMA integrity_check`) | 0 direkte Aufrufe |
| **interner Helper** | keiner ruft `get_conn()` selbst auf - alle (`_memory_response`, `_rotation_week_id`, `_resolve_with_choices`, `_assignment_warnings`, `_resolve_or_create` u. a.) erhalten `conn` bereits als Parameter | 0 |
| **einmalige Offline-Operation** | keine identifiziert | 0 |

Zusätzlich zwei **Sonderfälle**, die nie über `db.get_conn()` liefen, sondern
bewusst eine eigene, rohe `sqlite3.connect()`-Verbindung öffnen und
zuverlässig schließen: `health()` und `system_diagnostics()` in `api.py` -
beide müssen auch dann funktionieren, wenn Schema/Verzeichnisse noch gar nicht
existieren (Diagnosezweck). Diese beiden Endpunkte wurden **nicht** verändert
(siehe „Sonderfälle" unten).

### Bekannte Connection-Leaks / unklare Close-Pfade

Alle 47 API-Endpunkte öffneten ihre Verbindung mit `conn = get_conn()` und
schlossen sie **nie** - die Verbindung hing bis zur Garbage Collection des
Python-Objekts offen. Bestätigt durch Repository-Suche: `grep -n "conn.close()"
backend/api.py` traf vor AP4 ausschließlich auf die zwei Sonderfälle
(`health()`, `system_diagnostics()`), nicht auf einen der 47 regulären
Endpunkte.

### Test-/Build-Baseline (vor AP4, identisch zum AP3-Endstand)

| Befehl | Ergebnis |
|---|---|
| `pytest` | 65 passed (59 aus AP1-3 + 6 neue AP4-Tests kommen erst mit dieser Änderung dazu; unmittelbar vor AP4 waren es 59 passed, s. AP3-Doku) |
| `npm run build` | erfolgreich, 1 vorbestehende Turbopack-Warnung |
| `npm run lint` | 0 Fehler, 1 vorbestehende Warnung |

---

## Zielarchitektur

### A. Einmalige Initialisierung — `db.initialize_database()`

```python
def initialize_database() -> None:
    ensure_runtime_directories()
    conn = create_connection()
    try:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
```

Idempotent (alle `CREATE TABLE`/`INDEX IF NOT EXISTS`, additive
Spaltenprüfungen in `_migrate`), schließt die Initialisierungs-Connection in
jedem Fall, verschluckt keine Exception.

### B. Connection-Factory — `db.create_connection()`

```python
def create_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DATABASE_PATH))
    conn.row_factory = sqlite3.Row
    _configure_connection(conn)   # AP3: WAL + busy_timeout, unverändert
    return conn
```

Öffnet ausschließlich eine konfigurierte Verbindung - kein Schema, keine
Migration, keine Verzeichnis-Erstellung, kein impliziter Commit.

### C. Request-Dependency — `db.get_db_connection()`

```python
def get_db_connection():
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()
```

Generator-Dependency für FastAPI (`Depends(db.get_db_connection)`): genau eine
Verbindung pro Request, wird auch bei einer Exception im Endpunkt zuverlässig
geschlossen (das `finally` läuft, bevor FastAPI die Exception weiterreicht).

### D. FastAPI-Lifespan (`backend/api.py`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    db.initialize_database()
    yield

app = FastAPI(title="Planner-Agent API", lifespan=lifespan)
```

Führt die Initialisierung genau einmal pro App-Prozess aus. Ein Fehler in
`initialize_database()` wird nicht abgefangen - der App-Start schlägt dann
sichtbar fehl, statt eine scheinbar laufende App ohne nutzbare Datenbank zu
hinterlassen. Middleware (CORS) und alle bestehenden Routen bleiben
unverändert; es gab zuvor keinen Lifespan, der hätte integriert werden
müssen.

### E. Kompatibler Zugriffspunkt — `db.get_conn()`

```python
def get_conn() -> sqlite3.Connection:
    return create_connection()
```

Bleibt für nicht request-gebundene Aufrufer (Tests, CLI-/Offline-Skripte)
erhalten, führt aber selbst **kein** Schema/Migration mehr aus. Diese
Aufrufer müssen `initialize_database()` selbst - einmalig, explizit - vor der
ersten Nutzung aufrufen.

### Behandlung von Tests und Offline-Aufrufern

- Tests, deren Fixtures bisher implizit von der Schema-Erzeugung in
  `get_conn()` profitierten, rufen jetzt vor der ersten Nutzung explizit
  `db.initialize_database()` auf (6 Dateien, siehe unten).
- `test_plan_save.py` ruft den Endpunkt nicht mehr als reine Python-Funktion
  auf (das würde `Depends(...)` nur das Dependency-Objekt selbst liefern,
  keine echte Connection), sondern über den echten FastAPI-`TestClient`
  (`with TestClient(api.app) as client: ...`) - dadurch läuft auch der
  Lifespan real mit.
- `backend/run_local.py` bleibt unverändert in seiner Logik: seine eigene
  Vorprüfung (`check_database()`) öffnet weiterhin eine rohe, kurzlebige
  `sqlite3.connect()`-Verbindung nur für `PRAGMA integrity_check` und schließt
  sie sofort - unabhängig von `db.get_conn()`/`initialize_database()`. Nur der
  zugehörige Docstring-Kommentar wurde korrigiert (er beschrieb noch das alte
  „`get_conn()` legt beim ersten Zugriff das Schema an"-Verhalten).
- Keine globale automatische Initialisierung beim Modulimport - das Schema
  entsteht ausschließlich durch einen expliziten `initialize_database()`-Aufruf
  (Lifespan oder Test-Fixture).

### Sonderfälle (bewusst nicht verändert)

`health()` und `system_diagnostics()` in `api.py` öffnen weiterhin ihre eigene
rohe `sqlite3.connect()`-Verbindung statt der neuen Dependency zu nutzen. Beide
Endpunkte müssen laut ihrem eigenen Zweck auch dann sinnvoll antworten, wenn
die Datenbankdatei noch gar nicht existiert oder das Schema fehlt (Diagnose
für den „System"-Bereich der Anwendung) - eine Umstellung auf
`Depends(db.get_db_connection)` (das `create_connection()` nutzt, was bei
fehlender Datei/fehlendem Verzeichnis fehlschlägt) würde diesen Zweck
zunichtemachen. Beide schlossen ihre Verbindung bereits vor AP4 zuverlässig
(`conn.close()` vorhanden) - kein Leak, keine Änderung nötig oder
vorgenommen.

---

## Nachher

### Geänderte Aufrufer

Alle 47 API-Endpunkte in `backend/api.py`, die zuvor `conn = get_conn()`
(direkt oder über den lokalen `api.get_conn()`-Wrapper) aufriefen, erhalten
jetzt `conn: sqlite3.Connection = Depends(db.get_db_connection)` als
Parameter. Der lokale, dadurch überflüssig gewordene Wrapper `def get_conn():
return db.get_conn()` in `api.py` wurde entfernt (einzige verbleibende
Referenz war `test_plan_save.py`, das ebenfalls angepasst wurde).

### Initialisierungszeitpunkt

Einmal pro App-Prozess, ausgelöst durch den FastAPI-Lifespan beim Start
(`uvicorn`-Start über `python -m backend.run_local`, direkter
`uvicorn.run("backend.api:app", ...)`, oder `with TestClient(app) as
client:`). Bei einer nicht kontextmanager-basierten `TestClient(app)`-Nutzung
(so wie im bestehenden, unveränderten `test_api.py`) läuft der Lifespan nicht
- das ist unkritisch, weil `test_api.py` laut eigenem Docstring bewusst gegen
die bereits vollständig migrierte echte Datenbank läuft.

### Connection-Schließung

- **Request-Connections**: über `Depends(db.get_db_connection)` - Erfolg UND
  Exception beide durch Spy-Test bewiesen (`test_connection_lifecycle.py`),
  zusätzlich end-to-end über echten `uvicorn`-Serverlauf verifiziert (siehe
  Abschlussbericht, Abschnitt 4).
- **Initialisierungs-Connection**: `initialize_database()`s eigenes
  `try/finally` - ebenfalls durch denselben Spy-Test mitbewiesen (die erste
  Spy-Instanz stammt aus dem Lifespan-Aufruf).
- **Nicht request-gebundene Aufrufer** (Tests): weiterhin manuelles
  `conn.close()` im jeweiligen Test - unverändertes Muster.

### Nachweis: Schema/Migration laufen nicht pro Request

`backend/tests/test_connection_lifecycle.py::test_initialize_database_runs_only_once_across_multiple_requests`
patcht `db.initialize_database` mit einem Zähler und führt 5 aufeinander
folgende `GET /api/team`-Requests über den echten `TestClient`-Lifecycle aus:
Zählerstand nach allen 5 Requests = **1**. Ergänzend eine reine
Kontrollfluss-Messung (Ad-hoc-Skript, nicht Teil des Repos, siehe
Abschlussbericht Abschnitt „Messung"): 50 simulierte Requests unter dem alten
Design = 50× `executescript(SCHEMA)`/`_migrate()`/`ensure_runtime_directories()`;
unter dem neuen Design = 1× (bei der Initialisierung) + 0× pro Request.

### Testergebnisse (nach AP4)

`pytest`: **65 passed** (59 vorher + 6 neue AP4-Tests), identische 9
unabhängige Warnungen wie in AP1-3.

### Offene Sonderfälle

Siehe „Sonderfälle" oben (`health()`, `system_diagnostics()`) - bewusst
unverändert gelassen, dokumentiert statt spekulativ umgestellt.
