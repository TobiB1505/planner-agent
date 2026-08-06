"""AP11 - Settings-Endpunkte (Move-Only aus backend/api.py, unverändert)."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db

router = APIRouter()


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
