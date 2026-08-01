"""API-Tests über TestClient. Nur lesende Endpunkte - verändert keine
produktiven Daten, läuft bewusst gegen die echte lokale Datenbank (wie vom
Auftrag für /api/health und einen lesenden Mitarbeiter-Endpunkt vorgesehen).
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api import app

client = TestClient(app)


def test_health_check_returns_ok():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_health_check_never_leaks_a_personal_absolute_path():
    response = client.get("/api/health")
    body = response.json()

    assert "database_path" in body
    assert not body["database_path"].startswith("/")
    assert "Users" not in body["database_path"]


def test_team_endpoint_returns_a_list_of_people():
    response = client.get("/api/team")

    assert response.status_code == 200
    people = response.json()
    assert isinstance(people, list)
    if people:
        assert "name" in people[0]
        assert "active" in people[0]
