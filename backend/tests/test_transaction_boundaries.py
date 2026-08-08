"""AP10 - Fehler-Injektionstests für Transaktionsgrenzen.

Verifiziert, dass ein fehlgeschlagener Speichervorgang (Plan Save, Import,
Artist-Plan, Probenplan) keinen halbfertigen Zustand in der Datenbank
hinterlässt. Vor AP10 committeten die Low-Level-Helfer (db.insert_week_plan,
db.create_person, db.add_alias, ...) jeweils sofort - ein Fehler mitten in
einer mehrstufigen Operation konnte dadurch z.B. einen week_plans-Eintrag
ohne (vollständige) assignments zurücklassen. Nach AP10 committen diese
Helfer nicht mehr selbst; die fachliche Operation (der API-Endpunkt) besitzt
die Transaktion und committet erst ganz am Ende. Bricht die Operation vorher
mit einer Exception ab, schließt FastAPIs Depends(db.get_db_connection) die
Connection ohne Commit - SQLite rollt die noch offene, implizite Transaktion
dabei automatisch zurück (siehe db.get_db_connection()-Docstring).

Jeder Test erzwingt künstlich eine Exception mitten in einer mehrstufigen
Schreiboperation (via monkeypatch auf eine db.*- oder audit-Funktion) und
prüft danach mit einer FRISCHEN Verbindung, dass weder ein "Container"-
Datensatz (week_plans/artist_plans/rehearsal_plans) noch Teil-Datensätze
(assignments/absences/people/people_aliases) übrig geblieben sind. Eine
frische Verbindung ist hier bewusst wichtig: sie zeigt nur committete Daten,
exakt wie ein zweiter echter Request es täte.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import api, db
from backend.intelligence import audit as intelligence_audit


class _Boom(Exception):
    """Absichtlich ausgelöster Testfehler, unterscheidbar von echten Bugs."""


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Testisolation (eigenes, frisch migriertes PostgreSQL-Schema) kommt aus der
    # autouse-Fixture in conftest.py.
    # raise_server_exceptions=False: die absichtlich injizierten Fehler sollen
    # als reguläre 500-Antworten ankommen, wie es ein echter Client auch
    # erleben würde - nicht als Python-Exception im Test selbst.
    with TestClient(api.app, raise_server_exceptions=False) as c:
        yield c


class _FailingConnProxy:
    """Reicht alle Aufrufe an eine echte Connection durch, löst aber beim
    ersten `execute()`/`executemany()` mit passendem SQL-Fragment eine
    Exception aus. Über FastAPIs eigenen dependency_overrides-Mechanismus
    lässt sich damit ein Fehler mitten in einer mehrstufigen Schreiboperation
    erzwingen, ohne db.py oder api.py anzufassen."""

    def __init__(self, conn: object, trigger: str) -> None:
        self._conn = conn
        self._trigger = trigger

    def execute(self, sql, params=()):
        if self._trigger in str(sql):
            raise _Boom(f"Absichtlicher Fehler bei: {self._trigger}")
        return self._conn.execute(sql, params)

    def executemany(self, sql, seq):
        if self._trigger in str(sql):
            raise _Boom(f"Absichtlicher Fehler bei: {self._trigger}")
        return self._conn.executemany(sql, seq)

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _failing_db_connection_dependency(trigger: str):
    """Ersatz für Depends(db.get_db_connection): identisches Öffnen/Schließen
    (kein Commit bei einer Exception, siehe db.get_db_connection-Docstring),
    liefert dem Endpunkt aber eine _FailingConnProxy statt der echten
    Connection."""

    def _dependency():
        conn = db.create_connection()
        try:
            yield _FailingConnProxy(conn, trigger)
        finally:
            conn.close()

    return _dependency


def _row_counts(conn) -> dict:
    tables = [
        "week_plans", "assignments", "absences",
        "people", "people_aliases",
        "artist_plans", "artist_plan_entries",
        "rehearsal_plans", "rehearsals", "rehearsal_people",
    ]
    return {t: conn.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()["c"] for t in tables}


def _plan_payload(day_label: str, rows: list[dict], template_week_id: int = 99) -> dict:
    return {
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "template_week_id": template_week_id,
        "day_labels": [day_label],
        "rows": rows,
    }


def _plan_row(day_label: str, person: str, category: str = "Tagesverantwortung") -> dict:
    return {
        "Abschnitt": category,
        "Zeile": "",
        "_row_type": "data",
        "_category": category,
        day_label: person,
    }


# ---------- Plan Save (POST /api/plan/save) ----------


def test_plan_save_rolls_back_when_first_assignment_fails(client, monkeypatch):
    """Fehler direkt nach dem Anlegen der Planwoche, vor der ersten Zuweisung:
    es darf weder die Planwoche noch irgendeine Zuweisung übrig bleiben."""
    day_label = "Mo, 10.08."
    payload = _plan_payload(day_label, [_plan_row(day_label, "Tobi")])

    def _boom(*args, **kwargs):
        raise _Boom("Absichtlicher Fehler: erste Zuweisung")

    monkeypatch.setattr(db, "insert_assignment", _boom)

    response = client.post("/api/plan/save", json=payload)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        weeks = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = %s", (payload["start_date"],)
        ).fetchall()
        assignments = conn.execute("SELECT * FROM assignments").fetchall()
    finally:
        conn.close()

    assert weeks == [], "week_plans-Eintrag ohne Zuweisungen darf nicht übrig bleiben"
    assert assignments == []


def test_plan_save_rolls_back_when_second_assignment_fails(client, monkeypatch):
    """Fehler NACH der ersten erfolgreich gespeicherten Zuweisung: auch die
    bereits gespeicherte erste Zuweisung darf nicht übrig bleiben."""
    day_label = "Mo, 10.08."
    payload = _plan_payload(
        day_label,
        [
            _plan_row(day_label, "Tobi", category="Tagesverantwortung"),
            _plan_row(day_label, "Fanny", category="Ausschlafen"),
        ],
    )

    real_insert_assignment = db.insert_assignment
    calls = {"n": 0}

    def _fail_on_second(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise _Boom("Absichtlicher Fehler: zweite Zuweisung")
        return real_insert_assignment(*args, **kwargs)

    monkeypatch.setattr(db, "insert_assignment", _fail_on_second)

    response = client.post("/api/plan/save", json=payload)
    assert response.status_code == 500
    assert calls["n"] == 2

    conn = db.get_conn()
    try:
        weeks = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = %s", (payload["start_date"],)
        ).fetchall()
        assignments = conn.execute("SELECT * FROM assignments").fetchall()
    finally:
        conn.close()

    assert weeks == []
    assert assignments == [], "bereits gespeicherte erste Zuweisung darf nicht übrig bleiben"


def test_plan_save_rolls_back_when_audit_metadata_fails(client, monkeypatch):
    """Fehler beim Schreiben der Audit-Metadaten, NACHDEM Woche und alle
    Zuweisungen bereits (unkommittiert) gespeichert wurden."""
    day_label = "Mo, 10.08."
    payload = _plan_payload(day_label, [_plan_row(day_label, "Tobi")])

    def _boom(*args, **kwargs):
        raise _Boom("Absichtlicher Fehler: Audit-Metadaten")

    monkeypatch.setattr(intelligence_audit, "record_plan_saved", _boom)

    response = client.post("/api/plan/save", json=payload)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        weeks = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = %s", (payload["start_date"],)
        ).fetchall()
        assignments = conn.execute("SELECT * FROM assignments").fetchall()
    finally:
        conn.close()

    assert weeks == [], "Woche darf trotz erfolgreich gespeicherter Zuweisungen nicht übrig bleiben"
    assert assignments == []


def test_plan_save_succeeds_without_injected_fault(client):
    """Gegenprobe: ohne Fehler-Injektion committet plan_save weiterhin normal
    (verhindert, dass die obigen Tests nur zufällig grün sind)."""
    day_label = "Mo, 10.08."
    payload = _plan_payload(day_label, [_plan_row(day_label, "Tobi")])

    response = client.post("/api/plan/save", json=payload)
    assert response.status_code == 200

    conn = db.get_conn()
    try:
        weeks = conn.execute(
            "SELECT id FROM week_plans WHERE start_date = %s", (payload["start_date"],)
        ).fetchall()
        assignments = conn.execute("SELECT * FROM assignments").fetchall()
    finally:
        conn.close()

    assert len(weeks) == 1
    assert len(assignments) == 1


# ---------- Import Save (POST /api/import/save) ----------


def _import_payload(assignments: list[dict], absences: list[dict] | None = None) -> dict:
    return {
        "filename": "test-import.pdf",
        "kw": 33,
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "assignments": assignments,
        "absences": absences or [],
        "resolutions": {},
    }


def _import_assignment(person: str, date: str = "2026-08-10", category: str = "Tagesverantwortung") -> dict:
    return {"date": date, "category": category, "subcategory": None, "person": person, "raw_text": person}


def test_import_save_rolls_back_when_assignment_insert_fails(client, monkeypatch):
    payload = _import_payload([_import_assignment("Neue Person")])

    def _boom(*args, **kwargs):
        raise _Boom("Absichtlicher Fehler: Zuweisung im Import")

    monkeypatch.setattr(db, "insert_assignment", _boom)

    response = client.post("/api/import/save", json=payload)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["week_plans"] == 0, "keine halbe Import-Woche"
    assert counts["assignments"] == 0
    assert counts["people"] == 0, "für die fehlgeschlagene Zeile darf keine Person übrig bleiben"
    assert counts["people_aliases"] == 0


def test_import_save_rolls_back_new_person_and_alias_from_earlier_row(client, monkeypatch):
    """Zeile 1 legt erfolgreich eine neue Person + Alias an und speichert ihre
    Zuweisung; Zeile 2 schlägt danach fehl. Die Person/den Alias aus Zeile 1
    darf es NICHT geben, sobald der gesamte Import fehlschlägt - anlegen und
    verwerfen gehören zur selben fachlichen Operation."""
    payload = _import_payload(
        [
            _import_assignment("Ganz Neue Person", date="2026-08-10"),
            _import_assignment("Noch Eine Person", date="2026-08-11"),
        ]
    )

    real_insert_assignment = db.insert_assignment
    calls = {"n": 0}

    def _fail_on_second(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise _Boom("Absichtlicher Fehler: zweite Import-Zeile")
        return real_insert_assignment(*args, **kwargs)

    monkeypatch.setattr(db, "insert_assignment", _fail_on_second)

    response = client.post("/api/import/save", json=payload)
    assert response.status_code == 500
    assert calls["n"] == 2

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
        people = conn.execute("SELECT name FROM people").fetchall()
    finally:
        conn.close()

    assert counts["week_plans"] == 0
    assert counts["assignments"] == 0
    assert people == [], (
        "die in Zeile 1 bereits angelegte Person darf nach dem Fehlschlag "
        "von Zeile 2 nicht bestehen bleiben"
    )
    assert counts["people_aliases"] == 0


def test_import_save_rolls_back_when_absence_insert_fails(client, monkeypatch):
    payload = _import_payload(
        [_import_assignment("Tobi")],
        absences=[{"date": "2026-08-12", "person": "Tobi", "type": "Frei"}],
    )

    def _boom(*args, **kwargs):
        raise _Boom("Absichtlicher Fehler: Abwesenheit im Import")

    monkeypatch.setattr(db, "insert_absence", _boom)

    response = client.post("/api/import/save", json=payload)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["week_plans"] == 0
    assert counts["assignments"] == 0, "bereits gespeicherte Zuweisung darf nicht übrig bleiben"
    assert counts["absences"] == 0
    assert counts["people"] == 0


def test_import_save_succeeds_without_injected_fault(client):
    payload = _import_payload([_import_assignment("Tobi")])
    response = client.post("/api/import/save", json=payload)
    assert response.status_code == 200

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["week_plans"] == 1
    assert counts["assignments"] == 1


# ---------- Artist-Plan Save (POST /api/artist-plans) ----------


def _artist_plan_payload() -> dict:
    day_label = "Mo 10.08."
    return {
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "source_filename": "test-artists.xlsx",
        "sheet_name": None,
        "day_labels": [day_label],
        "week_dates_iso": ["2026-08-10"],
        "rows": [{"field_key": "special", day_label: "Inhalt"}],
    }


def test_artist_plan_save_rolls_back_when_entries_insert_fails(client):
    payload = _artist_plan_payload()

    api.app.dependency_overrides[db.get_db_connection] = _failing_db_connection_dependency(
        "INSERT INTO artist_plan_entries"
    )
    try:
        response = client.post("/api/artist-plans", json=payload)
    finally:
        api.app.dependency_overrides.pop(db.get_db_connection, None)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["artist_plans"] == 0, "kein Künstlerplan ohne seine Einträge"
    assert counts["artist_plan_entries"] == 0


def test_artist_plan_save_succeeds_without_injected_fault(client):
    response = client.post("/api/artist-plans", json=_artist_plan_payload())
    assert response.status_code == 200

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["artist_plans"] == 1
    assert counts["artist_plan_entries"] >= 1


# ---------- Probenplan Save (POST /api/rehearsal-plans) ----------


def _rehearsal_plan_payload() -> dict:
    return {
        "start_date": "2026-08-10",
        "end_date": "2026-08-16",
        "source_filename": "test-proben.pdf",
        "rehearsals": [
            {
                "date": "2026-08-10",
                "start_time": "10:00",
                "end_time": "11:00",
                "location": "Bühne",
                "activity": "Probe",
                "participants_raw": "Tobi",
            }
        ],
    }


def test_rehearsal_plan_save_rolls_back_when_rehearsal_insert_fails(client):
    payload = _rehearsal_plan_payload()

    api.app.dependency_overrides[db.get_db_connection] = _failing_db_connection_dependency(
        "INSERT INTO rehearsals"
    )
    try:
        response = client.post("/api/rehearsal-plans", json=payload)
    finally:
        api.app.dependency_overrides.pop(db.get_db_connection, None)
    assert response.status_code == 500

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["rehearsal_plans"] == 0, "kein Probenplan ohne seine Probeneinträge"
    assert counts["rehearsals"] == 0
    assert counts["rehearsal_people"] == 0


def test_rehearsal_plan_save_succeeds_without_injected_fault(client):
    response = client.post("/api/rehearsal-plans", json=_rehearsal_plan_payload())
    assert response.status_code == 200

    conn = db.get_conn()
    try:
        counts = _row_counts(conn)
    finally:
        conn.close()

    assert counts["rehearsal_plans"] == 1
    assert counts["rehearsals"] == 1
