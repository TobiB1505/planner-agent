# AP5a — Alias-Auflösung und wiederholte Personen-Lookups optimieren

Arbeitspaket aus dem Refactoring-Plan: wiederholte SQLite-Einzelabfragen für
Alias-/Personennamen bündeln, ohne bestehende Auflösungslogik oder Ergebnisse
zu verändern. Baut auf AP3 (Indizes, WAL, `busy_timeout`) und AP4 (einmalige
Schema-Init, sauberer Connection-Lifecycle) auf und erhält beides unverändert.
Keine allgemeine `build_memory`-Konsolidierung, kein Request-scoped Memory,
keine Team-Overview-Optimierung — das ist AP5b/AP5c vorbehalten.

Alle Messungen liefen auf Kopien der Live-Datenbank oder auf temporären
Testdatenbanken (`tmp_path`) — nie auf der echten Datei.

---

## Vorher

### Beteiligte Funktionen und Aufrufermatrix

| Funktion | Aufrufer | Query pro Element? | Darf Map erhalten? | Schreibend? |
|---|---|---:|---:|---:|
| `db.find_person_by_alias` | `_resolve_person_id`, `_assignment_warnings` (2×), `_resolve_or_create`, `_resolve_with_choices` | ja (1–2 pro Aufruf) | nein (Low-Level-Primitive, unverändert) | nein |
| `memory._resolve_person_id` | `derive_show_cast` (pro `rehearsal_people`-Zeile) | ja (bis zu 2× `find_person_by_alias`) | ja (neuer optionaler Parameter) | nein |
| `memory.derive_show_cast` | `memory.build_memory` (Aufruf **ohne** neuen Parameter, unverändert) | ja, pro Teilnehmerzeile | ja (neuer optionaler Parameter) | nein |
| `api._assignment_warnings` | `api.plan_save` | ja, pro Zuweisung (Haupt- + BVB-Sonderschleife) + je 1 Abteilungs-Query pro aufgelöster Person | ja (Lookup laden oder vom Aufrufer erhalten) | nein |
| `api._resolve_or_create` | `api.plan_save` (Zuweisungs- und Abwesenheitsschleife) | ja, pro Zeile | ja + muss bei Neuanlage sofort aktualisiert werden | ja (kann `create_person` auslösen) |
| `api._resolve_with_choices` | `api.import_save` | ja, pro Zeile | **außerhalb des AP5a-Scopes** (Ausgangslage nennt nur `plan_save`/`_resolve_or_create`) | ja (`create_person` + `add_alias`) |

`import_save`/`_resolve_with_choices` wurde bewusst **nicht** angefasst — die
Ausgangslage dieses Arbeitspakets benennt explizit nur `derive_show_cast`,
`_assignment_warnings` und `plan_save`/`_resolve_or_create`.

### Bestehende Auflösungssemantik (vor Änderung verifiziert)

- **Reihenfolge:** `find_person_by_alias` prüft zuerst `people_aliases.alias`,
  dann `people.name` — beide mit `COLLATE NOCASE`.
- **Groß-/Kleinschreibung:** SQLites eingebaute `COLLATE NOCASE` faltet laut
  eigener Dokumentation **nur ASCII-Buchstaben** (A-Z/a-z) — kein volles
  Unicode-Case-Folding. Verifiziert an 17 Testpaaren inkl. echter Namen aus der
  Live-DB ("René", "Müller"-Stil, "ß"): Python `str.casefold()`/`str.lower()`
  würden z. B. `"Ü"` und `"ü"` gleichsetzen, SQLite tut das **nicht**. Eine
  eigene ASCII-only-Übersetzungstabelle (`_ASCII_UPPER_TO_LOWER`) repliziert
  SQLites Verhalten exakt (0 Abweichungen in allen Testfällen).
- **Whitespace:** wird von `find_person_by_alias` **nicht** normalisiert -
  führende/nachfolgende Leerzeichen müssen vom Aufrufer bereits entfernt sein
  (z. B. `plan_save` ruft `_resolve_or_create` stets mit bereits
  `.strip()`-ter Person auf). Diese Verantwortung bleibt unverändert bei den
  Aufrufern.
- **Unbekannte Namen:** liefern `None`, ohne Seiteneffekt.
- **Mehrere Alias-Treffer:** `people.name` und `people_aliases.alias` tragen
  case-**sensitive** UNIQUE-Constraints (kein `COLLATE NOCASE` im Spalten-
  Schema) — zwei case-unterschiedliche Aliasse können denselben NOCASE-
  Schlüssel ergeben. In der Live-Datenbank existiert genau ein solcher Fall
  ("Leon Waspo" / "Leon WASPO"), beide zeigen auf dieselbe (soft-gelöschte)
  Person — keine echte Mehrdeutigkeit. Da weder die alte noch die neue
  Implementierung eine explizite `ORDER BY`-Priorität für diesen
  Pathologiefall garantiert (vorher: SQLite-interne Reihenfolge ohne
  `ORDER BY`; nachher: `ORDER BY id` beim Laden), ist dies eine bereits vorher
  underspezifizierte Randbedingung, keine neu eingeführte Abweichung.
- **Automatische Personenerstellung:** `_resolve_or_create` legt eine neue
  Person nur an, wenn `find_person_by_alias` `None` liefert; ruft dabei
  **nie** `add_alias` auf (anders als `_resolve_with_choices`). `create_person`
  filtert seinerseits nicht nach `deleted` beim Existenz-Check.
- **Soft-gelöschte Personen:** `find_person_by_alias` filtert **nicht** nach
  `deleted` — weder in der Alias- noch in der Namensabfrage. 23 von 41
  Personen in der Live-DB sind soft-gelöscht (`deleted=1`); jede korrekte
  Lookup-Nachbildung muss diese also einschließen.

### Query-Anzahlen (Baseline, Kopie der Live-DB)

| Codepfad | Gesamt | Alias-Lookups | Namens-Lookups | Detail-/ID-Lookups | Schreiboperationen | Laufzeit |
|---|---:|---:|---:|---:|---:|---:|
| `derive_show_cast()` (247 Teilnehmerzeilen) | 425 | 345 | 79 | 0 | 0 | 4.0 ms |
| `_assignment_warnings()` (171 Zuweisungen) | 214 | 108 | 0 | 104 | 0 | 2.7 ms |
| `plan_save()` (11 Zeilen, 2 neue Personen) | 65 | 22 | 8 | 8 | 15 | 16.9 ms |
| `find_person_by_alias()` — bekannter Alias | 1 | 1 | 0 | 0 | 0 | — |
| `find_person_by_alias()` — unbekannter Name | 2 | 1 | 1 | 0 | 0 | — |

### Baseline-Testergebnisse (vor AP5a, identisch zum AP4-Endstand)

`pytest`: 65 passed · `npm run build`/`npm run lint`: grün, je eine
vorbestehende, unabhängige Warnung.

---

## Umsetzung

### Lookup-Datenstruktur (`backend/db.py`)

```python
@dataclass(frozen=True)
class PersonLookupEntry:
    person_id: int
    name: str
    department: str | None

@dataclass
class PersonLookup:
    by_alias: dict[str, PersonLookupEntry]
    by_name: dict[str, PersonLookupEntry]

    def resolve(self, value: str) -> PersonLookupEntry | None: ...
    def register_person(self, person_id, name, department=None) -> None: ...
    def register_alias(self, alias, person_id, name, department=None) -> None: ...
```

`resolve()` prüft `by_alias` **vor** `by_name` — exakt dieselbe Reihenfolge
wie `find_person_by_alias`.

### Ladequeries — `db.load_person_lookup(conn)`

Zwei Queries, unabhängig von der Datenmenge:

```sql
SELECT id, name, department FROM people ORDER BY id;
SELECT pa.id AS alias_id, pa.alias, p.id AS person_id, p.name, p.department
FROM people_aliases pa JOIN people p ON p.id = pa.person_id ORDER BY pa.id;
```

Bewusst **ohne** `WHERE deleted = 0` (siehe Auflösungssemantik oben). Keine
eigene Connection, kein Commit, keine Schema-Initialisierung, kein globaler
Cache — die Map lebt ausschließlich innerhalb des aufrufenden Python-Scopes
(eine Funktion, ein Request).

### Normalisierungsstrategie

```python
_ASCII_UPPER_TO_LOWER = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)

def _nocase_fold(value: str) -> str:
    return value.translate(_ASCII_UPPER_TO_LOWER)
```

Dict-Schlüssel sind `_nocase_fold(...)`-normalisiert — **kein** `.strip()`
(Whitespace-Verantwortung bleibt wie bisher beim Aufrufer), **kein** Python
`.casefold()`/`.lower()` (würde nicht-ASCII-Buchstaben mitfalten und damit
SQLites Semantik verändern).

### Anpassung von `derive_show_cast` (`backend/memory.py`)

`_resolve_person_id` und `derive_show_cast` erhalten je einen optionalen
`person_lookup: db.PersonLookup | None = None`-Parameter. Ohne Angabe wird
intern **genau einmal** `db.load_person_lookup(conn)` geladen — der
bestehende Aufrufer `build_memory` (`derive_show_cast(conn)`, ohne neuen
Parameter) profitiert dadurch bereits automatisch, ohne selbst geändert zu
werden. Ergebnisstruktur, Sortierung (`roles`, `unmatched`-Reihenfolge) und
Behandlung unbekannter Teilnehmer bleiben unverändert (verifiziert:
byte-identischer Rückgabewert mit/ohne expliziten Parameter).

### Anpassung von `_assignment_warnings` (`backend/api.py`)

Erhält denselben optionalen `person_lookup`-Parameter, lädt intern einmal,
falls keiner übergeben wird. Beide bisherigen Pro-Zuweisung-Lookups (Haupt-
schleife inkl. der separaten Abteilungs-Query, BVB-Sonderschleife) nutzen jetzt
`lookup.resolve(name)` statt SQL. Warnungstexte, -reihenfolge, Abteilungs-
prüfung und Konfliktlogik unverändert (verifiziert: identische Warnungsliste
mit/ohne expliziten Parameter, inkl. eines Szenarios, das die abteilungs-
abhängige Deko-Warnung tatsächlich auslöst).

### Anpassung von `plan_save`/`_resolve_or_create` (`backend/api.py`)

`plan_save` lädt die Lookup **einmal** vor der Zuweisungs-/Abwesenheits-
schleife und reicht dieselbe Instanz an `_assignment_warnings` **und** an
jeden `_resolve_or_create`-Aufruf weiter. `_resolve_or_create` mit Lookup:

1. `lookup.resolve(name)` — Treffer → `person_id` direkt zurückgeben, keine
   Query.
2. Kein Treffer → `db.create_person(conn, name)` (unverändert) → Ergebnis
   sofort per `lookup.register_person(...)` in dieselbe Map eintragen.

Dadurch findet eine zweite Zeile mit demselben neuen Namen im selben Save die
Person aus der Map, ohne erneute Datenbankabfrage — end-to-end verifiziert:
zwei Zuweisungen mit dem neuen Namen "MessNeuA" erzeugen genau **eine** Zeile
in `people` und teilen sich dieselbe `person_id`.

### Verhalten bei Neuanlagen

- Keine Änderung an der bestehenden Entscheidung, *wann* eine Person angelegt
  wird (weiterhin exakt `create_person`, unverändert).
- Keine Änderung an Alias-Erstellung (`_resolve_or_create` legt weiterhin
  keine Aliasse an — unverändert).
- Keine Änderung an Department-Zuweisung, Commit-/Rollback-Grenzen.
- `register_alias(...)` steht als generische Fähigkeit der `PersonLookup`
  bereit und ist eigenständig getestet (Aktualisierung ohne Neuladen) - wird
  aber (Scope!) an keiner bestehenden Aufrufstelle in dieser Session verdrahtet,
  da `_resolve_or_create` nie Aliasse anlegt und `_resolve_with_choices`
  außerhalb des Scopes liegt.

---

## Nachher

### Query-Anzahlen (identische Szenarien, frische Kopien derselben Live-DB)

| Codepfad | Gesamt vorher → nachher | Alias+Namens-Lookups vorher → nachher | Laufzeit vorher → nachher |
|---|---:|---:|---:|
| `derive_show_cast()` (247 Teilnehmerzeilen) | 425 → **3** | 424 → **1** (klassifiziert) + 1 Personen-Ladequery (unklassifiziert, siehe unten) | 4.0 ms → 1.8 ms |
| `_assignment_warnings()` (171 Zuweisungen) | 214 → **4** | 212 → **1** (klassifiziert) + fixe Restqueries | 2.7 ms → 1.8 ms |
| `plan_save()` (11 Zeilen, 2 neue Personen) | 65 → **31** | 38 → **3** (1 Alias-Query + 2 `create_person`-Existenzchecks für die 2 echten Neuanlagen) | 16.9 ms → 14.8 ms |
| `find_person_by_alias()` — bekannt/unbekannt | 1 / 2 → **unverändert 1 / 2** | — | — |

*Hinweis zur Zählmethode:* `load_person_lookup()`s Personen-Ladequery
(`SELECT id, name, department FROM people ORDER BY id`, ohne `WHERE`-Klausel)
wird vom Mess-Skript nicht in die Alias-/Namens-Buckets einsortiert (die
zählen nur `WHERE alias=?`/`WHERE name=?`-Muster), taucht aber im „Gesamt"
auf. Real sind es **konstant zwei** Ladequeries (Personen + Aliasse) pro
`load_person_lookup()`-Aufruf, unabhängig von der Datenmenge — das ist die
entscheidende, per Test abgesicherte Eigenschaft (siehe unten).

Schreiboperationen bei `plan_save` unverändert: **15 vorher, 15 nachher** —
die Optimierung betrifft ausschließlich den Lesepfad, nicht die
Schreiblogik.

### Erwartung vs. Ergebnis

- `derive_show_cast`: statt ~1,7 Queries pro Teilnehmer → konstant 2
  Ladequeries insgesamt. **Erfüllt.**
- `_assignment_warnings`: keine Alias-/Personenqueries mehr pro Zuweisung →
  konstant 2 Ladequeries insgesamt (plus die bereits vorher pro Aufruf
  einmaligen Proben-Queries). **Erfüllt.**
- `plan_save`: bestehende Personen aus der Map, nur echte Neuanlagen
  brauchen weiterhin Schreibqueries (unverändert 15 Schreibqueries für 2
  echte Neuanlagen + 11 Zuweisungen/Absenzen). **Erfüllt.**

### Query-Count-Regressionstests (`backend/tests/test_person_lookup.py`)

- `test_derive_show_cast_lookup_queries_do_not_grow_with_participant_count`:
  10 vs. 100 synthetische Probenteilnehmer-Zeilen → identische Anzahl
  Alias-/Namens-Lookup-Statements.
- `test_assignment_warnings_lookup_queries_do_not_grow_with_assignment_count`:
  5 vs. 50 synthetische Zuweisungen → identische Anzahl Lookup-Statements.

Beide Tests zählen bewusst nur die relevanten Lookup-Statements (keine feste
Prüfung auf die absolute Gesamtzahl aller SQL-Aufrufe), um nicht fragil auf
unrelated Query-Änderungen zu reagieren.

### Semantische Vergleichstests

8 Tests in `test_person_lookup.py`: bekannte Person über kanonischen Namen,
bekannte Person über Alias mit Groß-/Kleinschreibungsvarianten, Whitespace-
Verhalten unverändert, unbekannter Name (kein ungewollter Anlage-Seiteneffekt),
Personenerstellung im Save (keine Duplikate), Alias-Neuanlage ohne
Neuladen, `derive_show_cast`-Äquivalenz, `_assignment_warnings`-Äquivalenz
(inkl. eines Szenarios mit tatsächlich ausgelöster Warnung).

### Vollständige Testergebnisse

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m compileall backend` | 0 | erfolgreich |
| `pytest` | 0 | **75 passed** (65 vorher + 10 neu), 9 unveränderte unabhängige Warnungen |
| `python -c "from backend.api import app"` | 0 | Import ok, 63 Routen |
| `npm run build` | 0 | erfolgreich, 1 vorbestehende unabhängige Warnung |
| `npm run lint` | 0 | 0 Fehler, 1 vorbestehende Warnung |
| `python -m backend.run_local` (echter Serverstart, isolierter `PLANNER_DATA_DIR`) | — | Start ok; `/api/health`, `/api/team`, `/api/plan/templates`, ein repräsentativer `/api/plan/save` (neue Person, BVB-Warnung korrekt ausgelöst) und erneutes `/api/team` (neue Person sichtbar) — alles wie erwartet, keine Fehler im Log |
| Python-Type-Check | — | kein Type-Checker (mypy/pyright) im Projekt konfiguriert oder installiert — unverändert seit AP4, nicht erfunden |

### Offene Sonderfälle

- `_resolve_with_choices`/`import_save` bleiben unangetastet (außerhalb des
  benannten Scopes) — dieselbe Pro-Zeile-Query-Charakteristik wie vor AP5a.
- Der theoretische Fall zweier case-unterschiedlicher, beide **aktiver**
  Personen mit gleichem NOCASE-Schlüssel ist weiterhin nicht explizit
  geordnet (war es vorher auch nicht) — in der Live-Datenbank aktuell nicht
  vorhanden.
