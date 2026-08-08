"""AP11 - Dashboard-Endpunkte (Move-Only aus backend/api.py, unverändert).

planning_rule_list und dashboard_insights standen im Original direkt im
"Dashboard"-Abschnitt der Datei (vor dem MA-Gedächtnis-Abschnitt) bzw. tragen
den /api/dashboard/-Pfadpräfix - beide bleiben deshalb hier statt in einem
eigenen Intelligence-Topf, um die bereits bestehende Gruppierung zu erhalten.
"""
from __future__ import annotations


from fastapi import APIRouter, Depends, HTTPException

from .. import db
from .. import planning_rules
from .. import stats
from ..intelligence import dashboard as intelligence_dashboard
from .shared import clean, records

router = APIRouter()


@router.get("/api/dashboard/overview")
def dashboard_overview(conn: db.Connection = Depends(db.get_db_connection)):
    return clean(stats.overview_stats(conn))


@router.get("/api/dashboard/person-totals")
def dashboard_person_totals(conn: db.Connection = Depends(db.get_db_connection)):
    return records(stats.person_totals(conn))


@router.get("/api/dashboard/category-matrix")
def dashboard_category_matrix(conn: db.Connection = Depends(db.get_db_connection)):
    matrix = stats.person_category_matrix(conn)
    if matrix.empty:
        return {"columns": [], "rows": []}
    cols = [c for c in matrix.columns if c != "Gesamt"]
    rows = []
    for person, row in matrix.iterrows():
        rows.append({"person": person, **{c: int(row[c]) for c in cols}, "total": int(row["Gesamt"])})
    return {"columns": cols, "rows": rows}


@router.get("/api/dashboard/department-activity")
def dashboard_department_activity(conn: db.Connection = Depends(db.get_db_connection)):
    return records(stats.department_activity(conn))


@router.get("/api/dashboard/fairness-alerts")
def dashboard_fairness_alerts(week_id: int, conn: db.Connection = Depends(db.get_db_connection)):
    return stats.fairness_alerts(conn, week_id)


@router.get("/api/planning-rules")
def planning_rule_list():
    return planning_rules.active_planning_rules()


@router.get("/api/dashboard/insights")
def dashboard_insights(week_id: int, conn: db.Connection = Depends(db.get_db_connection)):
    try:
        return clean({
            **stats.week_insights(conn, week_id),
            **intelligence_dashboard.dashboard_snapshot(conn, week_id),
        })
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
