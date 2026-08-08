"""Regressionstest für einen Bug, der sich unter Starlettes TestClient NICHT zeigt
(siehe test_connection_lifecycle.py) - der TestClient wickelt sync-Dependency-
Generatoren über einen Portal-Mechanismus ab, der Enter/Exit anders (thread-stabil)
verdrahtet als ein echter uvicorn-Worker-Threadpool zur Laufzeit.

FastAPI wickelt Depends(db.get_db_connection) - ein sync-Generator - über
contextmanager_in_threadpool() ab: __enter__ läuft über den normalen
Threadpool-Limiter, __exit__ über einen eigenen, unabhängigen CapacityLimiter(1)
(fastapi/dependencies/utils.py). Unter echter Nebenläufigkeit können beide Seiten
auf unterschiedlichen OS-Threads landen - sqlite3 verbietet das per Default
(check_same_thread=True), auch wenn die Connection nie GLEICHZEITIG von zwei
Threads angefasst wird, nur nacheinander auf wechselnden Threads.

Startet deshalb bewusst einen ECHTEN uvicorn-Prozess und schickt ECHTE parallele
HTTP-Requests (wie die manuelle Reproduktion mit `curl ... & ... & wait`) - nie
gegen die echte lokale Datenbank, sondern gegen eine über PLANNER_DATA_DIR
umgeleitete, frische Datenbank in tmp_path.
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from . import auth_helpers

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_until_healthy(base_url: str, proc: subprocess.Popen, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(
                f"uvicorn-Prozess ist vorzeitig beendet (exit code {proc.returncode})"
            )
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, ConnectionError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Backend wurde nicht rechtzeitig erreichbar: {last_error}")


@pytest.fixture
def running_backend(tmp_path):
    """Startet einen echten uvicorn-Worker-Prozess gegen eine per PLANNER_DATA_DIR
    umgeleitete, frische Testdatenbank - nie gegen local_data/."""
    port = _free_port()
    env = os.environ.copy()
    env["PLANNER_DATA_DIR"] = str(tmp_path)
    env["BACKEND_HOST"] = "127.0.0.1"
    env["BACKEND_PORT"] = str(port)
    # Auth-Sprint: der Prozess prüft echte Tokens (HS256). Der Test spricht
    # /api/people/active an, das PLANNER verlangt - deshalb bekommt der
    # Prozess eine echte Auth-Konfiguration statt einer Ausnahme.
    auth_helpers.apply_auth_env(env)

    # Log-Ausgabe geht in eine echte Datei, NICHT in eine subprocess.PIPE: unter
    # dem Bug hier produziert jeder fehlgeschlagene Request einen vollen
    # Traceback in uvicorns stderr. Bei vielen parallelen Fehlern läuft ein
    # ungelesenes PIPE-Objekt voll (OS-Pipe-Puffer, üblicherweise 64KB) - der
    # schreibende uvicorn-Worker-Thread blockiert dann am write() und die
    # gesamte Verbindung hängt, statt schnell mit 500 zu antworten. Das hätte
    # den Test selbst zum (falsch diagnostizierten) Hänger statt zu einem
    # sauberen 500-Nachweis gemacht - genau das wurde beim ersten Testlauf
    # gegen den ungefixten Code auch beobachtet.
    log_path = tmp_path / "uvicorn.log"
    log_file = open(log_path, "w")

    proc = subprocess.Popen(
        [
            sys.executable, "-m", "uvicorn", "backend.api:app",
            "--host", "127.0.0.1", "--port", str(port),
        ],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_until_healthy(base_url, proc)
    except Exception:
        proc.terminate()
        proc.wait(timeout=5)
        log_file.close()
        raise RuntimeError(f"Backend-Start fehlgeschlagen:\n{log_path.read_text()}")

    # Erst jetzt existiert das Schema (der Prozess legt es beim Start an).
    auth_helpers.seed_app_user(
        tmp_path / "database" / "dienstplaene.db", auth_helpers.PLANNER_UUID, "planner"
    )

    yield base_url

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    log_file.close()


def _get(url: str) -> tuple[int, str]:
    token = auth_helpers.make_token(auth_helpers.PLANNER_UUID)
    request = urllib.request.Request(url, headers=auth_helpers.bearer(token))
    try:
        with urllib.request.urlopen(request, timeout=10) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def test_parallel_requests_against_sync_endpoint_all_succeed(running_backend):
    """Echte, gleichzeitig laufende HTTP-Requests (kein TestClient) gegen einen
    def-Endpunkt mit Depends(db.get_db_connection) - reproduziert die manuelle
    curl-basierte Fehlermeldung aus dem Bugreport 1:1.

    Ohne check_same_thread=False in db.create_connection() schlagen unter echter
    Nebenläufigkeit reproduzierbar Requests mit HTTP 500
    ("SQLite objects created in a thread can only be used in that same thread")
    fehl, weil FastAPI Enter/Exit des sync-Dependency-Generators über zwei
    unabhängige Threadpool-Limiter abwickelt (siehe Moduldocstring).
    """
    url = f"{running_backend}/api/people/active"
    concurrency = 16
    waves = 3

    for _ in range(waves):
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            results = list(pool.map(_get, [url] * concurrency))

        statuses = [status for status, _ in results]
        failures = [(status, body) for status, body in results if status != 200]
        assert not failures, (
            f"{len(failures)}/{concurrency} parallele Requests sind fehlgeschlagen: "
            f"{failures[:1]} (alle Status: {statuses})"
        )
