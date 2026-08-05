"""Gezielte Tests für AP4 (Verbindungs-/Schema-Lifecycle).

Deckt genau die in AP4 geforderten Fälle ab:
  A. initialize_database() ist idempotent
  B. create_connection() legt kein Schema an und migriert nicht
  C. der FastAPI-Lifespan initialisiert die Datenbank
  D. eine Request-Connection wird bei Erfolg UND bei einer Exception geschlossen
  E. die Schema-/Migrationsinitialisierung läuft nicht pro Request erneut

Nie gegen die echte lokale Mitarbeiterdatenbank - immer gegen eine temporäre,
per monkeypatch umgeleitete Datei in tmp_path.
"""
from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend import api, db


class ConnectionCloseSpy:
    """Dünner Wrapper um eine echte sqlite3.Connection, der nur das Schließen
    beobachtbar macht - kein Mock der Fachlogik, alle echten Aufrufe (execute,
    commit, ...) gehen unverändert an die reale Verbindung weiter."""

    def __init__(self, real_conn: sqlite3.Connection):
        self._real_conn = real_conn
        self.closed = False

    def __getattr__(self, name):
        return getattr(self._real_conn, name)

    def close(self) -> None:
        self.closed = True
        self._real_conn.close()


@pytest.fixture
def redirected_db(tmp_path, monkeypatch, request):
    db_path = tmp_path / f"{request.node.name}.db"
    monkeypatch.setattr(db, "DATABASE_PATH", db_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    return db_path


# ---------- A. Idempotenz ----------


def test_initialize_database_is_idempotent(redirected_db):
    db.initialize_database()
    conn = db.create_connection()
    person_id = db.create_person(conn, "Idempotenz-Test", "Testabteilung")
    conn.close()

    # Zweiter Aufruf darf weder fehlschlagen noch vorhandene Daten verändern
    # (CREATE TABLE/INDEX IF NOT EXISTS, additive _migrate()-Prüfungen).
    db.initialize_database()

    conn2 = db.create_connection()
    try:
        people = db.get_all_people(conn2)
        assert [p["id"] for p in people] == [person_id]
        assert people[0]["name"] == "Idempotenz-Test"
    finally:
        conn2.close()


# ---------- B. create_connection() migriert nicht ----------


def test_create_connection_does_not_create_schema(redirected_db):
    conn = db.create_connection()
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert tables == set(), "create_connection() darf kein Schema anlegen"

        with pytest.raises(sqlite3.OperationalError):
            conn.execute("SELECT COUNT(*) FROM people")

        # Verbindungsseitige Konfiguration (AP3) bleibt trotzdem aktiv - nur
        # Schema/Migration fehlen, nicht die PRAGMA-Einstellungen.
        assert conn.execute("PRAGMA busy_timeout;").fetchone()[0] == 5000
    finally:
        conn.close()


# ---------- C. Lifespan initialisiert die Datenbank ----------


def test_lifespan_initializes_database_via_testclient(redirected_db):
    with TestClient(api.app) as client:
        response = client.get("/api/team")
        assert response.status_code == 200
        assert response.json() == []

    conn = db.get_conn()
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert "people" in tables
        assert "week_plans" in tables
    finally:
        conn.close()


# ---------- D. Request-Connection wird geschlossen ----------


def test_request_connection_is_closed_after_success(redirected_db, monkeypatch):
    spies: list[ConnectionCloseSpy] = []
    real_create_connection = db.create_connection

    def spying_create_connection():
        spy = ConnectionCloseSpy(real_create_connection())
        spies.append(spy)
        return spy

    monkeypatch.setattr(db, "create_connection", spying_create_connection)

    with TestClient(api.app) as client:
        response = client.get("/api/team")
        assert response.status_code == 200

    # spies[0] ist die Initialisierungs-Connection aus dem Lifespan (auch die
    # muss geschlossen sein), spies[-1] die des GET-Requests selbst.
    assert len(spies) >= 2
    assert all(spy.closed for spy in spies)


def test_request_connection_is_closed_after_exception(redirected_db, monkeypatch):
    spies: list[ConnectionCloseSpy] = []
    real_create_connection = db.create_connection

    def spying_create_connection():
        spy = ConnectionCloseSpy(real_create_connection())
        spies.append(spy)
        return spy

    monkeypatch.setattr(db, "create_connection", spying_create_connection)

    with TestClient(api.app) as client:
        # Absichtlich fehlschlagender Request: /api/dashboard/insights löst für
        # eine nicht existierende week_id ein ValueError -> HTTPException(404)
        # aus (stats.week_insights(), unveränderte, bestehende Fachlogik) -
        # kein Sonderfall extra für diesen Test.
        response = client.get("/api/dashboard/insights", params={"week_id": 999999})
        assert response.status_code == 404

    request_spy = spies[-1]
    assert request_spy.closed is True, (
        "Die Request-Connection muss auch dann geschlossen werden, wenn der "
        "Endpunkt eine Exception wirft."
    )


# ---------- E. Initialisierung läuft nicht pro Request ----------


def test_initialize_database_runs_only_once_across_multiple_requests(redirected_db, monkeypatch):
    call_count = {"n": 0}
    real_initialize_database = db.initialize_database

    def counting_initialize_database():
        call_count["n"] += 1
        real_initialize_database()

    monkeypatch.setattr(db, "initialize_database", counting_initialize_database)

    with TestClient(api.app) as client:
        for _ in range(5):
            response = client.get("/api/team")
            assert response.status_code == 200

    assert call_count["n"] == 1, (
        "initialize_database() darf nur einmal beim Lifespan-Start laufen, "
        "nicht bei jedem der fünf Requests erneut."
    )
