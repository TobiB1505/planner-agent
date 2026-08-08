"""Nebenläufigkeit unter PostgreSQL (Nachfolger von test_sqlite_concurrency.py).

Die alte Fassung prüfte SQLite-spezifische Mechanik: `PRAGMA journal_mode=WAL`,
`PRAGMA busy_timeout` und das Abfangen eines kurzen dateiweiten Schreib-Locks.
All das existiert unter PostgreSQL nicht - MVCC ist eingebaut, es gibt keinen
globalen Schreib-Lock und keinen busy_timeout.

Der fachliche Kern der alten Tests bleibt aber genau derselbe und wird hier
weitergeführt, nur gegen das neue Concurrency-Modell (Sprint-Punkt 28):

  * gleichzeitige Leser stören sich nicht
  * ein Leser wird von einer offenen, noch nicht committeten Schreibtransaktion
    weder blockiert noch sieht er deren Daten
  * zwei konkurrierende Schreiber auf DERSELBEN Zeile führen nicht zu stillem
    Datenverlust - der zweite Schreiber wartet und arbeitet auf dem committeten
    Stand des ersten weiter
  * zwei konkurrierende Speichervorgänge auf VERSCHIEDENEN Zeilen laufen parallel
    durch und beide Ergebnisse überleben

Jeder Test läuft in einem eigenen, frisch migrierten Schema (conftest.py).
"""
from __future__ import annotations

import threading
import time

import pytest

from backend import db as db_module


def _connect():
    """Eine weitere, unabhängige Verbindung auf dasselbe Testschema."""
    return db_module.create_connection()


def test_two_connections_can_read_the_same_committed_data():
    """Grundfall: Connection A schreibt und committet, Connection B liest parallel."""
    conn_a = _connect()
    conn_b = _connect()
    try:
        conn_a.execute(
            "INSERT INTO people (name, department) VALUES (%s, %s)",
            ("Concurrency-A", "Testabteilung"),
        )
        conn_a.commit()

        assert conn_a.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"] == 1
        assert conn_b.execute("SELECT name FROM people").fetchone()["name"] == "Concurrency-A"
    finally:
        conn_a.close()
        conn_b.close()


def test_reader_is_not_blocked_by_an_open_writer_transaction():
    """MVCC-Kernversprechen (vorher: WAL): eine offene, noch nicht committete
    Schreibtransaktion blockiert Leser nicht - der Leser bekommt sofort den
    letzten committeten Stand, ohne zu warten."""
    writer = _connect()
    reader = _connect()
    try:
        writer.execute(
            "INSERT INTO people (name, department) VALUES (%s, %s)",
            ("Uncommitted-Writer-Row", None),
        )

        started = time.monotonic()
        count_during_open_write = reader.execute(
            "SELECT COUNT(*) AS c FROM people"
        ).fetchone()["c"]
        elapsed = time.monotonic() - started

        assert elapsed < 0.5, "Der Leser wurde von einem offenen Schreiber blockiert"
        assert count_during_open_write == 0, (
            "Der Leser darf uncommittete Daten des Schreibers nicht sehen"
        )

        writer.commit()
        assert reader.execute("SELECT COUNT(*) AS c FROM people").fetchone()["c"] == 1
    finally:
        writer.close()
        reader.close()


def test_second_writer_waits_for_the_first_and_does_not_lose_data():
    """Ersetzt den busy_timeout-Test: konkurrierende Schreiber auf DERSELBEN Zeile.

    PostgreSQL sperrt die Zeile bis zum Commit des ersten Schreibers. Der zweite
    wartet - er scheitert nicht, und er überschreibt auch nichts blind: sein
    UPDATE sieht nach dem Warten den committeten Stand des ersten. Genau das ist
    die Zusage "kein Silent Data Loss".
    """
    holder_ready = threading.Event()
    hold_seconds = 0.3

    setup = _connect()
    try:
        person_id = db_module.create_person(setup, "Konkurrenz", "A")
        setup.commit()
    finally:
        setup.close()

    def hold_row_lock():
        conn = _connect()
        try:
            conn.execute(
                "UPDATE people SET department = %s WHERE id = %s", ("erster", person_id)
            )
            holder_ready.set()
            time.sleep(hold_seconds)
            conn.commit()
        finally:
            conn.close()

    holder = threading.Thread(target=hold_row_lock)
    holder.start()
    assert holder_ready.wait(timeout=5), "Zeilensperre wurde nicht rechtzeitig gehalten"

    second = _connect()
    error: Exception | None = None
    elapsed = None
    try:
        started = time.monotonic()
        second.execute(
            "UPDATE people SET department = %s WHERE id = %s", ("zweiter", person_id)
        )
        second.commit()
        elapsed = time.monotonic() - started
    except Exception as exc:  # noqa: BLE001 - der Test will jede Ausnahme sehen
        error = exc
    finally:
        second.close()
        holder.join(timeout=10)

    assert error is None, f"Der zweite Schreiber ist an der Sperre gescheitert: {error}"
    assert elapsed is not None and elapsed >= hold_seconds * 0.5, (
        "Der zweite Schreiber hätte auf den ersten warten müssen"
    )
    assert elapsed < 5.0

    verify = _connect()
    try:
        row = verify.execute(
            "SELECT department FROM people WHERE id = %s", (person_id,)
        ).fetchone()
        # Der letzte Commit gewinnt - aber er hat den ersten abgewartet, statt
        # ihn zu verwerfen oder mit einem Fehler abzubrechen.
        assert row["department"] == "zweiter"
    finally:
        verify.close()


def test_two_concurrent_saves_on_different_rows_both_survive():
    """Zwei konkurrierende Speichervorgänge auf verschiedenen Zeilen.

    Unter SQLite serialisierte der dateiweite Schreib-Lock das; unter PostgreSQL
    laufen sie echt parallel. Prüfgegenstand ist unverändert das fachliche
    Ergebnis: beide Wochen existieren vollständig, keine geht verloren.
    """
    results: dict[str, int] = {}
    errors: list[Exception] = []
    barrier = threading.Barrier(2, timeout=10)

    def save_week(start_date: str, kw: int) -> None:
        conn = _connect()
        try:
            barrier.wait()  # beide Threads gleichzeitig losschicken
            week_id = db_module.insert_week_plan(
                conn, kw, start_date, start_date, "concurrent"
            )
            person_id = db_module.create_person(conn, f"Person-{kw}")
            db_module.insert_assignment(
                conn, week_id, start_date, "Tagesverantwortung", None, person_id, None
            )
            conn.commit()
            results[start_date] = week_id
        except Exception as exc:  # noqa: BLE001 - im Thread einsammeln
            errors.append(exc)
        finally:
            conn.close()

    threads = [
        threading.Thread(target=save_week, args=("2026-08-10", 33)),
        threading.Thread(target=save_week, args=("2026-08-17", 34)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert not errors, f"Paralleles Speichern ist fehlgeschlagen: {errors}"
    assert len(results) == 2

    verify = _connect()
    try:
        weeks = verify.execute(
            "SELECT start_date FROM week_plans ORDER BY start_date"
        ).fetchall()
        assert [row["start_date"] for row in weeks] == ["2026-08-10", "2026-08-17"]
        counts = verify.execute("SELECT COUNT(*) AS c FROM assignments").fetchone()["c"]
        assert counts == 2
    finally:
        verify.close()


def test_parallel_readers_do_not_block_each_other():
    """Sprint-Punkt 28: gleichzeitige Lese-Requests."""
    setup = _connect()
    try:
        for index in range(20):
            db_module.create_person(setup, f"Leser-{index}", "SPT")
        setup.commit()
    finally:
        setup.close()

    errors: list[Exception] = []
    seen: list[int] = []

    def read_people() -> None:
        conn = _connect()
        try:
            seen.append(len(db_module.get_all_people(conn)))
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=read_people) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert not errors, f"Paralleles Lesen ist fehlgeschlagen: {errors}"
    assert seen == [20] * 8


def test_concurrent_reads_and_writes_do_not_interfere():
    """Sprint-Punkt 28: gleichzeitige Lese- UND Schreibzugriffe.

    Die Leser dürfen weder scheitern noch einen inkonsistenten Zwischenstand
    sehen (eine Woche ohne ihre Zuweisung).
    """
    stop = threading.Event()
    errors: list[Exception] = []

    def writer() -> None:
        conn = _connect()
        try:
            for index in range(10):
                week_id = db_module.insert_week_plan(
                    conn, index, f"2026-09-{index + 1:02d}", f"2026-09-{index + 1:02d}", "w"
                )
                db_module.insert_assignment(
                    conn, week_id, f"2026-09-{index + 1:02d}", "Tagesverantwortung",
                    None, None, "x",
                )
                conn.commit()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            stop.set()
            conn.close()

    def reader() -> None:
        conn = _connect()
        try:
            while not stop.is_set():
                rows = conn.execute(
                    """SELECT wp.id, COUNT(a.id) AS n
                       FROM week_plans wp
                       LEFT JOIN assignments a ON a.week_plan_id = wp.id
                       GROUP BY wp.id"""
                ).fetchall()
                # Jede sichtbare (also committete) Woche muss ihre Zuweisung
                # mitbringen - beides wurde in derselben Transaktion committet.
                for row in rows:
                    if row["n"] != 1:
                        raise AssertionError(
                            f"Woche {row['id']} wurde ohne ihre Zuweisung sichtbar"
                        )
                conn.rollback()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=writer), threading.Thread(target=reader)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors, f"Gleichzeitige Lese-/Schreibzugriffe fehlgeschlagen: {errors}"

    verify = _connect()
    try:
        assert verify.execute("SELECT COUNT(*) AS c FROM week_plans").fetchone()["c"] == 10
    finally:
        verify.close()


@pytest.mark.parametrize("attempt", range(3))
def test_pool_survives_more_concurrent_users_than_it_has_slots(attempt):
    """Mehr gleichzeitige Nutzer als Poolplätze dürfen nicht zu Fehlern führen.

    Der Pool ist bewusst klein (Supabase-Verbindungslimits). Überzählige
    Anforderungen warten auf einen frei werdenden Platz, statt zu scheitern.
    """
    pool = db_module.get_pool()
    users = pool.max_size + 4
    errors: list[Exception] = []

    def work() -> None:
        conn = _connect()
        try:
            conn.execute("SELECT 1").fetchone()
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)
        finally:
            conn.close()

    threads = [threading.Thread(target=work) for _ in range(users)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert not errors, f"Der Pool hat unter Last Fehler geliefert: {errors}"
