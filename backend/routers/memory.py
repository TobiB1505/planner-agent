"""AP11 - MA-Gedächtnis-Endpunkte (Move-Only aus backend/api.py, unverändert)."""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from .. import memory
from .. import stats
from .shared import clean

router = APIRouter()


@router.get("/api/memory")
def memory_overview(conn: db.Connection = Depends(db.get_db_connection)):
    return clean(memory.build_memory(conn))


@router.get("/api/memory/{person_id}")
def memory_person(person_id: int, conn: db.Connection = Depends(db.get_db_connection)):
    entry = memory.memory_for_person(conn, person_id)
    if entry is None:
        raise HTTPException(404, "Mitarbeiter wurde nicht gefunden.")
    return clean(entry)


def _memory_response(conn, person_id: int):
    entry = memory.memory_for_person(conn, person_id)
    if entry is None:
        raise HTTPException(404, "Mitarbeiter wurde nicht gefunden.")
    return clean(entry)


class MemoryShowUpdate(BaseModel):
    # None = zurück auf Automatik
    state: Optional[str] = None


@router.put("/api/memory/{person_id}/show/{show_key}")
def memory_set_show(
    person_id: int,
    show_key: str,
    payload: MemoryShowUpdate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    key = show_key.strip().upper()
    if payload.state is None:
        db.clear_memory_override(conn, person_id, "show", key)
    elif payload.state in {"confirmed", "removed", "added"}:
        db.set_memory_override(conn, person_id, "show", key, payload.state)
    else:
        raise HTTPException(400, f"Unbekannter Status: {payload.state}")
    conn.commit()
    return _memory_response(conn, person_id)


class MemoryFreeUpdate(BaseModel):
    # None = zurück auf Automatik; [] ist ein gültiger Pin ("kein festes Muster")
    weekdays: Optional[list[int]] = None


@router.put("/api/memory/{person_id}/free")
def memory_set_free(
    person_id: int,
    payload: MemoryFreeUpdate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    if payload.weekdays is None:
        db.clear_memory_override(conn, person_id, "free", "weekdays")
    else:
        weekdays = sorted({int(day) for day in payload.weekdays if 0 <= int(day) <= 6})
        db.set_memory_override(
            conn, person_id, "free", "weekdays", "pinned",
            value=json.dumps({"weekdays": weekdays}),
        )
    conn.commit()
    return _memory_response(conn, person_id)


class MemoryTaskUpdate(BaseModel):
    # Kategorie steht bewusst im Body, nicht im Pfad: Namen wie "OPS / WP" oder
    # "An/Abreise-Dienst" enthalten Schrägstriche und lassen sich auch URL-codiert
    # nicht sicher als Pfadsegment übergeben.
    category: str
    state: Optional[str] = None
    level: Optional[str] = None


@router.put("/api/memory/{person_id}/task")
def memory_set_task(
    person_id: int,
    payload: MemoryTaskUpdate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    # Immer normalisiert speichern, sonst werden "OPS / WP" und "OPS + WP" zwei Zeilen
    # für denselben Dienst.
    key = stats.normalize_category(payload.category)
    if payload.state is None:
        db.clear_memory_override(conn, person_id, "task", key)
    elif payload.state in {"added", "removed", "confirmed"}:
        value = json.dumps({"level": payload.level}) if payload.level else None
        db.set_memory_override(conn, person_id, "task", key, payload.state, value=value)
    else:
        raise HTTPException(400, f"Unbekannter Status: {payload.state}")
    conn.commit()
    return _memory_response(conn, person_id)
