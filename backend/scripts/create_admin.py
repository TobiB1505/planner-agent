"""Admin-Bootstrap: schaltet einen bereits existierenden Supabase-Auth-Benutzer
im Planner als Administrator frei.

    python -m backend.scripts.create_admin --user-id <uuid>

Warum überhaupt ein Skript und keine Automatik: ein "der erste Login wird
Admin"-Mechanismus ist eine offene Tür - wer als Erster ein Konto anlegt,
übernimmt die Anwendung. Die Freischaltung passiert deshalb bewusst manuell
und mit einer UUID, die man vorher im Supabase-Dashboard nachschlagen muss.

Eigenschaften (siehe docs/auth/ADMIN_BOOTSTRAP.md):
  - läuft nur manuell; nichts importiert dieses Modul beim Serverstart,
  - verlangt eine explizite, gültige User-UUID (kein Raten, keine E-Mail-Suche),
  - prüft, ob bereits eine Zuordnung existiert, und ändert eine bestehende
    Rolle nur mit --force,
  - gibt niemals Token, Keys, Passwörter oder Verbindungsdaten aus,
  - legt keinen Supabase-Auth-Benutzer an (das kann und soll es nicht -
    dafür wäre der Service-Role-Key nötig).

Was das Skript NICHT prüfen kann: ob die UUID in Supabase wirklich existiert.
Dafür bräuchte es den Service-Role-Key, und den bewusst nicht zu brauchen ist
eine Designentscheidung dieses Sprints. Eine falsch abgetippte UUID erzeugt
darum einen wirkungslosen Eintrag - deshalb zeigt das Skript am Ende immer
an, was es geschrieben hat, damit man es mit dem Dashboard vergleichen kann.
"""
from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence
from uuid import UUID

from .. import db
from ..auth.models import ROLE_VALUES, AppRole


def _parse_args(argv: Optional[Sequence[str]]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m backend.scripts.create_admin",
        description="Schaltet einen Supabase-Auth-Benutzer im Planner frei (Standard: Rolle admin).",
    )
    parser.add_argument(
        "--user-id",
        required=True,
        help="UUID des Benutzers aus Supabase (Authentication -> Users -> UID).",
    )
    parser.add_argument(
        "--role",
        default=AppRole.ADMIN.value,
        choices=list(ROLE_VALUES),
        help="Rolle für diesen Benutzer (Standard: admin).",
    )
    parser.add_argument(
        "--person-id",
        type=int,
        default=None,
        help="Optionale Zuordnung zu einem Eintrag in der people-Tabelle. Für die Rolle employee Pflicht.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Bestehende Zuordnung überschreiben (ohne dieses Flag bleibt sie unverändert).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)

    try:
        user_id = str(UUID(str(args.user_id).strip()))
    except (TypeError, ValueError):
        print("Fehler: --user-id ist keine gültige UUID.", file=sys.stderr)
        return 2

    role = AppRole(args.role)
    if role is AppRole.EMPLOYEE and args.person_id is None:
        print("Fehler: Für die Rolle employee wird --person-id benötigt.", file=sys.stderr)
        return 2

    # Schema sicherstellen, ohne den Server zu starten - idempotent (AP4).
    db.initialize_database()
    conn = db.get_conn()
    try:
        if args.person_id is not None:
            person = conn.execute(
                "SELECT id, name FROM people WHERE id = ?", (args.person_id,)
            ).fetchone()
            if person is None:
                print(
                    f"Fehler: Es gibt keine Person mit der ID {args.person_id}.",
                    file=sys.stderr,
                )
                return 2

        existing = db.get_app_user(conn, user_id)
        if existing is not None and not args.force:
            print(
                "Für diesen Benutzer existiert bereits eine Zuordnung "
                f"(Rolle: {existing['role']}, aktiv: {bool(existing['is_active'])}).\n"
                "Es wurde nichts geändert. Zum bewussten Überschreiben: --force.",
                file=sys.stderr,
            )
            return 1

        if existing is None:
            db.create_app_user(conn, user_id, role.value, args.person_id, is_active=True)
            action = "angelegt"
        else:
            db.update_app_user(
                conn,
                user_id,
                role=role.value,
                person_id=args.person_id,
                is_active=True,
            )
            action = "aktualisiert"
        conn.commit()
    finally:
        conn.close()

    print(
        f"Zuordnung {action}: user_id={user_id}, Rolle={role.value}, "
        f"person_id={args.person_id if args.person_id is not None else '-'}, aktiv=True"
    )
    print(
        "Bitte im Supabase-Dashboard gegenprüfen, dass genau diese UID existiert "
        "(Authentication -> Users)."
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - reiner CLI-Einstieg
    raise SystemExit(main())
