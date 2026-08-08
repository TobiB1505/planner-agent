from __future__ import annotations

from backend import db
from backend.intelligence import audit, employee_stats, memory_engine, plan_quality, recommendation_engine


def _conn(tmp_path, monkeypatch):
    # AP4: get_conn() legt das Schema nicht mehr implizit an - deshalb hier
    # einmalig explizit initialize_database() aufrufen (siehe backend/db.py).
    return db.get_conn()


def _week(conn, start="2026-07-27", end="2026-08-02"):
    return db.insert_week_plan(conn, 31, start, end, "Test")


def test_employee_profile_skills_and_cache(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Moderation + Getränkedienst", None, person_id, None)
    db.insert_assignment(conn, week_id, "2026-07-28", "Moderation + Getränkedienst", None, person_id, None)
    db.insert_assignment(conn, week_id, "2026-07-29", "Kochdienste", "KP2 12:00 - 14:00", person_id, None)
    conn.commit()

    first = employee_stats.calculate_employee_statistics(conn, person_id)
    second = employee_stats.calculate_employee_statistics(conn, person_id)

    assert first["summary"]["assignments"] == 3
    assert any(skill["id"] == "moderation" and skill["evidence"] for skill in first["skills"])
    assert first["cache"]["hit"] is False
    assert second["cache"]["hit"] is True


def test_current_week_uses_latest_archived_version(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    person_id = db.create_person(conn, "Tobi", "Manager")
    old_week = _week(conn)
    db.insert_assignment(conn, old_week, "2026-07-27", "Kochdienste", "KP1", person_id, None)
    db.insert_assignment(conn, old_week, "2026-07-28", "Kochdienste", "KP2", person_id, None)
    latest_week = _week(conn)
    db.insert_assignment(conn, latest_week, "2026-07-27", "OPS + WP", None, person_id, None)
    conn.commit()

    profile = employee_stats.calculate_employee_statistics(
        conn, person_id, current_week_start="2026-07-27"
    )

    assert profile["current_week"]["assignments"] == 1


def test_manual_skill_and_structured_memory(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    person_id = db.create_person(conn, "Dani", "Sportstainer")

    profile = employee_stats.upsert_skill(
        conn, person_id, "moderation", "Moderation", 4, ["Von Tobi bestätigt"]
    )
    entries = memory_engine.upsert_manual_entry(
        conn,
        person_id,
        entry_type="constraint",
        subject="night_duties",
        value="avoid_consecutive",
        confidence=1.0,
        note="Nicht mehrere Nachtdienste hintereinander",
        source_date="2026-08-02",
    )

    assert next(skill for skill in profile["skills"] if skill["id"] == "moderation")["level"] == 4
    manual = next(item for item in entries if item["source"] == "manual")
    assert manual["subject"] == "night_duties"
    assert manual["editable"] is True
    assert manual["confidence"] == 1.0


def test_recommendation_reasons_are_evidence_based(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    dani_id = db.create_person(conn, "Dani", "Sportstainer")
    db.create_person(conn, "Dylana", "T&C")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-20", "Sportprogramm", "11:00 BVB", dani_id, None)
    conn.commit()

    result = recommendation_engine.recommend(
        conn,
        target_date="2026-07-27",
        category="Sportprogramm",
        subcategory="11:00 BVB",
        assignments=[],
        absences=[],
    )
    dani = next(item for item in result["candidates"] if item["employee"] == "Dani")
    dylana = next(item for item in result["candidates"] if item["employee"] == "Dylana")

    assert dani["status"] == "recommended"
    assert {reason["code"] for reason in dani["reasons"]} >= {"availability", "skill_match", "experience"}
    assert dylana["status"] == "unavailable"
    assert any(warning["code"] == "rule_blocked" for warning in dylana["warnings"])


def test_moderation_recommendation_prefers_spt_and_manager_and_warns_for_sound_light(
    tmp_path,
    monkeypatch,
):
    conn = _conn(tmp_path, monkeypatch)
    db.create_person(conn, "Sven", "SPT")
    db.create_person(conn, "Fanny", "Manager")
    db.create_person(conn, "Luca", "S&L")
    db.create_person(conn, "Mara", "Deko")
    conn.commit()

    result = recommendation_engine.recommend(
        conn,
        target_date="2026-07-27",
        category="Moderation + Getränkedienst",
        subcategory=None,
        assignments=[],
        absences=[],
    )
    candidates = {item["employee"]: item for item in result["candidates"]}

    assert candidates["Sven"]["status"] == "recommended"
    assert candidates["Fanny"]["status"] == "recommended"
    assert candidates["Luca"]["status"] == "warning"
    assert any(
        warning["code"] == "department_preference"
        for warning in candidates["Luca"]["warnings"]
    )
    assert candidates["Luca"]["status"] != "unavailable"


def test_plan_quality_handles_good_conflict_and_missing_data(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    dani_id = db.create_person(conn, "Dani", "Sportstainer")
    db.create_person(conn, "Nick", "Sportstainer")
    db.create_person(conn, "Manu", "Deko")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-20", "Sportprogramm", "11:00 BVB", dani_id, None)
    conn.commit()

    good = plan_quality.calculate_plan_quality(
        conn,
        start_date="2026-07-27",
        assignments=[{
            "date": "2026-07-27", "category": "Sportprogramm",
            "subcategory": "11:00 BVB", "person": "Dani",
        }],
        absences=[],
    )
    conflict = plan_quality.calculate_plan_quality(
        conn,
        start_date="2026-07-27",
        assignments=[{
            "date": "2026-07-27", "category": "Sportprogramm",
            "subcategory": "11:00 BVB", "person": "Dani",
        }],
        absences=[{"date": "2026-07-27", "person": "Dani", "type": "Frei"}],
    )
    missing = plan_quality.calculate_plan_quality(
        conn, start_date="2026-07-27", assignments=[], absences=[]
    )
    relief_only = plan_quality.calculate_plan_quality(
        conn,
        start_date="2026-07-27",
        assignments=[{
            "date": "2026-07-27", "category": "Barfrei",
            "subcategory": None, "person": "Manu",
        }],
        absences=[],
    )

    assert good["score"] > conflict["score"]
    assert any(issue["code"] == "absence" for issue in conflict["issues"])
    assert all(dimension["neutral"] for dimension in missing["dimensions"])
    assert all(dimension["neutral"] for dimension in relief_only["dimensions"])
    assert relief_only["analysis"]["data_basis"]["assignments"] == 0


def test_audit_records_change_undo_recommendation_and_save(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch)
    week_id = _week(conn)
    audit.record_events(
        conn,
        week_plan_id=week_id,
        start_date="2026-07-27",
        events=[
            {"event_type": "cell_changed", "cause": "manual_edit", "cell_key": "Sport|Mo", "previous_value": "", "new_value": "Dani"},
            {"event_type": "undo", "cause": "undo", "cell_key": "Sport|Mo", "previous_value": "Dani", "new_value": ""},
            {"event_type": "recommendation_applied", "cause": "recommendation", "cell_key": "Sport|Mo", "new_value": "Dani"},
        ],
    )
    audit.record_plan_saved(conn, week_plan_id=week_id, start_date="2026-07-27", assignments=1)
    conn.commit()

    events = audit.list_events(conn, week_plan_id=week_id)
    assert {event["event_type"] for event in events} == {
        "cell_changed", "undo", "recommendation_applied", "plan_saved"
    }
