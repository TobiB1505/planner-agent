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
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from backend import db
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
