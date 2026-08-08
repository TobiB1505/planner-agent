"""Auth-Sprint - minimale Benutzerverwaltung (ADMIN).

Bewusst klein gehalten: dieser Sprint schafft die Grundlage, nicht die
Verwaltungsoberfläche. Hier stehen genau die Operationen, die ein Admin
braucht, um nach dem Bootstrap weitere Konten freizuschalten, ohne ein
Skript auf dem Server auszuführen:

    auflisten - anlegen - Rolle ändern - aktivieren/deaktivieren -
    Person zuordnen - Zuordnung entfernen

Was hier bewusst NICHT passiert:
  - Kein Anlegen von Supabase-Auth-Benutzern (das macht Supabase, und dafür
    bräuchte das Backend den Service-Role-Key - siehe
    docs/auth/SUPABASE_AUTH_SETUP.md).
  - Kein Passwort-Handling irgendeiner Art.
  - Kein Löschen von Auth-Konten: DELETE entfernt ausschliesslich die
    Planner-Zuordnung.

Der ganze Router hängt an require_admin - ein Planer kann hier nichts
lesen und nichts ändern, insbesondere nicht die eigene Rolle.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..auth import AppRole, CurrentUser, ROLE_VALUES, parse_role, require_admin

router = APIRouter(dependencies=[Depends(require_admin)])


def _parse_user_id(raw: str) -> str:
    """Akzeptiert nur echte UUIDs und speichert sie kanonisch.

    Verhindert, dass durch Tippfehler ("admin", "123") Zuordnungen entstehen,
    die nie ein Token treffen kann - so ein Eintrag sähe in der Liste
    plausibel aus, hätte aber keine Wirkung.
    """
    try:
        return str(UUID(str(raw).strip()))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "user_id muss die UUID eines Supabase-Auth-Benutzers sein.") from exc


def _parse_role_or_400(raw: str) -> AppRole:
    try:
        return parse_role(raw)
    except ValueError as exc:
        raise HTTPException(400, f"Unbekannte Rolle. Erlaubt: {', '.join(ROLE_VALUES)}.") from exc


def _require_person(conn, person_id: int) -> None:
    row = conn.execute("SELECT id FROM people WHERE id = %s", (person_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Die angegebene Person wurde nicht gefunden.")


def _serialize(row) -> dict:
    return {
        "user_id": row["user_id"],
        "role": row["role"],
        "person_id": row["person_id"],
        "person_name": row["person_name"] if "person_name" in row.keys() else None,
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


class AppUserCreate(BaseModel):
    user_id: str
    role: str
    person_id: Optional[int] = None
    is_active: bool = True


class AppUserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    person_id: Optional[int] = None
    # Explizit, weil person_id=None nicht von "nicht mitgeschickt"
    # unterscheidbar wäre.
    clear_person: bool = False


@router.get("/api/admin/app-users")
def list_app_users(conn: db.Connection = Depends(db.get_db_connection)):
    return [_serialize(row) for row in db.list_app_users(conn)]


@router.post("/api/admin/app-users", status_code=201)
def create_app_user(
    payload: AppUserCreate,
    conn: db.Connection = Depends(db.get_db_connection),
):
    user_id = _parse_user_id(payload.user_id)
    role = _parse_role_or_400(payload.role)

    if role is AppRole.EMPLOYEE and payload.person_id is None:
        raise HTTPException(400, "Für die Rolle employee muss eine Person zugeordnet werden.")
    if payload.person_id is not None:
        _require_person(conn, payload.person_id)

    if db.get_app_user(conn, user_id) is not None:
        raise HTTPException(409, "Für diesen Benutzer existiert bereits eine Zuordnung.")

    try:
        db.create_app_user(conn, user_id, role.value, payload.person_id, payload.is_active)
    except psycopg.errors.IntegrityError as exc:
        # Trifft vor allem den UNIQUE-Index auf person_id (eine Person darf
        # höchstens ein Konto haben).
        raise HTTPException(409, "Diese Zuordnung verletzt eine Eindeutigkeitsregel.") from exc
    conn.commit()
    return _serialize(db.get_app_user_detail(conn, user_id))


@router.patch("/api/admin/app-users/{user_id}")
def update_app_user(
    user_id: str,
    payload: AppUserUpdate,
    current: CurrentUser = Depends(require_admin),
    conn: db.Connection = Depends(db.get_db_connection),
):
    normalized = _parse_user_id(user_id)
    existing = db.get_app_user(conn, normalized)
    if existing is None:
        raise HTTPException(404, "Zuordnung wurde nicht gefunden.")

    role = _parse_role_or_400(payload.role) if payload.role is not None else None

    # Selbstaussperrung verhindern: ein Admin soll sich nicht versehentlich
    # selbst die Rolle nehmen oder das eigene Konto deaktivieren und damit
    # die Verwaltung unerreichbar machen.
    if str(current.user_id) == normalized:
        if role is not None and role is not AppRole.ADMIN:
            raise HTTPException(400, "Die eigene Admin-Rolle kann nicht entzogen werden.")
        if payload.is_active is False:
            raise HTTPException(400, "Das eigene Konto kann nicht deaktiviert werden.")

    effective_role = role or parse_role(existing["role"])
    effective_person = existing["person_id"]
    if payload.clear_person:
        effective_person = None
    elif payload.person_id is not None:
        effective_person = payload.person_id

    if effective_role is AppRole.EMPLOYEE and effective_person is None:
        raise HTTPException(400, "Für die Rolle employee muss eine Person zugeordnet bleiben.")
    if payload.person_id is not None and not payload.clear_person:
        _require_person(conn, payload.person_id)

    try:
        db.update_app_user(
            conn,
            normalized,
            role=role.value if role else None,
            person_id=payload.person_id,
            is_active=payload.is_active,
            clear_person=payload.clear_person,
        )
    except psycopg.errors.IntegrityError as exc:
        raise HTTPException(409, "Diese Zuordnung verletzt eine Eindeutigkeitsregel.") from exc
    conn.commit()
    return _serialize(db.get_app_user_detail(conn, normalized))


@router.delete("/api/admin/app-users/{user_id}")
def delete_app_user(
    user_id: str,
    current: CurrentUser = Depends(require_admin),
    conn: db.Connection = Depends(db.get_db_connection),
):
    """Entfernt die Planner-Zuordnung. Der Supabase-Auth-Benutzer bleibt
    bestehen und kann sich weiterhin anmelden - bekommt dann aber von jedem
    geschützten Endpunkt 403, weil kein app_users-Eintrag mehr existiert."""
    normalized = _parse_user_id(user_id)
    if str(current.user_id) == normalized:
        raise HTTPException(400, "Das eigene Konto kann nicht entfernt werden.")
    if not db.delete_app_user(conn, normalized):
        raise HTTPException(404, "Zuordnung wurde nicht gefunden.")
    conn.commit()
    return {"ok": True}
