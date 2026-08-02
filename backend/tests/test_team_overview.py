from __future__ import annotations

from backend import db
from backend.intelligence import team_overview


def test_team_overview_is_derived_from_history_and_marks_cold_start(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "team-overview.db")
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    conn = db.get_conn()
    experienced_id = db.create_person(conn, "Tobi", "Manager")
    new_id = db.create_person(conn, "Dylana", "T&C")
    week_id = db.insert_week_plan(
        conn, 31, "2026-07-27", "2026-08-02", "Test"
    )
    db.insert_assignment(
        conn,
        week_id,
        "2026-07-27",
        "Moderation + Getränkedienst",
        None,
        experienced_id,
        None,
    )
    conn.commit()

    result = team_overview.build_team_overview(
        conn,
        current_week_start="2026-07-27",
    )
    people = {row["person_id"]: row for row in result["people"]}

    assert result["summary"]["active_people"] == 2
    assert result["summary"]["with_history"] == 1
    assert people[experienced_id]["history_assignments"] == 1
    assert people[experienced_id]["top_skills"][0]["name"] == "Moderation"
    assert people[new_id]["data_status"] == "new"
    assert people[new_id]["planning_hint"]["label"] == "Datenbasis aufbauen"

    db.update_person(conn, new_id, "Dylana", "Sportstainer", True)
    refreshed = team_overview.build_team_overview(
        conn,
        current_week_start="2026-07-27",
    )
    refreshed_people = {row["person_id"]: row for row in refreshed["people"]}
    assert refreshed_people[new_id]["top_skills"][0]["name"] == "Sport"
