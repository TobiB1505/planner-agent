"""Tests für AP9 (zentrale Abteilungs-Token).

Deckt ab:
  - alle bisher produktiv verwendeten Tokens werden weiterhin als Abteilung
    erkannt (in api.py-, grid.py- und xlsx_template.py-Erkennung identisch)
  - Case-Verhalten (Original-/Klein-/gemischte Schreibweise) bleibt exakt wie
    zuvor
  - Grid-Parsing: ein Abteilungs-Token in einer Personen-Zelle führt zu
    `person: None` (keine neue Person, kein Alias, keine falsche Warnung),
    `raw_text` bleibt erhalten
  - XLSX-Import: ein Abteilungs-Token wird von `_split_people` weiterhin
    ausgeschlossen (kein Personenname)
  - Drift-Schutz: keine lokale Neudefinition eines Token-Sets außerhalb von
    `backend/template_spec.py`

Keine Datenbank beteiligt - reine Funktionstests.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
import pytest

from backend import grid, template_spec, xlsx_template

# Die 15 Abteilungs-Kurzcodes, die vor AP9 in api.py/grid.py/xlsx_template.py je
# separat gepflegt wurden (siehe docs/refactoring/AP9_DEPARTMENT_TOKENS.md).
ALL_DEPARTMENT_TOKENS = [
    "S&L", "SPT", "NM", "KÜCHE", "COCINA", "TC", "DEKO", "LIVE-ENT",
    "SPORTSTAINER", "MANAGER", "REQUI", "WASPO", "FO", "WFA", "SPA",
]
SPECIAL_TOKENS = ["-", "KEINE", "KEIN", "NIEMAND"]


# ---------- Zentrale Menge selbst ----------


def test_central_department_tokens_contain_exactly_the_previous_values():
    assert set(template_spec.DEPARTMENT_TOKENS) == set(ALL_DEPARTMENT_TOKENS)
    assert len(template_spec.DEPARTMENT_TOKENS) == 15


def test_central_special_tokens_contain_exactly_the_previous_values():
    assert set(template_spec.SPECIAL_ASSIGNMENT_TOKENS) == set(SPECIAL_TOKENS)


def test_non_person_assignment_tokens_is_the_union():
    assert template_spec.NON_PERSON_ASSIGNMENT_TOKENS == (
        template_spec.DEPARTMENT_TOKENS | template_spec.SPECIAL_ASSIGNMENT_TOKENS
    )
    assert len(template_spec.NON_PERSON_ASSIGNMENT_TOKENS) == 19


def test_department_tokens_are_immutable():
    assert isinstance(template_spec.DEPARTMENT_TOKENS, frozenset)
    assert isinstance(template_spec.SPECIAL_ASSIGNMENT_TOKENS, frozenset)
    assert isinstance(template_spec.NON_PERSON_ASSIGNMENT_TOKENS, frozenset)


# ---------- Token-Erkennung: grid.py und xlsx_template.py nutzen dieselbe Quelle ----------


@pytest.mark.parametrize("token", ALL_DEPARTMENT_TOKENS)
def test_grid_recognizes_every_known_department_token(token):
    assert grid.is_non_person_assignment_value(token) is True


@pytest.mark.parametrize("token", ALL_DEPARTMENT_TOKENS)
def test_xlsx_template_recognizes_every_known_department_token(token):
    assert xlsx_template._is_department_value(token) is True


@pytest.mark.parametrize("token", SPECIAL_TOKENS)
def test_grid_recognizes_every_special_assignment_token(token):
    assert grid.is_non_person_assignment_value(token) is True


def test_a_real_person_name_is_not_recognized_as_department_or_special():
    assert grid.is_non_person_assignment_value("Tobi") is False
    assert xlsx_template._is_department_value("Tobi") is False


# ---------- Case-Verhalten (wie vorher: .strip().upper()) ----------


@pytest.mark.parametrize("token", ALL_DEPARTMENT_TOKENS)
def test_grid_recognizes_department_tokens_case_insensitively(token):
    assert grid.is_non_person_assignment_value(token.lower()) is True
    assert grid.is_non_person_assignment_value(token.upper()) is True
    assert grid.is_non_person_assignment_value(f"  {token}  ") is True


@pytest.mark.parametrize("token", ALL_DEPARTMENT_TOKENS)
def test_xlsx_template_recognizes_department_tokens_case_insensitively(token):
    assert xlsx_template._is_department_value(token.lower()) is True
    assert xlsx_template._is_department_value(token.upper()) is True
    assert xlsx_template._is_department_value(f"  {token}  ") is True


def test_mixed_case_department_token_is_recognized():
    assert grid.is_non_person_assignment_value("WaSpO") is True
    assert xlsx_template._is_department_value("WaSpO") is True


# ---------- Grid-Parsing: Department-Zelle wird nicht zur Person ----------


@pytest.mark.parametrize("token", ["WFA", "SPA", "FO", "WASPO"])
def test_department_token_in_person_cell_parses_to_no_person(token):
    day_label = "Mo 10.08."
    df = pd.DataFrame([
        {
            grid.LABEL_COL: "Tagesverantwortung",
            grid.SLOT_COL: "",
            grid.ROW_TYPE_COL: "data",
            grid.CATEGORY_COL: "Tagesverantwortung",
            day_label: token,
        }
    ])
    assert grid.category_kind("Tagesverantwortung") == template_spec.PERSON

    assignments, absences = grid.parse_grid(df, {day_label: "2026-08-10"})

    assert absences == []
    assert len(assignments) == 1
    assert assignments[0]["person"] is None, "Department-Token darf keine Person erzeugen"
    assert assignments[0]["raw_text"] == token, "Ursprungstext bleibt archiviert"


def test_real_person_name_in_person_cell_parses_to_a_person():
    day_label = "Mo 10.08."
    df = pd.DataFrame([
        {
            grid.LABEL_COL: "Tagesverantwortung",
            grid.SLOT_COL: "",
            grid.ROW_TYPE_COL: "data",
            grid.CATEGORY_COL: "Tagesverantwortung",
            day_label: "Tobi",
        }
    ])
    assignments, _ = grid.parse_grid(df, {day_label: "2026-08-10"})
    assert assignments[0]["person"] == "Tobi"


# ---------- XLSX-Import: Department bleibt Department ----------


@pytest.mark.parametrize("token", ["WFA", "SPA", "FO", "WASPO", "waspo"])
def test_split_people_excludes_department_tokens(token):
    assert xlsx_template._split_people(token) == []


def test_split_people_keeps_real_names_and_drops_department_tokens_mixed():
    assert xlsx_template._split_people("Tobi, WFA, Fanny") == ["Tobi", "Fanny"]


# ---------- Drift-Schutz: keine lokale Neudefinition außerhalb von template_spec.py ----------


def test_no_local_department_token_set_outside_template_spec():
    """Verhindert, dass api.py/grid.py/xlsx_template.py wieder eine eigene
    Token-Menge einführen, statt die zentrale Quelle zu importieren."""
    backend_dir = Path(template_spec.__file__).parent
    forbidden_patterns = [
        re.compile(r"KNOWN_DEPARTMENT_TOKENS\s*=\s*[{\[]"),
        re.compile(r"^DEPARTMENT_TOKENS\s*=\s*[{\[]", re.MULTILINE),
        re.compile(r"^NON_PERSON_ASSIGNMENT_VALUES\s*=\s*[{\[]", re.MULTILINE),
        re.compile(r"^SPECIAL_ASSIGNMENT_TOKENS\s*=\s*[{\[]", re.MULTILINE),
    ]
    checked_files = ["api.py", "grid.py", "xlsx_template.py"]
    for filename in checked_files:
        source = (backend_dir / filename).read_text(encoding="utf-8")
        for pattern in forbidden_patterns:
            assert not pattern.search(source), (
                f"{filename} definiert wieder eine eigene Token-Menge "
                f"({pattern.pattern}) statt aus template_spec.py zu importieren."
            )


def test_grid_and_xlsx_template_reference_the_same_central_object():
    """Beide Module müssen auf dasselbe (immutable) Objekt aus template_spec.py
    zeigen, nicht auf eine eigene Kopie mit denselben Werten."""
    assert xlsx_template.DEPARTMENT_TOKENS is template_spec.DEPARTMENT_TOKENS
    assert grid.NON_PERSON_ASSIGNMENT_VALUES is template_spec.NON_PERSON_ASSIGNMENT_TOKENS
