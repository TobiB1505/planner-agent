"""Der Schutz davor, dass Tests gegen eine Produktionsdatenbank laufen.

Sprint-Punkt 17/18: "Kein Test darf gegen Production Supabase, Preview Supabase
mit realen Daten oder Live-Planner-Daten laufen." Unter SQLite gab es dafür
einen Guard, der jeden `sqlite3.connect()` auf die echte Datenbankdatei
abgefangen hat (siehe conftest.py vor der Migration). Das Gegenstück für
PostgreSQL ist die Prüfung der TEST_DATABASE_URL - und dieser Test prüft den
Guard selbst, damit er nicht unbemerkt wirkungslos wird.
"""
from __future__ import annotations

import pytest

from backend.tests import conftest as guard


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://user:pw@db.abcdefghijkl.supabase.co:5432/postgres",
        "postgresql://user:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
        "postgresql://user:pw@planner.internal.render.com:5432/planner_test",
        "postgresql://user:pw@instance.eu-central-1.rds.amazonaws.com:5432/planner_test",
    ],
)
def test_hosted_database_services_are_refused(dsn):
    with pytest.raises(RuntimeError, match="gehosteten Datenbankdienst"):
        guard._assert_not_production(dsn)


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres@127.0.0.1:5432/planner_production",
        "postgresql://postgres@127.0.0.1:5432/planner-live",
        "postgresql://postgres@127.0.0.1:5432/preview_planner",
        "postgresql://postgres@127.0.0.1:5432/planner_staging",
    ],
)
def test_production_like_database_names_are_refused(dsn):
    with pytest.raises(RuntimeError):
        guard._assert_not_production(dsn)


def test_database_name_must_contain_test():
    """Letzte Sicherung: die Suite leert Schemata - der Name muss das ausweisen."""
    with pytest.raises(RuntimeError, match="muss 'test' enthalten"):
        guard._assert_not_production("postgresql://postgres@127.0.0.1:5432/planner")


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://postgres@127.0.0.1:5432/planner_test",
        "postgresql://postgres@localhost:5432/test_planner",
        "postgresql://runner:runner@127.0.0.1:5432/planner_test",
    ],
)
def test_local_test_databases_are_accepted(dsn):
    guard._assert_not_production(dsn)


@pytest.mark.parametrize("environment", ["production", "preview", "prod", "live"])
def test_suite_refuses_to_run_in_a_non_test_environment(monkeypatch, environment):
    monkeypatch.setenv("ENVIRONMENT", environment)
    with pytest.raises(RuntimeError, match="ENVIRONMENT/APP_ENV"):
        guard._require_test_environment()


def test_test_environment_is_accepted(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "test")
    guard._require_test_environment()


def test_every_test_gets_its_own_schema(_isolated_schema):
    """Die Isolation ist autouse - hier wird sie nur explizit sichtbar gemacht."""
    assert _isolated_schema.startswith("t_")


def test_data_from_another_test_is_not_visible_part_one(test_conn):
    from backend import db

    db.create_person(test_conn, "Nur in Teil eins")
    test_conn.commit()
    assert len(db.get_all_people(test_conn)) == 1


def test_data_from_another_test_is_not_visible_part_two(test_conn):
    from backend import db

    assert db.get_all_people(test_conn) == [], (
        "Ein Test darf niemals Daten eines anderen Tests sehen"
    )
