"""Tests für AP5c (Team-Übersicht mit einmalig berechnetem Memory).

Deckt ab:
  - build_memory() läuft für einen Team-Overview-Request genau einmal, unabhängig
    von der Personenzahl (Schritt 8)
  - eine leere Personenliste löst keinen unnötigen build_memory()-Aufruf aus
  - eine einzelne Person liefert unverändertes Ergebnis
  - eine Exception in der Personenschleife propagiert weiterhin wie zuvor
    (keine neue, stillschweigende Fehlerbehandlung)
  - die Anzahl memory-bedingter Vollscan-Aufrufe wächst nicht linear mit der
    Personenzahl (Schritt 9, Query-Count-Regressionsschutz)

Immer gegen eine temporäre, per monkeypatch umgeleitete Testdatenbank - nie
gegen die echte lokale Mitarbeiterdatenbank.
"""
from __future__ import annotations

import pytest

from backend import db, memory
from backend.intelligence import employee_stats, memory_engine, team_overview


def _conn(tmp_path, monkeypatch, filename: str):
    """AP4-Konvention: get_conn() legt kein Schema mehr an, deshalb hier einmalig
    explizit initialize_database() aufrufen."""
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / filename)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    db.initialize_database()
    return db.get_conn()


def _spy_build_memory(monkeypatch):
    counter = {"n": 0}
    real_build_memory = memory.build_memory

    def counting(conn):
        counter["n"] += 1
        return real_build_memory(conn)

    monkeypatch.setattr(memory, "build_memory", counting)
    return counter


def _make_people(conn, count: int) -> list[int]:
    ids = []
    for i in range(count):
        person_id = db.create_person(conn, f"Person{i}", "SPT")
        ids.append(person_id)
    conn.commit()
    return ids


def _add_history(conn, person_id: int, start="2026-07-27", end="2026-08-02"):
    week_id = db.insert_week_plan(conn, 31, start, end, "Test")
    db.insert_assignment(conn, week_id, start, "Moderation + Getränkedienst", None, person_id, None)
    conn.commit()


# ---------- Schritt 8: Call-Count-Tests ----------


def test_team_overview_calls_build_memory_exactly_once_for_multiple_people(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "multi.db")
    ids = _make_people(conn, 5)
    for person_id in ids:
        _add_history(conn, person_id)

    counter = _spy_build_memory(monkeypatch)
    entries_counter = {"n": 0}
    stats_counter = {"n": 0}
    real_entries = memory_engine.entries_for_person
    real_stats = employee_stats.calculate_employee_statistics

    def counting_entries(conn_, person_id, **kwargs):
        entries_counter["n"] += 1
        return real_entries(conn_, person_id, **kwargs)

    def counting_stats(conn_, person_id, **kwargs):
        stats_counter["n"] += 1
        return real_stats(conn_, person_id, **kwargs)

    monkeypatch.setattr(memory_engine, "entries_for_person", counting_entries)
    monkeypatch.setattr(employee_stats, "calculate_employee_statistics", counting_stats)

    result = team_overview.build_team_overview(conn, current_week_start="2026-07-27")

    assert counter["n"] == 1, "build_memory() darf für den gesamten Request nur einmal laufen"
    assert entries_counter["n"] == len(ids)
    assert stats_counter["n"] == len(ids)
    assert len(result["people"]) == len(ids)


def test_team_overview_with_empty_people_list_does_not_call_build_memory(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "empty.db")
    counter = _spy_build_memory(monkeypatch)

    result = team_overview.build_team_overview(conn, current_week_start="2026-07-27")

    assert result["people"] == []
    assert result["summary"]["active_people"] == 0
    assert counter["n"] == 0, "ohne Personen wird niemand die Daten brauchen - kein unnötiger Aufbau"


def test_team_overview_with_single_person_matches_previous_behaviour(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "single.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    _add_history(conn, person_id)

    # Referenzergebnis: derselbe Datenfluss, aber ohne den neuen memory_data-Parameter
    # zu benutzen (entspricht 1:1 dem Vorher-Verhalten dieser beiden Funktionen).
    baseline_stats = employee_stats.calculate_employee_statistics(
        conn, person_id, current_week_start="2026-07-27"
    )
    baseline_entries = memory_engine.entries_for_person(conn, person_id)

    counter = _spy_build_memory(monkeypatch)
    result = team_overview.build_team_overview(conn, current_week_start="2026-07-27")

    assert counter["n"] == 1
    assert len(result["people"]) == 1
    row = result["people"][0]
    assert row["person_id"] == person_id
    assert row["history_assignments"] == baseline_stats["summary"]["assignments"]
    assert row["memory_count"] == len(baseline_entries)
    assert row["top_skills"] == [
        {"id": s["id"], "name": s["name"], "level": s["level"], "source": s["source"]}
        for s in baseline_stats["skills"][:3]
    ]


def test_team_overview_propagates_person_errors_like_before(tmp_path, monkeypatch):
    """Es gab vorher keine Fehlerisolation pro Person - eine Exception in der
    Schleife liess den gesamten Request fehlschlagen. Das darf sich durch den
    zentralen Memory-Aufbau nicht ändern."""
    conn = _conn(tmp_path, monkeypatch, "error.db")
    db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    def raising_stats(conn_, person_id, **kwargs):
        raise RuntimeError("simulierter Fehler in der Personenschleife")

    monkeypatch.setattr(employee_stats, "calculate_employee_statistics", raising_stats)

    with pytest.raises(RuntimeError, match="simulierter Fehler"):
        team_overview.build_team_overview(conn, current_week_start="2026-07-27")

    # Die Connection bleibt in der Verantwortung des Aufrufers (FastAPI-Dependency) -
    # hier nur sicherstellen, dass sie nach der Exception noch normal nutzbar ist
    # (kein interner Teil-Commit/-Zustand hat sie kaputt gemacht).
    conn.execute("SELECT 1").fetchone()


# ---------- Schritt 9: Query-Count-Regressionstest ----------


def test_memory_build_calls_do_not_grow_with_person_count(tmp_path, monkeypatch):
    def measure(n_people: int, filename: str) -> int:
        conn = _conn(tmp_path, monkeypatch, filename)
        ids = _make_people(conn, n_people)
        for person_id in ids:
            _add_history(conn, person_id)
        counter = _spy_build_memory(monkeypatch)
        team_overview.build_team_overview(conn, current_week_start="2026-07-27")
        conn.close()
        return counter["n"]

    calls_small = measure(2, "scale-small.db")
    calls_large = measure(8, "scale-large.db")

    assert calls_small == 1
    assert calls_large == 1, (
        f"build_memory()-Aufrufe dürfen nicht mit der Personenzahl wachsen: "
        f"2 Personen -> {calls_small}, 8 Personen -> {calls_large}"
    )
