"""Deployment-Smoke-Test (Sprint 2: Preview-Deployment, Schritt 7).

Simuliert lokal, was gegen die echte Render-Instanz nicht ausgeführt werden
konnte (kein Netzwerkzugriff auf api.render.com aus der Sandbox, siehe
docs/deployment/PREVIEW_DEPLOYMENT.md): Backend starten, eine synthetische
Person über die API anlegen, den Prozess beenden (wie bei einem
Render-Redeploy) und mit DEMSELBEN PLANNER_DATA_DIR neu starten - die
Person muss danach weiterhin lesbar sein. Prüft zusätzlich, dass Backup-
Erstellung auf dieselbe persistente Disk schreibt und temporäre
Excel-Exportdateien nicht auf der Disk liegen bleiben.
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


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _wait_until_healthy(base_url: str, proc: subprocess.Popen, log_path: Path, timeout: float = 20.0) -> None:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(
                f"Prozess vorzeitig beendet (exit code {proc.returncode}):\n{log_path.read_text()}"
            )
        try:
            with urllib.request.urlopen(f"{base_url}/api/health", timeout=2) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, ConnectionError) as exc:
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"Backend wurde nicht rechtzeitig erreichbar: {last_error}")


def _start_backend(data_dir: Path, log_path: Path, port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["APP_ENV"] = "preview"
    env["PLANNER_DATA_DIR"] = str(data_dir)
    env["SYSTEM_RESTART_ENABLED"] = "0"
    env["BACKEND_HOST"] = "127.0.0.1"
    env["BACKEND_PORT"] = str(port)
    env.pop("PORT", None)

    log_file = open(log_path, "a")
    proc = subprocess.Popen(
        [sys.executable, "-m", "backend.run_local"],
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    return proc


def _stop_backend(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def _get_json(url: str) -> object:
    with urllib.request.urlopen(url, timeout=5) as resp:
        return json.loads(resp.read())


def test_synthetic_person_survives_a_backend_restart_with_the_same_data_dir(tmp_path):
    """Entspricht Schritt 7 des Preview-Sprints: Person anlegen, lesen,
    Prozess beenden+neu starten (== Render-Redeploy derselben Version),
    erneut lesen - Daten müssen erhalten bleiben, weil sie auf der
    "persistenten Disk" (hier: tmp_path) liegen, nicht im Prozessspeicher."""
    data_dir = tmp_path / "data"
    log_path = tmp_path / "backend.log"

    port_a = _free_port()
    proc = _start_backend(data_dir, log_path, port_a)
    base_url_a = f"http://127.0.0.1:{port_a}"
    try:
        _wait_until_healthy(base_url_a, proc, log_path)

        # Preview-DB ist leer.
        assert _get_json(f"{base_url_a}/api/team") == []

        # Synthetische Testperson anlegen - keine echten Mitarbeiterdaten.
        created = _post_json(f"{base_url_a}/api/team", {"name": "Preview Testperson", "department": "QA"})
        assert "id" in created

        people = _get_json(f"{base_url_a}/api/team")
        assert len(people) == 1
        assert people[0]["name"] == "Preview Testperson"
    finally:
        _stop_backend(proc)

    # "Render-Redeploy derselben Version": neuer Prozess, identisches
    # PLANNER_DATA_DIR, neuer Port (wie bei einem echten Redeploy, bei dem
    # der alte Prozess/Port nicht mehr existiert).
    port_b = _free_port()
    proc2 = _start_backend(data_dir, log_path, port_b)
    base_url_b = f"http://127.0.0.1:{port_b}"
    try:
        _wait_until_healthy(base_url_b, proc2, log_path)

        people_after_restart = _get_json(f"{base_url_b}/api/team")
        assert len(people_after_restart) == 1
        assert people_after_restart[0]["name"] == "Preview Testperson"
        assert people_after_restart[0]["id"] == created["id"]
    finally:
        _stop_backend(proc2)

    assert (data_dir / "database" / "dienstplaene.db").exists()


def test_backup_lands_on_the_persistent_disk_and_export_tempfiles_do_not(tmp_path):
    """Schritt 7, letzter Teil: Backup-Dateien liegen auf der persistenten
    Disk (PLANNER_DATA_DIR), Excel-Export-Zwischendateien dagegen NICHT
    (siehe docs/deployment/STORAGE_INVENTORY.md - Exporte laufen über
    tempfile.mkstemp() + sofortigem Unlink nach Auslieferung, nie über
    EXPORT_DIR)."""
    data_dir = tmp_path / "data"
    log_path = tmp_path / "backend.log"
    port = _free_port()

    proc = _start_backend(data_dir, log_path, port)
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_until_healthy(base_url, proc, log_path)
        _post_json(f"{base_url}/api/team", {"name": "Backup Testperson", "department": "QA"})
    finally:
        _stop_backend(proc)

    env = os.environ.copy()
    env["PLANNER_DATA_DIR"] = str(data_dir)
    result = subprocess.run(
        [sys.executable, "-m", "backend.backup"],
        cwd=str(PROJECT_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr

    backups = list((data_dir / "backups").glob("*.db"))
    assert len(backups) == 1, "Backup wurde nicht auf der persistenten Disk abgelegt"

    # exports/ ist provisioniert, aber aktuell ungenutzt (siehe
    # STORAGE_INVENTORY.md) - es dürfen keine liegen gebliebenen
    # Export-Zwischendateien darin existieren.
    exports_dir = data_dir / "exports"
    if exports_dir.exists():
        assert list(exports_dir.glob("*")) == []
