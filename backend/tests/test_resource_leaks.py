"""Sprint 1, Teil 1 - Ressourcen-Leak-Regressionstests.

Realer Vorfall: nach ca. 6,5 Stunden Laufzeit meldete `/api/system/diagnostics`
"disk I/O error". Ursache: `health()` und `system_diagnostics()` öffneten eine
eigene `sqlite3.connect()`-Verbindung innerhalb eines `try:`-Blocks und
schlossen sie erst als letzte Anweisung IM `try` - ein `sqlite3.Error` beim
`execute()`/`fetchone()` sprang direkt in den `except`-Block, ohne die
Verbindung vorher zu schliessen. Das System-UI fragt `/api/system/diagnostics`
alle 5 Sekunden automatisch ab (720x/Stunde) - ein einziger transienter
SQLite-Fehler genügte, um eine Verbindung dauerhaft offen zu lassen, was die
Wahrscheinlichkeit für den nächsten Fehler weiter erhöhte (mehr offene Handles
auf dieselbe WAL-Datei) - ein sich selbst verstärkender Kreislauf.

Analoges Muster (Ressource geöffnet, `close()` nur im Erfolgspfad oder ganz
vergessen) fand sich außerdem in `xlsx_template.generate_week_xlsx()` und
`artist_plan.export_artist_plan()` (openpyxl-Workbooks).

Dieser Test schlägt gegen den unreparierten Code zuverlässig fehl und gegen
den reparierten Code (try/finally um jede Ressourcenöffnung) zuverlässig grün.
"""
from __future__ import annotations

import os
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend import api, db


# ---------- Schritt 2/4: sqlite3.connect() in health()/system_diagnostics() ----------


class _FailingConnection:
    """Ersetzt sqlite3.connect() komplett - jede execute()/fetchone()-Anfrage
    löst einen echten sqlite3.Error aus, wie es ein realer disk-I/O-Fehler
    täte. close() wird gezählt, um zu beweisen, dass er IMMER aufgerufen wird,
    auch wenn execute() vorher fehlschlägt."""

    def __init__(self, close_counter: dict) -> None:
        self._close_counter = close_counter

    def execute(self, *args, **kwargs):
        raise sqlite3.OperationalError("disk I/O error")

    def close(self) -> None:
        self._close_counter["n"] += 1


@pytest.fixture
def client_with_existing_db(tmp_path, monkeypatch):
    database_path = tmp_path / "planner-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    with TestClient(api.app) as c:
        # Datei muss existieren, damit health()/system_diagnostics() den
        # sqlite3.connect()-Zweig überhaupt betreten (DATABASE_PATH.exists()).
        yield c


def test_health_closes_connection_even_when_query_fails(client_with_existing_db, monkeypatch):
    close_counter = {"n": 0}
    calls = {"n": 0}

    def fake_connect(*args, **kwargs):
        calls["n"] += 1
        return _FailingConnection(close_counter)

    monkeypatch.setattr(sqlite3, "connect", fake_connect)

    for _ in range(20):
        resp = client_with_existing_db.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["database"] == "error"

    assert calls["n"] == 20
    assert close_counter["n"] == 20, (
        "jede fehlgeschlagene Verbindung muss trotzdem geschlossen werden - "
        "sonst genau der Leak aus dem realen Vorfall"
    )


def test_system_diagnostics_closes_connection_even_when_query_fails(
    client_with_existing_db, monkeypatch
):
    close_counter = {"n": 0}
    calls = {"n": 0}

    def fake_connect(*args, **kwargs):
        calls["n"] += 1
        return _FailingConnection(close_counter)

    monkeypatch.setattr(sqlite3, "connect", fake_connect)

    for _ in range(20):
        resp = client_with_existing_db.get("/api/system/diagnostics")
        assert resp.status_code == 200
        assert resp.json()["database"]["status"] == "error"

    assert calls["n"] == 20
    assert close_counter["n"] == 20, (
        "jede fehlgeschlagene Verbindung muss trotzdem geschlossen werden - "
        "sonst genau der Leak aus dem realen Vorfall"
    )


# ---------- Schritt 4: openpyxl-Workbooks in Export-Pfaden ----------


def test_generate_week_xlsx_closes_workbook_even_on_error(tmp_path, monkeypatch):
    from backend import xlsx_template
    from backend.config import paths as config_paths

    real_load_workbook = xlsx_template.openpyxl.load_workbook
    closed = {"n": 0}

    def spy_load_workbook(*args, **kwargs):
        wb = real_load_workbook(*args, **kwargs)
        real_close = wb.close

        def spy_close():
            closed["n"] += 1
            real_close()

        wb.close = spy_close
        return wb

    monkeypatch.setattr(xlsx_template.openpyxl, "load_workbook", spy_load_workbook)

    out_path = str(tmp_path / "out.xlsx")
    with pytest.raises(Exception):
        # sheet_name existiert nicht in der echten Vorlage -> KeyError beim
        # Zugriff auf wb[sheet_name], deutlich nach dem load_workbook()-Aufruf.
        xlsx_template.generate_week_xlsx(
            str(config_paths.WEEK_A_TEMPLATE_PATH),
            "Dieses-Blatt-gibt-es-nicht",
            __import__("datetime").date(2026, 8, 10),
            [], [], out_path,
        )

    assert closed["n"] == 1, "Workbook muss auch bei einer Exception geschlossen werden"


def test_export_artist_plan_closes_workbook_even_on_error(monkeypatch):
    from backend import artist_plan
    from backend.config import paths as config_paths

    real_load_workbook = artist_plan.load_workbook
    closed = {"n": 0}

    def spy_load_workbook(*args, **kwargs):
        wb = real_load_workbook(*args, **kwargs)
        real_close = wb.close

        def spy_close():
            closed["n"] += 1
            real_close()

        wb.close = spy_close
        return wb

    monkeypatch.setattr(artist_plan, "load_workbook", spy_load_workbook)

    # Ungültiges start_date -> ValueError in datetime.strptime, deutlich nach
    # dem load_workbook()-Aufruf und vor jeder DB-Nutzung.
    plan_row = {"sheet_name": "nicht-vorhanden", "start_date": "kein-datum", "id": 1}
    with pytest.raises(ValueError):
        artist_plan.export_artist_plan(
            None, plan_row, str(config_paths.ARTIST_TEMPLATE_PATH), "/dev/null",
        )

    assert closed["n"] == 1, "Workbook muss auch bei einer Exception geschlossen werden"


# ---------- Schritt 3: allgemeines FD-Monitoring über viele echte Requests ----------


def _count_open_fds() -> int | None:
    """Portable, dependency-freie FD-Zählung über fstat-Sondierung (POSIX).

    Kein /proc auf macOS, kein psutil als Abhängigkeit vorhanden - deshalb die
    klassische Technik: jeden FD bis zum Soft-Limit per fstat() prüfen. Gibt
    None zurück (statt zu failen), wenn das `resource`-Modul fehlt (Windows) -
    plattformspezifischer Unterschied, hier dokumentiert statt getestet.
    """
    try:
        import resource
    except ImportError:
        return None
    soft_limit, _ = resource.getrlimit(resource.RLIMIT_NOFILE)
    count = 0
    for fd in range(min(soft_limit, 4096)):
        try:
            os.fstat(fd)
        except OSError:
            continue
        count += 1
    return count


def test_fd_count_stable_after_many_requests(tmp_path, monkeypatch):
    """Reproduziert Schritt 3: App starten, FD-Zahl messen, viele Requests
    gegen genau die Endpunkte, die im realen Vorfall automatisch gepollt
    wurden (health/diagnostics), plus reguläre DB-Endpunkte, erneut messen.

    Erwartung: kein kontinuierliches Wachstum. Ein kleiner, konstanter Sockel
    (z.B. durch TestClient-interne Verbindungen) ist zulässig - entscheidend
    ist, dass er nach vielen Requests nicht mit der Request-Zahl mitwächst.
    """
    database_path = tmp_path / "planner-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)

    with TestClient(api.app) as client:
        # Aufwärmen: erste Requests initialisieren ggf. noch Caches/Module-Importe,
        # die selbst (einmalig, nicht pro Request) FDs öffnen - vor der Messung
        # ausführen, damit sie das Ergebnis nicht verfälschen.
        for _ in range(5):
            client.get("/api/health")

        before = _count_open_fds()
        if before is None:
            pytest.skip("resource-Modul nicht verfügbar (kein POSIX-System)")

        for i in range(200):
            client.get("/api/health")
            client.get("/api/system/diagnostics")
            if i % 10 == 0:
                client.get("/api/team")
                client.get("/api/weeks")

        after = _count_open_fds()

    growth = after - before
    assert growth < 10, (
        f"offene Dateideskriptoren sind um {growth} gewachsen nach 200+ Requests "
        f"(vorher {before}, nachher {after}) - deutet auf einen Leak hin"
    )


def test_repeated_diagnostics_requests_do_not_grow_fds_even_with_transient_errors(
    tmp_path, monkeypatch
):
    """Kombiniert beide Aspekte: echte FD-Zählung UND ein Teil der Requests
    schlägt absichtlich fehl (wie beim realen disk-I/O-Fehler) - genau das
    Szenario, das den Vorfall auslöste."""
    database_path = tmp_path / "planner-test.db"
    monkeypatch.setattr(db, "DATABASE_PATH", database_path)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)

    with TestClient(api.app) as client:
        for _ in range(5):
            client.get("/api/system/diagnostics")

        before = _count_open_fds()
        if before is None:
            pytest.skip("resource-Modul nicht verfügbar (kein POSIX-System)")

        real_connect = sqlite3.connect
        call_count = {"n": 0}

        def flaky_connect(*args, **kwargs):
            call_count["n"] += 1
            # Jeder 3. Aufruf schlägt fehl - simuliert einen transienten
            # disk-I/O-Fehler mitten im Dauerbetrieb.
            if call_count["n"] % 3 == 0:
                raise sqlite3.OperationalError("disk I/O error")
            return real_connect(*args, **kwargs)

        monkeypatch.setattr(sqlite3, "connect", flaky_connect)
        for _ in range(100):
            client.get("/api/system/diagnostics")

        after = _count_open_fds()

    growth = after - before
    assert growth < 10, (
        f"offene Dateideskriptoren sind um {growth} gewachsen trotz transienter "
        f"Fehler (vorher {before}, nachher {after}) - genau das Muster des realen Vorfalls"
    )
