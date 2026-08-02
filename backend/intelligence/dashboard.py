"""Verdichtete Intelligence-Kennzahlen für die operative Dashboard-Ansicht."""
from __future__ import annotations

from .. import db, memory
from . import audit, plan_quality


def dashboard_snapshot(conn, week_plan_id: int) -> dict:
    week = conn.execute(
        "SELECT id, start_date FROM week_plans WHERE id = ?",
        (week_plan_id,),
    ).fetchone()
    if week is None:
        raise ValueError("Dienstplan-Woche wurde nicht gefunden.")

    assignments = [
        dict(row)
        for row in conn.execute(
            """SELECT a.date, a.category, a.subcategory, p.name AS person
               FROM assignments a
               LEFT JOIN people p ON p.id = a.person_id
               WHERE a.week_plan_id = ?
               ORDER BY a.date, a.id""",
            (week_plan_id,),
        ).fetchall()
    ]
    absences = [
        {
            "date": row["date"],
            "person": row["person"],
            "type": row["typ"],
        }
        for row in conn.execute(
            """SELECT ab.date, ab.typ, p.name AS person
               FROM absences ab
               JOIN people p ON p.id = ab.person_id
               WHERE ab.week_plan_id = ?
               ORDER BY ab.date, ab.id""",
            (week_plan_id,),
        ).fetchall()
    ]
    quality = plan_quality.calculate_plan_quality(
        conn,
        start_date=week["start_date"],
        assignments=assignments,
        absences=absences,
    )

    active_people = [dict(row) for row in db.get_all_people(conn, active_only=True)]
    active_ids = {person["id"] for person in active_people}
    memory_data = memory.build_memory(conn)
    active_memory = [
        person for person in memory_data["people"]
        if person["person_id"] in active_ids
    ]
    evidence_profiles = sum(
        1 for person in active_memory
        if person["data_quality"]["assignments"] > 0
    )
    memory_profiles = sum(
        1 for person in active_memory
        if person["shows"]
        or person["tasks"]
        or person["free"].get("total_free_days", 0) > 0
    )
    cold_start_people = [
        person["person"] for person in active_memory
        if person["data_quality"]["cold_start"]
    ]
    manual_skills = conn.execute(
        """SELECT COUNT(*) AS count FROM employee_skills es
           JOIN people p ON p.id = es.person_id
           WHERE p.active = 1 AND p.deleted = 0 AND es.source = 'manual'"""
    ).fetchone()["count"]
    manual_memory_entries = conn.execute(
        """SELECT COUNT(*) AS count FROM employee_memory em
           JOIN people p ON p.id = em.person_id
           WHERE p.active = 1 AND p.deleted = 0 AND em.source = 'manual'"""
    ).fetchone()["count"]

    return {
        "quality": quality,
        "intelligence": {
            "active_people": len(active_people),
            "evidence_profiles": evidence_profiles,
            "memory_profiles": memory_profiles,
            "manual_skills": manual_skills,
            "manual_memory_entries": manual_memory_entries,
            "historical_weeks": memory_data["meta"]["duty_weeks"],
            "rehearsal_weeks": memory_data["meta"]["rehearsal_weeks"],
            "cold_start_people": cold_start_people,
            "recent_audit": audit.list_events(
                conn, week_plan_id=week_plan_id, limit=6
            ),
        },
    }
