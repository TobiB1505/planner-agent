"""Sprint 1, Teil 1 - Ressourcen-Leak-Regressionstests.

Realer Vorfall: nach ca. 6,5 Stunden Laufzeit meldete `/api/system/diagnostics`
"disk I/O error". Ursache: `health()` und `system_diagnostics()` öffneten eine
eigene Datenbankverbindung innerhalb eines `try:`-Blocks und schlossen sie erst
als letzte Anweisung IM `try` - ein Datenbankfehler beim `execute()`/`fetchone()`
sprang direkt in den `except`-Block, ohne die Verbindung vorher zu schliessen.
Das System-UI fragt `/api/system/diagnostics` alle 5 Sekunden automatisch ab
(720x/Stunde) - ein einziger transienter Fehler genügte, um eine Verbindung
dauerhaft offen zu lassen, was die Wahrscheinlichkeit für den nächsten Fehler
weiter erhöhte - ein sich selbst verstärkender Kreislauf.

Nach der PostgreSQL-Migration ist dasselbe Muster nicht weniger gefährlich,
sondern gefährlicher: eine nicht zurückgegebene Verbindung belegt dauerhaft
einen der wenigen Pool-Plätze (und damit eine der begrenzten
Supabase-Verbindungen). Die Tests prüfen deshalb unverändert dieselbe Zusage,
nur gegen `db.create_connection()` statt gegen `sqlite3.connect()`.

Analoges Muster (Ressource geöffnet, `close()` nur im Erfolgspfad oder ganz
vergessen) fand sich außerdem in `xlsx_template.generate_week_xlsx()` und
`artist_plan.export_artist_plan()` (openpyxl-Workbooks).

Dieser Test schlägt gegen den unreparierten Code zuverlässig fehl und gegen
den reparierten Code (try/finally um jede Ressourcenöffnung) zuverlässig grün.
"""
from __future__ import annotations

import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend import api, db


# ---------- Schritt 2/4: Verbindungsaufbau in health()/system_diagnostics() ----------


class _FailingConnection:
    """Ersetzt db.create_connection() komplett - jede execute()-Anfrage löst
    einen echten psycopg-Fehler aus, wie es ein realer Datenbankfehler täte.
    close() wird gezählt, um zu beweisen, dass er IMMER aufgerufen wird, auch
    wenn execute() vorher fehlschlägt."""

    def __init__(self, close_counter: dict) -> None:
        self._close_counter = close_counter

    def execute(self, *args, **kwargs):
        raise psycopg.OperationalError("connection failure")

    def close(self) -> None:
        self._close_counter["n"] += 1


@pytest.fixture
def client_with_existing_db(tmp_path, monkeypatch):
    with TestClient(api.app) as c:
        yield c


def _patch_failing_connections(monkeypatch, close_counter, calls):
    def fake_create_connection():
        calls["n"] += 1
        return _FailingConnection(close_counter)

    monkeypatch.setattr(db, "create_connection", fake_create_connection)


def test_health_closes_connection_even_when_query_fails(client_with_existing_db, monkeypatch):
    close_counter = {"n": 0}
    calls = {"n": 0}
    _patch_failing_connections(monkeypatch, close_counter, calls)

    for _ in range(20):
        resp = client_with_existing_db.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["database"] == "error"

    assert calls["n"] == 20
    assert close_counter["n"] == 20, (
        "jede fehlgeschlagene Verbindung muss trotzdem freigegeben werden - "
        "sonst genau der Leak aus dem realen Vorfall, jetzt auf Pool-Plätzen"
    )


def test_system_diagnostics_closes_connection_even_when_query_fails(
    client_with_existing_db, monkeypatch
):
    close_counter = {"n": 0}
    calls = {"n": 0}
    _patch_failing_connections(monkeypatch, close_counter, calls)

    for _ in range(20):
        resp = client_with_existing_db.get("/api/system/diagnostics")
        assert resp.status_code == 200
        assert resp.json()["database"]["status"] == "error"

    assert calls["n"] == 20
    assert close_counter["n"] == 20, (
        "jede fehlgeschlagene Verbindung muss trotzdem freigegeben werden - "
        "sonst genau der Leak aus dem realen Vorfall, jetzt auf Pool-Plätzen"
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

    Unter PostgreSQL ist jede Datenbankverbindung ein echter Socket und damit
    ein FD - der Test misst dadurch jetzt direkt, ob der Pool Verbindungen
    zurücknimmt statt bei jedem Request neue aufzubauen.
    """
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
    with TestClient(api.app) as client:
        for _ in range(5):
            client.get("/api/system/diagnostics")

        before = _count_open_fds()
        if before is None:
            pytest.skip("resource-Modul nicht verfügbar (kein POSIX-System)")

        real_create_connection = db.create_connection
        call_count = {"n": 0}

        def flaky_create_connection(*args, **kwargs):
            call_count["n"] += 1
            # Jeder 3. Aufruf liefert eine Verbindung, deren erste Anfrage
            # fehlschlägt - simuliert einen transienten Datenbankfehler mitten
            # im Dauerbetrieb. Die Verbindung MUSS trotzdem freigegeben werden.
            if call_count["n"] % 3 == 0:
                return _FailingConnection({"n": 0})
            return real_create_connection(*args, **kwargs)

        monkeypatch.setattr(db, "create_connection", flaky_create_connection)
        for _ in range(100):
            client.get("/api/system/diagnostics")

        after = _count_open_fds()

    growth = after - before
    assert growth < 10, (
        f"offene Dateideskriptoren sind um {growth} gewachsen trotz transienter "
        f"Fehler (vorher {before}, nachher {after}) - genau das Muster des realen Vorfalls"
    )
