"""FastAPI-Backend - wrappt die bestehende Python-Logik (db/stats/assignment/xlsx_template/
extraction/template_spec) als REST-API für das neue Next.js-Frontend."""
from __future__ import annotations

import io
import json
import logging
import math
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from . import assignment
from . import artist_plan
from .config import paths as config_paths
from . import db
from . import grid
from . import memory
from . import plan_templates
from . import planning_rules
from . import rehearsal_plan
from . import stats
from . import template_spec
from . import util
from . import xlsx_template
from .extraction import extract_dienstplan

load_dotenv()

logger = logging.getLogger(__name__)
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Planner-Agent API")
_PROCESS_STARTED_AT = time.monotonic()
KNOWN_DEPARTMENT_TOKENS = {
    "S&L", "SPT", "NM", "KÜCHE", "COCINA", "TC", "DEKO", "LIVE-ENT",
    "SPORTSTAINER", "MANAGER", "REQUI", "WASPO", "FO", "WFA", "SPA",
}
def _cors_origins() -> list[str]:
    """Liest erlaubte lokale Origins aus CORS_ORIGINS (kommasepariert).

    Fällt ohne Einstellung auf die beiden lokalen Next.js-Dev-Adressen
    zurück - die Browser-Anfragen laufen im Normalbetrieb ohnehin same-origin
    über den next.config.ts-Rewrite, CORS greift nur bei direkter
    Backend-Ansprache während der lokalen Entwicklung.
    """
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return origins or ["http://localhost:3000", "http://127.0.0.1:3000"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    return db.get_conn()


def clean(obj):
    """NaN/NaT-sicher für JSON (pandas erzeugt NaN, das ist kein gültiges JSON)."""
    if isinstance(obj, float) and math.isnan(obj):
        return None
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean(v) for v in obj]
    return obj


def records(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    return clean(df.to_dict(orient="records"))


# ---------- Team ----------

class PersonIn(BaseModel):
    name: str
    department: Optional[str] = None


class PersonUpdate(BaseModel):
    name: str
    department: Optional[str] = None
    active: bool


@app.get("/api/team")
def get_team():
    conn = get_conn()
    people = db.get_all_people(conn)
    totals = stats.person_totals(conn)
    total_lookup = dict(zip(totals["person"], totals["total"])) if not totals.empty else {}
    return [
        {
            "id": p["id"], "name": p["name"], "department": p["department"],
            "active": bool(p["active"]), "total_assignments": int(total_lookup.get(p["name"], 0)),
        }
        for p in people
    ]


@app.post("/api/team")
def create_person(payload: PersonIn):
    conn = get_conn()
    person_id = db.create_person(conn, payload.name.strip(), (payload.department or "").strip() or None)
    return {"id": person_id}


@app.put("/api/team/{person_id}")
def update_person(person_id: int, payload: PersonUpdate):
    conn = get_conn()
    db.update_person(conn, person_id, payload.name.strip(), (payload.department or "").strip() or None, payload.active)
    return {"ok": True}


@app.delete("/api/team/{person_id}")
def delete_person(person_id: int):
    conn = get_conn()
    db.delete_person(conn, person_id)
    return {"ok": True}


@app.get("/api/people/active")
def people_active():
    conn = get_conn()
    return [p["name"] for p in db.get_all_people(conn, active_only=True)]


# ---------- Weeks / Archiv ----------

@app.get("/api/weeks")
def get_weeks():
    conn = get_conn()
    weeks = db.get_week_plans(conn)
    result = []
    for w in weeks:
        kw = w["kw"]
        if kw is None and w["start_date"]:
            kw = datetime.strptime(w["start_date"], "%Y-%m-%d").date().isocalendar()[1]
        result.append({
            "id": w["id"], "kw": kw, "start_date": w["start_date"], "end_date": w["end_date"],
            "source": w["source_pdf"], "label": f"KW{kw} · {util.fmt_date_range(w['start_date'], w['end_date'])}",
            "assignment_count": w["assignment_count"],
            "absence_count": w["absence_count"],
        })
    return result


@app.get("/api/weeks/{week_id}")
def get_week_detail(week_id: int):
    conn = get_conn()
    assignments = [dict(a) for a in db.get_assignments_for_week(conn, week_id)]
    absences = [dict(a) for a in db.get_absences_for_week(conn, week_id)]
    return {"assignments": clean(assignments), "absences": clean(absences)}


@app.delete("/api/weeks/{week_id}")
def delete_week(week_id: int):
    conn = get_conn()
    db.delete_week_plan(conn, week_id)
    return {"ok": True}


# ---------- Dashboard ----------

@app.get("/api/dashboard/overview")
def dashboard_overview():
    conn = get_conn()
    return clean(stats.overview_stats(conn))


@app.get("/api/dashboard/person-totals")
def dashboard_person_totals():
    conn = get_conn()
    return records(stats.person_totals(conn))


@app.get("/api/dashboard/category-matrix")
def dashboard_category_matrix():
    conn = get_conn()
    matrix = stats.person_category_matrix(conn)
    if matrix.empty:
        return {"columns": [], "rows": []}
    cols = [c for c in matrix.columns if c != "Gesamt"]
    rows = []
    for person, row in matrix.iterrows():
        rows.append({"person": person, **{c: int(row[c]) for c in cols}, "total": int(row["Gesamt"])})
    return {"columns": cols, "rows": rows}


@app.get("/api/dashboard/department-activity")
def dashboard_department_activity():
    conn = get_conn()
    return records(stats.department_activity(conn))


@app.get("/api/dashboard/fairness-alerts")
def dashboard_fairness_alerts(week_id: int):
    conn = get_conn()
    return stats.fairness_alerts(conn, week_id)


@app.get("/api/planning-rules")
def planning_rule_list():
    return planning_rules.active_planning_rules()


# ---------- MA-Gedächtnis ----------

@app.get("/api/memory")
def memory_overview():
    return clean(memory.build_memory(get_conn()))


@app.get("/api/memory/{person_id}")
def memory_person(person_id: int):
    entry = memory.memory_for_person(get_conn(), person_id)
    if entry is None:
        raise HTTPException(404, "Mitarbeiter wurde nicht gefunden.")
    return clean(entry)


def _memory_response(conn, person_id: int):
    entry = memory.memory_for_person(conn, person_id)
    if entry is None:
        raise HTTPException(404, "Mitarbeiter wurde nicht gefunden.")
    return clean(entry)


class MemoryShowUpdate(BaseModel):
    # None = zurück auf Automatik
    state: Optional[str] = None


@app.put("/api/memory/{person_id}/show/{show_key}")
def memory_set_show(person_id: int, show_key: str, payload: MemoryShowUpdate):
    conn = get_conn()
    key = show_key.strip().upper()
    if payload.state is None:
        db.clear_memory_override(conn, person_id, "show", key)
    elif payload.state in {"confirmed", "removed", "added"}:
        db.set_memory_override(conn, person_id, "show", key, payload.state)
    else:
        raise HTTPException(400, f"Unbekannter Status: {payload.state}")
    return _memory_response(conn, person_id)


class MemoryFreeUpdate(BaseModel):
    # None = zurück auf Automatik; [] ist ein gültiger Pin ("kein festes Muster")
    weekdays: Optional[list[int]] = None


@app.put("/api/memory/{person_id}/free")
def memory_set_free(person_id: int, payload: MemoryFreeUpdate):
    conn = get_conn()
    if payload.weekdays is None:
        db.clear_memory_override(conn, person_id, "free", "weekdays")
    else:
        weekdays = sorted({int(day) for day in payload.weekdays if 0 <= int(day) <= 6})
        db.set_memory_override(
            conn, person_id, "free", "weekdays", "pinned",
            value=json.dumps({"weekdays": weekdays}),
        )
    return _memory_response(conn, person_id)


class MemoryTaskUpdate(BaseModel):
    # Kategorie steht bewusst im Body, nicht im Pfad: Namen wie "OPS / WP" oder
    # "An/Abreise-Dienst" enthalten Schrägstriche und lassen sich auch URL-codiert
    # nicht sicher als Pfadsegment übergeben.
    category: str
    state: Optional[str] = None
    level: Optional[str] = None


@app.put("/api/memory/{person_id}/task")
def memory_set_task(person_id: int, payload: MemoryTaskUpdate):
    conn = get_conn()
    # Immer normalisiert speichern, sonst werden "OPS / WP" und "OPS + WP" zwei Zeilen
    # für denselben Dienst.
    key = stats.normalize_category(payload.category)
    if payload.state is None:
        db.clear_memory_override(conn, person_id, "task", key)
    elif payload.state in {"added", "removed", "confirmed"}:
        value = json.dumps({"level": payload.level}) if payload.level else None
        db.set_memory_override(conn, person_id, "task", key, payload.state, value=value)
    else:
        raise HTTPException(400, f"Unbekannter Status: {payload.state}")
    return _memory_response(conn, person_id)


@app.get("/api/dashboard/insights")
def dashboard_insights(week_id: int):
    conn = get_conn()
    try:
        return clean(stats.week_insights(conn, week_id))
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


# ---------- Upload (PDF / Excel) ----------

@app.post("/api/upload/pdf")
async def upload_pdf(file: UploadFile = File(...), api_key: Optional[str] = None):
    content = await file.read()
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise HTTPException(400, "Kein Gemini API Key vorhanden.")
    try:
        result = extract_dienstplan(content, api_key=key)
    except Exception as e:
        raise HTTPException(500, f"Extraktion fehlgeschlagen: {e}")
    return result


@app.post("/api/upload/xlsx/sheets")
async def upload_xlsx_sheets(file: UploadFile = File(...)):
    content = await file.read()
    try:
        sheets = xlsx_template.list_week_sheets(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(500, f"Konnte Excel-Datei nicht lesen: {e}")
    return {"sheets": sheets}


@app.post("/api/upload/xlsx")
async def upload_xlsx(file: UploadFile = File(...), sheet_name: Optional[str] = None):
    content = await file.read()
    try:
        result = xlsx_template.extract_from_xlsx(io.BytesIO(content), sheet_name)
    except Exception as e:
        raise HTTPException(500, f"Einlesen fehlgeschlagen: {e}")
    return result


@app.get("/api/known-department-tokens")
def known_department_tokens():
    return sorted(KNOWN_DEPARTMENT_TOKENS)


# ---------- Künstlerplan ----------

@app.post("/api/artist-plans/upload/sheets")
async def artist_plan_upload_sheets(file: UploadFile = File(...)):
    content = await file.read()
    try:
        sheets = artist_plan.list_sheets(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(400, f"Künstlerplan konnte nicht gelesen werden: {exc}") from exc
    return {"sheets": sheets}


@app.post("/api/artist-plans/import")
async def artist_plan_import(file: UploadFile = File(...), sheet_name: Optional[str] = None):
    content = await file.read()
    try:
        return artist_plan.extract_artist_plan(
            content,
            sheet_name=sheet_name,
            source_filename=file.filename,
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Künstlerplan-Import fehlgeschlagen: {exc}") from exc


@app.get("/api/artist-plans/empty")
def artist_plan_empty(start_date: str):
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(400, "Ungültiges Startdatum.") from exc
    return artist_plan.empty_rows(start)


class ArtistPlanSaveRequest(BaseModel):
    start_date: str
    end_date: str
    source_filename: Optional[str] = None
    sheet_name: Optional[str] = None
    day_labels: list[str]
    week_dates_iso: list[str]
    rows: list[dict[str, Any]]


@app.post("/api/artist-plans")
def artist_plan_save(payload: ArtistPlanSaveRequest):
    conn = get_conn()
    entries = artist_plan.rows_to_entries(
        payload.rows,
        payload.day_labels,
        payload.week_dates_iso,
    )
    artist_plan_id = db.upsert_artist_plan(
        conn,
        payload.start_date,
        payload.end_date,
        payload.source_filename,
        payload.sheet_name,
        entries,
    )
    return {"artist_plan_id": artist_plan_id}


@app.get("/api/artist-plans")
def artist_plan_list():
    conn = get_conn()
    result = []
    for row in db.get_artist_plans(conn):
        start = datetime.strptime(row["start_date"], "%Y-%m-%d").date()
        result.append({
            "id": row["id"],
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "source_filename": row["source_filename"],
            "sheet_name": row["sheet_name"],
            "filled_entries": row["filled_entries"],
            "label": (
                f"KW {start.isocalendar()[1]} · "
                f"{util.fmt_date_range(row['start_date'], row['end_date'])}"
            ),
        })
    return result


@app.get("/api/artist-plans/{artist_plan_id}")
def artist_plan_detail(artist_plan_id: int):
    conn = get_conn()
    row = db.get_artist_plan(conn, artist_plan_id)
    if row is None:
        raise HTTPException(404, "Künstlerplan wurde nicht gefunden.")
    return artist_plan.stored_plan_payload(conn, row)


@app.delete("/api/artist-plans/{artist_plan_id}")
def artist_plan_delete(artist_plan_id: int):
    conn = get_conn()
    if db.get_artist_plan(conn, artist_plan_id) is None:
        raise HTTPException(404, "Künstlerplan wurde nicht gefunden.")
    db.delete_artist_plan(conn, artist_plan_id)
    return {"ok": True}


@app.get("/api/artist-plans/{artist_plan_id}/export")
def artist_plan_export(artist_plan_id: int):
    conn = get_conn()
    row = db.get_artist_plan(conn, artist_plan_id)
    if row is None:
        raise HTTPException(404, "Künstlerplan wurde nicht gefunden.")
    try:
        config_paths.require_template(config_paths.ARTIST_TEMPLATE_PATH)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    fd, output_path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        artist_plan.export_artist_plan(
            conn,
            row,
            str(config_paths.ARTIST_TEMPLATE_PATH),
            output_path,
        )
    except Exception as exc:
        os.unlink(output_path)
        raise HTTPException(500, f"Künstlerplan-Export fehlgeschlagen: {exc}") from exc
    return FileResponse(
        output_path,
        filename=f"Künstlerplan_{util.fmt_date(row['start_date'])}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(os.unlink, output_path),
    )


# ---------- Probenplan ----------

@app.post("/api/rehearsal-plans/upload/sheets")
async def rehearsal_plan_sheets(file: UploadFile = File(...)):
    """Wochenblätter einer Probenplan-Excel auflisten (Vorlage/Diagramme fliegen raus)."""
    content = await file.read()
    try:
        sheets = rehearsal_plan.list_sheets(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(500, f"Konnte Excel-Datei nicht lesen: {exc}") from exc
    if not sheets:
        raise HTTPException(400, "Die Datei enthält kein erkennbares Wochenblatt.")
    return {"sheets": sheets}


@app.post("/api/rehearsal-plans/import")
async def rehearsal_plan_import(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = None,
):
    filename = (file.filename or "").casefold()
    if not filename.endswith((".pdf", ".xlsx")):
        raise HTTPException(400, "Bitte eine Probenplan-PDF oder -Excel auswählen.")
    content = await file.read()
    conn = get_conn()
    active_people = [
        row["name"] for row in db.get_all_people(conn, active_only=True)
    ]
    try:
        if filename.endswith(".xlsx"):
            return rehearsal_plan.extract_xlsx(
                io.BytesIO(content),
                active_people,
                sheet_name=sheet_name,
                source_filename=file.filename,
            )
        if os.environ.get("GEMINI_API_KEY"):
            try:
                return rehearsal_plan.extract_pdf_with_gemini(
                    content,
                    active_people,
                    source_filename=file.filename,
                )
            except Exception:
                logger.exception(
                    "Gemini-Probenplan-Import fehlgeschlagen, falle auf lokale Extraktion zurück"
                )
                result = rehearsal_plan.extract_pdf(
                    content,
                    active_people,
                    source_filename=file.filename,
                )
                result["warnings"].insert(
                    0,
                    "Gemini war gerade nicht verfügbar. Der Plan wurde zuverlässig lokal ausgelesen.",
                )
                return result
        return rehearsal_plan.extract_pdf(
            content, active_people, source_filename=file.filename
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            500, f"Probenplan konnte nicht gelesen werden: {exc}"
        ) from exc


class RehearsalPlanSaveRequest(BaseModel):
    start_date: str
    end_date: str
    source_filename: Optional[str] = None
    rehearsals: list[dict[str, Any]]


@app.post("/api/rehearsal-plans")
def rehearsal_plan_save(payload: RehearsalPlanSaveRequest):
    conn = get_conn()
    active_people = [
        row["name"] for row in db.get_all_people(conn, active_only=True)
    ]
    try:
        rehearsals = rehearsal_plan.normalize_rehearsals(
            payload.rehearsals, active_people
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, f"Ungültige Probenzeile: {exc}") from exc
    plan_id = db.upsert_rehearsal_plan(
        conn,
        payload.start_date,
        payload.end_date,
        payload.source_filename,
        rehearsals,
    )
    return {"rehearsal_plan_id": plan_id}


@app.get("/api/rehearsal-plans")
def rehearsal_plan_list():
    conn = get_conn()
    result = []
    for row in db.get_rehearsal_plans(conn):
        start = datetime.strptime(row["start_date"], "%Y-%m-%d").date()
        result.append({
            "id": row["id"],
            "start_date": row["start_date"],
            "end_date": row["end_date"],
            "source_filename": row["source_filename"],
            "rehearsal_count": row["rehearsal_count"],
            "label": (
                f"KW {start.isocalendar()[1]} · "
                f"{util.fmt_date_range(row['start_date'], row['end_date'])}"
            ),
        })
    return result


@app.get("/api/rehearsal-plans/{rehearsal_plan_id}")
def rehearsal_plan_detail(rehearsal_plan_id: int):
    conn = get_conn()
    plan = db.get_rehearsal_plan(conn, rehearsal_plan_id)
    if plan is None:
        raise HTTPException(404, "Probenplan wurde nicht gefunden.")
    rehearsals = db.get_rehearsals(conn, rehearsal_plan_id)
    warnings = [
        f"{datetime.strptime(r['date'], '%Y-%m-%d'):%d.%m.}: Ende für „{r['activity']}“ "
        "wurde mit 60 Minuten angesetzt."
        for r in rehearsals
        if r["end_inferred"]
    ]
    return {
        "id": plan["id"],
        "start_date": plan["start_date"],
        "end_date": plan["end_date"],
        "source_filename": plan["source_filename"],
        "rehearsals": rehearsals,
        "warnings": warnings,
    }


@app.delete("/api/rehearsal-plans/{rehearsal_plan_id}")
def rehearsal_plan_delete(rehearsal_plan_id: int):
    conn = get_conn()
    if db.get_rehearsal_plan(conn, rehearsal_plan_id) is None:
        raise HTTPException(404, "Probenplan wurde nicht gefunden.")
    db.delete_rehearsal_plan(conn, rehearsal_plan_id)
    return {"ok": True}


# ---------- Import speichern (PDF/Excel-Review -> DB) ----------

class ImportAssignment(BaseModel):
    date: str
    category: str
    subcategory: Optional[str] = None
    person: Optional[str] = None
    raw_text: Optional[str] = None


class ImportAbsence(BaseModel):
    date: str
    person: str
    type: str


class ImportSave(BaseModel):
    filename: str
    kw: Optional[int] = None
    start_date: str
    end_date: str
    assignments: list[ImportAssignment]
    absences: list[ImportAbsence]
    # raw_name -> "existing:<Name>" | "new" | "department"
    resolutions: dict[str, str] = {}


def _normalize_name(raw: str) -> str:
    import re
    return re.sub(r"\s*\([^)]*\)\s*", "", raw).strip()


def _resolve_with_choices(conn, raw_name: str, resolutions: dict[str, str]) -> Optional[int]:
    choice = resolutions.get(raw_name, "new")
    if choice == "department":
        return None
    if choice.startswith("existing:"):
        name = choice.split(":", 1)[1]
        row = conn.execute("SELECT id FROM people WHERE name = ?", (name,)).fetchone()
        person_id = row["id"] if row else None
    else:
        canonical = _normalize_name(raw_name)
        person_id = db.find_person_by_alias(conn, canonical)
        if person_id is None:
            person_id = db.create_person(conn, canonical)
    if person_id is not None and raw_name:
        db.add_alias(conn, person_id, raw_name)
    return person_id


@app.post("/api/import/save")
def import_save(payload: ImportSave):
    conn = get_conn()
    week_plan_id = db.insert_week_plan(conn, payload.kw, payload.start_date, payload.end_date, payload.filename)

    for a in payload.assignments:
        raw_person = (a.person or "").strip()
        if not raw_person:
            # Infofelder wie Show/Party, Meeting, Motto oder Reminders gehören vollständig
            # ins Archiv, auch wenn ihnen bewusst keine einzelne Person zugeordnet ist.
            if (a.raw_text or "").strip() or (a.subcategory or "").strip():
                db.insert_assignment(
                    conn,
                    week_plan_id,
                    a.date,
                    a.category,
                    a.subcategory,
                    None,
                    a.raw_text,
                )
            continue
        person_id = _resolve_with_choices(conn, raw_person, payload.resolutions)
        db.insert_assignment(conn, week_plan_id, a.date, a.category, a.subcategory, person_id, a.raw_text)

    for a in payload.absences:
        raw_person = (a.person or "").strip()
        if not raw_person:
            continue
        person_id = _resolve_with_choices(conn, raw_person, payload.resolutions)
        db.insert_absence(conn, week_plan_id, a.date, person_id, a.type)

    conn.commit()
    return {"week_plan_id": week_plan_id}


# ---------- Plan-Editor ----------

class PlanGenerateRequest(BaseModel):
    template_week_id: Optional[int] = None
    template_code: Optional[str] = None
    new_start: str  # ISO date
    absences: list[ImportAbsence] = []


def _week_dates(new_start_iso: str) -> list[str]:
    d = datetime.strptime(new_start_iso, "%Y-%m-%d").date()
    return [(d + timedelta(days=i)).isoformat() for i in range(7)]


class FreeSuggestionRequest(BaseModel):
    new_start: str
    absences: list[ImportAbsence] = []


@app.post("/api/plan/free-suggestion")
def plan_free_suggestion(payload: FreeSuggestionRequest):
    conn = get_conn()
    return clean(memory.suggest_free_days(
        conn,
        _week_dates(payload.new_start),
        [absence.dict() for absence in payload.absences],
    ))


def _rotation_week_id(conn, template_code: str | None, explicit_week_id: int | None) -> int:
    """Wählt eine historische Woche derselben A/B-Phase als Rotationsgrundlage."""
    if explicit_week_id is not None:
        if any(w["id"] == explicit_week_id for w in db.get_week_plans(conn)):
            return explicit_week_id
        raise HTTPException(404, "Die gewählte Rotationswoche wurde nicht gefunden.")

    weeks = db.get_week_plans(conn)
    if not weeks:
        raise HTTPException(400, "Es gibt noch keine historischen Wochen für die automatische Verteilung.")

    parity = None
    if template_code:
        try:
            parity = plan_templates.get_template(conn, template_code)["parity"]
        except (KeyError, FileNotFoundError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    if parity is not None:
        for week in weeks:
            if not week["start_date"]:
                continue
            week_date = datetime.strptime(week["start_date"], "%Y-%m-%d").date()
            if week_date.isocalendar()[1] % 2 == parity:
                return week["id"]
    return weeks[0]["id"]


@app.get("/api/plan/templates")
def plan_template_list():
    conn = get_conn()
    try:
        return plan_templates.public_templates(conn)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(500, str(exc)) from exc


def _archived_assignment_for_grid(row: dict) -> dict:
    """Macht personlose Abteilungs-/Hinweiswerte eines fertigen Plans wieder editierbar."""
    item = dict(row)
    if item.get("person") or not item.get("raw_text"):
        return item
    if grid.category_kind(item["category"]) != template_spec.PERSON:
        return item

    raw_text = str(item["raw_text"]).strip()
    category = grid._normalize_category_name(item["category"])
    if category == "Aperitif":
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if len(lines) >= 4:
            item["subcategory"] = item.get("subcategory") or "\n".join(lines[:-1])
            item["person"] = lines[-1]
        else:
            item["subcategory"] = item.get("subcategory") or raw_text
        return item
    if category == "An + Abreise-Dienst" and ":" in raw_text:
        subcategory, value = (part.strip() for part in raw_text.rsplit(":", 1))
        item["subcategory"] = item.get("subcategory") or subcategory
        item["person"] = value
        return item
    if (
        raw_text.upper() in KNOWN_DEPARTMENT_TOKENS
        or raw_text.casefold() in {"-", "keine", "kein", "niemand"}
    ):
        item["person"] = raw_text
    return item


@app.get("/api/plan/existing")
def plan_existing(start_date: str):
    """Lädt einen bereits archivierten/fertig hochgeladenen Dienstplan in den Editor."""
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(400, "Ungültiger Wochenbeginn.") from exc

    conn = get_conn()
    week = conn.execute(
        """SELECT wp.*,
                  (SELECT COUNT(*) FROM assignments a
                   WHERE a.week_plan_id = wp.id) AS assignment_count,
                  (SELECT COUNT(*) FROM absences ab
                   WHERE ab.week_plan_id = wp.id) AS absence_count
           FROM week_plans wp
           WHERE wp.start_date = ?
           ORDER BY wp.id DESC
           LIMIT 1""",
        (start_date,),
    ).fetchone()
    if week is None:
        raise HTTPException(404, "Für diese Woche ist noch kein fertiger Dienstplan archiviert.")

    week_dates_iso = _week_dates(start_date)
    assignments_list = [
        _archived_assignment_for_grid(dict(row))
        for row in db.get_assignments_for_week(conn, week["id"])
    ]
    grid_df = grid.build_grid(assignments_list, week_dates_iso)
    day_labels = [util.fmt_date_short(day) for day in week_dates_iso]
    day_by_iso = dict(zip(week_dates_iso, day_labels))

    for absence in db.get_absences_for_week(conn, week["id"]):
        day_label = day_by_iso.get(absence["date"])
        if not day_label or not absence["person"]:
            continue
        row_indexes = grid_df.index[
            (grid_df[grid.CATEGORY_COL] == absence["typ"])
            & (grid_df[grid.ROW_TYPE_COL] == "data")
        ].tolist()
        if not row_indexes:
            continue
        row_index = row_indexes[0]
        current = str(grid_df.at[row_index, day_label] or "").strip()
        grid_df.at[row_index, day_label] = (
            f"{current}, {absence['person']}" if current else absence["person"]
        )

    template_code = "A" if start.isocalendar()[1] % 2 else "B"
    try:
        selected_template = plan_templates.get_template(conn, template_code)
    except (KeyError, FileNotFoundError, ValueError) as exc:
        raise HTTPException(500, str(exc)) from exc

    active_people = [dict(person) for person in db.get_all_people(conn, active_only=True)]
    grid_rows = records(grid_df)
    assignment_rules: dict[str, dict] = {}
    for row in grid_rows:
        if row.get(grid.ROW_TYPE_COL) != "data":
            continue
        category = row.get(grid.CATEGORY_COL) or row.get(grid.LABEL_COL)
        slot = row.get(grid.SLOT_COL) or None
        rule = planning_rules.assignment_rule(active_people, category, slot)
        if rule:
            assignment_rules[f"{category}::{slot or ''}"] = rule

    saved_artist_plan = db.get_artist_plan_by_start(conn, start_date)
    saved_rehearsal_plan = db.get_rehearsal_plan_by_start(conn, start_date)
    rehearsal_intervals = [
        {**dict(row), "is_show": rehearsal_plan.is_show_event(dict(row))}
        for row in db.get_rehearsal_intervals(
            conn, week_dates_iso[0], week_dates_iso[-1]
        )
    ]
    rehearsal_events = [
        dict(row)
        for row in db.get_rehearsal_events(
            conn, week_dates_iso[0], week_dates_iso[-1]
        )
    ]
    deko_people = [
        person["name"]
        for person in active_people
        if "DEKO" in planning_rules.department_tags(person.get("department"))
    ]
    previous_workload = stats.previous_week_workload(conn, start)
    kw = week["kw"] or start.isocalendar()[1]

    return {
        "rows": grid_rows,
        "day_labels": day_labels,
        "week_dates_iso": week_dates_iso,
        "person_categories": sorted(grid.PERSON_CATEGORIES),
        "assignment_rules": assignment_rules,
        "template_week_id": week["id"],
        "template_code": template_code,
        "xlsx_sheet": selected_template["sheet"],
        "artist_plan": (
            {
                "id": saved_artist_plan["id"],
                "sheet_name": saved_artist_plan["sheet_name"],
                "source_filename": saved_artist_plan["source_filename"],
            }
            if saved_artist_plan is not None else None
        ),
        "rehearsal_plan": (
            {
                "id": saved_rehearsal_plan["id"],
                "source_filename": saved_rehearsal_plan["source_filename"],
            }
            if saved_rehearsal_plan is not None else None
        ),
        "rehearsal_intervals": rehearsal_intervals,
        "show_dates": sorted(rehearsal_plan.detect_show_dates(rehearsal_events)),
        "on_stage_by_date": memory.on_stage_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], template_code
        ),
        "on_stage_shows_by_date": memory.on_stage_shows_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], template_code
        ),
        "deko_people": deko_people,
        "previous_week": previous_workload["week"],
        "previous_week_workload": previous_workload["people"],
        "existing_week": {
            "id": week["id"],
            "kw": kw,
            "start_date": week["start_date"],
            "end_date": week["end_date"],
            "source": week["source_pdf"],
            "label": f"KW{kw} · {util.fmt_date_range(week['start_date'], week['end_date'])}",
            "assignment_count": week["assignment_count"],
            "absence_count": week["absence_count"],
        },
    }


@app.post("/api/plan/generate")
def plan_generate(payload: PlanGenerateRequest):
    conn = get_conn()
    new_start = datetime.strptime(payload.new_start, "%Y-%m-%d").date()
    absent_by_date: dict[str, set[str]] = {}
    for a in payload.absences:
        absent_by_date.setdefault(a.date, set()).add(a.person)

    rotation_week_id = _rotation_week_id(conn, payload.template_code, payload.template_week_id)
    draft, show_dates = assignment.generate_week_draft(
        conn, rotation_week_id, new_start, absent_by_date,
        template_code=payload.template_code,
    )
    # Aus der Historie werden nur echte Mitarbeiterdienste neu verteilt. Show-/Party-,
    # Motto- und sonstige Infotexte stammen verbindlich aus der gewählten A/B-Grundvorlage.
    draft = [
        row for row in draft
        if grid.category_kind(row["category"]) == template_spec.PERSON
    ]

    selected_template = None
    if payload.template_code:
        try:
            selected_template = plan_templates.get_template(conn, payload.template_code)
            draft.extend(
                xlsx_template.read_template_content(
                    str(selected_template["path"]),
                    selected_template["sheet"],
                    new_start,
                )
            )
        except (KeyError, FileNotFoundError, ValueError) as exc:
            raise HTTPException(400, str(exc)) from exc

    saved_artist_plan = db.get_artist_plan_by_start(conn, payload.new_start)
    if saved_artist_plan is not None:
        draft = artist_plan.apply_to_draft(conn, draft, saved_artist_plan)

    week_dates_iso = _week_dates(payload.new_start)
    saved_rehearsal_plan = db.get_rehearsal_plan_by_start(
        conn, payload.new_start
    )
    rehearsal_intervals = [
        {**dict(row), "is_show": rehearsal_plan.is_show_event(dict(row))}
        for row in db.get_rehearsal_intervals(
            conn, week_dates_iso[0], week_dates_iso[-1]
        )
    ]
    active_people = [dict(p) for p in db.get_all_people(conn, active_only=True)]
    deko_people = [
        person["name"]
        for person in active_people
        if "DEKO" in planning_rules.department_tags(person.get("department"))
    ]
    previous_workload = stats.previous_week_workload(conn, new_start)
    draft = assignment.add_relief_rewards(
        draft,
        active_people,
        week_dates_iso,
        absent_by_date,
        show_dates,
    )
    grid_df = grid.build_grid(draft, week_dates_iso)
    day_labels = [util.fmt_date_short(d) for d in week_dates_iso]
    grid_rows = records(grid_df)
    assignment_rules: dict[str, dict] = {}
    for row in grid_rows:
        if row.get(grid.ROW_TYPE_COL) != "data":
            continue
        category = row.get(grid.CATEGORY_COL) or row.get(grid.LABEL_COL)
        slot = row.get(grid.SLOT_COL) or None
        rule = planning_rules.assignment_rule(active_people, category, slot)
        if rule:
            assignment_rules[f"{category}::{slot or ''}"] = rule

    return {
        "rows": grid_rows,
        "day_labels": day_labels,
        "week_dates_iso": week_dates_iso,
        "person_categories": sorted(grid.PERSON_CATEGORIES),
        "assignment_rules": assignment_rules,
        "template_week_id": rotation_week_id,
        "template_code": selected_template["code"] if selected_template else None,
        "xlsx_sheet": selected_template["sheet"] if selected_template else None,
        "artist_plan": (
            {
                "id": saved_artist_plan["id"],
                "sheet_name": saved_artist_plan["sheet_name"],
                "source_filename": saved_artist_plan["source_filename"],
            }
            if saved_artist_plan is not None
            else None
        ),
        "rehearsal_plan": (
            {
                "id": saved_rehearsal_plan["id"],
                "source_filename": saved_rehearsal_plan["source_filename"],
            }
            if saved_rehearsal_plan is not None
            else None
        ),
        "rehearsal_intervals": rehearsal_intervals,
        "show_dates": sorted(show_dates),
        "on_stage_by_date": memory.on_stage_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], payload.template_code
        ),
        "on_stage_shows_by_date": memory.on_stage_shows_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], payload.template_code
        ),
        "deko_people": deko_people,
        "previous_week": previous_workload["week"],
        "previous_week_workload": previous_workload["people"],
    }


class GridRow(BaseModel):
    Abschnitt: str
    Zeile: Optional[str] = ""
    cells: dict[str, str]  # day_label -> cell text


class PlanSaveRequest(BaseModel):
    start_date: str
    end_date: str
    template_week_id: int
    existing_week_id: Optional[int] = None
    day_labels: list[str]
    rows: list[dict[str, Any]]  # {Abschnitt, Zeile, <day_label columns>...}


def _grid_df_from_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def _assignment_warnings(
    conn,
    assignments_list: list[dict],
    start_date: str | None = None,
) -> list[str]:
    violations: list[str] = []
    relief_counts: dict[str, int] = {}
    minimum_staff: dict[tuple[str, str, str], set[str]] = {}
    dates = [row["date"] for row in assignments_list if row.get("date")]
    rehearsal_lookup: dict[tuple[str, str], list[dict]] = {}
    show_dates: set[str] = set()
    if dates:
        for rehearsal in db.get_rehearsal_intervals(conn, min(dates), max(dates)):
            item = dict(rehearsal)
            rehearsal_lookup.setdefault(
                (item["person_name"].casefold(), item["date"]), []
            ).append(item)
        show_dates = rehearsal_plan.detect_show_dates(
            [
                dict(row)
                for row in db.get_rehearsal_events(
                    conn, min(dates), max(dates)
                )
            ]
        )
    for assignment_row in assignments_list:
        name = (assignment_row.get("person") or "").strip()
        if not name:
            continue
        if planning_rules.is_relief_reward(assignment_row["category"]):
            relief_counts[name.casefold()] = relief_counts.get(name.casefold(), 0) + 1
        person_id = db.find_person_by_alias(conn, name)
        person = (
            conn.execute(
                "SELECT name, department FROM people WHERE id = ?", (person_id,)
            ).fetchone()
            if person_id is not None
            else None
        )
        department = person["department"] if person else None
        required = planning_rules.required_people(
            assignment_row["category"],
            assignment_row.get("subcategory"),
            assignment_row.get("date"),
        )
        if required > 1:
            key = (
                assignment_row["date"],
                assignment_row["category"],
                assignment_row.get("subcategory") or "",
            )
            canonical = f"id:{person_id}" if person_id is not None else name.casefold()
            minimum_staff.setdefault(key, set()).add(canonical)
        if (
            planning_rules.is_relief_reward(assignment_row["category"])
            and assignment_row["date"] in show_dates
            and "DEKO" in planning_rules.department_tags(department)
        ):
            violations.append(
                f"{name}: An Showtagen ist für Deko weder Ausschlafen noch "
                "Barfrei möglich, weil die Bühne auf- und abgebaut wird."
            )
        message = planning_rules.hard_violation(
            name,
            department,
            assignment_row["category"],
            assignment_row.get("subcategory"),
        )
        if message:
            violations.append(f"{name}: {message}")
        service = planning_rules.service_interval(
            assignment_row["category"], assignment_row.get("subcategory")
        )
        if service is not None:
            for rehearsal in rehearsal_lookup.get(
                (name.casefold(), assignment_row["date"]), []
            ):
                rehearsal_slot = planning_rules.rehearsal_interval(
                    rehearsal["start_time"], rehearsal["end_time"]
                )
                if planning_rules.rehearsal_conflict_level(
                    service, rehearsal_slot
                ) == 3:
                    violations.append(
                        f"{name}: {assignment_row['category']} überschneidet sich "
                        f"mit der Probe „{rehearsal['activity']}“ "
                        f"({rehearsal['start_time']}–{rehearsal['end_time']})."
                    )
    duplicate_relief = [
        name for name, count in relief_counts.items() if count > 1
    ]
    if duplicate_relief:
        shown = ", ".join(name.title() for name in duplicate_relief[:5])
        violations.append(
            f"{shown}: Ausschlafen und Barfrei zählen zusammen und sind nur 1x pro Woche möglich."
        )
    for (date_iso, category, subcategory), assigned_people in minimum_staff.items():
        required = planning_rules.required_people(category, subcategory, date_iso)
        if len(assigned_people) < required:
            violations.append(
                f"Gäste vs. Robins BVB am {util.fmt_date(date_iso)} braucht "
                f"mindestens {required} verschiedene Mitarbeiter "
                f"(aktuell {len(assigned_people)})."
            )
    if start_date:
        special_date = (
            datetime.strptime(start_date, "%Y-%m-%d").date() + timedelta(days=4)
        ).isoformat()
        special_people: set[str] = set()
        for assignment_row in assignments_list:
            if not planning_rules.is_guests_vs_robins_bvb(
                assignment_row["category"],
                assignment_row.get("subcategory"),
                assignment_row.get("date"),
            ):
                continue
            name = (assignment_row.get("person") or "").strip()
            person_id = db.find_person_by_alias(conn, name) if name else None
            special_people.add(
                f"id:{person_id}" if person_id is not None else name.casefold()
            )
        special_people.discard("")
        if len(special_people) < 4:
            violations.append(
                f"Gäste vs. Robins BVB am {util.fmt_date(special_date)} braucht "
                f"mindestens 4 verschiedene Mitarbeiter "
                f"(aktuell {len(special_people)})."
            )
    return list(dict.fromkeys(violations))


@app.post("/api/plan/save")
def plan_save(payload: PlanSaveRequest):
    conn = get_conn()
    day_iso_by_label = {
        lbl: iso for lbl, iso in zip(payload.day_labels, _week_dates(payload.start_date))
    }
    grid_df = _grid_df_from_rows(payload.rows)
    assignments_list, absences_list = grid.parse_grid(grid_df, day_iso_by_label)
    warnings = _assignment_warnings(conn, assignments_list, payload.start_date)

    if payload.existing_week_id is not None:
        existing = conn.execute(
            "SELECT id, start_date FROM week_plans WHERE id = ?",
            (payload.existing_week_id,),
        ).fetchone()
        if existing is None or existing["start_date"] != payload.start_date:
            raise HTTPException(404, "Der zu bearbeitende Archivplan wurde nicht gefunden.")
        week_plan_id = payload.existing_week_id
        conn.execute("DELETE FROM assignments WHERE week_plan_id = ?", (week_plan_id,))
        conn.execute("DELETE FROM absences WHERE week_plan_id = ?", (week_plan_id,))
        conn.execute(
            "UPDATE week_plans SET end_date = ? WHERE id = ?",
            (payload.end_date, week_plan_id),
        )
    else:
        week_plan_id = db.insert_week_plan(
            conn, None, payload.start_date, payload.end_date,
            f"Generiert (Vorlage KW-ID {payload.template_week_id})",
        )
    for a in assignments_list:
        person_name = (a.get("person") or "").strip()
        person_id = _resolve_or_create(conn, person_name) if person_name else None
        db.insert_assignment(conn, week_plan_id, a["date"], a["category"], a.get("subcategory"), person_id, a.get("raw_text"))
    for a in absences_list:
        person_id = _resolve_or_create(conn, a["person"])
        db.insert_absence(conn, week_plan_id, a["date"], person_id, a["type"])
    conn.commit()
    return {"week_plan_id": week_plan_id, "warnings": warnings}


def _resolve_or_create(conn, name: str) -> int:
    person_id = db.find_person_by_alias(conn, name)
    if person_id is None:
        person_id = db.create_person(conn, name)
    return person_id


# ---------- Excel-Vorlage ----------


class XlsxGenerateRequest(BaseModel):
    # Das Frontend schickt nur noch den Vorlagen-Code ("A"/"B"), nie einen
    # lokalen Dateipfad. Der tatsächliche Pfad wird ausschliesslich
    # serverseitig über plan_templates.get_template()/TEMPLATES aufgelöst
    # (übernimmt hier die Rolle der TEMPLATE_MAP: Code -> echter Pfad).
    template_code: str
    start_date: str
    day_labels: list[str]
    rows: list[dict[str, Any]]


@app.post("/api/xlsx/generate")
def xlsx_generate(payload: XlsxGenerateRequest):
    conn = get_conn()
    try:
        spec = plan_templates.get_template(conn, payload.template_code)
    except (KeyError, FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    day_iso_by_label = {lbl: iso for lbl, iso in zip(payload.day_labels, _week_dates(payload.start_date))}
    grid_df = _grid_df_from_rows(payload.rows)
    assignments_list, absences_list = grid.parse_grid(grid_df, day_iso_by_label)

    new_start = datetime.strptime(payload.start_date, "%Y-%m-%d").date()
    fd, out_path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    try:
        xlsx_template.generate_week_xlsx(
            str(spec["path"]), spec["sheet"], new_start, assignments_list, absences_list, out_path
        )
    except Exception as exc:
        os.unlink(out_path)
        raise HTTPException(500, f"Excel-Generierung fehlgeschlagen: {exc}") from exc
    return FileResponse(
        out_path, filename=f"Dienstplan_{util.fmt_date(payload.start_date)}.xlsx",
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        background=BackgroundTask(os.unlink, out_path),
    )


# ---------- Settings ----------

@app.get("/api/settings/{key}")
def get_setting(key: str):
    conn = get_conn()
    return {"value": db.get_setting(conn, key)}


class SettingValue(BaseModel):
    value: str


@app.put("/api/settings/{key}")
def set_setting(key: str, payload: SettingValue):
    conn = get_conn()
    db.set_setting(conn, key, payload.value)
    return {"ok": True}


@app.get("/api/health")
def health():
    """Reiner Lesezugriff - verändert nie Daten, legt auch keine Datenbank an."""
    database_status = "missing"
    if config_paths.DATABASE_PATH.exists():
        try:
            conn = sqlite3.connect(str(config_paths.DATABASE_PATH))
            conn.execute("SELECT 1")
            conn.close()
            database_status = "connected"
        except sqlite3.Error:
            database_status = "error"
    return {
        "status": "ok",
        "database": database_status,
        "database_path": config_paths.relative_to_project(config_paths.DATABASE_PATH),
    }


def _dir_diagnostic(path: Path) -> dict:
    exists = path.exists()
    writable = False
    if exists:
        probe = path / ".system_write_check"
        try:
            probe.write_text("ok")
            probe.unlink()
            writable = True
        except OSError:
            writable = False
    return {
        "path": config_paths.relative_to_project(path),
        "exists": exists,
        "writable": writable,
    }


@app.get("/api/system/diagnostics")
def system_diagnostics():
    """Reiner Lesezugriff für den Service Manager - prüft denselben Zustand
    wie backend/run_local.py beim Start, aber strukturiert für die UI statt
    als Konsolenausgabe. Verändert nichts, legt nichts an (bis auf eine
    sofort wieder gelöschte Prüfdatei je Ordner, um "beschreibbar" zu testen)."""
    database_exists = config_paths.DATABASE_PATH.exists()
    integrity: Optional[str] = None
    database_status = "missing"
    if database_exists:
        try:
            conn = sqlite3.connect(str(config_paths.DATABASE_PATH))
            integrity = conn.execute("PRAGMA integrity_check;").fetchone()[0]
            conn.close()
            database_status = "connected" if integrity == "ok" else "error"
        except sqlite3.Error as exc:
            database_status = "error"
            integrity = str(exc)

    templates = [
        {"name": name, "filename": path.name, "exists": path.exists()}
        for name, path in (
            ("Woche A", config_paths.WEEK_A_TEMPLATE_PATH),
            ("Woche B", config_paths.WEEK_B_TEMPLATE_PATH),
            ("Künstlerplan", config_paths.ARTIST_TEMPLATE_PATH),
        )
    ]

    directories = {
        "database": _dir_diagnostic(config_paths.DATABASE_DIR),
        "archive": _dir_diagnostic(config_paths.DIENSTPLAN_ARCHIVE_DIR),
        "uploads": _dir_diagnostic(config_paths.UPLOAD_DIR),
        "exports": _dir_diagnostic(config_paths.EXPORT_DIR),
    }

    disk_usage = shutil.disk_usage(config_paths.LOCAL_DATA_DIR if config_paths.LOCAL_DATA_DIR.exists() else config_paths.PROJECT_ROOT)

    return {
        "database": {
            "status": database_status,
            "integrity_check": integrity,
            "path": config_paths.relative_to_project(config_paths.DATABASE_PATH),
        },
        "templates": templates,
        "directories": directories,
        "host": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "port": os.getenv("BACKEND_PORT", "8000"),
        "cors_origins": _cors_origins(),
        "uptime_seconds": round(time.monotonic() - _PROCESS_STARTED_AT, 1),
        "disk": {
            "free_bytes": disk_usage.free,
            "total_bytes": disk_usage.total,
        },
    }


@app.post("/api/system/restart")
def system_restart():
    """Startet den Backend-Prozess vollständig neu - unabhängig davon, wie
    er gestartet wurde (Startskript, manuell, mit oder ohne Reload-Modus).

    Frühere Version verliess sich auf uvicorns --reload-Dateiwächter (mtime
    von api.py anfassen) - das funktioniert nur, wenn reload=True gesetzt
    ist, was seit dieser Version aber bewusst NICHT mehr der Standard ist
    (siehe backend/run_local.py). Für einen normalen Nutzer, der die
    Anwendung nur über das Startskript startet, passierte beim Klick auf
    "Backend neu starten" dadurch schlicht nichts.

    Stattdessen ersetzt os.execv() den laufenden Prozess durch eine frische
    Instanz von "python -m backend.run_local" - denselben Interpreter,
    dasselbe Arbeitsverzeichnis, dieselbe Umgebung. Der Listening-Socket
    schliesst sich dabei automatisch (Python-Dateideskriptoren sind seit
    PEP 446 standardmässig nicht vererbbar über exec hinweg), sodass der
    neue Prozess den Port direkt neu binden kann - kein doppelt gebundener
    Port, kein verwaister Prozess.
    """

    def _restart() -> None:
        time.sleep(0.3)  # HTTP-Antwort erst zustellen lassen
        os.execv(sys.executable, [sys.executable, "-m", "backend.run_local"])

    threading.Thread(target=_restart, daemon=True).start()
    return {"status": "restarting"}
