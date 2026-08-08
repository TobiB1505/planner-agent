"""AP11 - System-Endpunkte (Health/Diagnose/Restart, Move-Only aus backend/api.py,
unverändert). _PROCESS_STARTED_AT wird beim ersten Import dieses Moduls gesetzt -
das passiert beim App-Start (api.py importiert alle Router einmalig), also zum
selben Zeitpunkt wie zuvor in api.py.

Auth-Sprint: der einzige Router mit einem bewusst öffentlichen Endpunkt.

- GET /api/health: PUBLIC. Deployment-Plattformen (Render/Vercel) fragen
  Liveness/Readiness ohne Anmeldung ab - ein 401 hier würde als "Dienst
  kaputt" gewertet und einen Neustart-Loop auslösen. Der Endpunkt liefert
  ausschliesslich Booleans und einen projektrelativen Pfad, keine Secrets,
  keine Hostnamen, keine Stacktraces (siehe health() unten).
- GET /api/system/diagnostics: ADMIN. Deutlich gesprächiger als /api/health -
  Verzeichnisse, Schreibrechte, CORS-Origins, Host/Port, freier Speicher.
  Das ist Betriebswissen und geht weder Employee noch Planner etwas an.
- POST /api/system/restart: ADMIN. Zusätzlich bleibt die bestehende
  Deployment-Sperre SYSTEM_RESTART_ENABLED unverändert bestehen - RBAC
  ersetzt sie nicht, beide Schutzebenen gelten gleichzeitig (die
  Rollenprüfung greift zuerst, danach entscheidet _restart_enabled()).
"""
from __future__ import annotations

import os
import sqlite3
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import shutil

from fastapi import APIRouter, Depends

from .. import db
from ..auth import require_admin
from ..config import paths as config_paths
from .shared import _cors_origins

router = APIRouter()
_PROCESS_STARTED_AT = time.monotonic()


def _is_writable(path: Path) -> bool:
    if not path.exists():
        return False
    probe = path / ".system_write_check"
    try:
        probe.write_text("ok")
        probe.unlink()
        return True
    except OSError:
        return False


def _templates_present() -> bool:
    return all(
        path.exists()
        for path in (
            config_paths.WEEK_A_TEMPLATE_PATH,
            config_paths.WEEK_B_TEMPLATE_PATH,
            config_paths.ARTIST_TEMPLATE_PATH,
        )
    )


@router.get("/api/health")
def health():
    """Reiner Lesezugriff - verändert nie Daten, legt auch keine Datenbank an.

    Für Deployment-Plattformen nutzbar (Liveness/Readiness): prüft neben der
    Datenbank auch, ob die Excel-Grundvorlagen vorhanden und das
    Laufzeitverzeichnis beschreibbar sind - beides bewusst nur als Booleans,
    nicht als volle Pfad-/Fehlerliste (das bleibt /api/system/diagnostics
    vorbehalten, siehe dort). Enthält nie Secrets, volle interne Serverpfade,
    API-Keys oder Stacktraces.

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

    templates_ok = _templates_present()
    data_dir_writable = _is_writable(config_paths.LOCAL_DATA_DIR)
    healthy = database_status == "connected" and templates_ok and data_dir_writable

    return {
        "status": "ok" if healthy else "degraded",
        "database": database_status,
        "database_path": config_paths.relative_to_project(db.DATABASE_PATH),
        "templates_ok": templates_ok,
        "data_dir_writable": data_dir_writable,
    }


def _dir_diagnostic(path: Path) -> dict:
    return {
        "path": config_paths.relative_to_project(path),
        "exists": path.exists(),
        "writable": _is_writable(path),
    }


@router.get("/api/system/diagnostics", dependencies=[Depends(require_admin)])
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


def _restart_enabled() -> bool:
    """SYSTEM_RESTART_ENABLED entscheidet explizit; ohne Einstellung ist ein
    execv-Prozessneustart nur in APP_ENV=local sinnvoll (persistenter,
    selbst verwalteter Prozess) - in Preview/Production übernimmt die
    Hosting-Plattform Neustarts (Redeploy, Health-Check-Restart etc.)."""
    raw = os.getenv("SYSTEM_RESTART_ENABLED")
    if raw is not None:
        return raw == "1"
    return os.getenv("APP_ENV", "local") == "local"


@router.post("/api/system/restart", dependencies=[Depends(require_admin)])
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

    In Preview/Production (siehe _restart_enabled()) ergibt das keinen Sinn:
    Container-Plattformen erwarten einen langlebigen Prozess und verwalten
    Neustarts selbst (Redeploy, Health-Check-Neustart) - os.execv oder ein
    Hintergrund-Thread dafür würde diesen Mechanismus unterlaufen. Der
    API-Pfad bleibt unverändert, die Antwort verweist stattdessen auf die
    Plattform-eigene Restart-Funktion.
    """
    if not _restart_enabled():
        return {
            "status": "restart_disabled",
            "message": (
                "Neustarts werden in dieser Umgebung von der Hosting-Plattform "
                "verwaltet (SYSTEM_RESTART_ENABLED=0). Bitte die Redeploy-/"
                "Restart-Funktion des Hosting-Providers verwenden."
            ),
        }

    def _restart() -> None:
        time.sleep(0.3)  # HTTP-Antwort erst zustellen lassen
        os.execv(sys.executable, [sys.executable, "-m", "backend.run_local"])

    threading.Thread(target=_restart, daemon=True).start()
    return {"status": "restarting"}
