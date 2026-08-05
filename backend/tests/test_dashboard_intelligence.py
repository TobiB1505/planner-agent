from __future__ import annotations

from backend import db
from backend.intelligence import audit, dashboard


def test_dashboard_snapshot_combines_quality_memory_and_audit(tmp_path, monkeypatch):
    # AP4: get_conn() legt das Schema nicht mehr implizit an - deshalb hier
    # einmalig explizit initialize_database() aufrufen (siehe backend/db.py).
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "dashboard.db")
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    db.initialize_database()
    conn = db.get_conn()
    tobi_id = db.create_person(conn, "Tobi", "Manager")
    db.create_person(conn, "Dylana", "T&C")
    week_id = db.insert_week_plan(
        conn, 31, "2026-07-27", "2026-08-02", "Test"
    )
    db.insert_assignment(
        conn, week_id, "2026-07-27", "OPS + WP", None, tobi_id, None
    )
    audit.record_plan_saved(
        conn, week_plan_id=week_id, start_date="2026-07-27", assignments=1
    )
    conn.commit()

    result = dashboard.dashboard_snapshot(conn, week_id)

    assert result["quality"]["max_score"] == 100
    assert result["intelligence"]["active_people"] == 2
    assert result["intelligence"]["evidence_profiles"] == 1
    assert result["intelligence"]["cold_start_people"] == ["Dylana"]
    assert result["intelligence"]["recent_audit"][0]["event_type"] == "plan_saved"
