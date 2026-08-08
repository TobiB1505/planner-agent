"""Hilfsmittel für Tests, die die *echte* Auth-Kette durchlaufen.

Zwei Sorten von Tests brauchen das:

  1. Tests der Verifikation selbst (test_auth_jwt.py) - dort werden Tokens
     gezielt kaputt gemacht (falscher Issuer, abgelaufen, falsche Signatur).
  2. Tests gegen einen echten, eigenständigen Backend-Prozess
     (test_preview_*.py, test_uvicorn_real_concurrency.py). Dort gibt es
     keine dependency_overrides - der Prozess kennt nur HTTP.

Für beides wird der symmetrische HS256-Pfad verwendet (SUPABASE_JWT_SECRET),
weil sich damit ohne Netzwerk und ohne Schlüsselpaar-Verwaltung ein echtes,
signiertes Token erzeugen lässt. Der asymmetrische JWKS-Pfad wird in
test_auth_jwt.py separat mit einem im Test erzeugten RSA-Schlüssel und einem
gemockten JWKS-Abruf geprüft - beide Codepfade sind also abgedeckt.

Das Secret hier ist ein reiner Testwert und hat mit keiner echten Umgebung
etwas zu tun.
"""
from __future__ import annotations

import time
from typing import Optional

import jwt

from backend import db

TEST_JWT_SECRET = "test-only-secret-not-used-anywhere-else"
TEST_ISSUER = "https://planner-test.supabase.invalid/auth/v1"
TEST_AUDIENCE = "authenticated"

ADMIN_UUID = "11111111-1111-4111-8111-111111111111"
PLANNER_UUID = "22222222-2222-4222-8222-222222222222"
EMPLOYEE_UUID = "33333333-3333-4333-8333-333333333333"


def apply_auth_env(env: dict) -> dict:
    """Ergänzt ein Umgebungs-Dict um die HS256-Testkonfiguration.

    Für Subprozess-Tests: der gestartete Backend-Prozess prüft damit echte
    Tokens - inklusive Signatur, Issuer, Audience und Ablauf.
    """
    env["SUPABASE_JWT_SECRET"] = TEST_JWT_SECRET
    env["SUPABASE_JWT_ISSUER"] = TEST_ISSUER
    env["SUPABASE_JWT_AUDIENCE"] = TEST_AUDIENCE
    return env


def make_token(
    subject: str,
    *,
    secret: str = TEST_JWT_SECRET,
    issuer: str = TEST_ISSUER,
    audience: str = TEST_AUDIENCE,
    expires_in: int = 3600,
    algorithm: str = "HS256",
    email: Optional[str] = "user@planner.invalid",
    headers: Optional[dict] = None,
    omit_claims: tuple = (),
) -> str:
    """Erzeugt ein signiertes Testtoken. Über die Parameter lässt sich jeder
    Fehlerfall gezielt herstellen (abgelaufen, falscher Issuer, ...)."""
    now = int(time.time())
    payload = {
        "sub": subject,
        "iss": issuer,
        "aud": audience,
        "iat": now,
        "exp": now + expires_in,
        "role": "authenticated",
    }
    if email is not None:
        payload["email"] = email
    for claim in omit_claims:
        payload.pop(claim, None)
    return jwt.encode(payload, secret, algorithm=algorithm, headers=headers)


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def seed_app_user(
    user_id: str,
    role: str,
    person_id: Optional[int] = None,
    is_active: bool = True,
) -> None:
    """Trägt eine app_users-Zeile in das isolierte Testschema ein.

    Wird von den Subprozess-Tests genutzt: der gestartete Backend-Prozess erbt
    DATABASE_URL aus der Umgebung (die `_isolated_schema`-Fixture setzt sie auf
    das Schema dieses einen Tests), sieht also genau diese Zeile. Ein
    eigenständiger Verbindungsaufbau ist nicht nötig - db.get_conn() nutzt
    dieselbe DSN.
    """
    conn = db.get_conn()
    try:
        db.create_app_user(conn, user_id, role, person_id, is_active)
        conn.commit()
    finally:
        conn.close()
