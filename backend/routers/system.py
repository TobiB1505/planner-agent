"""AP11 - System-Endpunkte (Health/Diagnose/Restart, Move-Only aus backend/api.py,
unverändert). _PROCESS_STARTED_AT wird beim ersten Import dieses Moduls gesetzt -
das passiert beim App-Start (api.py importiert alle Router einmalig), also zum
selben Zeitpunkt wie zuvor in api.py."""
from __future__ import annotations

import os
import sqlite3
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import shutil

from fastapi import APIRouter

from .. import db
from ..config import paths as config_paths
from .shared import _cors_origins

router = APIRouter()
_PROCESS_STARTED_AT = time.monotonic()


@router.get("/api/health")
def health():
    """Reiner Lesezugriff - verändert nie Daten, legt auch keine Datenbank an.

    Safety Fix: liest db.DATABASE_PATH statt config_paths.DATABASE_PATH, damit
    dieser Endpunkt in Tests denselben Monkeypatch-Mechanismus respektiert wie
    jede andere DB-Nutzung (Depends(db.get_db_connection) etc.) - in Produktion
    identischer Wert, da db.DATABASE_PATH von dort importiert wird.
    """
    database_status = "missing"
    if db.DATABASE_PATH.exists():
        try:
            conn = sqlite3.connect(str(db.DATABASE_PATH))
            try:
                conn.execute("SELECT 1")
                database_status = "connected"
            finally:
                conn.close()
        except sqlite3.Error:
            database_status = "error"
    return {
        "status": "ok",
        "database": database_status,
        "database_path": config_paths.relative_to_project(db.DATABASE_PATH),
    }


def _dir_diagnostic(path: Path) -> dict:
    exists = path.exists()
    writable = False
    if exists:
        probe = path / ".system_write_check"
        try:
            probe.write_text("ok")
            probe.unlink()
            writable = True
        except OSError:
            writable = False
    return {
        "path": config_paths.relative_to_project(path),
        "exists": exists,
        "writable": writable,
    }


@router.get("/api/system/diagnostics")
def system_diagnostics():
    """Reiner Lesezugriff für den Service Manager - prüft denselben Zustand
    wie backend/run_local.py beim Start, aber strukturiert für die UI statt
    als Konsolenausgabe. Verändert nichts, legt nichts an (bis auf eine
    sofort wieder gelöschte Prüfdatei je Ordner, um "beschreibbar" zu testen).

    Safety Fix: liest db.DATABASE_PATH statt config_paths.DATABASE_PATH (siehe
    health() oben) - in Produktion identischer Wert.
    """
    database_exists = db.DATABASE_PATH.exists()
    integrity: Optional[str] = None
    database_status = "missing"
    if database_exists:
        try:
            conn = sqlite3.connect(str(db.DATABASE_PATH))
            try:
                integrity = conn.execute("PRAGMA integrity_check;").fetchone()[0]
                database_status = "connected" if integrity == "ok" else "error"
            finally:
                conn.close()
        except sqlite3.Error as exc:
            database_status = "error"
            integrity = str(exc)

    templates = [
        {"name": name, "filename": path.name, "exists": path.exists()}
        for name, path in (
            ("Woche A", config_paths.WEEK_A_TEMPLATE_PATH),
            ("Woche B", config_paths.WEEK_B_TEMPLATE_PATH),
            ("Künstlerplan", config_paths.ARTIST_TEMPLATE_PATH),
        )
    ]

    directories = {
        "database": _dir_diagnostic(config_paths.DATABASE_DIR),
        "archive": _dir_diagnostic(config_paths.DIENSTPLAN_ARCHIVE_DIR),
        "uploads": _dir_diagnostic(config_paths.UPLOAD_DIR),
        "exports": _dir_diagnostic(config_paths.EXPORT_DIR),
    }

    disk_usage = shutil.disk_usage(config_paths.LOCAL_DATA_DIR if config_paths.LOCAL_DATA_DIR.exists() else config_paths.PROJECT_ROOT)

    return {
        "database": {
            "status": database_status,
            "integrity_check": integrity,
            "path": config_paths.relative_to_project(db.DATABASE_PATH),
        },
        "templates": templates,
        "directories": directories,
        "host": os.getenv("BACKEND_HOST", "127.0.0.1"),
        "port": os.getenv("BACKEND_PORT", "8000"),
        "cors_origins": _cors_origins(),
        "uptime_seconds": round(time.monotonic() - _PROCESS_STARTED_AT, 1),
        "disk": {
            "free_bytes": disk_usage.free,
            "total_bytes": disk_usage.total,
        },
    }


@router.post("/api/system/restart")
def system_restart():
    """Startet den Backend-Prozess vollständig neu - unabhängig davon, wie
    er gestartet wurde (Startskript, manuell, mit oder ohne Reload-Modus).

    Frühere Version verliess sich auf uvicorns --reload-Dateiwächter (mtime
    von api.py anfassen) - das funktioniert nur, wenn reload=True gesetzt
    ist, was seit dieser Version aber bewusst NICHT mehr der Standard ist
    (siehe backend/run_local.py). Für einen normalen Nutzer, der die
    Anwendung nur über das Startskript startet, passierte beim Klick auf
    "Backend neu starten" dadurch schlicht nichts.

    Stattdessen ersetzt os.execv() den laufenden Prozess durch eine frische
    Instanz von "python -m backend.run_local" - denselben Interpreter,
    dasselbe Arbeitsverzeichnis, dieselbe Umgebung. Der Listening-Socket
    schliesst sich dabei automatisch (Python-Dateideskriptoren sind seit
    PEP 446 standardmässig nicht vererbbar über exec hinweg), sodass der
    neue Prozess den Port direkt neu binden kann - kein doppelt gebundener
    Port, kein verwaister Prozess.
    """

    def _restart() -> None:
        time.sleep(0.3)  # HTTP-Antwort erst zustellen lassen
        os.execv(sys.executable, [sys.executable, "-m", "backend.run_local"])

    threading.Thread(target=_restart, daemon=True).start()
    return {"status": "restarting"}
