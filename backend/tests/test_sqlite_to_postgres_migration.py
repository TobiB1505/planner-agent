"""Tests für das Datenmigrationstool (Sprint-Punkte 20-25).

Baut jeweils eine echte, kleine SQLite-Datenbank im alten Schema auf und
migriert sie in das isolierte PostgreSQL-Testschema. Geprüft wird genau das,
was beim echten Cutover schiefgehen kann:

  * Zeilenzahlen und fachliche Inhalte stimmen überein
  * IDs bleiben erhalten UND die Sequenzen liegen danach darüber
  * NULL-Werte bleiben NULL (und werden nicht zu leeren Strings)
  * ein nicht leeres Ziel wird standardmäßig NICHT überschrieben
  * ein Fehler mitten im Lauf hinterlässt nichts (eine Transaktion)
  * Waisen in den Altdaten führen zu einem Abbruch mit Bericht, nicht zu
    stillem Datenverlust
  * --dry-run schreibt nichts
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend import db
from backend.scripts import migrate_sqlite_to_postgres as tool

# Das SQLite-Ausgangsschema, reduziert auf die Tabellen, die diese Tests
# befüllen - der Rest wird leer angelegt, damit das Tool alle 17 Tabellen
# vorfindet (genau wie bei einer echten Alt-Datenbank).
LEGACY_SCHEMA = """
CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    department TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE people_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    alias TEXT NOT NULL UNIQUE
);
CREATE TABLE week_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kw INTEGER, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
    source_pdf TEXT, imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT,
    person_id INTEGER REFERENCES people(id), raw_text TEXT
);
CREATE TABLE absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER NOT NULL REFERENCES week_plans(id),
    date TEXT NOT NULL, person_id INTEGER REFERENCES people(id), typ TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE artist_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL, source_filename TEXT, sheet_name TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE artist_plan_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    artist_plan_id INTEGER NOT NULL REFERENCES artist_plans(id),
    date TEXT NOT NULL, field_key TEXT NOT NULL, content TEXT,
    UNIQUE(artist_plan_id, date, field_key)
);
CREATE TABLE rehearsal_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, start_date TEXT NOT NULL UNIQUE,
    end_date TEXT NOT NULL, source_filename TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE rehearsals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_plan_id INTEGER NOT NULL REFERENCES rehearsal_plans(id),
    date TEXT NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL,
    location TEXT, activity TEXT NOT NULL, show_code TEXT,
    participants_raw TEXT, choreographer_raw TEXT,
    end_inferred INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE rehearsal_people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rehearsal_id INTEGER NOT NULL REFERENCES rehearsals(id),
    raw_name TEXT NOT NULL, person_name TEXT, role TEXT NOT NULL,
    start_time TEXT NOT NULL, end_time TEXT NOT NULL
);
CREATE TABLE person_memory_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    facet TEXT NOT NULL, item_key TEXT NOT NULL, state TEXT NOT NULL,
    value TEXT, note TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, facet, item_key)
);
CREATE TABLE employee_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    skill_id TEXT NOT NULL, name TEXT NOT NULL,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    source TEXT NOT NULL DEFAULT 'manual', evidence_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, skill_id)
);
CREATE TABLE employee_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    person_id INTEGER NOT NULL REFERENCES people(id),
    type TEXT NOT NULL, subject TEXT NOT NULL, value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 1.0, source TEXT NOT NULL DEFAULT 'manual',
    source_date TEXT NOT NULL, editable INTEGER NOT NULL DEFAULT 1, note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(person_id, type, subject, source)
);
CREATE TABLE employee_statistics (
    person_id INTEGER PRIMARY KEY REFERENCES people(id),
    data_version TEXT NOT NULL, payload_json TEXT NOT NULL,
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE plan_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER REFERENCES week_plans(id), start_date TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT 'Planer', event_type TEXT NOT NULL,
    cause TEXT NOT NULL, cell_key TEXT, previous_value TEXT, new_value TEXT,
    metadata_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE recommendation_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_plan_id INTEGER REFERENCES week_plans(id), start_date TEXT NOT NULL,
    date TEXT, category TEXT, subcategory TEXT,
    person_id INTEGER REFERENCES people(id), score REAL, reasons_json TEXT,
    accepted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def _build_legacy_db(path: Path, *, with_orphan: bool = False) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.executescript(LEGACY_SCHEMA)
        # Bewusst nicht bei 1 beginnende, lückenhafte IDs - genau so sieht eine
        # gewachsene Datenbank aus, und genau daran scheitert eine Migration,
        # die IDs neu vergibt.
        conn.executemany(
            "INSERT INTO people (id, name, department, active, deleted) VALUES (?, ?, ?, ?, ?)",
            [
                (7, "Tobi", "Manager", 1, 0),
                (12, "René", None, 1, 0),          # department bewusst NULL
                (41, "Alt-Kollege", "Deko", 0, 1),  # soft-gelöscht
            ],
        )
        conn.executemany(
            "INSERT INTO people_aliases (id, person_id, alias) VALUES (?, ?, ?)",
            [(3, 7, "T."), (9, 7, "Tobias"), (11, 12, "Rene")],
        )
        conn.execute(
            "INSERT INTO week_plans (id, kw, start_date, end_date, source_pdf, imported_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (55, 33, "2026-08-10", "2026-08-16", None, "2026-08-01 09:00:00"),
        )
        conn.executemany(
            """INSERT INTO assignments
                   (id, week_plan_id, date, category, subcategory, person_id, raw_text)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (101, 55, "2026-08-10", "Tagesverantwortung", None, 7, None),
                (102, 55, "2026-08-11", "Kochdienste", "KP3", 12, "Freitext"),
                (103, 55, "2026-08-12", "Show/Party", None, None, "NUR INFO"),
            ],
        )
        conn.execute(
            "INSERT INTO absences (id, week_plan_id, date, person_id, typ) VALUES (?, ?, ?, ?, ?)",
            (200, 55, "2026-08-13", 7, "Frei"),
        )
        conn.execute("INSERT INTO settings (key, value) VALUES (?, ?)", ("theme", "dark"))
        conn.execute(
            "INSERT INTO person_memory_overrides (id, person_id, facet, item_key, state, value, note, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (4, 7, "show", "MJ", "confirmed", None, None, "2026-08-01 10:00:00"),
        )
        conn.execute(
            "INSERT INTO rehearsal_plans (id, start_date, end_date, source_filename, imported_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (2, "2026-08-10", "2026-08-16", "proben.xlsx", "2026-08-01 09:00:00", "2026-08-01 09:00:00"),
        )
        conn.execute(
            """INSERT INTO rehearsals
                   (id, rehearsal_plan_id, date, start_time, end_time, location, activity,
                    show_code, participants_raw, choreographer_raw, end_inferred)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (30, 2, "2026-08-11", "14:00", "16:00", "Theater", "MJ Durchlauf", "MJ", None, None, 0),
        )
        conn.executemany(
            """INSERT INTO rehearsal_people
                   (id, rehearsal_id, raw_name, person_name, role, start_time, end_time)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (60, 30, "Tobi", "Tobi", "cast", "14:00", "16:00"),
                (61, 30, "Unbekannt", None, "cast", "14:00", "16:00"),
            ],
        )
        conn.execute(
            "INSERT INTO employee_memory (id, person_id, type, subject, value, confidence, "
            "source, source_date, editable, note, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (5, 7, "preference", "task:Kochdienste", '"preferred"', 0.8, "manual",
             "2026-08-01", 1, None, "2026-08-01 09:00:00", "2026-08-01 09:00:00"),
        )
        if with_orphan:
            # Verweist auf eine Woche, die es nicht gibt. Unter SQLite völlig
            # unbemerkt möglich, weil PRAGMA foreign_keys nie gesetzt wurde.
            conn.execute(
                "INSERT INTO assignments (id, week_plan_id, date, category, person_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (999, 4242, "2026-08-14", "Waise", None),
            )
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def legacy_db(tmp_path) -> Path:
    path = tmp_path / "dienstplaene.db"
    _build_legacy_db(path)
    return path


# ---------- Erfolgsfall ----------


def test_migration_transfers_all_rows_and_preserves_ids(legacy_db, test_conn):
    report = tool.run_migration(legacy_db, allow_non_empty=False)
    assert report.ok, [check.line() for check in report.checks if not check.passed]

    assert report.source_counts["people"] == 3
    assert report.target_counts["people"] == 3
    assert report.target_counts["assignments"] == 3

    people = {row["id"]: row for row in test_conn.execute("SELECT * FROM people").fetchall()}
    assert set(people) == {7, 12, 41}
    assert people[7]["name"] == "Tobi"
    assert people[41]["deleted"] == 1


def test_migration_preserves_null_values(legacy_db, test_conn):
    tool.run_migration(legacy_db, allow_non_empty=False)

    rene = test_conn.execute("SELECT * FROM people WHERE id = 12").fetchone()
    assert rene["department"] is None, "NULL darf nicht zu '' werden"

    week = test_conn.execute("SELECT * FROM week_plans WHERE id = 55").fetchone()
    assert week["source_pdf"] is None

    info_row = test_conn.execute("SELECT * FROM assignments WHERE id = 103").fetchone()
    assert info_row["person_id"] is None
    assert info_row["subcategory"] is None
    assert info_row["raw_text"] == "NUR INFO"

    unknown = test_conn.execute(
        "SELECT * FROM rehearsal_people WHERE id = 61"
    ).fetchone()
    assert unknown["person_name"] is None


def test_sequences_continue_above_the_highest_migrated_id(legacy_db, test_conn):
    """Sprint-Punkt 9: MAX(id) = 41 -> der nächste Insert muss > 41 sein."""
    tool.run_migration(legacy_db, allow_non_empty=False)

    max_person = test_conn.execute("SELECT MAX(id) AS m FROM people").fetchone()["m"]
    assert max_person == 41

    new_id = db.create_person(test_conn, "Nach der Migration")
    assert new_id > max_person

    max_assignment = test_conn.execute("SELECT MAX(id) AS m FROM assignments").fetchone()["m"]
    week_id = db.insert_week_plan(test_conn, 34, "2026-08-17", "2026-08-23", None)
    assert week_id > 55
    db.insert_assignment(test_conn, week_id, "2026-08-17", "Test", None, new_id, None)
    new_assignment = test_conn.execute("SELECT MAX(id) AS m FROM assignments").fetchone()["m"]
    assert new_assignment > max_assignment


def test_business_data_matches_after_migration(legacy_db, test_conn):
    """Fachliche Stichproben, nicht nur Zeilenzahlen (Sprint-Punkt 24)."""
    tool.run_migration(legacy_db, allow_non_empty=False)

    aliases = {
        row["alias"]
        for row in test_conn.execute(
            "SELECT alias FROM people_aliases WHERE person_id = 7"
        ).fetchall()
    }
    assert aliases == {"T.", "Tobias"}

    # Alias-Auflösung funktioniert nach der Migration unverändert case-insensitiv.
    assert db.find_person_by_alias(test_conn, "TOBIAS") == 7
    assert db.find_person_by_alias(test_conn, "t.") == 7

    absences = test_conn.execute("SELECT * FROM absences").fetchall()
    assert [(row["date"], row["person_id"], row["typ"]) for row in absences] == [
        ("2026-08-13", 7, "Frei")
    ]

    override = test_conn.execute(
        "SELECT * FROM person_memory_overrides WHERE person_id = 7"
    ).fetchone()
    assert (override["facet"], override["item_key"], override["state"]) == (
        "show", "MJ", "confirmed",
    )

    # REAL -> DOUBLE PRECISION darf den Wert nicht verändern.
    memory_row = test_conn.execute("SELECT * FROM employee_memory WHERE id = 5").fetchone()
    assert memory_row["confidence"] == pytest.approx(0.8)

    # Zeitstempel-Strings bleiben unverändert erhalten (API-Vertrag).
    assert memory_row["created_at"] == "2026-08-01 09:00:00"


def test_referential_integrity_passes_after_migration(legacy_db, test_conn):
    report = tool.run_migration(legacy_db, allow_non_empty=False)
    integrity = [c for c in report.checks if c.name.startswith("Referenzielle Integrität")]
    assert integrity and integrity[0].passed
    assert tool.find_orphans_pg(test_conn) == []


# ---------- Schutzmechanismen ----------


def test_non_empty_target_aborts_by_default(legacy_db, test_conn):
    db.create_person(test_conn, "Schon da")
    test_conn.commit()

    with pytest.raises(tool.MigrationAborted, match="nicht leer"):
        tool.run_migration(legacy_db, allow_non_empty=False)

    # Nichts wurde angefasst.
    names = [row["name"] for row in db.get_all_people(test_conn)]
    assert names == ["Schon da"]


def test_allow_non_empty_replaces_the_target_content(legacy_db, test_conn):
    db.create_person(test_conn, "Wird ersetzt")
    test_conn.commit()

    report = tool.run_migration(legacy_db, allow_non_empty=True)
    assert report.ok

    names = {row["name"] for row in db.get_all_people(test_conn)}
    assert "Wird ersetzt" not in names
    assert {"Tobi", "René"} <= names


def test_orphaned_rows_abort_the_migration_without_deleting_anything(tmp_path, test_conn):
    """Sprint-Punkt 10/25: Waisen werden gemeldet, nicht stillschweigend gelöscht."""
    path = tmp_path / "mit-waisen.db"
    _build_legacy_db(path, with_orphan=True)

    with pytest.raises(tool.MigrationAborted) as excinfo:
        tool.run_migration(path, allow_non_empty=False)

    message = str(excinfo.value)
    assert "assignments.week_plan_id" in message
    assert "NICHTS gelöscht" in message

    # Ziel unberührt.
    assert test_conn.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"] == 0

    # Und die Quelle ist ebenfalls unverändert - die Waise steht noch drin.
    source = sqlite3.connect(str(path))
    try:
        assert source.execute(
            "SELECT COUNT(*) FROM assignments WHERE week_plan_id = 4242"
        ).fetchone()[0] == 1
    finally:
        source.close()


def test_a_failure_mid_run_leaves_the_target_completely_empty(legacy_db, test_conn, monkeypatch):
    """Alles-oder-nichts (Sprint-Punkt 21): ein Fehler nach den ersten Tabellen
    darf keine Teildaten hinterlassen."""
    real_copy_table = tool.copy_table

    def failing_copy_table(source, target, table):
        if table == "assignments":
            raise RuntimeError("simulierter Abbruch mitten im Lauf")
        return real_copy_table(source, target, table)

    monkeypatch.setattr(tool, "copy_table", failing_copy_table)

    with pytest.raises(tool.MigrationAborted, match="zurückgerollt"):
        tool.run_migration(legacy_db, allow_non_empty=False)

    for table in ("people", "people_aliases", "week_plans", "assignments"):
        count = test_conn.execute(
            f"SELECT COUNT(*) AS c FROM {table}"  # noqa: S608 - feste Testtabellennamen
        ).fetchone()["c"]
        assert count == 0, f"{table} enthält Reste eines abgebrochenen Laufs"


def test_source_is_opened_read_only(legacy_db):
    source = tool.open_source(legacy_db)
    try:
        with pytest.raises(sqlite3.OperationalError):
            source.execute("INSERT INTO settings (key, value) VALUES ('x', 'y')")
    finally:
        source.close()


# ---------- Dry Run ----------


def test_dry_run_reports_counts_without_writing(legacy_db, test_conn):
    report = tool.run_dry_run(legacy_db)

    assert report.ok, [check.line() for check in report.checks if not check.passed]
    assert report.source_counts["people"] == 3
    assert report.source_counts["assignments"] == 3
    assert all(count == 0 for count in report.target_counts.values())

    # Es wurde wirklich nichts geschrieben.
    assert test_conn.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"] == 0


def test_dry_run_flags_a_non_empty_target(legacy_db, test_conn):
    db.create_person(test_conn, "Schon da")
    test_conn.commit()

    report = tool.run_dry_run(legacy_db)
    empty_check = next(c for c in report.checks if c.name == "Ziel ist leer")
    assert not empty_check.passed
    assert "people=1" in empty_check.detail
    assert not report.ok


def test_dry_run_flags_orphans(tmp_path):
    path = tmp_path / "mit-waisen.db"
    _build_legacy_db(path, with_orphan=True)

    report = tool.run_dry_run(path)
    orphan_check = next(c for c in report.checks if c.name.startswith("Keine Waisen"))
    assert not orphan_check.passed
    assert "assignments.week_plan_id" in orphan_check.detail


def test_cli_requires_database_url(legacy_db, monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    exit_code = tool.main(["--source", str(legacy_db), "--dry-run"])
    assert exit_code == 2
    assert "DATABASE_URL" in capsys.readouterr().err
