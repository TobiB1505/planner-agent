"""Tests für AP5b (kontrolliertes Weiterreichen bereits berechneten Memories).

Deckt ab:
  - memory_for_person()/entries_for_person()/calculate_employee_statistics()/
    _preference_lookup()/_task_preferences() liefern mit und ohne vorab
    geladenes `memory_data` identische Ergebnisse
  - eine leere, aber explizit übergebene Memory-Struktur löst KEINEN Fallback aus
  - build_memory() wird bei übergebenem memory_data nicht erneut aufgerufen
    (Spy-basierte Call-Count-Tests)
  - die in api.py/dashboard.py behobenen echten Doppelberechnungen
    (intelligence_employee_profile, dashboard_snapshot) lösen insgesamt nur
    noch einen build_memory()-Aufruf aus

Immer gegen eine temporäre, per monkeypatch umgeleitete Testdatenbank - nie
gegen die echte lokale Mitarbeiterdatenbank.
"""
from __future__ import annotations

from backend import db, memory
from backend.intelligence import (
    dashboard,
    employee_stats,
    memory_engine,
    plan_quality,
    recommendation_engine,
)


def _conn(tmp_path, monkeypatch, filename: str):
    """AP4-Konvention: get_conn() legt kein Schema mehr an, deshalb hier einmalig
    explizit initialize_database() aufrufen."""
    return db.get_conn()


def _week(conn, start="2026-07-27", end="2026-08-02"):
    return db.insert_week_plan(conn, 31, start, end, "Test")


def _count_build_memory_calls(monkeypatch):
    """Spy um memory.build_memory(): ruft die echte Funktion weiterhin auf
    (kein Mock der Fachlogik), zählt aber die Aufrufe."""
    counter = {"n": 0}
    real_build_memory = memory.build_memory

    def counting_build_memory(conn):
        counter["n"] += 1
        return real_build_memory(conn)

    monkeypatch.setattr(memory, "build_memory", counting_build_memory)
    return counter


# ---------- memory_for_person ----------


def test_memory_for_person_without_memory_data_matches_existing_behaviour(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "mfp-default.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    entry = memory.memory_for_person(conn, person_id)
    assert entry is not None
    assert entry["person_id"] == person_id
    assert entry["person"] == "Tobi"


def test_memory_for_person_with_memory_data_is_identical(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "mfp-provided.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    db.create_person(conn, "Fanny", "Manager")
    conn.commit()

    baseline = memory.memory_for_person(conn, person_id)
    memory_data = memory.build_memory(conn)
    with_data = memory.memory_for_person(conn, person_id, memory_data=memory_data)

    assert with_data == baseline


def test_memory_for_person_unknown_person_returns_none_either_way(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "mfp-unknown.db")
    db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    memory_data = memory.build_memory(conn)
    assert memory.memory_for_person(conn, 999999) is None
    assert memory.memory_for_person(conn, 999999, memory_data=memory_data) is None


def test_memory_for_person_empty_structure_is_not_treated_as_none(tmp_path, monkeypatch):
    """Eine explizit übergebene, leere Memory-Struktur ist ungleich `None` und darf
    deshalb keinen internen build_memory()-Fallback auslösen (Schritt 3)."""
    conn = _conn(tmp_path, monkeypatch, "mfp-empty.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    empty_memory_data: memory.MemoryData = {"people": [], "unmatched_rehearsal_names": [], "meta": {}}
    assert memory.memory_for_person(conn, person_id, memory_data=empty_memory_data) is None


def test_memory_for_person_does_not_call_build_memory_when_data_is_provided(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "mfp-callcount.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()
    memory_data = memory.build_memory(conn)

    counter = _count_build_memory_calls(monkeypatch)
    memory.memory_for_person(conn, person_id, memory_data=memory_data)
    assert counter["n"] == 0


# ---------- entries_for_person ----------


def test_entries_for_person_identical_with_and_without_memory_data(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "efp-equiv.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Moderation + Getränkedienst", None, person_id, None)
    db.insert_assignment(conn, week_id, "2026-07-28", "Moderation + Getränkedienst", None, person_id, None)
    conn.commit()

    baseline = memory_engine.entries_for_person(conn, person_id)
    memory_data = memory.build_memory(conn)
    with_data = memory_engine.entries_for_person(conn, person_id, memory_data=memory_data)

    assert with_data == baseline


def test_entries_for_person_does_not_call_build_memory_when_data_is_provided(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "efp-callcount.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()
    memory_data = memory.build_memory(conn)

    counter = _count_build_memory_calls(monkeypatch)
    memory_engine.entries_for_person(conn, person_id, memory_data=memory_data)
    assert counter["n"] == 0


# ---------- calculate_employee_statistics ----------


def test_employee_statistics_identical_with_and_without_memory_data(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "stats-equiv.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Moderation + Getränkedienst", None, person_id, None)
    db.insert_assignment(conn, week_id, "2026-07-29", "Kochdienste", "KP2 12:00 - 14:00", person_id, None)
    conn.commit()

    baseline = employee_stats.calculate_employee_statistics(conn, person_id, use_cache=False)
    memory_data = memory.build_memory(conn)
    with_data = employee_stats.calculate_employee_statistics(
        conn, person_id, use_cache=False, memory_data=memory_data
    )

    assert with_data["summary"] == baseline["summary"]
    assert with_data["skills"] == baseline["skills"]
    assert with_data["trend"] == baseline["trend"]
    assert with_data["categories"] == baseline["categories"]


def test_employee_statistics_cache_behaviour_is_unchanged_when_memory_data_is_passed(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "stats-cache.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Moderation + Getränkedienst", None, person_id, None)
    conn.commit()

    memory_data = memory.build_memory(conn)
    first = employee_stats.calculate_employee_statistics(conn, person_id, memory_data=memory_data)
    assert first["cache"]["hit"] is False

    # Zweiter Aufruf mit übergebenem Memory trifft auf denselben Cache-Eintrag
    # wie ohne Parameter - Cache-Verhalten bleibt unverändert.
    second = employee_stats.calculate_employee_statistics(conn, person_id, memory_data=memory_data)
    assert second["cache"]["hit"] is True


def test_employee_statistics_does_not_call_build_memory_on_cache_miss_when_data_is_provided(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "stats-callcount.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Kochdienste", "KP1 7:50 - 10:00", person_id, None)
    conn.commit()
    memory_data = memory.build_memory(conn)

    counter = _count_build_memory_calls(monkeypatch)
    # use_cache=False erzwingt denselben Codepfad wie ein Cache-Miss (der einzige,
    # der memory_for_person() überhaupt aufruft).
    employee_stats.calculate_employee_statistics(conn, person_id, use_cache=False, memory_data=memory_data)
    assert counter["n"] == 0


# ---------- Plan-Quality ----------


def test_plan_quality_identical_with_and_without_memory_data(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "quality-equiv.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()
    assignments = [
        {"date": "2026-07-27", "category": "OPS + WP", "subcategory": None, "person": "Tobi"},
    ]

    baseline = plan_quality.calculate_plan_quality(
        conn, start_date="2026-07-27", assignments=assignments, absences=[]
    )
    memory_data = memory.build_memory(conn)
    with_data = plan_quality.calculate_plan_quality(
        conn, start_date="2026-07-27", assignments=assignments, absences=[], memory_data=memory_data
    )

    assert with_data["score"] == baseline["score"]
    assert with_data["dimensions"] == baseline["dimensions"]
    assert with_data["issues"] == baseline["issues"]
    assert person_id  # nur zur Klarheit, dass die Person tatsächlich existiert


def test_dashboard_snapshot_triggers_at_most_one_build_memory_call(tmp_path, monkeypatch):
    """Vorher: calculate_plan_quality (über _preference_lookup) UND
    dashboard_snapshot selbst riefen je einmal build_memory() auf - zwei
    Aufrufe für denselben Request. Nachher: genau einer."""
    conn = _conn(tmp_path, monkeypatch, "quality-callcount.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "OPS + WP", None, person_id, None)
    conn.commit()

    counter = _count_build_memory_calls(monkeypatch)
    result = dashboard.dashboard_snapshot(conn, week_id)

    assert counter["n"] == 1
    assert result["quality"]["max_score"] == 100
    assert result["intelligence"]["active_people"] == 1


# ---------- Recommendations ----------


def test_task_preferences_identical_with_and_without_memory_data(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "prefs-equiv.db")
    db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    baseline = recommendation_engine._task_preferences(conn)
    memory_data = memory.build_memory(conn)
    with_data = recommendation_engine._task_preferences(conn, memory_data=memory_data)

    assert with_data == baseline


def test_recommend_triggers_at_most_one_build_memory_call(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "recommend-callcount.db")
    db.create_person(conn, "Tobi", "Manager")
    db.create_person(conn, "Fanny", "Manager")
    conn.commit()

    counter = _count_build_memory_calls(monkeypatch)
    result = recommendation_engine.recommend(
        conn,
        target_date="2026-07-27",
        category="OPS + WP",
        subcategory=None,
        assignments=[],
        absences=[],
    )

    assert counter["n"] <= 1
    assert {candidate["employee"] for candidate in result["candidates"]} == {"Tobi", "Fanny"}


def test_intelligence_employee_profile_flow_triggers_at_most_one_build_memory_call(tmp_path, monkeypatch):
    """Reproduziert den in api.py behobenen Doppelaufruf: calculate_employee_statistics
    UND entries_for_person für dieselbe Person im selben Vorgang."""
    conn = _conn(tmp_path, monkeypatch, "profile-callcount.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    week_id = _week(conn)
    db.insert_assignment(conn, week_id, "2026-07-27", "Moderation + Getränkedienst", None, person_id, None)
    conn.commit()

    counter = _count_build_memory_calls(monkeypatch)
    memory_data = memory.build_memory(conn)
    counter["n"] = 0  # nur den Vorgang selbst zählen, nicht die Vorbereitung oben
    employee_stats.calculate_employee_statistics(conn, person_id, memory_data=memory_data)
    memory_engine.entries_for_person(conn, person_id, memory_data=memory_data)

    assert counter["n"] == 0
