"""Rollenmodell und `CurrentUser` - die einzige Struktur, in der ein
angemeldeter Benutzer durch die Router gereicht wird.

Bewusst genau drei Rollen und keine Permission-Engine: Was eine Rolle darf,
steht an genau einer Stelle (docs/auth/ROLE_MATRIX.md + die
`dependencies=[...]`-Angabe am jeweiligen Endpunkt), nicht in einer
Datenbanktabelle, die man versehentlich inkonsistent befüllen kann.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional
from uuid import UUID


class AppRole(str, Enum):
    """ADMIN > PLANNER > EMPLOYEE - streng hierarchisch.

    `str`-Enum, damit der Wert ohne Umwege in SQLite/JSON landet und
    Vergleiche mit rohen Strings ("admin") funktionieren.
    """

    EMPLOYEE = "employee"
    PLANNER = "planner"
    ADMIN = "admin"

    @property
    def rank(self) -> int:
        return _ROLE_RANK[self]

    def covers(self, required: "AppRole") -> bool:
        """True, wenn diese Rolle die geforderte Rolle einschliesst."""
        return self.rank >= required.rank


_ROLE_RANK = {
    AppRole.EMPLOYEE: 1,
    AppRole.PLANNER: 2,
    AppRole.ADMIN: 3,
}

# Für Migrations-/CHECK-Constraint-Text und Validierung an einer Stelle.
ROLE_VALUES = tuple(role.value for role in AppRole)


def parse_role(raw: str) -> AppRole:
    """Wandelt einen gespeicherten Rollenwert in ein AppRole um.

    Wirft ValueError bei unbekannten Werten - eine unbekannte Rolle darf nie
    still als "irgendwas Harmloses" durchgehen.
    """
    return AppRole(str(raw).strip().lower())


@dataclass(frozen=True)
class CurrentUser:
    """Der angemeldete Benutzer, wie ihn jeder geschützte Endpunkt sieht.

    Unveränderlich (frozen): kein Router kann die Rolle eines Requests
    unterwegs "anpassen".
    """

    user_id: UUID
    role: AppRole
    person_id: Optional[int]
    email: Optional[str] = None

    @property
    def is_admin(self) -> bool:
        return self.role is AppRole.ADMIN

    @property
    def is_planner_or_above(self) -> bool:
        return self.role.covers(AppRole.PLANNER)

    def to_public_dict(self) -> dict:
        """Antwortform für /api/auth/me - enthält bewusst kein Token, keine
        Claims und keine internen Felder."""
        return {
            "user_id": str(self.user_id),
            "role": self.role.value,
            "person_id": self.person_id,
            "email": self.email,
        }
