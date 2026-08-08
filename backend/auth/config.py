"""Auth-Konfiguration aus Umgebungsvariablen (Supabase Auth).

Bewusst kein Modul-Level-Caching der Werte: die Einstellungen werden bei
jedem Zugriff frisch aus der Umgebung gelesen (ein paar os.getenv-Aufrufe,
messbar irrelevant gegenüber einer JWT-Prüfung). Das hält Tests ehrlich -
monkeypatch.setenv wirkt sofort, ohne dass ein Cache zurückgesetzt werden
muss. Gecacht wird ausschliesslich das, was teuer ist: die JWKS-Schlüssel
(siehe backend/auth/jwks.py).

Kein SUPABASE_SERVICE_ROLE_KEY: für die reine Token-Verifikation wird er
nicht gebraucht (JWKS ist öffentlich). Er taucht deshalb hier gar nicht
erst auf - was nicht gelesen wird, kann auch nicht versehentlich geloggt
oder weitergereicht werden.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

# Supabase gibt Access Tokens standardmässig mit aud="authenticated" aus.
DEFAULT_AUDIENCE = "authenticated"

# Wie lange ein einmal geladener JWKS-Satz ohne erneuten Netzwerkabruf
# verwendet wird. Supabase rotiert Signaturschlüssel selten und kündigt eine
# Rotation über eine neue "kid" an - die wird unabhängig vom TTL über den
# gezielten Refresh bei unbekannter kid abgedeckt (siehe jwks.py).
DEFAULT_JWKS_CACHE_SECONDS = 600

# Untergrenze zwischen zwei Netzwerkabrufen. Verhindert, dass ein Angreifer
# mit erfundenen "kid"-Werten beliebig viele JWKS-Abrufe auslösen kann.
DEFAULT_JWKS_MIN_REFRESH_SECONDS = 30

# Kleine Toleranz gegen Uhrzeitdrift zwischen Supabase und dem Backend.
DEFAULT_LEEWAY_SECONDS = 10


@dataclass(frozen=True)
class AuthSettings:
    """Aufgelöste Auth-Konfiguration. `is_configured` ist die einzige Stelle,
    die entscheidet, ob überhaupt eine Verifikation möglich ist."""

    supabase_url: Optional[str]
    issuer: Optional[str]
    jwks_url: Optional[str]
    audience: str
    # Nur für Projekte, die noch das ältere, symmetrische Supabase-JWT-Secret
    # (HS256) verwenden. Leer lassen, wenn das Projekt asymmetrische Schlüssel
    # nutzt - dann läuft alles über JWKS.
    jwt_secret: Optional[str]
    jwks_cache_seconds: int
    jwks_min_refresh_seconds: int
    leeway_seconds: int

    @property
    def is_configured(self) -> bool:
        return bool(self.jwks_url) or bool(self.jwt_secret)


def _clean(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    value = raw.strip()
    return value or None


def _int_env(name: str, default: int) -> int:
    raw = _clean(os.getenv(name))
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= 0 else default


def load_auth_settings() -> AuthSettings:
    supabase_url = _clean(os.getenv("SUPABASE_URL"))
    if supabase_url:
        supabase_url = supabase_url.rstrip("/")

    issuer = _clean(os.getenv("SUPABASE_JWT_ISSUER"))
    if issuer is None and supabase_url:
        # Supabase-Standard: <project-url>/auth/v1 ist der iss-Claim.
        issuer = f"{supabase_url}/auth/v1"
    if issuer:
        issuer = issuer.rstrip("/")

    jwks_url = _clean(os.getenv("SUPABASE_JWKS_URL"))
    if jwks_url is None and issuer:
        jwks_url = f"{issuer}/.well-known/jwks.json"

    return AuthSettings(
        supabase_url=supabase_url,
        issuer=issuer,
        jwks_url=jwks_url,
        audience=_clean(os.getenv("SUPABASE_JWT_AUDIENCE")) or DEFAULT_AUDIENCE,
        jwt_secret=_clean(os.getenv("SUPABASE_JWT_SECRET")),
        jwks_cache_seconds=_int_env("SUPABASE_JWKS_CACHE_SECONDS", DEFAULT_JWKS_CACHE_SECONDS),
        jwks_min_refresh_seconds=_int_env(
            "SUPABASE_JWKS_MIN_REFRESH_SECONDS", DEFAULT_JWKS_MIN_REFRESH_SECONDS
        ),
        leeway_seconds=_int_env("SUPABASE_JWT_LEEWAY_SECONDS", DEFAULT_LEEWAY_SECONDS),
    )
