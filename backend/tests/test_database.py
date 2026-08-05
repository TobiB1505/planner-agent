"""Tests für backend/db.py - immer gegen eine temporäre Testdatenbank,
niemals gegen die echte lokale Mitarbeiterdatenbank."""
from __future__ import annotations

import pytest

from backend import db as db_module

EXPECTED_TABLES = {
    "people",
    "week_plans",
    "assignments",
    "absences",
    "person_memory_overrides",
    "artist_plans",
    "rehearsal_plans",
    "settings",
}


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    """Leitet die Datenbank auf eine frische Datei in tmp_path um und
    initialisiert Schema/Migrationen einmalig explizit (AP4: get_conn() legt
    das Schema nicht mehr implizit an - das übernimmt initialize_database())."""
    test_db_path = tmp_path / "test_dienstplaene.db"
    monkeypatch.setattr(db_module, "DATABASE_PATH", test_db_path)
    # Die echten Laufzeitordner sollen für diesen isolierten Test nicht
    # angefasst werden - tmp_path existiert bereits, das reicht für sqlite3.
    monkeypatch.setattr(db_module, "ensure_runtime_directories", lambda: None)
    db_module.initialize_database()
    return test_db_path


def test_initialize_database_creates_expected_tables(isolated_db):
    conn = db_module.get_conn()
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert EXPECTED_TABLES.issubset(tables)
    finally:
        conn.close()


def test_integrity_check_reports_ok(isolated_db):
    conn = db_module.get_conn()
    try:
        result = conn.execute("PRAGMA integrity_check;").fetchone()[0]
        assert result == "ok"
    finally:
        conn.close()


def test_no_second_database_file_is_created(isolated_db, tmp_path):
    conn = db_module.get_conn()
    conn.close()

    db_files = list(tmp_path.rglob("*.db"))
    assert db_files == [isolated_db]


def test_reading_people_works_on_a_fresh_database(isolated_db):
    conn = db_module.get_conn()
    try:
        person_id = db_module.create_person(conn, "Test-MA", "Testabteilung")
        people = db_module.get_all_people(conn)
        names = [p["name"] for p in people]

        assert person_id > 0
        assert "Test-MA" in names
    finally:
        conn.close()
