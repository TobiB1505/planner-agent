"""Deployment-Smoke-Test (Sprint: Deployment-Readiness, Schritt 13).

Startet das Backend als echten Prozess genau so, wie es ein Container in
Preview/Production tun würde (python -m backend.run_local, APP_ENV=preview,
PLANNER_DATA_DIR auf ein temporäres Verzeichnis, SYSTEM_RESTART_ENABLED=0)
und prüft von aussen (HTTP), dass:

- der Prozess tatsächlich startet (Vorprüfung blockiert nicht),
- die Schema-Initialisierung in der temporären DB stattfindet,
- /api/health erfolgreich und "gesund" antwortet,
- die Excel-Grundvorlagen gefunden werden,
- ein Neustart-Versuch NICHT ausgeführt wird (kein echter os.execv),
- dabei keine Datei ausserhalb des temporären Datenverzeichnisses entsteht
  (insbesondere nicht in der echten local_data/ des Projekts).
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[2]
REAL_LOCAL_DATA_DIR = PROJECT_ROOT / "local_data"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _snapshot(directory: Path) -> set[str]:
    if not directory.exists():
        return set()
    return {str(p.relative_to(directory)) for p in directory.rglob("*")}


def _wait_until_healthy(base_url: str, proc: subprocess.Popen, timeout: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"Prozess ist vorzeitig beendet (exit code {proc.returncode})")
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return json.loads(resp.read())
        except (urllib.error.URLError, ConnectionError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Backend wurde nicht rechtzeitig erreichbar: {last_error}")


@pytest.fixture
def preview_backend(tmp_path):
    before = _snapshot(REAL_LOCAL_DATA_DIR)

    data_dir = tmp_path / "data"
    port = _free_port()
    env = os.environ.copy()
    env["APP_ENV"] = "preview"
    env["PLANNER_DATA_DIR"] = str(data_dir)
    env["SYSTEM_RESTART_ENABLED"] = "0"
    env["BACKEND_HOST"] = "127.0.0.1"
    env["BACKEND_PORT"] = str(port)
    env.pop("PORT", None)

    log_path = tmp_path / "backend.log"
    log_file = open(log_path, "w")

    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.run_local"],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        health = _wait_until_healthy(base_url, proc)
    except Exception:
        proc.terminate()
        proc.wait(timeout=5)
        log_file.close()
        raise RuntimeError(f"Backend-Start in APP_ENV=preview fehlgeschlagen:\n{log_path.read_text()}")

    yield base_url, data_dir, health

    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
    log_file.close()

    after = _snapshot(REAL_LOCAL_DATA_DIR)
    assert after == before, (
        "Der Preview-Start hat lokale Dateien ausserhalb des per "
        "PLANNER_DATA_DIR gesetzten temporären Datenverzeichnisses angelegt: "
        f"{after - before}"
    )


def test_backend_starts_and_is_healthy_in_preview_mode(preview_backend):
    _base_url, data_dir, health = preview_backend

    assert health["status"] == "ok"
    assert health["database"] == "connected"
    assert health["templates_ok"] is True
    assert health["data_dir_writable"] is True
    assert (data_dir / "database" / "dienstplaene.db").exists()


def test_restart_is_not_executed_in_preview_mode(preview_backend):
    base_url, _data_dir, _health = preview_backend

    req = urllib.request.Request(f"{base_url}/api/system/restart", method="POST", data=b"")
    with urllib.request.urlopen(req, timeout=5) as resp:
        body = json.loads(resp.read())

    assert body["status"] == "restart_disabled"

    # Ein echter Neustart würde den Prozess kurz ersetzen/beenden - hier muss
    # er unverändert unter derselben PID weiterlaufen.
    time.sleep(0.5)
    with urllib.request.urlopen(f"{base_url}/api/health", timeout=5) as resp:
        assert resp.status == 200
