"""Verifikation von Supabase-Access-Tokens (JWT).

Bewusst *keine* reine Dekodierung: jedes Token durchläuft Signatur-, Issuer-,
Audience- und Ablaufprüfung. `options={"verify_signature": False}` kommt genau
einmal vor - beim Lesen des unsignierten Headers, um kid/alg zu bestimmen -
und liefert nie Claims, auf die eine Entscheidung gestützt wird.

Algorithmen:
  - ES256/RS256: Schlüssel kommt aus dem JWKS des Projekts (Standard bei
    Supabase-Projekten mit asymmetrischen Signaturschlüsseln).
  - HS256: nur, wenn SUPABASE_JWT_SECRET gesetzt ist (ältere Projekte mit
    symmetrischem JWT-Secret).

Die Trennung ist sicherheitsrelevant: ein HS256-Token wird niemals gegen
einen JWKS-Schlüssel geprüft (Algorithm-Confusion), und ein asymmetrisches
Token niemals gegen das Secret.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import jwt

from .config import AuthSettings, load_auth_settings
from .errors import AuthError
from .jwks import get_cache

logger = logging.getLogger(__name__)

ASYMMETRIC_ALGORITHMS = ("ES256", "RS256")
SYMMETRIC_ALGORITHMS = ("HS256",)


@dataclass(frozen=True)
class TokenClaims:
    """Die geprüften Claims, auf die wir uns stützen. Alles andere aus dem
    Token wird bewusst nicht weitergereicht."""

    subject: UUID
    email: Optional[str]
    issuer: str
    expires_at: int


def _unverified_header(token: str) -> dict:
    try:
        return jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise AuthError("invalid_token", f"Header nicht lesbar: {type(exc).__name__}") from exc


def _decode(token: str, key, algorithms, settings: AuthSettings) -> dict:
    try:
        return jwt.decode(
            token,
            key,
            algorithms=list(algorithms),
            issuer=settings.issuer,
            audience=settings.audience,
            leeway=settings.leeway_seconds,
            options={
                "require": ["exp", "sub", "iss"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": bool(settings.issuer),
                "verify_aud": True,
            },
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError("expired_token", "Token abgelaufen") from exc
    except jwt.InvalidIssuerError as exc:
        raise AuthError("invalid_issuer", "Issuer stimmt nicht") from exc
    except jwt.InvalidSignatureError as exc:
        raise AuthError("invalid_signature", "Signatur ungültig") from exc
    except jwt.PyJWTError as exc:
        # Alles Übrige (fehlende Claims, falsche Audience, kaputtes Format):
        # eine Sammelkategorie - der Aufrufer erfährt ohnehin nur "ungültig".
        raise AuthError("invalid_token", f"Token abgelehnt: {type(exc).__name__}") from exc


def verify_access_token(token: str, settings: Optional[AuthSettings] = None) -> TokenClaims:
    """Prüft ein Supabase-Access-Token vollständig und liefert die Claims.

    Wirft ausschliesslich AuthError - nie einen PyJWT-Fehler, dessen Text in
    einer HTTP-Antwort landen könnte.
    """
    settings = settings or load_auth_settings()
    if not settings.is_configured:
        # Fail-closed: ohne konfigurierte Auth gibt es keinen Zugang. Kein
        # "wenn nichts konfiguriert ist, lassen wir alles durch"-Schalter.
        raise AuthError("auth_not_configured", "Weder JWKS-URL noch JWT-Secret konfiguriert")

    if not token or token.count(".") != 2:
        raise AuthError("invalid_token", "Kein JWT-Format")

    header = _unverified_header(token)
    algorithm = str(header.get("alg") or "")

    if algorithm in ASYMMETRIC_ALGORITHMS:
        if not settings.jwks_url:
            raise AuthError("auth_not_configured", "Asymmetrisches Token ohne konfigurierte JWKS-URL")
        cache = get_cache(
            settings.jwks_url, settings.jwks_cache_seconds, settings.jwks_min_refresh_seconds
        )
        jwk = cache.get_key(str(header.get("kid") or ""))
        payload = _decode(token, jwk.key, [algorithm], settings)
    elif algorithm in SYMMETRIC_ALGORITHMS:
        if not settings.jwt_secret:
            raise AuthError("invalid_token", "HS256-Token ohne konfiguriertes JWT-Secret")
        payload = _decode(token, settings.jwt_secret, [algorithm], settings)
    else:
        # Insbesondere "none" landet hier - und wird abgelehnt.
        raise AuthError("invalid_token", f"Nicht unterstützter Algorithmus: {algorithm or 'fehlt'}")

    raw_subject = payload.get("sub")
    try:
        subject = UUID(str(raw_subject))
    except (TypeError, ValueError) as exc:
        raise AuthError("invalid_token", "sub ist keine UUID") from exc

    email = payload.get("email")
    return TokenClaims(
        subject=subject,
        email=str(email) if email else None,
        issuer=str(payload.get("iss") or ""),
        expires_at=int(payload.get("exp") or 0),
    )
