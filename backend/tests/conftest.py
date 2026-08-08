"""Zentrale Test-Infrastruktur (Safety Fix - Testisolation und
SQLite-Thread-Sicherheit).

Enthält:
  - `_guard_against_real_database` (autouse): verhindert *jeden* Zugriff auf
    die echte lokale Datenbank unter local_data/database/dienstplaene.db,
    unabhängig davon, über welchen Codepfad (db.DATABASE_PATH,
    config_paths.DATABASE_PATH oder ein direkter sqlite3.connect-Aufruf) er
    erfolgt. Greift für die gesamte Testsuite, ohne dass einzelne Testdateien
    etwas dafür tun müssen.
  - `test_db_path`/`test_conn`: wiederverwendbare Fixtures für eine isolierte,
    dateibasierte Testdatenbank in `tmp_path` - dasselbe Muster, das die
    meisten bestehenden Tests bereits über lokale Helper-Funktionen
    (`_conn(tmp_path, monkeypatch, filename)`) verwenden, hier zentral
    bereitgestellt für neue Tests.

Bereits vor diesem Safety Fix isolierte Tests (die überwiegende Mehrheit,
siehe docs/refactoring/SAFETY_TEST_ISOLATION.md) wurden bewusst NICHT auf
diese zentrale Fixture migriert, um funktionierende, bereits verifizierte
Tests nicht unnötig anzufassen - der Guard unten schützt sie ohnehin
zusätzlich ab.

Auth-Sprint - zusätzlich enthalten:
  - `authenticated_as_admin` (autouse): hängt für die *bestehenden*
    Fachtests eine feste Admin-Identität an die App. Das ist ausdrücklich
    kein Abschalten der Auth-Prüfung: der Dependency-Baum läuft
    unverändert, jeder Endpunkt fragt weiter nach einem CurrentUser und
    prüft seine Rolle - nur die JWT-Verifikation wird durch eine
    Test-Identität ersetzt, weil ein Fachtest keine Supabase-Instanz
    braucht. Wer echte Auth testen will, markiert seinen Test mit
    `@pytest.mark.real_auth` (siehe test_auth_jwt.py) - dann greift die
    Fixture nicht.
  - `employee_client`/`planner_client`/`admin_client`: TestClients mit
    genau einer Rolle, für die RBAC-Matrix (test_auth_rbac_matrix.py).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from backend import db
from backend.auth.dependencies import get_current_user
from backend.auth.models import AppRole, CurrentUser
from backend.config import paths as config_paths

# Wird einmalig beim Import aufgelöst (Modulkonstante, ändert sich zur
# Laufzeit nicht) - der reale Pfad, den keine Testdatenbank je verwenden darf.
_REAL_DATABASE_PATH = config_paths.DATABASE_PATH.resolve()


@pytest.fixture(autouse=True)
def _guard_against_real_database(monkeypatch):
    """Schutztest (Schritt 6): lässt jeden Test fehlschlagen, der versucht,
    lesend oder schreibend eine Verbindung zur echten lokalen Datenbank zu
    öffnen. Wrappt sqlite3.connect global für die Dauer eines jeden Tests -
    das erfasst sowohl db.create_connection() (nutzt db.DATABASE_PATH) als
    auch abweichende Codepfade wie die direkten sqlite3.connect(...)-Aufrufe
    in health()/system_diagnostics() (config_paths.DATABASE_PATH), falls
    diese in Zukunft wieder auseinanderlaufen sollten.

    :memory:-Datenbanken und bereits relative/Test-eigene Pfade sind
    unbetroffen - nur eine exakte Übereinstimmung mit dem aufgelösten realen
    Datenbankpfad schlägt fehl.
    """
    real_connect = sqlite3.connect

    def guarded_connect(database, *args, **kwargs):
        if isinstance(database, (str, Path)):
            candidate = str(database)
            if candidate not in ("", ":memory:") and not candidate.startswith("file::memory:"):
                resolved = Path(candidate).resolve()
                assert resolved != _REAL_DATABASE_PATH, (
                    f"Test versucht, die echte lokale Datenbank zu öffnen: {resolved}. "
                    "Nutze eine isolierte Testdatenbank (siehe backend/tests/conftest.py: "
                    "test_db_path/test_conn oder monkeypatch.setattr(db, \"DATABASE_PATH\", ...))."
                )
        return real_connect(database, *args, **kwargs)

    monkeypatch.setattr(sqlite3, "connect", guarded_connect)


@pytest.fixture
def test_db_path(tmp_path, monkeypatch):
    """Isolierte, dateibasierte Testdatenbank: leitet db.DATABASE_PATH auf
    eine frische Datei in `tmp_path` um, deaktiviert
    `ensure_runtime_directories` (tmp_path existiert bereits) und
    initialisiert das Schema einmalig (AP4-Lifecycle: `initialize_database()`
    legt Schema/Migration an, `create_connection()` selbst tut das nicht
    mehr). Gibt den Pfad zurück, falls ein Test ihn direkt braucht (z. B. für
    `db.DATABASE_PATH`-Vergleiche)."""
    db_path = tmp_path / "test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", db_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    db.initialize_database()
    return db_path


@pytest.fixture
def test_conn(test_db_path):
    """Wie `test_db_path`, liefert zusätzlich eine offene, verbindungsseitig
    konfigurierte Connection (wie `db.get_conn()`/`db.create_connection()`)
    und schließt sie nach dem Test zuverlässig."""
    conn = db.create_connection()
    try:
        yield conn
    finally:
        conn.close()


# --- Auth-Sprint: Identitäten für Tests ---------------------------------------
#
# Warum überhaupt eine Override-Fixture: die ~260 bestehenden Fachtests prüfen
# Planungslogik, nicht Authentifizierung. Sie sollen weder ein Supabase-Projekt
# noch selbst signierte JWTs brauchen. Gleichzeitig darf die Auth-Schicht in
# diesen Tests nicht einfach verschwinden - sonst würde eine kaputte
# Rollenprüfung von genau den Tests gedeckt, die am meisten laufen.
#
# Der Kompromiss: überschrieben wird ausschliesslich `get_current_user`, also
# der Schritt "Token -> Identität". Alles danach - die RoleRequirement-
# Dependencies an den Endpunkten, die Rangfolge ADMIN > PLANNER > EMPLOYEE,
# die 401/403-Logik - läuft in jedem Test unverändert mit. Die echte
# JWT-Verifikation hat ihre eigenen Tests (test_auth_jwt.py), und die
# Rollenmatrix ihre eigenen (test_auth_rbac_matrix.py).

# Feste, offensichtlich synthetische UUIDs - so ist in jedem Fehlerbild
# sofort erkennbar, dass es sich um eine Testidentität handelt.
ADMIN_USER_ID = UUID("00000000-0000-0000-0000-0000000000a1")
PLANNER_USER_ID = UUID("00000000-0000-0000-0000-0000000000b2")
EMPLOYEE_USER_ID = UUID("00000000-0000-0000-0000-0000000000c3")


def make_test_user(role: AppRole, person_id: int | None = None) -> CurrentUser:
    user_ids = {
        AppRole.ADMIN: ADMIN_USER_ID,
        AppRole.PLANNER: PLANNER_USER_ID,
        AppRole.EMPLOYEE: EMPLOYEE_USER_ID,
    }
    return CurrentUser(
        user_id=user_ids[role],
        role=role,
        person_id=person_id,
        email=f"{role.value}@planner.invalid",
    )


def override_current_user(user: CurrentUser | None) -> None:
    """Setzt (oder entfernt) die Testidentität an der echten App-Instanz."""
    from backend.api import app

    if user is None:
        app.dependency_overrides.pop(get_current_user, None)
    else:
        app.dependency_overrides[get_current_user] = lambda: user


@pytest.fixture(autouse=True)
def authenticated_as_admin(request):
    """Standard-Identität für alle Tests: Admin.

    Admin deckt jede Mindestrolle ab, damit bestehende Tests unverändert
    durchlaufen (u.a. test_system_restart_gating.py, das einen Admin-Endpunkt
    anspricht). Tests mit `@pytest.mark.real_auth` bekommen keine Identität -
    dort soll genau der ungeschützte Fall geprüft werden.
    """
    if "real_auth" in request.keywords:
        yield None
        return

    user = make_test_user(AppRole.ADMIN)
    override_current_user(user)
    try:
        yield user
    finally:
        override_current_user(None)


@pytest.fixture
def as_role():
    """Wechselt die Identität innerhalb eines Tests: `as_role(AppRole.EMPLOYEE)`."""

    def _set(role: AppRole, person_id: int | None = None) -> CurrentUser:
        user = make_test_user(role, person_id)
        override_current_user(user)
        return user

    return _set


def _role_client(role: AppRole, person_id: int | None = None):
    from backend.api import app

    override_current_user(make_test_user(role, person_id))
    return TestClient(app)


@pytest.fixture
def admin_client(test_db_path):
    with _role_client(AppRole.ADMIN) as client:
        yield client


@pytest.fixture
def planner_client(test_db_path):
    with _role_client(AppRole.PLANNER) as client:
        yield client


@pytest.fixture
def employee_client(test_db_path):
    # Employee bekommt bewusst eine person_id: laut Datenmodell ist ein
    # Mitarbeiterkonto ohne zugeordnete Person nicht vorgesehen.
    with _role_client(AppRole.EMPLOYEE, person_id=1) as client:
        yield client


@pytest.fixture
def anonymous_client(test_db_path):
    """Client ganz ohne Identität - für die 401-Fälle."""
    from backend.api import app

    override_current_user(None)
    with TestClient(app) as client:
        yield client
