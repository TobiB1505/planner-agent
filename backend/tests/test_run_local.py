"""Tests für die Deployment-Vorprüfung in backend/run_local.py."""
from __future__ import annotations

from backend import run_local


def test_local_environment_never_requires_planner_data_dir(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("PLANNER_DATA_DIR", raising=False)

    assert run_local.check_data_dir_for_environment() == []


def test_preview_without_planner_data_dir_is_a_blocking_problem(monkeypatch):
    monkeypatch.setenv("APP_ENV", "preview")
    monkeypatch.delenv("PLANNER_DATA_DIR", raising=False)

    problems = run_local.check_data_dir_for_environment()

    assert len(problems) == 1
    assert "PLANNER_DATA_DIR" in problems[0]


def test_production_without_planner_data_dir_is_a_blocking_problem(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("PLANNER_DATA_DIR", raising=False)

    problems = run_local.check_data_dir_for_environment()

    assert len(problems) == 1


def test_preview_with_planner_data_dir_set_has_no_problem(monkeypatch, tmp_path):
    monkeypatch.setenv("APP_ENV", "preview")
    monkeypatch.setenv("PLANNER_DATA_DIR", str(tmp_path))

    assert run_local.check_data_dir_for_environment() == []


def test_resolve_backend_port_prefers_platform_injected_port_over_backend_port(monkeypatch):
    # Render/Railway/Fly.io setzen PORT - das muss BACKEND_PORT vorgehen.
    monkeypatch.setenv("PORT", "10000")
    monkeypatch.setenv("BACKEND_PORT", "9000")

    assert run_local.resolve_backend_port() == 10000


def test_resolve_backend_port_falls_back_to_backend_port(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.setenv("BACKEND_PORT", "9000")

    assert run_local.resolve_backend_port() == 9000


def test_resolve_backend_port_defaults_to_8000(monkeypatch):
    monkeypatch.delenv("PORT", raising=False)
    monkeypatch.delenv("BACKEND_PORT", raising=False)

    assert run_local.resolve_backend_port() == 8000
