"""Supabase-Authentifizierung und rollenbasierte Autorisierung.

Öffentliche Schnittstelle des Pakets - Router importieren ausschliesslich
von hier, nicht aus den Untermodulen.
"""
from __future__ import annotations

from .dependencies import (
    get_current_user,
    require_admin,
    require_authenticated,
    require_employee,
    require_planner,
    RoleRequirement,
)
from .errors import AuthError
from .models import AppRole, CurrentUser, ROLE_VALUES, parse_role

__all__ = [
    "AppRole",
    "AuthError",
    "CurrentUser",
    "ROLE_VALUES",
    "RoleRequirement",
    "get_current_user",
    "parse_role",
    "require_admin",
    "require_authenticated",
    "require_employee",
    "require_planner",
]
