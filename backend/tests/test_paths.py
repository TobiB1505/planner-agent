"""Tests für backend/config/paths.py - zentrale Pfadverwaltung.

PLANNER_DATA_DIR wird erst beim Modul-Import in Konstanten aufgelöst, daher
laden die Override-Tests das Modul gezielt neu (importlib.reload) und stellen
den Ausgangszustand danach wieder her, damit andere Tests nicht beeinflusst
werden.
"""
from __future__ import annotations

import importlib

import pytest

from backend.config import paths as paths_module


@pytest.fixture
def reload_with_env(monkeypatch):
    """Setzt PLANNER_DATA_DIR, lädt das Modul neu, stellt danach zurück."""

    def _apply(value: str):
        monkeypatch.setenv("PLANNER_DATA_DIR", value)
        return importlib.reload(paths_module)

    yield _apply
    monkeypatch.delenv("PLANNER_DATA_DIR", raising=False)
    importlib.reload(paths_module)


def test_default_paths_live_under_the_project():
    assert paths_module.LOCAL_DATA_DIR == paths_module.PROJECT_ROOT / "local_data"
    assert paths_module.DATABASE_PATH == (
        paths_module.PROJECT_ROOT / "local_data" / "database" / "dienstplaene.db"
    )
    assert paths_module.DATABASE_PATH.is_absolute()


def test_planner_data_dir_overrides_local_data_dir(tmp_path, reload_with_env):
    custom_dir = tmp_path / "custom-planner-data"
    reloaded = reload_with_env(str(custom_dir))

    assert reloaded.LOCAL_DATA_DIR == custom_dir.resolve()
    assert reloaded.DATABASE_PATH == custom_dir.resolve() / "database" / "dienstplaene.db"


def test_paths_work_with_spaces_and_umlauts(tmp_path, reload_with_env):
    custom_dir = tmp_path / "Datenördner mit Leerzeichen"
    reloaded = reload_with_env(str(custom_dir))
    reloaded.ensure_runtime_directories()

    assert reloaded.DATABASE_DIR.is_dir()
    assert reloaded.DIENSTPLAN_ARCHIVE_DIR.is_dir()


def test_ensure_runtime_directories_creates_expected_folders(tmp_path, reload_with_env):
    reloaded = reload_with_env(str(tmp_path / "runtime-dirs"))
    reloaded.ensure_runtime_directories()

    for directory in (
        reloaded.DATABASE_DIR,
        reloaded.DIENSTPLAN_ARCHIVE_DIR,
        reloaded.UPLOAD_DIR,
        reloaded.EXPORT_DIR,
    ):
        assert directory.is_dir()


def test_ensure_runtime_directories_never_touches_resource_dir(tmp_path, reload_with_env):
    reloaded = reload_with_env(str(tmp_path / "runtime-dirs-2"))
    reloaded.ensure_runtime_directories()

    # RESOURCE_DIR/TEMPLATE_DIR gehören zu backend/, nicht zu local_data/ -
    # sie duerfen durch ensure_runtime_directories() nicht veraendert werden.
    assert reloaded.RESOURCE_DIR == paths_module.BACKEND_ROOT / "resources"
