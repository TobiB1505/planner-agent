"""Liest aus der laufenden FastAPI-App aus, welche Rolle ein Endpunkt verlangt.

Grundlage für zwei Dinge:
  - test_auth_endpoint_matrix.py (jeder Endpunkt ist bewusst klassifiziert),
  - docs/auth/ROLE_MATRIX.md (die Tabelle dort muss zur App passen).

Gelesen wird der tatsächliche Dependency-Baum, nicht eine gepflegte Liste:
Was hier herauskommt, ist genau das, was zur Laufzeit geprüft wird.
"""
from __future__ import annotations

from typing import Dict, Iterator, Tuple

from fastapi.routing import APIRoute

from backend.auth.dependencies import RoleRequirement, get_current_user
from backend.auth.models import AppRole

PUBLIC = "PUBLIC"
AUTHENTICATED = "AUTHENTICATED"


def iter_api_routes(router) -> Iterator[APIRoute]:
    """Alle Endpunkte der App - auch die über include_router eingehängten.

    FastAPI hängt eingebundene Router als Wrapper-Objekt ein, das den
    ursprünglichen Router unter `original_router` behält; deshalb wird
    rekursiv abgestiegen statt nur app.routes zu lesen.
    """
    for route in getattr(router, "routes", []):
        if isinstance(route, APIRoute):
            yield route
            continue
        inner = getattr(route, "original_router", None)
        if inner is not None:
            for nested in iter_api_routes(inner):
                yield nested


def classify_route(route: APIRoute) -> str:
    """PUBLIC | AUTHENTICATED | EMPLOYEE | PLANNER | ADMIN.

    Bei mehreren Rollenprüfungen an einem Endpunkt gewinnt die strengste -
    genau so verhält sich auch die Laufzeit.
    """
    required = []
    authenticated = False

    def scan(dependant) -> None:
        nonlocal authenticated
        if isinstance(dependant.call, RoleRequirement):
            required.append(dependant.call.required_role)
        if dependant.call is get_current_user:
            authenticated = True
        for sub in dependant.dependencies:
            scan(sub)

    scan(route.dependant)

    if required:
        return max(required, key=lambda role: role.rank).value.upper()
    return AUTHENTICATED if authenticated else PUBLIC


def build_matrix(app) -> Dict[Tuple[str, str], str]:
    """{(METHODE, Pfad): Klassifikation} über alle Endpunkte."""
    matrix: Dict[Tuple[str, str], str] = {}
    for route in iter_api_routes(app):
        for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
            matrix[(method, route.path)] = classify_route(route)
    return matrix


ROLE_BY_NAME = {role.value.upper(): role for role in AppRole}
