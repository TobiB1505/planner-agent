"""Einheitliche Auth-Fehler.

Zwei Ebenen, bewusst getrennt:
  - `AuthError` (intern): trägt einen kurzen, maschinenlesbaren `code` und
    optional einen internen Grund, der ausschliesslich fürs Logging gedacht
    ist und NIE in einer HTTP-Antwort landet.
  - Die HTTP-Antwort selbst: konstante, fachliche Meldungen aus
    `_PUBLIC_MESSAGES`. Kein Exception-Text von PyJWT, kein Stacktrace, kein
    Hinweis darauf, ob ein Token abgelaufen, falsch signiert oder für einen
    anderen Issuer ausgestellt war - das ist für den Aufrufer nicht
    unterscheidbar und soll es auch nicht sein.
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status

# Alle 401-Fälle teilen sich bewusst dieselbe Aussenmeldung.
_UNAUTHENTICATED_MESSAGE = "Nicht angemeldet oder Sitzung ungültig."

_PUBLIC_MESSAGES = {
    "missing_token": _UNAUTHENTICATED_MESSAGE,
    "invalid_token": _UNAUTHENTICATED_MESSAGE,
    "expired_token": _UNAUTHENTICATED_MESSAGE,
    "invalid_issuer": _UNAUTHENTICATED_MESSAGE,
    "invalid_signature": _UNAUTHENTICATED_MESSAGE,
    "auth_not_configured": _UNAUTHENTICATED_MESSAGE,
    "unknown_user": "Für dieses Konto ist kein Zugang zum Planner-Agent hinterlegt.",
    "inactive_user": "Dieses Konto ist deaktiviert.",
    "insufficient_role": "Für diese Aktion fehlt die nötige Berechtigung.",
}

# 401 = "wer bist du?", 403 = "ich weiss, wer du bist, du darfst es nur nicht".
_STATUS_BY_CODE = {
    "missing_token": status.HTTP_401_UNAUTHORIZED,
    "invalid_token": status.HTTP_401_UNAUTHORIZED,
    "expired_token": status.HTTP_401_UNAUTHORIZED,
    "invalid_issuer": status.HTTP_401_UNAUTHORIZED,
    "invalid_signature": status.HTTP_401_UNAUTHORIZED,
    "auth_not_configured": status.HTTP_401_UNAUTHORIZED,
    # Authentifiziert, aber im Planner nicht freigeschaltet bzw. gesperrt -
    # das ist eine Autorisierungsentscheidung, kein Anmeldeproblem.
    "unknown_user": status.HTTP_403_FORBIDDEN,
    "inactive_user": status.HTTP_403_FORBIDDEN,
    "insufficient_role": status.HTTP_403_FORBIDDEN,
}


class AuthError(Exception):
    """Interner Auth-Fehler. `reason` ist nur fürs Logging."""

    def __init__(self, code: str, reason: Optional[str] = None):
        super().__init__(code)
        self.code = code
        self.reason = reason

    @property
    def status_code(self) -> int:
        return _STATUS_BY_CODE.get(self.code, status.HTTP_401_UNAUTHORIZED)

    @property
    def public_message(self) -> str:
        return _PUBLIC_MESSAGES.get(self.code, _UNAUTHENTICATED_MESSAGE)

    def as_http_exception(self) -> HTTPException:
        headers = None
        if self.status_code == status.HTTP_401_UNAUTHORIZED:
            # RFC 6750: 401 auf einem Bearer-geschützten Endpunkt gehört mit
            # WWW-Authenticate beantwortet, damit Clients den Fall sauber von
            # einem 403 unterscheiden können. Bewusst ohne error_description -
            # dort landet sonst genau der interne Grund, der nicht raus soll.
            headers = {"WWW-Authenticate": "Bearer"}
        return HTTPException(
            status_code=self.status_code,
            detail=self.public_message,
            headers=headers,
        )
