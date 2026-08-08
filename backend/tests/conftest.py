"""Zentrale Test-Infrastruktur (PostgreSQL-Testisolation).

Enthält:
  - `_guard_test_database_url` (session, autouse): stellt sicher, dass die
    Testsuite niemals gegen eine Produktions-/Live-Datenbank läuft. Sie prüft
    ENVIRONMENT/APP_ENV und verweigert erkennbare Produktionshosts (u.a.
    Supabase-Hostnamen und Produktions-Datenbanknamen). Das ist die
    PostgreSQL-Entsprechung des früheren SQLite-Live-DB-Guards, der jeden
    sqlite3.connect() auf local_data/database/dienstplaene.db abgefangen hat.
  - `_isolated_schema` (autouse): jeder einzelne Test bekommt ein eigenes,
    frisch migriertes PostgreSQL-Schema. Kein Test sieht Daten eines anderen,
    und es gibt keine gemeinsame Datei, über die sich Tests beeinflussen
    könnten.
  - `test_conn`: eine offene Connection auf dieses Schema, wie `db.get_conn()`.
  - `test_db_path`: Rückwärtskompatibler Alias für Tests, die früher nur den
    Pfad brauchten, um die Isolation zu erzwingen - die Isolation passiert
    jetzt ohnehin automatisch.

Warum ein Schema pro Test und keine Datenbank pro Test:
CREATE DATABASE ist in PostgreSQL deutlich teurer (eigenes Verzeichnis,
Template-Kopie) als CREATE SCHEMA. Bei ~260 Tests macht das den Unterschied
zwischen Sekunden und Minuten. Die Isolation ist dieselbe, solange alle
Migrationen und alle Queries unqualifizierte Tabellennamen verwenden (tun sie)
und der search_path pro Verbindung gesetzt ist (macht `_schema_dsn`).
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote

import psycopg
import pytest

from backend import db

DEFAULT_TEST_DATABASE_URL = "postgresql://postgres@127.0.0.1:5432/planner_test"

#: Hostbestandteile, die auf eine gehostete/verwaltete Datenbank hindeuten.
#: Eine Testsuite hat dort nichts zu suchen - auch nicht auf einer
#: "Preview"-Instanz, die echte Planungsdaten enthalten kann.
_FORBIDDEN_HOST_FRAGMENTS = (
    "supabase.co",
    "supabase.com",
    "pooler.supabase",
    "neon.tech",
    "render.com",
    "rds.amazonaws.com",
    "azure.com",
    "googleapis.com",
)

#: Datenbanknamen, die niemals eine Testdatenbank sein können.
_FORBIDDEN_DBNAME_PATTERN = re.compile(
    r"(^|[_-])(prod|production|live|preview|staging)([_-]|$)", re.IGNORECASE
)


def _require_test_environment() -> None:
    """ENVIRONMENT/APP_ENV muss auf Test stehen (Sprint-Punkt 18)."""
    environment = (os.getenv("ENVIRONMENT") or os.getenv("APP_ENV") or "").strip().lower()
    if environment in ("production", "preview", "prod", "live"):
        raise RuntimeError(
            f"Die Testsuite darf nicht mit ENVIRONMENT/APP_ENV={environment!r} laufen. "
            "Tests setzen ENVIRONMENT=test."
        )


def _assert_not_production(dsn: str) -> None:
    """Bricht hart ab, wenn die TEST_DATABASE_URL nach Produktion aussieht."""
    try:
        info = psycopg.conninfo.conninfo_to_dict(dsn)
    except psycopg.Error as exc:
        raise RuntimeError(f"TEST_DATABASE_URL ist keine gültige Verbindungs-URL: {exc}") from exc

    host = (info.get("host") or "").lower()
    dbname = info.get("dbname") or ""

    for fragment in _FORBIDDEN_HOST_FRAGMENTS:
        if fragment in host:
            raise RuntimeError(
                f"TEST_DATABASE_URL zeigt auf einen gehosteten Datenbankdienst ({fragment}). "
                "Die Testsuite läuft ausschließlich gegen eine lokale/CI-eigene "
                "PostgreSQL-Instanz - siehe docs/database/SUPABASE_SETUP.md. "
                "Hostname im Fehlertext bewusst gekürzt, keine Zugangsdaten."
            )

    if _FORBIDDEN_DBNAME_PATTERN.search(dbname):
        raise RuntimeError(
            f"TEST_DATABASE_URL verweist auf die Datenbank {dbname!r}, deren Name auf "
            "eine Produktions-/Preview-Datenbank hindeutet. Bitte eine eigene "
            "Testdatenbank verwenden (z.B. planner_test)."
        )

    if "test" not in dbname.lower():
        raise RuntimeError(
            f"TEST_DATABASE_URL verweist auf die Datenbank {dbname!r}. Der Name einer "
            "Testdatenbank muss 'test' enthalten - das ist die letzte Sicherung "
            "dagegen, dass die Suite versehentlich echte Planungsdaten leert."
        )


def _test_database_url() -> str:
    return (os.getenv("TEST_DATABASE_URL") or DEFAULT_TEST_DATABASE_URL).strip()


def _schema_dsn(base_dsn: str, schema: str) -> str:
    """DSN, die im Testschema landet und ihre Verbindungen eindeutig kennzeichnet.

    `search_path` sorgt für die Isolation, `application_name` dafür, dass der
    Teardown die Verbindungen genau dieses Tests wiederfindet (siehe
    `_terminate_schema_backends`).
    """
    separator = "&" if "?" in base_dsn else "?"
    options = quote(f"-c search_path={schema},public")
    return f"{base_dsn}{separator}options={options}&application_name={schema}"


def _terminate_schema_backends(admin: psycopg.Connection, schema: str) -> None:
    """Beendet übrig gebliebene Verbindungen dieses Tests.

    Notwendig, weil einige (schon vor der Migration existierende) Tests ihre
    Connection bewusst nicht schließen - unter SQLite war das folgenlos, unter
    PostgreSQL hält eine offene Transaktion eine Sperre auf dem Schema und
    DROP SCHEMA würde unbegrenzt warten. Es werden ausschließlich Verbindungen
    beendet, die über die application_name-Kennung diesem einen Testschema
    zugeordnet sind - nie fremde Sitzungen.
    """
    admin.execute(
        """SELECT pg_terminate_backend(pid)
           FROM pg_stat_activity
           WHERE application_name = %s AND pid <> pg_backend_pid()""",
        (schema,),
    )


@pytest.fixture(scope="session", autouse=True)
def _guard_test_database_url() -> str:
    """Prüft EINMAL pro Testlauf, dass die Zieldatenbank gefahrlos ist.

    Schlägt sie fehl, bricht die gesamte Suite ab, statt einzelne Tests
    fehlschlagen zu lassen - ein Zugriff auf Produktionsdaten soll nicht erst
    beim dritten Test auffallen.
    """
    os.environ.setdefault("ENVIRONMENT", "test")
    _require_test_environment()

    dsn = _test_database_url()
    _assert_not_production(dsn)

    try:
        with psycopg.connect(dsn) as conn:
            conn.execute("SELECT 1")
    except psycopg.OperationalError as exc:
        pytest.exit(
            "Die PostgreSQL-Testdatenbank ist nicht erreichbar. Bitte eine lokale "
            "Instanz starten und TEST_DATABASE_URL setzen (Default: "
            f"{DEFAULT_TEST_DATABASE_URL}).\nMeldung: {exc}",
            returncode=1,
        )
    return dsn


@pytest.fixture(autouse=True)
def _isolated_schema(_guard_test_database_url, request, monkeypatch):
    """Jeder Test bekommt ein eigenes, frisch migriertes Schema.

    Das ersetzt das frühere Muster
    `monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / "...")`, das in vielen
    Testdateien einzeln wiederholt wurde - die Isolation gilt jetzt automatisch
    für jeden Test, auch für neue.
    """
    base_dsn = _guard_test_database_url
    # Schemaname aus einem Zähler statt aus dem Testnamen: Testnamen können
    # parametrisiert und beliebig lang sein, PostgreSQL-Bezeichner sind auf 63
    # Zeichen begrenzt.
    index = next(_schema_counter)
    schema = f"t_{index}"

    admin = psycopg.connect(base_dsn, autocommit=True)
    try:
        admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        admin.execute(f'CREATE SCHEMA "{schema}"')
    finally:
        admin.close()

    dsn = _schema_dsn(base_dsn, schema)
    monkeypatch.setenv("DATABASE_URL", dsn)
    db.close_pool()
    db.initialize_database()

    try:
        yield schema
    finally:
        db.close_pool()
        admin = psycopg.connect(base_dsn, autocommit=True)
        try:
            _terminate_schema_backends(admin, schema)
            admin.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        finally:
            admin.close()


def _counter():
    value = 0
    while True:
        value += 1
        yield value


_schema_counter = _counter()


@pytest.fixture
def test_db_path(_isolated_schema):
    """Rückwärtskompatibler Name.

    Früher der Pfad einer isolierten SQLite-Datei; heute gibt es keine Datei
    mehr. Der Rückgabewert ist der Name des isolierten Testschemas - Tests, die
    ihn nur angefordert haben, um Isolation zu erzwingen, funktionieren
    unverändert (die Isolation ist inzwischen ohnehin autouse).
    """
    return _isolated_schema


@pytest.fixture
def test_conn():
    """Offene Connection auf das isolierte Testschema, wird zuverlässig geschlossen."""
    conn = db.create_connection()
    try:
        yield conn
    finally:
        conn.close()
