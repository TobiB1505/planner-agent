"""Erklärbare Mitarbeiterempfehlungen aus Regeln, Historie und aktuellem Plan."""
from __future__ import annotations

from collections import Counter
from statistics import median

from .. import db, memory, planning_rules, stats
from .employee_stats import skill_id_for_category

REASON_WEIGHTS = {
    "availability": 18,
    "conflict_free": 18,
    "skill_match": 17,
    "experience": 14,
    "low_workload": 12,
    "fairness": 11,
    "preference": 10,
    "previous_success": 0,  # erst nutzbar, sobald Ergebnis-/Feedbackdaten existieren
}


def _reason(code: str, label: str, evidence: str) -> dict:
    return {
        "code": code,
        "label": label,
        "weight": REASON_WEIGHTS[code],
        "evidence": evidence,
    }


def _overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    variants_first = (first, (first[0] + 1440, first[1] + 1440))
    variants_second = (second, (second[0] + 1440, second[1] + 1440))
    return any(a_start < b_end and b_start < a_end for a_start, a_end in variants_first for b_start, b_end in variants_second)


def _stored_interval(start: str, end: str) -> tuple[int, int]:
    def minutes(value: str) -> int:
        hour, minute = value.replace(".", ":").split(":")[:2]
        return int(hour) * 60 + int(minute)
    start_minute = minutes(start)
    end_minute = minutes(end)
    if end_minute <= start_minute:
        end_minute += 1440
    return start_minute, end_minute


def _task_preferences(
    conn,
    *,
    memory_data: memory.MemoryData | None = None,
) -> dict[str, set[str]]:
    """AP5b: nutzt bereits berechnetes Memory, wenn übergeben, statt erneut
    build_memory() aufzurufen. `memory_data=None` (Standard) entspricht exakt dem
    bisherigen Verhalten."""
    result: dict[str, set[str]] = {}
    built = memory_data if memory_data is not None else memory.build_memory(conn)
    for person in built["people"]:
        preferred = {
            task["category"]
            for task in person.get("tasks", [])
            if float(task.get("affinity") or 0) > 0.15
            or task.get("state") in {"added", "confirmed"}
        }
        result[person["person"]] = preferred
    manual_rows = conn.execute(
        """SELECT p.name, em.subject, em.value
           FROM employee_memory em JOIN people p ON p.id = em.person_id
           WHERE em.type = 'preference' AND em.subject LIKE 'task:%'"""
    ).fetchall()
    for row in manual_rows:
        if "preferred" in (row["value"] or ""):
            result.setdefault(row["name"], set()).add(row["subject"].split(":", 1)[1])
    return result


def recommend(
    conn,
    *,
    target_date: str,
    category: str,
    subcategory: str | None,
    assignments: list[dict],
    absences: list[dict],
) -> dict:
    people = [dict(row) for row in db.get_all_people(conn, active_only=True)]
    names = [person["name"] for person in people]
    normalized_category = stats.normalize_category(category)
    target_interval = planning_rules.service_interval(normalized_category, subcategory)

    weekly_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()
    day_intervals: dict[str, list[tuple[tuple[int, int], str]]] = {name: [] for name in names}
    for assignment in assignments:
        name = (assignment.get("person") or "").strip()
        if name not in day_intervals:
            continue
        weekly_counts[name] += 1
        if stats.normalize_category(assignment.get("category") or "") == normalized_category:
            category_counts[name] += 1
        if assignment.get("date") == target_date:
            interval = planning_rules.service_interval(
                stats.normalize_category(assignment.get("category") or ""),
                assignment.get("subcategory"),
            )
            if interval:
                day_intervals[name].append((interval, assignment.get("category") or "Dienst"))

    absent = {
        (item.get("person") or "").strip(): item.get("type") or "abwesend"
        for item in absences
        if item.get("date") == target_date
    }
    history_rows = conn.execute(
        """SELECT p.name, COUNT(*) AS count
           FROM assignments a JOIN people p ON p.id = a.person_id
           WHERE a.category IN (?, ?) GROUP BY p.id""",
        (category, normalized_category),
    ).fetchall()
    history = {row["name"]: int(row["count"]) for row in history_rows}
    historical_average = sum(history.values()) / max(1, len(people))
    weekly_median = median([weekly_counts[name] for name in names]) if names else 0
    preferences = _task_preferences(conn)
    target_skill = skill_id_for_category(normalized_category)
    manual_skills = {
        row["name"]: {skill["skill_id"] for skill in conn.execute(
            """SELECT skill_id FROM employee_skills es
               JOIN people p ON p.id = es.person_id WHERE p.name = ?""",
            (row["name"],),
        ).fetchall()}
        for row in people
    }

    rehearsal_rows = conn.execute(
        """SELECT COALESCE(rp.person_name, rp.raw_name) AS person,
                  rp.start_time, rp.end_time, r.activity
           FROM rehearsal_people rp JOIN rehearsals r ON r.id = rp.rehearsal_id
           WHERE r.date = ?""",
        (target_date,),
    ).fetchall()
    rehearsal_by_person: dict[str, list] = {}
    for row in rehearsal_rows:
        rehearsal_by_person.setdefault((row["person"] or "").casefold(), []).append(row)

    candidates = []
    for person in people:
        name = person["name"]
        reasons = []
        warnings = []
        hard_blocked = False
        if name in absent:
            hard_blocked = True
            warnings.append({"code": "absence", "label": f"{absent[name]} an diesem Tag"})
        else:
            reasons.append(_reason("availability", "Verfügbar", "Kein Frei- oder Urlaubseintrag an diesem Tag"))

        if target_interval:
            conflicts = [label for interval, label in day_intervals[name] if _overlap(target_interval, interval)]
            rehearsal_conflicts = [
                row for row in rehearsal_by_person.get(name.casefold(), [])
                if _overlap(target_interval, _stored_interval(row["start_time"], row["end_time"]))
            ]
            if conflicts:
                hard_blocked = True
                warnings.append({"code": "time_conflict", "label": f"Zeitüberschneidung mit {', '.join(conflicts[:2])}"})
            if rehearsal_conflicts:
                hard_blocked = True
                warnings.append({"code": "rehearsal_overlap", "label": f"Probe: {rehearsal_conflicts[0]['activity']}"})
            if not conflicts and not rehearsal_conflicts:
                reasons.append(_reason("conflict_free", "Keine Zeitüberschneidung", "Keine parallele Zuweisung oder Probe"))

        decision = planning_rules.person_decision(
            name,
            person.get("department"),
            normalized_category,
            subcategory,
            automatic=True,
        )
        if not decision["allowed"]:
            hard_blocked = True
            warnings.append({"code": "rule_blocked", "label": decision["message"]})
        if decision["recommended"]:
            reasons.append(_reason(
                "skill_match",
                "Passende Fachzuordnung",
                decision["message"] or f"Abteilung {person.get('department') or 'nicht hinterlegt'} passt zur Aufgabe",
            ))
        elif decision["message"]:
            warnings.append({"code": "department_preference", "label": decision["message"]})

        if target_skill and target_skill in manual_skills.get(name, set()):
            reasons.append(_reason("skill_match", "Manuell bestätigter Skill", f"Skill {target_skill} ist im Mitarbeiterprofil hinterlegt"))
        experience = history.get(name, 0)
        if experience:
            reasons.append(_reason("experience", "Erfahrung mit dieser Aufgabe", f"{experience} historische Einsätze in {normalized_category}"))
        if weekly_counts[name] <= weekly_median:
            reasons.append(_reason("low_workload", "Niedrige Wochenbelastung", f"{weekly_counts[name]} Einsätze, Team-Median {weekly_median:g}"))
        if category_counts[name] <= historical_average:
            reasons.append(_reason("fairness", "Faire Verteilung", f"Aktuell {category_counts[name]}× in dieser Aufgabe"))
        if normalized_category in preferences.get(name, set()):
            reasons.append(_reason("preference", "Historisch passende Aufgabe", "Positives Aufgabenmuster im MA-Gedächtnis"))

        # Doppelte Reason Codes vermeiden; die konkreteste Evidenz gewinnt.
        unique_reasons = []
        seen = set()
        for reason in reasons:
            if reason["code"] in seen:
                continue
            seen.add(reason["code"])
            unique_reasons.append(reason)
        score = sum(reason["weight"] for reason in unique_reasons)
        score -= 12 * len(warnings)
        if hard_blocked:
            score -= 100
        candidates.append({
            "employee_id": person["id"],
            "employee": name,
            "department": person.get("department"),
            "score": score,
            "status": "unavailable" if hard_blocked else "warning" if warnings else "available",
            "reasons": unique_reasons,
            "warnings": warnings,
        })

    candidates.sort(key=lambda item: (-item["score"], item["employee"].casefold()))
    recommended_seen = 0
    for index, candidate in enumerate(candidates, start=1):
        candidate["rank"] = index
        if candidate["status"] == "available" and recommended_seen < 4:
            candidate["status"] = "recommended"
            recommended_seen += 1
    return {
        "target": {"date": target_date, "category": normalized_category, "subcategory": subcategory},
        "candidates": candidates,
        "reason_weights": REASON_WEIGHTS,
        "data_basis": {
            "historical_assignments": sum(history.values()),
            "active_people": len(people),
            "uses_rehearsals": bool(rehearsal_rows),
        },
    }
