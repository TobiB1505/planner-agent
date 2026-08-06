"""Sprint 1, Teil 3 - Backup/Restore-Tests für backend/backup.py.

Deckt Schritt 4 der Aufgabenstellung ab: Testdatenbank erstellen, Daten
einfügen, Backup erstellen, Quelle beschädigen/löschen, Restore durchführen,
Daten prüfen. Immer gegen isolierte Dateien in tmp_path - nie gegen die
echte lokale Datenbank.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from datetime import datetime

import pytest

from backend.backup import BackupError, create_backup, list_backups, restore_backup, verify_backup


def _make_database(path, rows: list[tuple[int, str]]) -> None:
    conn = sqlite3.connect(str(path))
    try:
        conn.execute("CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT)")
        conn.executemany("INSERT INTO people (id, name) VALUES (?, ?)", rows)
        conn.commit()
    finally:
        conn.close()


def _read_rows(path) -> list[tuple[int, str]]:
    conn = sqlite3.connect(str(path))
    try:
        return conn.execute("SELECT id, name FROM people ORDER BY id").fetchall()
    finally:
        conn.close()


# ---------- Backup erstellen ----------


def test_create_backup_produces_a_file_with_timestamped_name(tmp_path):
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    backup_dir = tmp_path / "backups"

    backup_path = create_backup(source, backup_dir, now=datetime(2026, 8, 6, 12, 0))

    assert backup_path.parent == backup_dir
    assert backup_path.name == "dienstplaene_2026-08-06_1200.db"
    assert backup_path.exists()


def test_create_backup_copies_all_data_correctly(tmp_path):
    source = tmp_path / "dienstplaene.db"
    rows = [(1, "Tobi"), (2, "Fanny"), (3, "Kilian")]
    _make_database(source, rows)

    backup_path = create_backup(source, tmp_path / "backups")

    assert _read_rows(backup_path) == rows


def test_create_backup_raises_when_source_missing(tmp_path):
    with pytest.raises(BackupError, match="nicht gefunden"):
        create_backup(tmp_path / "nicht-vorhanden.db", tmp_path / "backups")


def test_create_backup_avoids_collisions_within_the_same_minute(tmp_path):
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    backup_dir = tmp_path / "backups"
    same_minute = datetime(2026, 8, 6, 12, 0)

    first = create_backup(source, backup_dir, now=same_minute)
    second = create_backup(source, backup_dir, now=same_minute)

    assert first != second
    assert first.exists() and second.exists()


def test_create_backup_works_while_a_concurrent_write_transaction_is_open(tmp_path):
    """Kernanforderung aus der Aufgabenstellung: Backup muss während laufender
    Anwendung funktionieren, nicht nur gegen eine ruhende Datei. Simuliert
    eine zweite, gleichzeitig schreibende Verbindung (wie ein echter Request
    während des Backups) und prüft, dass das Backup trotzdem gelingt und nur
    committete Daten enthält."""
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])

    writer = sqlite3.connect(str(source))
    writer.execute("PRAGMA journal_mode=WAL")
    writer.execute("BEGIN")
    writer.execute("INSERT INTO people (id, name) VALUES (2, 'Nicht committet')")
    try:
        backup_path = create_backup(source, tmp_path / "backups")
        assert _read_rows(backup_path) == [(1, "Tobi")], (
            "Backup darf keine unkommittete Zeile einer parallel offenen "
            "Transaktion enthalten"
        )
    finally:
        writer.commit()
        writer.close()


def test_create_backup_works_under_concurrent_real_requests(tmp_path):
    """Wie oben, aber mit echten parallelen Threads statt einer nur
    simulierten offenen Transaktion - näher am realen Produktionsbetrieb."""
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    conn = sqlite3.connect(str(source))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.close()

    stop = threading.Event()
    errors: list[Exception] = []

    def hammer_writes():
        local_conn = sqlite3.connect(str(source), timeout=5)
        try:
            i = 100
            while not stop.is_set():
                try:
                    local_conn.execute(
                        "INSERT INTO people (id, name) VALUES (?, ?)", (i, f"Person{i}")
                    )
                    local_conn.commit()
                    i += 1
                except sqlite3.OperationalError:
                    continue
        except Exception as exc:  # pragma: no cover - nur zur Fehlerdiagnose
            errors.append(exc)
        finally:
            local_conn.close()

    thread = threading.Thread(target=hammer_writes)
    thread.start()
    time.sleep(0.05)
    try:
        backup_path = create_backup(source, tmp_path / "backups")
        assert verify_backup(backup_path)
    finally:
        stop.set()
        thread.join(timeout=5)

    assert not errors, f"Schreibthread meldete Fehler: {errors}"


# ---------- Integritätsprüfung ----------


def test_verify_backup_returns_true_for_a_valid_backup(tmp_path):
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    backup_path = create_backup(source, tmp_path / "backups")

    assert verify_backup(backup_path) is True


def test_verify_backup_returns_false_for_a_corrupted_file(tmp_path):
    fake_backup = tmp_path / "kaputt.db"
    fake_backup.write_bytes(b"das ist keine sqlite datei")

    assert verify_backup(fake_backup) is False


def test_verify_backup_returns_false_for_a_missing_file(tmp_path):
    assert verify_backup(tmp_path / "gibt-es-nicht.db") is False


# ---------- Restore (Schritt 4: kompletter Ablauf) ----------


def test_full_backup_and_restore_cycle_after_database_is_destroyed(tmp_path):
    """Genau der in der Aufgabenstellung beschriebene Testablauf:
    1. Testdatenbank erstellen
    2. Daten einfügen
    3. Backup erstellen
    4. DB beschädigen/löschen
    5. Restore durchführen
    6. Daten prüfen
    """
    source = tmp_path / "dienstplaene.db"
    rows = [(1, "Tobi"), (2, "Fanny"), (3, "Kilian"), (4, "Selina")]
    _make_database(source, rows)  # 1 + 2

    backup_path = create_backup(source, tmp_path / "backups")  # 3
    assert verify_backup(backup_path)

    source.unlink()  # 4a: löschen
    assert not source.exists()

    restored_path = restore_backup(backup_path, source)  # 5

    assert restored_path == source
    assert _read_rows(source) == rows  # 6


def test_restore_after_database_is_corrupted(tmp_path):
    source = tmp_path / "dienstplaene.db"
    rows = [(1, "Tobi")]
    _make_database(source, rows)
    backup_path = create_backup(source, tmp_path / "backups")

    source.write_bytes(b"korrupte daten statt einer echten sqlite datei")  # 4b: beschädigen

    restore_backup(backup_path, source)

    assert _read_rows(source) == rows


def test_restore_refuses_a_corrupted_backup(tmp_path):
    fake_backup = tmp_path / "backups" / "kaputt.db"
    fake_backup.parent.mkdir(parents=True)
    fake_backup.write_bytes(b"keine echte sqlite datei")
    target = tmp_path / "dienstplaene.db"

    with pytest.raises(BackupError, match="beschädigt"):
        restore_backup(fake_backup, target)

    assert not target.exists(), "bei abgelehntem Restore darf kein Zielfile entstehen"


def test_restore_raises_when_backup_file_missing(tmp_path):
    with pytest.raises(BackupError, match="nicht gefunden"):
        restore_backup(tmp_path / "existiert-nicht.db", tmp_path / "ziel.db")


def test_restore_keeps_a_safety_copy_of_the_previous_database(tmp_path):
    """Was passiert bei einem Fehler? Die vorherige, ggf. noch funktionierende
    Datenbank darf nicht ersatzlos überschrieben werden."""
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Alt")])
    backup_path = create_backup(source, tmp_path / "backups")

    # Zwischenzeitlich ändert sich die "aktuelle" DB (z.B. neue Zuweisungen).
    conn = sqlite3.connect(str(source))
    conn.execute("INSERT INTO people (id, name) VALUES (2, 'Neu vor Restore')")
    conn.commit()
    conn.close()

    restore_backup(backup_path, source)

    safety_copy = source.with_suffix(source.suffix + ".pre-restore")
    assert safety_copy.exists(), "die überschriebene Datenbank muss vorher gesichert werden"
    assert _read_rows(safety_copy) == [(1, "Alt"), (2, "Neu vor Restore")]
    assert _read_rows(source) == [(1, "Alt")]


def test_restore_removes_stale_wal_and_shm_files(tmp_path):
    """Verwaiste WAL/SHM-Dateien der überschriebenen Datenbank dürfen nicht
    mit den Seiten der wiederhergestellten Datei vermischt werden."""
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    backup_path = create_backup(source, tmp_path / "backups")

    (tmp_path / "dienstplaene.db-wal").write_bytes(b"veraltete wal-daten")
    (tmp_path / "dienstplaene.db-shm").write_bytes(b"veraltete shm-daten")

    restore_backup(backup_path, source)

    assert not (tmp_path / "dienstplaene.db-wal").exists()
    assert not (tmp_path / "dienstplaene.db-shm").exists()
    assert _read_rows(source) == [(1, "Tobi")]


# ---------- list_backups ----------


def test_list_backups_returns_newest_first(tmp_path):
    source = tmp_path / "dienstplaene.db"
    _make_database(source, [(1, "Tobi")])
    backup_dir = tmp_path / "backups"

    older = create_backup(source, backup_dir, now=datetime(2026, 8, 5, 12, 0))
    newer = create_backup(source, backup_dir, now=datetime(2026, 8, 6, 12, 0))

    result = list_backups(backup_dir)

    assert result[0] == newer
    assert result[1] == older


def test_list_backups_returns_empty_list_when_no_backups_exist(tmp_path):
    assert list_backups(tmp_path / "backups") == []
