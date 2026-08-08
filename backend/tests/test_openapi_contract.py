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

Auth-Sprint (nachgelagert): dieser Snapshot bleibt die Referenz, bekommt aber
eine zweite, ebenfalls bewusst dokumentierte Ausnahmemenge. Die Einführung von
Authentifizierung ändert den API-Vertrag an genau drei Stellen, und nur an
diesen:

  1. drei NEUE Endpunkte (ACCEPTED_NEW_PATHS) - kein bestehender ist
     verschwunden oder umbenannt,
  2. der Query-Parameter `api_key` an POST /api/upload/pdf ist ERSATZLOS
     ENTFALLEN (ACCEPTED_PARAMETER_CHANGES) - ein Secret gehört nicht in eine
     URL, siehe docs/auth/AUTH_ARCHITECTURE.md,
  3. jede Operation ausser GET /api/health trägt jetzt das Security-Schema
     `SupabaseAccessToken`.

Alles andere - Pfade, Methoden, Request Bodies, Response-Formen, Parameter,
Komponenten - muss weiterhin bitgleich sein. Genau das prüfen die Tests unten,
und Punkt 3 wird zusätzlich in test_auth_endpoint_matrix.py vollständig
abgesichert.
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
    "/api/upload/pdf": (
        "Auth-Sprint: der Docstring erklärt jetzt, dass der Query-Parameter "
        "`api_key` entfallen ist und der Gemini-Key ausschliesslich aus der "
        "Server-Umgebung kommt. Request Body und Antwort unverändert."
    ),
}

#: Auth-Sprint: bewusst NEU hinzugekommene Endpunkte. Rein additiv - kein
#: bestehender Endpunkt wurde entfernt, umbenannt oder in seiner Form geändert.
ACCEPTED_NEW_PATHS: dict[str, str] = {
    "/api/auth/me": "Liefert Rolle und Personenzuordnung des angemeldeten Benutzers.",
    "/api/admin/app-users": "Minimale Kontenverwaltung (ADMIN): auflisten und freischalten.",
    "/api/admin/app-users/{user_id}": "Minimale Kontenverwaltung (ADMIN): ändern und entfernen.",
}

#: Die Request-Modelle der neuen Admin-Endpunkte.
ACCEPTED_NEW_SCHEMAS = {"AppUserCreate", "AppUserUpdate"}

#: Auth-Sprint: die einzige bewusste Vertragsänderung an einem BESTEHENDEN
#: Endpunkt. Ein Secret im Query-String landet in Browser-Historie,
#: Referer-Headern und Access-Logs - dagegen hilft keine Rollenprüfung.
ACCEPTED_PARAMETER_CHANGES: dict[str, str] = {
    "/api/upload/pdf": (
        "Query-Parameter `api_key` ersatzlos entfernt; der Gemini-Key kommt "
        "nur noch aus der serverseitigen Umgebungsvariable GEMINI_API_KEY."
    ),
}


#: Felder, die vom Strukturvergleich ausgenommen sind: `description` ist reine
#: Prosa (separat geprüft), `security` ist die dokumentierte, rein additive
#: Ergänzung des Auth-Sprints (vollständig geprüft in
#: test_auth_endpoint_matrix.py).
_IGNORED_OPERATION_KEYS = ("description", "security")


def _without_prose(operations: dict) -> dict:
    """Entfernt reine Dokumentationstexte, behält alles Vertragsrelevante."""
    return {
        method: {
            key: value
            for key, value in operation.items()
            if key not in _IGNORED_OPERATION_KEYS
        }
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
    added = sorted(set(after["paths"]) - set(before["paths"]) - set(ACCEPTED_NEW_PATHS))
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
            if path in ACCEPTED_PARAMETER_CHANGES:
                continue
            expected = operation.get("parameters", [])
            actual = after["paths"][path][method].get("parameters", [])
            if expected != actual:
                differences.append(f"{method.upper()} {path}")
    assert differences == [], f"Parameter haben sich geändert: {differences}"


def test_component_schemas_are_unchanged(before, after):
    before_schemas = before.get("components", {}).get("schemas", {})
    after_schemas = after.get("components", {}).get("schemas", {})

    missing = sorted(set(before_schemas) - set(after_schemas))
    added = sorted(set(after_schemas) - set(before_schemas) - ACCEPTED_NEW_SCHEMAS)
    assert missing == [], f"Schemas sind verschwunden: {missing}"
    assert added == [], f"Unerwartete neue Schemas: {added}"

    changed = [name for name in before_schemas if before_schemas[name] != after_schemas[name]]
    assert changed == [], f"Schemas haben sich geändert: {changed}"


def test_everything_except_documented_prose_is_bit_identical(before, after):
    """Gesamtvergleich ohne Beschreibungstexte.

    Fängt auch Änderungen ab, die die Einzeltests oben nicht adressieren
    (operationId, tags, summary, ...). Hier darf es keinerlei Abweichung geben.
    """
    stripped_before = {
        p: _without_prose(ops)
        for p, ops in before["paths"].items()
        if p not in ACCEPTED_PARAMETER_CHANGES
    }
    stripped_after = {
        p: _without_prose(ops)
        for p, ops in after["paths"].items()
        if p not in ACCEPTED_NEW_PATHS and p not in ACCEPTED_PARAMETER_CHANGES
    }
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
