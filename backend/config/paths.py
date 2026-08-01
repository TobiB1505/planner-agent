"""Zentrale, plattformunabhängige Pfadverwaltung für das Backend.

Einzige Quelle der Wahrheit für Dateisystempfade. Kein anderes Modul soll
eigene Pfad-Konstanten (Path(__file__)-Herleitungen, feste Desktop-Pfade
o.ä.) definieren - stattdessen wird aus diesem Modul importiert.

Zwei grundsätzlich verschiedene Bereiche:
- RESOURCE_DIR / TEMPLATE_DIR: feste Programm-Ressourcen, die mit dem Code
  ausgeliefert und versioniert werden (z.B. die Excel-Grundvorlagen).
- LOCAL_DATA_DIR und alles darunter: veränderliche Laufzeitdaten auf dem
  jeweiligen Rechner (Datenbank, Uploads, Exporte, Archiv) - nie versioniert.
"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent

# Feste Programm-Ressourcen (mit dem Code versioniert, nur lesend verwendet).
RESOURCE_DIR = BACKEND_ROOT / "resources"
TEMPLATE_DIR = RESOURCE_DIR / "templates"

# Veränderliche Laufzeitdaten. Standardmäßig unter dem Projekt, aber per
# Umgebungsvariable auf einen beliebigen Ort verschiebbar (z.B. wenn Tobi die
# Daten außerhalb des Repo-Ordners ablegen möchte). Kein Bezug auf
# os.getcwd() und kein fest eingebauter Benutzerpfad.
DEFAULT_LOCAL_DATA_DIR = PROJECT_ROOT / "local_data"

LOCAL_DATA_DIR = Path(
    os.getenv("PLANNER_DATA_DIR", str(DEFAULT_LOCAL_DATA_DIR))
).expanduser().resolve()

DATABASE_DIR = LOCAL_DATA_DIR / "database"

ARCHIVE_DIR = LOCAL_DATA_DIR / "archives"
DIENSTPLAN_ARCHIVE_DIR = ARCHIVE_DIR / "dienstplanarchiv"

UPLOAD_DIR = LOCAL_DATA_DIR / "uploads"
EXPORT_DIR = LOCAL_DATA_DIR / "exports"

DATABASE_PATH = DATABASE_DIR / "dienstplaene.db"

# Feste Excel-Programmvorlagen (siehe backend/resources/templates/).
WEEK_A_TEMPLATE_PATH = TEMPLATE_DIR / "Woche_A_NewYork.xlsx"
WEEK_B_TEMPLATE_PATH = TEMPLATE_DIR / "Woche_B_Espania.xlsx"
ARTIST_TEMPLATE_PATH = TEMPLATE_DIR / "Künstlerplan_Vorlage_2026.xlsx"


def ensure_runtime_directories() -> None:
    """Legt die veränderlichen Laufzeitordner an, falls sie fehlen.

    Betrifft ausdrücklich nur local_data/* - RESOURCE_DIR/TEMPLATE_DIR wird
    hier bewusst nicht angefasst, damit dort nie unbemerkt leere Ordner oder
    Platzhalterdateien entstehen. Fehlende Programmvorlagen sollen als
    Fehler auffallen, nicht still angelegt werden.
    """
    directories = (
        DATABASE_DIR,
        DIENSTPLAN_ARCHIVE_DIR,
        UPLOAD_DIR,
        EXPORT_DIR,
    )

    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)


def relative_to_project(path: Path) -> str:
    """Projektbezogener Pfad für Ausgaben/Logs - nie ein voller Nutzerpfad."""
    try:
        return str(path.relative_to(PROJECT_ROOT))
    except ValueError:
        # Liegt z.B. wegen PLANNER_DATA_DIR ausserhalb des Projekts - dann
        # lieber nur den Ordnernamen als den vollen persönlichen Pfad zeigen.
        return f".../{path.name}"


def require_template(path: Path) -> Path:
    """Prüft, dass eine Programmvorlage existiert, statt still auf einen
    persönlichen Pfad zurückzufallen."""
    if not path.exists():
        raise FileNotFoundError(
            f"Die benötigte Excel-Vorlage wurde nicht gefunden: {path}"
        )
    return path
