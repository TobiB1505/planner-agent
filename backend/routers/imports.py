"""AP11 - Import-Endpunkte: PDF/XLSX-Upload, Künstlerplan, Probenplan, Import-
Speichern (Move-Only aus backend/api.py, unverändert).

Auth-Sprint: der einzige Router mit gemischten Rollen, deshalb hängt die
Berechtigung hier an jedem Endpunkt einzeln statt am Router.

- Jeder Upload/Import/Export und jede Schreiboperation: PLANNER. Employee
  startet grundsätzlich keine Import-Vorgänge.
- Reines Auflisten/Lesen von Künstler- und Probenplan (GET /api/artist-plans,
  GET /api/artist-plans/{id}, GET /api/rehearsal-plans,
  GET /api/rehearsal-plans/{id}): EMPLOYEE. Das sind genau die Inhalte, die
  das Employee-Portal später anzeigen soll (Künstlerplan, Probenplan), und
  sie enthalten keine Bewertung, keine Empfehlung und keine Statistik über
  Mitarbeitende - anders als Dienstplan, Dashboard oder MA-Gedächtnis.
- Der Excel-Export des Künstlerplans bleibt PLANNER: er erzeugt eine Datei
  aus der Programmvorlage und ist eine Planungsausgabe, kein Lesezugriff.
"""
from __future__ import annotations

import io
import logging
import os
import sqlite3
import tempfile
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .. import artist_plan
from .. import db
from ..auth import require_employee, require_planner
from ..config import paths as config_paths
from .. import rehearsal_plan
from .. import template_spec
from .. import util
from .. import xlsx_template
from ..extraction import extract_dienstplan
from .shared import ImportAbsence

router = APIRouter()

logger = logging.getLogger(__name__)


# ---------- Upload (PDF / Excel) ----------

@router.post("/api/upload/pdf", dependencies=[Depends(require_planner)])
def upload_pdf(file: UploadFile = File(...)):
    """Auth-Sprint (bewusste Vertragsänderung): der frühere Query-Parameter
    `?api_key=` wurde ersatzlos entfernt. Ein Secret im Query-String landet
    in Browser-Historie, Proxy-/Access-Logs und Referer-Headern - dagegen
    hilft keine Rollenprüfung. Der Gemini-Key kommt jetzt ausschliesslich aus
    der serverseitigen Umgebungsvariable GEMINI_API_KEY.

    Ein trotzdem mitgeschicktes ?api_key=... wird von FastAPI schlicht
    ignoriert (kein 422) - der Aufruf funktioniert weiter, nur eben mit dem
    Server-Key. Siehe docs/auth/AUTH_ARCHITECTURE.md, Abschnitt
    "API-Vertragsänderungen".

    AP7: def statt async def - FastAPI führt synchrone Path-Operationen im
    Threadpool aus, damit der blockierende Gemini-Netzwerkcall in
    extract_dienstplan() den Event-Loop nicht mehr aufhält.
    """
    content = file.file.read()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise HTTPException(400, "Kein Gemini API Key vorhanden.")
    try:
        result = extract_dienstplan(content, api_key=key)
    except Exception as e:
        raise HTTPException(500, f"Extraktion fehlgeschlagen: {e}")
    return result


@router.post("/api/upload/xlsx/sheets", dependencies=[Depends(require_planner)])
def upload_xlsx_sheets(file: UploadFile = File(...)):
    # AP7: def statt async def - openpyxl-Ladevorgang läuft dadurch im Threadpool.
    content = file.file.read()
    try:
        sheets = xlsx_template.list_week_sheets(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(500, f"Konnte Excel-Datei nicht lesen: {e}")
    return {"sheets": sheets}


@router.post("/api/upload/xlsx", dependencies=[Depends(require_planner)])
def upload_xlsx(file: UploadFile = File(...), sheet_name: Optional[str] = None):
    # AP7: def statt async def - openpyxl-Ladevorgang läuft dadurch im Threadpool.
    content = file.file.read()
    try:
        result = xlsx_template.extract_from_xlsx(io.BytesIO(content), sheet_name)
    except Exception as e:
        raise HTTPException(500, f"Einlesen fehlgeschlagen: {e}")
    return result


@router.get("/api/known-department-tokens", dependencies=[Depends(require_planner)])
def known_department_tokens():
    return sorted(template_spec.DEPARTMENT_TOKENS)


# ---------- Künstlerplan ----------

@router.post("/api/artist-plans/upload/sheets", dependencies=[Depends(require_planner)])
def artist_plan_upload_sheets(file: UploadFile = File(...)):
    # AP7: def statt async def - openpyxl-Ladevorgang läuft dadurch im Threadpool.
    content = file.file.read()
    try:
        sheets = artist_plan.list_sheets(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(400, f"Künstlerplan konnte nicht gelesen werden: {exc}") from exc
    return {"sheets": sheets}


@router.post("/api/artist-plans/import", dependencies=[Depends(require_planner)])
def artist_plan_import(file: UploadFile = File(...), sheet_name: Optional[str] = None):
    # AP7: def statt async def - openpyxl-Ladevorgang läuft dadurch im Threadpool.
    content = file.file.read()
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


@router.get("/api/artist-plans/empty", dependencies=[Depends(require_planner)])
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


@router.post("/api/artist-plans", dependencies=[Depends(require_planner)])
def artist_plan_save(
    payload: ArtistPlanSaveRequest,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
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
    conn.commit()
    return {"artist_plan_id": artist_plan_id}


@router.get("/api/artist-plans", dependencies=[Depends(require_employee)])
def artist_plan_list(conn: sqlite3.Connection = Depends(db.get_db_connection)):
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


@router.get("/api/artist-plans/{artist_plan_id}", dependencies=[Depends(require_employee)])
def artist_plan_detail(
    artist_plan_id: int,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    row = db.get_artist_plan(conn, artist_plan_id)
    if row is None:
        raise HTTPException(404, "Künstlerplan wurde nicht gefunden.")
    return artist_plan.stored_plan_payload(conn, row)


@router.delete("/api/artist-plans/{artist_plan_id}", dependencies=[Depends(require_planner)])
def artist_plan_delete(
    artist_plan_id: int,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    if db.get_artist_plan(conn, artist_plan_id) is None:
        raise HTTPException(404, "Künstlerplan wurde nicht gefunden.")
    db.delete_artist_plan(conn, artist_plan_id)
    conn.commit()
    return {"ok": True}


@router.get("/api/artist-plans/{artist_plan_id}/export", dependencies=[Depends(require_planner)])
def artist_plan_export(
    artist_plan_id: int,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
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

@router.post("/api/rehearsal-plans/upload/sheets", dependencies=[Depends(require_planner)])
def rehearsal_plan_sheets(file: UploadFile = File(...)):
    """Wochenblätter einer Probenplan-Excel auflisten (Vorlage/Diagramme fliegen raus).

    AP7: def statt async def - openpyxl-Ladevorgang läuft dadurch im Threadpool.
    """
    content = file.file.read()
    try:
        sheets = rehearsal_plan.list_sheets(io.BytesIO(content))
    except Exception as exc:
        raise HTTPException(500, f"Konnte Excel-Datei nicht lesen: {exc}") from exc
    if not sheets:
        raise HTTPException(400, "Die Datei enthält kein erkennbares Wochenblatt.")
    return {"sheets": sheets}


@router.post("/api/rehearsal-plans/import", dependencies=[Depends(require_planner)])
def rehearsal_plan_import(
    file: UploadFile = File(...),
    sheet_name: Optional[str] = None,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    """AP7: def statt async def - fitz-/openpyxl-/Gemini-Verarbeitung läuft dadurch
    im Threadpool; die per Depends() erzeugte Connection wird ausschließlich in
    diesem einen Worker-Thread verwendet (keine Cross-Thread-Weitergabe)."""
    filename = (file.filename or "").casefold()
    if not filename.endswith((".pdf", ".xlsx")):
        raise HTTPException(400, "Bitte eine Probenplan-PDF oder -Excel auswählen.")
    content = file.file.read()
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


@router.post("/api/rehearsal-plans", dependencies=[Depends(require_planner)])
def rehearsal_plan_save(
    payload: RehearsalPlanSaveRequest,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
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
    conn.commit()
    return {"rehearsal_plan_id": plan_id}


@router.get("/api/rehearsal-plans", dependencies=[Depends(require_employee)])
def rehearsal_plan_list(conn: sqlite3.Connection = Depends(db.get_db_connection)):
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


@router.get("/api/rehearsal-plans/{rehearsal_plan_id}", dependencies=[Depends(require_employee)])
def rehearsal_plan_detail(
    rehearsal_plan_id: int,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
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


@router.delete("/api/rehearsal-plans/{rehearsal_plan_id}", dependencies=[Depends(require_planner)])
def rehearsal_plan_delete(
    rehearsal_plan_id: int,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    if db.get_rehearsal_plan(conn, rehearsal_plan_id) is None:
        raise HTTPException(404, "Probenplan wurde nicht gefunden.")
    db.delete_rehearsal_plan(conn, rehearsal_plan_id)
    conn.commit()
    return {"ok": True}


# ---------- Import speichern (PDF/Excel-Review -> DB) ----------

class ImportAssignment(BaseModel):
    date: str
    category: str
    subcategory: Optional[str] = None
    person: Optional[str] = None
    raw_text: Optional[str] = None


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


@router.post("/api/import/save", dependencies=[Depends(require_planner)])
def import_save(payload: ImportSave, conn: sqlite3.Connection = Depends(db.get_db_connection)):
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
