"""API-Tests über TestClient. Nur lesende Endpunkte.

Safety Fix: lief zuvor bewusst gegen die echte lokale Datenbank (siehe
docs/refactoring/SAFETY_TEST_ISOLATION.md) - jetzt wie alle anderen Tests
gegen eine isolierte, temporäre Testdatenbank (test_conn/test_db_path aus
conftest.py). Der globale Schutz-Fixture (`_guard_against_real_database`)
lässt jeden Test fehlschlagen, der doch die echte Datei öffnet.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend import db
from backend.api import app


def test_health_check_returns_ok(test_db_path):
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["database"] == "connected"


def test_health_check_never_leaks_a_personal_absolute_path(test_db_path):
    with TestClient(app) as client:
        response = client.get("/api/health")

    body = response.json()
    assert "database_path" in body
    assert not body["database_path"].startswith("/")
    assert "Users" not in body["database_path"]


def test_team_endpoint_returns_a_list_of_people(test_conn):
    db.create_person(test_conn, "Team-Test-Person", "Testabteilung")
    test_conn.commit()

    with TestClient(app) as client:
        response = client.get("/api/team")

    assert response.status_code == 200
    people = response.json()
    assert isinstance(people, list)
    assert len(people) == 1
    assert people[0]["name"] == "Team-Test-Person"
    assert people[0]["active"] is True
