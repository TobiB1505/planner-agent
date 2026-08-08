"""Auth-Sprint - die Rollenmatrix am laufenden Endpunkt (Aufgaben 37/38).

Aufgabe 37 verlangt genau diese Tabelle, automatisiert:

    Benutzer   Employee-Endpunkt   Planner-Endpunkt   Admin-Endpunkt
    employee   ja                  nein               nein
    planner    ja                  ja                 nein
    admin      ja                  ja                 ja

Aufgabe 38 verlangt zusätzlich den Nachweis, dass ein Employee die
Schreiboperationen auch dann nicht auslösen kann, wenn er das Frontend
komplett umgeht und direkt gegen FastAPI spricht.

Geprüft wird über die Rollen-Fixtures aus conftest.py: die Identität steht
fest, die Rollenprüfung läuft echt. Ob ein Endpunkt fachlich 200, 404 oder
422 liefert, ist hier egal - entscheidend ist nur, ob die Rollenhürde
greift (403) oder nicht.
"""
from __future__ import annotations

import pytest

FORBIDDEN = 403

# Je ein repräsentativer Endpunkt pro Stufe. Bewusst Leseoperationen, damit
# der Test nichts verändert und die Rollenprüfung isoliert sichtbar wird.
EMPLOYEE_ENDPOINT = ("GET", "/api/artist-plans")
PLANNER_ENDPOINT = ("GET", "/api/team")
ADMIN_ENDPOINT = ("GET", "/api/admin/app-users")


def _call(client, method: str, path: str, **kwargs):
    return client.request(method, path, **kwargs)


# ---------- Die Matrix aus Aufgabe 37 ----------


def test_employee_may_use_employee_endpoints(employee_client):
    assert _call(employee_client, *EMPLOYEE_ENDPOINT).status_code == 200


def test_employee_may_not_use_planner_endpoints(employee_client):
    assert _call(employee_client, *PLANNER_ENDPOINT).status_code == FORBIDDEN


def test_employee_may_not_use_admin_endpoints(employee_client):
    assert _call(employee_client, *ADMIN_ENDPOINT).status_code == FORBIDDEN


def test_planner_may_use_employee_endpoints(planner_client):
    assert _call(planner_client, *EMPLOYEE_ENDPOINT).status_code == 200


def test_planner_may_use_planner_endpoints(planner_client):
    assert _call(planner_client, *PLANNER_ENDPOINT).status_code == 200


def test_planner_may_not_use_admin_endpoints(planner_client):
    assert _call(planner_client, *ADMIN_ENDPOINT).status_code == FORBIDDEN


def test_admin_may_use_every_level(admin_client):
    assert _call(admin_client, *EMPLOYEE_ENDPOINT).status_code == 200
    assert _call(admin_client, *PLANNER_ENDPOINT).status_code == 200
    assert _call(admin_client, *ADMIN_ENDPOINT).status_code == 200


# ---------- Aufgabe 38: Employee direkt gegen FastAPI ----------

EMPLOYEE_MUST_NOT = [
    ("POST", "/api/plan/save", {"json": {"start_date": "2026-08-03", "day_labels": [], "rows": []}}),
    ("DELETE", "/api/weeks/1", {}),
    ("POST", "/api/import/save", {"json": {"filename": "x.pdf", "start_date": "2026-08-03",
                                            "end_date": "2026-08-09", "assignments": [], "absences": []}}),
    ("POST", "/api/system/restart", {}),
    ("POST", "/api/plan/generate", {"json": {"start_date": "2026-08-03"}}),
    ("POST", "/api/upload/pdf", {"files": {"file": ("x.pdf", b"%PDF-1.4", "application/pdf")}}),
    ("POST", "/api/artist-plans", {"json": {}}),
    ("DELETE", "/api/artist-plans/1", {}),
    ("DELETE", "/api/rehearsal-plans/1", {}),
    ("POST", "/api/team", {"json": {"name": "Neu"}}),
    ("DELETE", "/api/team/1", {}),
    ("PUT", "/api/settings/irgendwas", {"json": {"value": "1"}}),
    ("POST", "/api/admin/app-users", {"json": {"user_id": "11111111-1111-4111-8111-111111111111",
                                               "role": "admin"}}),
    ("GET", "/api/system/diagnostics", {}),
    ("GET", "/api/dashboard/overview", {}),
    ("GET", "/api/memory", {}),
    ("GET", "/api/intelligence/employees", {}),
]


@pytest.mark.parametrize("method,path,kwargs", EMPLOYEE_MUST_NOT)
def test_employee_is_blocked_on_every_privileged_endpoint(employee_client, method, path, kwargs):
    """403 - und zwar bevor irgendetwas passiert.

    Wichtig ist auch, was NICHT im Ergebnis steht: kein 422 (das hiesse, der
    Request wäre bis zur Validierung durchgelaufen) und kein 404 (das hiesse,
    der Endpunkt hätte die Datenbank bereits befragt).
    """
    response = _call(employee_client, method, path, **kwargs)
    assert response.status_code == FORBIDDEN, (
        f"{method} {path} hätte für Employee 403 liefern müssen, war {response.status_code}"
    )


PLANNER_MUST_NOT = [
    ("POST", "/api/system/restart", {}),
    ("GET", "/api/system/diagnostics", {}),
    ("GET", "/api/admin/app-users", {}),
    ("PATCH", "/api/admin/app-users/11111111-1111-4111-8111-111111111111", {"json": {"role": "admin"}}),
    ("DELETE", "/api/admin/app-users/11111111-1111-4111-8111-111111111111", {}),
    ("GET", "/api/settings/irgendwas", {}),
    ("PUT", "/api/settings/irgendwas", {"json": {"value": "1"}}),
]


@pytest.mark.parametrize("method,path,kwargs", PLANNER_MUST_NOT)
def test_planner_cannot_reach_admin_functions(planner_client, method, path, kwargs):
    """Ein Planer darf planen - aber keine Konten verwalten und keine
    Systemfunktionen auslösen."""
    response = _call(planner_client, method, path, **kwargs)
    assert response.status_code == FORBIDDEN


# ---------- Ohne Identität ----------


def test_without_identity_protected_endpoints_answer_401(anonymous_client):
    """Ohne Token gibt es 401, nicht 403 - der Unterschied zwischen
    "wer bist du?" und "das darfst du nicht"."""
    for method, path in (EMPLOYEE_ENDPOINT, PLANNER_ENDPOINT, ADMIN_ENDPOINT):
        response = _call(anonymous_client, method, path)
        assert response.status_code == 401, f"{method} {path} -> {response.status_code}"


def test_health_needs_no_identity(anonymous_client):
    assert anonymous_client.get("/api/health").status_code == 200


def test_restart_gate_still_applies_for_admins(admin_client, monkeypatch):
    """Aufgabe 21: RBAC ersetzt SYSTEM_RESTART_ENABLED nicht - beide Ebenen
    gelten. Ein Admin kommt durch die Rollenprüfung und läuft danach in die
    Deployment-Sperre."""
    monkeypatch.setenv("SYSTEM_RESTART_ENABLED", "0")
    response = admin_client.post("/api/system/restart")
    assert response.status_code == 200
    assert response.json()["status"] == "restart_disabled"
