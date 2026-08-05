# AP5c — Team-Übersicht mit einmalig berechnetem Memory optimieren

Arbeitspaket aus dem Refactoring-Plan: `build_memory()` innerhalb eines
Team-Overview-Requests höchstens einmal ausführen, statt es pro Person
erneut aufzubauen. Baut auf AP3 (Indizes/WAL), AP4 (Connection-Lifecycle),
AP5a (gebündelte Alias-Lookups) und AP5b (optionale `memory_data`-Parameter
an `memory_for_person`, `entries_for_person`, `calculate_employee_statistics`)
auf und nutzt ausschließlich die dort bereits geschaffenen Parameter — kein
erneutes AP5b-Refactoring, keine neue parallele API.

Alle Messungen/Vergleiche liefen auf Kopien der Live-Datenbank oder auf
temporären Testdatenbanken (`tmp_path`) — nie auf der echten Datei.

---

## Vorher

### Vollständige Aufruferkette

```text
GET /api/intelligence/employees
└── build_team_overview(conn, weeks=12, current_week_start=...)
    ├── db.get_all_people(conn)                     [1 Query, ORDER BY name, WHERE deleted=0]
    └── für jede Person (N mal):
        ├── calculate_employee_statistics(conn, person_id, weeks, current_week_start)
        │     [AP5b-Parameter memory_data existierte, wurde hier vor AP5c NICHT übergeben]
        │   ├── SELECT people WHERE id=?                     [1 Query]
        │   ├── _source_version(conn)                        [5 Queries - COUNT+MAX je Tabelle]  N+1 (nicht Teil dieses Pakets)
        │   ├── SELECT employee_statistics WHERE person_id=?  [1 Query, Cache-Check]
        │   ├── bei Cache-HIT: _current_week_statistics(...)  [4 Queries]                          N+1 (nicht Teil dieses Pakets)
        │   └── bei Cache-MISS: week_rows + assignments (bedingt) + _current_week_statistics [4] +
        │         _manual_skills [1] + memory.memory_for_person(conn, person_id)
        │         → VOLLSTÄNDIGES build_memory() (kein memory_data übergeben)
        ├── memory_engine.entries_for_person(conn, person_id)
        │     [AP5b-Parameter memory_data existierte, wurde hier vor AP5c NICHT übergeben]
        │   ├── _manual_entries(conn, person_id)              [1 Query]                            N+1 (nicht Teil dieses Pakets)
        │   └── memory.memory_for_person(conn, person_id)
        │         → VOLLSTÄNDIGES build_memory() IMMER (kein Cache) (kein memory_data übergeben)
        └── _planning_hint(statistics, top_skills)             [reines Python]
    └── (nach der Schleife) active_rows-Filterung + Summary-Aggregation [reines Python]
```

**Markierung je Helfer:**

| Helfer | braucht Memory? | ruft selbst `build_memory()` auf? | AP5b-Parameter vorhanden? | DB-Vollscan in der Schleife? |
|---|---:|---:|---:|---:|
| `db.get_all_people` | nein | nein | n/a | nein (1× vor der Schleife) |
| `calculate_employee_statistics` | nur bei Cache-Miss | indirekt via `memory_for_person` | ja (AP5b), ungenutzt vor AP5c | `_source_version` (5 Queries/Person) |
| `entries_for_person` | immer | indirekt via `memory_for_person`, kein Cache | ja (AP5b), ungenutzt vor AP5c | `_manual_entries` (1 Query/Person) |
| `_current_week_statistics` | nein | nein | n/a | 4 Queries/Person |
| `_manual_skills` | nein | nein | n/a | 1 Query/Person |

### Personenzahl in der Testdatenbasis

Kopie der Live-DB: **18 aktive (nicht soft-gelöschte) Personen** (`WHERE deleted=0`, wie von `db.get_all_people` gesehen — 41 Personen insgesamt, davon 23 soft-gelöscht).

### Baseline-Messung (erzwungen kalter Statistik-Cache, 3 Wiederholungen auf frischen Kopien)

| Kennzahl | Wert |
|---|---:|
| `build_memory()`-Aufrufe | **36** (18× über `calculate_employee_statistics`, 18× über `entries_for_person`) |
| `memory_for_person()`-Aufrufe | 36 |
| `entries_for_person()`-Aufrufe | 18 |
| `calculate_employee_statistics()`-Aufrufe | 18 |
| `_source_version()`-Aufrufe | 18 |
| `_current_week_statistics()`-Aufrufe | 18 |
| SQL-Statements gesamt | **649** |
| davon `people` | 253 |
| davon `people_aliases` | 36 |
| davon `assignments`/`absences`/`rehearsals`/`rehearsal_people` | je 54 |
| davon `employee_statistics` | 36 |
| davon `week_plans` | 72 |
| Laufzeit (Median, 3 Läufe) | **565.76 ms** |

**Warm-Cache-Lauf** (gleiche DB, zweiter Aufruf direkt danach): `build_memory()` = 18 (nur noch über `entries_for_person`, Statistik-Cache trifft), SQL gesamt = 379, Laufzeit = 280.39 ms.

### Response-Snapshot (vorher)

`GET /api/intelligence/employees?current_week_start=2026-07-27` auf derselben DB-Kopie: 18 Personen, Status 200, vollständige `summary`- und `people`-Struktur — als Referenz für den Nachher-Vergleich gespeichert.

### Test-Baseline

`pytest`: 90 passed (Stand nach AP5b) · `npm run build`/`npm run lint`: grün.

---

## Umsetzung

### Ort des einmaligen Memory-Aufbaus

`backend/intelligence/team_overview.py`, Funktion `build_team_overview`:

```python
people = db.get_all_people(conn)
memory_data = memory.build_memory(conn) if people else None
for person in people:
    statistics = employee_stats.calculate_employee_statistics(
        conn, person["id"], weeks=weeks, current_week_start=current_start,
        memory_data=memory_data,
    )
    memory_entries = memory_engine.entries_for_person(
        conn, person["id"], memory_data=memory_data
    )
    ...
```

### Weitergereichte Parameter

Ausschließlich die in **AP5b bereits eingeführten** optionalen, keyword-only
Parameter `memory_data` an `calculate_employee_statistics` und
`entries_for_person` — keine neue Funktion, keine parallele API, keine
Änderung an deren Signaturen oder Fallback-Verhalten außerhalb dieses
Aufrufers.

### Behandlung von Cache-Hits

Unverändert: `calculate_employee_statistics` erreicht den
`memory.memory_for_person(...)`-Aufruf ausschließlich auf dem
Cache-Miss-Pfad. Das vorab übergebene `memory_data` wird bei einem
Cache-Hit schlicht nicht referenziert — kein zusätzlicher Aufwand, keine
Änderung an Cache-Key, `data_version`, `_source_version` oder
Invalidierungslogik. Bestätigt durch identische
`employee_statistics`-Zugriffszahlen vor/nach der Änderung (36 vorher, 36
nachher — siehe „Nachher").

### Fehlergrenzen

`build_team_overview` besaß **vor** dieser Änderung keine
personenbezogene `try/except`-Isolation — eine Exception in
`calculate_employee_statistics` oder `entries_for_person` für eine
beliebige Person ließ den gesamten Request bereits vorher fehlschlagen.
Der zentrale `build_memory()`-Aufruf verschiebt diesen Fehlerpunkt
lediglich zeitlich nach vorne (vor die Schleife statt beim ersten
Personendurchlauf), ändert aber nichts an der Tatsache, dass ein Fehler
den gesamten Request beendet — bestätigt durch
`test_team_overview_propagates_person_errors_like_before`.

### Bewusst nicht optimierte N+1-Pfade (Schritt 11, dokumentiert statt behoben)

- `_source_version(conn)` — 5 Queries **pro Person** (COUNT+MAX über 5
  Tabellen), obwohl das Ergebnis für alle Personen im selben Request
  identisch ist.
- `_current_week_statistics(conn, person, ...)` — 4 Queries **pro
  Person**, läuft immer (Cache-Hit und -Miss), da `current_week_start`
  in `build_team_overview` nie `None` ist.
- `_manual_skills`/`_manual_entries` — je 1 Query **pro Person**
  (`employee_skills`/`employee_memory`), fachlich pro Person
  unterschiedlich, aber ebenfalls N+1 im aggregierten Sinn.

Diese drei Punkte sind **nicht** Teil des AP5c-Scopes („Dieses Paket
behandelt ausschließlich den Memory-Vollscan") und wurden nicht
angefasst — als Folgepaket dokumentiert.

---

## Nachher

### Call-Counts und Query-Counts (identisches Szenario, erzwungen kalter Cache)

| Kennzahl | Vorher | Nachher |
|---|---:|---:|
| `build_memory()`-Aufrufe | 36 | **1** |
| `memory_for_person()`-Aufrufe | 36 | 36 (unverändert — jeder holt sich jetzt aber dieselbe Instanz statt neu zu bauen) |
| SQL-Statements gesamt | 649 | **334** |
| davon `people` | 253 | 78 |
| davon `people_aliases` | 36 | 1 |
| davon `employee_statistics` | 36 | 36 (unverändert) |
| Laufzeit (Median, 3 Läufe, Cold Cache) | 565.76 ms | **32.38 ms** |
| Laufzeit (Warm Cache) | 280.39 ms | **20.30 ms** |

**Absolute Reduktion:** −35 `build_memory()`-Aufrufe, −315 SQL-Statements,
−533.4 ms (Cold Cache). **Prozentuale Reduktion:** `build_memory()` −97 %,
SQL gesamt −51 %, Laufzeit Cold Cache −94 %, Laufzeit Warm Cache −93 %.

**Verbleibende größte Query-Gruppen (nachher):** `week_plans` (92),
`people` (78), `assignments` (73) — überwiegend die dokumentierten,
bewusst nicht behobenen N+1-Pfade (`_source_version`,
`_current_week_statistics`).

### Response-Snapshot (Schritt 7)

`GET /api/intelligence/employees?current_week_start=2026-07-27`, identische
DB-Kopie, Vergleich via `git stash` (echter Vorher/Nachher-Codezustand):
**Status 200 in beiden Fällen, `summary` identisch, `people`-Liste
inklusive Reihenfolge, IDs, Statistikfeldern und Memory-Feldern
byte-identisch.** Keine Abweichung zu dokumentieren.

### Vollständige Testergebnisse

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m compileall backend` | 0 | erfolgreich |
| `pytest` | 0 | **95 passed** (90 vorher + 5 neu), 9 unveränderte unabhängige Warnungen |
| `python -c "from backend.api import app"` | 0 | Import ok, 63 Routen |
| `npm run build` | 0 | erfolgreich, 1 vorbestehende unabhängige Warnung |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende Warnung |
| `python -m backend.run_local` + 3× `GET /api/intelligence/employees` + Personenanlage | — | Start ok, alle Requests HTTP 200, keine Fehler im Log |
| Python-Type-Check | — | kein Type-Checker im Projekt vorhanden (unverändert seit AP4) |

### Verbleibende Engpässe

Siehe „Bewusst nicht optimierte N+1-Pfade" oben — `_source_version`,
`_current_week_statistics`, `_manual_skills`/`_manual_entries` bleiben
lineare Pro-Person-Kosten und sind als Folgepaket zu behandeln, sollten sie
bei wachsender Personenzahl relevant werden.
