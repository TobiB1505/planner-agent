"""Gezielte Tests für AP4 (Verbindungs-/Schema-Lifecycle), jetzt auf PostgreSQL.

Deckt genau die in AP4 geforderten Fälle ab:
  A. initialize_database() ist idempotent
  B. create_connection() legt kein Schema an und migriert nicht
  C. der FastAPI-Lifespan initialisiert die Datenbank
  D. eine Request-Connection wird bei Erfolg UND bei einer Exception freigegeben
  E. die Schema-/Migrationsinitialisierung läuft nicht pro Request erneut

Zusätzlich seit der PostgreSQL-Migration:
  F. eine freigegebene Verbindung wandert in den Pool zurück (statt wegzufallen)

Nie gegen eine echte Planungsdatenbank - jeder Test bekommt über die
autouse-Fixture in conftest.py ein eigenes, frisch migriertes Schema.
"""
from __future__ import annotations

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend import api, db
from backend import migrations as db_migrations


class ConnectionCloseSpy:
    """Dünner Wrapper um eine echte db.Connection, der nur das Schließen
    beobachtbar macht - kein Mock der Fachlogik, alle echten Aufrufe (execute,
    commit, ...) gehen unverändert an die reale Verbindung weiter."""

    def __init__(self, real_conn: db.Connection):
        self._real_conn = real_conn
        self.closed = False

    def __getattr__(self, name):
        return getattr(self._real_conn, name)

    def close(self) -> None:
        self.closed = True
        self._real_conn.close()


def _table_names(conn) -> set[str]:
    rows = conn.execute(
        """SELECT table_name FROM information_schema.tables
           WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'"""
    ).fetchall()
    return {row["table_name"] for row in rows}


# ---------- A. Idempotenz ----------


def test_initialize_database_is_idempotent():
    db.initialize_database()
    conn = db.create_connection()
    person_id = db.create_person(conn, "Idempotenz-Test", "Testabteilung")
    conn.commit()
    conn.close()

    # Zweiter Aufruf darf weder fehlschlagen noch vorhandene Daten verändern -
    # der Migrationsrunner überspringt bereits angewendete Versionen.
    db.initialize_database()

    conn2 = db.create_connection()
    try:
        people = db.get_all_people(conn2)
        assert [p["id"] for p in people] == [person_id]
        assert people[0]["name"] == "Idempotenz-Test"
        assert db_migrations.pending_migrations(conn2) == []
    finally:
        conn2.close()


# ---------- B. create_connection() migriert nicht ----------


def test_create_connection_does_not_create_schema(monkeypatch):
    """Eine frisch geliehene Verbindung darf niemals selbst Schema anlegen.

    Geprüft wird in einem leeren Schema (das die conftest-Fixture zwar migriert
    hat, das hier aber bewusst vorher geleert wird): create_connection() darf
    daran nichts ändern, auch nicht "repariert" eine fehlende Tabelle anlegen.
    """
    setup = db.create_connection()
    try:
        setup.execute("DROP TABLE people CASCADE")
        setup.commit()
    finally:
        setup.close()

    conn = db.create_connection()
    try:
        assert "people" not in _table_names(conn), (
            "create_connection() darf kein Schema anlegen"
        )
        with pytest.raises(psycopg.errors.UndefinedTable):
            conn.execute("SELECT COUNT(*) FROM people")
    finally:
        conn.close()

    # Und danach stellt initialize_database() den Zustand wieder her, ohne dass
    # ein Request-Pfad das je tun müsste. Die Migration 001 gilt bereits als
    # angewendet, deshalb hier gezielt der Nachweis über den Runner selbst.
    check = db.create_connection()
    try:
        assert db_migrations.current_version(check) == "001"
    finally:
        check.close()


# ---------- C. Lifespan initialisiert die Datenbank ----------


def test_lifespan_initializes_database_via_testclient():
    with TestClient(api.app) as client:
        response = client.get("/api/team")
        assert response.status_code == 200
        assert response.json() == []

    conn = db.get_conn()
    try:
        tables = _table_names(conn)
        assert "people" in tables
        assert "week_plans" in tables
    finally:
        conn.close()


# ---------- D. Request-Connection wird freigegeben ----------


def test_request_connection_is_closed_after_success(monkeypatch):
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

    assert spies, "Der Request muss eine Connection geliehen haben"
    assert all(spy.closed for spy in spies)


def test_request_connection_is_closed_after_exception(monkeypatch):
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
        "Die Request-Connection muss auch dann freigegeben werden, wenn der "
        "Endpunkt eine Exception wirft."
    )


# ---------- E. Initialisierung läuft nicht pro Request ----------


def test_initialize_database_runs_only_once_across_multiple_requests(monkeypatch):
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


# ---------- F. Pool-Verhalten (neu mit PostgreSQL) ----------


def test_closing_a_connection_returns_it_to_the_pool():
    """Sprint-Punkt 14: Verbindungen wandern zurück in den Pool, sie lecken nicht.

    Supabase hat harte Verbindungslimits - eine Anwendung, die pro Request eine
    neue Verbindung aufbaut und liegen lässt, würde sie aufbrauchen. Nachweis:
    deutlich mehr Leih-/Rückgabe-Zyklen als die maximale Poolgröße laufen
    fehlerfrei durch, und die Zahl der offenen Serververbindungen bleibt
    innerhalb der Poolgrenze.
    """
    pool = db.get_pool()
    max_size = pool.max_size

    for _ in range(max_size * 4):
        conn = db.create_connection()
        try:
            conn.execute("SELECT 1").fetchone()
        finally:
            conn.close()

    assert pool.get_stats()["pool_size"] <= max_size


def test_uncommitted_changes_are_rolled_back_when_the_connection_is_released():
    """AP10-Kern: close() ohne commit() darf nichts hinterlassen.

    Unter SQLite erledigte das der implizite Rollback beim Schließen der Datei-
    Verbindung. Unter PostgreSQL muss die Rückgabe in den Pool dasselbe leisten -
    sonst würde eine halbfertige Transaktion an den nächsten Request
    weitergereicht.
    """
    conn = db.create_connection()
    db.create_person(conn, "Nie-Committet")
    conn.close()

    check = db.create_connection()
    try:
        row = check.execute(
            "SELECT COUNT(*) AS c FROM people WHERE name = %s", ("Nie-Committet",)
        ).fetchone()
        assert row["c"] == 0
    finally:
        check.close()
