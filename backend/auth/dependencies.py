"""Die Autorisierungsschicht des Backends.

Genau ein Weg, wie ein Request zu einer Identität kommt:

    Authorization: Bearer <supabase access token>
        -> Signatur/Issuer/Audience/Ablauf prüfen (tokens.py)
        -> sub (Supabase-User-UUID)
        -> app_users-Zeile laden
        -> is_active prüfen
        -> Rolle + person_id
        -> CurrentUser

Es gibt bewusst keinen zweiten Weg (kein API-Key, kein Query-Parameter, kein
"vertrauenswürdiger" Header aus dem Frontend). Das Frontend ist eine
Bequemlichkeitsschicht - die Sicherheitsgrenze verläuft hier.

Rollenprüfungen werden nicht in Routern ausformuliert, sondern als
Dependency an den Endpunkt gehängt:

    @router.post("/api/plan/save", dependencies=[Depends(require_planner)])

Dadurch ist die Berechtigung eines Endpunkts an genau einer Stelle sichtbar,
maschinell auslesbar (siehe backend/tests/test_auth_endpoint_matrix.py) und
kann nicht versehentlich in einem Codepfad übersprungen werden.
"""
from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .. import db
from .errors import AuthError
from .models import AppRole, CurrentUser, parse_role
from .tokens import verify_access_token

logger = logging.getLogger(__name__)

# auto_error=False: FastAPI soll nicht selbst eine 403-Antwort mit eigenem
# Text erzeugen, wenn der Header fehlt - die Statuscodes und Meldungen
# kommen ausschliesslich aus errors.py (fehlender Token = 401, nicht 403).
bearer_scheme = HTTPBearer(auto_error=False, scheme_name="SupabaseAccessToken")


def _log_auth_failure(request: Request, error: AuthError) -> None:
    """Auth-Fehler protokollieren - ohne Token, ohne Authorization-Header,
    ohne Claims. Nur was zur Fehlersuche wirklich nötig ist: welcher
    Endpunkt, welche Fehlerklasse, und der interne Grund (der bereits beim
    Erzeugen des Fehlers bewusst tokenfrei formuliert wurde)."""
    logger.info(
        "Auth abgelehnt: %s %s -> %s (%s)",
        request.method,
        request.url.path,
        error.code,
        error.reason or "-",
    )


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    conn: sqlite3.Connection = Depends(db.get_db_connection),
) -> CurrentUser:
    """Authentifiziert den Request und lädt den zugehörigen App-Benutzer.

    Legt niemals selbst einen app_users-Eintrag an: ein in Supabase
    existierender, im Planner aber nicht freigeschalteter Benutzer bekommt
    403 - nicht stillschweigend eine Standardrolle.
    """
    try:
        if credentials is None or not (credentials.credentials or "").strip():
            raise AuthError("missing_token", "Kein Bearer-Token im Request")

        claims = verify_access_token(credentials.credentials.strip())

        row = db.get_app_user(conn, claims.subject)
        if row is None:
            raise AuthError("unknown_user", "Kein app_users-Eintrag für diesen Supabase-Benutzer")
        if not bool(row["is_active"]):
            raise AuthError("inactive_user", "app_users.is_active = 0")

        try:
            role = parse_role(row["role"])
        except ValueError as exc:
            # Kann nur passieren, wenn jemand am CHECK-Constraint vorbei
            # geschrieben hat. Dann lieber sperren als raten.
            raise AuthError("unknown_user", "Unbekannte Rolle in app_users") from exc

        person_id = row["person_id"]
        return CurrentUser(
            user_id=claims.subject,
            role=role,
            person_id=int(person_id) if person_id is not None else None,
            email=claims.email,
        )
    except AuthError as error:
        _log_auth_failure(request, error)
        raise error.as_http_exception() from None


class RoleRequirement:
    """Dependency, die eine Mindestrolle erzwingt (ADMIN > PLANNER > EMPLOYEE).

    Als Klasse statt als Closure, damit die geforderte Rolle introspizierbar
    bleibt: Tests und Dokumentation lesen `required_role` direkt aus dem
    Dependency-Baum der App aus, statt eine handgepflegte Liste zu glauben.
    """

    def __init__(self, required_role: AppRole):
        self.required_role = required_role

    def __call__(
        self,
        request: Request,
        user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if not user.role.covers(self.required_role):
            error = AuthError(
                "insufficient_role",
                f"Rolle {user.role.value} deckt {self.required_role.value} nicht ab",
            )
            _log_auth_failure(request, error)
            raise error.as_http_exception()
        return user

    def __repr__(self) -> str:  # pragma: no cover - nur für Fehlersuche
        return f"RoleRequirement({self.required_role.value})"


# Die drei Stufen, die in den Routern verwendet werden. Bewusst als fertige
# Instanzen: `Depends(require_planner)` liest sich wie eine Aussage über den
# Endpunkt, und FastAPI cached die Auflösung pro Request.
require_employee = RoleRequirement(AppRole.EMPLOYEE)
require_planner = RoleRequirement(AppRole.PLANNER)
require_admin = RoleRequirement(AppRole.ADMIN)

# Für Endpunkte, die nur "angemeldet und freigeschaltet" verlangen, ohne
# fachliche Mindestrolle (z.B. /api/auth/me).
require_authenticated = get_current_user
