"""Auth-Sprint - der Endpunkt, über den ein Client erfährt, wer er ist.

Bewusst minimal: kein Login, kein Logout, kein Token-Refresh im Backend.
Das alles macht Supabase Auth direkt gegenüber dem Frontend. FastAPI
beantwortet ausschliesslich die Frage, die nur FastAPI beantworten kann:
"Dieses Token gehört zu welcher Rolle und zu welchem Mitarbeiter?"

Das Frontend benutzt diese Antwort für Navigation und Routing (UX). Die
Sicherheitsentscheidung fällt trotzdem bei jedem einzelnen Request am
jeweiligen Endpunkt - nicht hier.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..auth import CurrentUser, require_authenticated

router = APIRouter()


@router.get("/api/auth/me")
def auth_me(
    user: CurrentUser = Depends(require_authenticated),
    conn: db.Connection = Depends(db.get_db_connection),
):
    """AUTHENTICATED - jede gültige, aktive Anmeldung darf das eigene Profil
    lesen, unabhängig von der Rolle.

    Enthält nie das Token, nie Claims, nie Daten anderer Benutzer.
    `person_name` kommt aus der people-Tabelle und dient der Begrüssung im
    Employee-Bereich; ist keine Person zugeordnet (möglich für Planer/Admins),
    bleibt das Feld null.
    """
    payload = user.to_public_dict()

    person_name = None
    if user.person_id is not None:
        row = conn.execute(
            "SELECT name FROM people WHERE id = %s", (user.person_id,)
        ).fetchone()
        if row is not None:
            person_name = row["name"]
    payload["person_name"] = person_name
    return payload
