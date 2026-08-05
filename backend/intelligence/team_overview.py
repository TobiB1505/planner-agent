"""Verdichtete Intelligence-Daten für die Mitarbeiterzentrale."""
from __future__ import annotations

from datetime import date, timedelta

from .. import db, memory
from . import employee_stats, memory_engine


def _current_monday() -> str:
    today = date.today()
    return (today - timedelta(days=today.weekday())).isoformat()


def _planning_hint(statistics: dict, top_skills: list[dict]) -> dict:
    current = statistics["current_week"]
    trend = statistics["trend"]
    assignments = statistics["summary"]["assignments"]
    if current["conflicts"]:
        return {
            "tone": "warning",
            "label": "Konflikte prüfen",
            "text": f"{current['conflicts']} Konflikt(e) in der ausgewählten Woche",
        }
    if trend["direction"] == "up":
        return {
            "tone": "warning",
            "label": "Belastung steigt",
            "text": (
                f"Zuletzt {trend['recent_average']} statt "
                f"{trend['previous_average']} Einsätze pro Woche"
            ),
        }
    if top_skills:
        return {
            "tone": "positive",
            "label": "Belegte Stärken",
            "text": ", ".join(skill["name"] for skill in top_skills),
        }
    if assignments:
        return {
            "tone": "info",
            "label": "Historie vorhanden",
            "text": "Noch keine ausreichend belegte Fähigkeit erkannt",
        }
    return {
        "tone": "neutral",
        "label": "Datenbasis aufbauen",
        "text": "Noch keine historischen Einsätze vorhanden",
    }


def build_team_overview(
    conn,
    *,
    weeks: int = 12,
    current_week_start: str | None = None,
) -> dict:
    current_start = current_week_start or _current_monday()
    people = db.get_all_people(conn)
    # AP5c: Memory einmal für den gesamten Vorgang aufbauen statt - wie vorher -
    # bis zu zweimal PRO Person (einmal über calculate_employee_statistics bei
    # einem Statistik-Cache-Miss, einmal über entries_for_person, das nie
    # cached). Bei einer leeren Personenliste braucht niemand die Daten, daher
    # hier bedarfsgesteuert (keine unnötige Arbeit für den Leerfall).
    memory_data = memory.build_memory(conn) if people else None
    rows = []
    for person in people:
        statistics = employee_stats.calculate_employee_statistics(
            conn,
            person["id"],
            weeks=weeks,
            current_week_start=current_start,
            memory_data=memory_data,
        )
        memory_entries = memory_engine.entries_for_person(
            conn, person["id"], memory_data=memory_data
        )
        top_skills = [
            {
                "id": skill["id"],
                "name": skill["name"],
                "level": skill["level"],
                "source": skill["source"],
            }
            for skill in statistics["skills"][:3]
        ]
        assignments = statistics["summary"]["assignments"]
        if assignments > 0 and memory_entries:
            data_status = "ready"
        elif assignments > 0 or top_skills:
            data_status = "learning"
        else:
            data_status = "new"
        rows.append({
            "person_id": person["id"],
            "active": bool(person["active"]),
            "history_assignments": assignments,
            "weeks_available": statistics["period"]["weeks_available"],
            "current_week": statistics["current_week"],
            "trend": statistics["trend"],
            "top_skills": top_skills,
            "skill_count": len(statistics["skills"]),
            "memory_count": len(memory_entries),
            "manual_memory_count": sum(
                1 for entry in memory_entries if entry["source"] == "manual"
            ),
            "data_status": data_status,
            "planning_hint": _planning_hint(statistics, top_skills),
        })

    active_rows = [row for row in rows if row["active"]]
    return {
        "summary": {
            "active_people": len(active_rows),
            "with_history": sum(
                1 for row in active_rows if row["history_assignments"] > 0
            ),
            "with_memory": sum(1 for row in active_rows if row["memory_count"] > 0),
            "with_skills": sum(1 for row in active_rows if row["skill_count"] > 0),
            "current_week_assignments": sum(
                row["current_week"]["assignments"] for row in active_rows
            ),
            "current_week_conflicts": sum(
                row["current_week"]["conflicts"] for row in active_rows
            ),
            "attention_people": sum(
                1
                for row in active_rows
                if row["data_status"] != "ready"
                or row["planning_hint"]["tone"] == "warning"
            ),
        },
        "people": rows,
    }
