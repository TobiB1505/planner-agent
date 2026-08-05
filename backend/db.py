"""SQLite storage for extracted Dienstpläne."""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field

from .config.paths import DATABASE_PATH, ensure_runtime_directories

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    alias TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS week_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kw INTEGER,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    source_pdf TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL,
    category TEXT NOT NULL,
    subcategory TEXT,
    person_id INTEGER REFERENCES people(id),
    raw_text TEXT
);

CREATE TABLE IF NOT EXISTS absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL,
    person_id INTEGER REFERENCES people(id),
    typ TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS artist_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL,
    source_filename TEXT,
    sheet_name TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS artist_plan_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_plan_id INTEGER NOT NULL REFERENCES artist_plans(id),
    date TEXT NOT NULL,
    field_key TEXT NOT NULL,
    content TEXT,
    UNIQUE(artist_plan_id, date, field_key)
);

CREATE TABLE IF NOT EXISTS rehearsal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL,
    source_filename TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rehearsals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_plan_id INTEGER NOT NULL REFERENCES rehearsal_plans(id),
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    location TEXT,
    activity TEXT NOT NULL,
    show_code TEXT,
    participants_raw TEXT,
    choreographer_raw TEXT,
    end_inferred INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rehearsal_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_id INTEGER NOT NULL REFERENCES rehearsals(id),
    raw_name TEXT NOT NULL,
    person_name TEXT,
    role TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL
);

-- Tobis Korrekturen am MA-Gedächtnis. Bewusst getrennt von allen abgeleiteten Daten:
-- das Gedächtnis wird bei jedem Lesen neu gerechnet, nur diese Tabelle wird gespeichert.
-- Dadurch überlebt eine Korrektur auch das Neu-Aufbauen der Probenplan-Tabellen beim
-- Re-Import. Schlüssel ist person_id (nie ein Name), damit Umbenennen/Soft-Delete nichts
-- verliert.
CREATE TABLE IF NOT EXISTS person_memory_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    facet TEXT NOT NULL,        -- 'show' | 'free' | 'task'
    item_key TEXT NOT NULL,     -- show: Show-Code | free: 'weekdays' | task: normalisierte Kategorie
    state TEXT NOT NULL,        -- 'confirmed' | 'removed' | 'added' | 'pinned'
    value TEXT,                 -- JSON, nur für 'pinned' bzw. Zusatzinfos
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, facet, item_key)
);

-- Sprint 5: Manuell gepflegte, strukturierte Fähigkeiten. Automatisch erkannte
-- Vorschläge werden weiterhin reproduzierbar aus der Historie berechnet.
CREATE TABLE IF NOT EXISTS employee_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    skill_id TEXT NOT NULL,
    name TEXT NOT NULL,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    source TEXT NOT NULL DEFAULT 'manual',
    evidence_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, skill_id)
);

-- Freie, aber strukturierte Hinweise: kein Chat-Text, sondern Typ + Betreff +
-- Wert mit Quelle, Datum und Konfidenz. Historisch abgeleitete Einträge werden
-- nicht festgeschrieben, sondern bei jedem Lesen nachvollziehbar neu erzeugt.
CREATE TABLE IF NOT EXISTS employee_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0 CHECK(confidence BETWEEN 0 AND 1),
    source TEXT NOT NULL DEFAULT 'manual',
    source_date TEXT NOT NULL,
    editable INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, type, subject, source)
);

-- Materialisierter Cache. data_version ist ein Fingerabdruck der unveränderten
-- historischen Quelltabellen; bei jeder relevanten Änderung wird neu gerechnet.
CREATE TABLE IF NOT EXISTS employee_statistics (
    person_id INTEGER PRIMARY KEY REFERENCES people(id),
    data_version TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plan_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER REFERENCES week_plans(id),
    start_date TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT 'Planer',
    event_type TEXT NOT NULL,
    cause TEXT NOT NULL,
    cell_key TEXT,
    previous_value TEXT,
    new_value TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recommendation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER REFERENCES week_plans(id),
    start_date TEXT NOT NULL,
    date TEXT,
    category TEXT,
    subcategory TEXT,
    person_id INTEGER REFERENCES people(id),
    score REAL,
    reasons_json TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_assignments_person_date
    ON assignments(person_id, date);
CREATE INDEX IF NOT EXISTS idx_absences_person_date
    ON absences(person_id, date);
CREATE INDEX IF NOT EXISTS idx_audit_week_created
    ON plan_audit_log(week_plan_id, created_at DESC);

-- AP3 (SQLite-Fundament): rein additive Indizes für Lookups, die laut
-- EXPLAIN QUERY PLAN bislang einen vollen SCAN statt einer gezielten SEARCH
-- ausgelöst haben. Kein Tabellen-/Spaltenschema geändert, keine bestehenden
-- Indizes entfernt oder umbenannt.
--
-- people_aliases.alias und people.name tragen zwar bereits UNIQUE-Indizes,
-- die sind aber case-sensitiv angelegt. find_person_by_alias() (siehe unten)
-- vergleicht mit COLLATE NOCASE, wofür SQLite den case-sensitiven Index nicht
-- als SEARCH nutzen kann (bestätigt per EXPLAIN QUERY PLAN: SCAN statt
-- SEARCH). Ein zusätzlicher, auf COLLATE NOCASE angelegter Index behebt das,
-- ohne die case-sensitive UNIQUE-Prüfung anzutasten.
CREATE INDEX IF NOT EXISTS idx_people_aliases_alias_nocase
    ON people_aliases(alias COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_people_name_nocase
    ON people(name COLLATE NOCASE);

-- assignments/absences werden an mehreren Stellen ausschließlich nach
-- week_plan_id gefiltert (get_assignments_for_week, get_absences_for_week,
-- delete_week_plan, die Zähl-Subqueries in get_week_plans) - dafür existierte
-- bislang kein Index (nur der zusammengesetzte idx_*_person_date, dessen
-- führende Spalte person_id ist und für eine reine week_plan_id-Suche nicht
-- nutzbar ist).
CREATE INDEX IF NOT EXISTS idx_assignments_week_plan_id
    ON assignments(week_plan_id);
CREATE INDEX IF NOT EXISTS idx_absences_week_plan_id
    ON absences(week_plan_id);

-- rehearsals wird sowohl nach date (get_rehearsal_events, get_rehearsal_intervals
-- über einen JOIN) als auch nach rehearsal_plan_id (get_rehearsals, upsert/delete_
-- rehearsal_plan) gefiltert - beides bislang ohne Index.
CREATE INDEX IF NOT EXISTS idx_rehearsals_date
    ON rehearsals(date);
CREATE INDEX IF NOT EXISTS idx_rehearsals_rehearsal_plan_id
    ON rehearsals(rehearsal_plan_id);

-- rehearsal_people wird über rehearsal_id nachgeladen (get_rehearsals) bzw.
-- beim Neuaufbau eines Probenplans per IN (...) gelöscht (upsert_rehearsal_plan) -
-- bislang ohne Index auf rehearsal_id.
CREATE INDEX IF NOT EXISTS idx_rehearsal_people_rehearsal_id
    ON rehearsal_people(rehearsal_id);

-- plan_audit_log wird von intelligence/audit.list_events() auch rein nach
-- start_date gefiltert (wenn kein week_plan_id übergeben wird) - der
-- vorhandene Index idx_audit_week_created deckt das nicht ab, weil seine
-- führende Spalte week_plan_id ist.
CREATE INDEX IF NOT EXISTS idx_plan_audit_log_start_date
    ON plan_audit_log(start_date);

-- Bewusst NICHT angelegt: ein separater Index auf
-- artist_plan_entries(artist_plan_id). Der bestehende
-- UNIQUE(artist_plan_id, date, field_key) legt bereits einen Index an, dessen
-- führende Spalte artist_plan_id ist - EXPLAIN QUERY PLAN bestätigt dafür
-- bereits "SEARCH ... USING INDEX sqlite_autoindex_artist_plan_entries_1
-- (artist_plan_id=?)". Ein zusätzlicher Index wäre redundant.
"""


def _migrate(conn):
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(people)").fetchall()}
    if "department" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN department TEXT")
    if "active" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN active INTEGER NOT NULL DEFAULT 1")
    if "deleted" not in cols:
        conn.execute("ALTER TABLE people ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def _configure_connection(conn: sqlite3.Connection) -> None:
    """Setzt verbindungsseitige PRAGMAs für WAL-Parallelzugriff und kurzfristige Sperren
    (AP3 - SQLite-Fundament).

    journal_mode ist eine dateipersistente Eigenschaft der Datenbankdatei selbst (bleibt
    auch über Neustarts erhalten), busy_timeout dagegen gilt nur für diese eine Verbindung
    und muss deshalb bei jeder neu erzeugten Verbindung neu gesetzt werden (siehe
    create_connection() unten). Ist die Datei bereits im WAL-Modus, ist der PRAGMA-Aufruf
    ein günstiger No-Op.
    """
    row = conn.execute("PRAGMA journal_mode=WAL;").fetchone()
    resulting_mode = str(row[0]).lower() if row else ""
    if resulting_mode != "wal":
        # Kann z.B. bei :memory:-Datenbanken oder eingeschränkten Dateisystemen passieren
        # (WAL braucht eine echte Datei) - kein Abbruch, aber niemals stillschweigend als
        # Erfolg behandeln.
        logger.warning(
            "SQLite läuft nicht im WAL-Modus (aktueller journal_mode: %s) - "
            "paralleler Lese-/Schreibzugriff ist dadurch weniger robust.",
            resulting_mode or "unbekannt",
        )
    conn.execute("PRAGMA busy_timeout = 5000;")


def create_connection() -> sqlite3.Connection:
    """Öffnet ausschließlich eine neue, verbindungsseitig konfigurierte SQLite-Verbindung
    (AP4 - Verbindungs-/Schema-Lifecycle).

    Führt bewusst KEIN Schema, KEINE Migration und KEINE Runtime-Verzeichnis-Erstellung
    aus - dafür ist einmalig initialize_database() zuständig. Jeder Aufruf öffnet eine
    eigene, unabhängige Verbindung; kein Connection-Objekt wird zwischen Aufrufern geteilt.

    check_same_thread=False ist hier bewusst nötig, nicht optional: FastAPI wickelt die
    __enter__/__exit__-Seiten eines sync-Generator-Dependencies (Depends(get_db_connection)
    unten) über contextmanager_in_threadpool() ab, das __enter__ über den normalen
    Threadpool-Limiter und __exit__ über einen eigenen, unabhängigen CapacityLimiter(1)
    laufen lässt (siehe fastapi/dependencies/utils.py) - dieselbe Connection kann dadurch
    unter echter uvicorn-Nebenläufigkeit auf einem Thread erzeugt und auf einem anderen
    wieder geschlossen werden. Das passiert rein sequenziell innerhalb EINES Requests (nie
    gleichzeitig von zwei Threads), sqlite3 verbietet mit seinem Default
    check_same_thread=True aber bereits den bloßen Thread-Wechsel. Ohne dieses Flag schlägt
    jeder Request unter Last mit "SQLite objects created in a thread can only be used in
    that same thread" fehl (siehe backend/tests/test_uvicorn_real_concurrency.py und
    backend/tests/test_sqlite_thread_safety.py - zwei unabhängig entstandene, sich
    ergänzende Regressionstests: einer gegen einen echten uvicorn-Prozess, einer über
    TestClient mit echter Thread-Parallelität).
    """
    conn = sqlite3.connect(str(DATABASE_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _configure_connection(conn)
    return conn


def initialize_database() -> None:
    """Einmalige Initialisierung: Laufzeitverzeichnisse, Schema, Migration (AP4).

    Idempotent - kann beliebig oft aufgerufen werden (CREATE TABLE/INDEX IF NOT EXISTS,
    additive Spaltenprüfungen in _migrate()), ändert an einer bereits initialisierten
    Datenbank nichts mehr. Wird genau einmal beim FastAPI-Lifespan-Start ausgeführt
    (siehe api.py) sowie explizit von Tests/CLI-Aufrufern vor der ersten Nutzung. Ein
    Fehler beim Anlegen von Schema/Migration wird nicht verschluckt - die Initialisierungs-
    Connection wird in jedem Fall (auch bei einer Exception) wieder geschlossen.
    """
    ensure_runtime_directories()
    conn = create_connection()
    try:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()


def get_conn() -> sqlite3.Connection:
    """Kompatibler Zugriffspunkt für nicht request-gebundene Aufrufer (Tests, CLI-/
    Offline-Skripte): öffnet nur eine konfigurierte Verbindung, OHNE Schema oder Migration
    erneut auszuführen (AP4 - vorher lief das bei jedem Aufruf mit). Setzt voraus, dass
    zuvor einmal initialize_database() gelaufen ist (z.B. über den FastAPI-Lifespan-Start
    oder - für Tests/Skripte, die keinen App-Start durchlaufen - durch einen expliziten
    eigenen Aufruf von initialize_database()).
    """
    return create_connection()


def get_db_connection():
    """FastAPI-Dependency (AP4): genau eine Verbindung pro Request.

    Wird über Depends(get_db_connection) in die Endpunkte injiziert und nach Abschluss des
    Requests zuverlässig geschlossen - auch wenn der Endpunkt eine Exception wirft, da das
    schließende finally in jedem Fall durchlaufen wird, bevor FastAPI die Exception weiter
    nach oben reicht. Keine Verbindung wird zwischen Requests geteilt, kein globales
    Connection-Objekt.
    """
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()


def get_all_people(conn, active_only: bool = False):
    query = "SELECT * FROM people WHERE deleted = 0"
    if active_only:
        query += " AND active = 1"
    query += " ORDER BY name"
    return conn.execute(query).fetchall()


def update_person(conn, person_id: int, name: str, department: str | None, active: bool):
    conn.execute(
        "UPDATE people SET name = ?, department = ?, active = ? WHERE id = ?",
        (name, department, 1 if active else 0, person_id),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = ?", (person_id,))


def delete_person(conn, person_id: int):
    """Entfernt eine Person aus dem Mitarbeiterpool, behält sie aber für historische Pläne."""
    conn.execute(
        "UPDATE people SET active = 0, deleted = 1 WHERE id = ?",
        (person_id,),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = ?", (person_id,))


def find_person_by_alias(conn, alias: str):
    row = conn.execute(
        "SELECT person_id FROM people_aliases WHERE alias = ? COLLATE NOCASE", (alias,)
    ).fetchone()
    if row:
        return row["person_id"]
    row = conn.execute(
        "SELECT id FROM people WHERE name = ? COLLATE NOCASE", (alias,)
    ).fetchone()
    return row["id"] if row else None


# --- AP5a: gebündelte Alias-/Personenauflösung ---------------------------------
#
# find_person_by_alias() oben führt bis zu zwei Einzelqueries PRO AUFRUF aus. In
# Schleifen über viele Probenteilnehmer oder Zuweisungen (derive_show_cast,
# _assignment_warnings, plan_save) summiert sich das linear mit der Datenmenge.
# PersonLookup lädt Personen und Aliasse EINMAL pro fachlichem Vorgang und bietet
# denselben Auflösungsweg (erst Alias, dann Personenname) als reinen
# In-Memory-Lookup an.

# SQLites eingebaute NOCASE-Kollation faltet laut eigener Dokumentation bewusst
# NUR ASCII-Buchstaben (A-Z/a-z) - kein volles Unicode-Case-Folding. Python
# str.casefold()/str.lower() würden z.B. 'Ü' -> 'ü' oder 'ß' -> 'ss' faltet und
# damit Namen als gleich behandeln, die SQLite als unterschiedlich einstuft
# (verifiziert u.a. an echten Namen wie "René"). Diese Übersetzungstabelle
# repliziert exakt SQLites Verhalten, um die bestehende Auflösungssemantik nicht
# stillschweigend zu verändern.
_ASCII_UPPER_TO_LOWER = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)


def _nocase_fold(value: str) -> str:
    """Bildet SQLites `COLLATE NOCASE` nach (nur ASCII wird gefaltet)."""
    return value.translate(_ASCII_UPPER_TO_LOWER)


@dataclass(frozen=True)
class PersonLookupEntry:
    person_id: int
    name: str
    department: str | None


@dataclass
class PersonLookup:
    """Einmal pro Vorgang geladene Alias-/Namensauflösung.

    by_alias/by_name sind nach _nocase_fold() geschlüsselt - dieselbe Semantik
    wie `alias = ? COLLATE NOCASE` bzw. `name = ? COLLATE NOCASE`. Enthält
    bewusst auch soft-gelöschte Personen (deleted=1) und deren Aliasse, weil
    find_person_by_alias() ebenfalls nicht danach filtert; eine Filterung hier
    würde eine bestehende Auflösung stillschweigend verändern.
    """

    by_alias: dict[str, PersonLookupEntry] = field(default_factory=dict)
    by_name: dict[str, PersonLookupEntry] = field(default_factory=dict)

    def resolve(self, value: str) -> PersonLookupEntry | None:
        """Repliziert find_person_by_alias(): erst Alias-Tabelle, dann Personenname."""
        folded = _nocase_fold(value)
        return self.by_alias.get(folded) or self.by_name.get(folded)

    def register_person(self, person_id: int, name: str, department: str | None = None) -> None:
        """Nach einer echten Neuanlage (create_person) sofort in die Map übernehmen,
        damit spätere Zeilen desselben Vorgangs sie ohne erneute Datenbankabfrage
        finden (siehe api._resolve_or_create)."""
        self.by_name[_nocase_fold(name)] = PersonLookupEntry(person_id, name, department)

    def register_alias(self, alias: str, person_id: int, name: str, department: str | None = None) -> None:
        """Nach einer echten Alias-Neuanlage (add_alias) sofort in die Map übernehmen."""
        self.by_alias[_nocase_fold(alias)] = PersonLookupEntry(person_id, name, department)


def load_person_lookup(conn: sqlite3.Connection) -> PersonLookup:
    """Lädt Personen und Aliasse mit zwei Queries in eine PersonLookup-Struktur.

    Öffnet keine eigene Verbindung, committet nicht, legt kein Schema an und
    schreibt nichts - reiner Lesevorgang auf der übergebenen Connection.
    Absichtlich OHNE "WHERE deleted = 0"-Filter (siehe PersonLookup-Docstring).
    ORDER BY id sorgt für ein deterministisches Ergebnis, falls zwei aktive
    Namen/Aliasse zufällig auf denselben NOCASE-Schlüssel fallen (in der Praxis
    bislang nicht beobachtet).
    """
    by_name: dict[str, PersonLookupEntry] = {}
    for row in conn.execute("SELECT id, name, department FROM people ORDER BY id"):
        by_name[_nocase_fold(row["name"])] = PersonLookupEntry(
            person_id=row["id"], name=row["name"], department=row["department"],
        )

    by_alias: dict[str, PersonLookupEntry] = {}
    for row in conn.execute(
        """SELECT pa.id AS alias_id, pa.alias, p.id AS person_id, p.name, p.department
           FROM people_aliases pa
           JOIN people p ON p.id = pa.person_id
           ORDER BY pa.id"""
    ):
        by_alias[_nocase_fold(row["alias"])] = PersonLookupEntry(
            person_id=row["person_id"], name=row["name"], department=row["department"],
        )

    return PersonLookup(by_alias=by_alias, by_name=by_name)


def create_person(conn, name: str, department: str | None = None) -> int:
    existing = conn.execute(
        "SELECT id, deleted FROM people WHERE name = ? COLLATE NOCASE",
        (name,),
    ).fetchone()
    if existing and existing["deleted"]:
        conn.execute(
            "UPDATE people SET department = ?, active = 1, deleted = 0 WHERE id = ?",
            (department, existing["id"]),
        )
        conn.execute(
            "DELETE FROM employee_statistics WHERE person_id = ?",
            (existing["id"],),
        )
        return existing["id"]
    cur = conn.execute(
        "INSERT INTO people (name, department, active, deleted) VALUES (?, ?, 1, 0)",
        (name, department),
    )
    return cur.lastrowid


def add_alias(conn, person_id: int, alias: str):
    conn.execute(
        "INSERT OR IGNORE INTO people_aliases (person_id, alias) VALUES (?, ?)",
        (person_id, alias),
    )


def insert_week_plan(conn, kw, start_date, end_date, source_pdf) -> int:
    cur = conn.execute(
        "INSERT INTO week_plans (kw, start_date, end_date, source_pdf) VALUES (?, ?, ?, ?)",
        (kw, start_date, end_date, source_pdf),
    )
    return cur.lastrowid


def insert_assignment(conn, week_plan_id, date, category, subcategory, person_id, raw_text):
    conn.execute(
        """INSERT INTO assignments (week_plan_id, date, category, subcategory, person_id, raw_text)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (week_plan_id, date, category, subcategory, person_id, raw_text),
    )


def insert_absence(conn, week_plan_id, date, person_id, typ):
    conn.execute(
        "INSERT INTO absences (week_plan_id, date, person_id, typ) VALUES (?, ?, ?, ?)",
        (week_plan_id, date, person_id, typ),
    )


def get_week_plans(conn):
    return conn.execute(
        """SELECT wp.*,
                  (SELECT COUNT(*) FROM assignments a
                   WHERE a.week_plan_id = wp.id) AS assignment_count,
                  (SELECT COUNT(*) FROM absences ab
                   WHERE ab.week_plan_id = wp.id) AS absence_count
           FROM week_plans wp
           ORDER BY wp.start_date DESC, wp.id DESC"""
    ).fetchall()


def get_assignments_for_week(conn, week_plan_id):
    return conn.execute(
        """SELECT a.date, a.category, a.subcategory, p.name AS person, a.raw_text
           FROM assignments a LEFT JOIN people p ON a.person_id = p.id
           WHERE a.week_plan_id = ? ORDER BY a.date, a.category""",
        (week_plan_id,),
    ).fetchall()


def get_absences_for_week(conn, week_plan_id):
    return conn.execute(
        """SELECT ab.date, p.name AS person, ab.typ
           FROM absences ab LEFT JOIN people p ON ab.person_id = p.id
           WHERE ab.week_plan_id = ? ORDER BY ab.date""",
        (week_plan_id,),
    ).fetchall()


def delete_week_plan(conn, week_plan_id):
    conn.execute("DELETE FROM assignments WHERE week_plan_id = ?", (week_plan_id,))
    conn.execute("DELETE FROM absences WHERE week_plan_id = ?", (week_plan_id,))
    conn.execute("DELETE FROM week_plans WHERE id = ?", (week_plan_id,))


def get_setting(conn, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def get_memory_overrides(conn, person_id: int | None = None):
    if person_id is None:
        return conn.execute(
            "SELECT * FROM person_memory_overrides ORDER BY person_id, facet, item_key"
        ).fetchall()
    return conn.execute(
        "SELECT * FROM person_memory_overrides WHERE person_id = ? ORDER BY facet, item_key",
        (person_id,),
    ).fetchall()


def set_memory_override(
    conn,
    person_id: int,
    facet: str,
    item_key: str,
    state: str,
    value: str | None = None,
    note: str | None = None,
):
    conn.execute(
        """INSERT INTO person_memory_overrides (person_id, facet, item_key, state, value, note)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(person_id, facet, item_key) DO UPDATE SET
               state = excluded.state,
               value = excluded.value,
               note = excluded.note,
               updated_at = CURRENT_TIMESTAMP""",
        (person_id, facet, item_key, state, value, note),
    )


def clear_memory_override(conn, person_id: int, facet: str, item_key: str):
    conn.execute(
        "DELETE FROM person_memory_overrides WHERE person_id = ? AND facet = ? AND item_key = ?",
        (person_id, facet, item_key),
    )


def clear_memory_overrides_for_person(conn, person_id: int, facet: str | None = None):
    if facet is None:
        conn.execute("DELETE FROM person_memory_overrides WHERE person_id = ?", (person_id,))
    else:
        conn.execute(
            "DELETE FROM person_memory_overrides WHERE person_id = ? AND facet = ?",
            (person_id, facet),
        )
    conn.commit()


def upsert_artist_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    sheet_name: str | None,
    entries: list[dict],
) -> int:
    conn.execute(
        """INSERT INTO artist_plans
               (start_date, end_date, source_filename, sheet_name)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               sheet_name = excluded.sheet_name,
               updated_at = CURRENT_TIMESTAMP""",
        (start_date, end_date, source_filename, sheet_name),
    )
    row = conn.execute(
        "SELECT id FROM artist_plans WHERE start_date = ?", (start_date,)
    ).fetchone()
    artist_plan_id = row["id"]
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = ?",
        (artist_plan_id,),
    )
    conn.executemany(
        """INSERT INTO artist_plan_entries
               (artist_plan_id, date, field_key, content)
           VALUES (?, ?, ?, ?)""",
        [
            (
                artist_plan_id,
                entry["date"],
                entry["field_key"],
                entry.get("content") or "",
            )
            for entry in entries
        ],
    )
    return artist_plan_id


def get_artist_plans(conn):
    return conn.execute(
        """SELECT ap.*,
                  COUNT(CASE WHEN TRIM(COALESCE(e.content, '')) <> '' THEN 1 END) AS filled_entries
           FROM artist_plans ap
           LEFT JOIN artist_plan_entries e ON e.artist_plan_id = ap.id
           GROUP BY ap.id
           ORDER BY ap.start_date DESC"""
    ).fetchall()


def get_artist_plan(conn, artist_plan_id: int):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE id = ?", (artist_plan_id,)
    ).fetchone()


def get_artist_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE start_date = ?", (start_date,)
    ).fetchone()


def get_artist_plan_entries(conn, artist_plan_id: int):
    return conn.execute(
        """SELECT date, field_key, content
           FROM artist_plan_entries
           WHERE artist_plan_id = ?
           ORDER BY date, field_key""",
        (artist_plan_id,),
    ).fetchall()


def delete_artist_plan(conn, artist_plan_id: int):
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = ?",
        (artist_plan_id,),
    )
    conn.execute("DELETE FROM artist_plans WHERE id = ?", (artist_plan_id,))


def upsert_rehearsal_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    rehearsals: list[dict],
) -> int:
    conn.execute(
        """INSERT INTO rehearsal_plans (start_date, end_date, source_filename)
           VALUES (?, ?, ?)
           ON CONFLICT(start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               updated_at = CURRENT_TIMESTAMP""",
        (start_date, end_date, source_filename),
    )
    plan_row = conn.execute(
        "SELECT id FROM rehearsal_plans WHERE start_date = ?", (start_date,)
    ).fetchone()
    plan_id = plan_row["id"]
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = ?", (plan_id,)
        ).fetchall()
    ]
    if rehearsal_ids:
        placeholders = ",".join("?" for _ in rehearsal_ids)
        conn.execute(
            f"DELETE FROM rehearsal_people WHERE rehearsal_id IN ({placeholders})",
            rehearsal_ids,
        )
    conn.execute("DELETE FROM rehearsals WHERE rehearsal_plan_id = ?", (plan_id,))

    for rehearsal in rehearsals:
        cursor = conn.execute(
            """INSERT INTO rehearsals
                   (rehearsal_plan_id, date, start_time, end_time, location, activity,
                    show_code, participants_raw, choreographer_raw, end_inferred)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                plan_id,
                rehearsal["date"],
                rehearsal["start_time"],
                rehearsal["end_time"],
                rehearsal.get("location"),
                rehearsal["activity"],
                rehearsal.get("show_code"),
                rehearsal.get("participants_raw"),
                rehearsal.get("choreographer_raw"),
                1 if rehearsal.get("end_inferred") else 0,
            ),
        )
        rehearsal_id = cursor.lastrowid
        conn.executemany(
            """INSERT INTO rehearsal_people
                   (rehearsal_id, raw_name, person_name, role, start_time, end_time)
               VALUES (?, ?, ?, ?, ?, ?)""",
            [
                (
                    rehearsal_id,
                    person["raw_name"],
                    person.get("person_name"),
                    person["role"],
                    person["start_time"],
                    person["end_time"],
                )
                for person in rehearsal.get("people", [])
            ],
        )
    return plan_id


def get_rehearsal_plans(conn):
    return conn.execute(
        """SELECT rp.*, COUNT(r.id) AS rehearsal_count
           FROM rehearsal_plans rp
           LEFT JOIN rehearsals r ON r.rehearsal_plan_id = rp.id
           GROUP BY rp.id
           ORDER BY rp.start_date DESC"""
    ).fetchall()


def get_rehearsal_plan(conn, rehearsal_plan_id: int):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE id = ?", (rehearsal_plan_id,)
    ).fetchone()


def get_rehearsal_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE start_date = ?", (start_date,)
    ).fetchone()


def get_rehearsals(conn, rehearsal_plan_id: int):
    rows = conn.execute(
        """SELECT * FROM rehearsals
           WHERE rehearsal_plan_id = ?
           ORDER BY date, start_time, id""",
        (rehearsal_plan_id,),
    ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["end_inferred"] = bool(item["end_inferred"])
        item["people"] = [
            dict(person)
            for person in conn.execute(
                """SELECT raw_name, person_name, role, start_time, end_time
                   FROM rehearsal_people
                   WHERE rehearsal_id = ?
                   ORDER BY role, id""",
                (row["id"],),
            ).fetchall()
        ]
        result.append(item)
    return result


def get_rehearsal_intervals(conn, start_date: str, end_date: str):
    return conn.execute(
        """SELECT p.person_name, r.date, p.start_time, p.end_time,
                  p.role, r.activity, r.show_code
           FROM rehearsal_people p
           JOIN rehearsals r ON r.id = p.rehearsal_id
           WHERE p.person_name IS NOT NULL
             AND r.date BETWEEN ? AND ?
           ORDER BY r.date, p.start_time, p.person_name""",
        (start_date, end_date),
    ).fetchall()


def get_rehearsal_events(conn, start_date: str, end_date: str):
    return conn.execute(
        """SELECT date, start_time, end_time, activity, show_code
           FROM rehearsals
           WHERE date BETWEEN ? AND ?
           ORDER BY date, start_time, id""",
        (start_date, end_date),
    ).fetchall()


def delete_rehearsal_plan(conn, rehearsal_plan_id: int):
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = ?",
            (rehearsal_plan_id,),
        ).fetchall()
    ]
    if rehearsal_ids:
        placeholders = ",".join("?" for _ in rehearsal_ids)
        conn.execute(
            f"DELETE FROM rehearsal_people WHERE rehearsal_id IN ({placeholders})",
            rehearsal_ids,
        )
    conn.execute(
        "DELETE FROM rehearsals WHERE rehearsal_plan_id = ?",
        (rehearsal_plan_id,),
    )
    conn.execute(
        "DELETE FROM rehearsal_plans WHERE id = ?",
        (rehearsal_plan_id,),
    )
