"""Auth-Sprint - das Bootstrap-Skript (Aufgaben 33/34).

Die Anforderungen an dieses Skript sind ausdrücklich sicherheitsrelevant:
es darf keine Automatik geben, keine bestehende Rolle still überschreiben,
und es darf niemals beim Serverstart mitlaufen. Genau das wird hier geprüft.
"""
from __future__ import annotations

from backend import db
from backend.scripts import create_admin

ADMIN_UUID = "11111111-1111-4111-8111-111111111111"


def test_creates_an_admin_mapping(test_db_path, capsys):
    assert create_admin.main(["--user-id", ADMIN_UUID]) == 0

    conn = db.get_conn()
    try:
        row = db.get_app_user(conn, ADMIN_UUID)
    finally:
        conn.close()

    assert row["role"] == "admin"
    assert bool(row["is_active"]) is True

    output = capsys.readouterr()
    assert ADMIN_UUID in output.out
    # Keine Secrets in der Ausgabe.
    assert "SECRET" not in output.out.upper()
    assert "KEY" not in output.out.upper()


def test_invalid_uuid_is_rejected(test_db_path, capsys):
    assert create_admin.main(["--user-id", "admin"]) == 2

    conn = db.get_conn()
    try:
        assert db.count_app_users(conn) == 0
    finally:
        conn.close()


def test_existing_mapping_is_not_silently_overwritten(test_db_path, capsys):
    assert create_admin.main(["--user-id", ADMIN_UUID, "--role", "planner"]) == 0
    # Zweiter Lauf mit anderer Rolle, ohne --force: darf nichts ändern.
    assert create_admin.main(["--user-id", ADMIN_UUID, "--role", "admin"]) == 1

    conn = db.get_conn()
    try:
        assert db.get_app_user(conn, ADMIN_UUID)["role"] == "planner"
    finally:
        conn.close()


def test_force_overwrites_deliberately(test_db_path):
    create_admin.main(["--user-id", ADMIN_UUID, "--role", "planner"])
    assert create_admin.main(["--user-id", ADMIN_UUID, "--role", "admin", "--force"]) == 0

    conn = db.get_conn()
    try:
        assert db.get_app_user(conn, ADMIN_UUID)["role"] == "admin"
    finally:
        conn.close()


def test_employee_role_requires_a_person(test_db_path):
    assert create_admin.main(["--user-id", ADMIN_UUID, "--role", "employee"]) == 2


def test_unknown_person_id_is_rejected(test_db_path):
    assert create_admin.main(["--user-id", ADMIN_UUID, "--person-id", "4242"]) == 2


def test_person_mapping_is_stored(test_db_path):
    conn = db.get_conn()
    try:
        person_id = db.create_person(conn, "Bootstrap Person")
        conn.commit()
    finally:
        conn.close()

    assert create_admin.main(["--user-id", ADMIN_UUID, "--person-id", str(person_id)]) == 0

    conn = db.get_conn()
    try:
        assert db.get_app_user(conn, ADMIN_UUID)["person_id"] == person_id
    finally:
        conn.close()


def test_the_backend_never_imports_the_bootstrap_script():
    """Aufgabe 34: das Skript darf nicht Teil des Serverstarts sein.

    Geprüft wird die Importkette der App selbst - würde irgendein Modul das
    Skript einbinden, wäre es nach dem Import von backend.api geladen.
    """
    import subprocess
    import sys

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import backend.api, sys; "
            "print('backend.scripts.create_admin' in sys.modules)",
        ],
        capture_output=True,
        text=True,
    )
    assert result.stdout.strip().endswith("False"), result.stdout + result.stderr
