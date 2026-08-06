"""Sprint 1, Teil 3 - Backup/Restore für die lokale SQLite-Datenbank.

Nutzt SQLite `VACUUM INTO` statt eines rohen Datei-Kopiervorgangs: ein `cp`
während eines offenen Schreibvorgangs (WAL-Datei + Hauptdatei sind zwei
getrennte Dateien, ein `cp` der Hauptdatei allein sieht ggf. noch nicht
committete oder halb geschriebene Seiten) könnte eine inkonsistente Kopie
erzeugen. `VACUUM INTO` liest dagegen eine transaktional konsistente
Momentaufnahme direkt aus der SQLite-Engine - verifiziert (siehe
backend/tests/test_backup_restore.py), dass das auch funktioniert, während
eine zweite Verbindung parallel eine offene, unkommittete Schreibtransaktion
hält (genau der Fall einer laufenden Anwendung).

Aufruf als Skript:
    python -m backend.backup
"""
from __future__ import annotations

import logging
import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from .config import paths

logger = logging.getLogger(__name__)


class BackupError(Exception):
    """Ausgelöst, wenn ein Backup nicht erstellt werden konnte."""


def create_backup(
    source_path: Path | None = None,
    backup_dir: Path | None = None,
    *,
    now: datetime | None = None,
) -> Path:
    """Erstellt eine konsistente Backup-Kopie der SQLite-Datenbank.

    Gibt den Pfad der neu erstellten Backup-Datei zurück. Wirft `BackupError`
    mit einer verständlichen Meldung, wenn etwas schiefgeht (Quelle fehlt,
    Zielordner nicht beschreibbar, SQLite-Fehler) - verschluckt nichts.
    """
    source = source_path or paths.DATABASE_PATH
    target_dir = backup_dir or paths.BACKUP_DIR

    if not source.exists():
        raise BackupError(f"Quelldatenbank nicht gefunden: {source}")

    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BackupError(f"Backup-Ordner nicht erreichbar ({target_dir}): {exc}") from exc

    timestamp = (now or datetime.now()).strftime("%Y-%m-%d_%H%M")
    backup_path = target_dir / f"{source.stem}_{timestamp}.db"
    # VACUUM INTO weigert sich, eine bestehende Datei zu überschreiben -
    # bei mehreren Backups innerhalb derselben Minute (z.B. in Tests) einen
    # eindeutigen Namen wählen statt stillschweigend zu scheitern.
    suffix = 2
    while backup_path.exists():
        backup_path = target_dir / f"{source.stem}_{timestamp}_{suffix}.db"
        suffix += 1

    try:
        conn = sqlite3.connect(str(source))
    except sqlite3.Error as exc:
        raise BackupError(f"Quelldatenbank konnte nicht geöffnet werden: {exc}") from exc

    try:
        conn.execute("VACUUM INTO ?", (str(backup_path),))
    except sqlite3.Error as exc:
        # Eine fehlgeschlagene/unvollständige Zieldatei nicht liegen lassen.
        if backup_path.exists():
            backup_path.unlink()
        logger.error("Backup fehlgeschlagen (Quelle: %s): %s", source, exc)
        raise BackupError(f"Backup fehlgeschlagen: {exc}") from exc
    finally:
        conn.close()

    logger.info(
        "Backup erstellt: %s (%d Bytes)", backup_path, backup_path.stat().st_size
    )
    return backup_path


def verify_backup(backup_path: Path) -> bool:
    """Prüft die Integrität eines Backups per PRAGMA integrity_check.

    Reiner Lesezugriff - öffnet und schliesst eine eigene, unabhängige
    Verbindung, verändert die Backup-Datei nicht. Prüft `exists()` vorab,
    weil `sqlite3.connect()` eine fehlende Datei sonst stillschweigend als
    leere, "gültige" Datenbank neu anlegen würde."""
    if not backup_path.exists():
        return False
    try:
        conn = sqlite3.connect(str(backup_path))
    except sqlite3.Error:
        return False
    try:
        result = conn.execute("PRAGMA integrity_check;").fetchone()
        return bool(result) and result[0] == "ok"
    except sqlite3.Error:
        return False
    finally:
        conn.close()


def list_backups(backup_dir: Path | None = None) -> list[Path]:
    """Listet vorhandene Backups, neueste zuerst."""
    target_dir = backup_dir or paths.BACKUP_DIR
    if not target_dir.exists():
        return []
    return sorted(target_dir.glob("*.db"), key=lambda p: p.stat().st_mtime, reverse=True)


def restore_backup(backup_path: Path, target_path: Path | None = None) -> Path:
    """Stellt ein Backup wieder her, indem es an die Zielposition kopiert wird.

    Prüft die Integrität des Backups VOR dem Kopieren (kein Restore einer
    beschädigten Datei) und sichert eine evtl. vorhandene Zieldatei vorher
    unter einem `.pre-restore`-Namen weg, statt sie einfach zu überschreiben -
    ein fehlgeschlagener Restore darf keine bereits funktionierende
    Datenbank unwiederbringlich zerstören."""
    if not backup_path.exists():
        raise BackupError(f"Backup-Datei nicht gefunden: {backup_path}")
    if not verify_backup(backup_path):
        raise BackupError(
            f"Backup ist laut Integritätsprüfung beschädigt, Restore abgebrochen: {backup_path}"
        )

    target = target_path or paths.DATABASE_PATH
    target.parent.mkdir(parents=True, exist_ok=True)

    if target.exists():
        safety_copy = target.with_suffix(target.suffix + ".pre-restore")
        target.replace(safety_copy)
        logger.info("Bestehende Datenbank vor Restore gesichert: %s", safety_copy)

    try:
        shutil.copyfile(str(backup_path), str(target))
    except OSError as exc:
        raise BackupError(f"Restore fehlgeschlagen: {exc}") from exc

    # Verwaiste WAL/SHM-Dateien der vorherigen Datenbank dürfen nicht mit den
    # committeten Seiten der wiederhergestellten Datei vermischt werden.
    for suffix in ("-wal", "-shm"):
        stale = Path(str(target) + suffix)
        if stale.exists():
            stale.unlink()

    logger.info("Datenbank wiederhergestellt: %s -> %s", backup_path, target)
    return target


def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        backup_path = create_backup()
    except BackupError as exc:
        logger.error(str(exc))
        raise SystemExit(1) from exc

    if not verify_backup(backup_path):
        logger.error(
            "Backup wurde erstellt, ist aber laut Integritätsprüfung beschädigt: %s",
            backup_path,
        )
        raise SystemExit(1)

    print(f"Backup erfolgreich: {backup_path}")


if __name__ == "__main__":
    _main()
