"""AP11 - Planner-Intelligence-Endpunkte (Move-Only aus backend/api.py, unverändert)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from .. import grid
from .. import memory
from .. import stats
from ..intelligence import audit as intelligence_audit
from ..intelligence import employee_stats, memory_engine, plan_quality, recommendation_engine, team_overview
from .shared import _grid_df_from_rows, _week_dates, clean

router = APIRouter()


class EmployeeSkillUpdate(BaseModel):
    id: str
    name: str
    level: int
    evidence: list[str] = []


class EmployeeMemoryUpdate(BaseModel):
    type: str
    subject: str
    value: Any
    confidence: float = 1.0
    note: Optional[str] = None
    source_date: Optional[str] = None


class IntelligencePlanRequest(BaseModel):
    start_date: str
    day_labels: list[str]
    rows: list[dict[str, Any]]


class IntelligenceRecommendationRequest(IntelligencePlanRequest):
    day_label: str
    category: str
    subcategory: Optional[str] = None


def _intelligence_plan_data(payload: IntelligencePlanRequest) -> tuple[list[dict], list[dict], dict[str, str]]:
    dates = _week_dates(payload.start_date)
    day_iso_by_label = {label: iso for label, iso in zip(payload.day_labels, dates)}
    assignments_list, absences_list = grid.parse_grid(
        _grid_df_from_rows(payload.rows),
        day_iso_by_label,
    )
    return assignments_list, absences_list, day_iso_by_label


@router.get("/api/intelligence/employees")
def intelligence_employee_overview(
    weeks: int = 12,
    current_week_start: Optional[str] = None,
    conn: db.Connection = Depends(db.get_db_connection),
):
    return clean(team_overview.build_team_overview(
        conn,
        weeks=max(1, min(52, weeks)),
        current_week_start=current_week_start,
    ))


@router.get("/api/intelligence/employees/{person_id}")
def intelligence_employee_profile(
    person_id: int,
    weeks: int = 12,
    current_week_start: Optional[str] = None,
    conn: db.Connection = Depends(db.get_db_connection),
):
    try:
        # AP5b: einmal berechnen und an beide Funktionen weiterreichen - entries_for_person
        # benötigt Memory in jedem Fall, calculate_employee_statistics nur bei einem
        # Statistik-Cache-Miss (dort sonst ungenutzt, kein zusätzlicher Aufwand).
        memory_data = memory.build_memory(conn)
        statistics = employee_stats.calculate_employee_statistics(
            conn,
            person_id,
            weeks=max(1, min(52, weeks)),
            current_week_start=current_week_start,
            memory_data=memory_data,
        )
        structured_memory = memory_engine.entries_for_person(conn, person_id, memory_data=memory_data)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    top_skills = statistics["skills"][:3]
    planning_notes = []
    if top_skills:
        planning_notes.append({
            "code": "strong_skills",
            "label": "Belegte Stärken",
            "text": ", ".join(skill["name"] for skill in top_skills),
            "evidence": [evidence for skill in top_skills for evidence in skill["evidence"][:1]],
        })
    if statistics["trend"]["direction"] == "up":
        planning_notes.append({
            "code": "rising_load",
            "label": "Belastung steigt",
            "text": "Die durchschnittlichen Einsätze liegen zuletzt über dem vorherigen Zeitraum.",
            "evidence": [
                f"zuletzt {statistics['trend']['recent_average']} statt {statistics['trend']['previous_average']} Einsätze/Woche"
            ],
        })
    return clean({
        **statistics,
        "memory": structured_memory,
        "planning_recommendations": planning_notes,
    })


@router.put("/api/intelligence/employees/{person_id}/skills")
def intelligence_employee_skill_set(
    person_id: int,
    payload: EmployeeSkillUpdate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    try:
        return clean(employee_stats.upsert_skill(
            conn, person_id, payload.id, payload.name, payload.level, payload.evidence
        ))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/api/intelligence/employees/{person_id}/skills/{skill_id}")
def intelligence_employee_skill_delete(
    person_id: int,
    skill_id: str,
    conn: db.Connection = Depends(db.get_db_connection),
):
    employee_stats.delete_skill(conn, person_id, skill_id)
    return {"ok": True}


@router.post("/api/intelligence/employees/{person_id}/memory")
def intelligence_employee_memory_set(
    person_id: int,
    payload: EmployeeMemoryUpdate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    try:
        return clean(memory_engine.upsert_manual_entry(
            conn,
            person_id,
            entry_type=payload.type,
            subject=payload.subject,
            value=payload.value,
            confidence=payload.confidence,
            note=payload.note,
            source_date=payload.source_date,
        ))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/api/intelligence/employees/{person_id}/memory/{entry_id}")
def intelligence_employee_memory_delete(
    person_id: int,
    entry_id: int,
    conn: db.Connection = Depends(db.get_db_connection),
):
    return clean(memory_engine.delete_manual_entry(conn, person_id, entry_id))


@router.post("/api/intelligence/recommendations")
def intelligence_recommendations(
    payload: IntelligenceRecommendationRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
    assignments_list, absences_list, day_map = _intelligence_plan_data(payload)
    target_date = day_map.get(payload.day_label)
    if not target_date:
        raise HTTPException(400, "Der gewählte Wochentag ist ungültig.")
    target_category = stats.normalize_category(payload.category)
    assignments_without_target = [
        assignment for assignment in assignments_list
        if not (
            assignment.get("date") == target_date
            and stats.normalize_category(assignment.get("category") or "") == target_category
            and (assignment.get("subcategory") or "") == (payload.subcategory or "")
        )
    ]
    # Wird die Urlaub/Krank- oder Frei-Zeile selbst bearbeitet, darf die bereits
    # dort eingetragene Abwesenheit nicht gegen die eigenen Namen als Warngrund
    # zurückkommen - sonst zeigt der Editor unsinnig "hat Urlaub" fuer MA, die
    # gerade als Urlaub/Frei eingetragen werden sollen.
    absences_without_target = [
        absence for absence in absences_list
        if not (absence.get("date") == target_date and absence.get("type") == payload.category)
    ]
    return clean(recommendation_engine.recommend(
        conn,
        target_date=target_date,
        category=payload.category,
        subcategory=payload.subcategory,
        assignments=assignments_without_target,
        absences=absences_without_target,
    ))


@router.post("/api/intelligence/plan-quality")
def intelligence_plan_quality(
    payload: IntelligencePlanRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
    assignments_list, absences_list, _ = _intelligence_plan_data(payload)
    return clean(plan_quality.calculate_plan_quality(
        conn,
        start_date=payload.start_date,
        assignments=assignments_list,
        absences=absences_list,
    ))


@router.get("/api/intelligence/audit")
def intelligence_audit_log(
    week_plan_id: Optional[int] = None,
    start_date: Optional[str] = None,
    limit: int = 100,
    conn: db.Connection = Depends(db.get_db_connection),
):
    if week_plan_id is None and start_date is None:
        raise HTTPException(400, "week_plan_id oder start_date wird benötigt.")
    return clean(intelligence_audit.list_events(
        conn,
        week_plan_id=week_plan_id,
        start_date=start_date,
        limit=max(1, min(500, limit)),
    ))
