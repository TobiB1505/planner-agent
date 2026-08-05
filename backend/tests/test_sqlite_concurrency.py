"""Tests für WAL-Parallelzugriff und busy_timeout (AP3 - SQLite-Fundament).

Nutzt ausschließlich eine temporäre, dateibasierte Testdatenbank in tmp_path -
nie die echte lokale Mitarbeiterdatenbank. WAL braucht eine echte Datei
(":memory:"-Datenbanken bleiben im journal_mode "memory", siehe db.py), daher
verwenden diese Tests bewusst echte Dateien statt einer In-Memory-DB.
"""
from __future__ import annotations

import sqlite3
import threading
import time

import pytest

from backend import db as db_module


@pytest.fixture
def wal_db(tmp_path):
    """Legt eine frische, dateibasierte Testdatenbank mit dem echten Schema an
    (inkl. WAL/busy_timeout über db._configure_connection, wie in db.get_conn())."""
    db_path = tmp_path / "wal_concurrency_test.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    db_module._configure_connection(conn)
    conn.executescript(db_module.SCHEMA)
    db_module._migrate(conn)
    conn.close()
    return db_path


def _connect(db_path) -> sqlite3.Connection:
    """Öffnet eine weitere Verbindung genauso wie db.get_conn() es täte -
    ohne den restlichen Connection-Lifecycle (Ordner anlegen, Migration) neu
    auszuführen, der hier nicht Testgegenstand ist."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    db_module._configure_connection(conn)
    return conn


def test_new_file_database_runs_in_wal_mode(wal_db):
    conn = _connect(wal_db)
    try:
        assert conn.execute("PRAGMA journal_mode;").fetchone()[0].lower() == "wal"
    finally:
        conn.close()


def test_busy_timeout_is_set_on_every_connection(wal_db):
    conn_a = _connect(wal_db)
    conn_b = _connect(wal_db)
    try:
        assert conn_a.execute("PRAGMA busy_timeout;").fetchone()[0] == 5000
        assert conn_b.execute("PRAGMA busy_timeout;").fetchone()[0] == 5000
    finally:
        conn_a.close()
        conn_b.close()


def test_two_connections_can_read_the_same_committed_data(wal_db):
    """Grundfall: Connection A schreibt und committet, Connection B liest parallel."""
    conn_a = _connect(wal_db)
    conn_b = _connect(wal_db)
    try:
        conn_a.execute(
            "INSERT INTO people (name, department) VALUES (?, ?)",
            ("Concurrency-A", "Testabteilung"),
        )
        conn_a.commit()

        # Connection A kann lesen.
        assert conn_a.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 1
        # Connection B kann parallel (unabhängig) lesen.
        assert conn_b.execute("SELECT name FROM people").fetchone()["name"] == "Concurrency-A"
    finally:
        conn_a.close()
        conn_b.close()


def test_reader_is_not_blocked_by_an_open_writer_transaction(wal_db):
    """WAL-Kernversprechen: eine offene, noch nicht committete Schreibtransaktion
    blockiert andere Leser nicht - der Reader bekommt sofort den letzten
    committeten Stand zurück, ohne zu warten."""
    writer = _connect(wal_db)
    reader = _connect(wal_db)
    try:
        writer.execute("BEGIN IMMEDIATE")
        writer.execute(
            "INSERT INTO people (name, department) VALUES (?, ?)",
            ("Uncommitted-Writer-Row", None),
        )

        started = time.monotonic()
        count_during_open_write = reader.execute("SELECT COUNT(*) FROM people").fetchone()[0]
        elapsed = time.monotonic() - started

        # Reader wird nicht blockiert (keine spürbare Wartezeit) ...
        assert elapsed < 0.5
        # ... und sieht die uncommittete Zeile des Writers noch nicht.
        assert count_during_open_write == 0

        writer.commit()
        # Nach dem Commit ist die Zeile für den Reader sichtbar.
        assert reader.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 1
    finally:
        writer.close()
        reader.close()


def test_short_write_lock_is_absorbed_by_busy_timeout(wal_db):
    """Ein kurzer Schreib-Lock einer anderen Verbindung führt dank busy_timeout
    zu einem kurzen Warten statt sofort zu 'database is locked' zu führen.
    Nach Abschluss beider Transaktionen sind die Daten konsistent."""
    holder_ready = threading.Event()
    hold_seconds = 0.3

    def hold_write_lock():
        conn = _connect(wal_db)
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                "INSERT INTO people (name, department) VALUES (?, ?)",
                ("Writer-A", None),
            )
            holder_ready.set()
            time.sleep(hold_seconds)
            conn.commit()
        finally:
            conn.close()

    holder = threading.Thread(target=hold_write_lock)
    holder.start()
    # Kurz warten, bis der Holder den Schreib-Lock sicher hält - kein festes
    # Sleep-Raten, sondern ein Event, das sofort nach BEGIN IMMEDIATE gesetzt wird.
    assert holder_ready.wait(timeout=2), "Schreib-Lock wurde nicht rechtzeitig gehalten"

    second = _connect(wal_db)
    error: sqlite3.OperationalError | None = None
    elapsed = None
    try:
        started = time.monotonic()
        second.execute("BEGIN IMMEDIATE")
        second.execute(
            "INSERT INTO people (name, department) VALUES (?, ?)",
            ("Writer-B", None),
        )
        second.commit()
        elapsed = time.monotonic() - started
    except sqlite3.OperationalError as exc:
        error = exc
    finally:
        second.close()
        holder.join(timeout=5)

    assert error is None, f"busy_timeout hat die Sperre nicht abgefangen: {error}"
    # Musste auf den Holder warten (kurz unterhalb von hold_seconds ist ok),
    # aber weit unterhalb des konfigurierten busy_timeout von 5s.
    assert elapsed is not None and elapsed < 2.0

    verify = _connect(wal_db)
    try:
        names = {row["name"] for row in verify.execute("SELECT name FROM people").fetchall()}
        assert {"Writer-A", "Writer-B"} <= names
    finally:
        verify.close()
