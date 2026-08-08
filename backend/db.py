"""PostgreSQL-Persistenz für Dienstpläne (vormals SQLite).

Die öffentliche Funktions-API dieses Moduls ist gegenüber der SQLite-Version
unverändert: `get_person`-artige Helfer nehmen weiterhin eine Connection als
erstes Argument, geben dictionary-artige Zeilen zurück und committen NICHT
selbst (AP10 - die fachliche Operation/Route besitzt die Transaktion). Geändert
hat sich ausschließlich, was unter dieser API liegt.

Verbindungsaufbau
-----------------
Ausschließlich über die Umgebungsvariable DATABASE_URL. Es gibt keinen Pfad,
keine Datei und keine Zugangsdaten im Sourcecode. Beispielform (nur Doku):

    postgresql://USER:PASSWORD@HOST:PORT/DATABASE

Connection Pool
---------------
Render betreibt einen langlebigen FastAPI-Prozess, Supabase hat harte
Verbindungslimits. Deshalb: genau EIN prozessweiter Pool mit kleiner, fester
Obergrenze - keine Verbindung pro Query, keine global offene Einzelverbindung.
Jeder Request leiht sich eine Verbindung und gibt sie zurück (siehe
get_db_connection()).

Transaktionen
-------------
psycopg arbeitet - wie sqlite3 zuvor - ohne Autocommit: die erste Anweisung
öffnet implizit eine Transaktion. Ein Request, der ohne commit() endet (z.B.
weil der Endpunkt eine Exception geworfen hat), wird beim Zurückgeben der
Verbindung in den Pool vollständig zurückgerollt. Das ist exakt die
AP10-Garantie "alles oder nichts", die vorher SQLite geliefert hat.

Zeilen
------
Zeilen sind `Row`-Objekte: ein dict mit zusätzlichem Positionszugriff. Damit
funktionieren `row["name"]`, `row[0]`, `dict(row)` und `row.keys()` weiterhin
wie bei sqlite3.Row - die ~27 `dict(row)`-Stellen im Fachcode bleiben unberührt.
"""
from __future__ import annotations

import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Any, Iterator, Sequence

import psycopg
from psycopg import sql as pgsql
from psycopg_pool import ConnectionPool

from .migrations import apply_migrations, current_version

logger = logging.getLogger(__name__)

DEFAULT_POOL_MIN_SIZE = 1
DEFAULT_POOL_MAX_SIZE = 5
DEFAULT_POOL_TIMEOUT = 10.0


class DatabaseNotConfigured(RuntimeError):
    """DATABASE_URL fehlt - das Backend hat keine Datenbank, gegen die es läuft."""


# ---------------------------------------------------------------------------
# Zeilen
# ---------------------------------------------------------------------------


class Row(dict):
    """Ergebniszeile mit dict- UND Positionszugriff (Ersatz für sqlite3.Row).

    `row["name"]` ist der im Fachcode überall verwendete Zugriff. `row[0]` und
    `dict(row)` funktionieren zusätzlich, damit kein Aufrufer nur wegen eines
    anderen Zeilentyps angefasst werden muss (Sprint-Punkt 16).
    """

    __slots__ = ()

    def __getitem__(self, key):
        if isinstance(key, int):
            try:
                return list(self.values())[key]
            except IndexError as exc:  # pragma: no cover - Programmierfehler
                raise IndexError(f"Spaltenindex {key} liegt außerhalb der Zeile") from exc
        return super().__getitem__(key)


def _row_factory(cursor):
    """psycopg-Row-Factory, die `Row`-Objekte erzeugt."""
    description = cursor.description
    if description is None:
        return lambda values: values
    columns = [column.name for column in description]

    def make_row(values: Sequence[Any]) -> Row:
        return Row(zip(columns, values))

    return make_row


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------


class Connection:
    """Verbindungshandle mit der von den Aufrufern erwarteten Oberfläche.

    Stellt genau die Methoden bereit, die der bestehende Code auf der früheren
    sqlite3.Connection benutzt hat: execute(), executemany(), commit(),
    rollback(), close() - plus Delegation für alles Übrige. `close()` schließt
    die Verbindung nicht wirklich, sondern gibt sie an den Pool zurück; eine
    offene, nicht committete Transaktion wird dabei zurückgerollt.

    Bewusst ohne __slots__: Tests hängen `execute` zeitweise um, um SQL-
    Statements zu zählen (siehe backend/tests/test_person_lookup.py) - das
    ersetzt SQLites `set_trace_callback()`, für das psycopg kein Gegenstück hat.
    """

    def __init__(self, conn: psycopg.Connection, pool: ConnectionPool | None) -> None:
        self._conn = conn
        self._pool = pool
        self._released = False

    # -- Abfragen ----------------------------------------------------------

    def execute(self, query, params: Sequence[Any] | None = None):
        cursor = self._conn.cursor()
        cursor.execute(query, tuple(params) if params else None)
        return cursor

    def executemany(self, query, params_seq):
        rows = list(params_seq)
        cursor = self._conn.cursor()
        if rows:
            cursor.executemany(query, [tuple(row) for row in rows])
        return cursor

    def cursor(self, *args, **kwargs):
        return self._conn.cursor(*args, **kwargs)

    # -- Transaktionen -----------------------------------------------------

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    # -- Lebenszyklus ------------------------------------------------------

    def close(self) -> None:
        """Gibt die Verbindung zurück (idempotent).

        Nicht committete Änderungen gehen dabei verloren - genau das erwarten
        die AP10-Transaktionstests: ein Request, der mit einer Exception endet,
        darf nichts Halbfertiges hinterlassen.
        """
        if self._released:
            return
        self._released = True
        if self._pool is None:
            self._conn.close()
            return
        try:
            if not self._conn.closed:
                self._conn.rollback()
        except psycopg.Error:  # pragma: no cover - Verbindung bereits kaputt
            pass
        self._pool.putconn(self._conn)

    @property
    def closed(self) -> bool:
        return self._released or self._conn.closed

    # -- Rest --------------------------------------------------------------

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def __enter__(self) -> "Connection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


# ---------------------------------------------------------------------------
# Pool
# ---------------------------------------------------------------------------

_pool: ConnectionPool | None = None
_pool_dsn: str | None = None
_pool_lock = threading.Lock()


def database_url() -> str:
    """Die konfigurierte DATABASE_URL - oder ein klarer Abbruch.

    Bewusst kein Default und kein stiller Fallback: eine Anwendung, die nicht
    weiß, gegen welche Datenbank sie läuft, soll sichtbar nicht starten.
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseNotConfigured(
            "DATABASE_URL ist nicht gesetzt. Das Backend braucht eine "
            "PostgreSQL-Verbindung (Format: postgresql://USER:PASSWORD@HOST:PORT/DATABASE). "
            "Lokal in .env eintragen, in Preview/Production als Environment Variable "
            "der Hosting-Plattform - siehe docs/database/SUPABASE_SETUP.md."
        )
    return url


def _pool_size() -> tuple[int, int]:
    def _int(name: str, default: int) -> int:
        raw = os.getenv(name)
        if not raw:
            return default
        try:
            return max(0, int(raw))
        except ValueError:
            logger.warning("%s ist keine Zahl ('%s') - nutze Default %d", name, raw, default)
            return default

    max_size = max(1, _int("DATABASE_POOL_MAX_SIZE", DEFAULT_POOL_MAX_SIZE))
    min_size = min(max_size, _int("DATABASE_POOL_MIN_SIZE", DEFAULT_POOL_MIN_SIZE))
    return min_size, max_size


def get_pool() -> ConnectionPool:
    """Der prozessweite Connection Pool (wird beim ersten Zugriff erzeugt)."""
    global _pool, _pool_dsn
    dsn = database_url()
    with _pool_lock:
        if _pool is not None and _pool_dsn == dsn and not _pool.closed:
            return _pool
        if _pool is not None:
            _close_pool_locked()
        min_size, max_size = _pool_size()
        _pool = ConnectionPool(
            conninfo=dsn,
            min_size=min_size,
            max_size=max_size,
            timeout=DEFAULT_POOL_TIMEOUT,
            kwargs={"row_factory": _row_factory, "autocommit": False},
            open=True,
            name="planner",
        )
        _pool_dsn = dsn
        return _pool


def _close_pool_locked() -> None:
    global _pool, _pool_dsn
    if _pool is not None:
        try:
            _pool.close()
        except Exception:  # noqa: BLE001 - beim Herunterfahren nie eskalieren
            logger.exception("Connection Pool konnte nicht sauber geschlossen werden")
    _pool = None
    _pool_dsn = None


def close_pool() -> None:
    """Schließt den Pool (App-Shutdown, Testwechsel auf ein anderes Schema)."""
    with _pool_lock:
        _close_pool_locked()


def create_connection() -> Connection:
    """Leiht genau eine konfigurierte Verbindung aus dem Pool.

    Führt bewusst KEIN Schema und KEINE Migration aus - dafür ist einmalig
    initialize_database() zuständig (AP4-Lifecycle, unverändert übernommen).
    Kein Connection-Objekt wird zwischen Aufrufern geteilt.
    """
    pool = get_pool()
    return Connection(pool.getconn(), pool)


def connect_direct(dsn: str | None = None) -> Connection:
    """Eine einzelne Verbindung außerhalb des Pools (Migrationen, CLI-Skripte).

    Bewusst getrennt vom Pool: Migrations- und Wartungsläufe sollen keinen
    Request-Pool-Slot belegen und laufen auch, wenn der Pool (noch) nicht steht.
    """
    conn = psycopg.connect(dsn or database_url(), row_factory=_row_factory)
    return Connection(conn, None)


def initialize_database() -> None:
    """Einmalige Initialisierung: wendet offene Schemamigrationen an (AP4).

    Idempotent - bereits angewendete Migrationen werden übersprungen. Wird genau
    einmal beim FastAPI-Lifespan-Start ausgeführt (siehe api.py) sowie explizit
    von Tests/CLI-Aufrufern vor der ersten Nutzung. Ein Fehler wird nicht
    verschluckt: eine nur halb migrierte Datenbank soll den App-Start sichtbar
    verhindern, statt still weiterzulaufen.
    """
    conn = connect_direct()
    try:
        applied = apply_migrations(conn)
        if applied:
            logger.info("Schemamigrationen angewendet: %s", ", ".join(applied))
    finally:
        conn.close()


def schema_version() -> str | None:
    """Aktuell angewendete Schemaversion (für Health/Diagnostics)."""
    conn = create_connection()
    try:
        return current_version(conn)
    finally:
        conn.close()


def get_conn() -> Connection:
    """Kompatibler Zugriffspunkt für nicht request-gebundene Aufrufer (Tests,
    CLI-/Offline-Skripte): leiht nur eine Verbindung, OHNE Schema oder Migration
    erneut auszuführen. Setzt voraus, dass zuvor einmal initialize_database()
    gelaufen ist.
    """
    return create_connection()


def get_db_connection() -> Iterator[Connection]:
    """FastAPI-Dependency (AP4): genau eine Verbindung pro Request.

    Wird über Depends(get_db_connection) in die Endpunkte injiziert und am Ende
    des Requests zuverlässig an den Pool zurückgegeben - auch wenn der Endpunkt
    eine Exception wirft, da das finally in jedem Fall durchläuft. Eine offene,
    nicht committete Transaktion wird dabei zurückgerollt (AP10).
    """
    conn = create_connection()
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Personen
# ---------------------------------------------------------------------------


def get_all_people(conn, active_only: bool = False):
    query = "SELECT * FROM people WHERE deleted = 0"
    if active_only:
        query += " AND active = 1"
    query += " ORDER BY name"
    return conn.execute(query).fetchall()


def update_person(conn, person_id: int, name: str, department: str | None, active: bool):
    conn.execute(
        "UPDATE people SET name = %s, department = %s, active = %s WHERE id = %s",
        (name, department, 1 if active else 0, person_id),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = %s", (person_id,))


def delete_person(conn, person_id: int):
    """Entfernt eine Person aus dem Mitarbeiterpool, behält sie aber für historische Pläne."""
    conn.execute(
        "UPDATE people SET active = 0, deleted = 1 WHERE id = %s",
        (person_id,),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = %s", (person_id,))


def find_person_by_alias(conn, alias: str):
    """Alias- bzw. Namensauflösung, case-insensitiv wie bisher.

    `planner_nocase()` (siehe backend/migrations/001_initial_postgres.sql) bildet
    SQLites COLLATE NOCASE exakt nach - nur ASCII A-Z wird gefaltet. Ein naives
    lower() würde auch 'É' -> 'é' falten und damit Namen zusammenführen, die die
    bisherige Implementierung getrennt gehalten hat.
    """
    row = conn.execute(
        "SELECT person_id FROM people_aliases "
        "WHERE planner_nocase(alias) = planner_nocase(%s)",
        (alias,),
    ).fetchone()
    if row:
        return row["person_id"]
    row = conn.execute(
        "SELECT id FROM people WHERE planner_nocase(name) = planner_nocase(%s)",
        (alias,),
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

# Diese Übersetzungstabelle ist die Python-Seite derselben Faltung, die
# planner_nocase() in SQL macht (ASCII-only, exakt wie SQLites NOCASE). Python
# str.casefold()/str.lower() würden z.B. 'Ü' -> 'ü' oder 'ß' -> 'ss' falten und
# damit Namen als gleich behandeln, die die Datenbankseite als unterschiedlich
# einstuft (verifiziert u.a. an echten Namen wie "René"). Beide Wege müssen
# deckungsgleich bleiben - siehe backend/tests/test_person_lookup.py.
_ASCII_UPPER_TO_LOWER = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)


def _nocase_fold(value: str) -> str:
    """Python-Pendant zu `planner_nocase()` (nur ASCII wird gefaltet)."""
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
    wie `planner_nocase(alias) = planner_nocase(?)` bzw. für `name`. Enthält
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
        finden (siehe routers/plans._resolve_or_create)."""
        self.by_name[_nocase_fold(name)] = PersonLookupEntry(person_id, name, department)

    def register_alias(self, alias: str, person_id: int, name: str, department: str | None = None) -> None:
        """Nach einer echten Alias-Neuanlage (add_alias) sofort in die Map übernehmen."""
        self.by_alias[_nocase_fold(alias)] = PersonLookupEntry(person_id, name, department)


def load_person_lookup(conn) -> PersonLookup:
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
        "SELECT id, deleted FROM people WHERE planner_nocase(name) = planner_nocase(%s)",
        (name,),
    ).fetchone()
    if existing and existing["deleted"]:
        conn.execute(
            "UPDATE people SET department = %s, active = 1, deleted = 0 WHERE id = %s",
            (department, existing["id"]),
        )
        conn.execute(
            "DELETE FROM employee_statistics WHERE person_id = %s",
            (existing["id"],),
        )
        return existing["id"]
    row = conn.execute(
        "INSERT INTO people (name, department, active, deleted) "
        "VALUES (%s, %s, 1, 0) RETURNING id",
        (name, department),
    ).fetchone()
    return row["id"]


def add_alias(conn, person_id: int, alias: str):
    """Legt einen Alias an, sofern er noch nicht existiert.

    Ersetzt SQLites `INSERT OR IGNORE`. Das Conflict-Target ist bewusst
    ausgeschrieben (`alias`) statt geraten - genau diese Spalte trägt den
    UNIQUE-Constraint, den die alte Anweisung ignoriert hat.
    """
    conn.execute(
        "INSERT INTO people_aliases (person_id, alias) VALUES (%s, %s) "
        "ON CONFLICT (alias) DO NOTHING",
        (person_id, alias),
    )


# ---------------------------------------------------------------------------
# Dienstpläne
# ---------------------------------------------------------------------------


def insert_week_plan(conn, kw, start_date, end_date, source_pdf) -> int:
    row = conn.execute(
        "INSERT INTO week_plans (kw, start_date, end_date, source_pdf) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        (kw, start_date, end_date, source_pdf),
    ).fetchone()
    return row["id"]


def insert_assignment(conn, week_plan_id, date, category, subcategory, person_id, raw_text):
    conn.execute(
        """INSERT INTO assignments (week_plan_id, date, category, subcategory, person_id, raw_text)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (week_plan_id, date, category, subcategory, person_id, raw_text),
    )


def insert_absence(conn, week_plan_id, date, person_id, typ):
    conn.execute(
        "INSERT INTO absences (week_plan_id, date, person_id, typ) VALUES (%s, %s, %s, %s)",
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
           WHERE a.week_plan_id = %s ORDER BY a.date, a.category""",
        (week_plan_id,),
    ).fetchall()


def get_absences_for_week(conn, week_plan_id):
    return conn.execute(
        """SELECT ab.date, p.name AS person, ab.typ
           FROM absences ab LEFT JOIN people p ON ab.person_id = p.id
           WHERE ab.week_plan_id = %s ORDER BY ab.date""",
        (week_plan_id,),
    ).fetchall()


def delete_week_plan(conn, week_plan_id):
    """Löscht eine Woche samt Zuweisungen und Abwesenheiten.

    Die beiden expliziten DELETEs bleiben bewusst stehen, obwohl die
    Fremdschlüssel jetzt ON DELETE CASCADE tragen: das Verhalten ist dadurch
    identisch zum bisherigen Code und nicht von der FK-Definition abhängig.
    """
    conn.execute("DELETE FROM assignments WHERE week_plan_id = %s", (week_plan_id,))
    conn.execute("DELETE FROM absences WHERE week_plan_id = %s", (week_plan_id,))
    conn.execute("DELETE FROM week_plans WHERE id = %s", (week_plan_id,))


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


def get_setting(conn, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM settings WHERE key = %s", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(conn, key: str, value: str):
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (%s, %s) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


# ---------------------------------------------------------------------------
# Gedächtnis-Overrides
# ---------------------------------------------------------------------------


def get_memory_overrides(conn, person_id: int | None = None):
    if person_id is None:
        return conn.execute(
            "SELECT * FROM person_memory_overrides ORDER BY person_id, facet, item_key"
        ).fetchall()
    return conn.execute(
        "SELECT * FROM person_memory_overrides WHERE person_id = %s ORDER BY facet, item_key",
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
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (person_id, facet, item_key) DO UPDATE SET
               state = excluded.state,
               value = excluded.value,
               note = excluded.note,
               updated_at = planner_now_text()""",
        (person_id, facet, item_key, state, value, note),
    )


def clear_memory_override(conn, person_id: int, facet: str, item_key: str):
    conn.execute(
        "DELETE FROM person_memory_overrides "
        "WHERE person_id = %s AND facet = %s AND item_key = %s",
        (person_id, facet, item_key),
    )


def clear_memory_overrides_for_person(conn, person_id: int, facet: str | None = None):
    if facet is None:
        conn.execute("DELETE FROM person_memory_overrides WHERE person_id = %s", (person_id,))
    else:
        conn.execute(
            "DELETE FROM person_memory_overrides WHERE person_id = %s AND facet = %s",
            (person_id, facet),
        )
    conn.commit()


# ---------------------------------------------------------------------------
# Künstlerplan
# ---------------------------------------------------------------------------


def upsert_artist_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    sheet_name: str | None,
    entries: list[dict],
) -> int:
    row = conn.execute(
        """INSERT INTO artist_plans
               (start_date, end_date, source_filename, sheet_name)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               sheet_name = excluded.sheet_name,
               updated_at = planner_now_text()
           RETURNING id""",
        (start_date, end_date, source_filename, sheet_name),
    ).fetchone()
    artist_plan_id = row["id"]
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = %s",
        (artist_plan_id,),
    )
    conn.executemany(
        """INSERT INTO artist_plan_entries
               (artist_plan_id, date, field_key, content)
           VALUES (%s, %s, %s, %s)""",
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
        """SELECT ap.id, ap.start_date, ap.end_date, ap.source_filename, ap.sheet_name,
                  ap.imported_at, ap.updated_at,
                  COUNT(CASE WHEN TRIM(COALESCE(e.content, '')) <> '' THEN 1 END) AS filled_entries
           FROM artist_plans ap
           LEFT JOIN artist_plan_entries e ON e.artist_plan_id = ap.id
           GROUP BY ap.id
           ORDER BY ap.start_date DESC"""
    ).fetchall()


def get_artist_plan(conn, artist_plan_id: int):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE id = %s", (artist_plan_id,)
    ).fetchone()


def get_artist_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM artist_plans WHERE start_date = %s", (start_date,)
    ).fetchone()


def get_artist_plan_entries(conn, artist_plan_id: int):
    return conn.execute(
        """SELECT date, field_key, content
           FROM artist_plan_entries
           WHERE artist_plan_id = %s
           ORDER BY date, field_key""",
        (artist_plan_id,),
    ).fetchall()


def delete_artist_plan(conn, artist_plan_id: int):
    conn.execute(
        "DELETE FROM artist_plan_entries WHERE artist_plan_id = %s",
        (artist_plan_id,),
    )
    conn.execute("DELETE FROM artist_plans WHERE id = %s", (artist_plan_id,))


# ---------------------------------------------------------------------------
# Probenplan
# ---------------------------------------------------------------------------


def upsert_rehearsal_plan(
    conn,
    start_date: str,
    end_date: str,
    source_filename: str | None,
    rehearsals: list[dict],
) -> int:
    plan_row = conn.execute(
        """INSERT INTO rehearsal_plans (start_date, end_date, source_filename)
           VALUES (%s, %s, %s)
           ON CONFLICT (start_date) DO UPDATE SET
               end_date = excluded.end_date,
               source_filename = excluded.source_filename,
               updated_at = planner_now_text()
           RETURNING id""",
        (start_date, end_date, source_filename),
    ).fetchone()
    plan_id = plan_row["id"]
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = %s", (plan_id,)
        ).fetchall()
    ]
    if rehearsal_ids:
        # = ANY(%s) statt einer dynamisch zusammengebauten IN-(?,?,...)-Liste:
        # ein einziger Parameter, kein SQL-String-Bau, keine Grenze durch die
        # maximale Parameteranzahl.
        conn.execute(
            "DELETE FROM rehearsal_people WHERE rehearsal_id = ANY(%s)",
            (rehearsal_ids,),
        )
    conn.execute("DELETE FROM rehearsals WHERE rehearsal_plan_id = %s", (plan_id,))

    for rehearsal in rehearsals:
        row = conn.execute(
            """INSERT INTO rehearsals
                   (rehearsal_plan_id, date, start_time, end_time, location, activity,
                    show_code, participants_raw, choreographer_raw, end_inferred)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
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
        ).fetchone()
        rehearsal_id = row["id"]
        conn.executemany(
            """INSERT INTO rehearsal_people
                   (rehearsal_id, raw_name, person_name, role, start_time, end_time)
               VALUES (%s, %s, %s, %s, %s, %s)""",
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
        """SELECT rp.id, rp.start_date, rp.end_date, rp.source_filename,
                  rp.imported_at, rp.updated_at,
                  COUNT(r.id) AS rehearsal_count
           FROM rehearsal_plans rp
           LEFT JOIN rehearsals r ON r.rehearsal_plan_id = rp.id
           GROUP BY rp.id
           ORDER BY rp.start_date DESC"""
    ).fetchall()


def get_rehearsal_plan(conn, rehearsal_plan_id: int):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE id = %s", (rehearsal_plan_id,)
    ).fetchone()


def get_rehearsal_plan_by_start(conn, start_date: str):
    return conn.execute(
        "SELECT * FROM rehearsal_plans WHERE start_date = %s", (start_date,)
    ).fetchone()


def get_rehearsals(conn, rehearsal_plan_id: int):
    rows = conn.execute(
        """SELECT * FROM rehearsals
           WHERE rehearsal_plan_id = %s
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
                   WHERE rehearsal_id = %s
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
             AND r.date BETWEEN %s AND %s
           ORDER BY r.date, p.start_time, p.person_name""",
        (start_date, end_date),
    ).fetchall()


def get_rehearsal_events(conn, start_date: str, end_date: str):
    return conn.execute(
        """SELECT date, start_time, end_time, activity, show_code
           FROM rehearsals
           WHERE date BETWEEN %s AND %s
           ORDER BY date, start_time, id""",
        (start_date, end_date),
    ).fetchall()


def delete_rehearsal_plan(conn, rehearsal_plan_id: int):
    rehearsal_ids = [
        row["id"]
        for row in conn.execute(
            "SELECT id FROM rehearsals WHERE rehearsal_plan_id = %s",
            (rehearsal_plan_id,),
        ).fetchall()
    ]
    if rehearsal_ids:
        conn.execute(
            "DELETE FROM rehearsal_people WHERE rehearsal_id = ANY(%s)",
            (rehearsal_ids,),
        )
    conn.execute(
        "DELETE FROM rehearsals WHERE rehearsal_plan_id = %s",
        (rehearsal_plan_id,),
    )
    conn.execute(
        "DELETE FROM rehearsal_plans WHERE id = %s",
        (rehearsal_plan_id,),
    )


# ---------------------------------------------------------------------------
# Wartung
# ---------------------------------------------------------------------------

#: Reihenfolge, in der Tabellen befüllt bzw. geleert werden können, ohne
#: Fremdschlüssel zu verletzen (Eltern vor Kindern). Wird vom Migrationstool
#: und von der Testinfrastruktur genutzt - eine einzige Quelle der Wahrheit.
TABLES_IN_DEPENDENCY_ORDER: tuple[str, ...] = (
    "settings",
    "people",
    "people_aliases",
    "week_plans",
    "assignments",
    "absences",
    "artist_plans",
    "artist_plan_entries",
    "rehearsal_plans",
    "rehearsals",
    "rehearsal_people",
    "person_memory_overrides",
    "employee_skills",
    "employee_memory",
    "employee_statistics",
    "plan_audit_log",
    "recommendation_history",
)


def truncate_all_tables(conn) -> None:
    """Leert alle Fachtabellen (nur für Testinfrastruktur und Migrationstool).

    Nutzt bewusst pgsql.Identifier statt String-Interpolation, obwohl die Namen
    aus einer Konstante stammen.
    """
    statement = pgsql.SQL("TRUNCATE TABLE {} RESTART IDENTITY CASCADE").format(
        pgsql.SQL(", ").join(
            pgsql.Identifier(table) for table in TABLES_IN_DEPENDENCY_ORDER
        )
    )
    conn.execute(statement)
