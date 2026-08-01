"""Regressionstest: wiederholtes Speichern darf keine doppelte Planwoche anlegen."""
from __future__ import annotations

from backend import api, db


def _payload(day_label: str, person: str) -> api.PlanSaveRequest:
    return api.PlanSaveRequest(
        start_date="2026-08-10",
        end_date="2026-08-16",
        template_week_id=99,
        day_labels=[day_label],
        rows=[
            {
                "Abschnitt": "Tagesverantwortung",
                "Zeile": "",
                "_row_type": "data",
                "_category": "Tagesverantwortung",
                day_label: person,
            }
        ],
    )


def test_repeated_plan_save_updates_same_week(tmp_path, monkeypatch):
    database_path = tmp_path / "planner-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    monkeypatch.setattr(api, "get_conn", db.get_conn)

    first = api.plan_save(_payload("Mo, 10.08.", "Tobi"))
    second = api.plan_save(_payload("Mo, 10.08.", "Fanny"))

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
