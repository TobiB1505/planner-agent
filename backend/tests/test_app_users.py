"""Auth-Sprint - Datenmodell app_users und die minimale Kontenverwaltung.

Geprüft werden vor allem die Zusagen, die das Schema selbst gibt (Aufgabe 6):
nur die drei erlaubten Rollen, employee immer mit Person, höchstens ein Konto
pro Person, und - genauso wichtig - dass hier nirgends ein Passwortfeld
entsteht (Aufgabe 7).
"""
from __future__ import annotations

import sqlite3

import pytest

from backend import db

ADMIN_UUID = "11111111-1111-4111-8111-111111111111"
PLANNER_UUID = "22222222-2222-4222-8222-222222222222"
EMPLOYEE_UUID = "33333333-3333-4333-8333-333333333333"


# ---------- Schema ----------


def test_app_users_never_stores_credentials(test_conn):
    """Aufgabe 7: Passwörter gehören ausschliesslich zu Supabase Auth."""
    columns = {row[1].lower() for row in test_conn.execute("PRAGMA table_info(app_users)")}
    for forbidden in ("password", "password_hash", "salt", "reset_token", "token"):
        assert forbidden not in columns

    assert {"user_id", "person_id", "role", "is_active", "created_at", "updated_at"} <= columns


def test_only_the_three_roles_are_accepted(test_conn):
    person_id = db.create_person(test_conn, "Rollen-Testperson")
    db.create_app_user(test_conn, ADMIN_UUID, "admin")
    db.create_app_user(test_conn, PLANNER_UUID, "planner")
    db.create_app_user(test_conn, EMPLOYEE_UUID, "employee", person_id=person_id)
    test_conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        db.create_app_user(test_conn, "44444444-4444-4444-8444-444444444444", "superadmin")


def test_employee_requires_a_person(test_conn):
    """Ohne Person gäbe es für einen Mitarbeiter kein "mein Dienstplan" -
    das Schema lässt diesen Zustand deshalb gar nicht erst zu."""
    with pytest.raises(sqlite3.IntegrityError):
        db.create_app_user(test_conn, EMPLOYEE_UUID, "employee", person_id=None)


def test_admin_and_planner_may_exist_without_a_person(test_conn):
    """Die bewusste Gegenprobe: person_id ist nullable, und das wird genutzt."""
    db.create_app_user(test_conn, ADMIN_UUID, "admin")
    db.create_app_user(test_conn, PLANNER_UUID, "planner")
    test_conn.commit()

    assert db.get_app_user(test_conn, ADMIN_UUID)["person_id"] is None
    assert db.get_app_user(test_conn, PLANNER_UUID)["person_id"] is None


def test_a_person_can_only_belong_to_one_account(test_conn):
    person_id = db.create_person(test_conn, "Doppelte Person")
    db.create_app_user(test_conn, EMPLOYEE_UUID, "employee", person_id=person_id)
    test_conn.commit()

    with pytest.raises(sqlite3.IntegrityError):
        db.create_app_user(test_conn, PLANNER_UUID, "planner", person_id=person_id)


def test_user_ids_are_stored_and_found_case_insensitively(test_conn):
    """Supabase zeigt UUIDs im Dashboard in Grossbuchstaben an - ein
    kopierter Wert muss trotzdem dieselbe Zeile treffen."""
    db.create_app_user(test_conn, ADMIN_UUID.upper(), "admin")
    test_conn.commit()

    assert db.get_app_user(test_conn, ADMIN_UUID) is not None
    assert db.get_app_user(test_conn, ADMIN_UUID.upper()) is not None


def test_update_and_delete_only_touch_the_mapping(test_conn):
    person_id = db.create_person(test_conn, "Wechselnde Person")
    db.create_app_user(test_conn, EMPLOYEE_UUID, "employee", person_id=person_id)
    test_conn.commit()

    assert db.update_app_user(test_conn, EMPLOYEE_UUID, role="planner", clear_person=True)
    test_conn.commit()
    row = db.get_app_user(test_conn, EMPLOYEE_UUID)
    assert row["role"] == "planner" and row["person_id"] is None

    assert db.delete_app_user(test_conn, EMPLOYEE_UUID)
    test_conn.commit()
    assert db.get_app_user(test_conn, EMPLOYEE_UUID) is None
    # Die Person selbst bleibt bestehen.
    assert test_conn.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 1


# ---------- Admin-API ----------


def _create_person(client, name: str) -> int:
    response = client.post("/api/team", json={"name": name})
    assert response.status_code == 200
    return response.json()["id"]


def test_admin_can_list_create_update_and_delete_accounts(admin_client):
    person_id = _create_person(admin_client, "Verwaltete Person")

    created = admin_client.post(
        "/api/admin/app-users",
        json={"user_id": EMPLOYEE_UUID, "role": "employee", "person_id": person_id},
    )
    assert created.status_code == 201
    assert created.json()["person_name"] == "Verwaltete Person"

    listed = admin_client.get("/api/admin/app-users").json()
    assert [entry["user_id"] for entry in listed] == [EMPLOYEE_UUID]

    deactivated = admin_client.patch(
        f"/api/admin/app-users/{EMPLOYEE_UUID}", json={"is_active": False}
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False

    assert admin_client.delete(f"/api/admin/app-users/{EMPLOYEE_UUID}").status_code == 200
    assert admin_client.get("/api/admin/app-users").json() == []


def test_creating_an_account_twice_is_a_conflict(admin_client):
    admin_client.post("/api/admin/app-users", json={"user_id": PLANNER_UUID, "role": "planner"})
    second = admin_client.post(
        "/api/admin/app-users", json={"user_id": PLANNER_UUID, "role": "planner"}
    )
    assert second.status_code == 409


def test_invalid_input_is_rejected_with_a_clear_message(admin_client):
    assert admin_client.post(
        "/api/admin/app-users", json={"user_id": "kein-uuid", "role": "admin"}
    ).status_code == 400

    assert admin_client.post(
        "/api/admin/app-users", json={"user_id": ADMIN_UUID, "role": "root"}
    ).status_code == 400

    # employee ohne Person
    assert admin_client.post(
        "/api/admin/app-users", json={"user_id": EMPLOYEE_UUID, "role": "employee"}
    ).status_code == 400

    # Person existiert nicht
    assert admin_client.post(
        "/api/admin/app-users",
        json={"user_id": EMPLOYEE_UUID, "role": "employee", "person_id": 9999},
    ).status_code == 404


def test_an_admin_cannot_lock_themselves_out(admin_client):
    """Ohne diese Sperre könnte der letzte Admin die Verwaltung mit einem
    einzigen Klick unerreichbar machen."""
    from .conftest import ADMIN_USER_ID

    own_id = str(ADMIN_USER_ID)
    admin_client.post("/api/admin/app-users", json={"user_id": own_id, "role": "admin"})

    assert admin_client.patch(f"/api/admin/app-users/{own_id}", json={"role": "planner"}).status_code == 400
    assert admin_client.patch(f"/api/admin/app-users/{own_id}", json={"is_active": False}).status_code == 400
    assert admin_client.delete(f"/api/admin/app-users/{own_id}").status_code == 400
