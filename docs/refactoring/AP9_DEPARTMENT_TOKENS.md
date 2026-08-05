# AP9 — Abteilungs-Token zentralisieren

Reines Refactoring: drei bislang unabhängig gepflegte Token-Listen
(`api.py::KNOWN_DEPARTMENT_TOKENS`, `grid.py::NON_PERSON_ASSIGNMENT_VALUES`,
`xlsx_template.py::DEPARTMENT_TOKENS`) wurden auf eine einzige, zentrale
Quelle in `backend/template_spec.py` zurückgeführt. Keine Fachlogik, keine
API-Verträge, keine Datenbank, kein Frontend geändert.

Alle Verifikationen liefen gegen isolierte Testdatenbanken (`tmp_path`); die
lokale Entwicklungsdatenbank blieb MD5-identisch unverändert.

---

## Vorher

### Alle Token-Listen (Schritt 1)

| Datei | Variable | Werte | Verwendung |
|---|---|---|---|
| `api.py:67` | `KNOWN_DEPARTMENT_TOKENS` | 15: S&L, SPT, NM, KÜCHE, COCINA, TC, DEKO, LIVE-ENT, SPORTSTAINER, MANAGER, REQUI, WASPO, FO, WFA, SPA | `GET /api/known-department-tokens` (Response!), `_archived_assignment_for_grid` (`raw_text.upper() in ...`) |
| `grid.py:77` | `NON_PERSON_ASSIGNMENT_VALUES` | 19: dieselben 15 + `-`, `KEINE`, `KEIN`, `NIEMAND` | `is_non_person_assignment_value()` (`.strip().upper()`), 2× in `parse_grid()` |
| `xlsx_template.py:26` | `DEPARTMENT_TOKENS` | 15, identisch zu `api.py` | `_is_department_value()` (`.strip().upper()`), in `_split_people()` |

### Vergleich (Schritt 2)

Die drei Mengen waren zum Zeitpunkt dieser Analyse **bereits wertgleich** —
noch kein tatsächlicher Drift eingetreten:
- `api.py`s 15 Tokens == `xlsx_template.py`s 15 Tokens (identische Sets, nur
  andere Einfügereihenfolge im Quellcode).
- `grid.py`s 19 Werte = dieselben 15 Department-Tokens **plus** 4 fachlich
  andersartige „keine Zuweisung"-Marker (`-`, `KEINE`, `KEIN`, `NIEMAND`).

**Drift-Risiko**: bestand dennoch strukturell — drei unabhängige
Quellcode-Stellen, die bei jeder künftigen Änderung (neues Department, siehe
Aufgabenbeispiel WFA/SPA/FO/WASPO) manuell synchron gehalten werden müssten.
`api.py`s Normalisierung (`raw_text.upper()`, ohne eigenes `.strip()`) war
zudem nur deshalb verhaltensgleich zu den anderen beiden (`.strip().upper()`),
weil `raw_text` an der Aufrufstelle bereits vorher gestrippt wurde — eine
leicht übersehbare, nicht offensichtliche Abhängigkeit zwischen zwei
Codezeilen.

---

## Umsetzung

### Zentrale Quelle: `backend/template_spec.py`

Direkt nach `department_labels()` platziert (thematisch am nächsten, ohne die
dortige fachliche Bedeutung von „department" bei `ROWS`/`department_labels()`
— das sind Planzeilen-Kategorien wie „Abbauhilfe" — mit den hier neuen
Zellwert-Kurzcodes zu vermischen):

```python
DEPARTMENT_TOKENS: frozenset[str] = frozenset({
    "S&L", "SPT", "NM", "KÜCHE", "COCINA", "TC", "DEKO", "LIVE-ENT",
    "SPORTSTAINER", "MANAGER", "REQUI", "WASPO", "FO", "WFA", "SPA",
})
SPECIAL_ASSIGNMENT_TOKENS: frozenset[str] = frozenset({"-", "KEINE", "KEIN", "NIEMAND"})
NON_PERSON_ASSIGNMENT_TOKENS: frozenset[str] = DEPARTMENT_TOKENS | SPECIAL_ASSIGNMENT_TOKENS
```

Getrennt gehalten statt in eine Liste geworfen (Schritt 3-Vorgabe), da
`DEPARTMENT_TOKENS` und `SPECIAL_ASSIGNMENT_TOKENS` fachlich unterschiedliche
Bedeutungen haben (echte Abteilungs-/Rollen-Kurzcodes vs. „keine Zuweisung"-
Marker) — nur `grid.py` braucht die kombinierte Menge.
`template_spec.py` hat weiterhin keine Imports (`from __future__ import
annotations` ausgenommen) — keine DB-/API-Abhängigkeit, keine Seiteneffekte,
keine Imports nach oben.

### Normalisierung erhalten (Schritt 4)

Keine der drei Aufrufstellen wurde in ihrer Normalisierung verändert:
`grid.py`/`xlsx_template.py` behalten `.strip().upper()`, `api.py` behält
sein bloßes `.upper()` (weiterhin verhaltensgleich, da `raw_text` dort schon
vorher gestrippt wird). Kein neuer gemeinsamer Helper (`is_department_token`)
eingeführt — die drei Aufrufstellen sind zu unterschiedlich (Instanzmethode
vs. freie Funktion, teils mit zusätzlicher Sonderwert-Prüfung), ein Helper
hätte keine echte Duplikation entfernt, sondern nur eine neue Indirektion
hinzugefügt.

### Umgestellte Module

- **`api.py`** (Schritt 5): `KNOWN_DEPARTMENT_TOKENS` entfernt, beide
  Aufrufstellen (`/api/known-department-tokens`, `_archived_assignment_for_grid`)
  nutzen jetzt `template_spec.DEPARTMENT_TOKENS` (Modul war bereits
  importiert). Keine weitere Bereinigung — die separate inline
  `{"-", "keine", "kein", "niemand"}`-Prüfung in derselben Funktion (Zeile
  863) blieb unangetastet, wie in der Aufgabenstellung für dieses Paket
  vorgesehen.
- **`grid.py`** (Schritt 6): `NON_PERSON_ASSIGNMENT_VALUES` ist jetzt ein
  direkter Alias auf `template_spec.NON_PERSON_ASSIGNMENT_TOKENS` (identische
  kombinierte Menge, kein eigener Literal-Wert mehr). `parse_grid()`/
  `build_grid()` unverändert.
- **`xlsx_template.py`** (Schritt 7): `DEPARTMENT_TOKENS` ist jetzt ein
  direkter Alias auf `template_spec.DEPARTMENT_TOKENS`. Keine Reihenfolge
  nötig (reine Mengenzugehörigkeitsprüfung), daher kein
  `DEPARTMENT_TOKEN_ORDER`-Tupel eingeführt.

### Import-Zyklen (Schritt 8)

```bash
python -c "import backend.api"            # ok
python -c "import backend.grid"           # ok
python -c "import backend.xlsx_template"  # ok
python -c "import backend.template_spec"  # ok
```

Keine Zyklen, keine Seiteneffekte, keine DB-Verbindung beim Import
(`template_spec.py` bleibt frei von Imports; die drei umgestellten Module
importierten `template_spec` bereits vorher für andere Zwecke).

---

## Nachher

### Tests

Neue Datei
[backend/tests/test_department_tokens.py](../../backend/tests/test_department_tokens.py)
(83 Tests, überwiegend parametrisiert über alle 15 Tokens):
- Token-Erkennung (alle bekannten Tokens, in `grid.py` **und**
  `xlsx_template.py` identisch erkannt).
- Case-Verhalten (Original-, Klein-, gemischte Schreibweise, Leerzeichen) —
  nur das bereits vorher funktionierende Verhalten geprüft, nichts verbessert.
- Grid-Parsing: `parse_grid()` mit einem echten Department-Token in einer
  Personen-Zelle (Kategorie „Tagesverantwortung") liefert `person: None`,
  `raw_text` bleibt erhalten — keine neue Person, kein Alias.
- XLSX-Import: `_split_people()` schließt Department-Tokens weiterhin aus.
- Drift-Schutz: ein Test scannt `api.py`/`grid.py`/`xlsx_template.py` nach
  erneuten lokalen Token-Mengen-Definitionen und schlägt fehl, falls eine
  auftaucht — **verifiziert**, indem testweise `KNOWN_DEPARTMENT_TOKENS`
  wieder in `api.py` eingefügt und der Test dabei beobachtet wurde, wie er
  zuverlässig fehlschlägt (Datei danach unverändert wiederhergestellt).
- Identitätsprüfung: `xlsx_template.DEPARTMENT_TOKENS is
  template_spec.DEPARTMENT_TOKENS` und `grid.NON_PERSON_ASSIGNMENT_VALUES is
  template_spec.NON_PERSON_ASSIGNMENT_TOKENS` — echte Aliasse, keine Kopien.

### Keine Verhaltensänderung

`GET /api/known-department-tokens` liefert vor und nach der Umstellung
byte-identisch (`git stash`-Vergleich, isolierte Testdatenbank):
```
['COCINA', 'DEKO', 'FO', 'KÜCHE', 'LIVE-ENT', 'MANAGER', 'NM', 'REQUI',
 'S&L', 'SPA', 'SPORTSTAINER', 'SPT', 'TC', 'WASPO', 'WFA']
```

### Testergebnisse

| Befehl | Exit-Code | Ergebnis |
|---|---|---|
| `python -m py_compile` (alle 4 geänderten Dateien) | 0 | erfolgreich |
| `python -c "import backend.{api,grid,xlsx_template,template_spec}"` | 0 | keine Zyklen/Seiteneffekte |
| `pytest` | 0 | **205 passed** (122 vorher + 83 neu) |
| Drift-Test bei absichtlich wieder eingefügter `KNOWN_DEPARTMENT_TOKENS` | — | schlägt zuverlässig fehl (verifiziert, Datei danach wiederhergestellt) |

### Verbleibende Sonderfälle

- `api.py`s inline `{"-", "keine", "kein", "niemand"}`-Prüfung (Zeile 863)
  bleibt eine vierte, separate Stelle mit denselben vier Sonderwerten wie
  `template_spec.SPECIAL_ASSIGNMENT_TOKENS` — bewusst nicht angefasst, da die
  Aufgabenstellung für `api.py` ausdrücklich nur den Ersatz von
  `KNOWN_DEPARTMENT_TOKENS` vorsah („Keine weitere Bereinigung in api.py").
  Mögliches, hier nicht umgesetztes Folgepaket.
- `template_spec.department_labels()` (Planzeilen-Kategorien) und
  `template_spec.DEPARTMENT_TOKENS` (Zellwert-Kurzcodes) bleiben bewusst
  zwei getrennte Konzepte mit ähnlichem Namen — im Docstring von
  `DEPARTMENT_TOKENS` explizit voneinander abgegrenzt, um künftige
  Verwechslung zu vermeiden.
