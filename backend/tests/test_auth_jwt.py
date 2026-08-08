"""Auth-Sprint - die echte Authentifizierungskette (Aufgabe 36).

Diese Tests sind mit `@pytest.mark.real_auth` markiert: die Standard-
Testidentität aus conftest.py greift hier bewusst NICHT. Geprüft wird der
vollständige Weg vom HTTP-Header bis zum CurrentUser, inklusive
Signaturprüfung.

Abgedeckt:
  - kein Token, kaputtes Format, alg=none
  - abgelaufener Token
  - falscher Issuer, falsche Audience
  - kaputte Signatur (richtiges Format, falscher Schlüssel)
  - unbekannter Benutzer (kein app_users-Eintrag)
  - deaktivierter Benutzer
  - fehlende Pflicht-Claims
  - der asymmetrische JWKS-Pfad inkl. Caching, Rotation und Ausfallverhalten
"""
from __future__ import annotations

import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from backend import db
from backend.api import app
from backend.auth import jwks as jwks_module
from backend.auth.config import load_auth_settings
from backend.auth.errors import AuthError
from backend.auth.tokens import verify_access_token

from . import auth_helpers

pytestmark = pytest.mark.real_auth

# Ein beliebiger geschützter Endpunkt mit der niedrigsten Hürde (EMPLOYEE) -
# was hier scheitert, scheitert überall.
PROTECTED_URL = "/api/artist-plans"


@pytest.fixture
def hs256_env(monkeypatch, test_db_path):
    """Backend mit symmetrischer Testkonfiguration - kein Netzwerk nötig."""
    monkeypatch.setenv("SUPABASE_JWT_SECRET", auth_helpers.TEST_JWT_SECRET)
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", auth_helpers.TEST_ISSUER)
    monkeypatch.setenv("SUPABASE_JWT_AUDIENCE", auth_helpers.TEST_AUDIENCE)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_JWKS_URL", raising=False)
    return test_db_path


@pytest.fixture
def client(hs256_env):
    with TestClient(app) as test_client:
        yield test_client


def _seed(user_id: str, role: str, is_active: bool = True, person_id=None) -> None:
    conn = db.get_conn()
    try:
        db.create_app_user(conn, user_id, role, person_id, is_active)
        conn.commit()
    finally:
        conn.close()


def _seeded_employee() -> str:
    conn = db.get_conn()
    try:
        person_id = db.create_person(conn, "Auth Testperson")
        conn.commit()
    finally:
        conn.close()
    _seed(auth_helpers.EMPLOYEE_UUID, "employee", person_id=person_id)
    return auth_helpers.EMPLOYEE_UUID


# ---------- Ablehnungsfälle ----------


def test_request_without_token_is_401(client):
    response = client.get(PROTECTED_URL)
    assert response.status_code == 401
    assert response.headers.get("WWW-Authenticate") == "Bearer"


def test_malformed_token_is_401(client):
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer("nicht.mal.ein-jwt"))
    assert response.status_code == 401


def test_expired_token_is_401(client):
    _seeded_employee()
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID, expires_in=-60)
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 401


def test_wrong_issuer_is_401(client):
    _seeded_employee()
    token = auth_helpers.make_token(
        auth_helpers.EMPLOYEE_UUID, issuer="https://fremdes-projekt.supabase.invalid/auth/v1"
    )
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 401


def test_wrong_audience_is_401(client):
    _seeded_employee()
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID, audience="anon")
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 401


def test_broken_signature_is_401(client):
    """Formal einwandfreies Token, aber mit einem anderen Secret signiert."""
    _seeded_employee()
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID, secret="ein-anderes-secret")
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 401


def test_algorithm_none_is_rejected(client):
    """Der klassische JWT-Angriff: alg=none, keine Signatur."""
    _seeded_employee()
    unsigned = jwt.encode(
        {
            "sub": auth_helpers.EMPLOYEE_UUID,
            "iss": auth_helpers.TEST_ISSUER,
            "aud": auth_helpers.TEST_AUDIENCE,
            "exp": int(time.time()) + 3600,
        },
        key="",
        algorithm="none",
    )
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(unsigned))
    assert response.status_code == 401


def test_token_without_exp_is_rejected(client):
    _seeded_employee()
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID, omit_claims=("exp",))
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 401


def test_unknown_user_is_403(client):
    """Token ist gültig, aber im Planner ist niemand freigeschaltet.

    Bewusst 403 und nicht 401: die Anmeldung selbst ist in Ordnung, es fehlt
    die Freischaltung. Und bewusst kein Auto-Anlegen.
    """
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID)
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 403

    conn = db.get_conn()
    try:
        assert db.count_app_users(conn) == 0, "Es darf kein Konto automatisch angelegt werden."
    finally:
        conn.close()


def test_inactive_user_is_403(client):
    conn = db.get_conn()
    try:
        person_id = db.create_person(conn, "Gesperrte Person")
        conn.commit()
    finally:
        conn.close()
    _seed(auth_helpers.EMPLOYEE_UUID, "employee", is_active=False, person_id=person_id)

    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID)
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 403


def test_error_responses_never_leak_internals(client):
    """Keine PyJWT-Meldung, kein Stacktrace, kein Tokeninhalt in der Antwort."""
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID, secret="anderes-secret")
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))

    body = response.text
    assert "Signature" not in body
    assert "Traceback" not in body
    assert token[:20] not in body
    assert auth_helpers.TEST_JWT_SECRET not in body


def test_auth_header_is_never_logged(client, caplog):
    """Aufgabe 42: Auth-Fehler dürfen protokolliert werden - der Token nicht."""
    import logging

    caplog.set_level(logging.INFO)
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID)
    client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))

    logged = "\n".join(record.getMessage() for record in caplog.records)
    assert token not in logged
    assert "Bearer" not in logged
    assert auth_helpers.TEST_JWT_SECRET not in logged


# ---------- Erfolgsfall ----------


def test_valid_token_reaches_the_endpoint(client):
    _seeded_employee()
    token = auth_helpers.make_token(auth_helpers.EMPLOYEE_UUID)
    response = client.get(PROTECTED_URL, headers=auth_helpers.bearer(token))
    assert response.status_code == 200


def test_auth_me_returns_role_and_person(client):
    person_uuid = _seeded_employee()
    token = auth_helpers.make_token(person_uuid, email="mitarbeiter@planner.invalid")

    response = client.get("/api/auth/me", headers=auth_helpers.bearer(token))
    assert response.status_code == 200

    body = response.json()
    assert body["role"] == "employee"
    assert body["person_id"] is not None
    assert body["person_name"] == "Auth Testperson"
    assert body["email"] == "mitarbeiter@planner.invalid"
    # Niemals Token oder Claims zurückspiegeln.
    assert "token" not in body and "access_token" not in body


def test_health_stays_public(client):
    """Aufgabe 19: /api/health muss ohne Token funktionieren (Liveness)."""
    assert client.get("/api/health").status_code == 200


# ---------- Fail-closed ohne Konfiguration ----------


def test_without_supabase_configuration_everything_is_401(monkeypatch, test_db_path):
    for name in (
        "SUPABASE_JWT_SECRET",
        "SUPABASE_JWT_ISSUER",
        "SUPABASE_URL",
        "SUPABASE_JWKS_URL",
    ):
        monkeypatch.delenv(name, raising=False)

    with TestClient(app) as unconfigured:
        assert unconfigured.get(PROTECTED_URL).status_code == 401
        # ... aber die Liveness-Prüfung bleibt erreichbar.
        assert unconfigured.get("/api/health").status_code == 200


# ---------- JWKS-Pfad (asymmetrisch) ----------


@pytest.fixture
def rsa_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwks_document(private_key, kid: str) -> dict:
    public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    public_jwk.update({"kid": kid, "use": "sig", "alg": "RS256"})
    return {"keys": [public_jwk]}


@pytest.fixture
def jwks_env(monkeypatch, test_db_path):
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://planner-test.supabase.invalid")
    monkeypatch.setenv("SUPABASE_JWT_ISSUER", auth_helpers.TEST_ISSUER)
    jwks_module.reset_caches()
    yield
    jwks_module.reset_caches()


def test_asymmetric_token_is_verified_against_jwks(monkeypatch, jwks_env, rsa_key):
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return _jwks_document(rsa_key, "key-1")

    monkeypatch.setattr(jwks_module, "_fetch_jwks", fake_fetch)

    private_pem = rsa_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    token = auth_helpers.make_token(
        auth_helpers.PLANNER_UUID,
        secret=private_pem.decode(),
        algorithm="RS256",
        headers={"kid": "key-1"},
    )

    claims = verify_access_token(token, load_auth_settings())
    assert str(claims.subject) == auth_helpers.PLANNER_UUID

    # Zweite Prüfung: der Schlüssel kommt aus dem Cache, kein neuer Abruf.
    verify_access_token(token, load_auth_settings())
    assert len(calls) == 1, "JWKS darf nicht bei jedem Request neu geladen werden."


def test_unknown_kid_triggers_exactly_one_refresh(monkeypatch, jwks_env, rsa_key):
    calls = []

    def fake_fetch(url):
        calls.append(url)
        return _jwks_document(rsa_key, "key-1")

    monkeypatch.setattr(jwks_module, "_fetch_jwks", fake_fetch)
    settings = load_auth_settings()
    cache = jwks_module.get_cache(settings.jwks_url, settings.jwks_cache_seconds, 30)

    with pytest.raises(AuthError):
        cache.get_key("unbekannte-kid")

    # Ein Refresh-Versuch für die Rotation, danach greift die Mindestwartezeit -
    # sonst könnte man mit erfundenen kids beliebig viele Abrufe auslösen.
    assert len(calls) <= 2
    before = len(calls)
    with pytest.raises(AuthError):
        cache.get_key("noch-eine-unbekannte-kid")
    assert len(calls) == before


def test_failing_refresh_keeps_previously_loaded_keys(monkeypatch, jwks_env, rsa_key):
    """Ein kurzer Supabase-Ausfall darf nicht alle Anmeldungen kippen."""
    state = {"fail": False}

    def fake_fetch(url):
        if state["fail"]:
            raise OSError("Supabase nicht erreichbar")
        return _jwks_document(rsa_key, "key-1")

    monkeypatch.setattr(jwks_module, "_fetch_jwks", fake_fetch)
    cache = jwks_module.JwksCache("https://example.invalid/jwks", cache_seconds=0, min_refresh_seconds=0)

    assert cache.get_key("key-1") is not None
    state["fail"] = True
    # Cache ist sofort abgelaufen (cache_seconds=0), der Refresh scheitert -
    # trotzdem bleibt der bekannte Schlüssel nutzbar.
    assert cache.get_key("key-1") is not None


def test_first_load_failure_is_an_auth_error(monkeypatch):
    def failing_fetch(url):
        raise OSError("Supabase nicht erreichbar")

    monkeypatch.setattr(jwks_module, "_fetch_jwks", failing_fetch)
    cache = jwks_module.JwksCache("https://example.invalid/jwks", 600, 0)

    with pytest.raises(AuthError) as excinfo:
        cache.get_key("key-1")
    assert excinfo.value.status_code == 401
