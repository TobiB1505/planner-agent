"""Isolierte Tests für Frei-Muster und manuelle MA-Gedächtnis-Overrides."""
from __future__ import annotations

import json

import pytest

from backend import db, memory


TARGET_WEEK = [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-09",
]


@pytest.fixture
def memory_db():
    """Eigenständige Verbindung auf ein isoliertes PostgreSQL-Testschema.

    Ersetzt die frühere SQLite-In-Memory-Datenbank (siehe conftest.py) - die
    produktive Planungsdatenbank bleibt unberührt.
    """
    conn = db.create_connection()
    try:
        yield conn
    finally:
        conn.close()


def _person_with_monday_tuesday_history(conn, name: str = "Nina") -> int:
    person_id = db.create_person(conn, name, "SPT")
    week_id = db.insert_week_plan(
        conn, 23, "2026-06-01", "2026-06-21", "isolierter-test"
    )
    for date_iso in (
        "2026-06-01", "2026-06-02",
        "2026-06-08", "2026-06-09",
        "2026-06-15", "2026-06-16",
    ):
        db.insert_absence(conn, week_id, date_iso, person_id, "Frei")
    conn.commit()
    return person_id


def _suggestion_for(result: dict, name: str) -> dict | None:
    return next(
        (item for item in result["suggestions"] if item["person"] == name),
        None,
    )


def test_derived_free_pattern_suggests_the_observed_weekdays(memory_db):
    _person_with_monday_tuesday_history(memory_db)

    result = memory.suggest_free_days(memory_db, TARGET_WEEK, [])
    suggestion = _suggestion_for(result, "Nina")

    assert result["quota"] == 2
    assert suggestion is not None
    assert suggestion["dates"] == ["2026-08-03", "2026-08-04"]
    assert suggestion["weekdays"] == [0, 1]
    assert suggestion["source"] == "abgeleitet"


def test_existing_absence_blocks_day_and_existing_free_reduces_quota(memory_db):
    _person_with_monday_tuesday_history(memory_db)

    result = memory.suggest_free_days(
        memory_db,
        TARGET_WEEK,
        [{"person": "Nina", "date": "2026-08-03", "type": "Frei"}],
    )
    suggestion = _suggestion_for(result, "Nina")

    assert suggestion is not None
    assert suggestion["dates"] == ["2026-08-04"]


def test_pinned_free_override_replaces_derived_pattern(memory_db):
    person_id = _person_with_monday_tuesday_history(memory_db)
    db.set_memory_override(
        memory_db,
        person_id,
        "free",
        "weekdays",
        "pinned",
        value=json.dumps({"weekdays": [4, 5]}),
    )

    result = memory.suggest_free_days(memory_db, TARGET_WEEK, [])
    suggestion = _suggestion_for(result, "Nina")

    assert suggestion is not None
    assert suggestion["dates"] == ["2026-08-07", "2026-08-08"]
    assert suggestion["weekdays"] == [4, 5]
    assert suggestion["source"] == "manuell"


def test_empty_pinned_override_intentionally_disables_free_suggestion(memory_db):
    person_id = _person_with_monday_tuesday_history(memory_db)
    db.set_memory_override(
        memory_db,
        person_id,
        "free",
        "weekdays",
        "pinned",
        value=json.dumps({"weekdays": []}),
    )

    result = memory.suggest_free_days(memory_db, TARGET_WEEK, [])

    assert _suggestion_for(result, "Nina") is None
    assert "Nina" in result["needs_manual"]

