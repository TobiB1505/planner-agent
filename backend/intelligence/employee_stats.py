"""Historische Mitarbeiterstatistik und erklärbare Skill-Evidenz.

Historische Tabellen werden ausschließlich gelesen. Der Cache enthält nur ein
JSON-Ergebnis plus Daten-Fingerabdruck und wird automatisch invalidiert.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import date, timedelta

from .. import memory, planning_rules, stats

SKILL_DEFINITIONS = {
    "moderation": "Moderation",
    "sport": "Sport",
    "cooking": "Kochdienst",
    "operations": "Operative Meetings",
    "sound_light": "Sound & Light",
    "stage": "Shows & Bühne",
    "dj": "DJ",
}


def _source_version(conn) -> str:
    parts = []
    for table in ("week_plans", "assignments", "absences", "rehearsals", "rehearsal_people"):
        row = conn.execute(
            f"SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS max_id FROM {table}"
        ).fetchone()
        parts.append(f"{table}:{row['count']}:{row['max_id']}")
    return "|".join(parts)


def _is_late(category: str, subcategory: str | None) -> bool:
    normalized = stats.normalize_category(category)
    if "NITE CLUB" in normalized.upper():
        return True
    interval = planning_rules.service_interval(normalized, subcategory)
    return bool(interval and (interval[0] >= 21 * 60 or interval[1] > 24 * 60))


def _is_early(category: str, subcategory: str | None) -> bool:
    interval = planning_rules.service_interval(stats.normalize_category(category), subcategory)
    return bool(interval and interval[0] < 10 * 60)


def skill_id_for_category(category: str) -> str | None:
    normalized = stats.normalize_category(category).casefold()
    if "moderation" in normalized:
        return "moderation"
    if normalized == "sportprogramm":
        return "sport"
    if normalized == "kochdienste":
        return "cooking"
    if normalized.replace("/", "+").replace(" ", "") in {"ops+wp", "opswp"}:
        return "operations"
    if "nite club" in normalized or "mittagsgrill" in normalized:
        return "dj"
    return None


def _level_for_count(count: int) -> int:
    if count >= 14:
        return 5
    if count >= 9:
        return 4
    if count >= 5:
        return 3
    if count >= 2:
        return 2
    return 1


def _manual_skills(conn, person_id: int) -> list[dict]:
    rows = conn.execute(
        """SELECT skill_id, name, level, source, evidence_json, updated_at
           FROM employee_skills WHERE person_id = ? ORDER BY name""",
        (person_id,),
    ).fetchall()
    result = []
    for row in rows:
        try:
            evidence = json.loads(row["evidence_json"] or "[]")
        except json.JSONDecodeError:
            evidence = []
        result.append({
            "id": row["skill_id"],
            "name": row["name"],
            "level": row["level"],
            "source": row["source"],
            "evidence": evidence,
            "updated_at": row["updated_at"],
            "editable": True,
        })
    return result


def _derived_skills(person: dict, category_counts: Counter, profile_memory: dict | None) -> list[dict]:
    skill_counts: Counter[str] = Counter()
    for category, count in category_counts.items():
        skill_id = skill_id_for_category(category)
        if skill_id:
            skill_counts[skill_id] += count

    tags = planning_rules.department_tags(person.get("department"))
    if "SPT" in tags and not skill_counts["sport"]:
        skill_counts["sport"] = 0
    if "S&L" in tags and not skill_counts["sound_light"]:
        skill_counts["sound_light"] = 0
    show_appearances = sum(show.get("appearances", 0) for show in (profile_memory or {}).get("shows", []))
    if show_appearances:
        skill_counts["stage"] = show_appearances

    result = []
    for skill_id, count in skill_counts.items():
        evidence = []
        if count:
            evidence.append(f"{count} passende historische Einsätze")
        if skill_id == "sport" and "SPT" in tags:
            evidence.append("Abteilung Sportstainer")
        if skill_id == "sound_light" and "S&L" in tags:
            evidence.append("Abteilung Sound & Light")
        if skill_id == "stage" and show_appearances:
            evidence = [f"{show_appearances} Probentage mit Show-/Partybezug"]
        level = _level_for_count(count) if count else 3
        result.append({
            "id": skill_id,
            "name": SKILL_DEFINITIONS[skill_id],
            "level": level,
            "source": "historical_data" if count else "department",
            "evidence": evidence,
            "updated_at": None,
            "editable": False,
        })
    return sorted(result, key=lambda item: (-item["level"], item["name"]))


def _empty_current_week() -> dict:
    return {"assignments": 0, "shows": 0, "moderation": 0, "conflicts": 0}


def _current_week_statistics(conn, person: dict, current_week_start: str) -> dict:
    current = _empty_current_week()
    current_end = (date.fromisoformat(current_week_start) + timedelta(days=6)).isoformat()
    latest_week = conn.execute(
        "SELECT id FROM week_plans WHERE start_date = ? ORDER BY id DESC LIMIT 1",
        (current_week_start,),
    ).fetchone()
    if latest_week:
        rows = conn.execute(
            """SELECT date, category, subcategory FROM assignments
               WHERE person_id = ? AND week_plan_id = ?""",
            (person["id"], latest_week["id"]),
        ).fetchall()
        absence_rows = conn.execute(
            "SELECT date FROM absences WHERE person_id = ? AND week_plan_id = ?",
            (person["id"], latest_week["id"]),
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT date, category, subcategory FROM assignments
               WHERE person_id = ? AND date BETWEEN ? AND ?""",
            (person["id"], current_week_start, current_end),
        ).fetchall()
        absence_rows = conn.execute(
            """SELECT date FROM absences
               WHERE person_id = ? AND date BETWEEN ? AND ?""",
            (person["id"], current_week_start, current_end),
        ).fetchall()
    current["assignments"] = len(rows)
    current["moderation"] = sum(
        1 for row in rows if "Moderation" in stats.normalize_category(row["category"])
    )
    absent_dates = {row["date"] for row in absence_rows}
    current["conflicts"] += sum(1 for row in rows if row["date"] in absent_dates)
    intervals_by_date: dict[str, list[tuple[int, int]]] = {}
    for row in rows:
        interval = planning_rules.service_interval(
            stats.normalize_category(row["category"]), row["subcategory"]
        )
        if not interval:
            continue
        existing = intervals_by_date.setdefault(row["date"], [])
        if any(interval[0] < other[1] and other[0] < interval[1] for other in existing):
            current["conflicts"] += 1
        existing.append(interval)
    show_rows = conn.execute(
        """SELECT DISTINCT r.date, r.show_code, r.activity
           FROM rehearsal_people rp
           JOIN rehearsals r ON r.id = rp.rehearsal_id
           WHERE (rp.person_name = ? COLLATE NOCASE OR rp.raw_name = ? COLLATE NOCASE)
             AND r.date BETWEEN ? AND ?""",
        (person["name"], person["name"], current_week_start, current_end),
    ).fetchall()
    current["shows"] = len({
        (row["date"], show["key"])
        for row in show_rows
        if (show := memory.show_identity(row["show_code"], row["activity"])) is not None
        and show["kind"] in memory.CAST_KINDS
    })
    return current


def calculate_employee_statistics(
    conn,
    person_id: int,
    *,
    weeks: int = 12,
    current_week_start: str | None = None,
    use_cache: bool = True,
) -> dict:
    person_row = conn.execute(
        "SELECT id, name, department, active FROM people WHERE id = ? AND deleted = 0",
        (person_id,),
    ).fetchone()
    if person_row is None:
        raise ValueError("Mitarbeiter wurde nicht gefunden.")
    person = dict(person_row)
    version = f"stats:v2|{_source_version(conn)}|weeks:{weeks}"

    if use_cache:
        cached = conn.execute(
            "SELECT data_version, payload_json FROM employee_statistics WHERE person_id = ?",
            (person_id,),
        ).fetchone()
        if cached and cached["data_version"] == version:
            payload = json.loads(cached["payload_json"])
            if current_week_start:
                payload["current_week"] = _current_week_statistics(
                    conn, person, current_week_start
                )
            payload.setdefault("cache", {})["hit"] = True
            return payload

    week_rows = conn.execute(
        """SELECT wp.id, wp.start_date, wp.end_date
           FROM week_plans wp
           JOIN (
               SELECT start_date, MAX(id) AS latest_id
               FROM week_plans GROUP BY start_date
           ) latest ON latest.latest_id = wp.id
           ORDER BY wp.start_date DESC LIMIT ?""",
        (weeks,),
    ).fetchall()
    week_ids = [row["id"] for row in week_rows]
    assignments = []
    if week_ids:
        placeholders = ",".join("?" for _ in week_ids)
        assignments = conn.execute(
            f"""SELECT a.date, a.category, a.subcategory, wp.start_date
                FROM assignments a
                JOIN week_plans wp ON wp.id = a.week_plan_id
                WHERE a.person_id = ? AND a.week_plan_id IN ({placeholders})
                ORDER BY a.date""",
            (person_id, *week_ids),
        ).fetchall()

    category_counts: Counter[str] = Counter()
    per_week: Counter[str] = Counter()
    late = early = cooking = moderation = sport = 0
    weighted_load = 0.0
    for row in assignments:
        category = stats.normalize_category(row["category"])
        category_counts[category] += 1
        per_week[row["start_date"]] += 1
        is_late = _is_late(category, row["subcategory"])
        is_early = _is_early(category, row["subcategory"])
        late += int(is_late)
        early += int(is_early)
        cooking += int(category == "Kochdienste")
        moderation += int("Moderation" in category)
        sport += int(category == "Sportprogramm")
        weighted_load += 1.0 + (0.35 if is_late else 0.0) + (0.15 if category == "Kochdienste" else 0.0)

    ordered_weeks = [row["start_date"] for row in reversed(week_rows)]
    midpoint = max(1, len(ordered_weeks) // 2)
    older = sum(per_week[key] for key in ordered_weeks[:midpoint])
    recent = sum(per_week[key] for key in ordered_weeks[midpoint:])
    older_span = max(1, len(ordered_weeks[:midpoint]))
    recent_span = max(1, len(ordered_weeks[midpoint:]))
    older_avg = older / older_span
    recent_avg = recent / recent_span
    trend_delta = recent_avg - older_avg

    current = (
        _current_week_statistics(conn, person, current_week_start)
        if current_week_start
        else _empty_current_week()
    )

    profile_memory = memory.memory_for_person(conn, person_id)

    manual = _manual_skills(conn, person_id)
    manual_ids = {item["id"] for item in manual}
    skills = manual + [
        item for item in _derived_skills(person, category_counts, profile_memory)
        if item["id"] not in manual_ids
    ]
    payload = {
        "person": {
            "id": person["id"],
            "name": person["name"],
            "department": person["department"],
            "active": bool(person["active"]),
        },
        "period": {
            "weeks_requested": weeks,
            "weeks_available": len(week_rows),
            "start_date": week_rows[-1]["start_date"] if week_rows else None,
            "end_date": week_rows[0]["end_date"] if week_rows else None,
        },
        "summary": {
            "assignments": len(assignments),
            "cooking": cooking,
            "sport": sport,
            "moderation": moderation,
            "early_duties": early,
            "late_duties": late,
            "weighted_load": round(weighted_load, 2),
        },
        "current_week": current,
        "categories": [
            {"category": category, "count": count}
            for category, count in category_counts.most_common()
        ],
        "weekly_load": [
            {"start_date": key, "assignments": per_week[key]}
            for key in ordered_weeks
        ],
        "trend": {
            "recent_average": round(recent_avg, 2),
            "previous_average": round(older_avg, 2),
            "delta": round(trend_delta, 2),
            "direction": "up" if trend_delta > 0.5 else "down" if trend_delta < -0.5 else "stable",
        },
        "skills": sorted(skills, key=lambda item: (-item["level"], item["name"])),
        "cache": {"data_version": version, "hit": False},
    }
    if use_cache:
        cache_payload = {
            **payload,
            "current_week": _empty_current_week(),
            "cache": {"data_version": version, "hit": False},
        }
        conn.execute(
            """INSERT INTO employee_statistics(person_id, data_version, payload_json)
               VALUES (?, ?, ?)
               ON CONFLICT(person_id) DO UPDATE SET
                   data_version = excluded.data_version,
                   payload_json = excluded.payload_json,
                   calculated_at = CURRENT_TIMESTAMP""",
            (person_id, version, json.dumps(cache_payload, ensure_ascii=False)),
        )
        conn.commit()
    return payload


def upsert_skill(
    conn,
    person_id: int,
    skill_id: str,
    name: str,
    level: int,
    evidence: list[str] | None = None,
) -> dict:
    if not 1 <= level <= 5:
        raise ValueError("Skill-Level muss zwischen 1 und 5 liegen.")
    conn.execute(
        """INSERT INTO employee_skills(person_id, skill_id, name, level, source, evidence_json)
           VALUES (?, ?, ?, ?, 'manual', ?)
           ON CONFLICT(person_id, skill_id) DO UPDATE SET
               name = excluded.name,
               level = excluded.level,
               source = 'manual',
               evidence_json = excluded.evidence_json,
               updated_at = CURRENT_TIMESTAMP""",
        (person_id, skill_id.strip(), name.strip(), level, json.dumps(evidence or [], ensure_ascii=False)),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = ?", (person_id,))
    conn.commit()
    return calculate_employee_statistics(conn, person_id, use_cache=False)


def delete_skill(conn, person_id: int, skill_id: str) -> None:
    conn.execute(
        "DELETE FROM employee_skills WHERE person_id = ? AND skill_id = ?",
        (person_id, skill_id),
    )
    conn.execute("DELETE FROM employee_statistics WHERE person_id = ?", (person_id,))
    conn.commit()
