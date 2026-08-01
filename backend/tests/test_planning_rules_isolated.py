"""Isolierte Tests der fachlichen Planungsregeln.

Die Tests verwenden nur reine Funktionen oder eine SQLite-In-Memory-Datenbank.
Die produktive Planner-Agent-Datenbank wird weder geöffnet noch verändert.
"""
from __future__ import annotations

import sqlite3

import pytest

from backend import db, planning_rules, rehearsal_plan
from backend.api import _assignment_warnings


TEAM = [
    {"name": "Sven", "department": "SPT"},
    {"name": "Dylana", "department": "T&C / Choreografie"},
    {"name": "Fanny", "department": "Manager"},
    {"name": "Luca", "department": "S&L"},
    {"name": "Mara", "department": "Deko"},
]


@pytest.fixture
def memory_db():
    """Vollständiges Schema im RAM für kleine Integrationsprüfungen."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.SCHEMA)
    try:
        yield conn
    finally:
        conn.close()


def test_normal_sport_prefers_spt_but_remains_manually_overridable():
    rule = planning_rules.assignment_rule(TEAM, "Sportprogramm", "15:30 BVB")

    assert rule is not None
    assert rule["id"] == "sport_spt"
    assert rule["recommended_people"] == ["Sven"]
    assert set(rule["allowed_people"]) == {person["name"] for person in TEAM}
    assert rule["blocked_people"] == []
    assert rule["hard_rule"] is False

    tc_manual = planning_rules.person_decision(
        "Dylana",
        "T&C / Choreografie",
        "Sportprogramm",
        "15:30 BVB",
        automatic=False,
    )
    tc_automatic = planning_rules.person_decision(
        "Dylana",
        "T&C / Choreografie",
        "Sportprogramm",
        "15:30 BVB",
        automatic=True,
    )
    assert tc_manual["allowed"] is True
    assert tc_automatic["allowed"] is False
    assert tc_automatic["recommended"] is False

    deko_automatic = planning_rules.person_decision(
        "Mara", "Deko", "Sportprogramm", "15:30 BVB", automatic=True
    )
    assert deko_automatic["allowed"] is True
    assert deko_automatic["recommended"] is False


def test_guests_vs_robins_keeps_tc_manual_but_out_of_automatic_selection():
    manual = planning_rules.person_decision(
        "Dylana",
        "T&C",
        "Sportprogramm",
        "15:30 Gäste vs Robins BVB",
        automatic=False,
    )
    automatic = planning_rules.person_decision(
        "Dylana",
        "T&C",
        "Sportprogramm",
        "15:30 Gäste vs Robins BVB",
        automatic=True,
    )

    assert manual["rule_id"] == "sport_guests_vs_robins"
    assert manual["allowed"] is True
    assert automatic["allowed"] is False
    assert planning_rules.hard_violation(
        "Dylana", "T&C", "Sportprogramm", "15:30 Gäste vs Robins BVB"
    ) is None


def test_ops_prefers_manager_without_blocking_other_departments():
    rule = planning_rules.assignment_rule(TEAM, "OPS + WP", "11:00 OPS")

    assert rule is not None
    assert rule["id"] == "ops_managers"
    assert rule["recommended_people"] == ["Fanny"]
    assert set(rule["allowed_people"]) == {person["name"] for person in TEAM}
    assert rule["blocked_people"] == []
    assert rule["hard_rule"] is False


def test_kp3_avoids_sound_and_light_without_hard_blocking_it():
    rule = planning_rules.assignment_rule(TEAM, "Kochdienste", "KP3 19:00 - 21:15")

    assert rule is not None
    assert rule["id"] == "kp3_no_sound_light"
    assert rule["blocked_people"] == []
    assert "Luca" in rule["allowed_people"]
    assert "Luca" not in rule["recommended_people"]
    assert rule["hard_rule"] is False
    assert planning_rules.hard_violation(
        "Luca", "Sound & Light", "Kochdienste", "KP3 19:00 - 21:15"
    ) is None
    assert planning_rules.hard_violation(
        "Mara", "Deko", "Kochdienste", "KP3 19:00 - 21:15"
    ) is None


def test_kp3_keeps_real_evening_contract_restriction():
    rule = planning_rules.assignment_rule(
        [*TEAM, {"name": "Brigitte", "department": "Entertainment"}],
        "Kochdienste",
        "KP3 19:00 - 21:15",
    )

    assert rule is not None
    assert rule["blocked_people"] == ["Brigitte"]
    assert rule["hard_rule"] is True
    assert planning_rules.hard_violation(
        "Brigitte", "Entertainment", "Kochdienste", "KP3 19:00 - 21:15"
    )


def test_hour_only_service_range_matches_backend_formats():
    assert planning_rules.service_interval(
        "An + Abreise-Dienst", "14-15 Uhr"
    ) == (14 * 60, 15 * 60)


def test_deko_relief_on_show_day_is_reported_before_save(memory_db, monkeypatch):
    db.create_person(memory_db, "Mara", "Deko")
    show_date = "2026-08-05"
    monkeypatch.setattr(
        rehearsal_plan,
        "detect_show_dates",
        lambda _events: {show_date},
    )

    warnings = _assignment_warnings(
        memory_db,
        [{
            "date": show_date,
            "category": "Barfrei",
            "subcategory": None,
            "person": "Mara",
        }],
        "2026-08-03",
    )

    assert any("An Showtagen ist für Deko" in warning for warning in warnings)


@pytest.mark.parametrize(
    ("rehearsal", "expected_level"),
    [
        ((15 * 60, 16 * 60), 3),       # direkte Überschneidung
        ((17 * 60, 18 * 60), 2),       # 30 Minuten Abstand
        ((17 * 60 + 30, 18 * 60 + 30), 1),  # 60 Minuten Abstand
        ((17 * 60 + 31, 18 * 60 + 30), 0),  # mehr als 60 Minuten Abstand
    ],
)
def test_rehearsal_conflict_levels_for_one_hour_sport_slot(rehearsal, expected_level):
    service = planning_rules.service_interval("Sportprogramm", "15:30 BVB")

    assert service == (15 * 60 + 30, 16 * 60 + 30)
    assert planning_rules.rehearsal_conflict_level(service, rehearsal) == expected_level


def test_guests_vs_robins_requires_four_distinct_people_on_friday(memory_db):
    date_iso = "2026-08-07"  # Freitag

    assert planning_rules.required_people(
        "Sportprogramm", "15:30 BVB", date_iso
    ) == 4
    assert planning_rules.required_people(
        "Sportprogramm", "15:30 BVB", "2026-08-06"
    ) == 1

    three_people = [
        {
            "date": date_iso,
            "category": "Sportprogramm",
            "subcategory": "15:30 Gäste vs Robins BVB",
            "person": name,
        }
        for name in ("Sven", "Mara", "Luca")
    ]
    warnings = _assignment_warnings(memory_db, three_people, "2026-08-03")
    assert any("mindestens 4 verschiedene Mitarbeiter" in warning for warning in warnings)

    four_people = [
        *three_people,
        {
            "date": date_iso,
            "category": "Sportprogramm",
            "subcategory": "15:30 Gäste vs Robins BVB",
            "person": "Fanny",
        },
    ]
    warnings = _assignment_warnings(memory_db, four_people, "2026-08-03")
    assert not any("mindestens 4 verschiedene Mitarbeiter" in warning for warning in warnings)
