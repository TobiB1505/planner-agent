"""Tests für die Cloud-Absicherung von POST /api/system/restart.

Der "restarting"-Zweig startet normalerweise einen Daemon-Thread, der nach
0.3s os.execv() aufruft und damit den laufenden Prozess ersetzt - in einem
Testlauf darf das nie wirklich passieren (würde den Testprozess selbst
abwürgen, ggf. sogar erst NACH Testende/Monkeypatch-Teardown, wenn ein
os.execv-Patch längst wieder zurückgesetzt wäre). Deshalb wird hier
threading.Thread im system-Router-Modul durch einen No-Op-Stub ersetzt, der
den Hintergrund-Thread nie tatsächlich startet - unabhängig davon, welcher
Zweig (restarting/restart_disabled) durchlaufen wird. os.execv wird
zusätzlich als Verteidigung in der Tiefe gepatcht."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.routers import system as system_router


class _NoOpThread:
    def __init__(self, target=None, daemon=None):
        self._target = target

    def start(self) -> None:
        pass


@pytest.fixture(autouse=True)
def _never_actually_restart(monkeypatch):
    monkeypatch.setattr(system_router.threading, "Thread", _NoOpThread)

    def _guard(*args, **kwargs):
        raise AssertionError("os.execv wurde in einem Test aufgerufen - das darf nie passieren.")

    monkeypatch.setattr(os, "execv", _guard)


def test_local_default_allows_restart(monkeypatch, test_db_path):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("SYSTEM_RESTART_ENABLED", raising=False)

    with TestClient(app) as client:
        response = client.post("/api/system/restart")

    assert response.status_code == 200
    assert response.json()["status"] == "restarting"


def test_production_default_disables_restart(monkeypatch, test_db_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("SYSTEM_RESTART_ENABLED", raising=False)

    with TestClient(app) as client:
        response = client.post("/api/system/restart")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "restart_disabled"
    assert "message" in body


def test_preview_default_disables_restart(monkeypatch, test_db_path):
    monkeypatch.setenv("APP_ENV", "preview")
    monkeypatch.delenv("SYSTEM_RESTART_ENABLED", raising=False)

    with TestClient(app) as client:
        response = client.post("/api/system/restart")

    assert response.json()["status"] == "restart_disabled"


def test_explicit_system_restart_enabled_zero_disables_restart_even_locally(monkeypatch, test_db_path):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.setenv("SYSTEM_RESTART_ENABLED", "0")

    with TestClient(app) as client:
        response = client.post("/api/system/restart")

    assert response.json()["status"] == "restart_disabled"


def test_explicit_system_restart_enabled_one_allows_restart_in_production(monkeypatch, test_db_path):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SYSTEM_RESTART_ENABLED", "1")

    with TestClient(app) as client:
        response = client.post("/api/system/restart")

    assert response.json()["status"] == "restarting"


def test_restart_enabled_helper_matches_documented_precedence(monkeypatch):
    monkeypatch.setenv("APP_ENV", "local")
    monkeypatch.setenv("SYSTEM_RESTART_ENABLED", "0")
    assert system_router._restart_enabled() is False

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SYSTEM_RESTART_ENABLED", "1")
    assert system_router._restart_enabled() is True
