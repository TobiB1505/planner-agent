"""Case-insensitive Personen-/Alias-Auflösung (Sprint-Punkt 11).

Unter SQLite lief die Auflösung über `COLLATE NOCASE`. Diese Kollation faltet
laut SQLite-Dokumentation ausschließlich ASCII A-Z - NICHT das volle Unicode.
PostgreSQLs `lower()` faltet dagegen auch 'É' zu 'é'. Ein naives `lower()`
hätte die Auflösung also stillschweigend WEITER gemacht als vorher und Namen
zusammengeführt, die die alte Implementierung getrennt gehalten hat.

Die Migration bildet die SQLite-Semantik deshalb exakt über `planner_nocase()`
nach (siehe backend/migrations/001_initial_postgres.sql). Diese Tests fixieren
genau diese Semantik - inklusive der Fälle, die bewusst NICHT treffen dürfen -
und stellen sicher, dass die SQL-Seite und das In-Memory-Pendant
`db._nocase_fold()` (PersonLookup, AP5a) deckungsgleich bleiben.

Die erwarteten Werte in ASCII_FOLDING_CASES / NON_ASCII_CASES wurden gegen eine
echte SQLite-Datenbank mit `COLLATE NOCASE` verifiziert.
"""
from __future__ import annotations

import pytest

from backend import db

#: (gespeicherter Name, Suchbegriff) - Paare, die unter SQLites NOCASE treffen.
ASCII_FOLDING_CASES = [
    ("Tobi", "Tobi"),
    ("Tobi", "TOBI"),
    ("Tobi", "tobi"),
    ("Tobi", "ToBi"),
    ("TOBI", "tobi"),
]

#: Paare, die unter SQLites NOCASE NICHT treffen, weil der Unterschied in einem
#: Nicht-ASCII-Zeichen liegt. Verifiziert gegen echtes SQLite.
NON_ASCII_CASES = [
    ("René", "RENÉ"),   # É wird von NOCASE nicht gefaltet
    ("Müller", "MÜLLER"),
    ("Straße", "STRASSE"),  # ß != ss, anders als bei Python casefold()
]

#: Paare, die trotz Nicht-ASCII-Zeichen treffen, weil sich nur ASCII-Buchstaben
#: unterscheiden.
MIXED_CASES = [
    ("René", "rené"),
    ("René", "RENé"),
    ("Müller", "müller"),
]


@pytest.mark.parametrize(("stored", "probe"), ASCII_FOLDING_CASES)
def test_person_name_lookup_folds_ascii_case(test_conn, stored, probe):
    person_id = db.create_person(test_conn, stored)
    test_conn.commit()
    assert db.find_person_by_alias(test_conn, probe) == person_id


@pytest.mark.parametrize(("stored", "probe"), MIXED_CASES)
def test_person_name_lookup_folds_ascii_even_in_names_with_umlauts(test_conn, stored, probe):
    person_id = db.create_person(test_conn, stored)
    test_conn.commit()
    assert db.find_person_by_alias(test_conn, probe) == person_id


@pytest.mark.parametrize(("stored", "probe"), NON_ASCII_CASES)
def test_person_name_lookup_does_not_fold_non_ascii(test_conn, stored, probe):
    """Bewusst KEIN Treffer - genau wie unter SQLites COLLATE NOCASE.

    Würde hier ein Treffer entstehen, wäre die Personenauflösung nach der
    Migration weiter als vorher; zwei bislang getrennte Mitarbeiter könnten
    dadurch zusammenfallen.
    """
    db.create_person(test_conn, stored)
    test_conn.commit()
    assert db.find_person_by_alias(test_conn, probe) is None


@pytest.mark.parametrize(("stored", "probe"), ASCII_FOLDING_CASES + MIXED_CASES)
def test_alias_lookup_folds_the_same_way_as_name_lookup(test_conn, stored, probe):
    person_id = db.create_person(test_conn, "Kanonischer Name")
    db.add_alias(test_conn, person_id, stored)
    test_conn.commit()
    assert db.find_person_by_alias(test_conn, probe) == person_id


@pytest.mark.parametrize(
    ("stored", "probe"),
    ASCII_FOLDING_CASES + MIXED_CASES + NON_ASCII_CASES,
)
def test_sql_and_in_memory_lookup_agree(test_conn, stored, probe):
    """SQL-Weg (find_person_by_alias) und In-Memory-Weg (PersonLookup) müssen
    dieselbe Entscheidung treffen - sonst hängt das Ergebnis davon ab, ob ein
    Aufrufer zufällig eine vorab geladene Lookup übergibt."""
    db.create_person(test_conn, stored)
    test_conn.commit()

    via_sql = db.find_person_by_alias(test_conn, probe)
    lookup = db.load_person_lookup(test_conn)
    entry = lookup.resolve(probe)
    via_memory = entry.person_id if entry else None

    assert via_sql == via_memory


def test_create_person_reactivates_a_soft_deleted_person_case_insensitively(test_conn):
    """create_person() nutzt dieselbe Faltung - eine soft-gelöschte Person darf
    nicht als Dublette mit abweichender Schreibweise neu entstehen."""
    person_id = db.create_person(test_conn, "Tobi", "Manager")
    db.delete_person(test_conn, person_id)
    test_conn.commit()

    reactivated = db.create_person(test_conn, "TOBI", "Deko")
    test_conn.commit()

    assert reactivated == person_id
    people = db.get_all_people(test_conn)
    assert len(people) == 1
    assert people[0]["department"] == "Deko"
    assert people[0]["deleted"] == 0


def test_unique_constraint_stays_case_sensitive(test_conn):
    """Wichtig: der UNIQUE-Constraint auf people.name war und bleibt
    case-SENSITIV. Nur die Suche faltet - das Anlegen nicht. Sonst würde die
    Migration eine bislang erlaubte Datenlage plötzlich verbieten."""
    db.create_person(test_conn, "Tobi")
    test_conn.commit()

    # Über create_person() greift die case-insensitive Suche und liefert die
    # bestehende Person zurück (unverändertes Verhalten) ...
    assert db.find_person_by_alias(test_conn, "TOBI") is not None

    # ... aber der Constraint selbst erlaubt beide Schreibweisen nebeneinander,
    # genau wie das SQLite-Schema es tat.
    test_conn.execute(
        "INSERT INTO people (name, active, deleted) VALUES (%s, 1, 0)", ("TOBI",)
    )
    test_conn.commit()
    names = {row["name"] for row in db.get_all_people(test_conn)}
    assert names == {"Tobi", "TOBI"}


def test_nocase_index_is_used_for_alias_lookup(test_conn):
    """Der funktionale Index muss auch wirklich greifen.

    Unter SQLite gab es dafür eigens idx_people_aliases_alias_nocase (AP3),
    weil der case-sensitive UNIQUE-Index für eine NOCASE-Suche nicht nutzbar
    war. Dasselbe gilt hier - ohne den funktionalen Index auf
    planner_nocase(alias) hätte die Anfrage gar keine andere Wahl als einen
    Seq Scan.

    Geprüft wird die Nutzbarkeit des Index, nicht die Kostenentscheidung des
    Planners: bei einer Testtabelle, die in eine einzige Seite passt, ist ein
    Seq Scan schlicht billiger und wird zu Recht gewählt. `enable_seqscan =
    off` nimmt dem Planner diese Abkürzung - bleibt es dann trotzdem beim Seq
    Scan, ist der Index für diesen Ausdruck nicht verwendbar, und die Abfrage
    würde in Produktion mit wachsender Aliasliste linear langsamer.
    """
    person_id = db.create_person(test_conn, "Indexpruefung")
    for index in range(60):
        db.add_alias(test_conn, person_id, f"Alias-{index}")
    test_conn.commit()
    test_conn.execute("ANALYZE people_aliases")
    test_conn.execute("SET LOCAL enable_seqscan = off")

    plan = "\n".join(
        row["QUERY PLAN"]
        for row in test_conn.execute(
            "EXPLAIN SELECT person_id FROM people_aliases "
            "WHERE planner_nocase(alias) = planner_nocase(%s)",
            ("alias-7",),
        ).fetchall()
    )
    assert "idx_people_aliases_alias_nocase" in plan, plan
