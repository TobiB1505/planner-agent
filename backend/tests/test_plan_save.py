"""Regressionstest: wiederholtes Speichern darf keine doppelte Planwoche anlegen.

AP4 (Verbindungs-/Schema-Lifecycle): /api/plan/save bezieht seine Connection
jetzt über Depends(db.get_db_connection) - ein direkter Python-Aufruf von
api.plan_save(...) würde dafür nur das Depends(...)-Objekt selbst statt einer
echten Connection erhalten. Der Endpunkt wird deshalb über den FastAPI-
TestClient angesprochen, exakt wie im echten Betrieb."""
from __future__ import annotations

from fastapi.testclient import TestClient

from backend import api, db


def _payload(day_label: str, person: str) -> dict:
    return {
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "template_week_id": 99,
        "day_labels": [day_label],
        "rows": [
            {
                "Abschnitt": "Tagesverantwortung",
                "Zeile": "",
                "_row_type": "data",
                "_category": "Tagesverantwortung",
                day_label: person,
            }
        ],
    }


def test_repeated_plan_save_updates_same_week(tmp_path, monkeypatch):
    database_path = tmp_path / "planner-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)

    # "with" aktiviert den FastAPI-Lifespan (siehe api.py) - er ruft
    # db.initialize_database() genau einmal auf und legt damit das Schema auf
    # der oben umgeleiteten temporären Testdatenbank an.
    with TestClient(api.app) as client:
        first = client.post("/api/plan/save", json=_payload("Mo, 10.08.", "Tobi")).json()
        second = client.post("/api/plan/save", json=_payload("Mo, 10.08.", "Fanny")).json()

    conn = db.get_conn()
    try:
        weeks = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = '2026-08-10'"
        ).fetchall()
        assignments = conn.execute(
            """SELECT p.name
               FROM assignments a
               JOIN people p ON p.id = a.person_id
               WHERE a.week_plan_id = ?""",
            (first["week_plan_id"],),
        ).fetchall()
    finally:
        conn.close()

    assert second["week_plan_id"] == first["week_plan_id"]
    assert len(weeks) == 1
    assert [row["name"] for row in assignments] == ["Fanny"]
    assert second["week"]["assignment_count"] == 1
