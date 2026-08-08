"""AP11 - Plan-/Wochen-Endpunkte: Archiv (Weeks), Plan laden/generieren/speichern/
exportieren (Move-Only aus backend/api.py, unverändert)."""
from __future__ import annotations

import os
import tempfile
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from .. import artist_plan
from .. import assignment
from .. import db
from .. import grid
from .. import memory
from .. import plan_templates
from .. import planning_rules
from .. import rehearsal_plan
from .. import stats
from .. import template_spec
from .. import util
from .. import xlsx_template
from ..intelligence import audit as intelligence_audit
from .shared import ImportAbsence, _grid_df_from_rows, _week_dates, clean, records

router = APIRouter()


# ---------- Weeks / Archiv ----------

@router.get("/api/weeks")
def get_weeks(conn: db.Connection = Depends(db.get_db_connection)):
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


@router.get("/api/weeks/{week_id}")
def get_week_detail(week_id: int, conn: db.Connection = Depends(db.get_db_connection)):
    assignments = [dict(a) for a in db.get_assignments_for_week(conn, week_id)]
    absences = [dict(a) for a in db.get_absences_for_week(conn, week_id)]
    return {"assignments": clean(assignments), "absences": clean(absences)}


@router.delete("/api/weeks/{week_id}")
def delete_week(week_id: int, conn: db.Connection = Depends(db.get_db_connection)):
    db.delete_week_plan(conn, week_id)
    conn.commit()
    return {"ok": True}


# ---------- Plan-Editor ----------

class PlanGenerateRequest(BaseModel):
    template_week_id: Optional[int] = None
    template_code: Optional[str] = None
    new_start: str  # ISO date
    absences: list[ImportAbsence] = []


class FreeSuggestionRequest(BaseModel):
    new_start: str
    absences: list[ImportAbsence] = []


@router.post("/api/plan/free-suggestion")
def plan_free_suggestion(
    payload: FreeSuggestionRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
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


@router.get("/api/plan/templates")
def plan_template_list(conn: db.Connection = Depends(db.get_db_connection)):
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
        raw_text.upper() in template_spec.DEPARTMENT_TOKENS
        or raw_text.casefold() in {"-", "keine", "kein", "niemand"}
    ):
        item["person"] = raw_text
    return item


def _build_shared_plan_fields(
    conn: db.Connection,
    *,
    week_dates_iso: list[str],
    grid_rows: list[dict],
    active_people: list[dict],
    saved_artist_plan,
    saved_rehearsal_plan,
    previous_workload: dict,
    template_code: str | None,
    memory_data: memory.MemoryData | None = None,
    schedule: dict | None = None,
) -> dict:
    """Response-Felder, die `plan_existing` und `plan_generate` identisch berechnen
    (Finding E4/AP6). `memory_data`/`schedule` werden - falls vom Aufrufer bereits
    einmalig pro Request berechnet - unverändert weitergereicht, statt hier erneut
    build_memory()/show_schedule() auszulösen. `None` (Standard) entspricht exakt
    dem bisherigen Verhalten."""
    day_labels = [util.fmt_date_short(day) for day in week_dates_iso]

    assignment_rules: dict[str, dict] = {}
    for row in grid_rows:
        if row.get(grid.ROW_TYPE_COL) != "data":
            continue
        category = row.get(grid.CATEGORY_COL) or row.get(grid.LABEL_COL)
        slot = row.get(grid.SLOT_COL) or None
        rule = planning_rules.assignment_rule(active_people, category, slot)
        if rule:
            assignment_rules[f"{category}::{slot or ''}"] = rule

    rehearsal_intervals = [
        {**dict(row), "is_show": rehearsal_plan.is_show_event(dict(row))}
        for row in db.get_rehearsal_intervals(
            conn, week_dates_iso[0], week_dates_iso[-1]
        )
    ]

    deko_people = [
        person["name"]
        for person in active_people
        if "DEKO" in planning_rules.department_tags(person.get("department"))
    ]

    return {
        "day_labels": day_labels,
        "person_categories": sorted(grid.PERSON_CATEGORIES),
        "assignment_rules": assignment_rules,
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
        "on_stage_by_date": memory.on_stage_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], template_code,
            schedule=schedule, memory_data=memory_data,
        ),
        "on_stage_shows_by_date": memory.on_stage_shows_by_date(
            conn, week_dates_iso[0], week_dates_iso[-1], template_code,
            schedule=schedule,
        ),
        "deko_people": deko_people,
        "previous_week": previous_workload["week"],
        "previous_week_workload": previous_workload["people"],
    }


@router.get("/api/plan/existing")
def plan_existing(
    start_date: str,
    conn: db.Connection = Depends(db.get_db_connection),
):
    """Lädt einen bereits archivierten/fertig hochgeladenen Dienstplan in den Editor."""
    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise HTTPException(400, "Ungültiger Wochenbeginn.") from exc

    week = conn.execute(
        """SELECT wp.*,
                  (SELECT COUNT(*) FROM assignments a
                   WHERE a.week_plan_id = wp.id) AS assignment_count,
                  (SELECT COUNT(*) FROM absences ab
                   WHERE ab.week_plan_id = wp.id) AS absence_count
           FROM week_plans wp
           WHERE wp.start_date = %s
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

    saved_artist_plan = db.get_artist_plan_by_start(conn, start_date)
    saved_rehearsal_plan = db.get_rehearsal_plan_by_start(conn, start_date)
    rehearsal_events = [
        dict(row)
        for row in db.get_rehearsal_events(
            conn, week_dates_iso[0], week_dates_iso[-1]
        )
    ]
    previous_workload = stats.previous_week_workload(conn, start)
    kw = week["kw"] or start.isocalendar()[1]

    # AP6: schedule/memory_data einmal pro Request berechnen und an alle
    # Konsumenten im gemeinsamen Builder weiterreichen (statt mehrfach über
    # on_stage_by_date/on_stage_shows_by_date neu aufzubauen).
    schedule = memory.show_schedule(conn, week_dates_iso[0], week_dates_iso[-1], template_code)
    memory_data = memory.build_memory(conn)
    shared_fields = _build_shared_plan_fields(
        conn,
        week_dates_iso=week_dates_iso,
        grid_rows=grid_rows,
        active_people=active_people,
        saved_artist_plan=saved_artist_plan,
        saved_rehearsal_plan=saved_rehearsal_plan,
        previous_workload=previous_workload,
        template_code=template_code,
        memory_data=memory_data,
        schedule=schedule,
    )

    return {
        "rows": grid_rows,
        "day_labels": shared_fields["day_labels"],
        "week_dates_iso": week_dates_iso,
        "person_categories": shared_fields["person_categories"],
        "assignment_rules": shared_fields["assignment_rules"],
        "template_week_id": week["id"],
        "template_code": template_code,
        "xlsx_sheet": selected_template["sheet"],
        "artist_plan": shared_fields["artist_plan"],
        "rehearsal_plan": shared_fields["rehearsal_plan"],
        "rehearsal_intervals": shared_fields["rehearsal_intervals"],
        "show_dates": sorted(rehearsal_plan.detect_show_dates(rehearsal_events)),
        "on_stage_by_date": shared_fields["on_stage_by_date"],
        "on_stage_shows_by_date": shared_fields["on_stage_shows_by_date"],
        "deko_people": shared_fields["deko_people"],
        "previous_week": shared_fields["previous_week"],
        "previous_week_workload": shared_fields["previous_week_workload"],
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


@router.post("/api/plan/generate")
def plan_generate(
    payload: PlanGenerateRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
    new_start = datetime.strptime(payload.new_start, "%Y-%m-%d").date()
    absent_by_date: dict[str, set[str]] = {}
    for a in payload.absences:
        absent_by_date.setdefault(a.date, set()).add(a.person)

    rotation_week_id = _rotation_week_id(conn, payload.template_code, payload.template_week_id)

    # AP6: `_week_dates` ist eine reine Funktion (kein DB-/Netzwerkzugriff, siehe
    # `_week_dates` weiter oben) und kann deshalb vorgezogen werden, um schedule/
    # memory_data einmal pro Request zu berechnen und sowohl an
    # generate_week_draft() als auch an den gemeinsamen Response-Builder
    # weiterzureichen, statt sie mehrfach neu aufzubauen.
    week_dates_iso = _week_dates(payload.new_start)
    schedule = memory.show_schedule(
        conn, week_dates_iso[0], week_dates_iso[-1], payload.template_code
    )
    memory_data = memory.build_memory(conn)

    draft, show_dates = assignment.generate_week_draft(
        conn, rotation_week_id, new_start, absent_by_date,
        template_code=payload.template_code,
        memory_data=memory_data, schedule=schedule,
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

    saved_rehearsal_plan = db.get_rehearsal_plan_by_start(
        conn, payload.new_start
    )
    active_people = [dict(p) for p in db.get_all_people(conn, active_only=True)]
    previous_workload = stats.previous_week_workload(conn, new_start)
    draft = assignment.add_relief_rewards(
        draft,
        active_people,
        week_dates_iso,
        absent_by_date,
        show_dates,
    )
    grid_df = grid.build_grid(draft, week_dates_iso)
    grid_rows = records(grid_df)

    shared_fields = _build_shared_plan_fields(
        conn,
        week_dates_iso=week_dates_iso,
        grid_rows=grid_rows,
        active_people=active_people,
        saved_artist_plan=saved_artist_plan,
        saved_rehearsal_plan=saved_rehearsal_plan,
        previous_workload=previous_workload,
        template_code=payload.template_code,
        memory_data=memory_data,
        schedule=schedule,
    )

    return {
        "rows": grid_rows,
        "day_labels": shared_fields["day_labels"],
        "week_dates_iso": week_dates_iso,
        "person_categories": shared_fields["person_categories"],
        "assignment_rules": shared_fields["assignment_rules"],
        "template_week_id": rotation_week_id,
        "template_code": selected_template["code"] if selected_template else None,
        "xlsx_sheet": selected_template["sheet"] if selected_template else None,
        "artist_plan": shared_fields["artist_plan"],
        "rehearsal_plan": shared_fields["rehearsal_plan"],
        "rehearsal_intervals": shared_fields["rehearsal_intervals"],
        "show_dates": sorted(show_dates),
        "on_stage_by_date": shared_fields["on_stage_by_date"],
        "on_stage_shows_by_date": shared_fields["on_stage_shows_by_date"],
        "deko_people": shared_fields["deko_people"],
        "previous_week": shared_fields["previous_week"],
        "previous_week_workload": shared_fields["previous_week_workload"],
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
    audit_events: list[dict[str, Any]] = []


def _assignment_warnings(
    conn,
    assignments_list: list[dict],
    start_date: str | None = None,
    person_lookup: db.PersonLookup | None = None,
) -> list[str]:
    """AP5a: löst Personen über eine einmalig geladene PersonLookup auf, statt pro
    Zuweisung eigene Alias-/Namens- und Abteilungs-Queries auszuführen. Ohne
    übergebene `person_lookup` wird intern genau einmal eine geladen."""
    lookup = person_lookup if person_lookup is not None else db.load_person_lookup(conn)
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
        person_entry = lookup.resolve(name)
        person_id = person_entry.person_id if person_entry else None
        department = person_entry.department if person_entry else None
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
            resolved = lookup.resolve(name) if name else None
            person_id = resolved.person_id if resolved else None
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


@router.post("/api/plan/save")
def plan_save(
    payload: PlanSaveRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
    day_iso_by_label = {
        lbl: iso for lbl, iso in zip(payload.day_labels, _week_dates(payload.start_date))
    }
    grid_df = _grid_df_from_rows(payload.rows)
    assignments_list, absences_list = grid.parse_grid(grid_df, day_iso_by_label)
    # AP5a: eine Lookup für die gesamte Speicheroperation - Warnungsberechnung UND
    # Zuweisungs-/Abwesenheits-Schleife teilen sich dieselbe Map. Neuanlagen in der
    # Schleife unten aktualisieren dieselbe Instanz sofort (siehe _resolve_or_create),
    # sodass spätere Zeilen desselben Saves keine erneute Vollabfrage brauchen.
    person_lookup = db.load_person_lookup(conn)
    warnings = _assignment_warnings(conn, assignments_list, payload.start_date, person_lookup)

    existing_week_id = payload.existing_week_id
    if existing_week_id is None:
        # Speichern ist pro Planwoche idempotent: Sollte das Frontend nach dem
        # ersten erfolgreichen Speichern noch keinen Archivstatus kennen (z.B.
        # bei einem sehr schnellen zweiten Klick oder nach einem Teil-Reload),
        # darf dadurch kein zweiter Dienstplan für dasselbe Startdatum entstehen.
        existing_for_start = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = %s ORDER BY id DESC LIMIT 1",
            (payload.start_date,),
        ).fetchone()
        if existing_for_start is not None:
            existing_week_id = existing_for_start["id"]

    if existing_week_id is not None:
        existing = conn.execute(
            "SELECT id, start_date FROM week_plans WHERE id = %s",
            (existing_week_id,),
        ).fetchone()
        if existing is None or existing["start_date"] != payload.start_date:
            raise HTTPException(404, "Der zu bearbeitende Archivplan wurde nicht gefunden.")
        week_plan_id = existing_week_id
        conn.execute("DELETE FROM assignments WHERE week_plan_id = %s", (week_plan_id,))
        conn.execute("DELETE FROM absences WHERE week_plan_id = %s", (week_plan_id,))
        conn.execute(
            "UPDATE week_plans SET end_date = %s WHERE id = %s",
            (payload.end_date, week_plan_id),
        )
    else:
        week_plan_id = db.insert_week_plan(
            conn, None, payload.start_date, payload.end_date,
            f"Generiert (Vorlage KW-ID {payload.template_week_id})",
        )
    for a in assignments_list:
        person_name = (a.get("person") or "").strip()
        person_id = _resolve_or_create(conn, person_name, person_lookup) if person_name else None
        db.insert_assignment(conn, week_plan_id, a["date"], a["category"], a.get("subcategory"), person_id, a.get("raw_text"))
    for a in absences_list:
        person_id = _resolve_or_create(conn, a["person"], person_lookup)
        db.insert_absence(conn, week_plan_id, a["date"], person_id, a["type"])
    intelligence_audit.record_events(
        conn,
        week_plan_id=week_plan_id,
        start_date=payload.start_date,
        events=payload.audit_events,
    )
    intelligence_audit.record_plan_saved(
        conn,
        week_plan_id=week_plan_id,
        start_date=payload.start_date,
        assignments=len(assignments_list),
    )
    conn.commit()
    week_row = conn.execute(
        """SELECT wp.*,
                  (SELECT COUNT(*) FROM assignments a WHERE a.week_plan_id = wp.id) AS assignment_count,
                  (SELECT COUNT(*) FROM absences ab WHERE ab.week_plan_id = wp.id) AS absence_count
           FROM week_plans wp WHERE wp.id = %s""",
        (week_plan_id,),
    ).fetchone()
    kw = week_row["kw"] or datetime.strptime(
        week_row["start_date"], "%Y-%m-%d"
    ).date().isocalendar()[1]
    return {
        "week_plan_id": week_plan_id,
        "warnings": warnings,
        "week": {
            "id": week_plan_id,
            "kw": kw,
            "start_date": week_row["start_date"],
            "end_date": week_row["end_date"],
            "source": week_row["source_pdf"],
            "label": f"KW{kw} · {util.fmt_date_range(week_row['start_date'], week_row['end_date'])}",
            "assignment_count": week_row["assignment_count"],
            "absence_count": week_row["absence_count"],
        },
    }


def _resolve_or_create(conn, name: str, person_lookup: db.PersonLookup | None = None) -> int:
    """AP5a: löst über eine vorab geladene PersonLookup auf, statt bei jedem Aufruf
    erneut zu fragen. Legt exakt wie bisher eine neue Person an, wenn keine Auflösung
    gefunden wird - und trägt die Neuanlage sofort in dieselbe Lookup-Instanz ein,
    damit spätere Zeilen desselben Saves sie ohne erneute Datenbankabfrage finden
    (keine doppelte Personenerstellung innerhalb desselben Saves)."""
    if person_lookup is not None:
        entry = person_lookup.resolve(name)
        if entry is not None:
            return entry.person_id
        person_id = db.create_person(conn, name)
        person_lookup.register_person(person_id, name)
        return person_id
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


@router.post("/api/xlsx/generate")
def xlsx_generate(
    payload: XlsxGenerateRequest,
    conn: db.Connection = Depends(db.get_db_connection),
):
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
