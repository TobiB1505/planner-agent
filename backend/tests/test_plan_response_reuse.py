"""Tests für AP6 (plan_generate/plan_existing entdoppeln, gemeinsame Daten nur
einmal berechnen).

Deckt ab:
  - GET /api/plan/existing und POST /api/plan/generate rufen build_memory()
    und show_schedule() pro Request jeweils genau einmal auf, unabhängig davon
    wie viele interne Konsumenten (on_stage_by_date, on_stage_shows_by_date,
    generate_week_draft/planning_signals) die Daten brauchen (Schritt 12).
  - assignment.generate_week_draft liefert mit und ohne vorab berechnetem
    memory_data/schedule ein identisches Ergebnis (Schritt 11, Äquivalenz).

Immer gegen eine temporäre, per monkeypatch umgeleitete Testdatenbank - nie
gegen die echte lokale Mitarbeiterdatenbank. Die Excel-Grundvorlagen unter
backend/resources/templates/ sind feste Projektressourcen (kein Nutzerdaten,
siehe backend/config/paths.py) und dürfen von Tests gelesen werden.
"""
from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from backend import api, assignment, db, memory


def _init_db(tmp_path, monkeypatch, filename: str):
    """AP4-Konvention: get_conn() legt kein Schema mehr an, deshalb hier einmalig
    explizit initialize_database() aufrufen."""


def _seed_week(conn, start="2026-07-27", end="2026-08-02", kw=31) -> int:
    person_id = db.create_person(conn, "Tobi", "SPT")
    week_id = db.insert_week_plan(conn, kw, start, end, "Test")
    db.insert_assignment(
        conn, week_id, start, "Moderation + Getränkedienst", None, person_id, None
    )
    conn.commit()
    return week_id


def _spy(monkeypatch, obj, name):
    counter = {"n": 0}
    real = getattr(obj, name)

    def counting(*args, **kwargs):
        counter["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(obj, name, counting)
    return counter


# ---------- Schritt 12: Call-Count-Tests ----------


def test_plan_existing_calls_build_memory_and_show_schedule_exactly_once(tmp_path, monkeypatch):
    _init_db(tmp_path, monkeypatch, "existing.db")
    conn = db.get_conn()
    _seed_week(conn)
    conn.close()

    build_memory_counter = _spy(monkeypatch, memory, "build_memory")
    show_schedule_counter = _spy(monkeypatch, memory, "show_schedule")

    with TestClient(api.app) as client:
        response = client.get("/api/plan/existing", params={"start_date": "2026-07-27"})

    assert response.status_code == 200
    assert build_memory_counter["n"] == 1, "build_memory() darf pro Request nur einmal laufen"
    assert show_schedule_counter["n"] == 1, "show_schedule() darf pro Request nur einmal laufen"


def test_plan_generate_calls_build_memory_and_show_schedule_exactly_once(tmp_path, monkeypatch):
    _init_db(tmp_path, monkeypatch, "generate.db")
    conn = db.get_conn()
    week_id = _seed_week(conn)
    conn.close()

    build_memory_counter = _spy(monkeypatch, memory, "build_memory")
    show_schedule_counter = _spy(monkeypatch, memory, "show_schedule")

    with TestClient(api.app) as client:
        response = client.post(
            "/api/plan/generate",
            json={
                "template_week_id": week_id,
                "new_start": "2026-08-10",
                "absences": [],
            },
        )

    assert response.status_code == 200
    assert build_memory_counter["n"] == 1, "build_memory() darf pro Request nur einmal laufen"
    assert show_schedule_counter["n"] == 1, "show_schedule() darf pro Request nur einmal laufen"


def test_plan_generate_with_template_code_calls_build_memory_and_show_schedule_exactly_once(
    tmp_path, monkeypatch
):
    """Wie oben, aber mit template_code gesetzt - zusätzlicher Excel-Lesepfad
    (xlsx_template.read_template_content) darf die Zähler nicht beeinflussen."""
    _init_db(tmp_path, monkeypatch, "generate-template.db")
    conn = db.get_conn()
    _seed_week(conn)
    conn.close()

    build_memory_counter = _spy(monkeypatch, memory, "build_memory")
    show_schedule_counter = _spy(monkeypatch, memory, "show_schedule")

    with TestClient(api.app) as client:
        response = client.post(
            "/api/plan/generate",
            json={
                "template_code": "A",
                "new_start": "2026-08-10",
                "absences": [],
            },
        )

    assert response.status_code == 200
    assert build_memory_counter["n"] == 1
    assert show_schedule_counter["n"] == 1


# ---------- Schritt 11: Äquivalenz generate_week_draft mit/ohne Vorab-Daten ----------


def test_generate_week_draft_identical_with_and_without_precomputed_data(tmp_path, monkeypatch):
    _init_db(tmp_path, monkeypatch, "equiv.db")
    conn = db.get_conn()
    week_id = _seed_week(conn)

    new_start = date(2026, 8, 10)
    week_end_iso = "2026-08-16"

    draft_a, show_dates_a = assignment.generate_week_draft(conn, week_id, new_start, {})

    schedule = memory.show_schedule(conn, new_start.isoformat(), week_end_iso, None)
    memory_data = memory.build_memory(conn)
    draft_b, show_dates_b = assignment.generate_week_draft(
        conn, week_id, new_start, {}, memory_data=memory_data, schedule=schedule,
    )

    assert draft_a == draft_b
    assert show_dates_a == show_dates_b
    conn.close()
