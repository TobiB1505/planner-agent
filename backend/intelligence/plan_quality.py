"""Transparente Qualitätsbewertung eines Dienstplans ohne Blackbox-Score."""
from __future__ import annotations

from collections import Counter, defaultdict
from statistics import pstdev

from .. import db, memory, planning_rules, stats
from .employee_stats import skill_id_for_category

QUALITY_WEIGHTS = {
    "conflicts": 30,
    "fairness": 25,
    "skill_matching": 20,
    "preferences": 15,
    "historical_quality": 10,
}


def _overlap(first: tuple[int, int], second: tuple[int, int]) -> bool:
    return first[0] < second[1] and second[0] < first[1]


def _dimension(key: str, label: str, ratio: float, explanations: list[str], *, neutral: bool = False) -> dict:
    maximum = QUALITY_WEIGHTS[key]
    score = round(maximum * max(0.0, min(1.0, ratio)))
    status = "good" if ratio >= 0.8 else "warning" if ratio >= 0.55 else "critical"
    if neutral:
        status = "neutral"
    return {
        "key": key,
        "label": label,
        "score": score,
        "max_score": maximum,
        "status": status,
        "neutral": neutral,
        "explanations": explanations,
    }


def _preference_lookup(
    conn,
    *,
    memory_data: memory.MemoryData | None = None,
) -> dict[str, set[str]]:
    """AP5b: nutzt bereits berechnetes Memory, wenn übergeben, statt erneut
    build_memory() aufzurufen. `memory_data=None` (Standard) entspricht exakt dem
    bisherigen Verhalten."""
    resolved = memory_data if memory_data is not None else memory.build_memory(conn)
    result: dict[str, set[str]] = defaultdict(set)
    for person in resolved["people"]:
        for task in person.get("tasks", []):
            if float(task.get("affinity") or 0) > 0.15 or task.get("state") in {"added", "confirmed"}:
                result[person["person"]].add(task["category"])
    return result


def calculate_plan_quality(
    conn,
    *,
    start_date: str,
    assignments: list[dict],
    absences: list[dict],
    memory_data: memory.MemoryData | None = None,
) -> dict:
    people_rows = [dict(row) for row in db.get_all_people(conn, active_only=True)]
    people_by_name = {row["name"]: row for row in people_rows}
    # Ausschlafen und Barfrei sind Entlastungen, keine Arbeitsdienste. Sie dürfen
    # deshalb weder Belastung, Skill-Matching noch historische Plausibilität
    # künstlich verändern (insbesondere nicht bei den 8h-Vertrags-Ausnahmen).
    work_assignments = [
        assignment
        for assignment in assignments
        if not planning_rules.is_relief_reward(
            stats.normalize_category(assignment.get("category") or "")
        )
    ]
    absence_lookup = {
        (row.get("date"), (row.get("person") or "").strip()): row.get("type") or "abwesend"
        for row in absences
    }
    issues: list[dict] = []
    counts: Counter[str] = Counter()
    category_counts: Counter[tuple[str, str]] = Counter()
    timed: dict[tuple[str, str], list[tuple[tuple[int, int], str]]] = defaultdict(list)
    skill_matches = skill_total = 0
    decisions = []
    manual_skill_rows = conn.execute(
        """SELECT p.name, es.skill_id FROM employee_skills es
           JOIN people p ON p.id = es.person_id"""
    ).fetchall()
    manual_skills: dict[str, set[str]] = defaultdict(set)
    for row in manual_skill_rows:
        manual_skills[row["name"]].add(row["skill_id"])

    for assignment in work_assignments:
        name = (assignment.get("person") or "").strip()
        if not name or name not in people_by_name:
            continue
        category = stats.normalize_category(assignment.get("category") or "")
        subcategory = assignment.get("subcategory")
        date_iso = assignment.get("date")
        counts[name] += 1
        category_counts[(name, category)] += 1
        if (date_iso, name) in absence_lookup:
            issues.append({
                "severity": "conflict",
                "code": "absence",
                "message": f"{name} ist am {date_iso} als {absence_lookup[(date_iso, name)]} eingetragen.",
            })
        interval = planning_rules.service_interval(category, subcategory)
        if interval:
            for existing, label in timed[(date_iso, name)]:
                if _overlap(interval, existing):
                    issues.append({
                        "severity": "conflict",
                        "code": "time_overlap",
                        "message": f"{name} hat am {date_iso} eine Überschneidung mit {label}.",
                    })
            timed[(date_iso, name)].append((interval, category))

        decision = planning_rules.person_decision(
            name,
            people_by_name[name].get("department"),
            category,
            subcategory,
            automatic=False,
        )
        target_skill = skill_id_for_category(category)
        has_manual_skill = bool(target_skill and target_skill in manual_skills[name])
        if not decision["allowed"]:
            issues.append({"severity": "conflict", "code": "hard_rule", "message": decision["message"]})
        skill_total += 1
        if decision["recommended"] or has_manual_skill:
            skill_matches += 1
        evidence = []
        if decision["recommended"]:
            evidence.append(decision["message"] or "Fachzuordnung passt")
        if has_manual_skill:
            evidence.append("Manuell bestätigter Skill")
        if evidence and len(decisions) < 30:
            decisions.append({
                "employee": name,
                "date": date_iso,
                "category": category,
                "subcategory": subcategory,
                "reasons": evidence,
            })

    required_groups: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    for assignment in work_assignments:
        key = (assignment.get("date"), stats.normalize_category(assignment.get("category") or ""), assignment.get("subcategory") or "")
        name = (assignment.get("person") or "").strip()
        if name:
            required_groups[key].add(name)
    for (date_iso, category, subcategory), assigned in required_groups.items():
        required = planning_rules.required_people(category, subcategory, date_iso)
        if len(assigned) < required:
            issues.append({
                "severity": "conflict",
                "code": "minimum_staff",
                "message": f"{category} {subcategory} am {date_iso}: {len(assigned)} von {required} MA eingetragen.",
            })

    conflict_count = len([item for item in issues if item["severity"] == "conflict"])
    if work_assignments:
        conflict_ratio = max(0.0, 1.0 - conflict_count * 0.2)
        conflict_explanations = [
            "Keine harten Konflikte erkannt" if conflict_count == 0 else f"{conflict_count} harte Konflikte erkannt"
        ]
        conflict_dimension = _dimension("conflicts", "Konflikte", conflict_ratio, conflict_explanations)
    else:
        conflict_dimension = _dimension("conflicts", "Konflikte", 0.5, ["Noch keine Zuweisungen für eine belastbare Prüfung"], neutral=True)

    active_counts = [counts[row["name"]] for row in people_rows]
    if work_assignments and len(active_counts) >= 2 and sum(active_counts) > 0:
        mean = sum(active_counts) / len(active_counts)
        variation = pstdev(active_counts) / mean if mean else 1.0
        fairness_ratio = max(0.0, 1.0 - min(1.0, variation))
        highest = max(counts, key=counts.get) if counts else None
        fairness_dimension = _dimension(
            "fairness",
            "Faire Belastung",
            fairness_ratio,
            [
                f"Team-Mittel {mean:.1f} Einsätze",
                f"Höchste Belastung: {highest} mit {counts[highest]} Einsätzen" if highest else "Keine Belastungsspitze",
            ],
        )
    else:
        fairness_dimension = _dimension("fairness", "Faire Belastung", 0.5, ["Zu wenige Zuweisungen für einen Teamvergleich"], neutral=True)

    skill_dimension = _dimension(
        "skill_matching",
        "Skill-Verteilung",
        skill_matches / skill_total if skill_total else 0.5,
        [f"{skill_matches} von {skill_total} Zuweisungen passen zu belegten Skills oder Fachzuordnungen"] if skill_total else ["Keine bewertbaren Personenzuweisungen"],
        neutral=skill_total == 0,
    )

    preferences = _preference_lookup(conn, memory_data=memory_data)
    preference_total = preference_matches = 0
    for assignment in work_assignments:
        name = (assignment.get("person") or "").strip()
        category = stats.normalize_category(assignment.get("category") or "")
        if preferences.get(name):
            preference_total += 1
            preference_matches += int(category in preferences[name])
    preference_dimension = _dimension(
        "preferences",
        "Präferenzen",
        preference_matches / preference_total if preference_total else 0.5,
        [f"{preference_matches} von {preference_total} bewertbaren Zuweisungen passen zum Aufgabenprofil"] if preference_total else ["Keine ausreichend sicheren Präferenzdaten – neutral bewertet"],
        neutral=preference_total == 0,
    )

    history_weeks = conn.execute("SELECT COUNT(*) AS count FROM week_plans").fetchone()["count"]
    historical_rows = conn.execute(
        """SELECT p.name, a.category, COUNT(*) AS count
           FROM assignments a JOIN people p ON p.id = a.person_id
           GROUP BY p.id, a.category"""
    ).fetchall()
    historical_pairs = {
        (row["name"], stats.normalize_category(row["category"]))
        for row in historical_rows if row["count"] > 0
    }
    history_total = history_matches = 0
    if history_weeks >= 4:
        for assignment in work_assignments:
            name = (assignment.get("person") or "").strip()
            if name:
                history_total += 1
                history_matches += int((name, stats.normalize_category(assignment.get("category") or "")) in historical_pairs)
    historical_dimension = _dimension(
        "historical_quality",
        "Historische Plausibilität",
        history_matches / history_total if history_total else 0.5,
        [f"{history_matches} von {history_total} Zuweisungen haben belegte Vorerfahrung"] if history_total else [f"{history_weeks} historische Wochen – für diese Bewertung neutral behandelt"],
        neutral=history_total == 0,
    )

    dimensions = [
        conflict_dimension,
        fairness_dimension,
        skill_dimension,
        preference_dimension,
        historical_dimension,
    ]
    total = sum(item["score"] for item in dimensions)
    return {
        "score": total,
        "max_score": 100,
        "status": "good" if total >= 80 else "warning" if total >= 60 else "critical",
        "dimensions": dimensions,
        "issues": issues,
        "weights": QUALITY_WEIGHTS,
        "analysis": {
            "title": f"Plananalyse ab {start_date}",
            "optimization_goals": [
                {"key": key, "label": next(item["label"] for item in dimensions if item["key"] == key), "weight": weight}
                for key, weight in QUALITY_WEIGHTS.items()
            ],
            "decisions": decisions,
            "data_basis": {
                "assignments": len(work_assignments),
                "active_people": len(people_rows),
                "historical_weeks": history_weeks,
            },
        },
    }
