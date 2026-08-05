"""Tests für AP5a (PersonLookup / gebündelte Alias-Auflösung).

Deckt ab:
  - PersonLookup.resolve() liefert dieselbe Auflösung wie find_person_by_alias()
    (kanonischer Name, Alias, Groß-/Kleinschreibung, unbekannter Name)
  - Personenerstellung im plan_save-Pfad legt keine Duplikate an
  - Alias-Neuanlage in der Lookup-Map wird ohne erneutes Laden gefunden
  - derive_show_cast()/_assignment_warnings() sind mit und ohne vorab geladene
    Lookup ergebnisgleich
  - die Anzahl der Alias-/Personenqueries wächst nicht linear mit der
    Datenmenge (Query-Count-Regressionsschutz)

Immer gegen eine temporäre, per monkeypatch umgeleitete Testdatenbank - nie
gegen die echte lokale Mitarbeiterdatenbank.
"""
from __future__ import annotations

from backend import api, db, memory


def _conn(tmp_path, monkeypatch, filename: str):
    """AP4-Konvention: get_conn() legt kein Schema mehr an, deshalb hier einmalig
    explizit initialize_database() aufrufen."""
    monkeypatch.setattr(db, "DATABASE_PATH", tmp_path / filename)
    monkeypatch.setattr(db, "ensure_runtime_directories", lambda: None)
    db.initialize_database()
    return db.get_conn()


def _count_lookup_statements(conn, fn, *args, **kwargs):
    """Führt fn(*args, **kwargs) aus und zählt dabei ausschließlich Alias-/
    Personennamen-Lookup-Statements (SELECT gegen people_aliases/people) -
    keine feste Prüfung auf die absolute Gesamtzahl aller SQL-Statements."""
    counts = {"alias": 0, "name": 0}

    def trace(sql: str) -> None:
        upper = sql.strip().upper()
        if not upper.startswith("SELECT"):
            return
        if "PEOPLE_ALIASES" in upper:
            counts["alias"] += 1
        elif "FROM PEOPLE" in upper and ("WHERE NAME" in upper or "WHERE ID" in upper):
            counts["name"] += 1

    conn.set_trace_callback(trace)
    try:
        result = fn(*args, **kwargs)
    finally:
        conn.set_trace_callback(None)
    return result, counts


# ---------- Semantische Vergleichstests (Schritt 9) ----------


def test_known_person_resolves_identically_via_canonical_name(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "known-name.db")
    person_id = db.create_person(conn, "Tobi", "Manager")
    conn.commit()

    expected = db.find_person_by_alias(conn, "Tobi")
    lookup = db.load_person_lookup(conn)
    entry = lookup.resolve("Tobi")

    assert entry is not None
    assert entry.person_id == expected == person_id
    assert entry.name == "Tobi"
    assert entry.department == "Manager"


def test_known_person_resolves_identically_via_alias_with_case_variation(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "known-alias.db")
    person_id = db.create_person(conn, "Kilian", "T&C")
    db.add_alias(conn, person_id, "Killian")
    conn.commit()

    for query in ("Killian", "KILLIAN", "killian", "KiLLiAn"):
        expected = db.find_person_by_alias(conn, query)
        entry = db.load_person_lookup(conn).resolve(query)
        assert entry is not None
        assert entry.person_id == expected == person_id


def test_leading_or_trailing_whitespace_behaves_like_before(tmp_path, monkeypatch):
    """Weder find_person_by_alias() noch PersonLookup normalisieren Whitespace -
    das bleibt Aufgabe der jeweiligen Aufrufer (unverändertes Verhalten)."""
    conn = _conn(tmp_path, monkeypatch, "whitespace.db")
    person_id = db.create_person(conn, "Fanny", "Manager")
    conn.commit()

    expected = db.find_person_by_alias(conn, " Fanny ")
    entry = db.load_person_lookup(conn).resolve(" Fanny ")
    assert expected is None
    assert entry is None
    # Ohne Whitespace funktioniert die Auflösung dagegen identisch.
    assert db.load_person_lookup(conn).resolve("Fanny").person_id == person_id


def test_unknown_name_resolves_to_none_without_creating_anyone(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "unknown-name.db")
    db.create_person(conn, "Tobi", "Manager")
    conn.commit()
    people_before = len(db.get_all_people(conn))

    expected = db.find_person_by_alias(conn, "Voellig-Unbekannt-Xyz")
    entry = db.load_person_lookup(conn).resolve("Voellig-Unbekannt-Xyz")

    assert expected is None
    assert entry is None
    assert len(db.get_all_people(conn)) == people_before, (
        "ein reiner Lesevorgang darf niemals eine Person anlegen"
    )


def test_person_creation_within_a_single_save_is_not_duplicated(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "create-once.db")
    lookup = db.load_person_lookup(conn)

    first_id = api._resolve_or_create(conn, "Brandneu", lookup)
    second_id = api._resolve_or_create(conn, "Brandneu", lookup)
    conn.commit()

    assert first_id == second_id
    rows = conn.execute("SELECT id FROM people WHERE name = 'Brandneu'").fetchall()
    assert len(rows) == 1, "keine doppelte Personenerstellung innerhalb desselben Saves"


def test_alias_registration_is_found_without_reloading_the_lookup(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "alias-registration.db")
    person_id = db.create_person(conn, "Selina", "T&C")
    conn.commit()
    lookup = db.load_person_lookup(conn)

    assert lookup.resolve("Celina") is None  # Alias existiert noch nicht

    db.add_alias(conn, person_id, "Celina")
    conn.commit()
    # Ohne register_alias() würde die bereits geladene Map den neuen Alias nicht
    # kennen - genau das testet register_alias().
    lookup.register_alias("Celina", person_id, "Selina", "T&C")

    entry = lookup.resolve("Celina")
    assert entry is not None
    assert entry.person_id == person_id


def test_derive_show_cast_is_equivalent_with_and_without_preloaded_lookup(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "show-cast-equiv.db")
    tobi_id = db.create_person(conn, "Tobi", "Manager")
    db.create_person(conn, "Unresolved", "Sonstiges")
    conn.commit()
    db.upsert_rehearsal_plan(
        conn, "2026-07-27", "2026-08-02", "test.pdf",
        [
            {
                "date": "2026-07-27", "start_time": "20:00", "end_time": "22:00",
                "activity": "Moulin Rouge Show", "show_code": "MR",
                "people": [
                    {"raw_name": "Tobi", "person_name": "Tobi", "role": "cast",
                     "start_time": "20:00", "end_time": "22:00"},
                    {"raw_name": "Nicht-Erfasst", "person_name": None, "role": "cast",
                     "start_time": "20:00", "end_time": "22:00"},
                ],
            },
        ],
    )
    conn.commit()

    cast_default, unmatched_default = memory.derive_show_cast(conn)
    lookup = db.load_person_lookup(conn)
    cast_with_lookup, unmatched_with_lookup = memory.derive_show_cast(conn, lookup)

    assert cast_default.keys() == cast_with_lookup.keys() == {tobi_id}
    for show_key in cast_default[tobi_id]:
        assert cast_default[tobi_id][show_key] == cast_with_lookup[tobi_id][show_key]
    assert unmatched_default == unmatched_with_lookup


def test_assignment_warnings_are_equivalent_with_and_without_preloaded_lookup(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "warnings-equiv.db")
    db.create_person(conn, "Kitti", "Deko")
    conn.commit()
    db.upsert_rehearsal_plan(
        conn, "2026-07-27", "2026-08-02", "test.pdf",
        [
            {
                "date": "2026-07-27", "start_time": "20:00", "end_time": "22:00",
                "activity": "Moulin Rouge Show", "show_code": "MR", "people": [],
            },
        ],
    )
    conn.commit()

    assignments = [
        {"date": "2026-07-27", "category": "Ausschlafen", "subcategory": None,
         "person": "Kitti", "raw_text": None},
    ]

    warnings_default = api._assignment_warnings(conn, assignments, "2026-07-27")
    lookup = db.load_person_lookup(conn)
    warnings_with_lookup = api._assignment_warnings(conn, assignments, "2026-07-27", lookup)

    assert warnings_default == warnings_with_lookup
    assert warnings_default, "Testszenario sollte tatsächlich eine Warnung auslösen"
    assert "Deko" in warnings_default[0] or "Kitti" in warnings_default[0]


# ---------- Query-Count-Regressionstests (Schritt 10) ----------


def test_derive_show_cast_lookup_queries_do_not_grow_with_participant_count(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "show-cast-scale.db")
    names = [f"Person{i}" for i in range(5)]
    for name in names:
        db.create_person(conn, name, "SPT")
    conn.commit()

    def build_and_measure(n_rows: int):
        conn.execute("DELETE FROM rehearsal_people")
        conn.execute("DELETE FROM rehearsals")
        conn.execute("DELETE FROM rehearsal_plans")
        conn.commit()
        rehearsals = [
            {
                "date": f"2026-07-{20 + (i % 7):02d}",
                "start_time": "20:00", "end_time": "22:00",
                "activity": "Moulin Rouge Show", "show_code": "MR",
                "people": [{
                    "raw_name": names[i % len(names)],
                    "person_name": names[i % len(names)],
                    "role": "cast", "start_time": "20:00", "end_time": "22:00",
                }],
            }
            for i in range(n_rows)
        ]
        db.upsert_rehearsal_plan(conn, "2026-07-20", "2026-07-26", "scale-test", rehearsals)
        conn.commit()
        _, counts = _count_lookup_statements(conn, memory.derive_show_cast, conn)
        return counts

    counts_small = build_and_measure(10)
    counts_large = build_and_measure(100)

    small_total = counts_small["alias"] + counts_small["name"]
    large_total = counts_large["alias"] + counts_large["name"]
    assert small_total > 0, "load_person_lookup() muss weiterhin laden"
    assert small_total == large_total, (
        f"Lookup-Queries dürfen nicht mit der Teilnehmerzahl wachsen: "
        f"10 Zeilen -> {small_total}, 100 Zeilen -> {large_total}"
    )


def test_assignment_warnings_lookup_queries_do_not_grow_with_assignment_count(tmp_path, monkeypatch):
    conn = _conn(tmp_path, monkeypatch, "warnings-scale.db")
    names = [f"Person{i}" for i in range(5)]
    for name in names:
        db.create_person(conn, name, "SPT")
    conn.commit()

    def measure(n_assignments: int):
        assignments = [
            {
                "date": "2026-07-27", "category": "OPS + WP", "subcategory": None,
                "person": names[i % len(names)], "raw_text": None,
            }
            for i in range(n_assignments)
        ]
        _, counts = _count_lookup_statements(
            conn, api._assignment_warnings, conn, assignments, "2026-07-27"
        )
        return counts

    counts_small = measure(5)
    counts_large = measure(50)

    small_total = counts_small["alias"] + counts_small["name"]
    large_total = counts_large["alias"] + counts_large["name"]
    assert small_total > 0
    assert small_total == large_total, (
        f"Lookup-Queries dürfen nicht mit der Zuweisungszahl wachsen: "
        f"5 Zuweisungen -> {small_total}, 50 Zuweisungen -> {large_total}"
    )
