from __future__ import annotations

from backend import db, stats


def _show(date: str, activity: str) -> dict:
    return {
        "date": date,
        "start_time": "21:30",
        "end_time": "22:30",
        "location": "Schachbrett",
        "activity": activity,
        "show_code": "SHOW",
        "people": [],
    }


def test_dashboard_show_days_follow_selected_week(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "dashboard-week.db")
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    conn = db.get_conn()
    selected_week_id = db.insert_week_plan(
        conn, 31, "2026-07-27", "2026-08-02", "KW31"
    )
    db.upsert_rehearsal_plan(
        conn,
        "2026-07-27",
        "2026-08-02",
        "kw31.pdf",
        [_show("2026-07-29", "New York Show")],
    )
    db.upsert_rehearsal_plan(
        conn,
        "2026-08-03",
        "2026-08-09",
        "kw32.pdf",
        [_show("2026-08-05", "Royals of Rock Show")],
    )

    result = stats.week_insights(conn, selected_week_id)

    assert result["planning_week"]["start_date"] == "2026-07-27"
    assert result["show_days"] == [
        {
            "date": "2026-07-29",
            "shows": ["New York Show"],
            "rehearsal_count": 1,
        }
    ]
