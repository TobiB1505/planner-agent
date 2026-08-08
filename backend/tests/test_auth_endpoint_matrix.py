"""Auth-Sprint - jeder Endpunkt ist bewusst klassifiziert (Aufgabe 2/19).

Der Sinn dieser Datei ist nicht, dieselbe Information zweimal zu schreiben,
sondern eine Sperre einzubauen: ein neuer Endpunkt fällt hier sofort auf,
weil er in EXPECTED fehlt. Ohne diesen Test wäre ein vergessener
`dependencies=[...]`-Eintrag ein stiller, offener Endpunkt - genau die
Fehlerklasse, die man in Code-Reviews übersieht.

EXPECTED ist damit die kuratierte, menschlich geprüfte Liste;
route_matrix.build_matrix() liest, was die App wirklich tut. Weichen beide
voneinander ab, ist eine der beiden Seiten falsch - und der Test sagt, welche.

Die ausformulierte Begründung je Endpunkt steht in docs/auth/ROLE_MATRIX.md.
"""
from __future__ import annotations

import pytest

from backend.api import app

from .route_matrix import build_matrix

EXPECTED = {
    # --- Öffentlich: nur die Liveness-Prüfung der Hosting-Plattform ---
    ("GET", "/api/health"): "PUBLIC",

    # --- Jede gültige Anmeldung ---
    ("GET", "/api/auth/me"): "AUTHENTICATED",

    # --- Employee: die Inhalte des künftigen Employee-Portals (read-only) ---
    ("GET", "/api/artist-plans"): "EMPLOYEE",
    ("GET", "/api/artist-plans/{artist_plan_id}"): "EMPLOYEE",
    ("GET", "/api/rehearsal-plans"): "EMPLOYEE",
    ("GET", "/api/rehearsal-plans/{rehearsal_plan_id}"): "EMPLOYEE",

    # --- Planner: Dienstplanung, Team, Intelligence, Gedächtnis, Import ---
    ("GET", "/api/weeks"): "PLANNER",
    ("GET", "/api/weeks/{week_id}"): "PLANNER",
    ("DELETE", "/api/weeks/{week_id}"): "PLANNER",
    ("GET", "/api/plan/templates"): "PLANNER",
    ("GET", "/api/plan/existing"): "PLANNER",
    ("POST", "/api/plan/free-suggestion"): "PLANNER",
    ("POST", "/api/plan/generate"): "PLANNER",
    ("POST", "/api/plan/save"): "PLANNER",
    ("POST", "/api/xlsx/generate"): "PLANNER",
    ("GET", "/api/planning-rules"): "PLANNER",

    ("GET", "/api/team"): "PLANNER",
    ("POST", "/api/team"): "PLANNER",
    ("PUT", "/api/team/{person_id}"): "PLANNER",
    ("DELETE", "/api/team/{person_id}"): "PLANNER",
    ("GET", "/api/people/active"): "PLANNER",

    ("GET", "/api/dashboard/overview"): "PLANNER",
    ("GET", "/api/dashboard/person-totals"): "PLANNER",
    ("GET", "/api/dashboard/category-matrix"): "PLANNER",
    ("GET", "/api/dashboard/department-activity"): "PLANNER",
    ("GET", "/api/dashboard/fairness-alerts"): "PLANNER",
    ("GET", "/api/dashboard/insights"): "PLANNER",

    ("GET", "/api/memory"): "PLANNER",
    ("GET", "/api/memory/{person_id}"): "PLANNER",
    ("PUT", "/api/memory/{person_id}/show/{show_key}"): "PLANNER",
    ("PUT", "/api/memory/{person_id}/free"): "PLANNER",
    ("PUT", "/api/memory/{person_id}/task"): "PLANNER",

    ("GET", "/api/intelligence/employees"): "PLANNER",
    ("GET", "/api/intelligence/employees/{person_id}"): "PLANNER",
    ("PUT", "/api/intelligence/employees/{person_id}/skills"): "PLANNER",
    ("DELETE", "/api/intelligence/employees/{person_id}/skills/{skill_id}"): "PLANNER",
    ("POST", "/api/intelligence/employees/{person_id}/memory"): "PLANNER",
    ("DELETE", "/api/intelligence/employees/{person_id}/memory/{entry_id}"): "PLANNER",
    ("POST", "/api/intelligence/recommendations"): "PLANNER",
    ("POST", "/api/intelligence/plan-quality"): "PLANNER",
    ("GET", "/api/intelligence/audit"): "PLANNER",

    ("POST", "/api/upload/pdf"): "PLANNER",
    ("POST", "/api/upload/xlsx/sheets"): "PLANNER",
    ("POST", "/api/upload/xlsx"): "PLANNER",
    ("GET", "/api/known-department-tokens"): "PLANNER",
    ("POST", "/api/import/save"): "PLANNER",

    ("POST", "/api/artist-plans/upload/sheets"): "PLANNER",
    ("POST", "/api/artist-plans/import"): "PLANNER",
    ("GET", "/api/artist-plans/empty"): "PLANNER",
    ("POST", "/api/artist-plans"): "PLANNER",
    ("DELETE", "/api/artist-plans/{artist_plan_id}"): "PLANNER",
    ("GET", "/api/artist-plans/{artist_plan_id}/export"): "PLANNER",

    ("POST", "/api/rehearsal-plans/upload/sheets"): "PLANNER",
    ("POST", "/api/rehearsal-plans/import"): "PLANNER",
    ("POST", "/api/rehearsal-plans"): "PLANNER",
    ("DELETE", "/api/rehearsal-plans/{rehearsal_plan_id}"): "PLANNER",

    # --- Admin: System, Einstellungen, Kontenverwaltung ---
    ("GET", "/api/system/diagnostics"): "ADMIN",
    ("POST", "/api/system/restart"): "ADMIN",
    ("GET", "/api/settings/{key}"): "ADMIN",
    ("PUT", "/api/settings/{key}"): "ADMIN",
    ("GET", "/api/admin/app-users"): "ADMIN",
    ("POST", "/api/admin/app-users"): "ADMIN",
    ("PATCH", "/api/admin/app-users/{user_id}"): "ADMIN",
    ("DELETE", "/api/admin/app-users/{user_id}"): "ADMIN",
}


def test_every_endpoint_has_an_expected_classification():
    actual = build_matrix(app)

    missing = sorted(key for key in actual if key not in EXPECTED)
    assert not missing, (
        "Neue oder umbenannte Endpunkte ohne bewusste Einstufung: "
        f"{missing}. Bitte in EXPECTED (hier) und docs/auth/ROLE_MATRIX.md ergänzen."
    )

    stale = sorted(key for key in EXPECTED if key not in actual)
    assert not stale, f"EXPECTED nennt Endpunkte, die es nicht mehr gibt: {stale}"


def test_classifications_match_the_application():
    actual = build_matrix(app)
    differences = {
        key: (EXPECTED[key], actual[key])
        for key in EXPECTED
        if key in actual and EXPECTED[key] != actual[key]
    }
    assert not differences, f"Erwartet vs. tatsächlich (erwartet, tatsächlich): {differences}"


def test_only_health_is_public():
    """Ein zweiter öffentlicher Endpunkt wäre eine Sicherheitsentscheidung -
    die soll nicht nebenbei passieren."""
    actual = build_matrix(app)
    public = sorted(key for key, value in actual.items() if value == "PUBLIC")
    assert public == [("GET", "/api/health")]


@pytest.mark.parametrize(
    "method,path",
    sorted(key for key, value in EXPECTED.items() if key[0] == "DELETE"),
)
def test_every_delete_endpoint_is_planner_or_admin(method, path):
    """Aufgabe 20: kein DELETE unterhalb von PLANNER."""
    assert EXPECTED[(method, path)] in {"PLANNER", "ADMIN"}


def test_write_operations_are_never_employee_level():
    """Employee ist read-only - keine POST/PUT/PATCH/DELETE-Route darf auf
    EMPLOYEE oder AUTHENTICATED stehen."""
    actual = build_matrix(app)
    writable = {
        key: value
        for key, value in actual.items()
        if key[0] in {"POST", "PUT", "PATCH", "DELETE"}
        and value in {"PUBLIC", "AUTHENTICATED", "EMPLOYEE"}
    }
    assert not writable, f"Schreibende Endpunkte unterhalb von PLANNER: {writable}"


def test_no_endpoint_accepts_an_api_key_query_parameter():
    """Aufgabe 24: Secrets gehören nicht in URLs - auch nicht optional."""
    from .route_matrix import iter_api_routes

    offenders = []
    for route in iter_api_routes(app):
        for param in route.dependant.query_params:
            if "key" in param.name.lower() or "token" in param.name.lower():
                offenders.append((route.path, param.name))
    assert not offenders, f"Query-Parameter, die nach Secrets aussehen: {offenders}"


# ---------- OpenAPI (Aufgabe 41) ----------


def test_openapi_declares_the_bearer_scheme_without_changing_routes():
    """Das Schema darf um Security-Angaben wachsen - die Endpunkte selbst
    bleiben fachlich unverändert (gleiche Pfade, gleiche Methoden)."""
    spec = app.openapi()

    schemes = spec.get("components", {}).get("securitySchemes", {})
    assert schemes.get("SupabaseAccessToken") == {"type": "http", "scheme": "bearer"}

    documented = {
        (method.upper(), path)
        for path, operations in spec["paths"].items()
        for method in operations
        if method.upper() in {"GET", "POST", "PUT", "PATCH", "DELETE"}
    }
    assert documented == set(EXPECTED), "OpenAPI und Endpunktliste laufen auseinander."


def test_openapi_marks_protected_endpoints_as_secured():
    spec = app.openapi()

    for (method, path), classification in EXPECTED.items():
        operation = spec["paths"][path][method.lower()]
        security = operation.get("security")
        if classification == "PUBLIC":
            assert not security, f"{method} {path} ist öffentlich, trägt aber ein Security-Schema."
        else:
            assert security == [{"SupabaseAccessToken": []}], f"{method} {path} ohne Security-Schema."
