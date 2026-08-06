"""Lokaler Start des FastAPI-Backends mit Vorprüfung.

Aufruf immer als Modul aus dem Projektstamm heraus, damit relative Importe
(backend.*) und die .env-Auflösung von python-dotenv funktionieren:

    python -m backend.run_local

Prüft vor dem eigentlichen Start, ob die Laufzeitumgebung (Datenordner,
Datenbank, Vorlagen) in einem brauchbaren Zustand ist, und gibt dabei
verständliche, deutschsprachige Meldungen aus - technisch weniger erfahrene
Nutzer sollen direkt erkennen, was ggf. fehlt, statt einen rohen Python-
Traceback zu sehen.
"""
from __future__ import annotations

import os
import sqlite3
import sys

from .config import paths

_relative = paths.relative_to_project


def check_data_dir_for_environment() -> list[str]:
    """In Preview/Production muss PLANNER_DATA_DIR explizit gesetzt sein.

    Der lokale Default (local_data/ im Projektstamm) läge in einem Container
    typischerweise im flüchtigen Schreib-Layer und wäre nach jedem Neu-Deploy
    verloren. Ob das gemountete Volume tatsächlich persistent ist, kann diese
    Prüfung nicht technisch beweisen - nur, dass die Variable bewusst gesetzt
    wurde, statt still auf den lokalen Default zurückzufallen.
    """
    if os.getenv("APP_ENV", "local") not in ("preview", "production"):
        return []
    if os.getenv("PLANNER_DATA_DIR"):
        return []
    return [
        f"APP_ENV={os.getenv('APP_ENV')} verlangt ein explizit gesetztes "
        "PLANNER_DATA_DIR (Pfad zu einem persistenten Volume, z.B. /data) - "
        "der lokale Standardordner local_data/ liegt im flüchtigen "
        "Container-Dateisystem."
    ]


def check_runtime_directories() -> list[str]:
    """Legt die Laufzeitordner an und prüft, dass lokal geschrieben werden kann."""
    problems: list[str] = []
    paths.ensure_runtime_directories()
    probe = paths.DATABASE_DIR / ".write_check"
    try:
        probe.write_text("ok")
        probe.unlink()
    except OSError as exc:
        problems.append(
            f"local_data/database/ ist nicht beschreibbar ({exc}). "
            "Prüfe Schreibrechte oder setze PLANNER_DATA_DIR auf einen "
            "beschreibbaren Ordner."
        )
    return problems


def check_database() -> list[str]:
    """Prüft, dass die SQLite-Datenbank erreichbar ist und intakt ist.

    Öffnet dieselbe Datei, die die Anwendung später auch verwendet - legt sie
    aber nicht selbst an. Existiert sie noch nicht, wird das nur als Hinweis
    ausgegeben (der FastAPI-Lifespan-Start ruft beim eigentlichen Programmstart
    db.initialize_database() auf und legt das Schema dabei automatisch an -
    siehe backend/api.py), nicht als Fehler, der den Start verhindert.
    """
    problems: list[str] = []
    if not paths.DATABASE_PATH.exists():
        print(
            f"Hinweis: Noch keine Datenbank unter {_relative(paths.DATABASE_PATH)} "
            "gefunden - sie wird beim ersten Zugriff automatisch neu angelegt."
        )
        return problems
    try:
        conn = sqlite3.connect(str(paths.DATABASE_PATH))
        try:
            result = conn.execute("PRAGMA integrity_check;").fetchone()
        finally:
            conn.close()
    except sqlite3.Error as exc:
        problems.append(f"Datenbank konnte nicht geprüft werden: {exc}")
        return problems
    if not result or result[0] != "ok":
        problems.append(
            f"PRAGMA integrity_check meldet ein Problem: {result[0] if result else 'kein Ergebnis'}"
        )
    return problems


def check_templates() -> list[str]:
    """Prüft die benötigten Excel-Programmvorlagen.

    Fehlende Vorlagen blockieren den Start bewusst NICHT - Team, Dashboard,
    Archiv und Gedächtnis funktionieren auch ohne sie. Nur die jeweilige
    Funktion (Wochenplan-/Künstlerplan-Export) würde später fehlschlagen,
    darüber informiert die Startausgabe hier klar im Voraus.
    """
    warnings: list[str] = []
    required = {
        "Woche A (Dienstplan-Grundvorlage)": paths.WEEK_A_TEMPLATE_PATH,
        "Woche B (Dienstplan-Grundvorlage)": paths.WEEK_B_TEMPLATE_PATH,
        "Künstlerplan-Vorlage": paths.ARTIST_TEMPLATE_PATH,
    }
    for label, path in required.items():
        if not path.exists():
            warnings.append(
                f"Vorlage fehlt - {label}: erwartet unter "
                f"backend/resources/templates/{path.name}"
            )
    return warnings


def check_archive() -> None:
    """Das lokale Dienstplanarchiv ist rein optional - fehlende Dateien sind normal."""
    if not any(paths.DIENSTPLAN_ARCHIVE_DIR.glob("*")):
        print(
            "Hinweis: local_data/archives/dienstplanarchiv/ ist leer - "
            "das ist normal auf einem frischen Rechner und blockiert den Start nicht."
        )


def _resolve_port(raw: str, source: str) -> int:
    try:
        port = int(raw)
    except ValueError:
        print(f"Ungültiger Port aus {source}: '{raw}' ist keine Zahl.")
        sys.exit(1)
    if not (1 <= port <= 65535):
        print(f"Ungültiger Port aus {source}: {port} liegt ausserhalb von 1-65535.")
        sys.exit(1)
    return port


def resolve_backend_port() -> int:
    """PORT vor BACKEND_PORT: viele Container-Hosting-Plattformen (Render,
    Railway, Fly.io) injizieren PORT und erwarten, dass der Prozess genau
    darauf bindet - BACKEND_PORT bleibt der lokale/dokumentierte Name."""
    raw_port = os.getenv("PORT") or os.getenv("BACKEND_PORT", "8000")
    return _resolve_port(raw_port, "PORT/BACKEND_PORT")


def run_checks() -> None:
    print("Planner-Agent Backend - Vorprüfung")
    print(f"Datenordner: {_relative(paths.LOCAL_DATA_DIR)}")

    problems = check_data_dir_for_environment()
    problems += check_runtime_directories()
    problems += check_database()

    for warning in check_templates():
        print(f"Warnung: {warning}")
    check_archive()

    if problems:
        print()
        print("Der Start wurde wegen folgender Probleme abgebrochen:")
        for problem in problems:
            print(f"  - {problem}")
        sys.exit(1)

    print("Vorprüfung abgeschlossen - keine blockierenden Probleme gefunden.")


def main() -> None:
    run_checks()

    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = resolve_backend_port()
    # reload=True ist eine Entwickler-Bequemlichkeit (Auto-Neustart bei
    # Code-Änderungen) und lief lange als Standard - das war ein Fehler:
    # ein normaler Nutzer bearbeitet keinen Code, bekommt davon nur einen
    # zusätzlichen Reloader-Prozess ohne Nutzen, und der System-Manager-
    # Neustart-Button (/api/system/restart) verliess sich fälschlich genau
    # auf diesen Reload-Mechanismus - ohne ihn passierte beim Klick nichts.
    # Der Neustart-Button funktioniert jetzt unabhängig davon (os.execv in
    # api.py), Standard ist deshalb bewusst reload=False. Für aktive
    # Entwicklung optional wieder aktivierbar: BACKEND_RELOAD=1.
    reload_enabled = os.getenv("BACKEND_RELOAD", "0") == "1"

    import uvicorn

    print(f"Backend startet auf http://{host}:{port}")
    print(f"API-Dokumentation: http://{host}:{port}/docs")
    print(f"Health-Check: http://{host}:{port}/api/health")
    if reload_enabled:
        print("Entwicklermodus: BACKEND_RELOAD=1 - Auto-Neustart bei Code-Änderungen aktiv.")

    uvicorn.run(
        "backend.api:app",
        host=host,
        port=port,
        reload=reload_enabled,
    )


if __name__ == "__main__":
    main()
