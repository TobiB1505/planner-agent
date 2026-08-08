"""Versionierte PostgreSQL-Schemamigrationen.

Warum kein Alembic (Sprint-Punkt 7 verlangt eine dokumentierte Entscheidung):

Der Planner-Agent hat bewusst kein ORM - der gesamte Datenzugriff ist explizites
SQL gegen eine schmale Funktions-API in backend/db.py. Alembic ist auf
SQLAlchemy-Metadaten aufgebaut; sein eigentlicher Mehrwert (Autogenerate aus
deklarierten ORM-Modellen) entsteht erst, wenn es diese Modelle gibt. Ohne sie
bliebe von Alembic nur ein Migrationsrunner mit einer Versionstabelle - genau
das, was hier in ~120 Zeilen ohne zusätzliche Abhängigkeit steht -, dafür aber
mit SQLAlchemy als neuer, schwergewichtiger Laufzeitabhängigkeit und einem
zweiten Konfigurationsmechanismus (alembic.ini/env.py) neben DATABASE_URL.

Der Sprint verbietet ausdrücklich einen ORM-Rewrite und erlaubt eine kleine
SQLAlchemy-/Alembic-Abhängigkeit nur, wenn sie "klaren Nutzen" bringt. Der
Nutzen wäre hier negativ, deshalb: nummerierte .sql-Dateien + schema_migrations.

Eigenschaften des Runners:
  * Jede Migration läuft in EINER eigenen Transaktion zusammen mit ihrem
    schema_migrations-Eintrag. Bricht sie ab, ist nichts davon angewendet -
    es gibt keinen halbfertigen Zwischenstand.
  * Bereits angewendete Migrationen werden anhand ihrer Version übersprungen.
  * Es wird nie automatisch etwas gelöscht.
  * Schemaerzeugung passiert ausschließlich hier, nie aus einem Request-Pfad.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent

_FILENAME_RE = re.compile(r"^(\d{3,})_([A-Za-z0-9_\-]+)\.sql$")

SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
)
"""


class MigrationError(RuntimeError):
    """Eine Migration konnte nicht angewendet werden."""


class Migration:
    __slots__ = ("version", "name", "path")

    def __init__(self, version: str, name: str, path: Path) -> None:
        self.version = version
        self.name = name
        self.path = path

    @property
    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")

    def __repr__(self) -> str:  # pragma: no cover - reine Diagnose
        return f"<Migration {self.version}_{self.name}>"


def discover_migrations(directory: Path | None = None) -> list[Migration]:
    """Alle Migrationsdateien in aufsteigender Versionsreihenfolge.

    Doppelte Versionsnummern sind ein Fehler und keine Warnung - sonst hinge die
    Reihenfolge vom Dateisystem ab.
    """
    base = directory or MIGRATIONS_DIR
    found: dict[str, Migration] = {}
    for path in sorted(base.glob("*.sql")):
        match = _FILENAME_RE.match(path.name)
        if not match:
            raise MigrationError(
                f"Migrationsdatei mit unerwartetem Namen: {path.name} "
                "(erwartet: 001_beschreibung.sql)"
            )
        version, name = match.group(1), match.group(2)
        if version in found:
            raise MigrationError(
                f"Doppelte Migrationsversion {version}: "
                f"{found[version].path.name} und {path.name}"
            )
        found[version] = Migration(version, name, path)
    return [found[version] for version in sorted(found)]


def applied_versions(conn) -> set[str]:
    """Bereits angewendete Versionen. Legt schema_migrations bei Bedarf an."""
    conn.execute(SCHEMA_MIGRATIONS_DDL)
    conn.commit()
    rows = conn.execute("SELECT version FROM schema_migrations").fetchall()
    return {row["version"] for row in rows}


def pending_migrations(conn, directory: Path | None = None) -> list[Migration]:
    done = applied_versions(conn)
    return [m for m in discover_migrations(directory) if m.version not in done]


def apply_migrations(conn, directory: Path | None = None) -> list[str]:
    """Wendet alle offenen Migrationen an und gibt deren Versionen zurück.

    Jede Migration wird zusammen mit ihrem schema_migrations-Eintrag committet.
    Ein Fehler führt zu Rollback dieser einen Migration und einer MigrationError -
    der Aufrufer bekommt einen klaren Abbruch statt eines halb migrierten Schemas.
    """
    executed: list[str] = []
    for migration in pending_migrations(conn, directory):
        logger.info("Wende Migration an: %s_%s", migration.version, migration.name)
        try:
            conn.execute(migration.sql)
            conn.execute(
                "INSERT INTO schema_migrations (version, name) VALUES (%s, %s)",
                (migration.version, migration.name),
            )
            conn.commit()
        except Exception as exc:  # noqa: BLE001 - bewusst breit, wird sofort neu geworfen
            conn.rollback()
            raise MigrationError(
                f"Migration {migration.version}_{migration.name} fehlgeschlagen "
                f"und wurde vollständig zurückgerollt: {exc}"
            ) from exc
        executed.append(migration.version)
    return executed


def current_version(conn) -> str | None:
    """Höchste angewendete Version (oder None bei leerem Schema)."""
    versions = applied_versions(conn)
    return max(versions) if versions else None
