"""AP11 - System-Endpunkte (Health/Diagnose/Restart, Move-Only aus backend/api.py,
unverändert). _PROCESS_STARTED_AT wird beim ersten Import dieses Moduls gesetzt -
das passiert beim App-Start (api.py importiert alle Router einmalig), also zum
selben Zeitpunkt wie zuvor in api.py."""
from __future__ import annotations

import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import shutil

import psycopg
from fastapi import APIRouter

from .. import db
from .. import migrations as db_migrations
from ..config import paths as config_paths
from .shared import _cors_origins

logger = logging.getLogger(__name__)

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


def _database_label() -> str:
    """Menschenlesbare Kennzeichnung der Datenbank OHNE Zugangsdaten.

    Ersetzt den früheren Dateipfad im `database_path`-Feld. Die DATABASE_URL
    enthält Benutzername und Passwort - hier wird deshalb ausschließlich
    Host/Port/Datenbankname zusammengesetzt und niemals die rohe URL.
    """
    try:
        raw = db.database_url()
    except db.DatabaseNotConfigured:
        return "nicht konfiguriert"
    try:
        info = psycopg.conninfo.conninfo_to_dict(raw)
    except psycopg.Error:
        return "postgresql"
    host = info.get("host") or "?"
    port = info.get("port") or "5432"
    name = info.get("dbname") or "?"
    return f"postgresql://{host}:{port}/{name}"


@router.get("/api/health")
def health():
    """Reiner Lesezugriff - verändert nie Daten, legt auch kein Schema an.

    Für Deployment-Plattformen nutzbar (Liveness/Readiness): prüft neben der
    Datenbank auch, ob die Excel-Grundvorlagen vorhanden und das
    Laufzeitverzeichnis beschreibbar sind - beides bewusst nur als Booleans,
    nicht als volle Pfad-/Fehlerliste (das bleibt /api/system/diagnostics
    vorbehalten, siehe dort). Enthält nie Secrets, volle interne Serverpfade,
    API-Keys oder Stacktraces.

    Die Antwortstruktur ist gegenüber der SQLite-Version unverändert (gleiche
    Felder, gleiche Statuswerte) - nur die Bedeutung von `database_path` ist
    jetzt eine Host/Datenbank-Kennung statt eines Dateipfads, weil es keine
    Datenbankdatei mehr gibt. `missing` bedeutet jetzt "DATABASE_URL nicht
    konfiguriert" statt "Datei existiert nicht".
    """
    database_status = "missing"
    try:
        conn = db.create_connection()
        try:
            conn.execute("SELECT 1")
            database_status = "connected"
        finally:
            conn.close()
    except db.DatabaseNotConfigured:
        database_status = "missing"
    except (psycopg.Error, OSError):
        database_status = "error"

    templates_ok = _templates_present()
    data_dir_writable = _is_writable(config_paths.LOCAL_DATA_DIR)
    healthy = database_status == "connected" and templates_ok and data_dir_writable

    return {
        "status": "ok" if healthy else "degraded",
        "database": database_status,
        "database_path": _database_label(),
        "templates_ok": templates_ok,
        "data_dir_writable": data_dir_writable,
    }


def _dir_diagnostic(path: Path) -> dict:
    return {
        "path": config_paths.relative_to_project(path),
        "exists": path.exists(),
        "writable": _is_writable(path),
    }


@router.get("/api/system/diagnostics")
def system_diagnostics():
    """Reiner Lesezugriff für den Service Manager - prüft denselben Zustand
    wie backend/run_local.py beim Start, aber strukturiert für die UI statt
    als Konsolenausgabe. Verändert nichts, legt nichts an (bis auf eine
    sofort wieder gelöschte Prüfdatei je Ordner, um "beschreibbar" zu testen).

    PostgreSQL hat kein Äquivalent zu SQLites `PRAGMA integrity_check` - eine
    Prüfsumme über die Datendatei ergibt bei einem verwalteten Serverdienst
    keinen Sinn und wäre aus dem Anwendungsprozess heraus auch gar nicht
    aufrufbar. Das Feld `integrity_check` bleibt deshalb im Antwortvertrag
    erhalten (das Frontend zeigt es an), meldet jetzt aber den Zustand, den ein
    Client hier tatsächlich prüfen kann: erreichbare Verbindung + angewendete
    Schemaversion. Der Wert "ok" hat unverändert die Bedeutung "Datenbank in
    Ordnung".
    """
    integrity: Optional[str] = None
    database_status = "missing"
    try:
        conn = db.create_connection()
        try:
            conn.execute("SELECT 1")
            version = db_migrations.current_version(conn)
            if version is None:
                database_status = "error"
                integrity = "Schema nicht migriert (schema_migrations ist leer)"
            else:
                database_status = "connected"
                integrity = "ok"
        finally:
            conn.close()
    except db.DatabaseNotConfigured as exc:
        database_status = "missing"
        integrity = str(exc)
    except (psycopg.Error, OSError) as exc:
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
            # Früher der Dateipfad der SQLite-Datei. Es gibt keine Datei mehr;
            # hier steht jetzt Host/Port/Datenbankname - nie Zugangsdaten.
            "path": _database_label(),
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
