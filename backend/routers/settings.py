"""AP11 - Settings-Endpunkte (Move-Only aus backend/api.py, unverändert).

Auth-Sprint: ADMIN - für beide Richtungen. Das ist ein generischer
Schlüssel/Wert-Speicher: der Aufrufer bestimmt den Schlüssel, nicht der
Server. Ein Leserecht "nur für harmlose Schlüssel" gibt es hier technisch
nicht, und in der Tabelle stehen unter anderem Vorlagenpfade
(template_*_source_path, siehe backend/plan_templates.py). Der einzige
Aufrufer im Frontend ist die Systemseite, die ohnehin ADMIN ist.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db
from ..auth import require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


@router.get("/api/settings/{key}")
def get_setting(key: str, conn: sqlite3.Connection = Depends(db.get_db_connection)):
    return {"value": db.get_setting(conn, key)}


class SettingValue(BaseModel):
    value: str


@router.put("/api/settings/{key}")
def set_setting(
    key: str,
    payload: SettingValue,
    conn: sqlite3.Connection = Depends(db.get_db_connection),
):
    db.set_setting(conn, key, payload.value)
    conn.commit()
    return {"ok": True}
