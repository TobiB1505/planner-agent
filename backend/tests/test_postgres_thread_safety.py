"""Thread-Sicherheit der Request-Connections unter echter Nebenläufigkeit.

Vorgeschichte (SQLite): FastAPI wickelt einen sync-generator-basierten
Dependency wie `Depends(db.get_db_connection)` über
`contextmanager_in_threadpool` in bis zu drei separaten
`anyio.to_thread.run_sync(...)`-Aufrufen ab (Dependency-Enter, Endpunkt-Body,
Dependency-Exit). Unter echter Parallelität landen diese drei Schritte nicht
zuverlässig im selben OS-Thread. sqlite3 verbot den bloßen Thread-Wechsel und
warf `SQLite objects created in a thread can only be used in that same
thread`; behoben wurde das damals mit `check_same_thread=False`.

Mit psycopg gibt es diese Einschränkung nicht mehr - eine Verbindung darf den
Thread wechseln, solange sie nicht gleichzeitig von zweien benutzt wird (genau
das garantiert der Ablauf oben). Diese Tests bleiben trotzdem bestehen und
wurden nicht gelöscht: sie sichern weiterhin ab, was fachlich zählt und was
sich beim Wechsel auf einen Connection Pool sogar neu verschieben könnte -
dass jeder Request genau eine eigene Verbindung bekommt, dass jede davon
zuverlässig freigegeben wird und dass parallele Bursts stabil bleiben, statt
den Pool leerlaufen zu lassen.

Immer gegen ein isoliertes PostgreSQL-Testschema (autouse-Fixture in
conftest.py) - nie gegen eine echte Planungsdatenbank.
"""
from __future__ import annotations

import threading

from fastapi.testclient import TestClient

from backend import api, db


class ConnectionCloseSpy:
    """Dünner Wrapper um eine echte db.Connection, der nur das Schließen
    beobachtbar macht - kein Mock der Fachlogik, alle echten Aufrufe gehen
    unverändert an die reale Verbindung weiter (Muster wie in
    test_connection_lifecycle.py)."""

    def __init__(self, real_conn):
        self._real_conn = real_conn
        self.closed = False

    def __getattr__(self, name):
        return getattr(self._real_conn, name)

    def close(self) -> None:
        self.closed = True
        self._real_conn.close()


def _spy_on_connections(monkeypatch) -> list[ConnectionCloseSpy]:
    spies: list[ConnectionCloseSpy] = []
    lock = threading.Lock()
    real_create_connection = db.create_connection

    def spying_create_connection():
        spy = ConnectionCloseSpy(real_create_connection())
        with lock:
            spies.append(spy)
        return spy

    monkeypatch.setattr(db, "create_connection", spying_create_connection)
    return spies


def _run_concurrent(client, request_fn, count=10):
    """Startet `count` ECHTE parallele Requests (eigene Python-Threads, nicht
    nur sequenzielle Aufrufe) über denselben TestClient und sammelt
    Status-Codes/Fehler thread-sicher. Nur echte, gleichzeitig laufende
    Threads reproduzieren die anyio-Worker-Pool-Konkurrenz, die den
    ursprünglichen Fehler auslöste - rein sequenzielle TestClient-Aufrufe
    reichen dafür nicht aus."""
    results: list[int] = []
    errors: list[str] = []
    lock = threading.Lock()

    def worker(index: int):
        try:
            response = request_fn(client, index)
            with lock:
                results.append(response.status_code)
        except Exception as exc:  # noqa: BLE001 - hier bewusst breit, nur zur Diagnose
            with lock:
                errors.append(repr(exc))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)
    return results, errors


def test_parallel_health_requests_do_not_raise_thread_errors(test_db_path):
    with TestClient(api.app) as client:
        results, errors = _run_concurrent(client, lambda c, i: c.get("/api/health"), count=10)

    assert errors == [], f"parallele Health-Requests dürfen keine Thread-Fehler werfen: {errors}"
    assert results == [200] * 10


def test_parallel_read_requests_close_every_connection(test_db_path, monkeypatch):
    # Erst der Lifespan-Start (ruft initialize_database() -> eine eigene,
    # nicht request-gebundene Connection auf), DANN erst spionieren - sonst
    # zählt die Schema-Init-Connection mit und verfälscht die Zählung der
    # tatsächlichen Request-Connections unten.
    with TestClient(api.app) as client:
        spies = _spy_on_connections(monkeypatch)
        results, errors = _run_concurrent(
            client, lambda c, i: c.get("/api/people/active"), count=10
        )

    assert errors == [], f"parallele Lesezugriffe dürfen keine Thread-Fehler werfen: {errors}"
    assert results == [200] * 10
    assert len(spies) == 10, "jeder Request muss genau eine eigene Connection erzeugen"
    assert all(spy.closed for spy in spies), "jede Request-Connection muss zuverlässig geschlossen werden"


def test_save_and_read_parallelism_does_not_error_or_deadlock(test_db_path):
    """Ein Schreibzugriff (Plan speichern) parallel zu mehreren Lesezugriffen.

    Unter SQLite war hier SQLITE_BUSY das Risiko (abgefangen über WAL +
    busy_timeout). Unter PostgreSQL ist es die Poolgröße: mehr gleichzeitige
    Requests als Poolplätze dürfen warten, aber nicht scheitern."""
    payload = {
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "template_week_id": 99,
        "day_labels": ["Mo, 10.08."],
        "rows": [
            {
                "Abschnitt": "Tagesverantwortung",
                "Zeile": "",
                "_row_type": "data",
                "_category": "Tagesverantwortung",
                "Mo, 10.08.": "Konkurrenz-Test",
            }
        ],
    }

    def request_fn(client, index):
        if index == 0:
            return client.post("/api/plan/save", json=payload)
        return client.get("/api/people/active")

    with TestClient(api.app) as client:
        results, errors = _run_concurrent(client, request_fn, count=8)

    assert errors == [], f"Save+Read-Parallelität darf keine Fehler werfen: {errors}"
    assert all(status == 200 for status in results), results


def test_repeated_parallel_bursts_stay_stable(test_db_path):
    """Mehrere aufeinanderfolgende Bursts echter paralleler Requests - stellt
    sicher, dass sich über mehrere Bursts hinweg kein Zustand aufbaut (z.B.
    nicht zurückgegebene Pool-Verbindungen), der irgendwann zu Wartezeiten
    bis zum Pool-Timeout oder zu Fehlern führt."""
    with TestClient(api.app) as client:
        for burst in range(3):
            results, errors = _run_concurrent(
                client, lambda c, i: c.get("/api/health"), count=6
            )
            assert errors == [], f"Burst {burst}: {errors}"
            assert results == [200] * 6
