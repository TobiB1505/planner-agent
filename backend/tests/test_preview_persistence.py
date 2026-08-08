"""Deployment-Smoke-Test: Daten überleben einen Neustart des Backends.

Simuliert lokal, was gegen die echte Render-Instanz nicht ausgeführt werden
konnte (kein Netzwerkzugriff auf api.render.com aus der Sandbox, siehe
docs/deployment/PREVIEW_DEPLOYMENT.md): Backend starten, eine synthetische
Person über die API anlegen, den Prozess beenden (wie bei einem
Render-Redeploy) und neu starten - die Person muss danach weiterhin lesbar
sein.

Seit der PostgreSQL-Migration prüft dieser Test eine STÄRKERE Aussage als
vorher (Sprint-Punkt 31): der zweite Prozess startet mit einem KOMPLETT
ANDEREN, frischen PLANNER_DATA_DIR. Früher wäre der Test damit
fehlgeschlagen - die Daten lagen in der SQLite-Datei unter diesem Ordner.
Dass er jetzt trotzdem grün ist, ist genau der Nachweis, dass die operative
Datenhaltung nicht mehr an einer persistenten Render-Disk hängt, sondern
ausschließlich an DATABASE_URL.

Der zweite Test dokumentiert den verbliebenen Datei-Restpunkt: Excel-Exporte
laufen weiterhin über tempfile und dürfen nichts auf der Disk liegen lassen
(siehe docs/database/POSTGRES_STORAGE_GAPS.md).
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

from . import auth_helpers

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
    # Auth-Sprint: /api/team ist PLANNER - der Prozess prüft echte Tokens.
    auth_helpers.apply_auth_env(env)

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


def _auth_headers() -> dict:
    return auth_helpers.bearer(auth_helpers.make_token(auth_helpers.PLANNER_UUID))


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", **_auth_headers()}
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def _get_json(url: str) -> object:
    req = urllib.request.Request(url, headers=_auth_headers())
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def test_synthetic_person_survives_a_backend_restart_with_a_fresh_data_dir(tmp_path):
    """Person anlegen, lesen, Prozess beenden + neu starten (== Render-Redeploy),
    erneut lesen - Daten müssen erhalten bleiben.

    Der Neustart bekommt bewusst ein LEERES, neues PLANNER_DATA_DIR: nur wenn
    die Daten das überleben, ist bewiesen, dass sie in PostgreSQL liegen und
    nicht auf einer Disk, die ein Redeploy verlieren kann.
    """
    data_dir = tmp_path / "data"
    log_path = tmp_path / "backend.log"

    port_a = _free_port()
    proc = _start_backend(data_dir, log_path, port_a)
    base_url_a = f"http://127.0.0.1:{port_a}"
    try:
        _wait_until_healthy(base_url_a, proc, log_path)
        # Erst nach dem Start existiert das Schema in der Preview-DB.
        auth_helpers.seed_app_user(auth_helpers.PLANNER_UUID, "planner")

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

    # "Render-Redeploy": neuer Prozess, FRISCHES (leeres) PLANNER_DATA_DIR,
    # neuer Port - wie bei einem Deployment ohne persistente Disk.
    fresh_data_dir = tmp_path / "data-after-redeploy"
    port_b = _free_port()
    proc2 = _start_backend(fresh_data_dir, log_path, port_b)
    base_url_b = f"http://127.0.0.1:{port_b}"
    try:
        _wait_until_healthy(base_url_b, proc2, log_path)

        people_after_restart = _get_json(f"{base_url_b}/api/team")
        assert len(people_after_restart) == 1
        assert people_after_restart[0]["name"] == "Preview Testperson"
        assert people_after_restart[0]["id"] == created["id"]
    finally:
        _stop_backend(proc2)

    # Es darf ausdrücklich KEINE Datenbankdatei mehr entstanden sein - weder im
    # ursprünglichen noch im frischen Datenordner.
    assert list(data_dir.rglob("*.db")) == []
    assert list(fresh_data_dir.rglob("*.db")) == []


def test_no_database_file_is_written_and_export_tempfiles_do_not_linger(tmp_path):
    """Der Datenordner enthält nach normalem Betrieb keine Datenbankdatei mehr.

    Vorher prüfte dieser Test, dass `python -m backend.backup` eine
    SQLite-Sicherung auf der persistenten Disk ablegt. Dieses Backup existiert
    bewusst nicht mehr als produktiver Mechanismus (siehe backend/backup.py:
    als deprecated markiert, und docs/database/POSTGRES_BACKUP.md für die
    gültige Strategie). Was hier stattdessen nachweisbar und relevant ist:

      1. der laufende Betrieb legt keine Datenbankdatei mehr an,
      2. das deprecated Backup-Skript tut nicht so, als hätte es die operative
         Datenbank gesichert, sondern scheitert sichtbar und mit klarer Meldung,
      3. Excel-Export-Zwischendateien bleiben nicht liegen (unverändert -
         Exporte laufen über tempfile.mkstemp() + sofortigem Unlink nach
         Auslieferung, nie über EXPORT_DIR).
    """
    data_dir = tmp_path / "data"
    log_path = tmp_path / "backend.log"
    port = _free_port()

    proc = _start_backend(data_dir, log_path, port)
    base_url = f"http://127.0.0.1:{port}"
    try:
        _wait_until_healthy(base_url, proc, log_path)
        auth_helpers.seed_app_user(auth_helpers.PLANNER_UUID, "planner")
        _post_json(f"{base_url}/api/team", {"name": "Backup Testperson", "department": "QA"})
    finally:
        _stop_backend(proc)

    assert list(data_dir.rglob("*.db")) == [], (
        "Der Betrieb darf keine Datenbankdatei mehr auf der Disk anlegen"
    )

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
    output = result.stdout + result.stderr
    assert result.returncode != 0, (
        "Das deprecated SQLite-Backup darf keinen Erfolg melden, wenn es gar "
        f"keine SQLite-Datei mehr gibt:\n{output}"
    )
    assert "POSTGRES_BACKUP.md" in output, (
        f"Die Meldung muss auf die gültige Backup-Strategie verweisen:\n{output}"
    )
    assert list((data_dir / "backups").glob("*.db")) == []

    # exports/ ist provisioniert, aber aktuell ungenutzt - es dürfen keine
    # liegen gebliebenen Export-Zwischendateien darin existieren.
    exports_dir = data_dir / "exports"
    if exports_dir.exists():
        assert list(exports_dir.glob("*")) == []
