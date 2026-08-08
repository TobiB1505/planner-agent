"""AP11 - Team/Personen-Endpunkte (Move-Only aus backend/api.py, unverändert).

Auth-Sprint: durchgehend PLANNER. Das Team ist der Planungsumfang - Anlegen,
Umbenennen, Aktiv-Schalten und Entfernen von Mitarbeitenden gehört laut
Rollenmodell ausdrücklich zu den Planner-Aufgaben, nicht zur
Systemverwaltung. Auch die Leseendpunkte bleiben Planner-Sache: /api/team
liefert die vollständige Mitarbeiterliste inklusive Einsatzzahlen, was für
eine Employee-Ansicht deutlich zu viel ist (siehe docs/auth/ROLE_MATRIX.md).

DELETE /api/team/{person_id} ist bewusst KEIN Admin-Endpunkt: er löscht
nichts, sondern setzt active=0/deleted=1 (Soft-Delete, historische Pläne
bleiben vollständig). Das Auth-Konto einer Person wird davon nicht berührt -
Konten verwaltet ausschliesslich /api/admin/app-users (ADMIN).
"""
from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db
from .. import stats
from ..auth import require_planner

router = APIRouter(dependencies=[Depends(require_planner)])


class PersonIn(BaseModel):
    name: str
    department: Optional[str] = None


class PersonUpdate(BaseModel):
    name: str
    department: Optional[str] = None
    active: bool


@router.get("/api/team")
def get_team(conn: sqlite3.Connection = Depends(db.get_db_connection)):
    people = db.get_all_people(conn)
    totals = stats.person_totals(conn)
    total_lookup = dict(zip(totals["person"], totals["total"])) if not totals.empty else {}
    return [
        {
            "id": p["id"], "name": p["name"], "department": p["department"],
            "active": bool(p["active"]), "total_assignments": int(total_lookup.get(p["name"], 0)),
        }
        for p in people
    ]


@router.post("/api/team")
def create_person(payload: PersonIn, conn: sqlite3.Connection = Depends(db.get_db_connection)):
    person_id = db.create_person(conn, payload.name.strip(), (payload.department or "").strip() or None)
    conn.commit()
    return {"id": person_id}


@router.put("/api/team/{person_id}")
def update_person(
    person_id: int,
    payload: PersonUpdate,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    db.update_person(conn, person_id, payload.name.strip(), (payload.department or "").strip() or None, payload.active)
    conn.commit()
    return {"ok": True}


@router.delete("/api/team/{person_id}")
def delete_person(person_id: int, conn: sqlite3.Connection = Depends(db.get_db_connection)):
    db.delete_person(conn, person_id)
    conn.commit()
    return {"ok": True}


@router.get("/api/people/active")
def people_active(conn: sqlite3.Connection = Depends(db.get_db_connection)):
    return [p["name"] for p in db.get_all_people(conn, active_only=True)]
