"""OpenAPI-Vertrag vor/nach der PostgreSQL-Migration (Sprint-Punkte 36/37).

Die Datenbankmigration muss für das Frontend unsichtbar sein: gleiche Pfade,
gleiche Methoden, gleiche Request Bodies, gleiche Response-Formen. Der
Snapshot in docs/database/snapshots/openapi_before_migration.json wurde vor der
ersten Codeänderung aus dem damals noch SQLite-basierten Backend erzeugt.

Jede unbeabsichtigte Abweichung ist ein FAIL. Bewusst dokumentierte Ausnahmen
stehen in ACCEPTED_PROSE_CHANGES.

Struktur (Pfade, Methoden, Parameter, Request Bodies, Response-Schemas,
Komponenten) ist bitgleich geblieben. Geändert hat sich ausschließlich der
Beschreibungstext von /api/health und /api/system/diagnostics - das sind die
aus den Docstrings generierten `description`-Felder der beiden Endpunkte, die
in der Migration technische Diagnoseinformation neu erklären mussten (es gibt
keine Datenbankdatei und kein `PRAGMA integrity_check` mehr). Genau diese
Ausnahme lässt der Sprint zu ("Ausnahme nur für bewusst dokumentierte
technische Health-/Diagnoseinformation"); die Feldnamen und Typen der
Antworten sind unverändert.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.api import app

SNAPSHOT_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs" / "database" / "snapshots" / "openapi_before_migration.json"
)

#: Endpunkte, deren reiner BESCHREIBUNGSTEXT sich bewusst geändert hat. Es
#: handelt sich um die aus den Docstrings generierten `description`-Felder -
#: keine Struktur, keine Feldnamen, keine Typen. Alles andere ist ein FAIL.
ACCEPTED_PROSE_CHANGES: dict[str, str] = {
    "/api/health": (
        "Beschreibt jetzt eine PostgreSQL-Verbindung statt einer Datenbankdatei; "
        "`database_path` liefert Host/Datenbank statt eines Dateipfads. "
        "Antwortfelder und Statuswerte unverändert."
    ),
    "/api/system/diagnostics": (
        "PRAGMA integrity_check existiert in PostgreSQL nicht; das Feld "
        "`integrity_check` meldet stattdessen Erreichbarkeit + Migrationsstand. "
        "Antwortstruktur unverändert."
    ),
}


def _without_prose(operations: dict) -> dict:
    """Entfernt reine Dokumentationstexte, behält alles Vertragsrelevante."""
    return {
        method: {key: value for key, value in operation.items() if key != "description"}
        for method, operation in operations.items()
    }


@pytest.fixture(scope="module")
def before() -> dict:
    if not SNAPSHOT_PATH.exists():  # pragma: no cover - Snapshot ist eingecheckt
        pytest.skip(f"Kein Vorher-Snapshot unter {SNAPSHOT_PATH}")
    return json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def after() -> dict:
    return app.openapi()


def test_paths_are_unchanged(before, after):
    missing = sorted(set(before["paths"]) - set(after["paths"]))
    added = sorted(set(after["paths"]) - set(before["paths"]))
    assert missing == [], f"Endpunkte sind verschwunden: {missing}"
    assert added == [], f"Unerwartete neue Endpunkte: {added}"


def test_methods_are_unchanged(before, after):
    differences = []
    for path, operations in before["paths"].items():
        before_methods = sorted(operations)
        after_methods = sorted(after["paths"].get(path, {}))
        if before_methods != after_methods:
            differences.append((path, before_methods, after_methods))
    assert differences == [], f"HTTP-Methoden haben sich geändert: {differences}"


def test_request_bodies_are_unchanged(before, after):
    differences = []
    for path, operations in before["paths"].items():
        for method, operation in operations.items():
            expected = operation.get("requestBody")
            actual = after["paths"][path][method].get("requestBody")
            if expected != actual:
                differences.append(f"{method.upper()} {path}")
    assert differences == [], f"Request Bodies haben sich geändert: {differences}"


def test_response_shapes_are_unchanged(before, after):
    differences = []
    for path, operations in before["paths"].items():
        for method, operation in operations.items():
            expected = operation.get("responses")
            actual = after["paths"][path][method].get("responses")
            if expected != actual:
                differences.append(f"{method.upper()} {path}")
    assert differences == [], f"Response-Formen haben sich geändert: {differences}"


def test_parameters_are_unchanged(before, after):
    differences = []
    for path, operations in before["paths"].items():
        for method, operation in operations.items():
            expected = operation.get("parameters", [])
            actual = after["paths"][path][method].get("parameters", [])
            if expected != actual:
                differences.append(f"{method.upper()} {path}")
    assert differences == [], f"Parameter haben sich geändert: {differences}"


def test_component_schemas_are_unchanged(before, after):
    before_schemas = before.get("components", {}).get("schemas", {})
    after_schemas = after.get("components", {}).get("schemas", {})

    missing = sorted(set(before_schemas) - set(after_schemas))
    added = sorted(set(after_schemas) - set(before_schemas))
    assert missing == [], f"Schemas sind verschwunden: {missing}"
    assert added == [], f"Unerwartete neue Schemas: {added}"

    changed = [name for name in before_schemas if before_schemas[name] != after_schemas[name]]
    assert changed == [], f"Schemas haben sich geändert: {changed}"


def test_everything_except_documented_prose_is_bit_identical(before, after):
    """Gesamtvergleich ohne Beschreibungstexte.

    Fängt auch Änderungen ab, die die Einzeltests oben nicht adressieren
    (operationId, tags, summary, ...). Hier darf es keinerlei Abweichung geben.
    """
    stripped_before = {p: _without_prose(ops) for p, ops in before["paths"].items()}
    stripped_after = {p: _without_prose(ops) for p, ops in after["paths"].items()}
    assert stripped_before == stripped_after


def test_prose_changed_only_on_the_documented_endpoints(before, after):
    """Und die Beschreibungstexte dürfen sich nur dort geändert haben, wo es
    bewusst dokumentiert ist - sonst wurde unbemerkt an einem Endpunkt
    geschraubt, der von der Datenbankmigration gar nicht betroffen sein sollte.
    """
    changed = set()
    for path, operations in before["paths"].items():
        for method, operation in operations.items():
            if operation.get("description") != after["paths"][path][method].get("description"):
                changed.add(path)

    assert changed <= set(ACCEPTED_PROSE_CHANGES), (
        "Unerwartete Beschreibungsänderungen an: "
        f"{sorted(changed - set(ACCEPTED_PROSE_CHANGES))}"
    )
