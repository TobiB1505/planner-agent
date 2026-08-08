"""Tests für den Migrationsmechanismus (Sprint-Punkt 7).

Anforderungen, die hier abgesichert werden:
  * Schema ist versioniert und der Stand ist auslesbar
  * Migrationen sind reproduzierbar und idempotent
  * eine fehlerhafte Migration schlägt FEHL statt halbfertig weiterzulaufen
  * bestehende Daten werden nicht automatisch gelöscht
  * Schemaerzeugung passiert nie aus einem zufälligen Request-Pfad
"""
from __future__ import annotations

import psycopg
import pytest

from backend import db
from backend import migrations as migrations_module


def test_migration_files_are_discovered_in_order():
    found = migrations_module.discover_migrations()
    assert [m.version for m in found] == sorted(m.version for m in found)
    assert found[0].version == "001"
    assert found[0].name == "initial_postgres"


def test_badly_named_migration_file_is_rejected(tmp_path):
    (tmp_path / "kein_versionspraefix.sql").write_text("SELECT 1", encoding="utf-8")
    with pytest.raises(migrations_module.MigrationError, match="unerwartetem Namen"):
        migrations_module.discover_migrations(tmp_path)


def test_duplicate_migration_version_is_rejected(tmp_path):
    (tmp_path / "002_alpha.sql").write_text("SELECT 1", encoding="utf-8")
    (tmp_path / "002_beta.sql").write_text("SELECT 1", encoding="utf-8")
    with pytest.raises(migrations_module.MigrationError, match="Doppelte Migrationsversion"):
        migrations_module.discover_migrations(tmp_path)


def test_applied_version_is_recorded(test_conn):
    assert migrations_module.current_version(test_conn) == "001"
    rows = test_conn.execute(
        "SELECT version, name FROM schema_migrations ORDER BY version"
    ).fetchall()
    assert [(row["version"], row["name"]) for row in rows] == [("001", "initial_postgres")]


def test_applying_again_is_a_no_op(test_conn, tmp_path):
    assert migrations_module.pending_migrations(test_conn) == []
    assert migrations_module.apply_migrations(test_conn) == []


def test_a_new_migration_is_applied_and_recorded(test_conn, tmp_path):
    (tmp_path / "001_initial_postgres.sql").write_text(
        "-- bereits angewendet, Inhalt hier irrelevant\nSELECT 1;", encoding="utf-8"
    )
    (tmp_path / "002_add_probe_table.sql").write_text(
        "CREATE TABLE migrations_probe (id BIGINT PRIMARY KEY);", encoding="utf-8"
    )

    applied = migrations_module.apply_migrations(test_conn, tmp_path)
    assert applied == ["002"]
    assert migrations_module.current_version(test_conn) == "002"
    test_conn.execute("SELECT COUNT(*) FROM migrations_probe")


def test_failing_migration_aborts_and_rolls_back_completely(test_conn, tmp_path):
    """Eine Migration muss fehlschlagen statt halbfertig weiterzulaufen.

    Die Datei legt zuerst eine gültige Tabelle an und enthält danach eine
    ungültige Anweisung. Nach dem Abbruch darf WEDER die Tabelle existieren
    NOCH ein schema_migrations-Eintrag vorhanden sein.
    """
    (tmp_path / "002_haelftig.sql").write_text(
        "CREATE TABLE haelftig (id BIGINT PRIMARY KEY);\n"
        "CREATE TABLE haelftig_zwei (id BIGINT REFERENCES gibt_es_nicht(id));",
        encoding="utf-8",
    )

    with pytest.raises(migrations_module.MigrationError, match="zurückgerollt"):
        migrations_module.apply_migrations(test_conn, tmp_path)

    assert migrations_module.current_version(test_conn) == "001"
    with pytest.raises(psycopg.errors.UndefinedTable):
        test_conn.execute("SELECT 1 FROM haelftig")
    test_conn.rollback()


def test_migrations_never_delete_existing_data(test_conn, tmp_path):
    person_id = db.create_person(test_conn, "Muss überleben", "QA")
    test_conn.commit()

    (tmp_path / "002_noop.sql").write_text(
        "CREATE TABLE noop_probe (id BIGINT PRIMARY KEY);", encoding="utf-8"
    )
    migrations_module.apply_migrations(test_conn, tmp_path)

    people = db.get_all_people(test_conn)
    assert [p["id"] for p in people] == [person_id]


def test_initialize_database_is_the_only_schema_entry_point(test_conn):
    """Kein Request-Pfad darf Schema anlegen.

    Nachweis: der reguläre Weg (create_connection + Fachfunktion) legt bei einer
    fehlenden Tabelle nichts an, sondern schlägt fehl. Schema entsteht
    ausschließlich über initialize_database()/apply_migrations().
    """
    test_conn.execute("DROP TABLE settings CASCADE")
    test_conn.commit()

    conn = db.create_connection()
    try:
        with pytest.raises(psycopg.errors.UndefinedTable):
            db.get_setting(conn, "irgendwas")
    finally:
        conn.close()
